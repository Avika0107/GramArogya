"""Patient CRUD + search. ABHA ID is the primary lookup key."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    Encounter,
    FollowUpTask,
    LabOrder,
    LabResult,
    Patient,
    Prescription,
    Referral,
    TeleconsultRequest,
    TriageRecord,
)
from ..schemas import PatientCreate, PatientOut, PatientUpdate

router = APIRouter(prefix="/patients", tags=["patients"])


@router.get("", response_model=list[PatientOut])
def list_patients(
    q: str | None = None,
    abha_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Search patients by free text (name / ABHA / phone / village) or exact ABHA id."""
    query = db.query(Patient)
    if abha_id:
        query = query.filter(Patient.abha_id == abha_id.strip())
    elif q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(
            Patient.name.ilike(like),
            Patient.abha_id.like(like),
            Patient.phone.like(like),
            Patient.village.ilike(like),
        ))
    return query.order_by(Patient.name).limit(100).all()


@router.post("", response_model=PatientOut, status_code=201)
def create_patient(payload: PatientCreate, db: Session = Depends(get_db)):
    existing = db.query(Patient).filter(Patient.abha_id == payload.abha_id).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Patient with ABHA {payload.abha_id} already exists",
        )
    patient = Patient(**payload.model_dump(exclude={"client_id"}), client_id=payload.client_id)
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


@router.get("/{patient_id}", response_model=PatientOut)
def get_patient(patient_id: str, db: Session = Depends(get_db)):
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


@router.patch("/{patient_id}", response_model=PatientOut)
def update_patient(patient_id: str, payload: PatientUpdate, db: Session = Depends(get_db)):
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(patient, field, value)
    db.commit()
    db.refresh(patient)
    return patient


