"""Referral state machine + PATCH /api/v1/referrals/track."""

from uuid import uuid4


def _create_referral(client):
    patients = client.get("/api/v1/patients", params={"q": "Sunita"}).json()
    facilities = client.get("/api/v1/facilities").json()
    phc = next(f for f in facilities if f["facility_type"] == "phc")
    chc = next(f for f in facilities if f["facility_type"] == "chc")

    res = client.post("/api/v1/referrals", json={
        "patient_id": patients[0]["id"],
        "from_facility_id": phc["id"],
        "to_facility_id": chc["id"],
        "reason": "Test referral",
        "priority": "urgent",
    })
    assert res.status_code == 201
    return res.json()


def test_happy_path_state_machine(client):
    ref = _create_referral(client)
    assert ref["status"] == "created"

    ref = client.patch("/api/v1/referrals/track",
                       json={"referral_id": ref["id"], "event": "send"}).json()
    assert ref["status"] == "sent"
    assert ref["sent_at"] is not None

    ref = client.patch("/api/v1/referrals/track",
                       json={"referral_id": ref["id"], "event": "accept"}).json()
    assert ref["status"] == "accepted"
    assert ref["accepted_at"] is not None

    ref = client.patch("/api/v1/referrals/track",
                       json={"referral_id": ref["id"], "event": "complete"}).json()
    assert ref["status"] == "completed"
    assert ref["completed_at"] is not None


def test_invalid_transition_is_rejected(client):
    ref = _create_referral(client)  # status == created
    res = client.patch("/api/v1/referrals/track",
                       json={"referral_id": ref["id"], "event": "complete"})
    assert res.status_code == 409
    assert "Invalid transition" in res.json()["detail"]


def test_no_show_branch(client):
    ref = _create_referral(client)
    client.patch("/api/v1/referrals/track", json={"referral_id": ref["id"], "event": "send"})
    client.patch("/api/v1/referrals/track", json={"referral_id": ref["id"], "event": "accept"})
    ref = client.patch("/api/v1/referrals/track",
                       json={"referral_id": ref["id"], "event": "no_show"}).json()
    assert ref["status"] == "no_show"
    assert ref["no_show_at"] is not None


def test_accept_queues_patient_sms(client):
    """Referral events must write to pending_messages (offline-aware), never
    send synchronously."""
    ref = _create_referral(client)
    client.patch("/api/v1/referrals/track", json={"referral_id": ref["id"], "event": "send"})
    client.patch("/api/v1/referrals/track", json={"referral_id": ref["id"], "event": "accept"})

    queued = client.get("/api/v1/messages", params={"status": "queued"}).json()
    assert any("ACCEPTED" in m["message_text"] for m in queued)


def test_accept_notifies_asha_worker_sms(client):
    """Referral accept must queue an SMS to the referring ASHA worker
    (offline-aware queue; delivered via Twilio when SMS_PROVIDER=twilio)."""
    patients = client.get("/api/v1/patients", params={"q": "Sunita"}).json()
    facilities = client.get("/api/v1/facilities").json()
    phc = next(f for f in facilities if f["facility_type"] == "phc")
    chc = next(f for f in facilities if f["facility_type"] == "chc")

    res = client.post("/api/v1/referrals", json={
        "patient_id": patients[0]["id"],
        "from_facility_id": phc["id"],
        "to_facility_id": chc["id"],
        "reason": "ASHA alert test",
        "priority": "urgent",
        "asha_phone": "+919811122233",
    })
    assert res.status_code == 201
    ref = res.json()
    client.patch("/api/v1/referrals/track", json={"referral_id": ref["id"], "event": "send"})
    client.patch("/api/v1/referrals/track", json={"referral_id": ref["id"], "event": "accept"})

    queued = client.get("/api/v1/messages", params={"status": "queued"}).json()
    asha_msgs = [m for m in queued if m["recipient_phone"] == "+919811122233"]
    assert len(asha_msgs) == 1
    assert "ACCEPTED" in asha_msgs[0]["message_text"]


def test_missing_referral_404(client):
    res = client.patch("/api/v1/referrals/track",
                       json={"referral_id": str(uuid4()), "event": "send"})
    assert res.status_code == 404