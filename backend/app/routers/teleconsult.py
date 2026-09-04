"""Assisted teleconsultation (Feature 5).

ASHA / PHC staff request a teleconsult for a field patient (video | audio |
chat; audio is the low-bandwidth default). The doctor queue shows open
requests; the doctor accepts, starts the call, then saves diagnosis + advice +
notes on completion — all written into the longitudinal patient record.

GET   /api/v1/teleconsult              -> list (status filter)
POST  /api/v1/teleconsult              -> request a consult [asha, doctor]
PATCH /api/v1/teleconsult/{id}/action  -> accept | decline | start | complete | cancel
PATCH /api/v1/teleconsult/{id}/notes   -> save diagnosis / advice / notes
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import require_role
from ..models import Facility, Patient, TeleconsultRequest, utcnow
from ..schemas import (
    TeleconsultAction,
    TeleconsultCreate,
    TeleconsultNotes,
    TeleconsultOut,
)
from ..services.messaging import queue_message_for_patient

router = APIRouter(prefix="/teleconsult", tags=["teleconsult"])


@router.get("/config")
def teleconsult_config():
    """Frontend helper: which WebRTC provider to embed and how to build the
    patient join link. `simulated` means live media is disabled (demo mode)."""
    return {
        "provider": settings.teleconsult_provider,
        "daily_domain": settings.daily_domain,
        "simulated": settings.teleconsult_provider == "simulated",
    }


def _age(dob):
    if not dob:
        return None
    from datetime import date
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def _join_url(r: TeleconsultRequest) -> str:
    """WebRTC room link — the exact room the doctor portal embeds, so the
    ASHA worker and the doctor always share one join URL."""
    room = f"gramarogya-{r.id}"
    if settings.teleconsult_provider == "daily" and settings.daily_domain:
        return f"https://{settings.daily_domain}/{room}"
    return f"https://meet.jit.si/GramArogya-{r.id}"


def _to_out(db: Session, r: TeleconsultRequest) -> TeleconsultOut:
    patient = db.get(Patient, r.patient_id)
    fac = db.get(Facility, r.facility_id) if r.facility_id else None
    return TeleconsultOut(
        id=r.id,
        patient_id=r.patient_id,
        patient_name=patient.name if patient else None,
        abha_id=patient.abha_id if patient else None,
        age=_age(patient.dob) if patient else None,
        gender=patient.gender if patient else None,
        village=patient.village if patient else None,
        encounter_id=r.encounter_id,
        facility_id=r.facility_id,
        facility_name=fac.name if fac else None,
        requested_by=r.requested_by,
        mode=r.mode,
        reason=r.reason,
        status=r.status,
        doctor_name=r.doctor_name,
        diagnosis=r.diagnosis,
        advice=r.advice,
        notes=r.notes,
        requested_at=r.requested_at,
        accepted_at=r.accepted_at,
        started_at=r.started_at,
        ended_at=r.ended_at,
        join_url=_join_url(r),
    )


@router.get("", response_model=list[TeleconsultOut])
def list_requests(status: str | None = None, db: Session = Depends(get_db)):
    query = db.query(TeleconsultRequest)
    if status:
        query = query.filter(TeleconsultRequest.status == status)
    return [_to_out(db, r) for r in query.order_by(TeleconsultRequest.requested_at.desc()).all()]


@router.post("", response_model=TeleconsultOut, status_code=201,
             dependencies=[Depends(require_role("asha", "doctor"))])
def create_request(payload: TeleconsultCreate, db: Session = Depends(get_db)):
    patient = db.get(Patient, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    if payload.mode not in TeleconsultRequest.MODES:
        raise HTTPException(status_code=422, detail="mode must be video | audio | chat")

    req = TeleconsultRequest(
        patient_id=payload.patient_id,
        encounter_id=payload.encounter_id,
        facility_id=payload.facility_id,
        requested_by=payload.requested_by or "ASHA Worker",
        mode=payload.mode,
        reason=payload.reason,
        status="requested",
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return _to_out(db, req)


@router.patch("/{request_id}/action", response_model=TeleconsultOut,
              dependencies=[Depends(require_role("doctor"))])
def act_on_request(request_id: str, payload: TeleconsultAction,
                   db: Session = Depends(get_db)):
    req = db.get(TeleconsultRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Teleconsult not found")

    action = payload.action
    allowed = {
        "accept": "accepted", "decline": "declined", "start": None,
        "complete": "completed", "cancel": "cancelled",
    }
    if action not in allowed:
        raise HTTPException(status_code=422, detail="Unknown action")

    now = utcnow()
    if action == "accept":
        if not req.can_transition("accepted"):
            raise HTTPException(status_code=409, detail=f"Cannot accept from '{req.status}'")
        req.status, req.accepted_at = "accepted", now
    elif action == "decline":
        if not req.can_transition("declined"):
            raise HTTPException(status_code=409, detail=f"Cannot decline from '{req.status}'")
        req.status = "declined"
        patient = db.get(Patient, req.patient_id)
        if patient and patient.phone:
            queue_message_for_patient(
                db, patient,
                "Your teleconsultation request could not be accepted right now. "
                "Please visit the PHC or contact your ASHA worker. — GramArogya",
            )
    elif action == "cancel":
        if not req.can_transition("cancelled"):
            raise HTTPException(status_code=409, detail=f"Cannot cancel from '{req.status}'")
        req.status = "cancelled"
    elif action == "start":
        if req.status != "accepted":
            raise HTTPException(status_code=409, detail="Accept the request before starting")
        req.status, req.started_at = "accepted", now  # call is live; status shown by started_at
    elif action == "complete":
        if req.status not in ("accepted",):
            raise HTTPException(status_code=409, detail="Only an accepted call can be completed")
        req.status, req.ended_at = "completed", now

    if payload.doctor_name:
        req.doctor_name = payload.doctor_name
    db.commit()
    db.refresh(req)
    return _to_out(db, req)


@router.patch("/{request_id}/notes", response_model=TeleconsultOut,
              dependencies=[Depends(require_role("doctor"))])
def save_notes(request_id: str, payload: TeleconsultNotes, db: Session = Depends(get_db)):
    req = db.get(TeleconsultRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Teleconsult not found")
    if req.status not in ("accepted", "completed"):
        raise HTTPException(status_code=409, detail="Notes can only be saved during/after the call")

    if payload.diagnosis is not None:
        req.diagnosis = payload.diagnosis
    if payload.advice is not None:
        req.advice = payload.advice
    if payload.notes is not None:
        req.notes = payload.notes
    db.commit()
    db.refresh(req)
    return _to_out(db, req)
