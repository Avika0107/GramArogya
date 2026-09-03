"""POST /api/v1/triage — rule tree tests (RED / YELLOW / GREEN)."""


def _assess(client, symptoms, vitals, abha_id=None):
    return client.post("/api/v1/triage", json={
        "abha_id": abha_id,
        "symptoms": symptoms,
        "vitals": vitals,
        "assessed_by": "asha_worker",
    })


def test_chest_pain_is_red(client):
    res = _assess(client, {"chest_pain": True}, {"pulse": 96, "spo2": 97})
    assert res.status_code == 200
    body = res.json()
    assert body["color"] == "RED"
    assert body["score"] == 100
    assert any("Chest pain" in r for r in body["reasons"])


def test_hypoxia_is_red(client):
    res = _assess(client, {}, {"pulse": 100, "spo2": 85})
    assert res.json()["color"] == "RED"


def test_high_fever_is_yellow(client):
    res = _assess(client, {"high_fever": True}, {"pulse": 110, "spo2": 96, "temperature": 39.2})
    body = res.json()
    assert body["color"] == "YELLOW"
    assert body["score"] == 50


def test_two_moderate_symptoms_escalate_to_yellow(client):
    res = _assess(client, {"diarrhea": True, "fatigue": True}, {"pulse": 90, "spo2": 97})
    assert res.json()["color"] == "YELLOW"


def test_normal_vitals_are_green(client):
    res = _assess(client, {}, {"pulse": 78, "systolic_bp": 120, "diastolic_bp": 80,
                               "spo2": 98, "temperature": 36.8, "respiratory_rate": 16})
    body = res.json()
    assert body["color"] == "GREEN"
    assert body["score"] == 10


def test_borderline_spo2_is_yellow(client):
    res = _assess(client, {}, {"pulse": 100, "spo2": 92})
    assert res.json()["color"] == "YELLOW"


def test_unknown_symptoms_are_ignored(client):
    """Unknown symptom keys must not crash the engine."""
    res = _assess(client, {"made_up_symptom": True}, {"pulse": 80})
    assert res.json()["color"] == "GREEN"