"""Appointments + OPD token queue (OPD Queue Manager).

ASHA workers / kiosks / doctors book or check in a patient; the backend
assigns the next free per-day sequence for that facility + department and
issues a GA-<FAC>-<DEPT>-<YYYYMMDD>-<COUNTER>-<SEQ> token label.

Queue rules:
  * Doctor availability gate — when the doctor is 🔴 OFFLINE, no new tokens
    are issued anywhere (portal, kiosk): HTTP 409.
  * Today's token queue sorts by priority first, then arrival sequence.
  * Live updates: every create/status change broadcasts a `queue_changed`
    event on the facility's WebSocket room.

GET    /api/v1/appointments            -> list (filter by facility/date/status)
POST   /api/v1/appointments            -> book/check-in (auto token) [asha, doctor]
PATCH  /api/v1/appointments/{id}       -> status/priority change [doctor, asha]
GET    /api/v1/appointments/queue/today-> today's OPD queue, priority + token
"""

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_role
from ..models import Appointment, Facility, Patient, utcnow
from ..schemas import AppointmentCreate, AppointmentOut, AppointmentPatch
from ..services.messaging import queue_message_for_patient
from ..services.opd import (
    build_token_label,
    doctor_available,
    facility_code,
    next_token_seq,
)
from ..services.ws_manager import hub

router = APIRouter(prefix="/appointments", tags=["appointments"])

WAIT_MIN_PER_PATIENT = 7
PRIORITY_ORDER = {"emergency": 0, "pregnant_woman": 1, "child": 2, "elderly": 3,
                  "urgent": 4, "routine": 5}


def _day_bounds(when: datetime) -> tuple[datetime, datetime]:
    """Start/end of the calendar day containing `when` (UTC-naive safe)."""
    day = when.date()
    start = datetime.combine(day, time.min)
    return start, start + timedelta(days=1)


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
        token_label=appt.token_label,
        department=appt.department,
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
    """Today's OPD queue board — priority first, then arrival sequence."""
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
    for i, a in enumerate(rows):
        # Patients physically ahead in the displayed (priority) order.
        ahead = sum(1 for b in rows[:i] if b.status == "waiting")
        out.append(_to_out(db, a, ahead * WAIT_MIN_PER_PATIENT if a.status == "waiting" else None))
    return out


@router.post("", response_model=AppointmentOut, status_code=201,
             dependencies=[Depends(require_role("asha", "doctor", "admin", "kiosk"))])
async def create_appointment(payload: AppointmentCreate, db: Session = Depends(get_db)):
    """Book / check-in a patient -> issues the next GA-... token.

    Token generation is automatically disabled while the doctor is 🔴 OFFLINE.
    """
    patient = db.get(Patient, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    facility = db.get(Facility, payload.facility_id)
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")
    if payload.priority not in Appointment.PRIORITY_TAGS:
        raise HTTPException(status_code=422, detail="Unknown priority tag")
    if not doctor_available(db, payload.facility_id):
        raise HTTPException(
            status_code=409,
            detail="Doctor is OFFLINE — token generation is disabled on the portal.",
        )

    when = payload.scheduled_for or utcnow()
    seq = next_token_seq(db, payload.facility_id, payload.department, when)
    appt = Appointment(
        patient_id=payload.patient_id,
        facility_id=payload.facility_id,
        scheduled_for=when,
        token=seq,
        token_label=build_token_label(
            facility_code(facility), payload.department, when, payload.counter, seq,
        ),
        department=payload.department,
        priority=payload.priority,
        reason=payload.reason,
        status="waiting",
    )
    db.add(appt)

    if patient.phone:
        queue_message_for_patient(
            db, patient,
            f"OPD appointment booked at {facility.name} — token {appt.token_label}. "
            f"Please carry your ABHA card. — GramArogya",
        )
    else:
        db.commit()

    db.refresh(appt)
    await hub.broadcast(payload.facility_id, {
        "type": "queue_changed",
        "event": "token_created",
        "token_label": appt.token_label,
        "status": appt.status,
    })
    return _to_out(db, appt)


@router.patch("/{appointment_id}", response_model=AppointmentOut,
              dependencies=[Depends(require_role("doctor", "asha", "admin"))])
async def update_appointment(appointment_id: str, payload: AppointmentPatch,
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
    await hub.broadcast(appt.facility_id, {
        "type": "queue_changed",
        "event": "token_updated",
        "token_label": appt.token_label,
        "status": appt.status,
        "priority": appt.priority,
    })
    return _to_out(db, appt)