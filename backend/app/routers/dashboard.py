"""Dashboards (Feature 11).

GET /api/v1/dashboard/summary    -> district-level funnel, TAT, stock-outs
GET /api/v1/dashboard/phc        -> one PHC's live board (OPD, queue, RED,
                                    referrals, lab, follow-ups, stock, trend)
GET /api/v1/dashboard/district   -> district roll-up with facility performance
                                    table + date/type filters
"""

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    Appointment,
    Encounter,
    Facility,
    FollowUpTask,
    Inventory,
    LabOrder,
    Medicine,
    Patient,
    PendingMessage,
    Referral,
    TriageRecord,
    utcnow,
)
from ..schemas import (
    DailyCount,
    DistrictDashboard,
    FacilityPerformance,
    FacilityTAT,
    FunnelStage,
    PHCDashboard,
    StockoutAlert,
)

router = APIRouter(tags=["dashboard"])

FUNNEL_STAGES = ["created", "sent", "accepted", "completed", "no_show"]


def _funnel(db: Session, query=None) -> list[FunnelStage]:
    """Referral funnel counts. `query` optionally pre-filters the referral rows."""
    base = db.query(Referral)
    if query is not None:
        base = query
    counts = {stage: 0 for stage in FUNNEL_STAGES}
    for status, n in base.with_entities(Referral.status, func.count()).group_by(Referral.status):
        if status in counts:
            counts[status] = n
    return [FunnelStage(stage=s, count=counts[s]) for s in FUNNEL_STAGES]


def _weekly_opd(db: Session, facility_ids: list[str] | None = None,
                days: int = 7) -> list[DailyCount]:
    """Per-day OPD volume (encounters + appointments) for the last `days` days."""
    start = datetime.combine(date.today() - timedelta(days=days - 1), time.min)
    end = start + timedelta(days=days)

    buckets = { (start + timedelta(days=i)).date(): 0 for i in range(days) }

    def _count(model, col):
        q = db.query(model)
        if facility_ids:
            q = q.filter(model.facility_id.in_(facility_ids))
        q = q.filter(col >= start, col < end).all()
        for row in q:
            d = getattr(row, col.key).date() if isinstance(getattr(row, col.key), datetime) else None
            if d and d in buckets:
                buckets[d] += 1

    _count(Encounter, Encounter.visited_at)
    _count(Appointment, Appointment.scheduled_for)
    return [DailyCount(date=d.isoformat(), count=buckets[d]) for d in sorted(buckets)]


def _stockout_alerts(db: Session, facility_ids: list[str] | None = None) -> list[StockoutAlert]:
    alerts: list[StockoutAlert] = []
    q = db.query(Inventory).filter(Inventory.stock_units <= Inventory.reorder_level)
    if facility_ids:
        q = q.filter(Inventory.facility_id.in_(facility_ids))
    for inv in q.order_by(Inventory.stock_units.asc()).all():
        med = db.get(Medicine, inv.medicine_id)
        fac = db.get(Facility, inv.facility_id)
        alerts.append(StockoutAlert(
            medicine_id=inv.medicine_id,
            medicine_name=(med.brand_name or med.generic_name) if med else "?",
            generic_name=med.generic_name if med else "?",
            category=med.category if med else None,
            is_critical=bool(med and med.is_critical),
            facility_id=inv.facility_id,
            facility_name=fac.name if fac else "?",
            hfr_id=fac.hfr_id if fac else "?",
            stock_units=inv.stock_units,
            reorder_level=inv.reorder_level,
        ))
    alerts.sort(key=lambda a: (not a.is_critical, a.stock_units))
    return alerts


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min)
    return start, start + timedelta(days=1)


@router.get("/dashboard/summary")
def dashboard_summary(db: Session = Depends(get_db)):
    """District-level summary: referral funnel, TAT by facility, stock-outs."""
    counts = {stage: 0 for stage in FUNNEL_STAGES}
    for status, n in db.query(Referral.status, func.count()).group_by(Referral.status):
        if status in counts:
            counts[status] = n
    funnel = [FunnelStage(stage=s, count=counts[s]) for s in FUNNEL_STAGES]

    done = (
        db.query(Encounter)
        .filter(Encounter.diagnostic_ordered_at.isnot(None),
                Encounter.diagnostic_result_at.isnot(None))
        .all()
    )
    tats: dict[str, list[float]] = {}
    for enc in done:
        tat = enc.tat_seconds
        if tat is not None:
            tats.setdefault(enc.facility_id, []).append(float(tat))

    tat_by_facility: list[FacilityTAT] = []
    for fac_id, values in tats.items():
        fac = db.get(Facility, fac_id)
        tat_by_facility.append(FacilityTAT(
            facility_id=fac_id,
            facility_name=fac.name if fac else "?",
            hfr_id=fac.hfr_id if fac else "?",
            avg_tat_seconds=round(sum(values) / len(values), 1),
            samples=len(values),
        ))
    tat_by_facility.sort(key=lambda x: x.avg_tat_seconds or 0)

    queued = db.query(PendingMessage).filter(PendingMessage.status == "queued").count()
    return {
        "funnel": funnel,
        "tat_by_facility": tat_by_facility,
        "stockout_alerts": _stockout_alerts(db),
        "queued_messages": queued,
        "generated_at": utcnow(),
    }


