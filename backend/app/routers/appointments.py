"""Appointments + OPD token queue (Feature 3).

ASHA workers and PHC staff book an appointment; the backend assigns the next
free token number for that facility + day. The OPD queue board lists patients
with token, priority tag, status and an estimated wait time (7 min per person
already waiting ahead).

GET    /api/v1/appointments            -> list (filter by facility/date/status)
POST   /api/v1/appointments            -> book (auto token) [asha, doctor]
PATCH  /api/v1/appointments/{id}       -> status/priority change [doctor, asha]
GET    /api/v1/appointments/queue/today-> today's OPD queue, sorted by token
"""

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_role
from ..models import Appointment, Facility, Patient, utcnow
from ..schemas import AppointmentCreate, AppointmentOut, AppointmentPatch
from ..services.messaging import queue_message_for_patient

router = APIRouter(prefix="/appointments", tags=["appointments"])

WAIT_MIN_PER_PATIENT = 7
PRIORITY_ORDER = {"emergency": 0, "pregnant_woman": 1, "child": 2, "elderly": 3,
                  "urgent": 4, "routine": 5}


def _day_bounds(when: datetime) -> tuple[datetime, datetime]:
    """Start/end of the calendar day containing `when` (UTC-naive safe)."""
    day = when.date()
    start = datetime.combine(day, time.min)
    return start, start + timedelta(days=1)


def _next_token(db: Session, facility_id: str, when: datetime) -> int:
    """Next token number for this facility + calendar day."""
    start, end = _day_bounds(when)
    existing = (
        db.query(Appointment)
        .filter(Appointment.facility_id == facility_id,
                Appointment.scheduled_for >= start,
                Appointment.scheduled_for < end)
        .all()
    )
    return max([a.token for a in existing] or [0]) + 1


def _to_out(db: Session, appt: Appointment, est_wait: int | None = None) -> AppointmentOut:
    patient = db.get(Patient, appt.patient_id)
    fac = db.get(Facility, appt.facility_id)
    return AppointmentOut(
        id=appt.id,
        patient_id=appt.patient_id,
        patient_name=patient.name if patient else None,
        abha_id=patient.abha_id if patient else None,
        facility_id=appt.facility_id,
        facility_name=fac.name if fac else None,
        scheduled_for=appt.scheduled_for,
        token=appt.token,
        priority=appt.priority,
        reason=appt.reason,
        status=appt.status,
        est_wait_min=est_wait,
        created_at=appt.created_at,
    )


@router.get("", response_model=list[AppointmentOut])
def list_appointments(
    facility_id: str | None = None,
    status: str | None = None,
    day: date | None = None,
    db: Session = Depends(get_db),
):
    """List appointments; by default today's, at any facility."""
    query = db.query(Appointment)
    if facility_id:
        query = query.filter(Appointment.facility_id == facility_id)
    if status:
        query = query.filter(Appointment.status == status)
    if day:
        start = datetime.combine(day, time.min)
        query = query.filter(Appointment.scheduled_for >= start,
                             Appointment.scheduled_for < start + timedelta(days=1))
    rows = query.order_by(Appointment.scheduled_for.desc(), Appointment.token).all()

    # Estimated wait: 7 min per waiting patient ahead of this token (same day).
    out: list[AppointmentOut] = []
    for a in rows:
        est = None
        if a.status == "waiting":
            ahead = (
                db.query(Appointment)
                .filter(Appointment.facility_id == a.facility_id,
                        Appointment.status == "waiting",
                        Appointment.token < a.token,
                        Appointment.scheduled_for >= _day_bounds(a.scheduled_for)[0],
                        Appointment.scheduled_for < _day_bounds(a.scheduled_for)[1])
                .count()
            )
            est = ahead * WAIT_MIN_PER_PATIENT
        out.append(_to_out(db, a, est))
    return out


@router.get("/queue/today", response_model=list[AppointmentOut])
def opd_queue_today(
    facility_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Today's OPD queue board — token order, active statuses first."""
    start, end = _day_bounds(utcnow())
    query = (
        db.query(Appointment)
        .filter(Appointment.scheduled_for >= start, Appointment.scheduled_for < end)
    )
    if facility_id:
        query = query.filter(Appointment.facility_id == facility_id)
    rows = query.all()

    # Priority-tag aware token ordering (emergency jumps the line) while
    # keeping everyone in the daily token sequence for the physical queue.
    rows.sort(key=lambda a: (a.status == "completed", a.status == "no_show",
                             PRIORITY_ORDER.get(a.priority, 9), a.token))

    out: list[AppointmentOut] = []
    for a in rows:
        ahead = sum(
            1 for b in rows
            if b.status == "waiting" and b.token < a.token
        )
        out.append(_to_out(db, a, ahead * WAIT_MIN_PER_PATIENT if a.status == "waiting" else None))
    return out


@router.post("", response_model=AppointmentOut, status_code=201,
             dependencies=[Depends(require_role("asha", "doctor", "admin"))])
def create_appointment(payload: AppointmentCreate, db: Session = Depends(get_db)):
    patient = db.get(Patient, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    facility = db.get(Facility, payload.facility_id)
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")
    if payload.priority not in Appointment.PRIORITY_TAGS:
        raise HTTPException(status_code=422, detail="Unknown priority tag")

    when = payload.scheduled_for or utcnow()
    appt = Appointment(
        patient_id=payload.patient_id,
        facility_id=payload.facility_id,
        scheduled_for=when,
        token=_next_token(db, payload.facility_id, when),
        priority=payload.priority,
        reason=payload.reason,
        status="waiting",
    )
    db.add(appt)

    if patient.phone:
        queue_message_for_patient(
            db, patient,
            f"OPD appointment booked at {facility.name} — token {appt.token}. "
            f"Please carry your ABHA card. — GramArogya",
        )
    else:
        db.commit()

    db.refresh(appt)
    return _to_out(db, appt)


@router.patch("/{appointment_id}", response_model=AppointmentOut,
              dependencies=[Depends(require_role("doctor", "asha", "admin"))])
def update_appointment(appointment_id: str, payload: AppointmentPatch,
                       db: Session = Depends(get_db)):
    appt = db.get(Appointment, appointment_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if payload.status:
        if payload.status not in Appointment.STATUSES:
            raise HTTPException(status_code=422, detail="Unknown appointment status")
        appt.status = payload.status
    if payload.priority:
        if payload.priority not in Appointment.PRIORITY_TAGS:
            raise HTTPException(status_code=422, detail="Unknown priority tag")
        appt.priority = payload.priority
    db.commit()
    db.refresh(appt)
    return _to_out(db, appt)
