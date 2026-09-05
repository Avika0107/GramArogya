-- ============================================================================
-- GramArogya — PostgreSQL Schema (Smart India Hackathon prototype)
-- ---------------------------------------------------------------
-- Loosely inspired by HL7 FHIR resource shapes (Patient, Encounter,
-- Observation, MedicationRequest) — structurally similar JSON, not full FHIR.
--
-- IMPORTANT:
--   * This file is the canonical *PostgreSQL* DDL.
--   * The SQLAlchemy models in app/models.py mirror these tables and are used
--     by the running app (they also work on SQLite for zero-setup demos).
--   * UUIDs are stored as TEXT/UUID; the app generates them (Python uuid4).
--   * All timestamps are UTC.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PATIENTS  (FHIR-ish: Patient resource)
--    abha_id   = mock 14-digit ABHA (Ayushman Bharat Health Account) number
--    allergies = JSON array of strings, e.g. ["penicillin"]
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
    id            UUID PRIMARY KEY,
    abha_id       VARCHAR(14) NOT NULL UNIQUE,          -- 14-digit ABHA
    name          VARCHAR(120) NOT NULL,
    dob           DATE NOT NULL,                        -- YYYY-MM-DD
    gender        VARCHAR(10) NOT NULL,                 -- male/female/other
    phone         VARCHAR(15),                          -- e.g. +919876543210
    village       VARCHAR(120),
    district      VARCHAR(120),
    state         VARCHAR(60),
    pincode       VARCHAR(10),
    family_id     VARCHAR(40),                          -- optional family linkage
    blood_group   VARCHAR(5),                           -- A+, B-, O+, AB+ ...
    allergies     JSONB DEFAULT '[]'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- client_id lets offline PWA syncs stay idempotent (same record synced twice)
    client_id     UUID UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_patients_abha  ON patients (abha_id);
CREATE INDEX IF NOT EXISTS idx_patients_name  ON patients (name);

