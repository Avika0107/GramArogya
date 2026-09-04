"""Real-time queue updates (ONLINE mode) — WebSocket endpoint.

WS /api/v1/ws/queue?facility_id=<id>

Clients receive lightweight events:
  * {"type": "connected", "facility_id": ...}        on join
  * {"type": "queue_changed", "event": "token_created" | "token_updated", ...}
  * {"type": "availability_changed", "status": ...}

Events only signal *that* something changed — clients re-fetch the queue over
REST (network-first) so the socket stays a thin, robust channel. The kiosk
and doctor portal both auto-reconnect if the connection drops.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services.ws_manager import hub

router = APIRouter(tags=["ws"])


@router.websocket("/ws/queue")
async def queue_ws(websocket: WebSocket, facility_id: str = "all"):
    await hub.connect(facility_id, websocket)
    try:
        await websocket.send_json({"type": "connected", "facility_id": facility_id})
        while True:
            # Keep the connection alive; client pings are ignored.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(facility_id, websocket)