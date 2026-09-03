"""Pending-message queue + dispatch (mock SMS provider)."""


def test_dispatch_flushes_queued_messages(client, capsys):
    # Seed data includes exactly 1 queued message; add one more via the API
    client.post("/api/v1/messages", json={
        "recipient_phone": "+919876543210",
        "recipient_name": "Demo Patient",
        "message_text": "Your ANC appointment is due tomorrow. — GramArogya",
    })

    res = client.post("/api/v1/messages/dispatch").json()
    assert res["scanned"] == 2
    assert res["sent"] == 2
    assert res["failed"] == 0

    # Mock provider logs the SMS — the demo's "SMS sent to +91..." line
    captured = capsys.readouterr().out
    assert "[MOCK SMS]" in captured
    assert "+919876543210" in captured
    assert "ANC appointment" in captured

    # Queue is now empty
    remaining = client.get("/api/v1/messages", params={"status": "queued"}).json()
    assert remaining == []


def test_dispatch_is_idempotent(client):
    client.post("/api/v1/messages/dispatch")
    again = client.post("/api/v1/messages/dispatch").json()
    assert again["scanned"] == 0  # nothing left to send
    assert again["sent"] == 0


def test_queued_messages_appear_in_dashboard(client):
    summary = client.get("/api/v1/dashboard/summary").json()
    assert summary["queued_messages"] == 1  # the seeded follow-up nudge