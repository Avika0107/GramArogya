"""Home Sample Collection feature tests.

Covers the doctor prescribe -> technician allocation -> two-visit policy ->
masked call + audit trail flow (deliverables 1-7) against the seeded
in-memory demo database.
"""

import pytest


def _hdr(role, user=None):
    h = {"X-GramArogya-Role": role}
    if user:
        h["X-GramArogya-User"] = user
    return h


@pytest.fixture()
def ids(client):
    """Look up seeded facility + patient ids used across the flow."""
    facs = client.get("/api/v1/facilities").json()
    phc = next(f for f in facs if f["hfr_id"] == "HFR09-200012")
    patients = client.get("/api/v1/patients?q=91214455667701").json()
    sunita = next(p for p in patients if p["abha_id"] == "91214455667701")
    return {"facility_id": phc["id"], "patient_id": sunita["id"]}


def test_catalogue_flags_home_vs_hospital(client):
    """Feature 1 — strict separation: blood/urine tests are home-collectable,
    radiology/imaging tests are hospital-only."""
    tests = {t["code"]: t for t in client.get("/api/v1/lab/tests").json()}
    for code in ["FBS", "HBA1C", "LFT", "CREAT", "TSH", "CBC", "PLT", "TC",
                 "DENGUE", "MP", "URINE"]:
        assert tests[code]["home_collectable"] is True
        assert tests[code]["collection_type"] in ("home", "both")
    for code in ["ECG", "XRAY_CHEST", "USG_ABDO"]:
        assert tests[code]["home_collectable"] is False
        assert tests[code]["collection_type"] == "hospital"


