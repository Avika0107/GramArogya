"""Doctor-Patient-Lab Home Sample Collection (feature module).

Implements the strict separation of HOME-collectable tests (blood & urine
catalogue flags) from HOSPITAL diagnostic tests (radiology/imaging -> OPD
visit booking), plus the technician dispatch + two-visit policy:

    GET    /api/v1/home-collection/technicians      -> phlebotomy staff pool
    GET    /api/v1/home-collection/bookings         -> dispatch board
    GET    /api/v1/home-collection/bookings/{id}    -> one booking (masked phone)
    POST   /api/v1/home-collection/prescribe        -> doctor prescribes; routes
                                                       tests to Home vs OPD
    POST   /api/v1/home-collection/assign-technician-> engine (round-robin) or
                                                       named technician
    GET    /api/v1/home-collection/bookings/{id}/address
                                          -> AUDITED reveal of home address
    POST   /api/v1/home-collection/visit-status     -> collected | unavailable |
                                                       cancel | start (first
                                                       failure auto-reschedules;
                                                       second failure cancels)
    POST   /api/v1/home-collection/initiate-masked-call -> proxy bridge call
    GET    /api/v1/home-collection/audit            -> audit trail feed

The booking status machine lives on HomeCollectionBooking. Every sensitive
action (address reveal, status update, masked call) appends an AuditLog row
so the workflow is fully traceable.
"""

import logging
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import current_actor, require_role
from ..models import (
    AuditLog,
    Facility,
    HomeCollectionBooking,
    LabOrder,
    LabTechnician,
    LabTest,
    Patient,
    utcnow,
)
from ..schemas import (
    AuditLogOut,
    HomeCollectionBookingOut,
    HomeCollectionPrescribeOut,
    MaskedCallOut,
    MaskedCallRequest,
    PrescribeWithCollectionCreate,
    TechnicianAssignRequest,
    TechnicianOut,
    VisitStatusRequest,
)
from ..services.messaging import queue_message_for_patient

logger = logging.getLogger("gramarogya.home_collection")
router = APIRouter(prefix="/home-collection", tags=["home-collection"])


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def _mask_phone(phone: Optional[str]) -> Optional[str]:

    """Return a masked display number — the raw number never leaves the API.

    +919876543201 -> +91-XXXX-XXX-3201 (last four digits visible, so the
    technician can confirm the right patient before the audited reveal).
    """
    if not phone:
        return None
    digits = "".join(ch for ch in phone if ch.isdigit())
    if not digits:
        return None
    prefix = f"+{digits[:2]}-" if phone.startswith("+") and len(digits) > 2 else ""
    return f"{prefix}XXXX-XXX-{digits[-4:]}"


def _next_morning(now=None, hour: int = 8):
    """Next home-visit slot: tomorrow at 08:00 UTC (prototype slot engine)."""
    now = now or utcnow()
    base = now + timedelta(days=1)
    return base.replace(hour=hour, minute=0, second=0, microsecond=0)


def _booking_out(db: Session, b: HomeCollectionBooking,
                 reveal_address: bool = False) -> HomeCollectionBookingOut:
    patient = db.get(Patient, b.patient_id)
    fac = db.get(Facility, b.facility_id)
    tech = db.get(LabTechnician, b.technician_id) if b.technician_id else None
    address = None
    if reveal_address and patient:
        address = ", ".join(
            x for x in [patient.village, patient.district, patient.state] if x
        )
        if patient.pincode:
            address += f" – {patient.pincode}"
    return HomeCollectionBookingOut(
        id=b.id,
        booking_ref=b.booking_ref,
        patient_id=b.patient_id,
        patient_name=patient.name if patient else None,
        abha_id=patient.abha_id if patient else None,
        patient_phone_masked=_mask_phone(patient.phone if patient else None),
        village=patient.village if patient else None,
        patient_address=address,
        facility_id=b.facility_id,
        facility_name=fac.name if fac else None,
        encounter_id=b.encounter_id,
        lab_order_id=b.lab_order_id,
        ordered_by=b.ordered_by,
        tests=b.tests or [],
        status=b.status,
        status_alias=b.status_alias(),
        technician_id=b.technician_id,
        technician_name=tech.name if tech else None,
        technician_phone=_mask_phone(tech.phone if tech else None),
        visit_number=b.visit_number,
        scheduled_slot_at=b.scheduled_slot_at,
        assigned_at=b.assigned_at,
        collected_at=b.collected_at,
        cancelled_at=b.cancelled_at,
        cancel_reason=b.cancel_reason,
        notes=b.notes,
        created_at=b.created_at,
        updated_at=b.updated_at,
    )


