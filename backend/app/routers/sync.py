"""POST /api/v1/sync — accepts a batch of offline records from the ASHA PWA.

Conflict resolution (see services/sync.py):
  * client_id idempotency: retries of the same record are safe (duplicate).
  * last-write-wins on updated_at for natural-key collisions (patients by ABHA).
  * triage records are RE-EVALUATED server-side, so the server stays the
    authority on RED/YELLOW/GREEN.
"""

from collections import Counter
from datetime import date as _date
from typing import Dict, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Encounter, Facility, FollowUpTask, Patient, Referral, TeleconsultRequest, TriageRecord, utcnow
from ..schemas import SyncRecord, SyncRecordResult, SyncRequest, SyncResponse
from ..services.patients import _parse_date, _parse_dt, find_patient, get_or_create_patient
from ..services.sync import client_wins, now_iso
from ..services.triage import assess

router = APIRouter(tags=["sync"])

# Fields the client may update on an existing patient (natural-key merge)
_PATIENT_UPDATE_FIELDS = ("name", "phone", "village", "district", "state",
                          "pincode", "family_id", "blood_group", "allergies")


def _resolve_patient_for_sync(db, data: dict, rec: SyncRecord):
    """Attach the record to an existing patient, or auto-create from ABHA."""
    patient = find_patient(db, patient_id=data.get("patient_id"), abha_id=data.get("abha_id"))
    if patient:
        return patient
    if data.get("abha_id"):
        patient, _ = get_or_create_patient(db, data)
        return patient
    return None


def _sync_patient(db, rec: SyncRecord) -> SyncRecordResult:
    data = rec.data
    abha = (data.get("abha_id") or "").strip()
    if len(abha) != 14:
        return SyncRecordResult(
            client_id=rec.client_id, type="patient", status="skipped",
            detail="Missing or invalid abha_id (must be 14 digits)",
        )

    # Idempotency: same client_id already synced?
    existing = db.query(Patient).filter(Patient.client_id == rec.client_id).first()
    if existing:
        return SyncRecordResult(
            client_id=rec.client_id, type="patient", status="duplicate",
            detail="Already synced (same client_id)", server_id=existing.id,
        )

    # Natural-key collision -> last-write-wins conflict resolution
    by_abha = db.query(Patient).filter(Patient.abha_id == abha).first()
    if by_abha:
        if client_wins(by_abha.updated_at, rec.updated_at):
            for field in _PATIENT_UPDATE_FIELDS:
                if field in data:
                    setattr(by_abha, field, data[field])
            by_abha.updated_at = utcnow()
            return SyncRecordResult(
                client_id=rec.client_id, type="patient", status="updated",
                detail="Client copy was newer — merged into existing patient",
                server_id=by_abha.id,
            )
        return SyncRecordResult(
            client_id=rec.client_id, type="patient", status="conflict_resolved",
            detail="Server copy is newer — kept server record", server_id=by_abha.id,
        )

    # New patient
    patient = Patient(
        abha_id=abha,
        name=data.get("name") or "Unknown Patient",
        dob=_parse_date(data.get("dob")),
        gender=data.get("gender") or "unknown",
        phone=data.get("phone"),
        village=data.get("village"),
        district=data.get("district"),
        state=data.get("state"),
        pincode=data.get("pincode"),
        family_id=data.get("family_id"),
        blood_group=data.get("blood_group"),
        allergies=data.get("allergies"),
        client_id=rec.client_id,
    )
    db.add(patient)
    return SyncRecordResult(
        client_id=rec.client_id, type="patient", status="created",
        detail="New patient created from offline record", server_id=patient.id,
    )


def _sync_encounter(db, rec: SyncRecord) -> SyncRecordResult:
    data = rec.data
    existing = db.query(Encounter).filter(Encounter.client_id == rec.client_id).first()
    if existing:
        return SyncRecordResult(
            client_id=rec.client_id, type="encounter", status="duplicate",
            detail="Already synced (same client_id)", server_id=existing.id,
        )

    patient = _resolve_patient_for_sync(db, data, rec)
    if not patient:
        return SyncRecordResult(
            client_id=rec.client_id, type="encounter", status="skipped",
            detail="No patient resolvable from patient_id/abha_id",
        )

    encounter = Encounter(
        patient_id=patient.id,
        facility_id=rec.facility_id or data.get("facility_id"),
        chief_complaint=data.get("chief_complaint"),
        notes=data.get("notes"),
        visited_at=_parse_dt(data.get("visited_at")) or utcnow(),
        client_id=rec.client_id,
    )
    db.add(encounter)
    return SyncRecordResult(
        client_id=rec.client_id, type="encounter", status="created",
        detail="New encounter created from offline record", server_id=encounter.id,
    )


