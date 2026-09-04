"""GramArogya — FastAPI application entrypoint.

One backend serving four frontend web apps:
  /asha    -> ASHA/ANM worker offline-first PWA
  /doctor  -> PHC/hospital doctor portal
  /lab     -> lab technician portal
  /admin   -> block/district admin dashboard
plus the JSON API under /api/v1 (docs at /docs).

Run:  uvicorn app.main:app --reload   (from backend/)
      or `docker compose up` at the repo root for PostgreSQL.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import SessionLocal, engine, ensure_columns
from .icons import icon_png
from .models import Base
from .routers import (
    appointments,
    dashboard,
    doctor,
    facilities,
    followups,
    inventory,
    kiosk,
    lab,
    messages,
    patients,
    referrals,
    sync,
    teleconsult,
    triage,
    ws,
)
from .seed import seed_if_empty, seed_modules_if_empty

logger = logging.getLogger("gramarogya")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Create tables (Postgres via schema.sql/docker-compose; SQLite fallback
    # also works so `uvicorn` runs with zero setup).
    Base.metadata.create_all(bind=engine)

    # Add columns introduced after a DB was first created (no-op on fresh DBs).
    ensure_columns(engine)

    # Seed demo data on first boot so the 5-minute demo works immediately, then
    # backfill the newer modules (appointments, lab, follow-ups, teleconsults)
    # even onto an already-seeded database.
    db = SessionLocal()
    try:
        if seed_if_empty(db):
            logger.info("Seeded demo data (facilities, patients, inventory, referrals).")
        if seed_modules_if_empty(db):
            logger.info("Backfilled module demo data (appointments, lab, follow-ups, teleconsults).")
    finally:
        db.close()
    yield


app = FastAPI(
    title="GramArogya API",
    description="Unified rural healthcare ecosystem — Smart India Hackathon prototype.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- REST API ---------------------------------------------------------------
api = APIRouter(prefix="/api/v1")
api.include_router(patients.router)
api.include_router(facilities.router)
api.include_router(triage.router)
api.include_router(sync.router)
api.include_router(referrals.router)
api.include_router(inventory.router)
api.include_router(messages.router)
api.include_router(doctor.router)
api.include_router(appointments.router)
api.include_router(followups.router)
api.include_router(lab.router)
api.include_router(teleconsult.router)
api.include_router(dashboard.router)
api.include_router(kiosk.router)
api.include_router(ws.router)
app.include_router(api)


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "app": settings.app_name}


# ---- PWA icons (generated on the fly — no build step needed) ----------------
@app.get("/asha/icons/icon-{size}.png")
def pwa_icon(size: int):
    return Response(content=icon_png(size), media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


@app.get("/")
def root():
    return RedirectResponse(url="/asha/")


# ---- Frontend static mounts -------------------------------------------------
# Each frontend lives in frontend/<app>/ and is served as a static site.
# Missing directories are skipped, so milestones can land incrementally.
for _name, _sub in (("asha", "asha-worker"),
                    ("doctor", "doctor-portal"),
                    ("lab", "lab-portal"),
                    ("admin", "admin-dashboard"),
                    ("kiosk", "kiosk"),
                    ("portal", "portal")):
    _dir = settings.frontend_dir / _sub
    if _dir.is_dir():
        app.mount(f"/{_name}", StaticFiles(directory=_dir, html=True), name=_name)
        logger.info("Mounted /%s -> %s", _name, _dir)
    else:
        logger.info("Skipped /%s (frontend/%s not present yet)", _name, _sub)