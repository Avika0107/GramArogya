"""Diagnostic coordination (Feature 8) — doctor orders, lab technician runs.

GET    /api/v1/lab/tests                       -> test catalogue w/ reference ranges
GET    /api/v1/lab/orders                      -> list orders (status/facility filter)
POST   /api/v1/lab/orders                      -> doctor places an order
PATCH  /api/v1/lab/orders/{id}/status          -> lab advances the pipeline
POST   /api/v1/lab/orders/{id}/results         -> lab enters structured results (+flags)
POST   /api/v1/lab/orders/{id}/report          -> upload a PDF/image report (base64)
GET    /api/v1/lab/orders/{id}                 -> full order detail incl. results

Status machine: ordered -> sample_collected -> dispatched -> received ->
processing -> report_ready. ready_at - ordered_at = turnaround time (TAT),
rolled up on the admin dashboard.
"""

import base64
import logging
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_role
from ..models import Facility, LabOrder, LabResult, LabTest, Patient, utcnow
from ..schemas import (
    LabOrderCreate,
    LabOrderOut,
    LabOrderStatusPatch,
    LabResultIn,
    LabResultOut,
    LabTestOut,
)

logger = logging.getLogger("gramarogya.lab")
router = APIRouter(prefix="/lab", tags=["lab"])

REPORTS_DIR = Path(__file__).resolve().parents[1] / "reports"  # backend/reports


def _test_out(t: LabTest) -> LabTestOut:
    ref = None
    if t.unit and not t.is_radiology and t.ref_low is not None and t.ref_high is not None:
        ref = f"{t.ref_low:g}–{t.ref_high:g} {t.unit}"
    return LabTestOut(
        id=t.id, code=t.code, name=t.name, category=t.category, unit=t.unit,
        ref_low=t.ref_low, ref_high=t.ref_high, is_radiology=t.is_radiology,
        collection_type=getattr(t, "collection_type", "hospital"),
        home_collectable=getattr(t, "home_collectable", False),
        ref_display=ref,
    )


def _flag_for(test: LabTest, value_text: str | None) -> str | None:
    """Auto-flag a structured numeric result against the reference range."""
    if not value_text or test.is_radiology or not test.unit:
        return None
    try:
        value = float(str(value_text).strip())
    except (TypeError, ValueError):
        return None
    if test.ref_critical_low is not None and value < test.ref_critical_low:
        return "critical"
    if test.ref_critical_high is not None and value > test.ref_critical_high:
        return "critical"
    if test.ref_low is not None and value < test.ref_low:
        return "low"
    if test.ref_high is not None and value > test.ref_high:
        return "high"
    return "normal"


def _order_out(db: Session, order: LabOrder) -> LabOrderOut:
    patient = db.get(Patient, order.patient_id)
    fac = db.get(Facility, order.facility_id) if order.facility_id else None
    results = (
        db.query(LabResult)
        .filter(LabResult.order_id == order.id)
        .order_by(LabResult.reported_at.asc())
        .all()
    )
    return LabOrderOut(
        id=order.id,
        patient_id=order.patient_id,
        patient_name=patient.name if patient else None,
        abha_id=patient.abha_id if patient else None,
        encounter_id=order.encounter_id,
        facility_id=order.facility_id,
        facility_name=fac.name if fac else None,
        ordered_by=order.ordered_by,
        tests=order.tests or [],
        status=order.status,
        collection_mode=getattr(order, "collection_mode", "hospital"),
        ordered_at=order.ordered_at,
        sample_collected_at=order.sample_collected_at,
        dispatched_at=order.dispatched_at,
        received_at=order.received_at,
        processing_at=order.processing_at,
        ready_at=order.ready_at,
        tat_seconds=order.tat_seconds,
        results=[LabResultOut.model_validate(r) for r in results],
        report_file=order.report_file,
    )


@router.get("/tests", response_model=list[LabTestOut])
def list_tests(db: Session = Depends(get_db)):
    return [_test_out(t) for t in db.query(LabTest).order_by(LabTest.category, LabTest.name).all()]