def _sync_referral(db, rec: SyncRecord) -> SyncRecordResult:
    """Offline-created referral (e.g. emergency escalation from a RED triage)."""
    data = rec.data
    existing = db.query(Referral).filter(Referral.client_id == rec.client_id).first()
    if existing:
        return SyncRecordResult(
            client_id=rec.client_id, type="referral", status="duplicate",
            detail="Already synced (same client_id)", server_id=existing.id,
        )

    patient = _resolve_patient_for_sync(db, data, rec)
    if not patient:
        return SyncRecordResult(
            client_id=rec.client_id, type="referral", status="skipped",
            detail="No patient resolvable from patient_id/abha_id",
        )

    # Resolve facilities: from = the worker's facility (or the PHC), to = the
    # receiving facility picked on the device (fallback: district hospital).
    from_fac = db.get(Facility, data.get("from_facility_id")) if data.get("from_facility_id") else None
    if not from_fac:
        from_fac = (
            db.query(Facility).filter(Facility.facility_type == "phc").first()
            or db.query(Facility).filter(Facility.facility_type == "sub_centre").first()
        )
    to_fac = db.get(Facility, data.get("to_facility_id")) if data.get("to_facility_id") else None
    if not to_fac:
        to_fac = db.query(Facility).filter(Facility.facility_type == "district_hospital").first()
    if not from_fac or not to_fac:
        return SyncRecordResult(
            client_id=rec.client_id, type="referral", status="skipped",
            detail="No source/target facility available",
        )

    referral = Referral(
        patient_id=patient.id,
        from_facility_id=from_fac.id,
        to_facility_id=to_fac.id,
        reason=data.get("reason"),
        priority=data.get("priority") or "urgent",
        notes=data.get("notes"),
        client_id=rec.client_id,
        created_at=_parse_dt(data.get("created_at")) or utcnow(),
    )
    db.add(referral)
    return SyncRecordResult(
        client_id=rec.client_id, type="referral", status="created",
        detail=f"Referral created → {to_fac.name}", server_id=referral.id,
    )


def _sync_followup(db, rec: SyncRecord) -> SyncRecordResult:
    """Offline follow-up actions from the ASHA daily list.

    data.action == 'complete' -> mark an existing server task done
    otherwise                 -> create a new follow-up task
    """
    data = rec.data
    existing = db.query(FollowUpTask).filter(FollowUpTask.client_id == rec.client_id).first()
    if existing:
        return SyncRecordResult(
            client_id=rec.client_id, type="followup", status="duplicate",
            detail="Already synced (same client_id)", server_id=existing.id,
        )

    if data.get("action") == "complete" and data.get("task_id"):
        task = db.get(FollowUpTask, data["task_id"])
        if not task:
            return SyncRecordResult(
                client_id=rec.client_id, type="followup", status="skipped",
                detail="Task no longer exists on the server",
            )
        if task.status == "pending":
            task.status = "completed"
            task.completed_at = utcnow()
            task.client_id = rec.client_id
            return SyncRecordResult(
                client_id=rec.client_id, type="followup", status="updated",
                detail="Follow-up marked completed", server_id=task.id,
            )
        return SyncRecordResult(
            client_id=rec.client_id, type="followup", status="duplicate",
            detail="Task already completed", server_id=task.id,
        )

    # New offline follow-up task
    patient = _resolve_patient_for_sync(db, data, rec)
    if not patient:
        return SyncRecordResult(
            client_id=rec.client_id, type="followup", status="skipped",
            detail="No patient resolvable from patient_id/abha_id",
        )
    category = data.get("category") or "elderly"
    if category not in FollowUpTask.CATEGORIES:
        category = "elderly"
    due = data.get("due_date")
    task = FollowUpTask(
        patient_id=patient.id,
        facility_id=rec.facility_id or data.get("facility_id"),
        category=category,
        task=data.get("task"),
        due_date=_parse_date(due) if due else _date.today(),
        assigned_to=data.get("assigned_to"),
        priority=data.get("priority") or "routine",
        notes=data.get("notes"),
        client_id=rec.client_id,
    )
    db.add(task)
    return SyncRecordResult(
        client_id=rec.client_id, type="followup", status="created",
        detail="Follow-up task created from offline record", server_id=task.id,
    )


