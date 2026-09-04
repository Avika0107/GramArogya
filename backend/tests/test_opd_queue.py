"""OPD Queue Manager: GA-... tokens, doctor availability gate, kiosk, WS."""

import re


def _facilities(client):
    return client.get("/api/v1/facilities").json()


def _phc(client):
    return next(f for f in _facilities(client) if f["facility_type"] == "phc")


def _patient(client):
    return client.get("/api/v1/patients").json()[0]


def _book(client, facility_id, patient_id, counter="WEB01", role="asha"):
    return client.post(
        "/api/v1/appointments",
        json={
            "patient_id": patient_id,
            "facility_id": facility_id,
            "priority": "routine",
            "reason": "OPD check-in",
            "department": "GMED",
            "counter": counter,
        },
        headers={"X-GramArogya-Role": role},
    )


def test_token_label_follows_ga_format(client):
    phc = _phc(client)
    pat = _patient(client)
    res = _book(client, phc["id"], pat["id"])
    assert res.status_code == 201
    body = res.json()
    assert re.fullmatch(
        r"GA-[A-Z0-9]{1,6}-GMED-\d{8}-WEB01-\d{6}", body["token_label"]
    ), body["token_label"]
    assert isinstance(body["token"], int)  # per-day sequence kept internally
    assert body["department"] == "GMED"


def test_token_sequence_increments_per_facility_day(client):
    phc = _phc(client)
    pat = _patient(client)
    r1 = _book(client, phc["id"], pat["id"]).json()
    r2 = _book(client, phc["id"], pat["id"]).json()
    assert r1["token_label"].split("-")[-1] != r2["token_label"].split("-")[-1]
    assert r1["token_label"][: len(r1["token_label"]) - 6] == \
        r2["token_label"][: len(r2["token_label"]) - 6]
    assert int(r2["token"]) == int(r1["token"]) + 1


def test_doctor_offline_blocks_token_generation(client):
    phc = _phc(client)
    pat = _patient(client)

    put = client.put(
        "/api/v1/doctor/status",
        json={"facility_id": phc["id"], "status": "offline"},
        headers={"X-GramArogya-Role": "doctor"},
    )
    assert put.status_code == 200 and put.json()["status"] == "offline"

    # Web portal booking refused while OFFLINE
    res = _book(client, phc["id"], pat["id"])
    assert res.status_code == 409
    assert "OFFLINE" in res.json()["detail"]

    # Kiosk walk-in also refused
    kiosk = client.post(
        "/api/v1/kiosk/token",
        json={"patient_id": pat["id"], "facility_id": phc["id"]},
        headers={"X-GramArogya-Role": "kiosk"},
    )
    assert kiosk.status_code == 409

    # Back ONLINE -> token generation works again
    client.put(
        "/api/v1/doctor/status",
        json={"facility_id": phc["id"], "status": "available"},
        headers={"X-GramArogya-Role": "doctor"},
    )
    assert _book(client, phc["id"], pat["id"]).status_code == 201


def test_doctor_status_defaults_and_validates(client):
    phc = _phc(client)
    st = client.get("/api/v1/doctor/status", params={"facility_id": phc["id"]}).json()
    assert st["status"] == "available"

    bad = client.put(
        "/api/v1/doctor/status",
        json={"facility_id": phc["id"], "status": "asleep"},
        headers={"X-GramArogya-Role": "doctor"},
    )
    assert bad.status_code == 422


def test_kiosk_walkin_token_uses_kio_counter(client):
    phc = _phc(client)
    pat = _patient(client)
    res = client.post(
        "/api/v1/kiosk/token",
        json={"patient_id": pat["id"], "facility_id": phc["id"], "priority": "routine"},
        headers={"X-GramArogya-Role": "kiosk"},
    )
    assert res.status_code == 201
    assert "-KIO01-" in res.json()["token_label"]
    assert res.json()["status"] == "waiting"


def test_kiosk_endpoints_require_kiosk_role(client):
    phc = _phc(client)
    pat = _patient(client)
    res = client.post(
        "/api/v1/kiosk/token",
        json={"patient_id": pat["id"], "facility_id": phc["id"]},
        headers={"X-GramArogya-Role": "asha"},
    )
    assert res.status_code == 403


def test_legacy_null_department_tokens_continue_sequence(client):
    """Rows created before the department column existed (department=NULL)
    must still count toward the daily sequence, so a new booking continues
    after them instead of restarting at token #1."""
    from app.database import SessionLocal
    from app.models import Appointment, utcnow

    phc = _phc(client)
    pat = _patient(client)

    db = SessionLocal()
    try:
        # Clear the seeded demo queue, then simulate a legacy row that was
        # created when the department column did not exist yet.
        db.query(Appointment).filter(Appointment.facility_id == phc["id"]).delete()
        db.add(Appointment(
            patient_id=pat["id"], facility_id=phc["id"],
            scheduled_for=utcnow(), token=3, department=None,
            priority="routine", status="waiting",
        ))
        db.commit()
    finally:
        db.close()

    res = _book(client, phc["id"], pat["id"]).json()
    assert res["token"] == 4, res
    assert res["token_label"].endswith("000004"), res["token_label"]


def test_kiosk_queue_sorts_by_priority(client):
    """Urgent tokens must appear above routine ones on the kiosk queue board,
    matching the doctor-portal ordering (priority first, then token)."""
    phc = _phc(client)
    pat = _patient(client)

    def book(priority):
        return client.post(
            "/api/v1/appointments",
            json={"patient_id": pat["id"], "facility_id": phc["id"],
                  "priority": priority, "reason": "x", "department": "GMED",
                  "counter": "WEB01"},
            headers={"X-GramArogya-Role": "asha"},
        ).json()

    routine = book("routine")
    urgent = book("urgent")
    assert int(urgent["token"]) > int(routine["token"])

    rows = client.get(
        "/api/v1/kiosk/queue", params={"facility_id": phc["id"]}
    ).json()
    waiting = [r for r in rows if r["status"] == "waiting"]
    ids = [r["id"] for r in waiting]
    assert ids.index(urgent["id"]) < ids.index(routine["id"]), \
        [r["priority"] for r in waiting]


def test_queue_today_exposes_token_label(client):
    phc = _phc(client)
    pat = _patient(client)
    _book(client, phc["id"], pat["id"])
    rows = client.get(
        "/api/v1/appointments/queue/today", params={"facility_id": phc["id"]}
    ).json()
    assert rows and any(r["token_label"] for r in rows)


def test_queue_socket_receives_live_events(client):
    phc = _phc(client)
    pat = _patient(client)
    with client.websocket_connect(
        f"/api/v1/ws/queue?facility_id={phc['id']}"
    ) as ws:
        hello = ws.receive_json()
        assert hello["type"] == "connected"

        _book(client, phc["id"], pat["id"])
        event = ws.receive_json()
        assert event["type"] == "queue_changed"
        assert event["event"] == "token_created"
        assert event["token_label"]

        # Availability changes also broadcast
        client.put(
            "/api/v1/doctor/status",
            json={"facility_id": phc["id"], "status": "busy"},
            headers={"X-GramArogya-Role": "doctor"},
        )
        event2 = ws.receive_json()
        assert event2["type"] == "availability_changed"
        assert event2["status"] == "busy"