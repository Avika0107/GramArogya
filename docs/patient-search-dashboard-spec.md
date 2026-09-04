# Patient Search & Dashboard Views — Field Specification

**Scope:** Patient *search → result → patient detail/dashboard* surface in the two portals:

| Portal | Surface | Tech |
|---|---|---|
| ASHA Worker Mobile App | Search (ID / name / village / QR) → Patient Card → Patient Detail sheet | `frontend/asha-worker/` PWA |
| Doctor / PHC Web Portal | Search → Patient EHR / dashboard page | `frontend/doctor-portal/` |

**Field tags used below (data readiness):**
- `[EXISTS]` — already in the data model / UI (see `backend/app/models.py`, `schemas.py`).
- `[NEW]` — field or element must be added to the model/API/UI.
- `[COMPUTED]` — derived server- or client-side; no new storage.

---

## 1. ASHA Worker Mobile App

### 1.1 Search entry
- Search box with type-ahead; accepts any of:
  - Patient Unique **Local System ID** `[NEW]` (format `MH-PHC12-2026-000123` — facility prefix + year + running number; today only the 14-digit ABHA + Family ID exist) `[EXISTS partially: abha_id, family_id]`
  - **Full / partial name** `[EXISTS]`
  - **Village / area** `[EXISTS: village]`
  - **QR scan** (ABHA QR placeholder in demo; camera scan later) `[EXISTS: demo grid]`
- Query order: local IndexedDB cache first (offline), then server `GET /api/v1/patients?q=` when online `[EXISTS]`.
- Empty state: "No beneficiary found — register new patient" + shortcut to the registration form `[EXISTS]`.

### 1.2 Search result list item (compact card)
- **Identity row:** Local ID `[NEW]` · Full name `[EXISTS]` · Age + Gender `[COMPUTED: dob]`
- **Location row:** Village name `[EXISTS]` · Household/Family ID chip `[EXISTS: family_id]`
- **Risk badge** (right edge): auto-calculated, colored `[COMPUTED]`:
  - `High Risk — ANC/Pregnant` · `High Risk — Diabetic` · `High Risk — HTN` · `High Risk — Elderly` (from `high_risk_category`) `[EXISTS]`
  - `Urgent Triage` when latest triage = RED/YELLOW `[COMPUTED: triage_records]`
  - `Routine` otherwise
- **Active referral strip** (when one exists): destination facility + status chip (Pending / Accepted / Completed) `[COMPUTED: referrals]`
- Tap → opens Patient Card (below).

### 1.3 Patient Card (primary view, shown after search/tap)
Sections stacked top → bottom:

1. **Header & Identity**
   - Patient Unique Local ID `MH-PHC12-2026-000123` (fallback: ABHA 91-XXXX-XXXX-XXXX) `[NEW / EXISTS]`
   - Full name `[EXISTS]`
   - Age (from DOB, live-calculated) + Gender label `[COMPUTED]`
   - Village · District · State · PIN `[EXISTS: pincode not shown today — add]`
   - Household/Family ID chip `[EXISTS]`
   - Primary mobile number (masked, e.g. `+91 98•••••210`, with copy button) `[EXISTS]`

2. **Health & Triage Indicators**
   - **Last recorded vitals** block with date-stamp `[NEW — capture in ASHA visit note / triage]`:
     - BP (systolic/diastolic mmHg)
     - Blood sugar (mg/dL, fasting/random flag)
     - Temperature (°C)
     - Weight (kg)
   - **Auto risk badge** (same taxonomy as 1.2) + one-line reason (e.g., "ANC — due follow-up 22 Oct") `[COMPUTED]`
   - **Latest triage summary**: color chip (RED/YELLOW/GREEN) + score + 2-line recommendation `[EXISTS: triage_records]`

3. **Active Referral Tracker** (visible when a referral is open)
   - Current destination facility (e.g., "PHC Khed") `[EXISTS]`
   - Status badge: `Pending` / `Accepted` / `Completed` (+ `Rejected`/`No-show` in history) `[EXISTS]`
   - Assigned doctor name `[EXISTS: referrals.doctor_name / referral doctor]`
   - Token / slot number (OPD token of the accepted visit) `[EXISTS: appointments.token — link by referral]`
   - Last status event + timestamp `[EXISTS: updated_at]`

4. **Diagnostic Alerts**
   - Latest lab order + status line `[COMPUTED: lab_orders]`, e.g.:
     - `CBC Report Uploaded — High Alert` (abnormal flag from structured results) `[EXISTS: lab_results flags]`
     - `Sample Collected — awaiting report`
   - Tap alert → read-only report summary (flagged values in red) `[NEW on ASHA; EXISTS on doctor/lab]`

5. **Quick Action Buttons** (persistent bottom bar of the card)
   - **Add Visit Note** — opens note sheet with **speech-to-text** (Web Speech API, local lang) `[NEW]`
   - **Generate New Referral** — opens existing referral form, pre-fills patient `[EXISTS]`
   - **Show QR Card** — full-screen ABHA/QR card of the patient `[EXISTS: placeholder]`
   - **📞 Request doctor call** — existing teleconsult action `[EXISTS]`

6. **Care history shortcut** (collapsible)
   - Count + latest of: triage records, referrals, follow-up tasks, teleconsult notes `[COMPUTED]`
   - Tap → read-only timeline (same shape as doctor EHR timeline, section 2.3)

