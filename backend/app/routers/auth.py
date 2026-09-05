"""Portal registration + admin approval (doctor onboarding).

Real endpoints backing the /portal/ login/register page and the admin
dashboard's "Pending doctor approvals" card:

    POST   /api/v1/auth/register        -> create a portal account
                                            (doctor starts as `pending`)
    POST   /api/v1/auth/login           -> verify phone + password
    POST   /api/v1/auth/reset-password  -> set a new password (phone + role)
    GET    /api/v1/auth/doctors         -> list doctor registrations
                                            (?status=pending for the card)
    PATCH  /api/v1/auth/doctors/{id}    -> approve | decline (admin only)

Passwords are stored hashed (PBKDF2-HMAC-SHA256, per-user salt), never
plaintext. Auth itself stays demo-grade — this module only governs who may
open the role portals, the rest of the API keeps its X-GramArogya-Role
header RBAC.
"""

import hashlib
import hmac
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_role
from ..models import PortalUser, utcnow
from ..schemas import (
    AuthLogin,
    AuthRegister,
    AuthResetPassword,
    DoctorReview,
    PortalUserOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_PBKDF2_ROUNDS = 120_000


def hash_password(password: str) -> str:
    """Return `salt_hex$hash_hex` — per-user random salt, PBKDF2-HMAC-SHA256."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, hash_hex = stored.split("$", 1)
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), _PBKDF2_ROUNDS
        )
        return hmac.compare_digest(digest.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def _to_out(u: PortalUser) -> PortalUserOut:
    return PortalUserOut(
        id=u.id,
        role=u.role,
        name=u.name,
        phone=u.phone,
        email=u.email,
        status=u.status,
        profile=u.profile or {},
        reviewed_by=u.reviewed_by,
        reviewed_at=u.reviewed_at,
        created_at=u.created_at,
    )


def _public_user(u: PortalUser) -> dict:
    """Safe slice for login/register responses (never the hash)."""
    return {"name": u.name, "phone": u.phone, "role": u.role, "status": u.status}


@router.post("/register", response_model=PortalUserOut, status_code=201)
def register(payload: AuthRegister, db: Session = Depends(get_db)):
    if payload.role not in PortalUser.ROLES:
        raise HTTPException(status_code=422, detail="Unknown role")
    if payload.role == "doctor" and not payload.phone.isdigit():
        raise HTTPException(status_code=422, detail="Phone must be digits")

    exists = db.query(PortalUser).filter(PortalUser.phone == payload.phone).first()
    if exists:
        raise HTTPException(status_code=409, detail="An account with this phone number already exists.")

    # Doctors need a district admin's approval before their first sign-in;
    # the other roles are usable immediately (mirrors the portal's UX copy).
    status = "pending" if payload.role == "doctor" else "approved"

    # Everything the frontend sent beyond the core columns is role-specific
    # registration data (specialization, regNo, phc, ashaId, empId, ...) and
    # lands in `profile` for the admin approval card.
    profile = payload.model_dump(
        exclude={"role", "name", "phone", "password", "email"}
    )
    profile = {k: v for k, v in profile.items() if v not in (None, "")}

    user = PortalUser(
        role=payload.role,
        name=payload.name,
        phone=payload.phone,
        email=payload.email,
        password_hash=hash_password(payload.password),
        status=status,
        profile=profile or None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _to_out(user)


@router.post("/login")
def login(payload: AuthLogin, db: Session = Depends(get_db)):
    user = (
        db.query(PortalUser)
        .filter(PortalUser.phone == payload.username, PortalUser.role == payload.role)
        .first()
    )
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid phone number or password.")

    if user.status == "pending":
        raise HTTPException(
            status_code=403,
            detail="Your registration is awaiting admin approval. Please try again later.",
        )
    if user.status == "declined":
        raise HTTPException(
            status_code=403,
            detail="Your registration was declined by the admin. Please contact your block office.",
        )
    return {"ok": True, "user": _public_user(user)}


@router.post("/reset-password")
def reset_password(payload: AuthResetPassword, db: Session = Depends(get_db)):
    user = (
        db.query(PortalUser)
        .filter(PortalUser.phone == payload.phone, PortalUser.role == payload.role)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="No account found for this phone number.")
    user.password_hash = hash_password(payload.password)
    db.commit()
    return {"ok": True}


@router.get("/doctors", response_model=list[PortalUserOut],
            dependencies=[Depends(require_role("admin"))])
def list_doctor_registrations(
    status: str = Query("pending", pattern="^(pending|approved|declined)$"),
    db: Session = Depends(get_db),
):
    query = db.query(PortalUser).filter(PortalUser.role == "doctor")
    if status:
        query = query.filter(PortalUser.status == status)
    return [_to_out(u) for u in query.order_by(PortalUser.created_at.desc()).all()]


@router.patch("/doctors/{user_id}", response_model=PortalUserOut,
              dependencies=[Depends(require_role("admin"))])
def review_doctor_registration(user_id: str, payload: DoctorReview,
                               db: Session = Depends(get_db)):
    user = db.get(PortalUser, user_id)
    if not user or user.role != "doctor":
        raise HTTPException(status_code=404, detail="Doctor registration not found")
    if payload.action not in ("approve", "decline"):
        raise HTTPException(status_code=422, detail="action must be approve or decline")

    user.status = "approved" if payload.action == "approve" else "declined"
    user.reviewed_by = "District Admin"
    user.reviewed_at = utcnow()
    db.commit()
    db.refresh(user)
    return _to_out(user)
