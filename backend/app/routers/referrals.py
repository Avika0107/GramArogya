"""Referral state machine + closed-loop tracking.

States: created -> sent -> accepted -> completed
                         |          |
                         v          v
                      rejected    no_show

PATCH /api/v1/referrals/track validates every transition and, as a side
effect, writes OFFLINE-AWARE notifications to pending_messages (never sent
synchronously — drained later by POST /api/v1/messages/dispatch).
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Facility, Patient, Referral
from ..schemas import (
    ReferralCreate,
    ReferralOut,
    ReferralTrackRequest,
)
from ..services.messaging import queue_message_for_patient

router = APIRouter(prefix="/referrals", tags=["referrals"])


def _to_out(db: Session, r: Referral) -> ReferralOut:
    patient = db.get(Patient, r.patient_id)
    src = db.get(Facility, r.from_facility_id)
    dst = db.get(Facility, r.to_facility_id)
    return ReferralOut(
        id=r.id,
        patient_id=r.patient_id,
        patient_name=patient.name if patient else None,
        from_facility_id=r.from_facility_id,
        from_facility_name=src.name if src else None,
        to_facility_id=r.to_facility_id,
        to_facility_name=dst.name if dst else None,
        reason=r.reason,
        priority=r.priority,
        status=r.status,
        notes=r.notes,
        created_at=r.created_at,
        sent_at=r.sent_at,
        accepted_at=r.accepted_at,
        completed_at=r.completed_at,
        no_show_at=r.no_show_at,
        rejected_at=r.rejected_at,
    )


def _queue_referral_notification(db: Session, r: Referral, event: str) -> None:
    """Queue a patient SMS on key events (offline-aware: queue only, send later)."""
    patient = db.get(Patient, r.patient_id)
    if not patient:
        return
    dst = db.get(Facility, r.to_facility_id)
    src = db.get(Facility, r.from_facility_id)
    dst_name = dst.name if dst else "referral facility"
    src_name = src.name if src else "your facility"

    if event == "send":
        text = (f"Your referral from {src_name} to {dst_name} has been sent. "
                f"Please carry your ABHA card. — GramArogya")
    elif event == "accept":
        text = (f"Good news: your referral to {dst_name} has been ACCEPTED. "
                f"Please visit soon with your ABHA card. — GramArogya")
    elif event == "no_show":
        text = (f"Follow-up needed: you missed your appointment at {dst_name}. "
                f"Please contact your ASHA worker. — GramArogya")
    elif event == "reject":
        text = (f"Your referral to {dst_name} was not accepted. Please visit "
                f"{src_name} for next steps. — GramArogya")
    else:
        return
    queue_message_for_patient(db, patient, text)


@router.get("", response_model=list[ReferralOut])
def list_referrals(status: str | None = None, db: Session = Depends(get_db)):
    query = db.query(Referral)
    if status:
        query = query.filter(Referral.status == status)
    return [_to_out(db, r) for r in query.order_by(Referral.created_at.desc()).all()]


@router.post("", response_model=ReferralOut, status_code=201)
def create_referral(payload: ReferralCreate, db: Session = Depends(get_db)):
    if not db.get(Patient, payload.patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")
    if not db.get(Facility, payload.from_facility_id):
        raise HTTPException(status_code=404, detail="Source facility not found")
    if not db.get(Facility, payload.to_facility_id):
        raise HTTPException(status_code=404, detail="Target facility not found")

    referral = Referral(
        patient_id=payload.patient_id,
        from_facility_id=payload.from_facility_id,
        to_facility_id=payload.to_facility_id,
        reason=payload.reason,
        priority=payload.priority,
        status="created",
    )
    db.add(referral)
    db.commit()
    db.refresh(referral)
    return _to_out(db, referral)


@router.patch("/track", response_model=ReferralOut)
def track_referral(payload: ReferralTrackRequest, db: Session = Depends(get_db)):
    """Advance the referral state machine: send | accept | reject | complete | no_show."""
    referral = db.get(Referral, payload.referral_id)
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")

    if not referral.can_transition(payload.event):
        allowed = sorted(Referral.ALLOWED_TRANSITIONS.get(referral.status, set()))
        raise HTTPException(
            status_code=409,
            detail=(
                f"Invalid transition '{payload.event}' from status "
                f"'{referral.status}'. Allowed: {allowed}"
            ),
        )

    referral.apply_transition(payload.event)
    if payload.notes:
        referral.notes = payload.notes

    # Offline-aware: write the notification to the queue, don't send yet
    _queue_referral_notification(db, referral, payload.event)

    db.commit()
    db.refresh(referral)
    return _to_out(db, referral)