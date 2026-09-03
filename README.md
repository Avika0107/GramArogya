# GramArogya — Rural Healthcare Access & Quality (SIH prototype)

A unified, **low-bandwidth health ecosystem** connecting rural patients to the
healthcare system. One FastAPI + PostgreSQL backend serves three web apps:

| App | URL | Purpose |
|-----|-----|---------|
| **ASHA/ANM Worker PWA** (offline-first) | `/asha/` | ABHA-first registration (full address), digital triage (RED/YELLOW/GREEN) with emergency bypass referrals, daily follow-up tasks, offline record queue + sync, "Simulate Network State" toggle, EN/हिंदी/मराठी/বাংলা UI |
| **PHC Doctor Portal** | `/doctor/` | PHC dashboard, OPD token queue, consultation + stock-aware e-prescription, lab ordering, teleconsult (audio/video/chat), referral tracking, pharmacy |
| **Lab Technician Portal** | `/lab/` | Diagnostic order pipeline (sample → dispatch → process → ready), structured results with auto flags, report upload, turnaround time |
| **District Admin Dashboard** | `/admin/` | District roll-ups + facility performance, referral funnel, follow-up compliance, diagnostic TAT, stock-out alerts, date/type filters |
| API docs | `/docs` | Interactive Swagger UI for all endpoints |

> **Milestone status:** all four roles are implemented and runnable end-to-end
> against one backend (SQLite or PostgreSQL). Roles are demo-gated with the
> `X-GramArogya-Role` header (asha | doctor | lab | admin).

---

## Quick start (zero setup, SQLite)

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate        # Windows (Git Bash); use bin/activate on Linux/macOS
pip install -r requirements.txt
python run.py                        # or: uvicorn app.main:app --reload
```

Open <http://localhost:8000/asha/> (ASHA PWA). Demo data is seeded
automatically on first boot. Without `DATABASE_URL` the app uses a local
SQLite file — everything works, including all endpoints.

## Quick start (PostgreSQL — production shape)

```bash
docker compose up --build
```

This starts PostgreSQL 16 + the backend. The exact PostgreSQL DDL lives in
[`backend/schema.sql`](backend/schema.sql) (canonical, with `JSONB`,
`TIMESTAMPTZ`, `CHECK` constraints). The SQLAlchemy models in
`backend/app/models.py` mirror it and run on both engines.

## Run the tests

```bash
cd backend
pytest -q
```

Tests run against an in-memory SQLite database — no infrastructure needed.
They cover the triage rule tree, offline-sync idempotency + conflict
resolution, the referral state machine, and SMS dispatch.

---

## API reference

All routes are prefixed `/api/v1`. Open `/docs` for the interactive explorer.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/triage` | Rule-based triage: symptoms + vitals → `RED`/`YELLOW`/`GREEN` + reasons + recommended action |
| POST | `/sync` | Batch-sync offline records (patient/encounter/triage). Idempotent via `client_id`; last-write-wins conflicts; triage re-evaluated server-side |
| PATCH | `/referrals/track` | Advance referral state machine (`send`→`accept`→`complete`, branches: `reject`, `no_show`); queues patient SMS on key events |
| GET/POST | `/referrals` | List / create referrals |
| GET/POST/PATCH | `/patients` | Patient CRUD + search by name or 14-digit ABHA ID |
| GET/POST | `/facilities` | HFR registry (with lat/lon for km lookups) |
| GET/PATCH | `/inventory` | Stock levels, low/out-of-stock filters |
| GET | `/inventory/medicine/{id}/availability?facility_id=` | "X units at [nearby facility] (Y km away)" — powers the doctor's out-of-stock alert |
| GET/POST | `/messages` | Pending-message queue (SMS-first, offline-aware) |
| POST | `/messages/dispatch` | Drain queue through the SMS provider (mock logs `SMS sent to +91...`) |
| GET | `/queue` | Doctor's incoming queue sorted by triage score (RED on top) |
| GET | `/patients/{id}/timeline` | Longitudinal record: encounters + triage + referrals + prescriptions |
| POST | `/prescriptions` | e-Prescription; queues an appointment-reminder SMS when `follow_up_at` is set |
| GET | `/dashboard/summary` | Referral funnel, TAT by facility (HFR ID), stock-out alerts, queued-message count |
| GET/POST | `/appointments` + `PATCH /{id}` | OPD appointments with auto token per facility/day, priority tags, status flow; `GET /appointments/queue/today` = queue board w/ est. wait |
| GET/POST | `/followups` + `PATCH /{id}` | High-risk follow-up tasks (maternal, child, diabetes, hypertension, TB, elderly) with due-today/overdue buckets |
| GET | `/lab/tests`, `GET/POST /lab/orders`, `PATCH …/status`, `POST …/results`, `POST …/report` | Diagnostic catalogue → order pipeline → structured results auto-flagged normal/high/low/critical, report upload, TAT |
| GET/POST | `/teleconsult` + `PATCH …/action` `PATCH …/notes` | Assisted teleconsult queue: video/audio/chat requests, accept/decline/start/complete, notes written to the record |
| POST | `/encounters` + `PATCH /encounters/{id}` | Doctor opens an OPD visit and writes back diagnosis/notes/advice/vitals/follow-up date |
| GET | `/dashboard/phc?facility_id=` | Live PHC board: OPD count, queue depth, RED cases, pending referrals/lab, follow-ups due, stock-outs, weekly trend |
| GET | `/dashboard/district?district=&facility_type=&date_from=&date_to=` | District roll-up + facility performance table, funnel, compliance, TAT |
| GET | `/patients/{id}/fhir` | Mock FHIR-R4-style Bundle export of the longitudinal record (interoperability) |

