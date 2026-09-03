"""High-risk follow-up tasks (Feature 10).

Categories: maternal, child_immunization, diabetes, hypertension, tb, elderly.
The ASHA daily list is `assigned_to` scoped; the doctor/admin dashboards roll
up completion rates and overdue buckets.

GET   /api/v1/followups          -> list with bucket filter
POST  /api/v1/followups          -> create (doctor / admin)
PATCH /api/v1/followups/{id}     -> complete / reschedule / reassign
"""

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_role
from ..models import Facility, FollowUpTask, Patient, utcnow
from ..schemas import FollowUpCreate, FollowUpOut, FollowUpPatch

router = APIRouter(prefix="/followups", tags=["followups"])

BUCKETS = ["due_today", "upcoming", "overdue", "completed"]


def _age(dob: date | None) -> int | None:
    if not dob:
        return None
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def _bucket(task: FollowUpTask, today: date) -> str:
    if task.status == "completed":
        return "completed"
    if task.status == "missed" or task.due_date < today:
        return "overdue"
    if task.due_date == today:
        return "due_today"
    return "upcoming"


def _to_out(db: Session, task: FollowUpTask) -> FollowUpOut:
    patient = db.get(Patient, task.patient_id)
    fac = db.get(Facility, task.facility_id) if task.facility_id else None
    return FollowUpOut(
        id=task.id,
        patient_id=task.patient_id,
        patient_name=patient.name if patient else None,
        abha_id=patient.abha_id if patient else None,
        age=_age(patient.dob) if patient else None,
        gender=patient.gender if patient else None,
        village=patient.village if patient else None,
        facility_id=task.facility_id,
        facility_name=fac.name if fac else None,
        category=task.category,
        task=task.task,
        due_date=task.due_date,
        assigned_to=task.assigned_to,
        priority=task.priority,
        status=task.status,
        notes=task.notes,
        created_at=task.created_at,
        completed_at=task.completed_at,
        bucket=_bucket(task, date.today()),
    )


@router.get("", response_model=list[FollowUpOut])
def list_followups(
    bucket: str | None = None,
    category: str | None = None,
    assigned_to: str | None = None,
    facility_id: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    if bucket and bucket not in BUCKETS:
        raise HTTPException(status_code=422, detail=f"bucket must be one of {BUCKETS}")

    query = db.query(FollowUpTask)
    if category:
        query = query.filter(FollowUpTask.category == category)
    if assigned_to:
        query = query.filter(FollowUpTask.assigned_to == assigned_to)
    if facility_id:
        query = query.filter(FollowUpTask.facility_id == facility_id)
    if status:
        query = query.filter(FollowUpTask.status == status)

    tasks = query.order_by(FollowUpTask.due_date.asc()).all()

    if bucket:
        tasks = [t for t in tasks if _bucket(t, date.today()) == bucket]
    return [_to_out(db, t) for t in tasks]


@router.post("", response_model=FollowUpOut, status_code=201,
             dependencies=[Depends(require_role("doctor", "admin", "asha"))])
def create_followup(payload: FollowUpCreate, db: Session = Depends(get_db)):
    if not db.get(Patient, payload.patient_id):
        raise HTTPException(status_code=404, detail="Patient not found")
    if payload.facility_id and not db.get(Facility, payload.facility_id):
        raise HTTPException(status_code=404, detail="Facility not found")
    if payload.category not in FollowUpTask.CATEGORIES:
        raise HTTPException(status_code=422, detail="Unknown follow-up category")

    task = FollowUpTask(**payload.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return _to_out(db, task)


@router.patch("/{task_id}", response_model=FollowUpOut,
              dependencies=[Depends(require_role("doctor", "asha", "admin"))])
def update_followup(task_id: str, payload: FollowUpPatch, db: Session = Depends(get_db)):
    task = db.get(FollowUpTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Follow-up task not found")

    if payload.status:
        if payload.status not in FollowUpTask.STATUSES:
            raise HTTPException(status_code=422, detail="Unknown follow-up status")
        task.status = payload.status
        task.completed_at = utcnow() if payload.status == "completed" else None
    if payload.due_date:
        task.due_date = payload.due_date
    if payload.assigned_to is not None:
        task.assigned_to = payload.assigned_to
    if payload.notes is not None:
        task.notes = payload.notes
    db.commit()
    db.refresh(task)
    return _to_out(db, task)
