"""Role-based access control helpers.

Demo-grade RBAC: each frontend portal identifies itself with the
`X-GramArogya-Role` header (asha | doctor | lab | admin). Read-only list
endpoints stay open (field workers, public PHC queue), while every write
endpoint that belongs to one role is protected by `require_role(...)`.

Swapping in real authentication later = replacing this header check with a
token/session lookup; the endpoint signatures do not change.
"""

from typing import Callable, Optional

from fastapi import Header, HTTPException

VALID_ROLES = {"asha", "doctor", "lab", "admin", "kiosk"}


def current_actor(
    x_gramarogya_role: Optional[str] = Header(default=None, alias="X-GramArogya-Role"),
    x_gramarogya_user: Optional[str] = Header(default=None, alias="X-GramArogya-User"),
) -> tuple[Optional[str], Optional[str]]:
    """Capture the caller's identity for audit logging.

    Returns (actor_id, actor_role): actor_id is the free-text staff name sent
    by the portal in `X-GramArogya-User` (demo stand-in for a session user
    id), falling back to the role when absent.
    """
    role = (x_gramarogya_role or "").strip().lower()
    user = (x_gramarogya_user or "").strip()
    return (user or None, role or None)


def require_role(*roles: str) -> Callable:
    """FastAPI dependency factory: allow only the listed staff roles.

    Usage:
        @router.post("", dependencies=[Depends(require_role("doctor"))])
        def create_order(...): ...

    or, when the role value itself is needed:
        def create_order(role: str = Depends(require_role("doctor"))): ...
    """

    def _guard(
        x_gramarogya_role: Optional[str] = Header(default=None, alias="X-GramArogya-Role"),
    ) -> str:
        role = (x_gramarogya_role or "").strip().lower()
        if role not in VALID_ROLES or role not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Requires one of these roles: {', '.join(roles)}",
            )
        return role

    return _guard