## Data model (loosely FHIR-shaped)

`patients` (ABHA ID + optional family ID) · `facilities` (HFR ID) ·
`encounters` · `triage_records` · `referrals` (state machine) ·
`appointments` (OPD tokens) · `follow_up_tasks` · `lab_tests`/`lab_orders`/
`lab_results` · `teleconsult_requests` · `medicines` + `inventory` ·
`prescriptions` · `pending_messages` (SMS queue). See
[`backend/schema.sql`](backend/schema.sql).

New tables are created automatically by `create_all` on startup; columns
added to pre-existing tables are migrated in `app/database.py`
(`ensure_columns`). Module demo data (OPD queue, lab pipeline, follow-ups,
teleconsults) is backfilled automatically onto already-seeded databases.

### Offline-sync conflict resolution
* **Idempotency** — every offline record carries a `client_id`; re-syncing the
  same record is a no-op (`duplicate`).
* **Conflicts** — when a natural key collides (e.g. same ABHA ID), the record
  with the **newest `updated_at` wins** (`updated` vs `conflict_resolved`).
* **Authority** — triage records are re-evaluated by the server rule engine on
  sync, so RED/YELLOW/GREEN can't be tampered with by the device.

### SMS / offline messaging
Every notification event (referral accepted, no-show follow-up, appointment
reminder) writes a row to `pending_messages` — **never** sent synchronously.
`POST /messages/dispatch` drains the queue through `get_sms_provider()`:
default `mock` logs `[MOCK SMS] SMS sent to +91XXXXXXXXXX: <text>`. To go
live, set `SMS_PROVIDER=twilio` + `TWILIO_*` env vars (swap-in ready; the
provider class is the only thing that changes).

### ASHA PWA offline behaviour
* Service worker pre-caches the app shell → works with **no connectivity**.
* Patient search falls back to an IndexedDB cache; new patients can be
  registered offline.
* Triage runs on a **local mirror of the rule engine** — identical results
  offline and online.
* The **"Simulate Network State"** toggle on the Sync page demonstrates the
  unified offline → online recovery: flipping to Online flushes pending
  patient records (`POST /sync`) **and** drains the server's queued SMS
  (`POST /messages/dispatch`) in one flow.
* Installable via **Add to Home Screen** (`manifest.json` + PWA icons served
  at runtime by the backend — no build step). Background Sync API is
  registered as an enhancement; the manual Sync Now button always works.

---

## 5-minute demo script

1. **Offline entry (ASHA PWA)** — open `/asha/`, go to **Sync**, toggle
   Network **Offline**. On the Triage page tick *Chest pain* + *Difficulty
   breathing*, SpO₂ `88`, Pulse `132` → **Assess** → **RED**. It saves
   locally and shows "saved OFFLINE".
2. **Sync** — go to Sync, toggle Network **Online**. The unified flush runs:
   records sync (`created` toast) **and** the seeded queued SMS is dispatched
   (`[MOCK SMS]` lines appear in the server console / dispatch log).
3. **Doctor sees it** — `GET /api/v1/queue` (or the doctor portal, milestone 2)
   shows the new RED patient jumping to the top with a flashing alert.
4. **Referral → admin** — `PATCH /api/v1/referrals/track` `{event: "accept"}`.
   The admin funnel (`/dashboard/summary`) moves it created → sent → accepted,
   and a confirmation SMS is queued for the patient.
5. **Admin stock-out** — the dashboard lists snake-venom serum at 0 units at
   the PHC (critical) with the nearby CHC holding stock 12 (8 km away) — the
   exact alert the doctor portal surfaces mid-prescription.

## Project layout

```
backend/
  schema.sql            # canonical PostgreSQL DDL
  app/
    main.py             # FastAPI app: routers, static mounts, seeding
    models.py           # SQLAlchemy ORM (runs on PG + SQLite)
    schemas.py          # Pydantic request/response models
    services/           # triage engine, sync conflicts, messaging, geo
    routers/            # one module per endpoint group
    seed.py             # demo data (auto-seeds on empty DB)
    icons.py            # on-the-fly PWA icon PNGs
  tests/                # pytest suite (in-memory SQLite)
frontend/
  asha-worker/          # offline-first PWA (HTML/CSS/JS + SW + IndexedDB)
  doctor-portal/        # milestone 2
  admin-dashboard/      # milestone 3
docker-compose.yml      # PostgreSQL + backend
```