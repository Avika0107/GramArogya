"""Demo seed data — everything the 5-minute hackathon demo needs.

Run automatically on startup when the database is empty, or manually with:
    python -m app.seed

Includes:
  * 4 facilities with mock HFR IDs near Barabanki, UP (lat/lon for km lookups)
  * 6 patients with mock 14-digit ABHA IDs
  * medicines + inventory (incl. critical stock-outs: snake-venom serum,
    maternal care kit)
  * encounters + triage records (incl. one RED) + referrals in every funnel
    state, and one queued SMS so the message dispatch demo works instantly
"""

from datetime import date, datetime, timedelta

from .database import SessionLocal
from .models import (
    Appointment,
    Encounter,
    Facility,
    FollowUpTask,
    Inventory,
    LabOrder,
    LabResult,
    LabTest,
    Medicine,
    Patient,
    PendingMessage,
    Prescription,
    Referral,
    TeleconsultRequest,
    TriageRecord,
    utcnow,
)
from .services.triage import assess


def _facility(db, hfr_id: str, name: str, ftype: str, lat: float, lon: float, phone: str) -> Facility:
    f = Facility(
        hfr_id=hfr_id, name=name, facility_type=ftype,
        address=name, district="Barabanki", state="Uttar Pradesh",
        latitude=lat, longitude=lon, contact_phone=phone,
    )
    db.add(f)
    return f


def _patient(db, abha: str, name: str, dob, gender: str, phone: str,
             village: str, pincode: str = "225001", allergies=None,
             blood_group=None) -> Patient:
    # Accept 'YYYY-MM-DD' strings; pass a real date to the Date column so it
    # also works on PostgreSQL (which rejects string literals for DATE).
    if isinstance(dob, str):
        dob = date.fromisoformat(dob)
    p = Patient(
        abha_id=abha, name=name, dob=dob, gender=gender, phone=phone,
        village=village, district="Barabanki", state="Uttar Pradesh",
        pincode=pincode, allergies=allergies or [], blood_group=blood_group,
    )
    db.add(p)
    return p


