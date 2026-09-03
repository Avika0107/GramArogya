"""Offline-aware messaging.

Design:
  * Any event that must reach a patient/worker calls queue_message(), which
    ONLY writes a row to pending_messages (status='queued'). Nothing is sent
    synchronously — rural areas may have SMS signal but no data, and the ASHA
    PWA's "Simulate Network State" toggle controls when delivery is attempted.
  * POST /api/v1/messages/dispatch (or dispatch_queued_messages() from a cron/
    background worker) drains the queue through an SMS provider abstraction.
  * The default provider is a Mock that logs
        "SMS sent to +91XXXXXXXXXX: <message_text>"
    and marks the message 'sent'. To go live, set SMS_PROVIDER=twilio and the
    TWILIO_* env vars — the swap happens in get_sms_provider(), no other code
    changes.
"""

import logging
from typing import List, Optional

from ..config import settings
from ..models import Patient, PendingMessage, utcnow

logger = logging.getLogger("gramarogya.messaging")


# ---------------------------------------------------------------------------
# Provider abstraction
# ---------------------------------------------------------------------------
class BaseSMSProvider:
    """Single function every provider must implement."""

    def send(self, to_phone: str, message_text: str) -> bool:
        raise NotImplementedError


class MockSMSProvider(BaseSMSProvider):
    """Demo provider: logs the SMS, always succeeds."""

    def send(self, to_phone: str, message_text: str) -> bool:
        logger.info("SMS sent to %s: %s", to_phone, message_text)
        print(f"[MOCK SMS] SMS sent to {to_phone}: {message_text}")
        return True


class TwilioSMSProvider(BaseSMSProvider):
    """Real provider — swap-in ready.

    Requires `pip install twilio` and TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
    TWILIO_FROM_NUMBER env vars (see .env.example).
    """

    def send(self, to_phone: str, message_text: str) -> bool:
        from twilio.rest import Client  # imported lazily so mock mode needs no extra deps

        client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
        message = client.messages.create(
            to=to_phone,
            from_=settings.twilio_from_number,
            body=message_text,
        )
        return message.status not in ("failed", "undelivered")


def get_sms_provider() -> BaseSMSProvider:
    """Factory: returns the provider configured via SMS_PROVIDER env var."""
    if settings.sms_provider.lower() == "twilio" and settings.twilio_account_sid:
        return TwilioSMSProvider()
    return MockSMSProvider()


# ---------------------------------------------------------------------------
# Queueing + dispatch
# ---------------------------------------------------------------------------
def queue_message(db, *, message_text: str, recipient_phone: str,
                  patient_id: Optional[str] = None,
                  recipient_name: Optional[str] = None,
                  channel: str = "sms") -> PendingMessage:
    """Write a notification to the queue. NEVER sends synchronously."""
    msg = PendingMessage(
        patient_id=patient_id,
        recipient_name=recipient_name,
        recipient_phone=recipient_phone,
        message_text=message_text,
        channel=channel,
        status="queued",
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    logger.info("Queued %s message for %s (%s)", channel, recipient_phone, msg.id)
    return msg


def queue_message_for_patient(db, patient: Patient, message_text: str,
                              channel: str = "sms") -> PendingMessage:
    """Convenience: queue a message addressed to a Patient row."""
    return queue_message(
        db,
        message_text=message_text,
        recipient_phone=patient.phone or "+919999999999",
        recipient_name=patient.name,
        patient_id=patient.id,
        channel=channel,
    )


def dispatch_queued_messages(db, provider: Optional[BaseSMSProvider] = None) -> dict:
    """Scan queued messages, attempt delivery, update status.

    Returns a summary dict {scanned, sent, failed, sent_ids, log}.
    """
    provider = provider or get_sms_provider()
    queued: List[PendingMessage] = (
        db.query(PendingMessage).filter(PendingMessage.status == "queued").all()
    )

    sent, failed = 0, 0
    sent_ids: List[str] = []
    log: List[str] = []

    for msg in queued:
        try:
            ok = provider.send(msg.recipient_phone, msg.message_text)
        except Exception as exc:  # provider errors must never crash the drain loop
            logger.exception("SMS provider error for %s", msg.id)
            ok = False
            msg.error = str(exc)[:500]

        if ok:
            msg.status = "sent"
            msg.sent_at = utcnow()
            msg.error = None
            sent += 1
            sent_ids.append(msg.id)
            log.append(f"SMS sent to {msg.recipient_phone}: {msg.message_text[:80]}...")
        else:
            msg.status = "failed"
            failed += 1
            log.append(f"SMS FAILED to {msg.recipient_phone} (id={msg.id})")

    db.commit()
    logger.info("Dispatch finished: %d sent, %d failed", sent, failed)
    return {"scanned": len(queued), "sent": sent, "failed": failed, "sent_ids": sent_ids, "log": log}