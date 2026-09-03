"""Offline-aware messaging queue.

GET  /api/v1/messages            -> list queued/sent/failed notifications
POST /api/v1/messages            -> manually queue a message (events usually do this)
POST /api/v1/messages/dispatch   -> drain the queue through the SMS provider
                                    (mock logs to console; Twilio swappable)
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import PendingMessage
from ..schemas import DispatchResult, MessageCreate, MessageOut
from ..services.messaging import dispatch_queued_messages, queue_message

router = APIRouter(prefix="/messages", tags=["messages"])


@router.get("", response_model=list[MessageOut])
def list_messages(
    status: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    query = db.query(PendingMessage)
    if status:
        query = query.filter(PendingMessage.status == status)
    return query.order_by(PendingMessage.created_at.desc()).limit(limit).all()


@router.post("", response_model=MessageOut, status_code=201)
def queue_new_message(payload: MessageCreate, db: Session = Depends(get_db)):
    """Manually enqueue a notification (e.g. from the admin follow-up list)."""
    return queue_message(
        db,
        message_text=payload.message_text,
        recipient_phone=payload.recipient_phone,
        recipient_name=payload.recipient_name,
        patient_id=payload.patient_id,
        channel=payload.channel,
    )


@router.post("/dispatch", response_model=DispatchResult)
def dispatch(db: Session = Depends(get_db)):
    """Background-sender job (or manual trigger): drain queued messages.

    Mock provider just logs "SMS sent to +91XXXXXXXXXX: <message_text>" and
    flips status -> sent. Swap in Twilio via SMS_PROVIDER=twilio + env vars.
    """
    return dispatch_queued_messages(db)