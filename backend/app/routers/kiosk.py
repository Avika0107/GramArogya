"""Self-service kiosk (KIOSK_DEVICE role) — OPD walk-in tokens.

POST /api/v1/kiosk/token  -> issue a walk-in token (GA-...-KIO01-0000XX).
                             Respects the doctor availability gate (409 when
                             the doctor is 🔴 OFFLINE). [kiosk role]
GET  /api/v1/kiosk/queue   -> today's queue for the kiosk screen (public).

Only the KIOSK_DEVICE role may issue tokens; the queue board is public so the
kiosk display can show wait times without any credentials.
"""

from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_role
from ..models import Appointment, Facility, Patient, utcnow
from ..schemas import AppointmentOut, KioskTokenCreate
from ..services.opd import (
    build_token_label,
    doctor_available,
    facility_code,
    next_token_seq,
)
from ..services.ws_manager import hub
from .appointments import _day_bounds, _to_out, WAIT_MIN_PER_PATIENT

router = APIRouter(prefix="/kiosk", tags=["kiosk"])


@router.post("/token", response_model=AppointmentOut, status_code=201,
             dependencies=[Depends(require_role("kiosk"))])
async def kiosk_walkin_token(payload: KioskTokenCreate, db: Session = Depends(get_db)):
    """Kiosk walk-in check-in -> next GA-... token for the facility + day."""
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
            detail="Doctor is OFFLINE — token generation is disabled on the kiosk.",
        )

    when = utcnow()
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
        reason=payload.reason or "Walk-in (kiosk)",
        status="waiting",
    )
    db.add(appt)
    db.commit()
    db.refresh(appt)

    await hub.broadcast(payload.facility_id, {
        "type": "queue_changed",
        "event": "token_created",
        "token_label": appt.token_label,
        "status": appt.status,
    })
    return _to_out(db, appt)


@router.get("/queue", response_model=list[AppointmentOut])
def kiosk_queue(
    facility_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Today's queue for the kiosk display (priority first, then token)."""
    start, end = _day_bounds(utcnow())
    query = (
        db.query(Appointment)
        .filter(Appointment.scheduled_for >= start, Appointment.scheduled_for < end)
    )
    if facility_id:
        query = query.filter(Appointment.facility_id == facility_id)
    rows = query.all()
    rows.sort(key=lambda a: (a.status == "completed", a.status == "no_show",
                             a.token))
    out: list[AppointmentOut] = []
    for a in rows:
        ahead = sum(1 for b in rows if b.status == "waiting" and b.token < a.token)
        out.append(_to_out(db, a, ahead * WAIT_MIN_PER_PATIENT if a.status == "waiting" else None))
    return out