def seed(db) -> None:
    # ---- Facilities ---------------------------------------------------------
    sub_centre = _facility(db, "HFR09-100001", "Gram Arogya Sub-Centre, Sanda",
                           "sub_centre", 26.9840, 81.1710, "+919811000001")
    phc = _facility(db, "HFR09-200012", "PHC Sanda (Primary Health Centre)",
                    "phc", 27.0030, 81.1880, "+919811000002")
    chc = _facility(db, "HFR09-300045", "CHC Barabanki (Community Health Centre)",
                    "chc", 26.9300, 81.1900, "+919811000003")
    dh = _facility(db, "HFR09-400078", "District Hospital Barabanki",
                   "district_hospital", 26.9250, 81.1850, "+919811000004")

    # Flush now so facility .id values exist before anything references them
    # (the session has autoflush=False, so .id stays None until a flush).
    db.flush()

    # ---- Patients (mock 14-digit ABHA IDs) ----------------------------------
    sunita = _patient(db, "91214455667701", "Sunita Devi", "1985-03-12", "female",
                      "+919876543201", "Sanda", allergies=["penicillin"], blood_group="B+")
    ram = _patient(db, "91214455667702", "Ram Prasad", "1978-11-02", "male",
                   "+919876543202", "Sanda", blood_group="O+")
    meena = _patient(db, "91214455667703", "Meena Kumari", "1995-06-24", "female",
                     "+919876543203", "Dariyapur", pincode="225203", blood_group="A+")
    abdul = _patient(db, "91214455667704", "Abdul Khan", "1969-01-15", "male",
                     "+919876543204", "Sanda", blood_group="AB+")
    geeta = _patient(db, "91214455667705", "Geeta Sharma", "2012-09-30", "female",
                     "+919876543205", "Dariyapur", pincode="225203", blood_group="O-")
    mohan = _patient(db, "91214455667706", "Mohan Lal", "1988-04-19", "male",
                     "+919876543206", "Sanda", blood_group="B+")

    db.flush()  # so patient .id values are available below

    # ---- Medicines + inventory ----------------------------------------------
    antivenom = Medicine(generic_name="Snake Venom Antiserum (Polyspecific)",
                         brand_name="Snake Venom Serum", category="antidote", is_critical=True)
    maternal = Medicine(generic_name="Oxytocin 10 IU + Misoprostol Kit",
                        brand_name="Maternal Care Kit", category="maternal", is_critical=True)
    paracetamol = Medicine(generic_name="Paracetamol 500mg", brand_name="Calpol",
                           category="essential")
    ors = Medicine(generic_name="Oral Rehydration Salts (WHO ORS)", brand_name="ORS Sachet",
                   category="essential")
    amoxicillin = Medicine(generic_name="Amoxicillin 250mg", brand_name="Amoxil",
                           category="antibiotic")
    ifa = Medicine(generic_name="Ferrous Ascorbate + Folic Acid", brand_name="IFA Tablets",
                   category="maternal")
    db.add_all([antivenom, maternal, paracetamol, ors, amoxicillin, ifa])
    db.flush()  # so medicine .id values exist before stock() rows reference them

    def stock(medicine, facility, units, reorder):
        db.add(Inventory(medicine_id=medicine.id, facility_id=facility.id,
                         stock_units=units, reorder_level=reorder))

    stock(antivenom, phc, 0, 5)        # OUT OF STOCK at PHC (critical)
    stock(antivenom, chc, 12, 5)       # available nearby -> doctor portal alert
    stock(antivenom, dh, 30, 8)
    stock(maternal, phc, 2, 5)         # low at PHC (critical)
    stock(maternal, chc, 20, 5)
    stock(maternal, dh, 45, 10)
    stock(paracetamol, phc, 400, 50)
    stock(paracetamol, sub_centre, 55, 20)
    stock(ors, phc, 120, 30)
    stock(ors, sub_centre, 28, 20)     # low at sub-centre
    stock(amoxicillin, phc, 60, 20)
    stock(ifa, phc, 300, 100)
    stock(ifa, sub_centre, 95, 40)     # low at sub-centre

    # ---- Encounters + triage (history for the timeline demo) ----------------
    now = utcnow()

    # Sunita: hypertension follow-up 3 days ago with a diagnostic TAT sample
    sunita_enc = Encounter(
        patient_id=sunita.id, facility_id=phc.id,
        visited_at=now - timedelta(days=3, hours=2),
        chief_complaint="Dizziness, known hypertension",
        diagnosis="Essential hypertension — continue medication",
        status="discharged",
        diagnostic_ordered_at=now - timedelta(days=3, hours=2),
        diagnostic_result_at=now - timedelta(days=3, hours=2) + timedelta(hours=4, minutes=30),
        notes="BP 150/95; advised low-salt diet.",
    )

    # Ram: snake bite -> RED triage (tachycardia), referral sent — his open
    # encounter is < 48h old so he tops the doctor queue with a flashing alert
    ram_enc = Encounter(
        patient_id=ram.id, facility_id=phc.id,
        visited_at=now - timedelta(hours=26),
        chief_complaint="Snake bite on right foot",
        status="open",
    )

    # Meena: ANC check-up -> referral created (funnel stage: created)
    meena_enc = Encounter(
        patient_id=meena.id, facility_id=phc.id,
        visited_at=now - timedelta(hours=5),
        chief_complaint="ANC check-up, 7th month",
        status="open",
    )

    # Geeta: fever -> YELLOW triage -> referral accepted then completed
    geeta_enc = Encounter(
        patient_id=geeta.id, facility_id=phc.id,
        visited_at=now - timedelta(days=6),
        chief_complaint="High fever with cough since 3 days",
        diagnosis="Viral fever — supportive care",
        status="discharged",
    )

    # Mohan: chest pain + hypoxia -> RED triage, referral no-show (for alerts)
    mohan_enc = Encounter(
        patient_id=mohan.id, facility_id=phc.id,
        visited_at=now - timedelta(days=9),
        chief_complaint="Chest pain, breathlessness",
        diagnosis="Suspected ACS — referred",
        status="open",
    )

    def triage(enc, patient, res, facility, symptoms, vitals):
        db.add(TriageRecord(
            patient_id=patient.id, facility_id=facility.id, encounter_id=enc.id,
            symptoms=symptoms, vitals=vitals,
            color=res["color"], score=res["score"], reasons=res["reasons"],
            recommendation=res["recommendation"], assessed_by="asha_worker",
            assessed_at=enc.visited_at + timedelta(minutes=10),
        ))

    ram_res = assess({"severe_injury": True, "high_fever": True},
                     {"pulse": 142, "systolic_bp": 110, "diastolic_bp": 70,
                      "spo2": 91, "temperature": 38.9})
    geeta_res = assess({"high_fever": True, "cough_cold": True, "fatigue": True},
                       {"pulse": 122, "systolic_bp": 100, "diastolic_bp": 65,
                        "spo2": 95, "temperature": 39.4})
    mohan_res = assess({"chest_pain": True, "difficulty_breathing": True},
                       {"pulse": 132, "systolic_bp": 96, "diastolic_bp": 60,
                        "spo2": 88, "temperature": 37.2})

    triage(ram_enc, ram, ram_res, phc, {"severe_injury": True, "high_fever": True},
           {"pulse": 142, "systolic_bp": 110, "diastolic_bp": 70, "spo2": 91,
            "temperature": 38.9})
    triage(geeta_enc, geeta, geeta_res, phc, {"high_fever": True, "cough_cold": True,
                                              "fatigue": True},
           {"pulse": 122, "systolic_bp": 100, "diastolic_bp": 65, "spo2": 95,
            "temperature": 39.4})
    triage(mohan_enc, mohan, mohan_res, phc, {"chest_pain": True, "difficulty_breathing": True},
           {"pulse": 132, "systolic_bp": 96, "diastolic_bp": 60, "spo2": 88,
            "temperature": 37.2})

    db.add_all([sunita_enc, ram_enc, meena_enc, geeta_enc, mohan_enc])
    db.flush()  # so encounter .id values exist before triage/referral rows use them

    # ---- Referrals in every funnel state ------------------------------------
    db.add_all([
        Referral(patient_id=meena.id, from_facility_id=phc.id, to_facility_id=chc.id,
                 reason="High-risk pregnancy (ANC)", priority="urgent",
                 status="created", created_at=now - timedelta(hours=4)),
        Referral(patient_id=ram.id, from_facility_id=phc.id, to_facility_id=chc.id,
                 reason="Snake bite — needs antivenom + observation", priority="urgent",
                 status="sent", created_at=now - timedelta(hours=25),
                 sent_at=now - timedelta(hours=24)),
        Referral(patient_id=geeta.id, from_facility_id=phc.id, to_facility_id=chc.id,
                 reason="Persistent high fever, suspected typhoid", priority="routine",
                 status="accepted", created_at=now - timedelta(days=6),
                 sent_at=now - timedelta(days=5, hours=20),
                 accepted_at=now - timedelta(days=5, hours=18)),
        Referral(patient_id=abdul.id, from_facility_id=chc.id, to_facility_id=dh.id,
                 reason="Diabetic foot ulcer — specialist care", priority="routine",
                 status="completed", created_at=now - timedelta(days=14),
                 sent_at=now - timedelta(days=13), accepted_at=now - timedelta(days=12),
                 completed_at=now - timedelta(days=8)),
        Referral(patient_id=mohan.id, from_facility_id=phc.id, to_facility_id=dh.id,
                 reason="Suspected ACS — cardiac evaluation", priority="emergency",
                 status="no_show", created_at=now - timedelta(days=9),
                 sent_at=now - timedelta(days=8, hours=20),
                 accepted_at=now - timedelta(days=8, hours=18),
                 no_show_at=now - timedelta(days=7)),
    ])

    # ---- Prescription sample (Sunita) ---------------------------------------
    db.add(Prescription(
        patient_id=sunita.id, facility_id=phc.id, doctor_name="Dr. Anil Verma",
        items=[
            {"medicine_id": paracetamol.id, "name": "Paracetamol 500mg",
             "dosage": "1 tab twice daily", "duration": "5 days"},
            {"medicine_id": ifa.id, "name": "IFA Tablets",
             "dosage": "1 tab daily", "duration": "90 days"},
        ],
        follow_up_at=now + timedelta(days=14),
    ))

    # ---- Queued SMS: Mohan's follow-up nudge (dispatch demo works instantly)
    db.add(PendingMessage(
        patient_id=mohan.id, recipient_name=mohan.name, recipient_phone=mohan.phone,
        message_text=("Follow-up needed: you missed your appointment at District "
                      "Hospital Barabanki. Please contact your ASHA worker. — GramArogya"),
        status="queued",
    ))
    # One already-sent message for history
    db.add(PendingMessage(
        patient_id=ram.id, recipient_name=ram.name, recipient_phone=ram.phone,
        message_text="Your referral from PHC Sanda to CHC Barabanki has been sent. "
                     "Please carry your ABHA card. — GramArogya",
        status="sent", sent_at=now - timedelta(hours=24),
    ))

    db.commit()


