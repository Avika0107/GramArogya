"""Doctor (PHC) portal endpoints.

GET   /api/v1/queue                       -> incoming patients sorted by triage
                                             score (RED auto-jumps to top)
GET   /api/v1/patients/{id}/timeline      -> longitudinal medical record
PATCH /api/v1/encounters/{id}             -> save a consultation (diagnosis,
                                             notes, status, OPD vitals)
POST  /api/v1/prescriptions               -> smart e-prescription (queues an
                                             SMS when follow_up_at is set)
"""

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_role
from ..models import (
    Appointment,
    Encounter,
    Facility,
    FollowUpTask,
    LabOrder,
    Patient,
    Prescription,
    Referral,
    TeleconsultRequest,
    TriageRecord,
    utcnow,
)
from ..schemas import (
    ConsultationSave,
    EncounterCreate,
    PrescriptionCreate,
    PrescriptionOut,
    QueueItem,
    TimelineItem,
)
from ..services.messaging import queue_message_for_patient
from ..services.triage import assess

router = APIRouter(tags=["doctor"])


def _age(dob: date | None) -> int | None:
    if not dob:
        return None
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def _latest_triage(db: Session, enc: Encounter) -> TriageRecord | None:
    """Latest triage for an encounter, falling back to the patient's latest."""
    by_encounter = (
        db.query(TriageRecord)
        .filter(TriageRecord.encounter_id == enc.id)
        .order_by(TriageRecord.assessed_at.desc())
        .first()
    )
    if by_encounter:
        return by_encounter
    return (
        db.query(TriageRecord)
        .filter(TriageRecord.patient_id == enc.patient_id)
        .order_by(TriageRecord.assessed_at.desc())
        .first()
    )


@router.get("/queue", response_model=list[QueueItem])
def incoming_queue(
    facility_id: str | None = None,
    hours: int = 48,
    db: Session = Depends(get_db),
):
    """Incoming patient queue, RED first (flashing alert on the frontend)."""
    since = utcnow() - timedelta(hours=hours)
    encounters = (
        db.query(Encounter)
        .filter(Encounter.status == "open", Encounter.visited_at >= since)
        .order_by(Encounter.visited_at.desc())
        .all()
    )

    items: list[QueueItem] = []
    for enc in encounters:
        patient = db.get(Patient, enc.patient_id)
        if not patient:
            continue
        triage = _latest_triage(db, enc)
        items.append(QueueItem(
            encounter_id=enc.id,
            patient_id=patient.id,
            patient_name=patient.name,
            abha_id=patient.abha_id,
            age=_age(patient.dob),
            gender=patient.gender,
            triage_color=triage.color if triage else None,
            triage_score=triage.score if triage else None,
            triage_reasons=triage.reasons or [] if triage else [],
            chief_complaint=enc.chief_complaint,
            visited_at=enc.visited_at,
            facility_id=enc.facility_id,
        ))

    if facility_id:
        items = [i for i in items if i.facility_id == facility_id]

    # RED (score 100) always jumps to the top; then by recency
    items.sort(key=lambda i: (i.triage_score is None, -(i.triage_score or 0),
                              i.visited_at or datetime.min))
    return items


@router.post("/encounters", response_model=dict, status_code=201,
             dependencies=[Depends(require_role("doctor"))])