def _latest_triage_color(db: Session, enc: Encounter) -> str | None:
    by_encounter = (
        db.query(TriageRecord)
        .filter(TriageRecord.encounter_id == enc.id)
        .order_by(TriageRecord.assessed_at.desc())
        .first()
    )
    triage = by_encounter or (
        db.query(TriageRecord)
        .filter(TriageRecord.patient_id == enc.patient_id)
        .order_by(TriageRecord.assessed_at.desc())
        .first()
    )
    return triage.color if triage else None


@router.get("/dashboard/phc", response_model=PHCDashboard)
def phc_dashboard(facility_id: str, db: Session = Depends(get_db)):
    """Live board for one PHC / facility."""
    facility = db.get(Facility, facility_id)
    if not facility:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Facility not found")

    start, end = _day_bounds(date.today())
    since_48h = utcnow() - timedelta(hours=48)

    opd_today = (
        db.query(Appointment)
        .filter(Appointment.facility_id == facility_id,
                Appointment.scheduled_for >= start,
                Appointment.scheduled_for < end)
        .count()
    )
    waiting_appointments = (
        db.query(Appointment)
        .filter(Appointment.facility_id == facility_id,
                Appointment.status == "waiting")
        .count()
    )
    open_encounters = (
        db.query(Encounter)
        .filter(Encounter.facility_id == facility_id,
                Encounter.status == "open",
                Encounter.visited_at >= since_48h)
        .all()
    )
    red_cases = sum(
        1 for enc in open_encounters if _latest_triage_color(db, enc) == "RED"
    )
    pending_referrals = (
        db.query(Referral)
        .filter(Referral.from_facility_id == facility_id,
                Referral.status.in_(["created", "sent"]))
        .count()
    )
    pending_lab_orders = (
        db.query(LabOrder)
        .filter(LabOrder.facility_id == facility_id,
                LabOrder.status != "report_ready")
        .count()
    )
    followups_due_today = (
        db.query(FollowUpTask)
        .filter(FollowUpTask.facility_id == facility_id,
                FollowUpTask.status == "pending",
                FollowUpTask.due_date <= date.today())
        .count()
    )
    stockouts = (
        db.query(Inventory)
        .filter(Inventory.facility_id == facility_id,
                Inventory.stock_units <= Inventory.reorder_level)
        .count()
    )
    queued_messages = db.query(PendingMessage).filter(PendingMessage.status == "queued").count()

    return PHCDashboard(
        facility_id=facility.id,
        facility_name=facility.name,
        opd_today=opd_today,
        in_queue=len(open_encounters),
        waiting_appointments=waiting_appointments,
        red_cases=red_cases,
        pending_referrals=pending_referrals,
        pending_lab_orders=pending_lab_orders,
        followups_due_today=followups_due_today,
        stockouts=stockouts,
        queued_messages=queued_messages,
        weekly_opd=_weekly_opd(db, [facility_id]),
        generated_at=utcnow(),
    )


