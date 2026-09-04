"""Pydantic request/response models (v2).

Kept independent of the ORM models. Response schemas use from_attributes=True
so ORM rows can be returned directly by FastAPI.
"""

from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Triage
# ---------------------------------------------------------------------------
class TriageRequest(BaseModel):
    patient_id: Optional[str] = None
    abha_id: Optional[str] = None  # alternative to patient_id (offline PWA flow)
    facility_id: Optional[str] = None
    encounter_id: Optional[str] = None
    symptoms: Dict[str, bool] = Field(default_factory=dict)  # {"chest_pain": True, ...}
    vitals: Dict[str, Any] = Field(default_factory=dict)  # {"pulse": 118, "spo2": 91, ...}
    assessed_by: str = "asha_worker"
    client_id: Optional[str] = None  # idempotency key from the offline PWA
    assessed_at: Optional[datetime] = None


class TriageResponse(BaseModel):
    id: str
    patient_id: Optional[str] = None
    abha_id: Optional[str] = None
    color: str  # RED | YELLOW | GREEN
    score: int
    reasons: List[str] = Field(default_factory=list)
    recommendation: Optional[str] = None
    assessed_at: datetime


# ---------------------------------------------------------------------------
# Offline sync
# ---------------------------------------------------------------------------
class SyncRecord(BaseModel):
    """One record produced on the ASHA worker's device while offline."""

    type: Literal["patient", "encounter", "triage", "referral", "followup", "teleconsult"]
    data: Dict[str, Any] = Field(default_factory=dict)
    client_id: str
    updated_at: datetime
    facility_id: Optional[str] = None
    device_id: Optional[str] = None


class SyncRequest(BaseModel):
    records: List[SyncRecord] = Field(default_factory=list)
    device_id: Optional[str] = None


class SyncRecordResult(BaseModel):
    client_id: str
    type: str
    status: Literal["created", "updated", "conflict_resolved", "duplicate", "skipped"]
    detail: str
    server_id: Optional[str] = None


class SyncResponse(BaseModel):
    synced_at: str
    results: List[SyncRecordResult] = Field(default_factory=list)
    counts: Dict[str, int] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Patients
# ---------------------------------------------------------------------------
class PatientCreate(BaseModel):
    abha_id: str = Field(..., min_length=14, max_length=14, description="14-digit ABHA ID")
    name: str
    dob: date
    gender: str
    phone: Optional[str] = None
    village: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    family_id: Optional[str] = None
    blood_group: Optional[str] = None
    allergies: Optional[List[str]] = None
    high_risk_category: Optional[List[str]] = None
    chronic_conditions: Optional[str] = None
    client_id: Optional[str] = None


class PatientUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    village: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    family_id: Optional[str] = None
    blood_group: Optional[str] = None
    allergies: Optional[List[str]] = None
    high_risk_category: Optional[List[str]] = None
    chronic_conditions: Optional[str] = None


class PatientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    abha_id: str
    name: str
    dob: date
    gender: str
    phone: Optional[str] = None
    village: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    family_id: Optional[str] = None
    blood_group: Optional[str] = None
    allergies: Optional[List[str]] = None
    high_risk_category: Optional[List[str]] = None
    chronic_conditions: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Facilities
# ---------------------------------------------------------------------------
class FacilityCreate(BaseModel):
    hfr_id: str
    name: str
    facility_type: str = "phc"
    address: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    contact_phone: Optional[str] = None


class FacilityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    hfr_id: str
    name: str
    facility_type: str
    address: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    contact_phone: Optional[str] = None


# ---------------------------------------------------------------------------
# Referrals
# ---------------------------------------------------------------------------
ReferralEvent = Literal["send", "accept", "reject", "complete", "no_show"]


class ReferralCreate(BaseModel):
    patient_id: str
    from_facility_id: str
    to_facility_id: str
    reason: Optional[str] = None
    priority: str = "routine"  # routine | urgent | emergency
    asha_phone: Optional[str] = None


class ReferralTrackRequest(BaseModel):
    referral_id: str
    event: ReferralEvent
    notes: Optional[str] = None


class ReferralOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    patient_id: str
    patient_name: Optional[str] = None
    from_facility_id: str
    from_facility_name: Optional[str] = None
    to_facility_id: str
    to_facility_name: Optional[str] = None
    reason: Optional[str] = None
    priority: str
    status: str
    notes: Optional[str] = None
    asha_phone: Optional[str] = None
    created_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    no_show_at: Optional[datetime] = None
    rejected_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Inventory / Medicines
# ---------------------------------------------------------------------------
class MedicineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    generic_name: str
    brand_name: Optional[str] = None
    category: Optional[str] = None
    is_critical: bool


class InventoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    medicine_id: str
    medicine_name: Optional[str] = None
    generic_name: Optional[str] = None
    is_critical: Optional[bool] = None
    facility_id: str
    facility_name: Optional[str] = None
    hfr_id: Optional[str] = None
    stock_units: int
    reorder_level: int
    is_low: bool
    is_out_of_stock: bool