def _sync_teleconsult(db, rec: SyncRecord) -> SyncRecordResult:
    """Offline-created teleconsult request from the ASHA field app (Feature 5).

    Queued on the device while offline; when sync runs the request lands in the
    doctor's "Waiting for doctor" queue exactly as if it were created online.
    """
    data = rec.data
    existing = db.query(TeleconsultRequest).filter(
        TeleconsultRequest.client_id == rec.client_id
    ).first()
    if existing:
        return SyncRecordResult(
            client_id=rec.client_id, type="teleconsult", status="duplicate",
            detail="Already synced (same client_id)", server_id=existing.id,
        )

    patient = _resolve_patient_for_sync(db, data, rec)
    if not patient:
        return SyncRecordResult(
            client_id=rec.client_id, type="teleconsult", status="skipped",
            detail="No patient resolvable from patient_id/abha_id",
        )

    mode = data.get("mode") or "audio"
    if mode not in TeleconsultRequest.MODES:
        mode = "audio"
    req = TeleconsultRequest(
        patient_id=patient.id,
        encounter_id=data.get("encounter_id"),
        facility_id=rec.facility_id or data.get("facility_id"),
        requested_by=data.get("requested_by") or "ASHA Worker",
        mode=mode,
        reason=data.get("reason"),
        status="requested",
        client_id=rec.client_id,
        requested_at=_parse_dt(data.get("requested_at")) or utcnow(),
    )
    db.add(req)
    return SyncRecordResult(
        client_id=rec.client_id, type="teleconsult", status="created",
        detail=f"Teleconsult requested ({mode}) — doctor notified", server_id=req.id,
    )


def _sync_triage(db, rec: SyncRecord) -> SyncRecordResult:
    data = rec.data
    existing = db.query(TriageRecord).filter(TriageRecord.client_id == rec.client_id).first()
    if existing:
        return SyncRecordResult(
            client_id=rec.client_id, type="triage", status="duplicate",
            detail="Already synced (same client_id)", server_id=existing.id,
        )

    patient = _resolve_patient_for_sync(db, data, rec)
    if not patient:
        return SyncRecordResult(
            client_id=rec.client_id, type="triage", status="skipped",
            detail="No patient resolvable from patient_id/abha_id",
        )

    # Server recomputes the triage — authoritative even if the device disagreed
    result = assess(data.get("symptoms"), data.get("vitals"))
    record = TriageRecord(
        patient_id=patient.id,
        facility_id=rec.facility_id or data.get("facility_id"),
        symptoms=data.get("symptoms"),
        vitals=data.get("vitals"),
        color=result["color"],
        score=result["score"],
        reasons=result["reasons"],
        recommendation=result["recommendation"],
        assessed_by=data.get("assessed_by") or "asha_worker",
        assessed_at=_parse_dt(data.get("assessed_at")) or utcnow(),
        client_id=rec.client_id,
    )
    db.add(record)
    return SyncRecordResult(
        client_id=rec.client_id, type="triage", status="created",
        detail=f"Triage stored (server re-evaluated: {record.color})",
        server_id=record.id,
    )


_HANDLERS: Dict[str, object] = {
    "patient": _sync_patient,
    "encounter": _sync_encounter,
    "triage": _sync_triage,
    "referral": _sync_referral,
    "followup": _sync_followup,
    "teleconsult": _sync_teleconsult,
}


@router.post("/sync", response_model=SyncResponse)
def sync_offline_records(payload: SyncRequest, db: Session = Depends(get_db)):
    results = []
    for rec in payload.records:
        handler = _HANDLERS.get(rec.type)
        if handler is None:
            results.append(SyncRecordResult(
                client_id=rec.client_id, type=rec.type, status="skipped",
                detail=f"Unknown record type: {rec.type}",
            ))
            continue
        results.append(handler(db, rec))
        # Make records created earlier in this batch visible to later lookups
        # (the session has autoflush off).
        db.flush()

    db.commit()
    return SyncResponse(
        synced_at=now_iso(),
        results=results,
        counts=dict(Counter(r.status for r in results)),
    )