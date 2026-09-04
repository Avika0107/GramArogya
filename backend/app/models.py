"""SQLAlchemy ORM models.

Mirrors backend/schema.sql (the canonical PostgreSQL DDL). The same models run
on SQLite for zero-setup demos. Type shapes are loosely FHIR-inspired.

Conventions:
  * UUID primary keys are Python-generated uuid4 strings (portable across
    PostgreSQL and SQLite).
  * All timestamps are stored as UTC.
  * JSON columns hold structured FHIR-ish payloads (symptoms, vitals, ...).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def gen_uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    """UTC now. Naive on SQLite, aware on PostgreSQL — both fine in practice."""
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Patient(Base):
    """FHIR-ish Patient resource."""

    __tablename__ = "patients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    abha_id: Mapped[str] = mapped_column(String(14), unique=True, index=True)  # 14-digit ABHA
    name: Mapped[str] = mapped_column(String(120))
    dob: Mapped[date] = mapped_column(Date)
    gender: Mapped[str] = mapped_column(String(10))
    phone: Mapped[Optional[str]] = mapped_column(String(15), nullable=True)
    village: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    district: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    pincode: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    family_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)  # optional family/ration-card linkage
    blood_group: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    allergies: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)  # ["penicillin"]
    # high_risk_category: multi-select flags, e.g. ["pregnant","diabetic","hypertension","elderly","chronic"]
    high_risk_category: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    chronic_conditions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # free text, e.g. "TB, asthma"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    # client_id = offline PWA record id, guarantees idempotent syncs
    client_id: Mapped[Optional[str]] = mapped_column(String(36), unique=True, nullable=True)


class Facility(Base):
    """Health facility registered in the (mock) Health Facility Registry."""

    __tablename__ = "facilities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    hfr_id: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # e.g. HFR09-200012
    name: Mapped[str] = mapped_column(String(160))
    facility_type: Mapped[str] = mapped_column(String(30), default="phc")
    address: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    district: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(15), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Encounter(Base):
    """FHIR-ish Encounter — one row per facility visit."""

    __tablename__ = "encounters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    facility_id: Mapped[str] = mapped_column(ForeignKey("facilities.id"), index=True)
    visited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    chief_complaint: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    diagnosis: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | discharged
    diagnostic_ordered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    diagnostic_result_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    client_id: Mapped[Optional[str]] = mapped_column(String(36), unique=True, nullable=True)

    @property
    def tat_seconds(self) -> Optional[int]:
        """Diagnostic turnaround time (seconds) — drives the admin TAT chart."""
        if self.diagnostic_ordered_at and self.diagnostic_result_at:
            delta = self.diagnostic_result_at - self.diagnostic_ordered_at
            return int(delta.total_seconds())
        return None


class TriageRecord(Base):
    """FHIR-ish Observation — result of the digital triage calculator."""

    __tablename__ = "triage_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    patient_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("patients.id", ondelete="SET NULL"), nullable=True, index=True
    )
    facility_id: Mapped[Optional[str]] = mapped_column(ForeignKey("facilities.id"), nullable=True)
    encounter_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("encounters.id", ondelete="SET NULL"), nullable=True
    )
    symptoms: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    vitals: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    color: Mapped[str] = mapped_column(String(10))  # RED | YELLOW | GREEN
    score: Mapped[int] = mapped_column(Integer)
    reasons: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    recommendation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    assessed_by: Mapped[str] = mapped_column(String(60), default="asha_worker")
    assessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    client_id: Mapped[Optional[str]] = mapped_column(String(36), unique=True, nullable=True)


class Referral(Base):
    """Closed-loop referral with an explicit state machine.

    created -> sent -> accepted -> completed
                         |          |
                         v          v
                     rejected    no_show
    """

    __tablename__ = "referrals"

    # Maps current status -> allowed EVENT names (send | accept | reject |
    # complete | no_show), not the resulting statuses.
    ALLOWED_TRANSITIONS: dict[str, set[str]] = {
        "created": {"send"},
        "sent": {"accept", "reject"},
        "accepted": {"complete", "no_show"},
        "completed": set(),
        "no_show": {"send"},  # allow re-referral after a no-show
        "rejected": {"send"},
    }

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    from_facility_id: Mapped[str] = mapped_column(ForeignKey("facilities.id"))
    to_facility_id: Mapped[str] = mapped_column(ForeignKey("facilities.id"))
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    priority: Mapped[str] = mapped_column(String(10), default="routine")  # routine | urgent | emergency
    status: Mapped[str] = mapped_column(String(15), default="created", index=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # asha_phone: the ASHA worker who created the referral — gets SMS alerts
    # when the receiving facility accepts / rejects / reports no-show.
    asha_phone: Mapped[Optional[str]] = mapped_column(String(15), nullable=True)
    client_id: Mapped[Optional[str]] = mapped_column(String(36), unique=True, nullable=True)  # offline sync idempotency
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    no_show_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    def can_transition(self, event: str) -> bool:
        """True if `event` is a legal next step from the current status."""
        return event in self.ALLOWED_TRANSITIONS.get(self.status, set())

    def apply_transition(self, event: str, when: Optional[datetime] = None) -> None:
        """Apply a legal transition, stamping the corresponding timestamp."""
        now = when or utcnow()
        if event == "send":
            self.status, self.sent_at = "sent", now
        elif event == "accept":
            self.status, self.accepted_at = "accepted", now
        elif event == "reject":
            self.status, self.rejected_at = "rejected", now
        elif event == "complete":
            self.status, self.completed_at = "completed", now
        elif event == "no_show":
            self.status, self.no_show_at = "no_show", now
        self.updated_at = now


class Medicine(Base):
    """FHIR-ish Medication master list."""

    __tablename__ = "medicines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    generic_name: Mapped[str] = mapped_column(String(160), unique=True)
    brand_name: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)  # antidote | maternal | essential
    is_critical: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Inventory(Base):
    """Stock level of one medicine at one facility (HFR ID)."""

    __tablename__ = "inventory"
    __table_args__ = (UniqueConstraint("medicine_id", "facility_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    medicine_id: Mapped[str] = mapped_column(ForeignKey("medicines.id", ondelete="CASCADE"))
    facility_id: Mapped[str] = mapped_column(ForeignKey("facilities.id", ondelete="CASCADE"), index=True)
    stock_units: Mapped[int] = mapped_column(Integer, default=0)
    reorder_level: Mapped[int] = mapped_column(Integer, default=10)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    @property
    def is_low(self) -> bool:
        return self.stock_units <= self.reorder_level

    @property
    def is_out_of_stock(self) -> bool:
        return self.stock_units <= 0


class Prescription(Base):
    """FHIR-ish MedicationRequest."""

    __tablename__ = "prescriptions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    facility_id: Mapped[str] = mapped_column(ForeignKey("facilities.id"))
    doctor_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    items: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    follow_up_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Appointment(Base):
    """OPD appointment + token queue entry (Feature 3).

    A per-day sequence number (`token`) is assigned automatically per
    facility + department + calendar day (1, 2, 3, ... in order of booking);
    the human-readable GA-... label is stored in `token_label`. status drives
    the OPD queue board: waiting -> in_consultation -> completed | no_show.
    """

    __tablename__ = "appointments"

    PRIORITY_TAGS = ["routine", "urgent", "emergency", "pregnant_woman", "child", "elderly"]
    STATUSES = ["waiting", "in_consultation", "completed", "no_show"]

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    facility_id: Mapped[str] = mapped_column(ForeignKey("facilities.id"), index=True)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    token: Mapped[int] = mapped_column(Integer, default=1)  # per-day sequence number
    token_label: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)  # GA-FAC-DEPT-YYYYMMDD-COUNTER-SEQ
    department: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, default="GMED")
    priority: Mapped[str] = mapped_column(String(20), default="routine")  # routine|urgent|emergency|pregnant_woman|child|elderly
    reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(15), default="waiting", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class DoctorStatus(Base):
    """Live doctor availability per facility (OPD Queue Manager).

    Drives token generation: when status is 'offline', the portal and kiosk
    refuse to issue new tokens. Defaults to 'available' when no row exists
    (demo-friendly — booking keeps working on a fresh database).
    """

    __tablename__ = "doctor_status"

    STATUSES = ["available", "busy", "on_break", "offline"]

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    facility_id: Mapped[str] = mapped_column(ForeignKey("facilities.id"), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(15), default="available")  # available|busy|on_break|offline
    updated_by: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class FollowUpTask(Base):
    """High-risk / programme follow-up task (Feature 10).

    Categories: maternal, child_immunization, diabetes, hypertension, tb,
    elderly. Tasks roll up to the ASHA daily list (by assigned_to) and to the
    doctor/admin dashboards (completion rate, due today / overdue lists).
    """

    __tablename__ = "follow_up_tasks"

    CATEGORIES = ["maternal", "child_immunization", "diabetes", "hypertension", "tb", "elderly"]
    STATUSES = ["pending", "completed", "missed"]

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    facility_id: Mapped[Optional[str]] = mapped_column(ForeignKey("facilities.id"), nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(30), default="elderly", index=True)
    task: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    due_date: Mapped[date] = mapped_column(Date, index=True)
    assigned_to: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)  # ASHA worker name
    priority: Mapped[str] = mapped_column(String(10), default="routine")  # routine | urgent | emergency
    status: Mapped[str] = mapped_column(String(15), default="pending", index=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    client_id: Mapped[Optional[str]] = mapped_column(String(36), unique=True, nullable=True)  # offline sync idempotency
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class LabTest(Base):
    """Diagnostic test catalogue (Feature 8).

    Reference range (ref_low/ref_high, in `unit`) lets the lab portal flag
    structured numeric results Normal / High / Low / Critical automatically.
    Radiology-type tests carry no numeric range (report text only).
    """

    __tablename__ = "lab_tests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)  # e.g. CBC, HBA1C
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(30), default="biochemistry")  # hematology|biochemistry|microbiology|urine|radiology
    unit: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    ref_low: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ref_high: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ref_critical_low: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ref_critical_high: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_radiology: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LabOrder(Base):
    """Diagnostic order + fulfilment pipeline (Feature 8).

    Status machine:
      ordered -> sample_collected -> dispatched -> received -> processing -> report_ready
    Timestamps at each step; ready_at - ordered_at = diagnostic turnaround time.
    tests = JSON snapshot [{code, name}] of what was ordered.
    """

    __tablename__ = "lab_orders"

    STATUSES = ["ordered", "sample_collected", "dispatched", "received", "processing", "report_ready"]
    ALLOWED_TRANSITIONS: dict[str, set[str]] = {
        "ordered": {"sample_collected"},
        "sample_collected": {"dispatched"},
        "dispatched": {"received"},
        "received": {"processing"},
        "processing": {"report_ready"},
        "report_ready": set(),
    }

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    encounter_id: Mapped[Optional[str]] = mapped_column(ForeignKey("encounters.id", ondelete="SET NULL"), nullable=True)
    facility_id: Mapped[Optional[str]] = mapped_column(ForeignKey("facilities.id"), nullable=True, index=True)
    ordered_by: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)  # doctor name
    tests: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="ordered", index=True)
    ordered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    sample_collected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    dispatched_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    processing_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ready_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    report_file: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # uploaded PDF/image
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    @property
    def tat_seconds(self) -> Optional[int]:
        if self.ready_at and self.ordered_at:
            return int((self.ready_at - self.ordered_at).total_seconds())
        return None

    def can_transition(self, next_status: str) -> bool:
        return next_status in self.ALLOWED_TRANSITIONS.get(self.status, set())

    def apply_transition(self, next_status: str, when: Optional[datetime] = None) -> None:
        now = when or utcnow()
        stamp = {
            "sample_collected": "sample_collected_at",
            "dispatched": "dispatched_at",
            "received": "received_at",
            "processing": "processing_at",
            "report_ready": "ready_at",
        }.get(next_status)
        if stamp:
            setattr(self, stamp, now)
        self.status = next_status
        self.updated_at = now


class LabResult(Base):
    """Structured result entered by the lab technician for one ordered test."""

    __tablename__ = "lab_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    order_id: Mapped[str] = mapped_column(ForeignKey("lab_orders.id", ondelete="CASCADE"), index=True)
    test_code: Mapped[str] = mapped_column(String(30))
    test_name: Mapped[str] = mapped_column(String(120))
    value_text: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)  # numeric or free text (radiology)
    unit: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    flag: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # normal|high|low|critical
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TeleconsultRequest(Base):
    """Assisted teleconsultation (Feature 5).

    ASHA (or PHC staff) requests a consult with mode video | audio | chat
    (audio is the low-bandwidth default). Doctor accepts, "starts the call",
    and on completion saves diagnosis + advice + notes to the patient record.

    Status machine: requested -> accepted -> completed | declined | cancelled.
    """

    __tablename__ = "teleconsult_requests"

    MODES = ["video", "audio", "chat"]
    STATUSES = ["requested", "accepted", "declined", "completed", "cancelled"]
    ALLOWED_TRANSITIONS: dict[str, set[str]] = {
        "requested": {"accepted", "declined", "cancelled"},
        "accepted": {"completed", "cancelled"},
        "declined": set(),
        "completed": set(),
        "cancelled": set(),
    }

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    encounter_id: Mapped[Optional[str]] = mapped_column(ForeignKey("encounters.id", ondelete="SET NULL"), nullable=True)
    facility_id: Mapped[Optional[str]] = mapped_column(ForeignKey("facilities.id"), nullable=True)
    requested_by: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)  # ASHA / staff name
    mode: Mapped[str] = mapped_column(String(10), default="audio")
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # client_id: offline idempotency key from the ASHA device (synced teleconsults)
    client_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True)
    status: Mapped[str] = mapped_column(String(15), default="requested", index=True)
    doctor_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    diagnosis: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    advice: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    def can_transition(self, next_status: str) -> bool:
        return next_status in self.ALLOWED_TRANSITIONS.get(self.status, set())


class PendingMessage(Base):
    """Offline-aware notification queue.

    Every event that must notify a patient/worker writes a row here first —
    nothing is ever sent synchronously. POST /api/v1/messages/dispatch drains
    the queue through the SMS provider abstraction (mock by default).
    """

    __tablename__ = "pending_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    patient_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("patients.id", ondelete="SET NULL"), nullable=True
    )
    recipient_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    recipient_phone: Mapped[str] = mapped_column(String(15))
    message_text: Mapped[str] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(String(10), default="sms")  # sms | app
    status: Mapped[str] = mapped_column(String(10), default="queued", index=True)  # queued | sent | failed
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)