def seed_if_empty(db) -> bool:
    """Seed demo data only when the database has no facilities yet."""
    if db.query(Facility).count() > 0:
        return False
    seed(db)
    return True


# ---------------------------------------------------------------------------
# Module demo data (Features 3, 5, 8, 10) — backfilled on any existing DB
# ---------------------------------------------------------------------------
def _module_tables_empty(db) -> bool:
    """True when at least one module table is empty (a backfill is needed)."""
    return (
        db.query(Appointment).count() == 0
        or db.query(FollowUpTask).count() == 0
        or db.query(LabOrder).count() == 0
        or db.query(LabTest).count() == 0
        or db.query(TeleconsultRequest).count() == 0
    )


def seed_modules_if_empty(db) -> bool:
    """Backfill the module demo data onto whatever already exists.

    Runs on fresh AND existing databases, so upgrading a previously-seeded DB
    still yields a fully populated OPD queue / lab pipeline / follow-up list
    / teleconsult board. Each module only seeds when its own table is empty.
    """
    if not _module_tables_empty(db):
        return False

    by_abha = {p.abha_id: p for p in db.query(Patient).all()}
    by_hfr = {f.hfr_id: f for f in db.query(Facility).all()}

    def patient(abha: str, name: str, dob, gender: str, phone: str,
                village: str, pincode: str = "225001", blood_group: str | None = None,
                family_id: str | None = None) -> Patient:
        if abha in by_abha:
            return by_abha[abha]
        if isinstance(dob, str):
            dob = date.fromisoformat(dob)
        p = Patient(
            abha_id=abha, name=name, dob=dob, gender=gender, phone=phone,
            village=village, district="Barabanki", state="Uttar Pradesh",
            pincode=pincode, blood_group=blood_group, family_id=family_id,
            allergies=[],
        )
        db.add(p)
        by_abha[abha] = p
        return p

    def facility(hfr: str) -> Facility:
        return by_hfr[hfr]

    # Two extra demo beneficiaries so elderly/maternal queues have bodies
    ramesh = patient("91214455667707", "Ramesh Yadav", "1949-07-08", "male",
                     "+919876543207", "Sanda", family_id="FAM-225001-4")
    kamla = patient("91214455667708", "Kamla Devi", "1998-12-03", "female",
                    "+919876543208", "Dariyapur", pincode="225203",
                    family_id="FAM-225203-2")
    db.flush()

    sub_centre = facility("HFR09-100001")
    phc = facility("HFR09-200012")
    chc = facility("HFR09-300045")
    dh = facility("HFR09-400078")

    # Reference the six core demo beneficiaries (re-create them only if the
    # database predates the core seed and they are missing entirely).
    sunita = by_abha.get("91214455667701") or patient(
        "91214455667701", "Sunita Devi", "1985-03-12", "female", "+919876543201",
        "Sanda", "225001", "B+")
    ram = by_abha.get("91214455667702") or patient(
        "91214455667702", "Ram Prasad", "1978-11-02", "male", "+919876543202",
        "Sanda", "225001", "O+")
    meena = by_abha.get("91214455667703") or patient(
        "91214455667703", "Meena Kumari", "1995-06-24", "female", "+919876543203",
        "Dariyapur", "225203", "A+")
    abdul = by_abha.get("91214455667704") or patient(
        "91214455667704", "Abdul Khan", "1969-01-15", "male", "+919876543204",
        "Sanda", "225001", "AB+")
    geeta = by_abha.get("91214455667705") or patient(
        "91214455667705", "Geeta Sharma", "2012-09-30", "female", "+919876543205",
        "Dariyapur", "225203", "O-")
    mohan = by_abha.get("91214455667706") or patient(
        "91214455667706", "Mohan Lal", "1988-04-19", "male", "+919876543206",
        "Sanda", "225001", "B+")
    db.flush()

    now = utcnow()
    today = now.date()

    # ---- Lab test catalogue ------------------------------------------------
    if db.query(LabTest).count() == 0:
        db.add_all([
            LabTest(code="CBC", name="Complete Blood Count", category="hematology",
                    unit="g/dL", ref_low=12.0, ref_high=16.0, ref_critical_low=7.0),
            LabTest(code="PLT", name="Platelet Count", category="hematology",
                    unit="lakh/mm3", ref_low=1.5, ref_high=4.5, ref_critical_low=0.5),
            LabTest(code="TC", name="Total Leukocyte Count", category="hematology",
                    unit="cells/µL", ref_low=4000, ref_high=11000, ref_critical_low=1000),
            LabTest(code="FBS", name="Blood Sugar (Fasting)", category="biochemistry",
                    unit="mg/dL", ref_low=70, ref_high=100, ref_critical_low=40, ref_critical_high=450),
            LabTest(code="HBA1C", name="HbA1c", category="biochemistry",
                    unit="%", ref_low=4.0, ref_high=5.6),
            LabTest(code="LFT", name="Liver Function Test (ALT)", category="biochemistry",
                    unit="U/L", ref_low=7, ref_high=56),
            LabTest(code="CREAT", name="Serum Creatinine", category="biochemistry",
                    unit="mg/dL", ref_low=0.6, ref_high=1.2, ref_critical_high=3.0),
            LabTest(code="TSH", name="Thyroid Stimulating Hormone", category="biochemistry",
                    unit="mIU/L", ref_low=0.4, ref_high=4.5),
            LabTest(code="URINE", name="Urine Routine & Microscopy", category="urine",
                    unit="R/M", ref_low=0, ref_high=5),
            LabTest(code="MP", name="Malaria Parasite (MP smear)", category="microbiology",
                    unit="parasites/µL", ref_low=0, ref_high=0),
            LabTest(code="DENGUE", name="Dengue NS1 Antigen", category="microbiology",
                    unit="index", ref_low=0, ref_high=1),
            LabTest(code="XRAY_CHEST", name="X-Ray Chest PA", category="radiology", is_radiology=True),
            LabTest(code="USG_ABDO", name="Ultrasound Abdomen (Obstetric)", category="radiology", is_radiology=True),
            LabTest(code="ECG", name="Electrocardiogram (12-lead)", category="radiology", is_radiology=True),
        ])

    # ---- Appointments: weekly OPD volumes + today's PHC queue ----------------
    if db.query(Appointment).count() == 0:
        patients_loop = [sunita, ram, meena, abdul, geeta, mohan, ramesh, kamla]
        priority_reasons = {
            "routine": "OPD consultation", "pregnant_woman": "ANC check-up",
            "child": "Immunization / child visit", "elderly": "Elderly review",
            "urgent": "Urgent review", "emergency": "Emergency review",
        }

        def book(p, fac, day, token, priority, status, hour=9):
            db.add(Appointment(
                patient_id=p.id, facility_id=fac.id,
                scheduled_for=datetime.combine(day, datetime.min.time())
                + timedelta(hours=hour, minutes=token * 18),
                token=token, department="GMED", priority=priority,
                reason=priority_reasons.get(priority, "OPD consultation"),
                status=status,
            ))

        # Curated today queue at the PHC (token order, realistic statuses)
        book(abdul, phc, today, 1, "routine", "waiting")
        book(ramesh, phc, today, 2, "elderly", "waiting")
        book(geeta, phc, today, 3, "child", "waiting")
        book(sunita, phc, today, 4, "routine", "in_consultation", hour=9)
        book(kamla, phc, today, 5, "pregnant_woman", "no_show")
        book(meena, phc, today, 6, "pregnant_woman", "completed", hour=10)
        book(mohan, phc, today, 7, "routine", "completed", hour=10)
        book(ram, phc, today, 8, "urgent", "completed", hour=10)

        # Historical + today volume for the weekly OPD trend chart
        volume = {
            sub_centre.id: [2, 2, 3, 2, 3, 2, 4],   # oldest -> today
            phc.id:       [6, 5, 7, 6, 8, 7, 0],     # today handled above
            chc.id:       [3, 2, 4, 3, 5, 3, 6],
            dh.id:        [4, 3, 5, 4, 6, 5, 8],
        }
        for fac in (sub_centre, phc, chc, dh):
            counts = volume[fac.id]
            for day_ago, count in enumerate(reversed(counts)):
                if count == 0:
                    continue
                day = today - timedelta(days=day_ago)
                for i in range(count):
                    p = patients_loop[(day_ago * 3 + i) % len(patients_loop)]
                    priority = ["routine", "pregnant_woman", "routine", "child",
                                "elderly", "urgent"][i % 6]
                    # Past days completed; today: first half waiting, rest done
                    status = "completed" if day_ago > 0 else (
                        "completed" if i >= count // 2 else "waiting")
                    book(p, fac, day, i + 1, priority, status,
                         hour=(10 if day_ago == 0 else 9))

    # ---- Follow-up tasks ------------------------------------------------------
    if db.query(FollowUpTask).count() == 0:
        def task(p, category, due, note, status="pending", priority="routine", days_ago_done=None):
            db.add(FollowUpTask(
                patient_id=p.id, facility_id=phc.id, category=category, task=note,
                due_date=due, assigned_to="Sunita Devi", priority=priority, status=status,
                completed_at=utcnow() - timedelta(days=days_ago_done) if days_ago_done else None,
            ))

        task(meena, "maternal", today, "ANC check-up — 34 weeks gestation", priority="urgent")
        task(ramesh, "hypertension", today, "BP review + medicine refill", priority="urgent")
        task(abdul, "diabetes", today + timedelta(days=1), "Fasting sugar + foot examination")
        task(sunita, "hypertension", today + timedelta(days=3), "BP re-check at PHC")
        task(kamla, "maternal", today + timedelta(days=5), "First ANC registration & TT dose")
        task(geeta, "child_immunization", today - timedelta(days=2),
             "Measles-MR 2nd dose due", status="pending", priority="urgent")
        task(ramesh, "elderly", today - timedelta(days=1), "Home visit — mobility & fall risk")
        # Completed history
        task(meena, "maternal", today - timedelta(days=7), "ANC check-up — 30 weeks",
             status="completed", days_ago_done=7)
        task(geeta, "child_immunization", today - timedelta(days=10), "DPT booster",
             status="completed", days_ago_done=10)
        task(sunita, "hypertension", today - timedelta(days=3), "BP re-check",
             status="completed", days_ago_done=3)
        task(abdul, "diabetes", today - timedelta(days=5), "Fasting sugar + foot examination",
             status="completed", days_ago_done=5)

    # ---- Teleconsult requests -------------------------------------------------
    if db.query(TeleconsultRequest).count() == 0:
        db.add_all([
            TeleconsultRequest(
                patient_id=meena.id, facility_id=phc.id, requested_by="Sunita Devi (ASHA)",
                mode="audio", reason="7th-month pregnancy, mild leg swelling — ANC advice",
                status="requested", requested_at=now - timedelta(hours=2)),
            TeleconsultRequest(
                patient_id=abdul.id, facility_id=phc.id, requested_by="PHC Staff Nurse",
                mode="video", reason="Diabetic foot ulcer dressing review",
                status="accepted", doctor_name="Dr. Anil Verma",
                requested_at=now - timedelta(hours=5),
                accepted_at=now - timedelta(hours=4, minutes=40),
                started_at=now - timedelta(minutes=38)),
            TeleconsultRequest(
                patient_id=sunita.id, facility_id=phc.id, requested_by="Sunita Devi (ASHA)",
                mode="audio", reason="Hypertension follow-up — BP 150/95, dizziness",
                status="completed", doctor_name="Dr. Anil Verma",
                diagnosis="Essential hypertension — medication compliance good",
                advice="Continue telmisartan 40 mg; low-salt diet; review in 2 weeks",
                notes="Patient reports occasional morning dizziness. Advised sitting BP measurement.",
                requested_at=now - timedelta(days=1, hours=2),
                accepted_at=now - timedelta(days=1, hours=1, minutes=50),
                started_at=now - timedelta(days=1, hours=1, minutes=45),
                ended_at=now - timedelta(days=1, hours=1, minutes=8)),
        ])

    # ---- Lab orders at every pipeline stage -------------------------------------
    if db.query(LabOrder).count() == 0:
        def order(p, fac, tests, status, hours_ago, ready_hours_after=0):
            o = LabOrder(
                patient_id=p.id, facility_id=fac.id, ordered_by="Dr. Anil Verma",
                tests=[{"code": c[0], "name": c[1]} for c in tests],
                status=status, ordered_at=now - timedelta(hours=hours_ago),
            )
            db.add(o)
            db.flush()
            if status == "sample_collected":
                o.sample_collected_at = o.ordered_at + timedelta(minutes=25)
            elif status == "dispatched":
                o.sample_collected_at = o.ordered_at + timedelta(minutes=25)
                o.dispatched_at = o.ordered_at + timedelta(hours=1, minutes=5)
            elif status == "received":
                o.sample_collected_at = o.ordered_at + timedelta(minutes=25)
                o.dispatched_at = o.ordered_at + timedelta(hours=1, minutes=5)
                o.received_at = o.ordered_at + timedelta(hours=2)
            elif status == "processing":
                o.sample_collected_at = o.ordered_at + timedelta(minutes=25)
                o.dispatched_at = o.ordered_at + timedelta(hours=1, minutes=5)
                o.received_at = o.ordered_at + timedelta(hours=2)
                o.processing_at = o.ordered_at + timedelta(hours=2, minutes=40)
            elif status == "report_ready":
                o.sample_collected_at = o.ordered_at + timedelta(minutes=25)
                o.dispatched_at = o.ordered_at + timedelta(hours=1, minutes=5)
                o.received_at = o.ordered_at + timedelta(hours=2)
                o.processing_at = o.ordered_at + timedelta(hours=2, minutes=40)
                o.ready_at = o.ordered_at + timedelta(hours=ready_hours_after or 4)
            return o

        geeta_cbc = order(geeta, phc, [("CBC", "Complete Blood Count"), ("PLT", "Platelet Count"),
                                       ("MP", "Malaria Parasite (MP smear)")], "ordered", 1.2)
        abdul_fbs = order(abdul, phc, [("FBS", "Blood Sugar (Fasting)"), ("HBA1C", "HbA1c")],
                          "sample_collected", 3)
        ramesh_rft = order(ramesh, phc, [("CREAT", "Serum Creatinine"), ("FBS", "Blood Sugar (Fasting)")],
                           "dispatched", 4.5)
        meena_lft = order(meena, phc, [("LFT", "Liver Function Test (ALT)"),
                                       ("USG_ABDO", "Ultrasound Abdomen (Obstetric)")],
                          "received", 5)
        kamla_tsh = order(kamla, phc, [("CBC", "Complete Blood Count"), ("TSH", "Thyroid Stimulating Hormone")],
                          "processing", 6)
        sunita_done = order(sunita, phc, [("CBC", "Complete Blood Count"),
                                          ("FBS", "Blood Sugar (Fasting)")],
                            "report_ready", 26, ready_hours_after=3.7)
        ramesh_chc = order(ramesh, chc, [("CBC", "Complete Blood Count"), ("CREAT", "Serum Creatinine"),
                                         ("ECG", "Electrocardiogram (12-lead)")],
                           "report_ready", 50, ready_hours_after=4.3)

        def result(o, code, name, value, unit, flag=None):
            db.add(LabResult(order_id=o.id, test_code=code, test_name=name,
                             value_text=value, unit=unit, flag=flag,
                             reported_at=o.ready_at or utcnow()))

        result(sunita_done, "CBC", "Complete Blood Count", "13.1", "g/dL", "normal")
        result(sunita_done, "FBS", "Blood Sugar (Fasting)", "92", "mg/dL", "normal")
        result(ramesh_chc, "CBC", "Complete Blood Count", "14.2", "g/dL", "normal")
        result(ramesh_chc, "CREAT", "Serum Creatinine", "1.6", "mg/dL", "high")
        result(ramesh_chc, "ECG", "Electrocardiogram (12-lead)", "Normal sinus rhythm", None)


    # ---- One more open consultation (Sunita) so the doctor has a live queue ---
    # Guarded so a re-run (partial backfill) never opens a duplicate visit.
    if db.query(Encounter).filter(
        Encounter.patient_id == sunita.id, Encounter.status == "open"
    ).count() == 0:
        sunita_enc = Encounter(
            patient_id=sunita.id, facility_id=phc.id,
            visited_at=now - timedelta(minutes=30),
            chief_complaint="Hypertension follow-up — BP 150/95, occasional dizziness",
            status="open",
        )
        db.add(sunita_enc)
        db.flush()
        db.add(TriageRecord(
            patient_id=sunita.id, facility_id=phc.id, encounter_id=sunita_enc.id,
            symptoms={}, vitals={"pulse": 84, "systolic_bp": 150, "diastolic_bp": 95,
                                 "spo2": 98, "temperature": 36.8},
            color="GREEN", score=10,
            reasons=["No RED/YELLOW findings — vitals within normal range"],
            recommendation="ROUTINE: Home care advice. Schedule a routine PHC visit if symptoms continue beyond 48 hours.",
            assessed_by="asha_worker", assessed_at=now - timedelta(minutes=25),
        ))

    db.commit()
    return True


if __name__ == "__main__":
    db = SessionLocal()
    try:
        if seed_if_empty(db):
            print("Seeded demo data.")
        else:
            print("Database already has data — nothing to do.")
    finally:
        db.close()