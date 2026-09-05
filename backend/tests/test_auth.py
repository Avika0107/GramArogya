"""Portal auth: register -> admin approve/reject -> login gate.

Doctors register on /portal/ and must be approved by a district admin
(GET /api/v1/auth/doctors?status=pending + PATCH /api/v1/auth/doctors/{id})
before they can sign in. Other roles are usable immediately.
"""

import time


def _register(client, role="doctor", phone=None, password="Demo@1234", **extra):
    payload = {
        "role": role,
        "name": "Dr. Test Singh" if role == "doctor" else "Test User",
        "phone": phone or "98765" + str(int(time.time() * 1000))[-5:],
        "password": password,
    }
    payload.update(extra)
    return client.post("/api/v1/auth/register", json=payload)


def _admin_headers():
    return {"X-GramArogya-Role": "admin"}


def test_doctor_registration_starts_pending_and_cannot_login(client):
    res = _register(client, role="doctor", name="Dr. Test Singh",
                    regNo="UP-11111", specialization="General Medicine")
    assert res.status_code == 201
    user = res.json()
    assert user["status"] == "pending"
    assert user["profile"]["specialization"] == "General Medicine"

    login = client.post("/api/v1/auth/login", json={
        "role": "doctor", "username": user["phone"], "password": "Demo@1234",
    })
    assert login.status_code == 403
    assert "awaiting admin approval" in login.json()["detail"]


def test_admin_approves_doctor_then_login_works(client):
    user = _register(client, role="doctor").json()

    pending = client.get("/api/v1/auth/doctors?status=pending",
                         headers=_admin_headers())
    assert pending.status_code == 200
    assert any(d["id"] == user["id"] for d in pending.json())

    approved = client.patch(f"/api/v1/auth/doctors/{user['id']}",
                            json={"action": "approve"}, headers=_admin_headers())
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    login = client.post("/api/v1/auth/login", json={
        "role": "doctor", "username": user["phone"], "password": "Demo@1234",
    })
    assert login.status_code == 200
    assert login.json()["user"]["name"] == user["name"]


def test_declined_doctor_cannot_login(client):
    user = _register(client, role="doctor").json()
    client.patch(f"/api/v1/auth/doctors/{user['id']}",
                 json={"action": "decline"}, headers=_admin_headers())
    login = client.post("/api/v1/auth/login", json={
        "role": "doctor", "username": user["phone"], "password": "Demo@1234",
    })
    assert login.status_code == 403
    assert "declined" in login.json()["detail"]


def test_non_doctor_roles_approved_immediately(client):
    for role in ("asha", "admin", "lab"):
        user = _register(client, role=role).json()
        assert user["status"] == "approved"
        login = client.post("/api/v1/auth/login", json={
            "role": role, "username": user["phone"], "password": "Demo@1234",
        })
        assert login.status_code == 200


def test_duplicate_phone_rejected(client):
    user = _register(client, role="doctor").json()
    res = _register(client, role="asha", phone=user["phone"])
    assert res.status_code == 409


def test_admin_endpoints_require_admin_role(client):
    res = client.get("/api/v1/auth/doctors")
    assert res.status_code == 403
    user = _register(client, role="doctor").json()
    res = client.patch(f"/api/v1/auth/doctors/{user['id']}",
                       json={"action": "approve"})
    assert res.status_code == 403


def test_wrong_password_rejected(client):
    user = _register(client, role="doctor").json()
    login = client.post("/api/v1/auth/login", json={
        "role": "doctor", "username": user["phone"], "password": "wrong",
    })
    assert login.status_code == 401


def test_reset_password_flow(client):
    user = _register(client, role="asha").json()
    res = client.post("/api/v1/auth/reset-password", json={
        "role": "asha", "phone": user["phone"], "password": "NewPass@999",
    })
    assert res.status_code == 200

    login = client.post("/api/v1/auth/login", json={
        "role": "asha", "username": user["phone"], "password": "NewPass@999",
    })
    assert login.status_code == 200


def test_seeded_demo_users_can_login(client):
    """Demo logins shown on /portal/ (tap-to-fill) must keep working."""
    login = client.post("/api/v1/auth/login", json={
        "role": "doctor", "username": "9123456780", "password": "demo@1234",
    })
    assert login.status_code == 200
    assert login.json()["user"]["name"] == "Dr. Rajesh Kumar"
