"""Patient lookup + offline auto-creation helpers (shared by routers)."""

from datetime import date, datetime
from typing import Optional, Tuple

from ..models import Patient


def find_patient(db, *, patient_id: Optional[str] = None,
                 abha_id: Optional[str] = None) -> Optional[Patient]:
    """Resolve a patient by id (preferred) or 14-digit ABHA id."""
    if patient_id:
        return db.get(Patient, patient_id)
    if abha_id:
        abha = abha_id.strip()
        return db.query(Patient).filter(Patient.abha_id == abha).first()
    return None


def _parse_date(value) -> date:
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            pass
    return date(2000, 1, 1)


def _parse_dt(value) -> Optional[datetime]:
    """Parse an ISO string (may end in 'Z') into an aware datetime, else None."""
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if isinstance(value, datetime):
        return value
    return None


def get_or_create_patient(db, data: dict) -> Tuple[Patient, bool]:
    """Find a patient by abha_id or create a minimal one (offline PWA safety net).

    The ASHA worker is expected to sync 'patient' records before 'triage'/
    'encounter' records, but batches can arrive in any order — this guarantees
    triage/encounter syncs always have a patient to attach to.
    """
    abha = (data.get("abha_id") or "").strip()
    existing = db.query(Patient).filter(Patient.abha_id == abha).first() if abha else None
    if existing:
        return existing, False

    patient = Patient(
        abha_id=abha or f"9{len(data.get('name') or '')}",  # fallback key, rare
        name=data.get("name") or "Unknown Patient",
        dob=_parse_date(data.get("dob")),
        gender=data.get("gender") or "unknown",
        phone=data.get("phone"),
        village=data.get("village"),
        district=data.get("district"),
        state=data.get("state"),
        pincode=data.get("pincode"),
        blood_group=data.get("blood_group"),
        allergies=data.get("allergies"),
        client_id=data.get("client_id"),
    )
    db.add(patient)
    return patient, True