def test_prescribe_home_routes_and_creates_booking(client, ids):
    """Feature 2 — doctor triggers home collection; status lands on
    HOME_COLLECTION_PENDING and hospital tests are returned separately."""
    resp = client.post(
        "/api/v1/home-collection/prescribe",
        headers=_hdr("doctor", "Dr. Anil Verma"),
        json={
            "patient_id": ids["patient_id"],
            "facility_id": ids["facility_id"],
            "doctor_name": "Dr. Anil Verma",
            "diagnosis": "Diabetes review",
            "home_collection_required": True,
            "tests": [
                {"code": "FBS", "mode": "home"},
                {"code": "HBA1C", "mode": "home"},
                {"code": "ECG", "mode": "hospital"},
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    booking = body["booking"]
    assert booking is not None
    assert booking["status_alias"] == "HOME_COLLECTION_PENDING"
    assert booking["status"] == "home_collection_pending"
    assert [t["code"] for t in booking["tests"]] == ["FBS", "HBA1C"]
    # ECG is not home-collectable -> routed back as hospital/OPD list
    assert "ECG" in body["hospital_tests"]
    # masked phone, never the raw number
    assert booking["patient_phone_masked"].startswith("+91-XXXX-XXX-")
    assert booking["patient_phone_masked"].endswith("3201")


def test_prescribe_rejects_home_request_for_hospital_test(client, ids):
    """Feature 1 — asking for home collection of an ECG/radiology test fails
    loudly (it must be routed to the hospital OPD instead)."""
    resp = client.post(
        "/api/v1/home-collection/prescribe",
        headers=_hdr("doctor", "Dr. Anil Verma"),
        json={
            "patient_id": ids["patient_id"],
            "facility_id": ids["facility_id"],
            "home_collection_required": True,
            "tests": [{"code": "ECG", "mode": "home"}],
        },
    )
    assert resp.status_code == 422
    assert "NOT home-collectable" in resp.json()["detail"]


def _new_booking(client, ids, codes=("CBC", "TSH")):
    resp = client.post(
        "/api/v1/home-collection/prescribe",
        headers=_hdr("doctor", "Dr. Anil Verma"),
        json={
            "patient_id": ids["patient_id"],
            "facility_id": ids["facility_id"],
            "doctor_name": "Dr. Anil Verma",
            "home_collection_required": True,
            "tests": [{"code": c, "mode": "home"} for c in codes],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["booking"]


def test_assign_technician_round_robin(client, ids):
    """Feature 3 — allocation engine picks an available technician and moves
    the booking to TECHNICIAN_ASSIGNED with a scheduled slot."""
    booking = _new_booking(client, ids)
    assert booking["status_alias"] == "HOME_COLLECTION_PENDING"

    techs = client.get("/api/v1/home-collection/technicians").json()
    resp = client.post(
        "/api/v1/home-collection/assign-technician",
        headers=_hdr("lab", "Ramesh Yadav"),
        json={"booking_id": booking["id"]},  # no technician -> engine pick
    )
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["status_alias"] == "TECHNICIAN_ASSIGNED"
    assert out["technician_name"] in {t["name"] for t in techs}
    assert out["visit_number"] == 1
    assert out["scheduled_slot_at"] is not None

    # Engine rotates: a second booking gets a different (or next) technician
    booking2 = _new_booking(client, ids, codes=("FBS",))
    out2 = client.post(
        "/api/v1/home-collection/assign-technician",
        headers=_hdr("lab", "Ramesh Yadav"),
        json={"booking_id": booking2["id"]},
    ).json()
    assert out2["technician_id"]


def test_two_visit_policy_first_failure_reschedules(client, ids):
    """Feature 4 — visit 1 failure auto-reschedules (UNAVAILABLE_RESCHEDULED)."""
    booking = _new_booking(client, ids)
    client.post(
        "/api/v1/home-collection/assign-technician",
        headers=_hdr("lab", "Ramesh Yadav"),
        json={"booking_id": booking["id"]},
    )
    resp = client.post(
        "/api/v1/home-collection/visit-status",
        headers=_hdr("lab", "Ramesh Yadav"),
        json={"booking_id": booking["id"], "event": "unavailable",
              "notes": "Nobody at home"},
    )
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["status_alias"] == "UNAVAILABLE_RESCHEDULED"
    assert out["visit_number"] == 2
    assert out["scheduled_slot_at"] is not None  # auto next slot


def test_two_visit_policy_second_failure_cancels(client, ids):
    """Feature 4 — visit 2 failure cancels sampling (SAMPLING_CANCELLED)."""
    booking = _new_booking(client, ids)
    client.post(
        "/api/v1/home-collection/assign-technician",
        headers=_hdr("lab", "Ramesh Yadav"),
        json={"booking_id": booking["id"]},
    )
    for _ in range(2):  # visit 1 unavailable + visit 2 unavailable
        resp = client.post(
            "/api/v1/home-collection/visit-status",
            headers=_hdr("lab", "Ramesh Yadav"),
            json={"booking_id": booking["id"], "event": "unavailable"},
        )
        assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["status_alias"] == "SAMPLING_CANCELLED"
    assert out["cancel_reason"] == "second_no_show"


def test_illegal_transition_rejected(client, ids):
    booking = _new_booking(client, ids)
    # Cannot mark collected before a technician is assigned
    resp = client.post(
        "/api/v1/home-collection/visit-status",
        headers=_hdr("lab", "Ramesh Yadav"),
        json={"booking_id": booking["id"], "event": "collected"},
    )
    assert resp.status_code == 409


def test_collected_advances_lab_order(client, ids):
    """collected at home -> booking SAMPLE_COLLECTED and the underlying lab
    order enters the normal lab pipeline (sample_collected)."""
    booking = _new_booking(client, ids)
    client.post(
        "/api/v1/home-collection/assign-technician",
        headers=_hdr("lab", "Ramesh Yadav"),
        json={"booking_id": booking["id"]},
    )
    resp = client.post(
        "/api/v1/home-collection/visit-status",
        headers=_hdr("lab", "Ramesh Yadav"),
        json={"booking_id": booking["id"], "event": "collected"},
    )
    out = resp.json()
    assert resp.status_code == 200, resp.text
    assert out["status_alias"] == "SAMPLE_COLLECTED"

    order = client.get("/api/v1/lab/orders/" + out["lab_order_id"]).json()
    assert order["status"] == "sample_collected"
    assert order["collection_mode"] == "home"


def test_address_reveal_is_audited(client, ids):
    """Feature 6 — the board hides the raw address; revealing it is a logged
    VIEW_PATIENT_ADDRESS audit event."""
    booking = _new_booking(client, ids)
    client.post(
        "/api/v1/home-collection/assign-technician",
        headers=_hdr("lab", "Ramesh Yadav"),
        json={"booking_id": booking["id"]},
    )

    # List view never carries the raw address
    listed = next(b for b in client.get("/api/v1/home-collection/bookings").json()
                  if b["id"] == booking["id"])
    assert listed["patient_address"] is None

    # Reveal -> address + audit entry
    resp = client.get(
        "/api/v1/home-collection/bookings/" + booking["id"] + "/address",
        headers=_hdr("lab", "Ramesh Yadav"),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["patient_address"]

    logs = client.get(
        "/api/v1/home-collection/audit?booking_id=" + booking["id"],
        headers=_hdr("admin", "Anita Sharma"),
    ).json()
    assert any(l["action"] == "VIEW_PATIENT_ADDRESS" and l["actor_id"] == "Ramesh Yadav"
               for l in logs)


def test_masked_call_never_exposes_number(client, ids):
    """Feature 7 — initiate-masked-call returns a masked display number, not
    the patient's raw phone."""
    booking = _new_booking(client, ids)
    client.post(
        "/api/v1/home-collection/assign-technician",
        headers=_hdr("lab", "Ramesh Yadav"),
        json={"booking_id": booking["id"]},
    )
    resp = client.post(
        "/api/v1/home-collection/initiate-masked-call",
        headers=_hdr("lab", "Ramesh Yadav"),
        json={"booking_id": booking["id"]},
    )
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["masked_number"].startswith("+91-XXXX-XXX-")
    assert "+919876543201" not in out["masked_number"]
    assert out["dial_through_url"]


def test_audit_trail_requires_role(client, ids):
    """Sensitive audit feed is role-gated."""
    resp = client.get("/api/v1/home-collection/audit", headers=_hdr("asha"))
    assert resp.status_code == 403