-- ---------------------------------------------------------------------------
-- 2. FACILITIES  (HFR = Health Facility Registry)
--    hfr_id = mock HFR ID, format: HFR<state-code>-<6 digits>, e.g. HFR09-200012
--    facility_type: sub_centre | phc | chc | district_hospital | private
--    latitude/longitude used for "nearby facility (Y km away)" lookups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facilities (
    id             UUID PRIMARY KEY,
    hfr_id         VARCHAR(20) NOT NULL UNIQUE,
    name           VARCHAR(160) NOT NULL,
    facility_type  VARCHAR(30) NOT NULL DEFAULT 'phc',
    address        VARCHAR(255),
    district       VARCHAR(120),
    state          VARCHAR(60),
    latitude       DOUBLE PRECISION,
    longitude      DOUBLE PRECISION,
    contact_phone  VARCHAR(15),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_facilities_hfr ON facilities (hfr_id);

-- ---------------------------------------------------------------------------
-- 3. ENCOUNTERS / VISITS  (FHIR-ish: Encounter)
--    One row per facility visit. diagnostic_ordered_at / diagnostic_result_at
--    drive the Diagnostic Turnaround Time (TAT) metric on the admin dashboard.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS encounters (
    id                    UUID PRIMARY KEY,
    patient_id            UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    facility_id           UUID NOT NULL REFERENCES facilities (id),
    visited_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    chief_complaint       VARCHAR(255),
    diagnosis             VARCHAR(255),                 -- filled in by doctor
    status                VARCHAR(20) NOT NULL DEFAULT 'open',   -- open | discharged
    diagnostic_ordered_at TIMESTAMPTZ,                  -- lab sample ordered
    diagnostic_result_at  TIMESTAMPTZ,                  -- lab result available
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    client_id             UUID UNIQUE                   -- offline-sync idempotency
);
CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters (patient_id);
CREATE INDEX IF NOT EXISTS idx_encounters_facility ON encounters (facility_id);

-- ---------------------------------------------------------------------------
-- 4. TRIAGE RECORDS  (FHIR-ish: Observation)
--    color = RED (emergency) / YELLOW (urgent) / GREEN (routine)
--    score  = numeric severity used to sort the doctor queue (100/50/10)
--    symptoms = JSONB map {"chest_pain": true, ...}
--    vitals   = JSONB map {"pulse": 118, "spo2": 91, "systolic_bp": 110, ...}
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS triage_records (
    id             UUID PRIMARY KEY,
    patient_id     UUID REFERENCES patients (id) ON DELETE SET NULL,  -- may be NULL for walk-ins
    facility_id    UUID REFERENCES facilities (id),
    encounter_id   UUID REFERENCES encounters (id) ON DELETE SET NULL,
    symptoms       JSONB DEFAULT '{}'::jsonb,
    vitals         JSONB DEFAULT '{}'::jsonb,
    color          VARCHAR(10) NOT NULL CHECK (color IN ('RED','YELLOW','GREEN')),
    score          INTEGER NOT NULL,
    reasons        JSONB DEFAULT '[]'::jsonb,           -- human-readable rule hits
    recommendation TEXT,
    assessed_by    VARCHAR(60) DEFAULT 'asha_worker',
    assessed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    client_id      UUID UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_triage_facility_color ON triage_records (facility_id, color, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_triage_patient ON triage_records (patient_id);

-- ---------------------------------------------------------------------------
-- 5. REFERRALS  (state machine: created -> sent -> accepted -> completed)
--                                            |          |
--                                            v          v
--                                         rejected   no_show
--    The closed-loop funnel on the admin dashboard counts by `status`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referrals (
    id               UUID PRIMARY KEY,
    patient_id       UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    from_facility_id UUID NOT NULL REFERENCES facilities (id),
    to_facility_id   UUID NOT NULL REFERENCES facilities (id),
    reason           TEXT,
    priority         VARCHAR(10) NOT NULL DEFAULT 'routine',  -- routine | urgent | emergency
    status           VARCHAR(15) NOT NULL DEFAULT 'created',
    notes            TEXT,
    client_id        UUID UNIQUE,                      -- offline sync idempotency
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at          TIMESTAMPTZ,
    accepted_at      TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    no_show_at       TIMESTAMPTZ,
    rejected_at      TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals (status);
CREATE INDEX IF NOT EXISTS idx_referrals_patient ON referrals (patient_id);

-- ---------------------------------------------------------------------------
-- 6. MEDICINES + INVENTORY  (FHIR-ish: Medication + MedicationDispense)
--    is_critical flags essential supplies (snake-venom serum, maternal kits)
--    that drive stock-out alerts on the admin dashboard.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS medicines (
    id            UUID PRIMARY KEY,
    generic_name  VARCHAR(160) NOT NULL UNIQUE,
    brand_name    VARCHAR(160),
    category      VARCHAR(60),                          -- antidote | maternal | essential ...
    is_critical   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory (
    id            UUID PRIMARY KEY,
    medicine_id   UUID NOT NULL REFERENCES medicines (id) ON DELETE CASCADE,
    facility_id   UUID NOT NULL REFERENCES facilities (id) ON DELETE CASCADE,
    stock_units   INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 10,          -- alert when stock <= this
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (medicine_id, facility_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_facility ON inventory (facility_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock   ON inventory (stock_units);

-- ---------------------------------------------------------------------------
-- 7. PRESCRIPTIONS  (FHIR-ish: MedicationRequest)
--    items = JSONB array [{medicine_id, name, dosage, duration, note}]
--    If follow_up_at is set, a reminder SMS is queued automatically.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prescriptions (
    id            UUID PRIMARY KEY,
    patient_id    UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    facility_id   UUID NOT NULL REFERENCES facilities (id),
    doctor_name   VARCHAR(120),
    items         JSONB DEFAULT '[]'::jsonb,
    follow_up_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 8. PENDING MESSAGES  (offline-aware notification queue, SMS-first)
--    Any event that must reach a patient/worker writes a row HERE first.
--    A background job / endpoint (POST /api/v1/messages/dispatch) drains the
--    queue and hands each message to the SMS provider abstraction, so a real
--    gateway (Twilio/MSG91) can be swapped in via one function.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_messages (
    id             UUID PRIMARY KEY,
    patient_id     UUID REFERENCES patients (id) ON DELETE SET NULL,
    recipient_name VARCHAR(120),
    recipient_phone VARCHAR(15) NOT NULL,
    message_text   TEXT NOT NULL,
    channel        VARCHAR(10) NOT NULL DEFAULT 'sms',  -- sms | app
    status         VARCHAR(10) NOT NULL DEFAULT 'queued', -- queued | sent | failed
    error          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_messages_status ON pending_messages (status);

-- ---------------------------------------------------------------------------
-- 9. APPOINTMENTS / OPD TOKEN QUEUE
--    Token numbers are assigned per facility + calendar day by the backend.
--    priority tags: routine | urgent | emergency | pregnant_woman | child | elderly
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id            UUID PRIMARY KEY,
    patient_id    UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    facility_id   UUID NOT NULL REFERENCES facilities (id),
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
    token         INTEGER NOT NULL DEFAULT 1,
    priority      VARCHAR(20) NOT NULL DEFAULT 'routine',
    reason        VARCHAR(255),
    status        VARCHAR(15) NOT NULL DEFAULT 'waiting',  -- waiting|in_consultation|completed|no_show
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointments_fac ON appointments (facility_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments (status);

-- ---------------------------------------------------------------------------
-- 10. HIGH-RISK FOLLOW-UP TASKS
--     category: maternal | child_immunization | diabetes | hypertension | tb | elderly
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follow_up_tasks (
    id           UUID PRIMARY KEY,
    patient_id   UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    facility_id  UUID REFERENCES facilities (id),
    category     VARCHAR(30) NOT NULL DEFAULT 'elderly',
    task         VARCHAR(255),
    due_date     DATE NOT NULL,
    assigned_to  VARCHAR(120),
    priority     VARCHAR(10) NOT NULL DEFAULT 'routine',
    status       VARCHAR(15) NOT NULL DEFAULT 'pending',  -- pending|completed|missed
    notes        TEXT,
    client_id    UUID UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fu_due ON follow_up_tasks (due_date, status);
CREATE INDEX IF NOT EXISTS idx_fu_asha ON follow_up_tasks (assigned_to);

-- ---------------------------------------------------------------------------
-- 11. LAB DIAGNOSTICS
--     LabOrder.tests = JSON snapshot [{code, name}]. LabResult carries one
--     structured value per ordered test with an auto-computed flag.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lab_tests (
    id                UUID PRIMARY KEY,
    code              VARCHAR(30) NOT NULL UNIQUE,
    name              VARCHAR(120) NOT NULL,
    category          VARCHAR(30) NOT NULL DEFAULT 'biochemistry',
    unit              VARCHAR(30),
    ref_low           DOUBLE PRECISION,
    ref_high          DOUBLE PRECISION,
    ref_critical_low  DOUBLE PRECISION,
    ref_critical_high DOUBLE PRECISION,
    is_radiology      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lab_orders (
    id                  UUID PRIMARY KEY,
    patient_id          UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    encounter_id        UUID REFERENCES encounters (id) ON DELETE SET NULL,
    facility_id         UUID REFERENCES facilities (id),
    ordered_by          VARCHAR(120),
    tests               JSONB DEFAULT '[]'::jsonb,
    status              VARCHAR(20) NOT NULL DEFAULT 'ordered',
    ordered_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    sample_collected_at TIMESTAMPTZ,
    dispatched_at       TIMESTAMPTZ,
    received_at         TIMESTAMPTZ,
    processing_at       TIMESTAMPTZ,
    ready_at            TIMESTAMPTZ,
    report_file         VARCHAR(255),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_laborders_status ON lab_orders (status);
CREATE INDEX IF NOT EXISTS idx_laborders_fac ON lab_orders (facility_id);

CREATE TABLE IF NOT EXISTS lab_results (
    id           UUID PRIMARY KEY,
    order_id     UUID NOT NULL REFERENCES lab_orders (id) ON DELETE CASCADE,
    test_code    VARCHAR(30) NOT NULL,
    test_name    VARCHAR(120) NOT NULL,
    value_text   VARCHAR(80),
    unit         VARCHAR(30),
    flag         VARCHAR(10),   -- normal|high|low|critical
    notes        TEXT,
    reported_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_labresults_order ON lab_results (order_id);

-- ---------------------------------------------------------------------------
-- 12. TELECONSULTATION
--     mode: video | audio | chat (audio = low-bandwidth default)
--     requested -> accepted -> completed | declined | cancelled
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teleconsult_requests (
    id           UUID PRIMARY KEY,
    patient_id   UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    encounter_id UUID REFERENCES encounters (id) ON DELETE SET NULL,
    facility_id  UUID REFERENCES facilities (id),
    requested_by VARCHAR(120),
    mode         VARCHAR(10) NOT NULL DEFAULT 'audio',
    reason       TEXT,
    status       VARCHAR(15) NOT NULL DEFAULT 'requested',
    doctor_name  VARCHAR(120),
    diagnosis    VARCHAR(255),
    advice       TEXT,
    notes        TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at  TIMESTAMPTZ,
    started_at   TIMESTAMPTZ,
    ended_at     TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tele_status ON teleconsult_requests (status);

-- ---------------------------------------------------------------------------
-- 13. PORTAL USERS (login/registration + doctor-approval)
--     doctor registrations start as 'pending' until a district admin
--     approves them from the admin dashboard; other roles are 'approved'
--     immediately. Passwords stored as PBKDF2 hash (never plaintext).
--     profile = JSON of role-specific registration fields (specialization,
--     regNo, phc, ashaId, empId, ...) shown on the admin approval card.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_users (
    id            UUID PRIMARY KEY,
    role          VARCHAR(10) NOT NULL,                  -- asha | doctor | admin | lab
    name          VARCHAR(120) NOT NULL,
    phone         VARCHAR(15) NOT NULL UNIQUE,
    email         VARCHAR(120),
    password_hash VARCHAR(200) NOT NULL,
    status        VARCHAR(10) NOT NULL DEFAULT 'approved', -- pending | approved | declined
    profile       JSONB DEFAULT '{}'::jsonb,
    reviewed_by   VARCHAR(120),
    reviewed_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_role_status ON portal_users (role, status);
CREATE INDEX IF NOT EXISTS idx_portal_phone ON portal_users (phone);