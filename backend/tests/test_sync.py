"""POST /api/v1/sync — offline batch sync.

Covers: idempotent retries (client_id), last-write-wins conflict resolution
on natural keys (ABHA), and server-side triage re-evaluation.
"""

ABHA = "91214455668899"
BASE = "2026-09-01T08:00:00+00:00"


def _patient_record(client_id, updated_at=BASE, **overrides):
    data = {
        "abha_id": ABHA,
        "name": "Ravi Kumar",
        "gender": "male",
        "dob": "1990-05-10",
        "phone": "+919900000001",
        "village": "Sanda",
        "district": "Barabanki",
        "state": "Uttar Pradesh",
    }
    data.update(overrides)
    return {
        "type": "patient",
        "client_id": client_id,
        "updated_at": updated_at,
        "data": data,
    }


def test_sync_creates_patient_and_is_idempotent(client):
    first = client.post("/api/v1/sync", json={"records": [_patient_record("p-1")]})
    assert first.status_code == 200
    assert first.json()["counts"] == {"created": 1}

    # Same client_id again -> duplicate, no new row
    second = client.post("/api/v1/sync", json={"records": [_patient_record("p-1")]})
    assert second.json()["counts"] == {"duplicate": 1}

    # Exactly one patient with this ABHA
    found = client.get("/api/v1/patients", params={"abha_id": ABHA}).json()
    assert len(found) == 1


def test_sync_conflict_newer_client_wins(client):
    client.post("/api/v1/sync", json={"records": [_patient_record("p-1")]})

    # Newer client copy -> updated
    res = client.post("/api/v1/sync", json={
        "records": [_patient_record("p-2", updated_at="2026-09-02T08:00:00+00:00",
                                    name="Ravi Kumar Sharma")],
    })
    assert res.json()["counts"] == {"updated": 1}

    # Older client copy -> conflict resolved in favour of the server
    res = client.post("/api/v1/sync", json={
        "records": [_patient_record("p-3", updated_at="2026-08-30T08:00:00+00:00",
                                    name="Stale Name")],
    })
    assert res.json()["counts"] == {"conflict_resolved": 1}

    found = client.get("/api/v1/patients", params={"abha_id": ABHA}).json()
    assert found[0]["name"] == "Ravi Kumar Sharma"


def test_sync_recomputes_triage_server_side(client):
    client.post("/api/v1/sync", json={"records": [_patient_record("p-1")]})

    res = client.post("/api/v1/sync", json={"records": [{
        "type": "triage",
        "client_id": "t-1",
        "updated_at": BASE,
        "data": {
            "abha_id": ABHA,
            "symptoms": {"chest_pain": True},
            "vitals": {"pulse": 96, "spo2": 97},
            "assessed_by": "asha_worker",
        },
    }]})
    body = res.json()
    assert body["counts"] == {"created": 1}
    # Server re-evaluated the rules -> RED
    assert "RED" in body["results"][0]["detail"]


def test_sync_encounter_without_patient_is_skipped(client):
    res = client.post("/api/v1/sync", json={"records": [{
        "type": "encounter",
        "client_id": "e-1",
        "updated_at": BASE,
        "data": {"chief_complaint": "Fever"},
    }]})
    assert res.json()["counts"] == {"skipped": 1}


def test_sync_auto_creates_patient_from_abha(client):
    """Triage synced before its patient record still lands, thanks to
    get_or_create_patient."""
    res = client.post("/api/v1/sync", json={"records": [{
        "type": "triage",
        "client_id": "t-9",
        "updated_at": BASE,
        "data": {
            "abha_id": "91214455668877",
            "name": "Auto Patient",
            "symptoms": {"high_fever": True},
            "vitals": {"temperature": 39.5, "pulse": 110, "spo2": 96},
        },
    }]})
    assert res.json()["counts"] == {"created": 1}
    found = client.get("/api/v1/patients", params={"abha_id": "91214455668877"}).json()
    assert found[0]["name"] == "Auto Patient"