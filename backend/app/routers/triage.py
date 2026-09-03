"""POST /api/v1/triage — rule-based triage of symptoms + vitals.

The ASHA PWA also evaluates locally (identical JS mirror) so triage works
offline; this endpoint is the server-authoritative version and is used by the
offline sync pipeline to recompute/store records.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import TriageRecord, utcnow
from ..schemas import TriageRequest, TriageResponse
from ..services.patients import find_patient
from ..services.triage import assess

router = APIRouter(tags=["triage"])


@router.post("/triage", response_model=TriageResponse)
def run_triage(payload: TriageRequest, db: Session = Depends(get_db)):
    # Evaluate the rule tree (RED / YELLOW / GREEN)
    result = assess(payload.symptoms, payload.vitals)

    # Resolve the patient when possible (by id or ABHA id)
    patient = find_patient(db, patient_id=payload.patient_id, abha_id=payload.abha_id)

    record = TriageRecord(
        patient_id=patient.id if patient else None,
        facility_id=payload.facility_id,
        encounter_id=payload.encounter_id,
        symptoms=payload.symptoms,
        vitals=payload.vitals,
        color=result["color"],
        score=result["score"],
        reasons=result["reasons"],
        recommendation=result["recommendation"],
        assessed_by=payload.assessed_by,
        assessed_at=payload.assessed_at or utcnow(),
        client_id=payload.client_id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return TriageResponse(
        id=record.id,
        patient_id=record.patient_id,
        abha_id=payload.abha_id,
        color=record.color,
        score=record.score,
        reasons=record.reasons or [],
        recommendation=record.recommendation,
        assessed_at=record.assessed_at,
    )