@router.get("/dashboard/district", response_model=DistrictDashboard)
def district_dashboard(
    district: str = "Barabanki",
    facility_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
):
    """Block/District roll-up with a facility performance table.

    Filters: district (default Barabanki), facility_type ('' = all), and a
    date range for the volume metrics (defaults to the last 7 days).
    """
    if date_to and date_from and date_to < date_from:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="date_to must be >= date_from")

    end_day = date_to or date.today()
    start_day = date_from or (end_day - timedelta(days=6))
    start = _day_bounds(start_day)[0]
    end = _day_bounds(end_day + timedelta(days=1))[1]

    fac_query = db.query(Facility)
    if district:
        fac_query = fac_query.filter(Facility.district == district)
    if facility_type:
        fac_query = fac_query.filter(Facility.facility_type == facility_type)
    facilities = fac_query.order_by(Facility.name).all()
    fac_ids = [f.id for f in facilities]

    rows: list[FacilityPerformance] = []
    weekly: dict[date, int] = {}
    for f in facilities:
        enc_count = (
            db.query(Encounter)
            .filter(Encounter.facility_id == f.id,
                    Encounter.visited_at >= start, Encounter.visited_at < end)
            .count()
        )
        appt_rows = (
            db.query(Appointment)
            .filter(Appointment.facility_id == f.id,
                    Appointment.scheduled_for >= start,
                    Appointment.scheduled_for < end)
            .all()
        )
        appt_count = len(appt_rows)
        for a in appt_rows:
            d = a.scheduled_for.date()
            weekly[d] = weekly.get(d, 0) + 1

        all_enc = (
            db.query(Encounter)
            .filter(Encounter.facility_id == f.id,
                    Encounter.visited_at >= start, Encounter.visited_at < end)
            .all()
        )
        for e in all_enc:
            d = e.visited_at.date()
            weekly[d] = weekly.get(d, 0) + 1

        refs = db.query(Referral).filter(Referral.from_facility_id == f.id).all()
        done_refs = sum(1 for r in refs if r.status == "completed")

        fus = db.query(FollowUpTask).filter(FollowUpTask.facility_id == f.id).all()
        fu_done = sum(1 for t in fus if t.status == "completed")
        fu_open = sum(1 for t in fus if t.status in ("pending", "missed"))

        ready = (
            db.query(LabOrder)
            .filter(LabOrder.facility_id == f.id, LabOrder.status == "report_ready")
            .all()
        )
        tat_vals = [o.tat_seconds for o in ready if o.tat_seconds is not None]

        pending_lab = (
            db.query(LabOrder)
            .filter(LabOrder.facility_id == f.id, LabOrder.status != "report_ready")
            .count()
        )
        stockouts = (
            db.query(Inventory)
            .filter(Inventory.facility_id == f.id,
                    Inventory.stock_units <= Inventory.reorder_level)
            .count()
        )

        rows.append(FacilityPerformance(
            facility_id=f.id,
            facility_name=f.name,
            hfr_id=f.hfr_id,
            facility_type=f.facility_type,
            district=f.district,
            opd_7d=enc_count + appt_count,
            appointments_7d=appt_count,
            referrals=len(refs),
            referral_completion_pct=round(100 * done_refs / len(refs), 1) if refs else None,
            followups_due=fu_open,
            followup_compliance_pct=round(100 * fu_done / (fu_done + fu_open), 1)
            if (fu_done + fu_open) else None,
            avg_tat_minutes=round(sum(tat_vals) / len(tat_vals) / 60, 1) if tat_vals else None,
            stockouts=stockouts,
            pending_lab=pending_lab,
        ))

    rows.sort(key=lambda r: (-(r.followup_compliance_pct or 0), r.facility_name))

    total_patients = db.query(Patient).count()
    funnel = _funnel(db, db.query(Referral).filter(Referral.from_facility_id.in_(fac_ids)))
    fu_counts = {s: 0 for s in ("pending", "completed", "missed")}
    for t in db.query(FollowUpTask).all():
        if t.status in fu_counts:
            fu_counts[t.status] += 1
    followup_status = [FunnelStage(stage=s, count=fu_counts[s]) for s in fu_counts]

    all_ready = [o for f in facilities
                 for o in db.query(LabOrder)
                 .filter(LabOrder.facility_id == f.id, LabOrder.status == "report_ready").all()
                 if o.tat_seconds is not None]
    all_fus = db.query(FollowUpTask).all()
    all_done = sum(1 for t in all_fus if t.status == "completed")
    all_refs = db.query(Referral).filter(Referral.from_facility_id.in_(fac_ids)).all()
    all_ref_done = sum(1 for r in all_refs if r.status == "completed")

    week_series: list[DailyCount] = []
    cursor = start_day
    while cursor <= end_day:
        week_series.append(DailyCount(date=cursor.isoformat(), count=weekly.get(cursor, 0)))
        cursor += timedelta(days=1)

    return DistrictDashboard(
        district=district,
        facility_type=facility_type,
        total_facilities=len(facilities),
        total_patients=total_patients,
        opd_7d=sum(r.opd_7d for r in rows),
        referrals=len(all_refs),
        referral_completion_pct=round(100 * all_ref_done / len(all_refs), 1) if all_refs else None,
        followups_total=len(all_fus),
        followups_completed=all_done,
        followup_compliance_pct=round(100 * all_done / len(all_fus), 1) if all_fus else None,
        avg_tat_minutes=round(sum(all_ready) / len(all_ready) / 60, 1) if all_ready else None,
        stockouts_total=sum(r.stockouts for r in rows),
        pending_messages=db.query(PendingMessage).filter(PendingMessage.status == "queued").count(),
        funnel=funnel,
        followup_status=followup_status,
        weekly_opd=week_series,
        facilities=rows,
        generated_at=utcnow(),
    )