class InventoryPatch(BaseModel):
    stock_units: Optional[int] = None
    reorder_level: Optional[int] = None


class NearbyStock(BaseModel):
    facility_id: str
    facility_name: str
    hfr_id: str
    facility_type: str
    stock_units: int
    distance_km: Optional[float] = None
    is_critical: Optional[bool] = None


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------
class MessageCreate(BaseModel):
    patient_id: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_phone: str
    message_text: str
    channel: str = "sms"


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    patient_id: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_phone: str
    message_text: str
    channel: str
    status: str
    error: Optional[str] = None
    created_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None


class DispatchResult(BaseModel):
    scanned: int
    sent: int
    failed: int
    sent_ids: List[str] = Field(default_factory=list)
    log: List[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Doctor portal
# ---------------------------------------------------------------------------
class QueueItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    encounter_id: str
    patient_id: str
    patient_name: str
    abha_id: str
    age: Optional[int] = None
    gender: Optional[str] = None
    triage_color: Optional[str] = None
    triage_score: Optional[int] = None
    triage_reasons: List[str] = Field(default_factory=list)
    chief_complaint: Optional[str] = None
    visited_at: Optional[datetime] = None
    facility_id: Optional[str] = None


class TimelineItem(BaseModel):
    kind: str  # encounter | triage | referral | prescription
    title: str
    detail: Optional[str] = None
    facility: Optional[str] = None
    status: Optional[str] = None
    occurred_at: Optional[datetime] = None


class PrescriptionCreate(BaseModel):
    patient_id: str
    facility_id: str
    doctor_name: Optional[str] = None
    items: List[Dict[str, Any]] = Field(default_factory=list)
    follow_up_at: Optional[datetime] = None


class PrescriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    patient_id: str
    facility_id: str
    doctor_name: Optional[str] = None
    items: List[Dict[str, Any]] = Field(default_factory=list)
    follow_up_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Admin dashboard
# ---------------------------------------------------------------------------
class FunnelStage(BaseModel):
    stage: str  # created | sent | accepted | completed | no_show
    count: int


class FacilityTAT(BaseModel):
    facility_id: str
    facility_name: str
    hfr_id: str
    avg_tat_seconds: Optional[float] = None
    samples: int


class StockoutAlert(BaseModel):
    medicine_id: str
    medicine_name: str
    generic_name: str
    category: Optional[str] = None
    is_critical: bool
    facility_id: str
    facility_name: str
    hfr_id: str
    stock_units: int
    reorder_level: int


class DashboardSummary(BaseModel):
    funnel: List[FunnelStage] = Field(default_factory=list)
    tat_by_facility: List[FacilityTAT] = Field(default_factory=list)
    stockout_alerts: List[StockoutAlert] = Field(default_factory=list)
    queued_messages: int = 0
    generated_at: datetime


# ---------------------------------------------------------------------------
# Appointments / OPD queue
# ---------------------------------------------------------------------------
class AppointmentCreate(BaseModel):
    patient_id: str
    facility_id: str
    scheduled_for: Optional[datetime] = None
    priority: str = "routine"  # routine | urgent | emergency | pregnant_woman | child | elderly
    reason: Optional[str] = None


class AppointmentPatch(BaseModel):
    status: Optional[str] = None  # waiting | in_consultation | completed | no_show
    priority: Optional[str] = None


class AppointmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    patient_id: str
    patient_name: Optional[str] = None
    abha_id: Optional[str] = None
    facility_id: str
    facility_name: Optional[str] = None
    scheduled_for: Optional[datetime] = None
    token: int
    priority: str
    reason: Optional[str] = None
    status: str
    est_wait_min: Optional[int] = None  # computed on list
    created_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Follow-up tasks
# ---------------------------------------------------------------------------
class FollowUpCreate(BaseModel):
    patient_id: str
    facility_id: Optional[str] = None
    category: str = "elderly"
    task: Optional[str] = None
    due_date: date
    assigned_to: Optional[str] = None
    priority: str = "routine"
    notes: Optional[str] = None


class FollowUpPatch(BaseModel):
    status: Optional[str] = None  # pending | completed | missed
    due_date: Optional[date] = None
    assigned_to: Optional[str] = None
    notes: Optional[str] = None


class FollowUpOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    patient_id: str
    patient_name: Optional[str] = None
    abha_id: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    village: Optional[str] = None
    patient_phone: Optional[str] = None
    facility_id: Optional[str] = None
    facility_name: Optional[str] = None
    category: str
    task: Optional[str] = None
    due_date: Optional[date] = None
    assigned_to: Optional[str] = None
    priority: str
    status: str
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    bucket: Optional[str] = None  # due_today | upcoming | overdue | completed


# ---------------------------------------------------------------------------
# Lab diagnostics
# ---------------------------------------------------------------------------
class LabTestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    code: str
    name: str
    category: str
    unit: Optional[str] = None
    ref_low: Optional[float] = None
    ref_high: Optional[float] = None
    is_radiology: bool
    ref_display: Optional[str] = None


class LabOrderCreate(BaseModel):
    patient_id: str
    encounter_id: Optional[str] = None
    facility_id: Optional[str] = None
    ordered_by: Optional[str] = None
    tests: List[Dict[str, str]] = Field(default_factory=list)  # [{code, name}]


class LabOrderStatusPatch(BaseModel):
    status: str


class LabResultIn(BaseModel):
    results: List[Dict[str, Any]] = Field(default_factory=list)
    # [{test_code, test_name, value_text?, unit?, flag?, notes?}]
    report_file: Optional[str] = None  # filename uploaded via /upload-report
    report_note: Optional[str] = None


class LabResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    test_code: str
    test_name: str
    value_text: Optional[str] = None
    unit: Optional[str] = None
    flag: Optional[str] = None
    notes: Optional[str] = None
    reported_at: Optional[datetime] = None


class LabOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    patient_id: str
    patient_name: Optional[str] = None
    abha_id: Optional[str] = None
    encounter_id: Optional[str] = None
    facility_id: Optional[str] = None
    facility_name: Optional[str] = None
    ordered_by: Optional[str] = None
    tests: List[Dict[str, str]] = Field(default_factory=list)
    status: str
    ordered_at: Optional[datetime] = None
    sample_collected_at: Optional[datetime] = None
    dispatched_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    processing_at: Optional[datetime] = None
    ready_at: Optional[datetime] = None
    tat_seconds: Optional[int] = None
    results: List[LabResultOut] = Field(default_factory=list)
    report_file: Optional[str] = None


# ---------------------------------------------------------------------------
# Teleconsultation
# ---------------------------------------------------------------------------
class TeleconsultCreate(BaseModel):
    patient_id: str
    encounter_id: Optional[str] = None
    facility_id: Optional[str] = None
    requested_by: Optional[str] = None
    mode: str = "audio"  # video | audio | chat
    reason: Optional[str] = None


class TeleconsultAction(BaseModel):
    action: Literal["accept", "decline", "start", "complete", "cancel"]
    doctor_name: Optional[str] = None


class TeleconsultNotes(BaseModel):
    diagnosis: Optional[str] = None
    advice: Optional[str] = None
    notes: Optional[str] = None


class TeleconsultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    patient_id: str
    patient_name: Optional[str] = None
    abha_id: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    village: Optional[str] = None
    encounter_id: Optional[str] = None
    facility_id: Optional[str] = None
    facility_name: Optional[str] = None
    requested_by: Optional[str] = None
    mode: str
    reason: Optional[str] = None
    status: str
    doctor_name: Optional[str] = None
    diagnosis: Optional[str] = None
    advice: Optional[str] = None
    notes: Optional[str] = None
    requested_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    join_url: Optional[str] = None  # WebRTC room link (same for doctor + ASHA)


# ---------------------------------------------------------------------------
# Consultation / encounter (doctor write-back)
# ---------------------------------------------------------------------------
class EncounterCreate(BaseModel):
    patient_id: str
    facility_id: str
    chief_complaint: Optional[str] = None
    appointment_id: Optional[str] = None  # moves the token to in_consultation


class ConsultationSave(BaseModel):
    diagnosis: Optional[str] = None
    notes: Optional[str] = None
    advice: Optional[str] = None
    status: Optional[str] = None  # open | discharged
    vitals: Optional[Dict[str, Any]] = None  # optional OPD vitals snapshot
    follow_up_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Dashboards (PHC + District)
# ---------------------------------------------------------------------------
class DailyCount(BaseModel):
    date: str
    count: int


class PHCDashboard(BaseModel):
    facility_id: str
    facility_name: str
    opd_today: int
    in_queue: int
    waiting_appointments: int
    red_cases: int
    pending_referrals: int
    pending_lab_orders: int
    followups_due_today: int
    stockouts: int
    queued_messages: int
    weekly_opd: List[DailyCount] = Field(default_factory=list)
    generated_at: datetime


class FacilityPerformance(BaseModel):
    facility_id: str
    facility_name: str
    hfr_id: str
    facility_type: str
    district: Optional[str] = None
    opd_7d: int
    appointments_7d: int
    referrals: int
    referral_completion_pct: Optional[float] = None
    followups_due: int
    followup_compliance_pct: Optional[float] = None
    avg_tat_minutes: Optional[float] = None
    stockouts: int
    pending_lab: int


class DistrictDashboard(BaseModel):
    district: str
    facility_type: Optional[str] = None
    total_facilities: int
    total_patients: int
    opd_7d: int
    referrals: int
    referral_completion_pct: Optional[float] = None
    followups_total: int
    followups_completed: int
    followup_compliance_pct: Optional[float] = None
    avg_tat_minutes: Optional[float] = None
    stockouts_total: int
    pending_messages: int
    funnel: List[FunnelStage] = Field(default_factory=list)
    followup_status: List[FunnelStage] = Field(default_factory=list)
    weekly_opd: List[DailyCount] = Field(default_factory=list)
    facilities: List[FacilityPerformance] = Field(default_factory=list)
    generated_at: datetime