def open_encounter(payload: EncounterCreate, db: Session = Depends(get_db)):
    """Doctor opens an OPD visit for a walk-in / appointment patient."""
    if not db.get(Patient, payload.patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")
    if not db.get(Facility, payload.facility_id):
        raise HTTPException(status_code=404, detail="Facility not found")

    enc = Encounter(
        patient_id=payload.patient_id,
        facility_id=payload.facility_id,
        chief_complaint=payload.chief_complaint,
        status="open",
    )
    db.add(enc)

    if payload.appointment_id:
        appt = db.get(Appointment, payload.appointment_id)
        if appt and appt.status == "waiting":
            appt.status = "in_consultation"

    db.commit()
    db.refresh(enc)
    return {
        "id": enc.id,
        "patient_id": enc.patient_id,
        "facility_id": enc.facility_id,
        "status": enc.status,
        "visited_at": enc.visited_at,
    }


@router.patch("/encounters/{encounter_id}", response_model=dict,
              dependencies=[Depends(require_role("doctor"))])
def save_consultation(encounter_id: str, payload: ConsultationSave,
                      db: Session = Depends(get_db)):
    """Doctor writes the consultation back to the open encounter.

    Sets diagnosis / notes / discharge status, optionally records a vitals
    snapshot as a doctor-assessed triage observation (the rule engine still
    flags RED so emergencies surface on the queue), and queues a follow-up
    reminder SMS when a next-visit date is supplied.
    """
    enc = db.get(Encounter, encounter_id)
    if not enc:
        raise HTTPException(status_code=404, detail="Encounter not found")
    patient = db.get(Patient, enc.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    if payload.diagnosis is not None:
        enc.diagnosis = payload.diagnosis
    if payload.notes is not None:
        enc.notes = payload.notes
    if payload.advice:
        advice_block = f"Advice: {payload.advice}"
        enc.notes = (enc.notes + "\n\n" + advice_block) if enc.notes else advice_block
    if payload.status:
        if payload.status not in ("open", "discharged"):
            raise HTTPException(status_code=422, detail="status must be open | discharged")
        enc.status = payload.status

    facility = db.get(Facility, enc.facility_id)
    if payload.vitals and any(v not in (None, "") for v in payload.vitals.values()):
        result = assess({}, payload.vitals)
        db.add(TriageRecord(
            patient_id=patient.id,
            facility_id=enc.facility_id,
            encounter_id=enc.id,
            symptoms={},
            vitals=payload.vitals,
            color=result["color"],
            score=result["score"],
            reasons=result["reasons"],
            recommendation=result["recommendation"],
            assessed_by="doctor",
        ))
        if result["color"] == "RED":
            enc.notes = (enc.notes + "\n\n[RED vitals alert] " if enc.notes
                         else "[RED vitals alert] ") + "; ".join(result["reasons"])

    if payload.follow_up_at:
        if patient.phone:
            queue_message_for_patient(
                db, patient,
                f"Appointment reminder: follow-up visit at "
                f"{facility.name if facility else 'the PHC'} scheduled. "
                f"Please visit as advised. — GramArogya",
            )

    db.commit()
    db.refresh(enc)
    return {
        "id": enc.id,
        "patient_id": enc.patient_id,
        "status": enc.status,
        "diagnosis": enc.diagnosis,
        "notes": enc.notes,
    }


@router.get("/patients/{patient_id}/timeline", response_model=list[TimelineItem])
def patient_timeline(patient_id: str, db: Session = Depends(get_db)):
    """Longitudinal record: encounters + triages + referrals + prescriptions +
    lab orders + follow-up tasks + teleconsults, merged chronologically."""
    if not db.get(Patient, patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")

    items: list[TimelineItem] = []

    for enc in db.query(Encounter).filter(Encounter.patient_id == patient_id).all():
        fac = db.get(Facility, enc.facility_id)
        items.append(TimelineItem(
            kind="encounter",
            title=f"Visit — {enc.chief_complaint or 'Consultation'}",
            detail=enc.diagnosis or "No diagnosis recorded",
            facility=fac.name if fac else None,
            status=enc.status,
            occurred_at=enc.visited_at,
        ))

    for tr in db.query(TriageRecord).filter(TriageRecord.patient_id == patient_id).all():
        fac = db.get(Facility, tr.facility_id) if tr.facility_id else None
        items.append(TimelineItem(
            kind="triage",
            title=f"Triage: {tr.color}",
            detail="; ".join(tr.reasons or []),
            facility=fac.name if fac else None,
            status=tr.color,
            occurred_at=tr.assessed_at,
        ))

    for r in db.query(Referral).filter(Referral.patient_id == patient_id).all():
        src = db.get(Facility, r.from_facility_id)
        dst = db.get(Facility, r.to_facility_id)
        items.append(TimelineItem(
            kind="referral",
            title=f"Referral: {r.status}",
            detail=f"{src.name if src else '?'} → {dst.name if dst else '?'} — {r.reason or ''}",
            facility=(dst.name if dst else None),
            status=r.status,
            occurred_at=r.created_at,
        ))

    for rx in db.query(Prescription).filter(Prescription.patient_id == patient_id).all():
        items.append(TimelineItem(
            kind="prescription",
            title=f"Prescription by {rx.doctor_name or 'doctor'}",
            detail=", ".join((i.get("name") or "") for i in (rx.items or [])) or "No items",
            occurred_at=rx.created_at,
        ))

    for lo in db.query(LabOrder).filter(LabOrder.patient_id == patient_id).all():
        fac = db.get(Facility, lo.facility_id) if lo.facility_id else None
        items.append(TimelineItem(
            kind="lab",
            title=f"Lab order: {lo.status}",
            detail=", ".join((t.get("name") or "") for t in (lo.tests or [])) or "Tests",
            facility=fac.name if fac else None,
            status=lo.status,
            occurred_at=lo.ordered_at,
        ))

    for fu in db.query(FollowUpTask).filter(FollowUpTask.patient_id == patient_id).all():
        items.append(TimelineItem(
            kind="followup",
            title=f"Follow-up ({fu.category}): {fu.status}",
            detail=fu.task or f"Due {fu.due_date.isoformat()} — {fu.assigned_to or 'unassigned'}",
            status=fu.status,
            occurred_at=datetime.combine(fu.due_date, datetime.min.time()),
        ))

    for tc in db.query(TeleconsultRequest).filter(TeleconsultRequest.patient_id == patient_id).all():
        items.append(TimelineItem(
            kind="teleconsult",
            title=f"Teleconsult ({tc.mode}): {tc.status}",
            detail=tc.diagnosis or tc.reason or "No notes",
            status=tc.status,
            occurred_at=tc.requested_at,
        ))

    items.sort(key=lambda i: i.occurred_at or datetime.min, reverse=True)
    return items


@router.post("/prescriptions", response_model=PrescriptionOut, status_code=201,
             dependencies=[Depends(require_role("doctor"))])
def create_prescription(payload: PrescriptionCreate, db: Session = Depends(get_db)):
    """Smart e-prescription. Setting follow_up_at queues an appointment-reminder
    SMS (offline-aware queue, dispatched later)."""
    patient = db.get(Patient, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    facility = db.get(Facility, payload.facility_id)
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")

    rx = Prescription(
        patient_id=payload.patient_id,
        facility_id=payload.facility_id,
        doctor_name=payload.doctor_name,
        items=payload.items,
        follow_up_at=payload.follow_up_at,
    )
    db.add(rx)

    if payload.follow_up_at and patient.phone:
        queue_message_for_patient(
            db, patient,
            f"Appointment reminder: follow-up at {facility.name} scheduled. "
            f"Please visit as advised. — GramArogya",
        )
    else:
        db.commit()

    db.refresh(rx)
    return PrescriptionOut(
        id=rx.id,
        patient_id=rx.patient_id,
        facility_id=rx.facility_id,
        doctor_name=rx.doctor_name,
        items=rx.items or [],
        follow_up_at=rx.follow_up_at,
        created_at=rx.created_at,
    )