@router.get("/orders", response_model=list[LabOrderOut])
def list_orders(
    status: str | None = None,
    facility_id: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(LabOrder)
    if status:
        query = query.filter(LabOrder.status == status)
    if facility_id:
        query = query.filter(LabOrder.facility_id == facility_id)
    orders = query.order_by(LabOrder.ordered_at.desc()).all()
    return [_order_out(db, o) for o in orders]


@router.get("/orders/{order_id}", response_model=LabOrderOut)
def get_order(order_id: str, db: Session = Depends(get_db)):
    order = db.get(LabOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Lab order not found")
    return _order_out(db, order)


@router.post("/orders", response_model=LabOrderOut, status_code=201,
             dependencies=[Depends(require_role("doctor"))])
def create_order(payload: LabOrderCreate, db: Session = Depends(get_db)):
    patient = db.get(Patient, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    if not payload.tests:
        raise HTTPException(status_code=422, detail="Order at least one test")

    codes = {t.get("code") for t in payload.tests}
    known = {t.code: t for t in db.query(LabTest).filter(LabTest.code.in_(codes)).all()}
    if not codes.issubset(set(known)):
        raise HTTPException(status_code=422, detail="Unknown test code(s) in order")

    order = LabOrder(
        patient_id=payload.patient_id,
        encounter_id=payload.encounter_id,
        facility_id=payload.facility_id,
        ordered_by=payload.ordered_by or "Doctor",
        tests=[{"code": c, "name": known[c].name} for c in sorted(codes)],
        status="ordered",
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return _order_out(db, order)


@router.patch("/orders/{order_id}/status", response_model=LabOrderOut,
              dependencies=[Depends(require_role("lab", "admin"))])
def advance_order(order_id: str, payload: LabOrderStatusPatch, db: Session = Depends(get_db)):
    order = db.get(LabOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Lab order not found")
    if order.status == "report_ready":
        raise HTTPException(status_code=409, detail="Order already report_ready")
    if not order.can_transition(payload.status):
        raise HTTPException(
            status_code=409,
            detail=f"Invalid pipeline step '{payload.status}' from '{order.status}'",
        )
    order.apply_transition(payload.status)
    db.commit()
    db.refresh(order)
    return _order_out(db, order)


@router.post("/orders/{order_id}/results", response_model=LabOrderOut,
             dependencies=[Depends(require_role("lab", "admin"))])
def enter_results(order_id: str, payload: LabResultIn, db: Session = Depends(get_db)):
    """Lab technician enters structured results for an order that has reached
    the lab (received/processing). Missing pipeline stamps are auto-filled so
    the state machine always stays consistent, and numeric results are flagged
    Normal / High / Low / Critical automatically."""
    order = db.get(LabOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Lab order not found")
    if order.status == "report_ready":
        raise HTTPException(status_code=409, detail="Results already entered")
    if order.status not in ("received", "processing", "sample_collected"):
        raise HTTPException(
            status_code=409,
            detail="Results can only be entered once the sample reached the lab",
        )

    # Auto-advance any skipped pipeline steps for a consistent machine
    now = utcnow()
    if order.sample_collected_at is None:
        order.apply_transition("sample_collected", now)
    if order.dispatched_at is None:
        order.apply_transition("dispatched", now)
    if order.received_at is None:
        order.apply_transition("received", now)
    if order.processing_at is None:
        order.apply_transition("processing", now)

    tests_by_code = {t.code: t for t in db.query(LabTest).all()}
    for item in payload.results:
        code = item.get("test_code") or ""
        test = tests_by_code.get(code)
        if item.get("flag"):
            flag = item["flag"]
        elif test:
            flag = _flag_for(test, item.get("value_text"))
        else:
            flag = None
        db.add(LabResult(
            order_id=order.id,
            test_code=code,
            test_name=item.get("test_name") or (test.name if test else code),
            value_text=item.get("value_text"),
            unit=item.get("unit") or (test.unit if test else None),
            flag=flag,
            notes=item.get("notes"),
        ))

    if payload.report_note and not order.report_file:
        order.report_file = payload.report_note  # free-text report note/name

    order.apply_transition("report_ready", now)
    db.commit()
    db.refresh(order)
    return _order_out(db, order)


@router.post("/orders/{order_id}/report", response_model=dict,
             dependencies=[Depends(require_role("lab", "admin"))])
def upload_report(order_id: str, payload: dict, db: Session = Depends(get_db)):
    """Upload a PDF/image report (base64) and attach it to the order.

    Payload: {"file_name": "cbc_sunita.pdf", "data_base64": "..."}
    Stored under backend/reports/; filename is linked on the order row.
    """
    order = db.get(LabOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Lab order not found")
    file_name = (payload.get("file_name") or "").strip()
    data = payload.get("data_base64") or ""
    if not file_name or not data:
        raise HTTPException(status_code=422, detail="file_name and data_base64 are required")

    try:
        raw = base64.b64decode(data.split(",")[-1])
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid base64 payload")

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(c for c in file_name if c.isalnum() or c in "._-")
    stored = f"{order.id}_{safe or 'report.bin'}"
    (REPORTS_DIR / stored).write_bytes(raw)
    order.report_file = stored
    db.commit()
    logger.info("Stored report %s for order %s", stored, order_id)
    return {"ok": True, "report_file": stored, "note": f"{len(raw)} bytes saved"}