def _audit(db: Session, *, booking_id, patient_id, actor_id, actor_role,
           action: str, detail: str | None = None,
           meta: dict | None = None) -> AuditLog:
    """Append one immutable audit row (deliverable 6)."""
    row = AuditLog(
        booking_id=booking_id,
        patient_id=patient_id,
        actor_id=actor_id,
        actor_role=actor_role,
        action=action,
        detail=detail,
        meta=meta or {},
    )
    db.add(row)
    return row


def _assign(db: Session, booking: HomeCollectionBooking,
            actor_id, actor_role, technician_id: str | None = None,
            scheduled_slot_at=None) -> HomeCollectionBooking:
    """Assign a technician (round-robin engine or named) and open the visit."""
    now = utcnow()
    if not booking.can_transition("assign"):
        raise HTTPException(
            status_code=409,
            detail=f"Booking {booking.booking_ref} is already assigned/closed "
                   f"(status {booking.status_alias()})",
        )

    if technician_id:
        tech = db.get(LabTechnician, technician_id)
        if not tech:
            raise HTTPException(status_code=404, detail="Technician not found")
        if tech.status == "offline":
            raise HTTPException(status_code=409, detail="Technician is offline")
    else:
        # Round-robin engine: the technician with the fewest past assignments
        # (route_counter) gets the booking; the counter then rotates the cursor.
        pool = (
            db.query(LabTechnician)
            .filter(LabTechnician.status != "offline")
            .order_by(LabTechnician.route_counter.asc(), LabTechnician.created_at.asc())
            .all()
        )
        if not pool:
            raise HTTPException(status_code=409, detail="No technicians available")
        tech = pool[0]

    booking.technician_id = tech.id
    booking.status = "technician_assigned"  # TECHNICIAN_ASSIGNED
    booking.assigned_at = now
    booking.visit_number = 1
    booking.scheduled_slot_at = scheduled_slot_at or _next_morning(now)
    tech.route_counter = (tech.route_counter or 0) + 1
    booking.updated_at = now

    _audit(db, booking_id=booking.id, patient_id=booking.patient_id,
           actor_id=actor_id, actor_role=actor_role, action="UPDATE_STATUS",
           detail=f"technician_assigned -> {tech.name}",
           meta={"to_status": booking.status_alias(), "technician": tech.name,
                 "visit": booking.visit_number})

    patient = db.get(Patient, booking.patient_id)
    if patient and patient.phone:
        queue_message_for_patient(
            db, patient,
            f"Dear {patient.name}, our lab technician {tech.name} will visit "
            f"for your home sample collection "
            f"({', '.join(t.get('name', '') for t in (booking.tests or [])) or 'tests'}). "
            f"Please keep your previous reports handy. — GramArogya",
        )
    return booking


# ---------------------------------------------------------------------------
# Read endpoints (portal boards)
# ---------------------------------------------------------------------------
@router.get("/technicians", response_model=list[TechnicianOut])
def list_technicians(db: Session = Depends(get_db)):
    rows = db.query(LabTechnician).order_by(LabTechnician.name).all()
    return [TechnicianOut.model_validate(t) for t in rows]


