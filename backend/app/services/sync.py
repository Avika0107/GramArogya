"""Offline-sync conflict resolution.

Strategy (documented, demo-friendly, deterministic):
  * Idempotency: every offline record carries a client_id (UUID). If a row
    with that client_id already exists, the record is a duplicate and is
    ignored (status='duplicate') — retries are safe.
  * Conflicts: when an existing row is found by a natural key (e.g. ABHA ID
    for patients) but with a different client_id, the row with the NEWER
    updated_at wins ("last-write-wins" on timestamps). The loser is reported
    with status='conflict_resolved' so the demo can explain the rule.
  * Patients are matched by abha_id; encounters/triages are matched by
    client_id only (their natural key is the client id itself).
"""

from datetime import datetime
from typing import Optional

from ..models import utcnow


def _naive(dt: datetime) -> datetime:
    """Normalize tz-aware/naive datetimes so comparisons work on SQLite + PG."""
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def client_wins(server_updated_at: Optional[datetime], client_updated_at: datetime) -> bool:
    """Conflict rule: the most recently updated version wins."""
    if server_updated_at is None:
        return True
    return _naive(client_updated_at) > _naive(server_updated_at)


def now_iso() -> str:
    """ISO-8601 UTC string with Z suffix (friendly for JS frontends)."""
    return utcnow().isoformat().replace("+00:00", "Z")