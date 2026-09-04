"""In-process WebSocket hub for the OPD queue (single-worker dev server).

Clients (doctor portal, kiosk) subscribe per facility to `/api/v1/ws/queue`.
Write endpoints broadcast lightweight events (`queue_changed`,
`availability_changed`); clients re-fetch the queue over REST afterwards, so
the hub carries no business logic and no queue payloads.

Swap for Redis pub/sub in production — the event shape does not change.
"""

from typing import Dict, Set

from fastapi import WebSocket


class QueueHub:
    def __init__(self) -> None:
        self._rooms: Dict[str, Set[WebSocket]] = {}

    async def connect(self, facility_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._rooms.setdefault(facility_id, set()).add(ws)

    def disconnect(self, facility_id: str, ws: WebSocket) -> None:
        room = self._rooms.get(facility_id)
        if room:
            room.discard(ws)
            if not room:
                self._rooms.pop(facility_id, None)

    async def broadcast(self, facility_id: str, event: dict) -> None:
        room = self._rooms.get(facility_id)
        if not room:
            return
        dead: list[WebSocket] = []
        for ws in list(room):
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        for ws in dead:
            room.discard(ws)


hub = QueueHub()