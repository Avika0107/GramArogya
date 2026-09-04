"""OPD Queue Manager helpers: GA-... token labels + doctor availability gate.

Token format (spec):  GA-<FACILITY>-<DEPT>-<YYYYMMDD>-<COUNTER_ID>-<SEQ>
    e.g.              GA-SKH-GMED-20260905-WEB01-000123

  * FACILITY  -> short uppercase code derived from the facility name initials
                 (e.g. "PHC Sanda (Primary Health Centre)" -> "PS"), falling
                 back to HFR-id digits when the name has no letters.
  * DEPT      -> department code, default "GMED" (general medicine).
  * COUNTER   -> issuing counter/device, e.g. "WEB01" (web portal) or "KIO01"
                 (self-service kiosk).
  * SEQ       -> 6-digit zero-padded sequence per facility+department+day.

Doctor availability gate: if the facility's DoctorStatus is 'offline', token
generation is disabled (HTTP 409) everywhere — web portal and kiosk alike.
"""

import re
from datetime import datetime, time, timedelta
from typing import Optional, Tuple

from sqlalchemy import or_

from ..models import Appointment, DoctorStatus, Facility


def facility_code(facility: Facility) -> str:
    """Short uppercase facility code for the token (initials of the name,
    ignoring parenthetical suffixes). Falls back to HFR-id digits."""
    name = (facility.name or "").split("(")[0]
    letters = re.sub(r"[^A-Za-z ]", " ", name)
    initials = "".join(w[0] for w in letters.split() if w)
    if initials:
        return initials[:3].upper()
    digits = re.sub(r"[^0-9]", "", facility.hfr_id or "")
    return digits[-3:] or "FAC"


def build_token_label(fac_code: str, department: str, when: datetime,
                      counter: str, seq: int) -> str:
    """GA-<FAC>-<DEPT>-<YYYYMMDD>-<COUNTER>-<SEQ> with a zero-padded seq."""
    dept = (department or "GMED").strip().upper() or "GMED"
    return f"GA-{fac_code}-{dept}-{when:%Y%m%d}-{counter}-{seq:06d}"


def day_bounds(when: datetime) -> Tuple[datetime, datetime]:
    """Start/end of the calendar day containing `when` (UTC-naive safe)."""
    day = when.date()
    start = datetime.combine(day, time.min)
    return start, start + timedelta(days=1)


def next_token_seq(db, facility_id: str, department: Optional[str],
                   when: datetime) -> int:
    """Next per-day sequence number for this facility + department."""
    start, end = day_bounds(when)
    dept = (department or "GMED")
    query = (
        db.query(Appointment)
        .filter(Appointment.facility_id == facility_id,
                Appointment.scheduled_for >= start,
                Appointment.scheduled_for < end)
    )
    if dept == "GMED":
        # Legacy rows created before the department column existed (or seeded
        # without one) have NULL, which historically meant the default GMED
        # department — count them in so new tokens continue the sequence
        # instead of restarting at #1.
        query = query.filter(or_(Appointment.department == "GMED",
                                 Appointment.department.is_(None)))
    else:
        query = query.filter(Appointment.department == dept)
    existing = query.all()
    return max([a.token for a in existing] or [0]) + 1


def get_doctor_status(db, facility_id: str) -> DoctorStatus:
    """Live doctor status for a facility (defaults to 'available')."""
    row = db.query(DoctorStatus).filter(DoctorStatus.facility_id == facility_id).first()
    if not row:
        row = DoctorStatus(facility_id=facility_id, status="available")
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def doctor_available(db, facility_id: str) -> bool:
    """False only when the doctor is explicitly 🔴 OFFLINE."""
    row = db.query(DoctorStatus).filter(DoctorStatus.facility_id == facility_id).first()
    return row is None or row.status != "offline"