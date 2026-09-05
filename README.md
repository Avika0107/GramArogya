# GramArogya — Rural Healthcare Access & Quality (SIH prototype)

A unified, **low-bandwidth health ecosystem** connecting rural patients to the
healthcare system. One FastAPI + PostgreSQL backend serves three web apps:

| App | URL | Purpose |
|-----|-----|---------|
| **ASHA/ANM Worker PWA** (offline-first) | `/asha/` | ABHA-first registration (full address), digital triage (RED/YELLOW/GREEN) with emergency bypass referrals, daily follow-up tasks, offline record queue + sync, "Simulate Network State" toggle, EN/हिंदी/मराठी/বাংলা UI |
| **PHC Doctor Portal** | `/doctor/` | PHC dashboard, OPD token queue, consultation + stock-aware e-prescription, lab ordering, teleconsult (audio/video/chat), referral tracking, pharmacy |
| **Lab Technician Portal** | `/lab/` | Diagnostic order pipeline (sample → dispatch → process → ready), structured results with auto flags, report upload, turnaround time |
| **District Admin Dashboard** | `/admin/` | District roll-ups + facility performance, referral funnel, follow-up compliance, diagnostic TAT, stock-out alerts, date/type filters |
| **Home Sample Collection** | `/lab/collect.html` | Doctor-triggered blood/urine collection at home — strict test routing (radiology → OPD), technician allocation, two-visit no-show policy, masked-call proxy, audit trail, screenshot guard |
| API docs | `/docs` | Interactive Swagger UI for all endpoints |

> **Milestone status:** all four roles are implemented and runnable end-to-end
> against one backend (SQLite or PostgreSQL). Roles are demo-gated with the
> `X-GramArogya-Role` header (asha | doctor | lab | admin).
>
> **Home Sample Collection** (in the doctor + lab portals) adds: prescribed
> home collection for the blood/urine catalogue only, technician round-robin
> assignment, auto-reschedule after a first missed visit and auto-cancel +
> doctor alert after a second, masked-call proxying (no raw phone numbers in
> the UI), an audit trail, and a screenshot-protected technician view.

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
| POST | `/home-collection/prescribe` | Doctor prescribes with home-collection routing: home-collectable tests → booking, radiology → hospital OPD list, ineligible-home → 422 |
| POST | `/home-collection/assign-technician` | Technician allocation engine (round-robin or named) → `TECHNICIAN_ASSIGNED` |
| POST | `/home-collection/visit-status` | Visit events `collected` / `unavailable` / `cancel`: 1st unavailable → auto-reschedule, 2nd → `SAMPLING_CANCELLED` + doctor/patient SMS |
| POST | `/home-collection/initiate-masked-call` · `GET …/bookings/{id}/address` | Masked-call proxy bridge (numbers stay masked) + audited address reveal (`VIEW_PATIENT_ADDRESS`) |
| GET | `/home-collection/bookings` `/audit` `/technicians` | Dispatch board (masked phones), audit trail feed, phlebotomy pool |
| POST | `/encounters` + `PATCH /encounters/{id}` | Doctor opens an OPD visit and writes back diagnosis/notes/advice/vitals/follow-up date |
| GET | `/dashboard/phc?facility_id=` | Live PHC board: OPD count, queue depth, RED cases, pending referrals/lab, follow-ups due, stock-outs, weekly trend |
| GET | `/dashboard/district?district=&facility_type=&date_from=&date_to=` | District roll-up + facility performance table, funnel, compliance, TAT |
| GET | `/patients/{id}/fhir` | Mock FHIR-R4-style Bundle export of the longitudinal record (interoperability) |

## Data model (loosely FHIR-shaped)

`patients` (ABHA ID + optional family ID) · `facilities` (HFR ID) ·
`encounters` · `triage_records` · `referrals` (state machine) ·
`appointments` (OPD tokens) · `follow_up_tasks` · `lab_tests`/`lab_orders`/
`lab_results` · `teleconsult_requests` · `medicines` + `inventory` ·
`prescriptions` · `pending_messages` (SMS queue) · `lab_technicians` /
`home_collection_bookings` (home sample collection dispatch + two-visit
policy) · `audit_logs` (address reveals, status changes, masked calls). See
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

## Home Sample Collection demo (doctor → technician → patient)

1. **Doctor prescribes with home collection** — open `/doctor/patient.html?id=<id>`,
   tick **☑ Require Home Sample Collection**, keep the 🏠 home-collectable tests
   checked, also tick an ECG/X-Ray if you like, then **Save consultation**.
   Eligible tests create a `HOME_COLLECTION_PENDING` booking; radiology tests
   are returned as *hospital tests* (OPD) — they can never ride home collection
   (`POST /api/v1/home-collection/prescribe` rejects them with a 422 if asked).
2. **Technician mobile view** — open `/lab/collect.html`, pick a technician.
   Unassigned bookings appear under *Awaiting technician* → **Assign to me**
   (or use `POST /api/v1/home-collection/assign-technician` for the server's
   round-robin engine) → status becomes `TECHNICIAN_ASSIGNED` and a slot is
   auto-scheduled. Phones are masked (`+91-XXXX-XXX-3201`).
3. **At the door** — **▶ Start visit** reveals the address (audit-logged as
   `VIEW_PATIENT_ADDRESS`), then **📞 Call via proxy bridge** demonstrates the
   masked-call endpoint (no raw number is ever served to the UI).
4. **Two-visit policy** — report *Patient unavailable* once → booking
   auto-reschedules (`UNAVAILABLE_RESCHEDULED`, visit 2). Report it again →
   `SAMPLING_CANCELLED`, doctor + patient get queued SMS. *Samples collected*
   moves the underlying lab order into the normal pipeline (dispatched →
   received → processing → report ready on `/lab/`).
5. **Watch the trail** — the technician's *Audit trail* tab (or
   `GET /api/v1/home-collection/audit`) shows every sensitive action with the
   actor, timestamp and booking.

Security notes: the technician view blanks itself on print/screenshot key
combos and pins zoom (best-effort Web equivalent of Android `FLAG_SECURE`;
see the banner on `/lab/collect.html` for the native one-liner), and the
lab/doctor portals identify callers via `X-GramArogya-Role` +
`X-GramArogya-User` so the audit log can name the actor.

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