# ---------------------------------------------------------------------------
# FHIR-style export (interoperability)
# ---------------------------------------------------------------------------
def _fhir_bundle(db: Session, patient: Patient) -> dict:
    """Loose HL7-FHIR R4-shaped Bundle for one patient's longitudinal record.

    This is a structural export (resources + references), not a strict FHIR
    conformance claim — the shapes mirror the DB model so a real ABDM/FHIR
    gateway can map them later.
    """
    entries: list[dict] = []

    def put(resource_type: str, rid: str, fields: dict) -> None:
        entries.append({
            "fullUrl": f"urn:uuid:{rid}",
            "resource": {"resourceType": resource_type, "id": rid, **fields},
        })

    put("Patient", patient.id, {
        "identifier": [
            {"system": "https://abdm.gov.in/abha", "value": patient.abha_id},
            *( [{"system": "https://gramarogya.in/family", "value": patient.family_id}]
               if patient.family_id else [] ),
        ],
        "name": [{"text": patient.name}],
        "birthDate": patient.dob.isoformat(),
        "gender": patient.gender,
        "telecom": [{"system": "phone", "value": patient.phone}] if patient.phone else [],
        "address": [{
            "text": " ".join(x for x in [patient.village, patient.district, patient.state]
                              if x) or None,
            "district": patient.district,
            "state": patient.state,
            "postalCode": patient.pincode,
        }],
    })

    for tr in db.query(TriageRecord).filter(TriageRecord.patient_id == patient.id).all():
        component = []
        for key, label in (("temperature", "Temperature"), ("pulse", "Pulse"),
                           ("spo2", "SpO2"), ("systolic_bp", "Systolic BP"),
                           ("diastolic_bp", "Diastolic BP")):
            if (tr.vitals or {}).get(key) not in (None, ""):
                component.append({"code": {"text": label},
                                  "valueQuantity": {"value": tr.vitals[key]}})
        put("Observation", tr.id, {
            "status": "final",
            "category": [{"coding": [{"code": "vital-signs"}]}],
            "code": {"text": f"Triage {tr.color}"},
            "component": component,
            "interpretation": [{"text": tr.color}],
            "note": [{"text": "; ".join(tr.reasons or [])}],
            "effectiveDateTime": tr.assessed_at.isoformat() if tr.assessed_at else None,
            "subject": {"reference": f"urn:uuid:{patient.id}"},
        })

    for enc in db.query(Encounter).filter(Encounter.patient_id == patient.id).all():
        put("Encounter", enc.id, {
            "status": "finished" if enc.status == "discharged" else "in-progress",
            "class": {"code": "AMB"},
            "period": {"start": enc.visited_at.isoformat() if enc.visited_at else None},
            "reasonCode": [{"text": enc.chief_complaint}] if enc.chief_complaint else [],
            "diagnosis": [{"condition": {"text": enc.diagnosis}}] if enc.diagnosis else [],
            "notes": [{"text": enc.notes}] if enc.notes else [],
            "subject": {"reference": f"urn:uuid:{patient.id}"},
        })

    for rx in db.query(Prescription).filter(Prescription.patient_id == patient.id).all():
        put("MedicationRequest", rx.id, {
            "status": "active",
            "intent": "order",
            "authoredOn": rx.created_at.isoformat() if rx.created_at else None,
            "medicationCodeableConcept": {"coding": [{"text": rx.items}]},
            "dosageInstruction": [{"text": str(rx.items)}] if rx.items else [],
            "subject": {"reference": f"urn:uuid:{patient.id}"},
        })

    for lo in db.query(LabOrder).filter(LabOrder.patient_id == patient.id).all():
        results = [
            {"code": {"text": r.test_name}, "valueString": r.value_text,
             "interpretation": [{"text": r.flag}] if r.flag else [],
             "referenceRange": [{"text": f"{r.unit}"}] if r.unit else []}
            for r in db.query(LabResult).filter(LabResult.order_id == lo.id).all()
        ]
        put("DiagnosticReport", lo.id, {
            "status": "final" if lo.status == "report_ready" else "registered",
            "code": {"text": ", ".join((t.get("name") or "") for t in (lo.tests or []))},
            "result": results,
            "issued": lo.ready_at.isoformat() if lo.ready_at else None,
            "subject": {"reference": f"urn:uuid:{patient.id}"},
        })

    for fu in db.query(FollowUpTask).filter(FollowUpTask.patient_id == patient.id).all():
        put("Task", fu.id, {
            "status": "completed" if fu.status == "completed" else "requested",
            "code": {"text": f"{fu.category} follow-up — {fu.task or ''}"},
            "dueDate": fu.due_date.isoformat(),
            "owner": {"display": fu.assigned_to or "ASHA"},
            "note": [{"text": fu.notes}] if fu.notes else [],
        })

    for r in db.query(Referral).filter(Referral.patient_id == patient.id).all():
        put("ServiceRequest", r.id, {
            "status": {"created": "draft", "sent": "active", "accepted": "active",
                        "completed": "completed", "no_show": "cancelled",
                        "rejected": "cancelled"}.get(r.status, "draft"),
            "intent": "plan",
            "code": {"text": r.reason or "Referral"},
            "priority": r.priority,
            "subject": {"reference": f"urn:uuid:{patient.id}"},
        })

    for tc in db.query(TeleconsultRequest).filter(TeleconsultRequest.patient_id == patient.id).all():
        put("Encounter", tc.id, {
            "status": "finished" if tc.status == "completed" else "in-progress",
            "class": {"code": "VR"},
            "serviceType": {"text": f"Teleconsult ({tc.mode})"},
            "reasonCode": [{"text": tc.reason}] if tc.reason else [],
            "notes": [{"text": (tc.diagnosis or "") + (" — " + tc.advice if tc.advice else "")}],
            "period": {"start": tc.requested_at.isoformat() if tc.requested_at else None,
                        "end": tc.ended_at.isoformat() if tc.ended_at else None},
            "subject": {"reference": f"urn:uuid:{patient.id}"},
        })

    return {
        "resourceType": "Bundle",
        "type": "history",
        "meta": {"profile": ["https://gramarogya.in/fhir/export"]},
        "total": len(entries),
        "entry": entries,
    }


@router.get("/{patient_id}/fhir", response_model=dict)
def export_fhir(patient_id: str, db: Session = Depends(get_db)):
    """Mock FHIR-style export of a patient's longitudinal record."""
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return _fhir_bundle(db, patient)