### 1.4 My Patients / dashboard list
- Reuses 1.2 card rows filtered by: High Risk / Active Referral / Follow-up due / All `[EXISTS: filters]`
- Each row shows its most urgent badge only (no clutter) `[COMPUTED]`
- Sort: follow-up due date → risk level → name `[COMPUTED]`

---

## 2. Doctor / PHC Web Portal

### 2.1 Patient search
- Global search field in top bar: Local ID / ABHA / name / village `[EXISTS: abha+name; extend to village]`
- Result table columns: Local ID `[NEW]` · Name · Age/Gender `[COMPUTED]` · Village · Phone · Risk badge · Last visit date `[COMPUTED]` · Open patient → EHR
- Instant results (debounced server query); keyboard navigation `[EXISTS: basic list]`

### 2.2 Patient Demographic Bar (top of EHR page)
- **System Patient ID** (Local ID format + ABHA) `[NEW / EXISTS]`
- Name, Age/Gender, Village `[EXISTS]`
- **Primary phone** (unmasked for doctor; tap-to-call `tel:`) `[EXISTS]`
- **Associated ASHA worker**: name + contact shown when the patient was registered by / assigned to an ASHA worker `[NEW — add asha_worker_name/phone to patient or derive from creating record]`
- Family ID chip `[EXISTS]`
- Quick actions in bar: `Edit demographics` `[NEW]`, `Print/PDF` `[EXISTS partial: prescription print]`

### 2.3 Longitudinal EHR Timeline (middle, chronological)
One merged, time-ordered feed; each entry shows type icon + date + author role:

- **Visits/Encounters** — OPD visit, chief complaint, status `[EXISTS: encounters]`
- **Diagnoses & clinical notes** — per visit/consult `[EXISTS: encounters.notes + teleconsult notes]`
- **Triage records** — symptoms, vitals at time, RED/YELLOW/GREEN + score `[EXISTS]`
- **Prescriptions & ongoing medications** — meds + dosage + duration + follow-up date `[EXISTS]`
- **Referrals** — source, destination, status transitions `[EXISTS]`
- **Teleconsult notes** — diagnosis/advice/notes from accepted calls `[EXISTS]`
- **Follow-up tasks** — category + due date + compliance `[EXISTS]`

Layout: two-column below the bar — left = timeline feed; right = stacked panels (2.4 + 2.5 + 2.6). Timeline entries expand inline (no page reload).

### 2.4 Diagnostic & Lab Viewer (right panel / tab)
- **Ordered tests list**: test name, ordered date, status pipeline `Ordered → Sample Collected → Processing → Report Ready` `[EXISTS: lab_orders.status]`
- **Report viewer**: embedded PDF report viewer (in-app `<iframe>`/viewer, not download-first) `[EXISTS: report upload; NEW: inline viewer on doctor portal]`
- **Abnormal value highlighting**: structured numeric results flagged Normal/High/Low/Critical; critical/high rendered in red with "⚠" and reference range `[EXISTS: lab_results flags]`
- **Order new test** shortcut → opens 2.7 order form pre-scoped to patient `[EXISTS]`

### 2.5 Referral Management Box (right panel)
- Header: **Source ASHA/sub-centre name** (who referred) `[EXISTS: requested_by/asha on referral — display name]` + **priority** chip (Emergency/Urgent/Routine) `[EXISTS]`
- Patient + reason summary (collapsed → expandable) `[EXISTS]`
- Status machine strip: Created → Accepted → Completed (+ Rejected / No-show branches) `[EXISTS]`
- **Action buttons** (context-sensitive):
  - `Accept Referral` → `Assign Token Number` (auto-issued OPD token, shown in confirm toast) `[EXISTS: appointments token — wire to referral accept]`
  - `Re-route / Escalate to CHC` (changes destination facility + queues SMS) `[EXISTS partially: track events; NEW: re-route event]`
  - `Complete` / `Mark No-show` `[EXISTS]`

### 2.6 Action Panel (right panel, below referral box)
- **Digital Prescription Generator** — meds table (name/dose/duration), diagnosis, advice, follow-up date, print `[EXISTS]`
- **New Lab Test Order** — catalogue picker with stock-aware notes, submit `[EXISTS]`
- Enabled only when an encounter is open for the patient (prompt to open OPD visit) `[EXISTS: encounter gate]`

### 2.7 Layout order (page top → bottom)
1. Demographic bar (2.2)
2. Alert strip: open referral + abnormal lab + high-risk summary (one line each, color-coded)
3. Timeline (2.3, left, 60%) | right column (40%): Lab viewer (2.4) → Referral box (2.5) → Action panel (2.6)
4. Footer actions: Print EHR summary, Export (FHIR JSON already available) `[EXISTS: /patients/{id}/fhir]`

---

## Cross-cutting rules
- **Empty states** required for every panel ("No referrals", "No lab orders yet", "No prior visits").
- **Currency:** every computed block shows its data timestamp; stale vitals (> 90 days) flagged "old".
- **Phone masking:** ASHA sees masked numbers; doctor portal sees full numbers.
- **Offline:** ASHA views must render fully from IndexedDB; doctor portal is online-only.
- **i18n:** all new labels added to the existing translation tables (`app.js` en/hi/mr/bn) `[EXISTS]`.
- **Accessibility:** badges carry text (never color-only); touch targets ≥ 44 px in ASHA app.