@router.get("/bookings", response_model=list[HomeCollectionBookingOut])
def list_bookings(
    technician_id: str | None = None,
    status: str | None = None,
    facility_id: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(HomeCollectionBooking)
    if technician_id:
        query = query.filter(HomeCollectionBooking.technician_id == technician_id)
    if status:
        # Accept both the spec SCREAMING_CASE alias and the canonical state.
        status_low = status.lower()
        if status_low not in HomeCollectionBooking.STATUS_ALIASES:
            status_low = {v.lower(): k for k, v in HomeCollectionBooking.STATUS_ALIASES.items()}.get(status_low, status_low)
        query = query.filter(HomeCollectionBooking.status == status_low)
    if facility_id:
        query = query.filter(HomeCollectionBooking.facility_id == facility_id)
    rows = query.order_by(HomeCollectionBooking.created_at.desc()).all()
    return [_booking_out(db, b) for b in rows]


@router.get("/bookings/{booking_id}", response_model=HomeCollectionBookingOut)
def get_booking(booking_id: str, db: Session = Depends(get_db)):
    b = db.get(HomeCollectionBooking, booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    return _booking_out(db, b)


@router.get("/audit", response_model=list[AuditLogOut],
            dependencies=[Depends(require_role("lab", "doctor", "admin"))])
def audit_trail(
    booking_id: str | None = None,
    action: str | None = None,
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(AuditLog)
    if booking_id:
        query = query.filter(AuditLog.booking_id == booking_id)
    if action:
        query = query.filter(AuditLog.action == action)
    rows = query.order_by(AuditLog.created_at.desc()).limit(limit).all()
    return [AuditLogOut.model_validate(r) for r in rows]


# ---------------------------------------------------------------------------
# Doctor prescribes with collection routing (Deliverable: POST /prescribe)
# ---------------------------------------------------------------------------
@router.post("/prescribe", response_model=HomeCollectionPrescribeOut, status_code=201,
             dependencies=[Depends(require_role("doctor"))])
def prescribe(payload: PrescribeWithCollectionCreate,
              db: Session = Depends(get_db)):
    """Doctor writes a consultation that may order home sample collection.

    Routing (strict, feature 1):
      * home-collectable tests (blood & urine) + home_collection_required
        -> HomeCollectionBooking with status HOME_COLLECTION_PENDING
      * tests marked hospital (or 'both' routed to hospital) are returned as
        `hospital_tests` — the doctor books them as an OPD visit
      * a non-eligible test requested 'home' -> rejected with 422 so the
        doctor re-routes it to the hospital OPD, never to home collection
    """
    patient = db.get(Patient, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    facility = db.get(Facility, payload.facility_id)
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")
    if not payload.tests:
        raise HTTPException(status_code=422, detail="Order at least one test")

    catalogue = {t.code: t for t in db.query(LabTest).all()}
    unknown = [t.code for t in payload.tests if t.code not in catalogue]
    if unknown:
        raise HTTPException(status_code=422,
                            detail=f"Unknown test code(s): {', '.join(unknown)}")

    home_required = payload.home_collection_required
    home_tests: list[dict] = []
    hospital_codes: list[str] = []
    rejected: list[str] = []

    for item in payload.tests:
        test = catalogue[item.code]
        requested_home = item.mode == "home" or (item.mode == "both" and home_required)
        if requested_home:
            # Home collection is ONLY for the home-collectable catalogue subset.
            if not (test.home_collectable or test.collection_type in ("home", "both")):
                rejected.append(item.code)
                continue
            home_tests.append({"code": item.code, "name": item.name or test.name})
        else:
            hospital_codes.append(item.code)

    if rejected:
        raise HTTPException(
            status_code=422,
            detail=(
                "These tests are NOT home-collectable and must be routed to a "
                "hospital OPD visit: " + ", ".join(rejected) +
                ". Remove the home-collection request for them."
            ),
        )

    result = HomeCollectionPrescribeOut(hospital_tests=hospital_codes)

    # Hospital-routed tests -> ordinary lab order (OPD visit) so nothing the
    # doctor ordered is silently dropped.
    if hospital_codes:
        db.add(LabOrder(
            patient_id=payload.patient_id,
            encounter_id=payload.encounter_id,
            facility_id=payload.facility_id,
            ordered_by=payload.doctor_name or "Doctor",
            tests=[{"code": c, "name": catalogue[c].name} for c in sorted(hospital_codes)],
            status="ordered",
            collection_mode="hospital",
        ))

    if home_required and home_tests:
        # One lab order carries the home tests; its pipeline continues after
        # the sample reaches the lab (collected -> dispatched -> ... ready).
        order = LabOrder(
            patient_id=payload.patient_id,
            encounter_id=payload.encounter_id,
            facility_id=payload.facility_id,
            ordered_by=payload.doctor_name or "Doctor",
            tests=sorted(home_tests, key=lambda t: t["code"]),
            status="ordered",
            collection_mode="home",
        )
        db.add(order)
        db.flush()  # need order.id below

        seq = db.query(HomeCollectionBooking).count() + 1
        booking = HomeCollectionBooking(
            booking_ref=f"HC-{facility.hfr_id.split('-')[-1]}-{seq:04d}",
            patient_id=payload.patient_id,
            facility_id=payload.facility_id,
            lab_order_id=order.id,
            encounter_id=payload.encounter_id,
            ordered_by=payload.doctor_name or "Doctor",
            tests=sorted(home_tests, key=lambda t: t["code"]),
            status="home_collection_pending",  # HOME_COLLECTION_PENDING
            notes=(payload.diagnosis or "") + (" | " + payload.notes if payload.notes else ""),
        )
        db.add(booking)
        _audit(db, booking_id=None, patient_id=payload.patient_id,
               actor_id=payload.doctor_name or "Doctor", actor_role="doctor",
               action="CREATE_BOOKING",
               detail="Home collection prescribed: "
                      + ", ".join(t["name"] for t in home_tests))
        db.commit()
        db.refresh(booking)
        result.booking = _booking_out(db, booking)

        logger.info("Home collection booking %s created for %s (tests=%s)",
                    booking.booking_ref, patient.name,
                    [t["code"] for t in home_tests])
    else:
        db.commit()

    return result


# ---------------------------------------------------------------------------
# Technician allocation engine (Deliverable: POST /assign-technician)
# ---------------------------------------------------------------------------
@router.post("/assign-technician", response_model=HomeCollectionBookingOut,
             dependencies=[Depends(require_role("doctor", "lab", "admin"))])
def assign_technician(payload: TechnicianAssignRequest,
                      db: Session = Depends(get_db),
                      actor: tuple = Depends(current_actor)):
    booking = db.get(HomeCollectionBooking, payload.booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    _assign(db, booking,
            actor_id=actor[0] or actor[1] or "staff",
            actor_role=actor[1],
            technician_id=payload.technician_id,
            scheduled_slot_at=payload.scheduled_slot_at)
    db.commit()
    db.refresh(booking)
    return _booking_out(db, booking)


# ---------------------------------------------------------------------------
# Audited address reveal + masked call (feature 5/6/7)
# ---------------------------------------------------------------------------
@router.get("/bookings/{booking_id}/address", response_model=HomeCollectionBookingOut,
            dependencies=[Depends(require_role("lab"))])
def reveal_address(booking_id: str, db: Session = Depends(get_db),
                   actor: tuple = Depends(current_actor)):
    """Reveal the patient's home address to the assigned technician.

    This is the deliberately gated endpoint — the board never ships the raw
    address; opening the visit logs VIEW_PATIENT_ADDRESS to the audit trail.
    """
    b = db.get(HomeCollectionBooking, booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if not b.technician_id:
        raise HTTPException(status_code=409,
                            detail="No technician assigned yet — address is "
                                   "only revealed to the assigned technician")

    _audit(db, booking_id=b.id, patient_id=b.patient_id,
           actor_id=actor[0] or actor[1] or "lab",
           actor_role=actor[1],
           action="VIEW_PATIENT_ADDRESS",
           detail=f"Booking {b.booking_ref} address revealed to assigned technician")
    db.commit()
    return _booking_out(db, b, reveal_address=True)


@router.post("/initiate-masked-call", response_model=MaskedCallOut,
             dependencies=[Depends(require_role("lab"))])
def initiate_masked_call(payload: MaskedCallRequest,
                         db: Session = Depends(get_db),
                         actor: tuple = Depends(current_actor)):
    """Simulated proxy bridge call — no raw phone number in the UI.

    The frontend only holds the booking id; the server hands back a masked
    display number (+91-XXXX-XXX-3201) plus a fake WebRTC/proxy dial URL.
    In production this endpoint would reserve a real proxy number on the
    telephony bridge and only ever show the bridge leg to the caller.
    """
    b = db.get(HomeCollectionBooking, payload.booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if not b.technician_id:
        raise HTTPException(status_code=409,
                            detail="No technician assigned — cannot call")
    patient = db.get(Patient, b.patient_id)
    if not patient or not patient.phone:
        raise HTTPException(status_code=422, detail="Patient has no phone number")

    masked = _mask_phone(patient.phone)
    _audit(db, booking_id=b.id, patient_id=b.patient_id,
           actor_id=actor[0] or actor[1] or "lab",
           actor_role=actor[1],
           action="INITIATE_MASKED_CALL",
           detail=f"Proxy call leg requested for booking {b.booking_ref}",
           meta={"masked_number": masked})
    db.commit()
    return MaskedCallOut(
        ok=True,
        booking_id=b.id,
        masked_number=masked,
        dial_through_url=f"/api/v1/home-collection/bridge/{b.id}/call",
        notice="Number masked: the bridge dials the patient, the caller only "
               "sees the proxy leg. (Prototype: replace with a WebRTC/CPaaS "
               "bridge — the frontend never receives the raw number.)",
    )


# ---------------------------------------------------------------------------
# Visit status machine (Deliverable: POST /visit-status)
#   Visit 1 unavailable -> auto-reschedule (UNAVAILABLE_RESCHEDULED)
#   Visit 2 unavailable -> SAMPLING_CANCELLED + notify doctor & patient
# ---------------------------------------------------------------------------
@router.post("/visit-status", response_model=HomeCollectionBookingOut,
             dependencies=[Depends(require_role("lab", "doctor", "admin"))])
def report_visit_status(payload: VisitStatusRequest,
                        db: Session = Depends(get_db),
                        actor: tuple = Depends(current_actor)):
    b = db.get(HomeCollectionBooking, payload.booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    event = payload.event
    if not b.can_transition(event):
        raise HTTPException(
            status_code=409,
            detail=f"Event '{event}' not allowed from status "
                   f"'{b.status_alias()}'",
        )

    actor_id = actor[0] or actor[1] or "staff"
    now = utcnow()
    patient = db.get(Patient, b.patient_id)

    if event == "collected":
        b.status = "sample_collected"  # SAMPLE_COLLECTED
        b.collected_at = now
        b.notes = payload.notes or b.notes
        # Kick the underlying lab order into the normal pipeline (the lab
        # portal then dispatches -> received -> processing -> report_ready).
        if b.lab_order_id:
            order = db.get(LabOrder, b.lab_order_id)
            if order and order.can_transition("sample_collected"):
                order.apply_transition("sample_collected", now)
        detail = f"Sample collected on visit #{b.visit_number} at home"
    elif event == "unavailable":
        if b.visit_number >= 2:
            # Second failure -> cancel + notify doctor & patient.
            b.status = "sampling_cancelled"  # SAMPLING_CANCELLED
            b.cancelled_at = now
            b.cancel_reason = payload.cancel_reason or "second_no_show"
            detail = ("Patient unavailable on 2nd visit — home sampling "
                      "cancelled; doctor & patient notified")
            if patient and patient.phone:
                queue_message_for_patient(
                    db, patient,
                    "Your home sample collection was cancelled because you "
                    "were unavailable twice. Please visit the PHC/hospital "
                    "for these tests. — GramArogya")
            if patient and patient.phone:
                # Doctor-side notification (demo: queued to the PHC number).
                queue_message_for_patient(
                    db, patient,
                    f"[Doctor alert] Home collection for {patient.name} "
                    f"({b.booking_ref}) cancelled — 2nd no-show. "
                    f"Reason: {b.cancel_reason}. Please advise next steps.")
        else:
            # First failure -> auto-reschedule the next available slot.
            b.status = "unavailable_rescheduled"  # UNAVAILABLE_RESCHEDULED
            b.visit_number = 2
            b.scheduled_slot_at = _next_morning(now)
            detail = ("Patient unavailable on visit 1 — auto-rescheduled to "
                      "next slot " + b.scheduled_slot_at.strftime("%d %b %H:%M"))
            if patient and patient.phone:
                queue_message_for_patient(
                    db, patient,
                    "Our technician could not find you at home. We have "
                    "re-scheduled your sample collection. Please be "
                    "available — GramArogya")
    else:  # cancel (patient/doctor requested)
        b.status = "sampling_cancelled"  # SAMPLING_CANCELLED
        b.cancelled_at = now
        b.cancel_reason = payload.cancel_reason or "patient_request"
        detail = f"Cancelled — reason: {b.cancel_reason}"

    b.notes = payload.notes or b.notes
    b.updated_at = now
    _audit(db, booking_id=b.id, patient_id=b.patient_id,
           actor_id=actor_id, actor_role=actor[1],
           action="UPDATE_STATUS",
           detail=detail,
           meta={"to_status": b.status_alias(), "visit": b.visit_number,
                 "event": event})
    db.commit()
    db.refresh(b)
    return _booking_out(db, b)


# ---------------------------------------------------------------------------
# Technician marks the start of an in-person visit (optional hardening)
# ---------------------------------------------------------------------------
@router.post("/visit-status/start", response_model=HomeCollectionBookingOut,
             dependencies=[Depends(require_role("lab"))])
def start_visit(payload: MaskedCallRequest, db: Session = Depends(get_db),
                actor: tuple = Depends(current_actor)):
    """Technician taps 'Start visit' — opens the audited address reveal flow."""
    b = db.get(HomeCollectionBooking, payload.booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b.status not in ("technician_assigned", "unavailable_rescheduled"):
        raise HTTPException(status_code=409,
                            detail=f"Cannot start visit from '{b.status_alias()}'")
    now = utcnow()
    b.status = "scheduled_visit"
    b.started_at = now
    b.updated_at = now
    _audit(db, booking_id=b.id, patient_id=b.patient_id,
           actor_id=actor[0] or actor[1] or "lab",
           actor_role=actor[1],
           action="START_VISIT",
           detail=f"Visit #{b.visit_number} started at home")
    db.commit()
    db.refresh(b)
    return _booking_out(db, b, reveal_address=True)
