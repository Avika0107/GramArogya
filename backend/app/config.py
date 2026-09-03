"""Application configuration.

All values are read from environment variables (see .env.example at the repo
root). Sensible defaults are provided so `uvicorn app.main:app` just works:

  * DATABASE_URL  -> if unset, falls back to a local SQLite file so the
                     prototype runs with zero setup. Set it to a PostgreSQL
                     URL for the real deployment (see docker-compose.yml and
                     schema.sql).
  * SMS_PROVIDER  -> "mock" logs SMS to the console; "twilio" uses a real
                     gateway (swap-in ready via services/messaging.py).
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env if present (repo root .env is also picked up by uvicorn).
load_dotenv()


class Settings:
    def __init__(self) -> None:
        self.app_name = "GramArogya API"
        self.debug = os.getenv("GRAMAROGYA_DEBUG", "1") == "1"

        # Database -----------------------------------------------------------------
        # Default to a local SQLite file for instant demo. For PostgreSQL set:
        #   DATABASE_URL=postgresql+psycopg://user:pass@host:5432/gramarogya
        self.database_url = os.getenv(
            "DATABASE_URL",
            f"sqlite:///{(Path(__file__).resolve().parents[1] / 'gramarogya.db')}",
        )

        # SMS ----------------------------------------------------------------------
        self.sms_provider = os.getenv("SMS_PROVIDER", "mock")  # mock | twilio
        self.twilio_account_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
        self.twilio_auth_token = os.getenv("TWILIO_AUTH_TOKEN", "")
        self.twilio_from_number = os.getenv("TWILIO_FROM_NUMBER", "")

        # Teleconsult ---------------------------------------------------------------
        # Real video/audio calls use an embedded WebRTC provider:
        #   jitsi     (default) public Jitsi Meet rooms — zero setup, no API key
        #   daily     Daily.co Prebuilt rooms — set DAILY_DOMAIN to your domain
        #   simulated no live media, demo call UI only (offline/air-gapped demo)
        self.teleconsult_provider = os.getenv("TELECONSULT_PROVIDER", "jitsi")
        self.daily_domain = os.getenv("DAILY_DOMAIN", "")

        # Frontend -----------------------------------------------------------------
        # Directory holding the three web apps: asha-worker/ doctor-portal/
        # admin-dashboard/. The backend serves them as static files.
        self.frontend_dir = Path(
            os.getenv("FRONTEND_DIR", Path(__file__).resolve().parents[2] / "frontend")
        )

        # CORS ---------------------------------------------------------------------
        self.cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")]


settings = Settings()