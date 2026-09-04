/* GramArogya ASHA Worker PWA — shared app logic.
 *
 *  * "Simulate Network State" toggle: when OFFLINE every API call fails fast
 *    and records queue in IndexedDB; when toggled back ONLINE a single sync
 *    flushes patient records AND drains the server's queued SMS messages.
 *  * ABHA-first registration: the worker first asks whether the beneficiary
 *    already has an ABHA ID. If yes, the existing 14-digit ID is entered
 *    together with the beneficiary's details + full address. If no, a new
 *    ABHA ID is generated in ABHA format from the enrolment details (name,
 *    gender, DOB, mobile, full address) — SIMULATED for the demo; linking to
 *    the real ABHA (ABDM) app is a later milestone.
 *  * Multilingual UI: English, Hindi, Marathi, Bengali (persisted per device).
 *  * The triage rules below mirror backend/app/services/triage.py so assessment
 *    works fully offline (the server re-evaluates on sync).
 */

const API_BASE = '/api/v1';
const PAGE = document.body.dataset.page || 'index';
const LANGS = ['en', 'hi', 'mr', 'bn'];
const LANG_KEY = 'gramarogya_lang';

let lastShownPatient = null; // re-render (translated) on language switch
let lastTriageData = null;   // {symptoms, vitals} to recompute on language switch

/* ------------------------------------------------------------------ */
/* i18n — English (default), Hindi, Marathi, Bengali                  */
/* ------------------------------------------------------------------ */
const I18N = {
  en: {
    // tasks page + family ID + emergency escalation (Feature 3/4/10)
    'title.tasks': '🩺 GramArogya · My Tasks',
    'nav.task': 'My Tasks',
    'hint.tasks': '<b>Daily follow-up list</b> High-risk follow-ups assigned to you (maternal, child immunization, diabetes, hypertension, TB, elderly). Mark tasks done — they sync to the PHC and update the dashboards.',
    'lbl.family': 'Family ID (optional)',
    'tasks.stat.due_today': 'Due today',
    'tasks.stat.upcoming': 'Upcoming',
    'tasks.stat.overdue': 'Overdue',
    'tasks.stat.completed': 'Completed',
    'tasks.loading': 'Loading tasks…',
    'tasks.offline_cached': 'Showing offline snapshot — sync to refresh',
    'tasks.empty': 'No {0} follow-ups',
    'tasks.due': 'Due {0}',
    'tasks.cat': '{0} care',
    'tasks.mark_done': '✓ Mark done',
    'tasks.done_offline': 'Saved offline — will sync later',
    'tasks.done_synced': 'Follow-up completed & synced',
    'tasks.done_failed': 'Could not save: {0}',
    'emer.title': '🚨 Emergency — bypass the regular queue',
    'emer.to': 'Refer to',
    'emer.auto': 'District Hospital (auto if unselected)',
    'emer.reason_ph': 'Reason (e.g. chest pain with breathlessness)',
    'emer.btn': 'Create emergency referral',
    'emer.no_abha': 'Enter the 14-digit ABHA ID above so the referral attaches to the patient',
    'emer.created_offline': 'Emergency referral queued — sync to send',
    'emer.created_synced': 'Emergency referral created & synced',

    // teleconsult (Feature 5) — request a doctor call for the shown patient
    'btn.tele': '📞 Request doctor call',
    'tele.title': 'Request doctor teleconsult',
    'tele.patient': 'Patient: {0}',
    'tele.mode': 'Call mode',
    'tele.mode.audio': 'Audio (low bandwidth)',
    'tele.mode.video': 'Video',
    'tele.mode.chat': 'Chat / notes only',
    'tele.reason': 'Reason for the call',
    'tele.reason_ph': 'e.g. high fever since 2 days, needs doctor advice',
    'tele.request': 'Request call',
    'tele.queued': 'Call request saved — will sync when online',
    'tele.sent': 'Call request sent to the doctor',
    'tele.no_patient': 'Search or register a patient first',
    'tele.status.requested': 'Waiting for the doctor to accept the call',
    'tele.status.accepted': '{0} accepted the call — starting soon',
    'tele.status.live': 'Call is live — join with the patient now',
    'tele.status.declined': 'The doctor declined this request',
    'tele.status.completed': 'Call completed',
    'tele.doctor': 'The doctor',
    'tele.join': 'Join call',
    'tele.notify.accepted': '{0} accepted the call — get ready to join',
    'tele.notify.live': '📞 The doctor started the call — tap Join call now',
    'tele.notify.declined': 'The doctor declined this call request',
    'type.referral': 'referral',
    'type.followup': 'follow-up',
    'type.teleconsult': 'teleconsult',

    // new features: dashboard, referrals, tasks, SOS, sync
    'nav.referrals': 'Referrals',
    'title.referral': '🩺 GramArogya · New Referral',
    'title.tracking': '🩺 GramArogya · Referrals',
    'hint.referral': '<b>Create a referral</b> Send a patient to a higher facility (CHC / district hospital). Saved on this device first, syncs to the PHC when online. The latest triage is attached automatically when available.',
    'hint.tracking': '<b>Referral tracking</b> Follow every referral you have sent: Sent → Accepted → Completed. Offline referrals appear here as soon as they are queued.',
    'lbl.age': 'Age (optional, if DOB unknown)',
    'reg.highrisk': 'High-risk category (select all that apply)',
    'reg.allergies': 'Allergies (optional)',
    'reg.allergies_ph': 'e.g. penicillin, peanuts',
    'reg.chronic_conditions': 'Chronic conditions (optional)',
    'reg.chronic_ph': 'e.g. TB, asthma, diabetes',
    'hr.pregnant': 'Pregnant',
    'hr.diabetic': 'Diabetic',
    'hr.htn': 'High BP (HTN)',
    'hr.elderly': 'Elderly (65+)',
    'hr.chronic': 'Chronic Disease',
    'mp.title': '👥 My Patients',
    'mp.search_ph': 'Search by name, ABHA ID or village…',
    'mp.f.all': 'All',
    'mp.f.highrisk': 'High-risk',
    'mp.f.followups': 'Follow-ups due',
    'mp.f.pending': 'Pending sync',
    'mp.empty': 'No patients registered yet. Register your first patient!',
    'mp.view': 'View Record',
    'mp.new_triage': 'New Triage',
    'mp.pending': 'Pending sync',
    'mp.synced': 'Synced',
    'mp.fu_due': 'Follow-up due this week',
    'ref.title': 'New Referral',
    'ref.patient': 'Patient',
    'ref.patient_ph': 'Search patient name or ABHA…',
    'ref.reason': 'Reason for referral',
    'ref.r.specialist': 'Specialist Consultation Needed',
    'ref.r.diagnostics': 'Diagnostic Tests Required',
    'ref.r.emergency': 'Emergency Care',
    'ref.r.routine': 'Routine Checkup',
    'ref.r.pregnancy': 'Pregnancy Complication',
    'ref.r.chronic': 'Chronic Disease Management',
    'ref.priority': 'Priority',
    'ref.p.routine': '🟢 Routine',
    'ref.p.urgent': '🟡 Urgent',
    'ref.p.emergency': '🔴 Emergency',
    'ref.facility': 'Refer to facility',
    'ref.facility_ph': 'Select facility…',
    'ref.notes': 'Additional notes (optional)',
    'ref.notes_ph': 'e.g. reports to carry, escort needed…',
    'ref.submit': 'Send Referral',
    'ref.need_patient': 'Select a patient first',
    'ref.need_facility': 'Select a facility first',
    'ref.sent_synced': 'Referral sent! The PHC will review shortly',
    'ref.sent_queued': 'Referral saved on device — will sync when online',
    'ref.triage_pending': 'Attaching {0} pending local triage report(s)',
    'ref.triage_attached': 'Latest triage attached: {0} ({1})',
    'track.title': 'Referral Tracking',
    'track.new': '+ New Referral',
    'track.f.sent': '🟡 Sent',
    'track.f.accepted': '🟢 Accepted',
    'track.f.completed': '🔵 Completed',
    'track.f.noshow': '🔴 No-show',
    'track.f.rejected': 'Rejected',
    'track.empty': 'No referrals created yet',
    'track.to_phc': 'PHC (pending sync)',
    'track.details': 'View Details',
    'track.contact': 'Contact PHC',
    'track.status': 'Status',
    'track.accepted': 'Accepted',
    'track.completed': 'Completed',
    'track.accepted_on': 'Accepted on {0}',
    'track.s.sent': 'Sent',
    'track.s.accepted': 'Accepted',
    'track.s.completed': 'Completed',
    'track.s.no_show': 'No-show',
    'track.s.rejected': 'Rejected',
    'track.s.pending_sync': 'Pending sync',
    'track.s.created': 'Created',
    'tasks.overdue_count': '{0} overdue follow-ups',
    'tasks.overdue_by': '{0} days overdue',
    'tasks.days_left': '{0} days left',
    'tasks.due_today': 'Due today',
    'tasks.resched': 'Reschedule',
    'tasks.resched_online': 'Connect to the internet to reschedule',
    'tasks.need_date': 'Pick a new due date',
    'tasks.resched_done': 'Follow-up rescheduled',
    'tasks.done_title': 'Mark follow-up completed',
    'tasks.vitals': 'Vitals recorded (BP, sugar, weight…)',
    'tasks.advised': 'Patient advised',
    'tasks.meds': 'Medicines delivered',
    'tasks.notes': 'Notes (optional)',
    'tasks.notes_ph': 'e.g. BP 130/85, advised salt restriction…',
    'tasks.confirm_done': 'Confirm completed',
    'tasks.all_checks': 'Vitals recorded, patient advised, medicines delivered',
    'tasks.resched_title': 'Reschedule follow-up',
    'tasks.new_date': 'New due date',
    'tasks.confirm_resched': 'Reschedule',
    'sos.btn': 'SOS',
    'sos.title': '🚨 Emergency SOS',
    'sos.patient': 'Patient',
    'sos.select_patient': 'Select patient…',
    'sos.type': 'Emergency type',
    'sos.t.chest': '🫀 Chest Pain',
    'sos.t.stroke': '🧠 Stroke',
    'sos.t.bleed': '🩸 Severe Bleeding',
    'sos.t.uncon': '😵 Unconscious',
    'sos.t.preg': '🤰 Pregnancy Complication',
    'sos.t.conv': '🤒 High Fever + Convulsions',
    'sos.t.other': '🚑 Other',
    'sos.location': 'Location (GPS auto-filled)',
    'sos.details': 'Additional details (optional)',
    'sos.details_ph': 'Describe what happened…',
    'sos.send': 'Send Emergency Alert',
    'sos.confirm_txt': 'Are you sure? This is for emergencies only.',
    'sos.confirm_yes': 'Yes, send alert',
    'sos.need_patient': 'Select the patient first',
    'sos.need_type': 'Select the emergency type',
    'sos.sent': 'Emergency alert sent!',
    'sos.synced': 'Emergency referral created & synced to the PHC',
    'sos.queued': 'Alert queued on this device — will sync when online',
    'sos.eta': 'Ambulance ETA: 15 minutes',
    'sos.call_phc': 'Call PHC',
    'sos.call_patient': 'Call patient',
    'sync.status_title': 'Sync status',
    'sync.total': 'Total pending',
    'sync.progress': 'Syncing batch {0} of {1}…',
    'sync.starting': 'Starting sync…',
    'sync.auto_sync': 'Internet restored. Syncing pending data…',
    'sync.failed': '⚠️ Failed items',
    'sync.retry_all': 'Retry All',
    'sync.retry': 'Retry',
    'sync.delete': 'Delete',
    'sync.failed_short': 'Failed',
    'sync.pending_short': 'Pending',
    'th.detail': 'Patient',
    'call.title': 'Call',
    'call.dial': 'Call now',
    'call.copy': 'Copy number',
    'call.copied': 'Number copied',
    'call.copy_fail': 'Could not copy — note the number manually',
    'call.no_number': 'No phone number on file',
    'asha_phone.title': 'My mobile number (SMS alerts)',
    'asha_phone.hint': "You'll get an SMS here when a referral you sent is accepted, rejected, or marked no-show.",
    'asha_phone.save': 'Save',
    'asha_phone.saved': 'Saved — SMS alerts will be sent here',
    'asha_phone.cleared': 'Cleared',

    // headers / nav
    'title.index': '🩺 GramArogya · ASHA',
    'title.triage': '🩺 GramArogya · Triage',
    'title.sync': '🩺 GramArogya · Sync',
    'nav.search': 'Patient Search',
    'nav.triage': 'Triage',
    'nav.sync': 'Sync',
    'pill.online': 'online',
    'pill.offline': 'offline',

    // index page
    'hint.index': '<b>Offline-first</b> Works without internet. Enter a 14-digit ABHA ID, or scan the placeholder QR below. Records save locally and sync when you toggle back Online.',
    'find.title': 'Find patient by ABHA ID',
    'ph.abha_search': '14-digit ABHA (e.g. 91214455667701)',
    'find.btn': 'Search patient',
    'reg.title': 'New patient registration (works offline)',
    'reg.question': 'Does the beneficiary already have an ABHA ID?',
    'reg.has_yes': 'Yes — has ABHA ID',
    'reg.has_no': 'No — create one',
    'lbl.abha': 'ABHA ID (14 digits)',
    'abha.title': 'Create new ABHA ID from the details below',
    'abha.desc': 'These are the same fields the official ABHA enrolment form asks (name, gender, date of birth, mobile number, full address). A 14-digit ABHA ID is generated in ABHA format and saved with the patient record. <i>Demo note: the ID is simulated — linking to the real ABHA (ABDM) app comes later.</i>',
    'lbl.name': 'Full name',
    'lbl.dob': 'Date of birth',
    'lbl.gender': 'Gender',
    'lbl.phone': 'Mobile number',
    'lbl.village': 'Village / Area',
    'lbl.district': 'District',
    'lbl.state': 'State',
    'lbl.pincode': 'PIN code',
    'btn.save': 'Save patient locally',
    'btn.create': 'Create ABHA & save patient',
    'g.female': 'Female',
    'g.male': 'Male',
    'g.other': 'Other',
    'no_patient': 'No patient found.',
    'card.unknown': 'Unknown',
    'unit.yrs': 'yrs',
    'alert.allergy': '⚠ Allergies: {0}',

    // QR modal
    'qr.title': 'Demo QR scanner (placeholder)',
    'qr.desc': 'In production this would read the ABHA QR code printed on the beneficiary\u2019s card. Tap a card to simulate a scan:',
    'btn.close': 'Close',

    // triage page
    'hint.triage': '<b>Digital Triage Calculator</b> Tick symptoms and enter vitals, then tap <b>Assess</b>. Runs locally — works fully offline. Results sync to the PHC doctor queue when back online.',
    'patient.title': 'Patient',
    'lbl.abha_opt': 'ABHA ID (optional)',
    'triage.symptoms': 'Symptoms',
    'triage.vitals': 'Vitals',
    'v.pulse': 'Pulse (bpm)',
    'v.spo2': 'SpO\u2082 (%)',
    'v.sbp': 'Systolic BP',
    'v.dbp': 'Diastolic BP',
    'v.temp': 'Temperature (\u00b0C)',
    'v.rr': 'Resp. rate (/min)',
    'btn.assess': 'Assess patient',
    'btn.reset': '🗑 New patient — clear all',
    'btn.reset.done': 'Form cleared — ready for the next patient',
    'ci.title': '🩺 OPD check-in / token',
    'ci.hint': 'Book the OPD slot and get the GA-… token. Needs internet — tokens are issued by the PHC server.',
    'ci.priority': 'Priority',
    'ci.btn': '🎫 Generate OPD token',
    'ci.badabha': 'Enter a valid 14-digit ABHA ID first.',
    'ci.offline': 'You are offline — OPD tokens are issued by the PHC server. Triage is still saved offline.',
    'ci.thinking': 'Booking the OPD slot…',
    'ci.notfound': 'Patient not found — save the patient first.',
    'ci.nofac': 'No facility available for check-in.',
    'ci.failed': 'Token failed: {0}',
    'ci.wait': 'est. wait ~{0} min',
    'sym.chest_pain': 'Chest pain',
    'sym.difficulty_breathing': 'Difficulty breathing',
    'sym.unconscious': 'Unconscious / not responding',
    'sym.severe_bleeding': 'Severe bleeding',
    'sym.stiff_neck': 'Stiff neck',
    'sym.pregnancy_complication': 'Pregnancy complication',
    'sym.high_fever': 'High fever',
    'sym.continuous_vomiting': 'Continuous vomiting',
    'sym.severe_headache': 'Severe headache',
    'sym.dehydration': 'Dehydration signs',
    'sym.severe_abdominal_pain': 'Severe abdominal pain',
    'sym.severe_injury': 'Severe injury / fracture',
    'sym.abdominal_pain': 'Abdominal pain',
    'sym.diarrhea': 'Diarrhea',
    'sym.cough_cold': 'Cough / cold',
    'sym.fatigue': 'Fatigue / weakness',
    'sym.body_ache': 'Body ache',
    'sym.urination_problem': 'Frequent / painful urination',
    'sym.sore_throat': 'Sore throat / throat pain',
    'sym.joint_pain': 'Joint pain / swelling',
    'sym.back_pain': 'Back pain',
    'sym.skin_rash': 'Skin rash / itching',
    'sym.eye_problem': 'Eye redness / watering / pain',
    'sym.ear_pain': 'Ear pain / discharge',
    'sym.dizziness': 'Dizziness / giddiness',
    'sym.acidity': 'Acidity / indigestion / gas',
    'sym.constipation': 'Constipation',
    'sym.toothache': 'Toothache / gum problem',
    'sym.numbness': 'Numbness / tingling',
    'sym.swelling': 'Swelling (face / hands / feet)',
    'color.RED': 'RED',
    'color.YELLOW': 'YELLOW',
    'color.GREEN': 'GREEN',
    'priority': 'Priority {0}',
    'action': 'Action',
    'reason.symptom': 'Symptom: {0}',
    'reason.spo2_critical': 'SpO2 {0}% — critical hypoxia (< 90%)',
    'reason.pulse_critical': 'Pulse {0} bpm (outside 40\u2013140)',
    'reason.sbp_critical': 'Systolic BP {0} mmHg (\u2264 90 or \u2265 180)',
    'reason.temp_critical': 'Temperature {0}\u00b0C (hyperpyrexia, \u2265 41)',
    'reason.rr_critical': 'Respiratory rate {0}/min (outside 8\u201330)',
    'reason.spo2_border': 'SpO2 {0}% (90\u201393%, borderline)',
    'reason.pulse_border': 'Pulse {0} bpm (borderline)',
    'reason.sbp_border': 'Systolic BP {0} mmHg (borderline)',
    'reason.temp_border': 'Temperature {0}\u00b0C (high fever, 39\u201341)',
    'reason.multi_moderate': 'Multiple moderate symptoms: {0}',
    'reason.no_findings': 'No RED/YELLOW findings — vitals within normal range',
    'rec.red': 'EMERGENCY: Arrange immediate transport / call 108. Do not move the patient unnecessarily. Inform the nearest hospital NOW.',
    'rec.yellow': 'URGENT: Advise the patient to reach the PHC today. Re-assess vitals in 4 hours if symptoms persist or worsen.',
    'rec.green': 'ROUTINE: Home care advice. Schedule a routine PHC visit if symptoms continue beyond 48 hours.',

    // sync page
    'hint.sync': '<b>Simulate Network State</b> Toggle the switch to demo the full offline \u2192 online recovery: while <b>Offline</b>, every record queues on this device. Flipping back to <b>Online</b> flushes patient records to the backend <i>and</i> fires the server\u2019s queued SMS messages in one flow.',
    'net.online_label': 'Network: Online',
    'net.offline_label': 'Network: Offline',
    'net.sub.online': 'Records sync immediately',
    'net.sub.offline': 'Records queue locally until you toggle Online',
    'sync.pending': 'Pending local records',
    'sync.msgqueue': 'Server message queue',
    'sync.last': 'Last sync',
    'sync.never': 'Never',
    'th.type': 'Type',
    'th.created': 'Created',
    'th.status': 'Status',
    'btn.sync_now': 'Sync Now \u2192',
    'summary.empty': 'No unsynced records — all caught up.',
    'summary.pending': '{0} record(s) waiting to sync: {1}',
    'type.patient': 'patient',
    'type.encounter': 'encounter',
    'type.triage': 'triage',
    'status.queued': 'queued',
    'msg.queued': 'Queued SMS: {0} waiting for dispatch',
    'msg.queued_offline': 'Queued SMS: — (offline; check when back online)',

    // toasts + messages
    't.valid_abha': 'Enter a valid 14-digit ABHA ID',
    't.not_found': 'Patient not found',
    't.not_found_offline': 'Patient not found (offline cache miss)',
    't.loaded_server': 'Patient loaded from server',
    't.loaded_cache': 'Patient loaded from local cache',
    't.qr_scanned': 'QR scanned: {0}',
    't.fill_required': 'Please fill the required fields: {0}',
    't.phone_invalid': 'Enter a valid 10-digit mobile number',
    't.pincode_invalid': 'Enter a valid 6-digit PIN code',
    't.saved_synced': 'Saved + synced ({0} created)',
    't.saved_offline': 'Saved locally — will sync when back online',
    't.sync_failed': 'Saved locally; sync failed: {0}',
    't.abha_created': 'Simulated ABHA ID created: {0}',
    't.dup_local': 'A patient with this ABHA ID already exists on this device',
    't.triage_saved': 'Triage saved + synced ({0} record(s) created)',
    't.triage_offline': 'Triage saved OFFLINE — toggle Online to sync to the doctor queue',
    't.net_online': 'Network ONLINE — flushing pending records + SMS queue\u2026',
    't.net_offline': 'Network OFFLINE — new records will queue on this device',
    't.toggle_first': 'Toggle network to Online first',
    't.sync_done': 'Sync complete: {0} created, {1} updated \u00b7 {2} SMS dispatched',
    't.sync_fail': 'Sync failed: {0}',
    't.bg_sync_done': 'Background sync: {0} created',
    'abha.step1.title': 'Create ABHA ID using Aadhaar',
    'abha.step1.desc': 'The beneficiary name and Aadhaar number are verified against ABDM (in production through an Aadhaar OTP). <i>Demo note: simulated — the Aadhaar number is never stored or sent.</i>',
    'abha.aadhaar_name': 'Full name (as on Aadhaar)',
    'abha.aadhaar': 'Aadhaar number (12 digits)',
    'abha.create_btn': 'Create ABHA ID',
    'abha.created_title': '✅ ABHA ID created',
    'abha.created_next': 'Now complete the beneficiary details below and save the patient.',
    'abha.aadhaar_invalid': 'Enter a valid 12-digit Aadhaar number',
    'abha.create_first': 'Create the ABHA ID first',
    'card.health': 'Health details',
    'card.hr': 'High-risk',
    'card.chronic': 'Chronic conditions',
    'card.latest': 'Latest triage',
    'card.referral': 'Referral',
    'card.followup': 'Next follow-up',
    'card.none': 'No health records yet — run a triage or add a visit note',
  },

  hi: {
    'title.tasks': '🩺 ग्रामआरोग्य · मेरे कार्य',
    'nav.task': 'मेरे कार्य',
    'hint.tasks': '<b>दैनिक फ़ॉलो-अप सूची</b> आपको सौंपे गए उच्च-जोखिम फ़ॉलो-अप (मातृत्व, बाल टीकाकरण, मधुमेह, उच्च रक्तचाप, TB, वृद्ध)। कार्य पूर्ण चिह्नित करें — वे PHC में सिंक होते हैं और डैशबोर्ड अपडेट करते हैं।',
    'lbl.family': 'पारिवारिक ID (वैकल्पिक)',
    'tasks.stat.due_today': 'आज देय',
    'tasks.stat.upcoming': 'आगामी',
    'tasks.stat.overdue': 'विलंबित',
    'tasks.stat.completed': 'पूर्ण',
    'tasks.loading': 'कार्य लोड हो रहे हैं…',
    'tasks.offline_cached': 'ऑफ़लाइन सूची दिख रही है — ताज़ा करने के लिए सिंक करें',
    'tasks.empty': 'कोई {0} कार्य नहीं',
    'tasks.due': 'देय: {0}',
    'tasks.cat': '{0} देखभाल',
    'tasks.mark_done': '✓ पूर्ण किया',
    'tasks.done_offline': 'ऑफ़लाइन सहेजा गया — बाद में सिंक होगा',
    'tasks.done_synced': 'फ़ॉलो-अप पूर्ण व सिंक हो गया',
    'tasks.done_failed': 'सहेजा नहीं जा सका: {0}',
    'emer.title': '🚨 आपातकालीन उपचार — सामान्य कतार छोड़ें',
    'emer.to': 'रिफ़र करें (सुविधा)',
    'emer.auto': 'जिला अस्पताल (न चुनने पर स्वतः)',
    'emer.reason_ph': 'कारण (जैसे सीने में दर्द व साँस फूलना)',
    'emer.btn': 'आपातकालीन रिफ़रल बनाएँ',
    'emer.no_abha': 'ऊपर 14 अंकीय ABHA ID डालें ताकि रिफ़रल मरीज़ से जुड़े',
    'emer.created_offline': 'आपातकालीन रिफ़रल कतार में — भेजने के लिए सिंक करें',
    'emer.created_synced': 'आपातकालीन रिफ़रल बना व सिंक हुआ',

    // teleconsult (Feature 5) — request a doctor call for the shown patient
    'btn.tele': '📞 डॉक्टर कॉल का अनुरोध करें',
    'tele.title': 'डॉक्टर से टेलीकंसल्टेशन का अनुरोध',
    'tele.patient': 'मरीज़: {0}',
    'tele.mode': 'कॉल का तरीका',
    'tele.mode.audio': 'ऑडियो (कम बैंडविड्थ)',
    'tele.mode.video': 'वीडियो',
    'tele.mode.chat': 'चैट / केवल नोट्स',
    'tele.reason': 'कॉल का कारण',
    'tele.reason_ph': 'जैसे 2 दिन से तेज़ बुखार, डॉक्टर की सलाह चाहिए',
    'tele.request': 'कॉल का अनुरोध करें',
    'tele.queued': 'कॉल अनुरोध सहेजा गया — ऑनलाइन होने पर सिंक होगा',
    'tele.sent': 'कॉल अनुरोध डॉक्टर को भेज दिया गया',
    'tele.no_patient': 'पहले मरीज़ खोजें या पंजीकृत करें',
    'tele.status.requested': 'डॉक्टर के कॉल स्वीकार करने का इंतज़ार',
    'tele.status.accepted': '{0} ने कॉल स्वीकार कर ली — जल्द शुरू होगी',
    'tele.status.live': 'कॉल लाइव है — अभी मरीज़ के साथ जुड़ें',
    'tele.status.declined': 'डॉक्टर ने यह अनुरोध अस्वीकार कर दिया',
    'tele.status.completed': 'कॉल पूरी हुई',
    'tele.doctor': 'डॉक्टर',
    'tele.join': 'कॉल जॉइन करें',
    'tele.notify.accepted': '{0} ने कॉल स्वीकार कर ली — जुड़ने की तैयारी करें',
    'tele.notify.live': '📞 डॉक्टर ने कॉल शुरू कर दी — अभी जॉइन करें',
    'tele.notify.declined': 'डॉक्टर ने यह कॉल अनुरोध अस्वीकार कर दिया',
    'type.referral': 'रिफ़रल',
    'type.followup': 'फ़ॉलो-अप',
    'type.teleconsult': 'टेलीकंसल्ट',
    'nav.referrals': 'रेफरल्स',
    'title.referral': '🩺 ग्रामआरोग्य · नया रेफरल',
    'title.tracking': '🩺 ग्रामआरोग्य · रेफरल्स',
    'hint.referral': '<b>रेफरल बनाएं</b> मरीज़ को उच्च सुविधा (CHC / जिला अस्पताल) पर भेजें। पहले डिवाइस पर सहेजा जाता है, ऑनलाइन होने पर PHC को सिंक होता है। नवीनतम ट्रायेज स्वतः जुड़ जाता है।',
    'hint.tracking': '<b>रेफरल ट्रैकिंग</b> भेजे गए हर रेफरल को ट्रैक करें: भेजा → स्वीकृत → पूर्ण। ऑफ़लाइन रेफरल क्यू होते ही यहाँ दिखते हैं।',
    'lbl.age': 'आयु (वैकल्पिक, यदि जन्मतिथि अज्ञात है)',
    'reg.highrisk': 'उच्च जोखिम श्रेणी (सभी लागू चुनें)',
    'reg.allergies': 'एलर्जी (वैकल्पिक)',
    'reg.allergies_ph': 'जैसे पेनिसिलिन, मूंगफली',
    'reg.chronic_conditions': 'पुरानी बीमारियाँ (वैकल्पिक)',
    'reg.chronic_ph': 'जैसे टीबी, अस्थमा, मधुमेह',
    'hr.pregnant': 'गर्भवती',
    'hr.diabetic': 'मधुमेह',
    'hr.htn': 'उच्च रक्तचाप',
    'hr.elderly': 'बुज़ुर्ग (65+)',
    'hr.chronic': 'पुरानी बीमारी',
    'mp.title': '👥 मेरे मरीज़',
    'mp.search_ph': 'नाम, ABHA ID या गांव से खोजें…',
    'mp.f.all': 'सभी',
    'mp.f.highrisk': 'उच्च जोखिम',
    'mp.f.followups': 'फॉलो-अप बकाया',
    'mp.f.pending': 'सिंक बाकी',
    'mp.empty': 'अभी कोई मरीज़ पंजीकृत नहीं है। पहला मरीज़ पंजीकृत करें!',
    'mp.view': 'रिकॉर्ड देखें',
    'mp.new_triage': 'नया ट्रायेज',
    'mp.pending': 'सिंक बाकी',
    'mp.synced': 'सिंक हो गया',
    'mp.fu_due': 'इस सप्ताह फॉलो-अप बकाया',
    'ref.title': 'नया रेफरल',
    'ref.patient': 'मरीज़',
    'ref.patient_ph': 'मरीज़ का नाम या ABHA खोजें…',
    'ref.reason': 'रेफरल का कारण',
    'ref.r.specialist': 'विशेषज्ञ परामर्श आवश्यक',
    'ref.r.diagnostics': 'डायग्नोस्टिक जांच आवश्यक',
    'ref.r.emergency': 'आपातकालीन देखभाल',
    'ref.r.routine': 'नियमित जांच',
    'ref.r.pregnancy': 'गर्भावस्था जटिलता',
    'ref.r.chronic': 'पुरानी बीमारी प्रबंधन',
    'ref.priority': 'प्राथमिकता',
    'ref.p.routine': '🟢 नियमित',
    'ref.p.urgent': '🟡 तत्काल',
    'ref.p.emergency': '🔴 आपातकालीन',
    'ref.facility': 'किस सुविधा को भेजें',
    'ref.facility_ph': 'सुविधा चुनें…',
    'ref.notes': 'अतिरिक्त नोट (वैकल्पिक)',
    'ref.notes_ph': 'जैसे साथ ले जाने वाली रिपोर्ट…',
    'ref.submit': 'रेफरल भेजें',
    'ref.need_patient': 'पहले मरीज़ चुनें',
    'ref.need_facility': 'पहले सुविधा चुनें',
    'ref.sent_synced': 'रेफरल भेजा गया! PHC जल्द समीक्षा करेगा',
    'ref.sent_queued': 'रेफरल डिवाइस पर सहेजा — ऑनलाइन होने पर सिंक होगा',
    'ref.triage_pending': '{0} लंबित स्थानीय ट्रायेज रिपोर्ट जुड़ रही हैं',
    'ref.triage_attached': 'नवीनतम ट्रायेज जुड़ा: {0} ({1})',
    'track.title': 'रेफरल ट्रैकिंग',
    'track.new': '+ नया रेफरल',
    'track.f.sent': '🟡 भेजा',
    'track.f.accepted': '🟢 स्वीकृत',
    'track.f.completed': '🔵 पूर्ण',
    'track.f.noshow': '🔴 अनुपस्थित',
    'track.f.rejected': 'अस्वीकृत',
    'track.empty': 'अभी कोई रेफरल नहीं बनाया गया',
    'track.to_phc': 'PHC (सिंक बाकी)',
    'track.details': 'विवरण देखें',
    'track.contact': 'PHC से संपर्क',
    'track.status': 'स्थिति',
    'track.accepted': 'स्वीकृत',
    'track.completed': 'पूर्ण',
    'track.accepted_on': '{0} को स्वीकृत',
    'track.s.sent': 'भेजा',
    'track.s.accepted': 'स्वीकृत',
    'track.s.completed': 'पूर्ण',
    'track.s.no_show': 'अनुपस्थित',
    'track.s.rejected': 'अस्वीकृत',
    'track.s.pending_sync': 'सिंक बाकी',
    'track.s.created': 'बनाया',
    'tasks.overdue_count': '{0} विलंबित फॉलो-अप',
    'tasks.overdue_by': '{0} दिन विलंबित',
    'tasks.days_left': '{0} दिन बाकी',
    'tasks.due_today': 'आज नियत',
    'tasks.resched': 'पुनर्निर्धारित',
    'tasks.resched_online': 'पुनर्निर्धारण के लिए इंटरनेट से जुड़ें',
    'tasks.need_date': 'नई तारीख चुनें',
    'tasks.resched_done': 'फॉलो-अप पुनर्निर्धारित',
    'tasks.done_title': 'फॉलो-अप पूर्ण चिह्नित करें',
    'tasks.vitals': 'वाइटल दर्ज (BP, शुगर, वज़न…)',
    'tasks.advised': 'मरीज़ को सलाह दी',
    'tasks.meds': 'दवाइयाँ दी गईं',
    'tasks.notes': 'नोट (वैकल्पिक)',
    'tasks.notes_ph': 'जैसे BP 130/85, नमक कम करने की सलाह…',
    'tasks.confirm_done': 'पूर्ण की पुष्टि करें',
    'tasks.all_checks': 'वाइटल दर्ज, सलाह दी, दवाइयाँ दीं',
    'tasks.resched_title': 'फॉलो-अप पुनर्निर्धारित करें',
    'tasks.new_date': 'नई नियत तारीख',
    'tasks.confirm_resched': 'पुनर्निर्धारित करें',
    'sos.btn': 'SOS',
    'sos.title': '🚨 आपातकालीन SOS',
    'sos.patient': 'मरीज़',
    'sos.select_patient': 'मरीज़ चुनें…',
    'sos.type': 'आपातकालीन प्रकार',
    'sos.t.chest': '🫀 सीने में दर्द',
    'sos.t.stroke': '🧠 स्ट्रोक',
    'sos.t.bleed': '🩸 गंभीर रक्तस्राव',
    'sos.t.uncon': '😵 बेहोश',
    'sos.t.preg': '🤰 गर्भावस्था जटिलता',
    'sos.t.conv': '🤒 तेज़ बुखार + ऐंठन',
    'sos.t.other': '🚑 अन्य',
    'sos.location': 'स्थान (GPS स्वतः भरा)',
    'sos.details': 'अतिरिक्त विवरण (वैकल्पिक)',
    'sos.details_ph': 'क्या हुआ, बताएं…',
    'sos.send': 'आपातकालीन अलर्ट भेजें',
    'sos.confirm_txt': 'क्या आप सुनिश्चित हैं? यह केवल आपात स्थिति के लिए है।',
    'sos.confirm_yes': 'हाँ, अलर्ट भेजें',
    'sos.need_patient': 'पहले मरीज़ चुनें',
    'sos.need_type': 'आपातकालीन प्रकार चुनें',
    'sos.sent': 'आपातकालीन अलर्ट भेजा गया!',
    'sos.synced': 'आपातकालीन रेफरल बनकर PHC को सिंक हो गया',
    'sos.queued': 'अलर्ट डिवाइस पर क्यू — ऑनलाइन होने पर सिंक होगा',
    'sos.eta': 'एम्बुलेंस ETA: 15 मिनट',
    'sos.call_phc': 'PHC को कॉल करें',
    'sos.call_patient': 'मरीज़ को कॉल करें',
    'sync.status_title': 'सिंक स्थिति',
    'sync.total': 'कुल लंबित',
    'sync.progress': 'बैच {0} / {1} सिंक हो रहा है…',
    'sync.starting': 'सिंक शुरू…',
    'sync.auto_sync': 'इंटरनेट वापस आया। लंबित डेटा सिंक हो रहा है…',
    'sync.failed': '⚠️ असफल आइटम',
    'sync.retry_all': 'सभी पुनः प्रयास करें',
    'sync.retry': 'पुनः प्रयास',
    'sync.delete': 'हटाएं',
    'sync.failed_short': 'असफल',
    'sync.pending_short': 'लंबित',
    'th.detail': 'मरीज़',
    'call.title': 'कॉल',
    'call.dial': 'अभी कॉल करें',
    'call.copy': 'नंबर कॉपी करें',
    'call.copied': 'नंबर कॉपी हो गया',
    'call.copy_fail': 'कॉपी नहीं हो सका — नंबर मैन्युअली नोट करें',
    'call.no_number': 'फ़ाइल में कोई फ़ोन नंबर नहीं है',
    'asha_phone.title': 'मेरा मोबाइल नंबर (SMS अलर्ट)',
    'asha_phone.hint': 'जब आपका भेजा रेफरल स्वीकृत/अस्वीकृत/अनुपस्थित होगा तो यहाँ SMS मिलेगा।',
    'asha_phone.save': 'सहेजें',
    'asha_phone.saved': 'सहेजा गया — SMS अलर्ट यहाँ भेजे जाएँगे',
    'asha_phone.cleared': 'हटा दिया गया',
    'title.index': '\ud83e\ude7a \u0917\u094d\u0930\u093e\u092e\u0906\u0930\u094b\u0917\u094d\u092f \u00b7 \u0906\u0936\u093e',
    'title.triage': '\ud83e\ude7a \u0917\u094d\u0930\u093e\u092e\u0906\u0930\u094b\u0917\u094d\u092f \u00b7 \u091f\u094d\u0930\u093e\u0907\u090f\u091c',
    'title.sync': '\ud83e\ude7a \u0917\u094d\u0930\u093e\u092e\u0906\u0930\u094b\u0917\u094d\u092f \u00b7 \u0938\u093f\u0902\u0915',
    'nav.search': '\u092e\u0930\u0940\u091c\u093c \u0916\u094b\u091c\u0947\u0902',
    'nav.triage': '\u091f\u094d\u0930\u093e\u0907\u090f\u091c',
    'nav.sync': '\u0938\u093f\u0902\u0915',
    'pill.online': '\u0911\u0928\u0932\u093e\u0907\u0928',
    'pill.offline': '\u0911\u092b\u093c\u0932\u093e\u0907\u0928',
    'hint.index': '<b>\u0911\u092b\u093c\u0932\u093e\u0907\u0928-\u092a\u0939\u0932\u0947</b> \u092c\u093f\u0928\u093e \u0907\u0902\u091f\u0930\u0928\u0947\u091f \u0915\u0947 \u092d\u0940 \u0915\u093e\u092e \u0915\u0930\u0924\u093e \u0939\u0948\u0964 14 \u0905\u0902\u0915\u094b\u0902 \u0915\u0940 ABHA ID \u0926\u0930\u094d\u091c \u0915\u0930\u0947\u0902 \u092f\u093e \u0928\u0940\u091a\u0947 QR \u0938\u094d\u0915\u0948\u0928 \u0915\u0930\u0947\u0902\u0964 \u0930\u093f\u0915\u0949\u0930\u094d\u0921 \u0921\u093f\u0935\u093e\u0907\u0938 \u092e\u0947\u0902 \u0938\u0947\u0935 \u0939\u094b\u0924\u0947 \u0939\u0948\u0902 \u0914\u0930 \u0911\u0928\u0932\u093e\u0907\u0928 \u0939\u094b\u0924\u0947 \u0939\u0940 \u0938\u093f\u0902\u0915 \u0939\u094b \u091c\u093e\u0924\u0947 \u0939\u0948\u0902\u0964',
    'find.title': 'ABHA ID \u0938\u0947 \u092e\u0930\u0940\u091c\u093c \u0916\u094b\u091c\u0947\u0902',
    'ph.abha_search': '14 \u0905\u0902\u0915\u094b\u0902 \u0915\u0940 ABHA (\u091c\u0948\u0938\u0947 91214455667701)',
    'find.btn': '\u092e\u0930\u0940\u091c\u093c \u0916\u094b\u091c\u0947\u0902',
    'reg.title': '\u0928\u092f\u093e \u092e\u0930\u0940\u091c\u093c \u092a\u0902\u091c\u0940\u0915\u0930\u0923 (\u0911\u092b\u093c\u0932\u093e\u0907\u0928 \u092d\u0940 \u091a\u0932\u0924\u093e \u0939\u0948)',
    'reg.question': '\u0915\u094d\u092f\u093e \u0932\u093e\u092d\u093e\u0930\u094d\u0925\u0940 \u0915\u0947 \u092a\u093e\u0938 \u092a\u0939\u0932\u0947 \u0938\u0947 ABHA ID \u0939\u0948?',
    'reg.has_yes': '\u0939\u093e\u0901 \u2014 ABHA ID \u0939\u0948',
    'reg.has_no': '\u0928\u0939\u0940\u0902 \u2014 \u0928\u0908 \u092c\u0928\u093e\u090f\u0901',
    'lbl.abha': 'ABHA ID (14 \u0905\u0902\u0915)',
    'abha.title': '\u0928\u0940\u091a\u0947 \u0926\u093f\u090f \u0935\u093f\u0935\u0930\u0923 \u0938\u0947 \u0928\u0908 ABHA ID \u092c\u0928\u093e\u090f\u0901',
    'abha.desc': '\u092f\u0947 \u0935\u0939\u0940 \u091c\u093e\u0928\u0915\u093e\u0930\u0940 \u0939\u0948 \u091c\u094b \u0906\u0927\u093f\u0915\u093e\u0930\u093f\u0915 ABHA \u092a\u0902\u091c\u0940\u0915\u0930\u0923 \u092b\u093c\u0949\u0930\u094d\u092e \u092e\u0947\u0902 \u092a\u0942\u091b\u0940 \u091c\u093e\u0924\u0940 \u0939\u0948 (\u0928\u093e\u092e, \u0932\u093f\u0902\u0917, \u091c\u0928\u094d\u092e \u0924\u093f\u0925\u093f, \u092e\u094b\u092c\u093e\u0907\u0932 \u0928\u0902\u092c\u0930, \u092a\u0942\u0930\u093e \u092a\u0924\u093e)\u0964 14 \u0905\u0902\u0915\u094b\u0902 \u0915\u0940 ABHA ID ABHA \u092a\u094d\u0930\u093e\u0930\u0942\u092a \u092e\u0947\u0902 \u092c\u0928\u093e\u0915\u0930 \u092e\u0930\u0940\u091c\u093c \u0915\u0947 \u0938\u093e\u0925 \u0938\u0947\u0935 \u0915\u0940 \u091c\u093e\u090f\u0917\u0940\u0964 <i>\u0921\u0947\u092e\u094b \u0928\u094b\u091f: \u092f\u0939 ID \u0928\u0915\u0932\u0940 \u0939\u0948 \u2014 \u0905\u0938\u0932\u0940 ABHA (ABDM) \u0910\u092a \u0938\u0947 \u091c\u094b\u0921\u093c\u0928\u093e \u092c\u093e\u0926 \u092e\u0947\u0902 \u0939\u094b\u0917\u093e\u0964</i>',
    'lbl.name': '\u092a\u0942\u0930\u093e \u0928\u093e\u092e',
    'lbl.dob': '\u091c\u0928\u094d\u092e \u0924\u093f\u0925\u093f',
    'lbl.gender': '\u0932\u093f\u0902\u0917',
    'lbl.phone': '\u092e\u094b\u092c\u093e\u0907\u0932 \u0928\u0902\u092c\u0930',
    'lbl.village': '\u0917\u093e\u0901\u0935 / \u0907\u0932\u093e\u0915\u093e',
    'lbl.district': '\u091c\u093c\u093f\u0932\u093e',
    'lbl.state': '\u0930\u093e\u091c\u094d\u092f',
    'lbl.pincode': '\u092a\u093f\u0928 \u0915\u094b\u0921',
    'btn.save': '\u092e\u0930\u0940\u091c\u093c \u0915\u094b \u0938\u0947\u0935 \u0915\u0930\u0947\u0902 (\u0932\u094b\u0915\u0932)',
    'btn.create': 'ABHA \u092c\u0928\u093e\u090f\u0901 \u0914\u0930 \u092e\u0930\u0940\u091c\u093c \u0938\u0947\u0935 \u0915\u0930\u0947\u0902',
    'g.female': '\u092e\u0939\u093f\u0932\u093e',
    'g.male': '\u092a\u0941\u0930\u0941\u0937',
    'g.other': '\u0905\u0928\u094d\u092f',
    'no_patient': '\u0915\u094b\u0908 \u092e\u0930\u0940\u091c\u093c \u0928\u0939\u0940\u0902 \u092e\u093f\u0932\u093e\u0964',
    'card.unknown': '\u0905\u091c\u094d\u091e\u093e\u0924',
    'unit.yrs': '\u0935\u0930\u094d\u0937',
    'alert.allergy': '\u26a0 \u090f\u0932\u0930\u094d\u091c\u0940: {0}',
    'qr.title': '\u0921\u0947\u092e\u094b QR \u0938\u094d\u0915\u0948\u0928\u0930 (\u0905\u0938\u094d\u0925\u093e\u092f\u0940)',
    'qr.desc': '\u0905\u0938\u0932 \u092e\u0947\u0902 \u092f\u0939 \u0932\u093e\u092d\u093e\u0930\u094d\u0925\u0940 \u0915\u0947 \u0915\u093e\u0930\u094d\u0921 \u092a\u0930 \u091b\u092a\u0947 ABHA QR \u0915\u094b\u0921 \u0915\u094b \u092a\u0922\u093c\u0947\u0917\u093e\u0964 \u0938\u094d\u0915\u0948\u0928 \u0915\u093e \u0905\u0928\u0941\u0915\u0930\u0923 \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f \u0915\u093e\u0930\u094d\u0921 \u092a\u0930 \u091f\u0948\u092a \u0915\u0930\u0947\u0902:',
    'btn.close': '\u092c\u0902\u0926 \u0915\u0930\u0947\u0902',
    'hint.triage': '<b>\u0921\u093f\u091c\u093f\u091f\u0932 \u091f\u094d\u0930\u093e\u0907\u090f\u091c \u0915\u0948\u0932\u0915\u0941\u0932\u0947\u091f\u0930</b> \u0932\u0915\u094d\u0937\u0923 \u091a\u0941\u0928\u0947\u0902 \u0914\u0930 \u0935\u093e\u0907\u091f\u0932\u094d\u0938 \u0926\u0930\u094d\u091c \u0915\u0930\u0947\u0902, \u092b\u093f\u0930 <b>\u091c\u093e\u0901\u091a \u0915\u0930\u0947\u0902</b> \u0926\u092c\u093e\u090f\u0901\u0964 \u092f\u0939 \u0921\u093f\u0935\u093e\u0907\u0938 \u092a\u0930 \u0939\u0940 \u091a\u0932\u0924\u093e \u0939\u0948 \u2014 \u092a\u0942\u0930\u0940 \u0924\u0930\u0939 \u0911\u092b\u093c\u0932\u093e\u0907\u0928 \u0915\u093e\u092e \u0915\u0930\u0924\u093e \u0939\u0948\u0964 \u092a\u0930\u093f\u0923\u093e\u092e \u0911\u0928\u0932\u093e\u0907\u0928 \u0939\u094b\u0924\u0947 \u0939\u0940 PHC \u0921\u0949\u0915\u094d\u091f\u0930 \u0915\u0940 \u0915\u0924\u093e\u0930 \u092e\u0947\u0902 \u0938\u093f\u0902\u0915 \u0939\u094b\u0924\u0947 \u0939\u0948\u0902\u0964',
    'patient.title': '\u092e\u0930\u0940\u091c\u093c',
    'lbl.abha_opt': 'ABHA ID (\u0935\u0948\u0915\u0932\u094d\u092a\u093f\u0915)',
    'triage.symptoms': '\u0932\u0915\u094d\u0937\u0923',
    'triage.vitals': '\u0935\u093e\u0907\u091f\u0932\u094d\u0938',
    'v.pulse': '\u0928\u093e\u0921\u093c\u0940 (bpm)',
    'v.spo2': 'SpO\u2082 (%)',
    'v.sbp': '\u0938\u093f\u0938\u094d\u091f\u094b\u0932\u093f\u0915 BP',
    'v.dbp': '\u0921\u093e\u092f\u0938\u094d\u091f\u094b\u0932\u093f\u0915 BP',
    'v.temp': '\u0924\u093e\u092a\u092e\u093e\u0928 (\u00b0C)',
    'v.rr': '\u0938\u093e\u0901\u0938 \u0926\u0930 (/min)',
    'btn.assess': '\u092e\u0930\u0940\u091c\u093c \u0915\u0940 \u091c\u093e\u0901\u091a \u0915\u0930\u0947\u0902',
    'btn.reset': '🗑 नया मरीज़ — सब हटाएँ',
    'btn.reset.done': 'फ़ॉर्म साफ़ हुआ — अगले मरीज़ के लिए तैयार',
    'ci.title': '🩺 OPD चेक-इन / टोकन',
    'ci.hint': 'OPD स्लॉट बुक करें और GA-… टोकन पाएँ। इंटरनेट चाहिए — टोकन PHC सर्वर देता है।',
    'ci.priority': 'प्राथमिकता',
    'ci.btn': '🎫 OPD टोकन बनाएँ',
    'ci.badabha': 'पहले 14 अंकों का सही ABHA ID दर्ज करें।',
    'ci.offline': 'आप ऑफ़लाइन हैं — OPD टोकन PHC सर्वर देता है। ट्रायेज ऑफ़लाइन सहेजा जाता है।',
    'ci.thinking': 'OPD स्लॉट बुक हो रहा है…',
    'ci.notfound': 'मरीज़ नहीं मिला — पहले मरीज़ सहेजें।',
    'ci.nofac': 'चेक-इन के लिए कोई सुविधा उपलब्ध नहीं है।',
    'ci.failed': 'टोकन विफल: {0}',
    'ci.wait': 'अनुमानित प्रतीक्षा ~{0} मिनट',
    'sym.chest_pain': '\u0938\u0940\u0928\u0947 \u092e\u0947\u0902 \u0926\u0930\u094d\u0926',
    'sym.difficulty_breathing': '\u0938\u093e\u0901\u0938 \u0932\u0947\u0928\u0947 \u092e\u0947\u0902 \u0915\u0920\u093f\u0928\u093e\u0908',
    'sym.unconscious': '\u092c\u0947\u0939\u094b\u0936 / \u092a\u094d\u0930\u0924\u093f\u0915\u094d\u0930\u093f\u092f\u093e \u0928\u0939\u0940\u0902',
    'sym.severe_bleeding': '\u0917\u0902\u092d\u0940\u0930 \u0930\u0915\u094d\u0924\u0938\u094d\u0930\u093e\u0935',
    'sym.stiff_neck': '\u0917\u0930\u094d\u0926\u0928 \u092e\u0947\u0902 \u0905\u0915\u0921\u093c\u0928',
    'sym.pregnancy_complication': '\u0917\u0930\u094d\u092d\u093e\u0935\u0938\u094d\u0925\u093e \u0915\u0940 \u091c\u091f\u093f\u0932\u0924\u093e',
    'sym.high_fever': '\u0924\u0947\u091c\u093c \u092c\u0941\u0916\u093e\u0930',
    'sym.continuous_vomiting': '\u0932\u0917\u093e\u0924\u093e\u0930 \u0909\u0932\u094d\u091f\u0940',
    'sym.severe_headache': '\u0917\u0902\u092d\u0940\u0930 \u0938\u093f\u0930\u0926\u0930\u094d\u0926',
    'sym.dehydration': '\u092a\u093e\u0928\u0940 \u0915\u0940 \u0915\u092e\u0940 \u0915\u0947 \u0932\u0915\u094d\u0937\u0923',
    'sym.severe_abdominal_pain': '\u0917\u0902\u092d\u0940\u0930 \u092a\u0947\u091f \u0926\u0930\u094d\u0926',
    'sym.severe_injury': '\u0917\u0902\u092d\u0940\u0930 \u091a\u094b\u091f / \u0939\u0921\u094d\u0921\u0940 \u091f\u0942\u091f\u0928\u093e',
    'sym.abdominal_pain': '\u092a\u0947\u091f \u0926\u0930\u094d\u0926',
    'sym.diarrhea': '\u0926\u0938\u094d\u0924',
    'sym.cough_cold': '\u0916\u093e\u0901\u0938\u0940 / \u091c\u093c\u0941\u0915\u093e\u092e',
    'sym.fatigue': '\u0925\u0915\u093e\u0928 / \u0915\u092e\u091c\u093c\u094b\u0930\u0940',
    'sym.body_ache': '\u0936\u0930\u0940\u0930 \u092e\u0947\u0902 \u0926\u0930\u094d\u0926',
    'sym.urination_problem': '\u092c\u093e\u0930-\u092c\u093e\u0930 / \u0926\u0930\u094d\u0926 \u0915\u0947 \u0938\u093e\u0925 \u092a\u0947\u0936\u093e\u092c',
    'sym.sore_throat': '\u0917\u0932\u0947 \u092e\u0947\u0902 \u0916\u0930\u093e\u0936 / \u0926\u0930\u094d\u0926',
    'sym.joint_pain': '\u091c\u094b\u0921\u093c\u094b\u0902 \u092e\u0947\u0902 \u0926\u0930\u094d\u0926 / \u0938\u0942\u091c\u0928',
    'sym.back_pain': '\u092a\u0940\u0920 \u0926\u0930\u094d\u0926',
    'sym.skin_rash': '\u0924\u094d\u0935\u091a\u093e \u092a\u0930 \u0926\u093e\u0928\u0947 / \u0916\u0941\u091c\u0932\u0940',
    'sym.eye_problem': '\u0906\u0901\u0916 \u0932\u093e\u0932 / \u092a\u093e\u0928\u0940 / \u0926\u0930\u094d\u0926',
    'sym.ear_pain': '\u0915\u093e\u0928 \u0926\u0930\u094d\u0926 / \u092c\u0939\u093e\u0935',
    'sym.dizziness': '\u091a\u0915\u094d\u0915\u0930 / \u091a\u092e\u0915',
    'sym.acidity': '\u090f\u0938\u093f\u0921\u093f\u091f\u0940 / \u0905\u092a\u091a / \u0917\u0948\u0938',
    'sym.constipation': '\u0915\u092c\u094d\u091c\u093c',
    'sym.toothache': '\u0926\u093e\u0901\u0924 \u0926\u0930\u094d\u0926 / \u092e\u0938\u0942\u0921\u093c\u093e \u0938\u092e\u0938\u094d\u092f\u093e',
    'sym.numbness': '\u0938\u0941\u0928\u094d\u0928\u0924\u093e / \u091d\u0902\u091d\u0928\u093e\u0939\u091f',
    'sym.swelling': '\u0938\u0942\u091c\u0928 (\u091a\u0947\u0939\u0930\u093e / \u0939\u093e\u0925 / \u092a\u0948\u0930)',
    'color.RED': '\u0932\u093e\u0932 (RED)',
    'color.YELLOW': '\u092a\u0940\u0932\u093e (YELLOW)',
    'color.GREEN': '\u0939\u0930\u093e (GREEN)',
    'priority': '\u092a\u094d\u0930\u093e\u0925\u092e\u093f\u0915\u0924\u093e {0}',
    'action': '\u0915\u093e\u0930\u094d\u0930\u0935\u093e\u0908',
    'reason.symptom': '\u0932\u0915\u094d\u0937\u0923: {0}',
    'reason.spo2_critical': 'SpO2 {0}% \u2014 \u0917\u0902\u092d\u0940\u0930 \u0911\u0915\u094d\u0938\u0940\u091c\u0928 \u0915\u0940 \u0915\u092e\u0940 (< 90%)',
    'reason.pulse_critical': '\u0928\u093e\u0921\u093c\u0940 {0} bpm (40\u2013140 \u0938\u0947 \u092c\u093e\u0939\u0930)',
    'reason.sbp_critical': '\u0938\u093f\u0938\u094d\u091f\u094b\u0932\u093f\u0915 BP {0} mmHg (\u2264 90 \u092f\u093e \u2265 180)',
    'reason.temp_critical': '\u0924\u093e\u092a\u092e\u093e\u0928 {0}\u00b0C (\u0905\u0924\u093f \u0924\u0947\u091c\u093c \u092c\u0941\u0916\u093e\u0930, \u2265 41)',
    'reason.rr_critical': '\u0938\u093e\u0901\u0938 \u0926\u0930 {0}/min (8\u201330 \u0938\u0947 \u092c\u093e\u0939\u0930)',
    'reason.spo2_border': 'SpO2 {0}% (90\u201393%, \u0938\u0940\u092e\u093e \u0930\u0947\u0916\u093e)',
    'reason.pulse_border': '\u0928\u093e\u0921\u093c\u0940 {0} bpm (\u0938\u0940\u092e\u093e \u0930\u0947\u0916\u093e)',
    'reason.sbp_border': '\u0938\u093f\u0938\u094d\u091f\u094b\u0932\u093f\u0915 BP {0} mmHg (\u0938\u0940\u092e\u093e \u0930\u0947\u0916\u093e)',
    'reason.temp_border': '\u0924\u093e\u092a\u092e\u093e\u0928 {0}\u00b0C (\u0924\u0947\u091c\u093c \u092c\u0941\u0916\u093e\u0930, 39\u201341)',
    'reason.multi_moderate': '\u0915\u0908 \u092e\u0927\u094d\u092f\u092e \u0932\u0915\u094d\u0937\u0923: {0}',
    'reason.no_findings': '\u0915\u094b\u0908 RED/YELLOW \u0938\u0902\u0915\u0947\u0924 \u0928\u0939\u0940\u0902 \u2014 \u0935\u093e\u0907\u091f\u0932\u094d\u0938 \u0938\u093e\u092e\u093e\u0928\u094d\u092f \u0939\u0948\u0902',
    'rec.red': '\u0906\u092a\u093e\u0924\u0915\u093e\u0932: \u0924\u0941\u0930\u0902\u0924 \u092a\u0930\u093f\u0935\u0939\u0928 \u0915\u0940 \u0935\u094d\u092f\u0935\u0938\u094d\u0925\u093e \u0915\u0930\u0947\u0902 / 108 \u092a\u0930 \u0915\u0949\u0932 \u0915\u0930\u0947\u0902\u0964 \u092e\u0930\u0940\u091c\u093c \u0915\u094b \u092c\u093f\u0928\u093e \u091c\u093c\u0930\u0942\u0930\u0924 \u0928 \u0939\u093f\u0932\u093e\u090f\u0901\u0964 \u0905\u092d\u0940 \u0928\u093f\u0915\u091f\u0924\u092e \u0905\u0938\u094d\u092a\u0924\u093e\u0932 \u0915\u094b \u0938\u0942\u091a\u093f\u0924 \u0915\u0930\u0947\u0902\u0964',
    'rec.yellow': '\u0924\u0924\u094d\u0915\u093e\u0932: \u092e\u0930\u0940\u091c\u093c \u0915\u094b \u0906\u091c \u0939\u0940 PHC (\u092a\u094d\u0930\u093e\u0925\u092e\u093f\u0915 \u0938\u094d\u0935\u093e\u0938\u094d\u0925\u094d\u092f \u0915\u0947\u0902\u0926\u094d\u0930) \u092a\u0939\u0941\u0901\u091a\u0928\u0947 \u0915\u0940 \u0938\u0932\u093e\u0939 \u0926\u0947\u0902\u0964 \u0932\u0915\u094d\u0937\u0923 \u092c\u0928\u0947 \u0930\u0939\u0947\u0902 \u092f\u093e \u092c\u0922\u093c\u0947\u0902 \u0924\u094b 4 \u0918\u0902\u091f\u0947 \u092c\u093e\u0926 \u0926\u094b\u092c\u093e\u0930\u093e \u091c\u093e\u0901\u091a \u0915\u0930\u0947\u0902\u0964',
    'rec.green': '\u0938\u093e\u092e\u093e\u0928\u094d\u092f: \u0918\u0930 \u092a\u0930 \u0926\u0947\u0916\u092d\u093e\u0932 \u0915\u0940 \u0938\u0932\u093e\u0939\u0964 \u0932\u0915\u094d\u0937\u0923 48 \u0918\u0902\u091f\u0947 \u0938\u0947 \u0905\u0927\u093f\u0915 \u0930\u0939\u0947\u0902 \u0924\u094b PHC \u092a\u0930 \u0928\u093f\u092f\u092e\u093f\u0924 \u091c\u093e\u0901\u091a \u0915\u093e \u0938\u092e\u092f \u0924\u092f \u0915\u0930\u0947\u0902\u0964',
    'hint.sync': '<b>\u0928\u0947\u091f\u0935\u0930\u094d\u0915 \u0938\u094d\u0925\u093f\u0924\u093f \u0915\u093e \u0905\u0928\u0941\u0915\u0930\u0923 \u0915\u0930\u0947\u0902</b> \u092a\u0942\u0930\u0947 \u0911\u092b\u093c\u0932\u093e\u0907\u0928 \u2192 \u0911\u0928\u0932\u093e\u0907\u0928 \u0930\u093f\u0915\u0935\u0930\u0940 \u0926\u093f\u0916\u093e\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f \u0938\u094d\u0935\u093f\u091a \u0915\u094b \u092c\u0926\u0932\u0947\u0902: <b>\u0911\u092b\u093c\u0932\u093e\u0907\u0928</b> \u0939\u094b\u0928\u0947 \u092a\u0930 \u0939\u0930 \u0930\u093f\u0915\u0949\u0930\u094d\u0921 \u0907\u0938 \u0921\u093f\u0935\u093e\u0907\u0938 \u092a\u0930 \u0915\u0924\u093e\u0930 \u092e\u0947\u0902 \u091c\u093e\u0924\u093e \u0939\u0948\u0964 \u0935\u093e\u092a\u0938 <b>\u0911\u0928\u0932\u093e\u0907\u0928</b> \u0915\u0930\u0928\u0947 \u092a\u0930 \u092e\u0930\u0940\u091c\u093c \u0915\u0947 \u0930\u093f\u0915\u0949\u0930\u094d\u0921 \u092c\u0948\u0915\u0947\u0902\u0921 \u092e\u0947\u0902 \u091c\u093e\u0924\u0947 \u0939\u0948\u0902 <i>\u0914\u0930</i> \u0938\u0930\u094d\u0935\u0930 \u0915\u0940 \u0915\u0924\u093e\u0930 \u092e\u0947\u0902 \u092c\u0948\u0920\u0940 SMS \u090f\u0915 \u0939\u0940 \u092a\u094d\u0930\u0935\u093e\u0939 \u092e\u0947\u0902 \u092d\u0947\u091c\u0940 \u091c\u093e\u0924\u0940 \u0939\u0948\u0964',
    'net.online_label': '\u0928\u0947\u091f\u0935\u0930\u094d\u0915: \u0911\u0928\u0932\u093e\u0907\u0928',
    'net.offline_label': '\u0928\u0947\u091f\u0935\u0930\u094d\u0915: \u0911\u092b\u093c\u0932\u093e\u0907\u0928',
    'net.sub.online': '\u0930\u093f\u0915\u0949\u0930\u094d\u0921 \u0924\u0941\u0930\u0902\u0924 \u0938\u093f\u0902\u0915 \u0939\u094b\u0924\u0947 \u0939\u0948\u0902',
    'net.sub.offline': '\u0911\u0928\u0932\u093e\u0907\u0928 \u0915\u0930\u0928\u0947 \u0924\u0915 \u0930\u093f\u0915\u0949\u0930\u094d\u0921 \u0932\u094b\u0915\u0932 \u0915\u0924\u093e\u0930 \u092e\u0947\u0902 \u0930\u0939\u0947\u0902\u0917\u0947',
    'sync.pending': '\u0932\u0902\u092c\u093f\u0924 \u0932\u094b\u0915\u0932 \u0930\u093f\u0915\u0949\u0930\u094d\u0921',
    'sync.msgqueue': '\u0938\u0930\u094d\u0935\u0930 \u0938\u0902\u0926\u0947\u0936 \u0915\u0924\u093e\u0930',
    'sync.last': '\u0906\u0916\u093f\u0930\u0940 \u0938\u093f\u0902\u0915',
    'sync.never': '\u0915\u092d\u0940 \u0928\u0939\u0940\u0902',
    'th.type': '\u092a\u094d\u0930\u0915\u093e\u0930',
    'th.created': '\u092c\u0928\u093e\u092f\u093e \u0917\u092f\u093e',
    'th.status': '\u0938\u094d\u0925\u093f\u0924\u093f',
    'btn.sync_now': '\u0905\u092d\u0940 \u0938\u093f\u0902\u0915 \u0915\u0930\u0947\u0902 \u2192',
    'summary.empty': '\u0915\u094b\u0908 \u0905\u0928\u0938\u093f\u0902\u0915 \u0930\u093f\u0915\u0949\u0930\u094d\u0921 \u0928\u0939\u0940\u0902 \u2014 \u0938\u092c \u0938\u093f\u0902\u0915 \u0939\u0948\u0964',
    'summary.pending': '{0} \u0930\u093f\u0915\u0949\u0930\u094d\u0921 \u0938\u093f\u0902\u0915 \u0915\u0940 \u092a\u094d\u0930\u0924\u0940\u0915\u094d\u0937\u093e \u092e\u0947\u0902: {1}',
    'type.patient': '\u092e\u0930\u0940\u091c\u093c',
    'type.encounter': '\u092d\u0947\u0902\u091f',
    'type.triage': '\u091c\u093e\u0901\u091a',
    'status.queued': '\u0915\u0924\u093e\u0930 \u092e\u0947\u0902',
    'msg.queued': '\u0915\u0924\u093e\u0930 \u092e\u0947\u0902 SMS: {0} \u092d\u0947\u091c\u0928\u0947 \u0915\u0940 \u092a\u094d\u0930\u0924\u0940\u0915\u094d\u0937\u093e \u092e\u0947\u0902',
    'msg.queued_offline': '\u0915\u0924\u093e\u0930 \u092e\u0947\u0902 SMS: \u2014 (\u0911\u092b\u093c\u0932\u093e\u0907\u0928; \u0911\u0928\u0932\u093e\u0907\u0928 \u0939\u094b\u0928\u0947 \u092a\u0930 \u0926\u0947\u0916\u0947\u0902)',
    't.valid_abha': '\u0938\u0939\u0940 14 \u0905\u0902\u0915\u094b\u0902 \u0915\u0940 ABHA ID \u0926\u0930\u094d\u091c \u0915\u0930\u0947\u0902',
    't.not_found': '\u092e\u0930\u0940\u091c\u093c \u0928\u0939\u0940\u0902 \u092e\u093f\u0932\u093e',
    't.not_found_offline': '\u092e\u0930\u0940\u091c\u093c \u0928\u0939\u0940\u0902 \u092e\u093f\u0932\u093e (\u0911\u092b\u093c\u0932\u093e\u0907\u0928 \u0915\u0948\u0936 \u092e\u0947\u0902 \u0928\u0939\u0940\u0902)',
    't.loaded_server': '\u092e\u0930\u0940\u091c\u093c \u0938\u0930\u094d\u0935\u0930 \u0938\u0947 \u092e\u093f\u0932\u093e',
    't.loaded_cache': '\u092e\u0930\u0940\u091c\u093c \u0932\u094b\u0915\u0932 \u0915\u0948\u0936 \u0938\u0947 \u092e\u093f\u0932\u093e',
    't.qr_scanned': 'QR \u0938\u094d\u0915\u0948\u0928 \u0939\u0941\u0906: {0}',
    't.fill_required': '\u0915\u0943\u092a\u092f\u093e \u0906\u0935\u0936\u094d\u092f\u0915 \u091c\u093e\u0928\u0915\u093e\u0930\u0940 \u092d\u0930\u0947\u0902: {0}',
    't.phone_invalid': '\u0938\u0939\u0940 10 \u0905\u0902\u0915\u094b\u0902 \u0915\u093e \u092e\u094b\u092c\u093e\u0907\u0932 \u0928\u0902\u092c\u0930 \u0926\u0930\u094d\u091c \u0915\u0930\u0947\u0902',
    't.pincode_invalid': '\u0938\u0939\u0940 6 \u0905\u0902\u0915\u094b\u0902 \u0915\u093e \u092a\u093f\u0928 \u0915\u094b\u0921 \u0926\u0930\u094d\u091c \u0915\u0930\u0947\u0902',
    't.saved_synced': '\u0938\u0947\u0935 + \u0938\u093f\u0902\u0915 \u0939\u0941\u0906 ({0} \u0928\u090f \u092c\u0928\u0947)',
    't.saved_offline': '\u0932\u094b\u0915\u0932 \u0938\u0947\u0935 \u0939\u0941\u0906 \u2014 \u0911\u0928\u0932\u093e\u0907\u0928 \u0939\u094b\u0924\u0947 \u0939\u0940 \u0938\u093f\u0902\u0915 \u0939\u094b\u0917\u093e',
    't.sync_failed': '\u0932\u094b\u0915\u0932 \u0938\u0947\u0935 \u0939\u0941\u0906; \u0938\u093f\u0902\u0915 \u0935\u093f\u092b\u0932: {0}',
    't.abha_created': '\u0928\u0915\u0932\u0940 ABHA ID \u092c\u0928\u093e\u0908 \u0917\u0908: {0}',
    't.dup_local': '\u0907\u0938 ABHA ID \u0935\u093e\u0932\u093e \u092e\u0930\u0940\u091c\u093c \u092a\u0939\u0932\u0947 \u0938\u0947 \u0907\u0938 \u0921\u093f\u0935\u093e\u0907\u0938 \u092a\u0930 \u092e\u094c\u091c\u0942\u0926 \u0939\u0948',
    't.triage_saved': '\u091c\u093e\u0901\u091a \u0938\u0947\u0935 + \u0938\u093f\u0902\u0915 \u0939\u0941\u0908 ({0} \u0930\u093f\u0915\u0949\u0930\u094d\u0921 \u092c\u0928\u0947)',
    't.triage_offline': '\u091c\u093e\u0901\u091a \u0911\u092b\u093c\u0932\u093e\u0907\u0928 \u0938\u0947\u0935 \u0939\u0941\u0908 \u2014 \u0921\u0949\u0915\u094d\u091f\u0930 \u0915\u0940 \u0915\u0924\u093e\u0930 \u092e\u0947\u0902 \u0938\u093f\u0902\u0915 \u0915\u0947 \u0932\u093f\u090f \u0911\u0928\u0932\u093e\u0907\u0928 \u0915\u0930\u0947\u0902',
    't.net_online': '\u0928\u0947\u091f\u0935\u0930\u094d\u0915 \u0911\u0928\u0932\u093e\u0907\u0928 \u2014 \u0932\u0902\u092c\u093f\u0924 \u0930\u093f\u0915\u0949\u0930\u094d\u0921 + SMS \u0915\u0924\u093e\u0930 \u092d\u0947\u091c\u0940 \u091c\u093e \u0930\u0939\u0940 \u0939\u0948\u2026',
    't.net_offline': '\u0928\u0947\u091f\u0935\u0930\u094d\u0915 \u0911\u092b\u093c\u0932\u093e\u0907\u0928 \u2014 \u0928\u090f \u0930\u093f\u0915\u0949\u0930\u094d\u0921 \u0907\u0938 \u0921\u093f\u0935\u093e\u0907\u0938 \u092a\u0930 \u0915\u0924\u093e\u0930 \u092e\u0947\u0902 \u091c\u093e\u090f\u0901\u0917\u0947',
    't.toggle_first': '\u092a\u0939\u0932\u0947 \u0928\u0947\u091f\u0935\u0930\u094d\u0915 \u0915\u094b \u0911\u0928\u0932\u093e\u0907\u0928 \u0915\u0930\u0947\u0902',
    't.sync_done': '\u0938\u093f\u0902\u0915 \u092a\u0942\u0930\u094d\u0923: {0} \u0928\u090f, {1} \u0905\u092a\u0921\u0947\u091f \u00b7 {2} SMS \u092d\u0947\u091c\u0947 \u0917\u090f',
    't.sync_fail': '\u0938\u093f\u0902\u0915 \u0935\u093f\u092b\u0932: {0}',
    't.bg_sync_done': '\u092c\u0948\u0915\u0917\u094d\u0930\u093e\u0909\u0902\u0921 \u0938\u093f\u0902\u0915: {0} \u0928\u090f \u092c\u0928\u0947',
    'abha.step1.title': 'आधार से ABHA ID बनाएं',
    'abha.step1.desc': 'लाभार्थी का नाम और आधार नंबर ABDM से सत्यापित किया जाता है (असल में आधार OTP से)। <i>डेमो नोट: सिम्युलेटेड — आधार नंबर कहीं संग्रहीत या भेजा नहीं जाता।</i>',
    'abha.aadhaar_name': 'पूरा नाम (आधार के अनुसार)',
    'abha.aadhaar': 'आधार नंबर (12 अंक)',
    'abha.create_btn': 'ABHA ID बनाएं',
    'abha.created_title': '✅ ABHA ID बन गया',
    'abha.created_next': 'अब नीचे लाभार्थी का विवरण पूरा करें और रोगी सेव करें।',
    'abha.aadhaar_invalid': 'कृपया 12 अंकों का सही आधार नंबर दर्ज करें',
    'abha.create_first': 'पहले ABHA ID बनाएं',
    'card.health': 'स्वास्थ्य विवरण',
    'card.hr': 'उच्च जोखिम',
    'card.chronic': 'पुरानी बीमारियाँ',
    'card.latest': 'नवीनतम जाँच (ट्राइएज)',
    'card.referral': 'रेफरल',
    'card.followup': 'अगली फॉलो-अप',
    'card.none': 'अभी कोई स्वास्थ्य रिकॉर्ड नहीं — ट्राइएज करें या विज़िट नोट जोड़ें',
  },

  mr: {
    'title.tasks': '🩺 ग्रामआरोग्य · माझी कामे',
    'nav.task': 'माझी कामे',
    'hint.tasks': '<b>दैनिक फॉलो-अप यादी</b> तुम्हाला नियुक्त उच्च-जोखीम फॉलो-अप (मातृत्व, बाल लसीकरण, मधुमेह, उच्च रक्तदाब, TB, ज्येष्ठ नागरिक). काम पूर्ण म्हणून चिन्हांकित करा — ते PHC वर सिंक होतात आणि डॅशबोर्ड अपडेट करतात.',
    'lbl.family': 'कुटुंब ID (ऐच्छिक)',
    'tasks.stat.due_today': 'आज देय',
    'tasks.stat.upcoming': 'येणारे',
    'tasks.stat.overdue': 'उशीरा',
    'tasks.stat.completed': 'पूर्ण',
    'tasks.loading': 'कामे लोड होत आहेत…',
    'tasks.offline_cached': 'ऑफलाइन यादी दिसत आहे — रीफ्रेश करण्यासाठी सिंक करा',
    'tasks.empty': 'कोणतेही {0} काम नाही',
    'tasks.due': 'देय: {0}',
    'tasks.cat': '{0} काळजी',
    'tasks.mark_done': '✓ पूर्ण केले',
    'tasks.done_offline': 'ऑफलाइन जतन — नंतर सिंक होईल',
    'tasks.done_synced': 'फॉलो-अप पूर्ण व सिंक झाला',
    'tasks.done_failed': 'जतन करता आले नाही: {0}',
    'emer.title': '🚨 आपत्कालीन उपचार — नेहमीची रांग वगळा',
    'emer.to': 'पाठवा (सुविधा)',
    'emer.auto': 'जिल्हा रुग्णालय (निवड न केल्यास आपोआप)',
    'emer.reason_ph': 'कारण (उदा. छातीत दुखणे व श्वास लागणे)',
    'emer.btn': 'आपत्कालीन रेफरल तयार करा',
    'emer.no_abha': 'वर 14 अंकी ABHA ID टाका जेणेकरून रेफरल रुग्णाशी जोडला जाईल',
    'emer.created_offline': 'आपत्कालीन रेफरल रांगेत — पाठवण्यासाठी सिंक करा',
    'emer.created_synced': 'आपत्कालीन रेफरल तयार व सिंक झाला',

    // teleconsult (Feature 5) — request a doctor call for the shown patient
    'btn.tele': '📞 डॉक्टर कॉलची विनंती करा',
    'tele.title': 'डॉक्टर टेलिकन्सल्टेशनची विनंती',
    'tele.patient': 'रुग्ण: {0}',
    'tele.mode': 'कॉल पद्धत',
    'tele.mode.audio': 'ऑडिओ (कमी बँडविड्थ)',
    'tele.mode.video': 'व्हिडिओ',
    'tele.mode.chat': 'चॅट / फक्त नोट्स',
    'tele.reason': 'कॉलचे कारण',
    'tele.reason_ph': 'जसे 2 दिवसांपासून ताप, डॉक्टरांचा सल्ला हवा',
    'tele.request': 'कॉलची विनंती करा',
    'tele.queued': 'कॉल विनंती जतन केली — ऑनलाइन झाल्यावर सिंक होईल',
    'tele.sent': 'कॉल विनंती डॉक्टरांना पाठवली',
    'tele.no_patient': 'आधी रुग्ण शोधा किंवा नोंदणी करा',
    'tele.status.requested': 'डॉक्टरांनी कॉल स्वीकारण्याची प्रतीक्षा',
    'tele.status.accepted': '{0} यांनी कॉल स्वीकारली — लवकरच सुरू होईल',
    'tele.status.live': 'कॉल लाइव्ह आहे — आता रुग्णासोबत जोडा',
    'tele.status.declined': 'डॉक्टरांनी ही विनंती नाकारली',
    'tele.status.completed': 'कॉल पूर्ण झाली',
    'tele.doctor': 'डॉक्टर',
    'tele.join': 'कॉलमध्ये सामील व्हा',
    'tele.notify.accepted': '{0} यांनी कॉल स्वीकारली — जोडण्याची तयारी करा',
    'tele.notify.live': '📞 डॉक्टरांनी कॉल सुरू केली — आता सामील व्हा',
    'tele.notify.declined': 'डॉक्टरांनी ही कॉल विनंती नाकारली',
    'type.referral': 'रेफरल',
    'type.followup': 'फॉलो-अप',
    'type.teleconsult': 'टेलिकन्सल्ट',
    'nav.referrals': 'रेफरल्स',
    'title.referral': '🩺 ग्रामआरोग्य · नवीन रेफरल',
    'title.tracking': '🩺 ग्रामआरोग्य · रेफरल्स',
    'hint.referral': '<b>रेफरल तयार करा</b> रुग्णाला उच्च सुविधेवर (CHC / जिल्हा रुग्णालय) पाठवा. प्रथम या डिव्हाइसवर जतन होते, ऑनलाइन झाल्यावर PHC ला सिंक होते. नवीनतम ट्रायेज आपोआप जोडले जाते.',
    'hint.tracking': '<b>रेफरल ट्रॅकिंग</b> पाठवलेल्या प्रत्येक रेफरलचा मागोवा ठेवा: पाठवले → स्वीकारले → पूर्ण. ऑफलाइन रेफरल क्यू होताच येथे दिसतात.',
    'lbl.age': 'वय (ऐच्छिक, जर जन्मतारीख माहीत नसेल)',
    'reg.highrisk': 'उच्च जोखीम श्रेणी (सर्व लागू निवडा)',
    'reg.allergies': 'अ‍ॅलर्जी (ऐच्छिक)',
    'reg.allergies_ph': 'उदा. पेनिसिलिन, शेंगदाणे',
    'reg.chronic_conditions': 'जुनाट आजार (ऐच्छिक)',
    'reg.chronic_ph': 'उदा. क्षयरोग, दमा, मधुमेह',
    'hr.pregnant': 'गर्भवती',
    'hr.diabetic': 'मधुमेह',
    'hr.htn': 'उच्च रक्तदाब',
    'hr.elderly': 'ज्येष्ठ (65+)',
    'hr.chronic': 'जुनाट आजार',
    'mp.title': '👥 माझे रुग्ण',
    'mp.search_ph': 'नाव, ABHA ID किंवा गावाने शोधा…',
    'mp.f.all': 'सर्व',
    'mp.f.highrisk': 'उच्च जोखीम',
    'mp.f.followups': 'फॉलो-अप बाकी',
    'mp.f.pending': 'सिंक बाकी',
    'mp.empty': 'अद्याप कोणताही रुग्ण नोंदणीकृत नाही. पहिला रुग्ण नोंदवा!',
    'mp.view': 'रेकॉर्ड पहा',
    'mp.new_triage': 'नवीन ट्रायेज',
    'mp.pending': 'सिंक बाकी',
    'mp.synced': 'सिंक झाले',
    'mp.fu_due': 'या आठवड्यात फॉलो-अप बाकी',
    'ref.title': 'नवीन रेफरल',
    'ref.patient': 'रुग्ण',
    'ref.patient_ph': 'रुग्णाचे नाव किंवा ABHA शोधा…',
    'ref.reason': 'रेफरलचे कारण',
    'ref.r.specialist': 'तज्ज्ञ सल्ला आवश्यक',
    'ref.r.diagnostics': 'निदान चाचण्या आवश्यक',
    'ref.r.emergency': 'आपत्कालीन काळजी',
    'ref.r.routine': 'नियमित तपासणी',
    'ref.r.pregnancy': 'गर्भधारणा गुंतागुंत',
    'ref.r.chronic': 'जुनाट आजार व्यवस्थापन',
    'ref.priority': 'प्राधान्य',
    'ref.p.routine': '🟢 नियमित',
    'ref.p.urgent': '🟡 तातडीचे',
    'ref.p.emergency': '🔴 आपत्कालीन',
    'ref.facility': 'कोणत्या सुविधेवर पाठवायचे',
    'ref.facility_ph': 'सुविधा निवडा…',
    'ref.notes': 'अतिरिक्त नोट्स (ऐच्छिक)',
    'ref.notes_ph': 'उदा. सोबत नेण्याच्या अहवाल…',
    'ref.submit': 'रेफरल पाठवा',
    'ref.need_patient': 'आधी रुग्ण निवडा',
    'ref.need_facility': 'आधी सुविधा निवडा',
    'ref.sent_synced': 'रेफरल पाठवले! PHC लवकर पुनरावलोकन करेल',
    'ref.sent_queued': 'रेफरल डिव्हाइसवर जतन — ऑनलाइन झाल्यावर सिंक होईल',
    'ref.triage_pending': '{0} प्रलंबित स्थानिक ट्रायेज अहवाल जोडत आहे',
    'ref.triage_attached': 'नवीनतम ट्रायेज जोडले: {0} ({1})',
    'track.title': 'रेफरल ट्रॅकिंग',
    'track.new': '+ नवीन रेफरल',
    'track.f.sent': '🟡 पाठवले',
    'track.f.accepted': '🟢 स्वीकारले',
    'track.f.completed': '🔵 पूर्ण',
    'track.f.noshow': '🔴 अनुपस्थित',
    'track.f.rejected': 'नाकारले',
    'track.empty': 'अद्याप कोणताही रेफरल तयार केलेला नाही',
    'track.to_phc': 'PHC (सिंक बाकी)',
    'track.details': 'तपशील पहा',
    'track.contact': 'PHC शी संपर्क',
    'track.status': 'स्थिती',
    'track.accepted': 'स्वीकारले',
    'track.completed': 'पूर्ण',
    'track.accepted_on': '{0} रोजी स्वीकारले',
    'track.s.sent': 'पाठवले',
    'track.s.accepted': 'स्वीकारले',
    'track.s.completed': 'पूर्ण',
    'track.s.no_show': 'अनुपस्थित',
    'track.s.rejected': 'नाकारले',
    'track.s.pending_sync': 'सिंक बाकी',
    'track.s.created': 'तयार केले',
    'tasks.overdue_count': '{0} विलंबित फॉलो-अप',
    'tasks.overdue_by': '{0} दिवस विलंबित',
    'tasks.days_left': '{0} दिवस बाकी',
    'tasks.due_today': 'आज देय',
    'tasks.resched': 'पुनर्नियोजन',
    'tasks.resched_online': 'पुनर्नियोजनासाठी इंटरनेटशी जोडा',
    'tasks.need_date': 'नवीन तारीख निवडा',
    'tasks.resched_done': 'फॉलो-अप पुनर्नियोजित',
    'tasks.done_title': 'फॉलो-अप पूर्ण म्हणून चिन्हांकित करा',
    'tasks.vitals': 'व्हाइटल्स नोंदवले (BP, साखर, वजन…)',
    'tasks.advised': 'रुग्णाला सल्ला दिला',
    'tasks.meds': 'औषधे दिली',
    'tasks.notes': 'नोट्स (ऐच्छिक)',
    'tasks.notes_ph': 'उदा. BP 130/85, मीठ कमी करण्याचा सल्ला…',
    'tasks.confirm_done': 'पूर्ण झाल्याची पुष्टी करा',
    'tasks.all_checks': 'व्हाइटल्स, सल्ला, औषधे — सर्व नोंदवले',
    'tasks.resched_title': 'फॉलो-अप पुनर्नियोजित करा',
    'tasks.new_date': 'नवीन देय तारीख',
    'tasks.confirm_resched': 'पुनर्नियोजित करा',
    'sos.btn': 'SOS',
    'sos.title': '🚨 आपत्कालीन SOS',
    'sos.patient': 'रुग्ण',
    'sos.select_patient': 'रुग्ण निवडा…',
    'sos.type': 'आपत्कालीन प्रकार',
    'sos.t.chest': '🫀 छातीत दुखणे',
    'sos.t.stroke': '🧠 स्ट्रोक',
    'sos.t.bleed': '🩸 तीव्र रक्तस्त्राव',
    'sos.t.uncon': '😵 बेशुद्ध',
    'sos.t.preg': '🤰 गर्भधारणा गुंतागुंत',
    'sos.t.conv': '🤒 ताप + आकडी',
    'sos.t.other': '🚑 इतर',
    'sos.location': 'स्थान (GPS आपोआप भरले)',
    'sos.details': 'अतिरिक्त तपशील (ऐच्छिक)',
    'sos.details_ph': 'काय घडले ते सांगा…',
    'sos.send': 'आपत्कालीन अलर्ट पाठवा',
    'sos.confirm_txt': 'खात्री आहे? हे फक्त आपत्कालीन परिस्थितीसाठी आहे.',
    'sos.confirm_yes': 'होय, अलर्ट पाठवा',
    'sos.need_patient': 'आधी रुग्ण निवडा',
    'sos.need_type': 'आपत्कालीन प्रकार निवडा',
    'sos.sent': 'आपत्कालीन अलर्ट पाठवला!',
    'sos.synced': 'आपत्कालीन रेफरल तयार होऊन PHC ला सिंक झाले',
    'sos.queued': 'अलर्ट डिव्हाइसवर क्यू — ऑनलाइन झाल्यावर सिंक होईल',
    'sos.eta': 'रुग्णवाहिका ETA: 15 मिनिटे',
    'sos.call_phc': 'PHC ला कॉल करा',
    'sos.call_patient': 'रुग्णाला कॉल करा',
    'sync.status_title': 'सिंक स्थिती',
    'sync.total': 'एकूण प्रलंबित',
    'sync.progress': 'बॅच {0} / {1} सिंक होत आहे…',
    'sync.starting': 'सिंक सुरू…',
    'sync.auto_sync': 'इंटरनेट परत आले. प्रलंबित डेटा सिंक होत आहे…',
    'sync.failed': '⚠️ अयशस्वी आयटम',
    'sync.retry_all': 'सर्व पुन्हा प्रयत्न करा',
    'sync.retry': 'पुन्हा प्रयत्न',
    'sync.delete': 'हटवा',
    'sync.failed_short': 'अयशस्वी',
    'sync.pending_short': 'प्रलंबित',
    'th.detail': 'रुग्ण',
    'call.title': 'कॉल',
    'call.dial': 'आता कॉल करा',
    'call.copy': 'क्रमांक कॉपी करा',
    'call.copied': 'क्रमांक कॉपी झाला',
    'call.copy_fail': 'कॉपी होऊ शकले नाही — क्रमांक स्वतः नोंदवा',
    'call.no_number': 'फाईलमध्ये फोन क्रमांक नाही',
    'asha_phone.title': 'माझा मोबाइल क्रमांक (SMS अलर्ट)',
    'asha_phone.hint': 'तुमचा पाठवलेला रेफरल स्वीकारला/नाकारला/अनुपस्थित झाला तर इथे SMS येईल.',
    'asha_phone.save': 'जतन करा',
    'asha_phone.saved': 'जतन झाले — SMS अलर्ट इथे येतील',
    'asha_phone.cleared': 'हटवले',
    'title.index': '\ud83e\ude7a \u0917\u094d\u0930\u093e\u092e\u0906\u0930\u094b\u0917\u094d\u092f \u00b7 \u0906\u0936\u093e',
    'title.triage': '\ud83e\ude7a \u0917\u094d\u0930\u093e\u092e\u0906\u0930\u094b\u0917\u094d\u092f \u00b7 \u091f\u094d\u0930\u093e\u092f\u091c',
    'title.sync': '\ud83e\ude7a \u0917\u094d\u0930\u093e\u092e\u0906\u0930\u094b\u0917\u094d\u092f \u00b7 \u0938\u093f\u0902\u0915',
    'nav.search': '\u0930\u0941\u0917\u094d\u0923 \u0936\u094b\u0927',
    'nav.triage': '\u091f\u094d\u0930\u093e\u092f\u091c',
    'nav.sync': '\u0938\u093f\u0902\u0915',
    'pill.online': '\u0911\u0928\u0932\u093e\u0907\u0928',
    'pill.offline': '\u0911\u092b\u0932\u093e\u0907\u0928',
    'hint.index': '<b>\u092a\u094d\u0930\u0925\u092e \u0911\u092b\u0932\u093e\u0907\u0928</b> \u0907\u0902\u091f\u0930\u0928\u0947\u091f\u0936\u093f\u0935\u093e\u092f \u0915\u093e\u0930\u094d\u092f\u0930\u0924. 14 \u0905\u0902\u0915\u0940 ABHA ID \u091f\u093e\u0915\u093e \u0915\u093f\u0902\u0935\u093e \u0916\u093e\u0932\u0940\u0932 QR \u0938\u094d\u0915\u0948\u0928 \u0915\u0930\u093e. \u0928\u094b\u0902\u0926\u0940 \u0921\u093f\u0935\u094d\u0939\u093e\u0907\u0938\u0935\u0930 \u091c\u0924\u0928 \u0939\u094b\u0924\u093e\u0924 \u0906\u0923\u093f \u0911\u0928\u0932\u093e\u0907\u0928 \u091d\u093e\u0932\u094d\u092f\u093e\u0935\u0930 \u0938\u093f\u0902\u0915 \u0939\u094b\u0924\u093e\u0924.',
    'find.title': 'ABHA ID \u0928\u0947 \u0930\u0941\u0917\u094d\u0923 \u0936\u094b\u0927\u093e',
    'ph.abha_search': '14 \u0905\u0902\u0915\u0940 ABHA (\u0909\u0926\u093e. 91214455667701)',
    'find.btn': '\u0930\u0941\u0917\u094d\u0923 \u0936\u094b\u0927\u093e',
    'reg.title': '\u0928\u0935\u0940\u0928 \u0930\u0941\u0917\u094d\u0923 \u0928\u094b\u0902\u0926\u0923\u0940 (\u0911\u092b\u0932\u093e\u0907\u0928 \u0915\u093e\u0930\u094d\u092f\u0930\u0924)',
    'reg.question': '\u0932\u093e\u092d\u093e\u0930\u094d\u0925\u0940\u0915\u0921\u0947 \u0906\u0927\u0940\u092a\u093e\u0938\u0942\u0928 ABHA ID \u0906\u0939\u0947 \u0915\u093e?',
    'reg.has_yes': '\u0939\u094b\u092f \u2014 ABHA ID \u0906\u0939\u0947',
    'reg.has_no': '\u0928\u093e\u0939\u0940 \u2014 \u0928\u0935\u0940\u0928 \u0924\u092f\u093e\u0930 \u0915\u0930\u093e',
    'lbl.abha': 'ABHA ID (14 \u0905\u0902\u0915)',
    'abha.title': '\u0916\u093e\u0932\u0940\u0932 \u092e\u093e\u0939\u093f\u0924\u0940\u0935\u0930\u0942\u0928 \u0928\u0935\u0940\u0928 ABHA ID \u0924\u092f\u093e\u0930 \u0915\u0930\u093e',
    'abha.desc': '\u0939\u0940 \u092e\u093e\u0939\u093f\u0924\u0940 \u0905\u0927\u093f\u0915\u0943\u0924 ABHA \u0928\u094b\u0902\u0926\u0923\u0940 \u092b\u0949\u0930\u094d\u092e\u092e\u0927\u094d\u092f\u0947 \u0935\u093f\u091a\u093e\u0930\u0932\u0940 \u091c\u093e\u0924\u0947 (\u0928\u093e\u0935, \u0932\u093f\u0902\u0917, \u091c\u0928\u094d\u092e\u0924\u093e\u0930\u0940\u0916, \u092e\u094b\u092c\u093e\u0907\u0932 \u0915\u094d\u0930\u092e\u093e\u0902\u0915, \u092a\u0942\u0930\u094d\u0923 \u092a\u0924\u094d\u0924\u093e). 14 \u0905\u0902\u0915\u0940 ABHA ID ABHA \u0938\u094d\u0935\u0930\u0942\u092a\u093e\u0924 \u0924\u092f\u093e\u0930 \u0939\u094b\u090a\u0928 \u0930\u0941\u0917\u094d\u0923\u093e\u0938\u094b\u092c\u0924 \u091c\u0924\u0928 \u0939\u094b\u0908\u0932. <i>\u0921\u0947\u092e\u094b \u091f\u0940\u092a: \u0939\u0940 ID \u0938\u093f\u092e\u094d\u092f\u0941\u0932\u0947\u091f\u0947\u0921 \u0906\u0939\u0947 \u2014 \u092a\u094d\u0930\u0924\u094d\u092f\u0915\u094d\u0937 ABHA (ABDM) \u0905\u0907\u092a\u0936\u0940 \u091c\u094b\u0921\u0923\u0940 \u0928\u093e\u0902\u0924\u0930 \u0939\u094b\u0908\u0932.</i>',
    'lbl.name': '\u092a\u0942\u0930\u094d\u0923 \u0928\u093e\u0935',
    'lbl.dob': '\u091c\u0928\u094d\u092e \u0924\u093e\u0930\u0940\u0916',
    'lbl.gender': '\u0932\u093f\u0902\u0917',
    'lbl.phone': '\u092e\u094b\u092c\u093e\u0907\u0932 \u0915\u094d\u0930\u092e\u093e\u0902\u0915',
    'lbl.village': '\u0917\u093e\u0935 / \u092a\u0930\u093f\u0938\u0930',
    'lbl.district': '\u091c\u093f\u0932\u094d\u0939\u093e',
    'lbl.state': '\u0930\u093e\u091c\u094d\u092f',
    'lbl.pincode': '\u092a\u093f\u0928 \u0915\u094b\u0921',
    'btn.save': '\u0930\u0941\u0917\u094d\u0923 \u091c\u0924\u0928 \u0915\u0930\u093e (\u0932\u094b\u0915\u0932)',
    'btn.create': 'ABHA \u0924\u092f\u093e\u0930 \u0915\u0930\u093e \u0935 \u0930\u0941\u0917\u094d\u0923 \u091c\u0924\u0928 \u0915\u0930\u093e',
    'g.female': '\u0938\u094d\u0924\u094d\u0930\u0940',
    'g.male': '\u092a\u0941\u0930\u0941\u0937',
    'g.other': '\u0907\u0924\u0930',
    'no_patient': '\u0930\u0941\u0917\u094d\u0923 \u0938\u093e\u092a\u0921\u0932\u093e \u0928\u093e\u0939\u0940.',
    'card.unknown': '\u0905\u091c\u094d\u091e\u093e\u0924',
    'unit.yrs': '\u0935\u0930\u094d\u0937\u0947',
    'alert.allergy': '\u26a0 \u0905\u094d\u0932\u0930\u094d\u091c\u0940: {0}',
    'qr.title': '\u0921\u0947\u092e\u094b QR \u0938\u094d\u0915\u0948\u0928\u0930 (\u0924\u093e\u0924\u094d\u092a\u0941\u0930\u0924\u0947)',
    'qr.desc': '\u092a\u094d\u0930\u0924\u094d\u092f\u0915\u094d\u0937\u093e\u0924 \u0939\u0947 \u0932\u093e\u092d\u093e\u0930\u094d\u0925\u0940\u091a\u094d\u092f\u093e \u0915\u093e\u0930\u094d\u0921\u0935\u0930 \u091b\u093e\u092a\u0932\u0947\u0932\u093e ABHA QR \u0915\u094b\u0921 \u0935\u093e\u091a\u0947\u0932. \u0938\u094d\u0915\u0948\u0928 \u0938\u093f\u092e\u094d\u092f\u0941\u0932\u0947\u091f \u0915\u0930\u0923\u094d\u092f\u093e\u0938\u093e\u0920\u0940 \u0915\u093e\u0930\u094d\u0921\u0935\u0930 \u091f\u0947\u092a \u0915\u0930\u093e:',
    'btn.close': '\u092c\u0902\u0926 \u0915\u0930\u093e',
    'hint.triage': '<b>\u0921\u093f\u091c\u093f\u091f\u0932 \u091f\u094d\u0930\u093e\u092f\u091c \u0915\u0948\u0932\u094d\u0915\u0941\u0932\u0947\u091f\u0930</b> \u0932\u0915\u094d\u0937\u0923\u0947 \u0928\u093f\u0935\u0921\u093e \u0906\u0923\u093f \u0935\u094d\u0939\u093e\u092f\u091f\u0932\u094d\u0938 \u092d\u0930\u093e, \u0928\u0902\u0924\u0930 <b>\u0924\u092a\u093e\u0938\u0923\u0940 \u0915\u0930\u093e</b> \u0926\u093e\u092c\u093e. \u0939\u0947 \u0921\u093f\u0935\u094d\u0939\u093e\u0907\u0938\u0935\u0930\u091a \u091a\u093e\u0932\u0924\u0947 \u2014 \u092a\u0942\u0930\u094d\u0923\u092a\u0923\u0947 \u0911\u092b\u0932\u093e\u0907\u0928 \u0915\u093e\u0930\u094d\u092f\u0930\u0924. \u092a\u0930\u093f\u0923\u093e\u092e \u0911\u0928\u0932\u093e\u0907\u0928 \u091d\u093e\u0932\u094d\u092f\u093e\u0935\u0930 PHC \u0921\u0949\u0915\u094d\u091f\u0930\u091a\u094d\u092f\u093e \u0930\u093e\u0902\u0917\u0947\u0924 \u0938\u093f\u0902\u0915 \u0939\u094b\u0924\u093e\u0924.',
    'patient.title': '\u0930\u0941\u0917\u094d\u0923',
    'lbl.abha_opt': 'ABHA ID (\u092a\u0930\u094d\u092f\u093e\u092f\u0940)',
    'triage.symptoms': '\u0932\u0915\u094d\u0937\u0923\u0947',
    'triage.vitals': '\u0935\u094d\u0939\u093e\u092f\u091f\u0932\u094d\u0938',
    'v.pulse': '\u0928\u093e\u0921\u0940 (bpm)',
    'v.spo2': 'SpO\u2082 (%)',
    'v.sbp': '\u0938\u093f\u0938\u094d\u091f\u094b\u0932\u093f\u0915 BP',
    'v.dbp': '\u0921\u093e\u092f\u0938\u094d\u091f\u094b\u0932\u093f\u0915 BP',
    'v.temp': '\u0924\u093e\u092a\u092e\u093e\u0928 (\u00b0C)',
    'v.rr': '\u0936\u094d\u0935\u0938\u0928 \u0926\u0930 (/min)',
    'btn.assess': '\u0930\u0941\u0917\u094d\u0923\u093e\u091a\u0940 \u0924\u092a\u093e\u0938\u0923\u0940 \u0915\u0930\u093e',
    'btn.reset': '🗑 नवीन रुग्ण — सर्व हटवा',
    'btn.reset.done': 'फॉर्म साफ झाला — पुढील रुग्णासाठी तयार',
    'ci.title': '🩺 OPD चेक-इन / टोकन',
    'ci.hint': 'OPD स्लॉट बुक करा आणि GA-… टोकन मिळवा. इंटरनेट हवे — टोकन PHC सर्व्हर देतो.',
    'ci.priority': 'प्राथमिकता',
    'ci.btn': '🎫 OPD टोकन तयार करा',
    'ci.badabha': 'आधी 14 अंकांचा योग्य ABHA ID टाका.',
    'ci.offline': 'तुम्ही ऑफलाइन आहात — OPD टोकन PHC सर्व्हर देतो. ट्रायेज ऑफलाइन सेव्ह होते.',
    'ci.thinking': 'OPD स्लॉट बुक होत आहे…',
    'ci.notfound': 'रुग्ण सापडला नाही — आधी रुग्ण सेव्ह करा.',
    'ci.nofac': 'चेक-इनसाठी कोणतीही सुविधा उपलब्ध नाही.',
    'ci.failed': 'टोकन अयशस्वी: {0}',
    'ci.wait': 'अंदाजे प्रतीक्षा ~{0} मिनिटे',
    'sym.chest_pain': '\u091b\u093e\u0924\u0940\u0924 \u0926\u0941\u0916\u0923\u0947',
    'sym.difficulty_breathing': '\u0936\u094d\u0935\u093e\u0938 \u0918\u0947\u0923\u094d\u092f\u093e\u0938 \u0924\u094d\u0930\u093e\u0938',
    'sym.unconscious': '\u092c\u0947\u0936\u0941\u0926\u094d\u0927 / \u092a\u094d\u0930\u0924\u093f\u0938\u093e\u0926 \u0928\u093e\u0939\u0940',
    'sym.severe_bleeding': '\u0924\u0940\u0935\u094d\u0930 \u0930\u0915\u094d\u0924\u0938\u094d\u0930\u093e\u0935',
    'sym.stiff_neck': '\u092e\u093e\u0928\u0947\u091a\u093e \u0924\u093e\u0920\u0930\u092a\u0923\u093e',
    'sym.pregnancy_complication': '\u0917\u0930\u094d\u092d\u0927\u093e\u0930\u0923\u0947\u0924\u0940\u0932 \u0917\u0941\u0902\u0924\u093e\u0917\u0941\u0902\u0924',
    'sym.high_fever': '\u0924\u0940\u0935\u094d\u0930 \u0924\u093e\u092a',
    'sym.continuous_vomiting': '\u0938\u0924\u0924 \u0909\u0932\u091f\u0940',
    'sym.severe_headache': '\u0924\u0940\u0935\u094d\u0930 \u0921\u094b\u0915\u0947\u0926\u0941\u0916\u0940',
    'sym.dehydration': '\u092a\u093e\u0923\u094d\u092f\u093e\u091a\u0940 \u0915\u092e\u0924\u0930\u0924\u093e (\u0921\u093f\u0939\u093e\u092f\u0921\u094d\u0930\u0947\u0936\u0928)',
    'sym.severe_abdominal_pain': '\u0924\u0940\u0935\u094d\u0930 \u092a\u094b\u091f\u0926\u0941\u0916\u0940',
    'sym.severe_injury': '\u0917\u0902\u092d\u0940\u0930 \u0926\u0941\u0916\u093e\u092a\u0924 / \u0905\u0938\u094d\u0925\u093f\u092d\u0902\u0917',
    'sym.abdominal_pain': '\u092a\u094b\u091f\u0926\u0941\u0916\u0940',
    'sym.diarrhea': '\u091c\u0941\u0932\u093e\u092c',
    'sym.cough_cold': '\u0916\u094b\u0915\u0932\u093e / \u0938\u0930\u094d\u0926\u0940',
    'sym.fatigue': '\u0925\u0915\u0935\u093e / \u0905\u0936\u0915\u094d\u0924\u0924\u093e',
    'sym.body_ache': '\u0905\u0902\u0917\u0926\u0941\u0916\u0940',
    'sym.urination_problem': '\u0935\u093e\u0930\u0902\u0935\u093e\u0930 / \u0935\u0947\u0926\u0928\u093e\u0926\u093e\u092f\u0915 \u0932\u0918\u094d\u0928\u094d\u092f\u093e\u0938',
    'sym.sore_throat': '\u0918\u093e\u0938\u093e / \u0918\u0938\u093e\u0926\u0942\u0916\u0940',
    'sym.joint_pain': '\u0938\u093e\u0902\u0927\u094d\u092f\u093e\u0938\u093e\u0902\u0927\u0940 \u0926\u0941\u0916\u0923\u0947 / \u0938\u0942\u091c',
    'sym.back_pain': '\u092a\u093e\u0920\u0940\u0926\u0941\u0916\u0940',
    'sym.skin_rash': '\u0924\u094d\u0935\u091a\u0947\u0935\u0930 \u092a\u0941\u0930\u091f\u0947 / \u0916\u0941\u091c',
    'sym.eye_problem': '\u0921\u094b\u0933\u094d\u092f\u093e\u0932\u093e \u0932\u093e\u0932 / \u092a\u093e\u0923\u0940 / \u0926\u0941\u0916\u0923\u0947',
    'sym.ear_pain': '\u0915\u093e\u0928 \u0926\u0941\u0916\u0923\u0947 / \u092a\u093e\u0933',
    'sym.dizziness': '\u091a\u0915\u094d\u0915\u0930 / \u0917\u093f\u0926\u094d\u0926\u093f',
    'sym.acidity': '\u090f\u0938\u093f\u0921\u093f\u091f\u0940 / \u0905\u092a\u091a / \u0917\u0948\u0938',
    'sym.constipation': '\u092c\u0926\u092c\u0926',
    'sym.toothache': '\u0926\u093e\u0902\u0924 \u0926\u0941\u0916\u0923\u0947 / \u0939\u093f\u0930\u0921\u0940 \u0938\u092e\u0938\u094d\u092f\u093e',
    'sym.numbness': '\u0938\u0941\u0928\u094d\u0928 \u0939\u094b\u0923\u0947 / \u092e\u0941\u0939\u094b\u0930\u0940',
    'sym.swelling': '\u0938\u0942\u091c (\u091a\u0939\u0947\u0930\u093e / \u0939\u093e\u0925 / \u092a\u093e\u092f)',
    'color.RED': '\u0932\u093e\u0932 (RED)',
    'color.YELLOW': '\u092a\u093f\u0935\u0933\u093e (YELLOW)',
    'color.GREEN': '\u0939\u093f\u0930\u0935\u093e (GREEN)',
    'priority': '\u092a\u094d\u0930\u093e\u0927\u093e\u0928\u094d\u092f {0}',
    'action': '\u0915\u0943\u0924\u0940',
    'reason.symptom': '\u0932\u0915\u094d\u0937\u0923: {0}',
    'reason.spo2_critical': 'SpO2 {0}% \u2014 \u0917\u0902\u092d\u0940\u0930 \u0939\u093e\u092f\u092a\u094b\u0915\u094d\u0938\u093f\u092f\u093e (< 90%)',
    'reason.pulse_critical': '\u0928\u093e\u0921\u0940 {0} bpm (40\u2013140 \u091a\u094d\u092f\u093e \u092c\u093e\u0939\u0947\u0930)',
    'reason.sbp_critical': '\u0938\u093f\u0938\u094d\u091f\u094b\u0932\u093f\u0915 BP {0} mmHg (\u2264 90 \u0915\u093f\u0902\u0935\u093e \u2265 180)',
    'reason.temp_critical': '\u0924\u093e\u092a\u092e\u093e\u0928 {0}\u00b0C (\u0939\u093e\u092f\u092a\u0930\u092a\u093e\u092f\u0930\u0947\u0915\u094d\u0938\u093f\u092f\u093e, \u2265 41)',
    'reason.rr_critical': '\u0936\u094d\u0935\u0938\u0928 \u0926\u0930 {0}/min (8\u201330 \u091a\u094d\u092f\u093e \u092c\u093e\u0939\u0947\u0930)',
    'reason.spo2_border': 'SpO2 {0}% (90\u201393%, \u0938\u0940\u092e\u093e\u0930\u0947\u0937\u0947\u0935\u0930)',
    'reason.pulse_border': '\u0928\u093e\u0921\u0940 {0} bpm (\u0938\u0940\u092e\u093e\u0930\u0947\u0937\u0947\u0935\u0930)',
    'reason.sbp_border': '\u0938\u093f\u0938\u094d\u091f\u094b\u0932\u093f\u0915 BP {0} mmHg (\u0938\u0940\u092e\u093e\u0930\u0947\u0937\u0947\u0935\u0930)',
    'reason.temp_border': '\u0924\u093e\u092a\u092e\u093e\u0928 {0}\u00b0C (\u0924\u0940\u0935\u094d\u0930 \u0924\u093e\u092a, 39\u201341)',
    'reason.multi_moderate': '\u0905\u0928\u0947\u0915 \u092e\u0927\u094d\u092f\u092e \u0932\u0915\u094d\u0937\u0923\u0947: {0}',
    'reason.no_findings': 'RED/YELLOW \u0906\u0922\u0933\u0932\u0947 \u0928\u093e\u0939\u0940 \u2014 \u0935\u094d\u0939\u093e\u092f\u091f\u0932\u094d\u0938 \u0938\u093e\u092e\u093e\u0928\u094d\u092f \u0936\u094d\u0930\u0947\u0923\u0940\u0924',
    'rec.red': '\u0906\u092a\u0924\u094d\u0915\u093e\u0932\u0940\u0928: \u0924\u094d\u0935\u0930\u093f\u0924 \u0935\u093e\u0939\u0924\u0941\u0915\u0940\u091a\u0940 \u0935\u094d\u092f\u0935\u0938\u094d\u0925\u093e \u0915\u0930\u093e / 108 \u0935\u0930 \u0915\u0949\u0932 \u0915\u0930\u093e. \u0930\u0941\u0917\u094d\u0923\u093e\u0932\u093e \u0905\u0928\u093e\u0935\u0936\u094d\u092f\u0915 \u0939\u0932\u0935\u0942 \u0928\u0915\u093e. \u0906\u0924\u094d\u0924\u093e\u091a \u091c\u0935\u0933\u091a\u094d\u092f\u093e \u0930\u0941\u0917\u094d\u0923\u093e\u0932\u092f\u093e\u0932\u093e \u0915\u0933\u0935\u093e.',
    'rec.yellow': '\u0924\u093e\u0924\u0921\u0940\u091a\u0947: \u0930\u0941\u0917\u094d\u0923\u093e\u0932\u093e \u0906\u091c\u091a PHC (\u092a\u094d\u0930\u093e\u0925\u092e\u093f\u0915 \u0906\u0930\u094b\u0917\u094d\u092f \u0915\u0947\u0902\u0926\u094d\u0930) \u0917\u093e\u0920\u0923\u094d\u092f\u093e\u091a\u093e \u0938\u0932\u094d\u0932\u093e\u0939 \u0926\u094d\u092f\u093e. \u0932\u0915\u094d\u0937\u0923\u0947 \u0915\u093e\u092f\u092e \u0930\u093e\u0939\u093f\u0932\u094d\u092f\u093e\u0938 \u0915\u093f\u0902\u0935\u093e \u0935\u093e\u0922\u0932\u094d\u092f\u093e\u0938 4 \u0924\u093e\u0938\u093e\u0902\u0924 \u092a\u0941\u0928\u094d\u0939\u093e \u0924\u092a\u093e\u0938\u0923\u0940 \u0915\u0930\u093e.',
    'rec.green': '\u0928\u093f\u092f\u092e\u093f\u0924: \u0918\u0930\u0917\u0941\u0924\u0940 \u0915\u093e\u0933\u091c\u0940\u091a\u093e \u0938\u0932\u094d\u0932\u093e\u0939. \u0932\u0915\u094d\u0937\u0923\u0947 48 \u0924\u093e\u0938\u093e\u0902\u092a\u0947\u0915\u094d\u0937\u093e \u091c\u093e\u0938\u094d\u0924 \u0930\u093e\u0939\u093f\u0932\u094d\u092f\u093e\u0938 PHC \u0932\u093e \u0928\u093f\u092f\u092e\u093f\u0924 \u092d\u0947\u091f \u0926\u094d\u092f\u093e.',
    'hint.sync': '<b>\u0928\u0947\u091f\u0935\u0930\u094d\u0915 \u0938\u094d\u0925\u093f\u0924\u0940\u091a\u0947 \u0905\u0928\u0941\u0915\u0930\u0923 \u0915\u0930\u093e</b> \u092a\u0942\u0930\u094d\u0923 \u0911\u092b\u0932\u093e\u0907\u0928 \u2192 \u0911\u0928\u0932\u093e\u0907\u0928 \u0930\u093f\u0915\u0935\u0930\u0940 \u0926\u093e\u0916\u0935\u0923\u094d\u092f\u093e\u0938\u093e\u0920\u0940 \u0938\u094d\u0935\u093f\u091a \u092c\u0926\u0932\u093e: <b>\u0911\u092b\u0932\u093e\u0907\u0928</b> \u0905\u0938\u0924\u093e\u0928\u093e \u092a\u094d\u0930\u0924\u094d\u092f\u0947\u0915 \u0928\u094b\u0902\u0926 \u092f\u093e \u0921\u093f\u0935\u094d\u0939\u093e\u0907\u0938\u0935\u0930 \u0930\u093e\u0902\u0917\u0947\u0924 \u091c\u093e\u0924\u0947. \u092a\u0930\u0924 <b>\u0911\u0928\u0932\u093e\u0907\u0928</b> \u0915\u0947\u0932\u094d\u092f\u093e\u0935\u0930 \u0930\u0941\u0917\u094d\u0923 \u0928\u094b\u0902\u0926\u0940 \u092c\u0948\u0915\u0947\u0902\u0921\u0932\u093e \u091c\u093e\u0924\u093e\u0924 <i>\u0906\u0923\u093f</i> \u0938\u0930\u094d\u0935\u0930\u091a\u094d\u092f\u093e \u0930\u093e\u0902\u0917\u0947\u0924\u0940\u0932 SMS \u090f\u0915\u093e\u091a \u092a\u094d\u0930\u0935\u093e\u0939\u093e\u0924 \u092a\u093e\u0920\u0935\u0932\u094d\u092f\u093e \u091c\u093e\u0924\u093e\u0924.',
    'net.online_label': '\u0928\u0947\u091f\u0935\u0930\u094d\u0915: \u0911\u0928\u0932\u093e\u0907\u0928',
    'net.offline_label': '\u0928\u0947\u091f\u0935\u0930\u094d\u0915: \u0911\u092b\u0932\u093e\u0907\u0928',
    'net.sub.online': '\u0928\u094b\u0902\u0926\u0940 \u0932\u0917\u0947\u091a \u0938\u093f\u0902\u0915 \u0939\u094b\u0924\u093e\u0924',
    'net.sub.offline': '\u0911\u0928\u0932\u093e\u0907\u0928 \u0939\u094b\u0908\u092a\u0930\u094d\u092f\u0902\u0924 \u0928\u094b\u0902\u0926\u0940 \u0932\u094b\u0915\u0932 \u0930\u093e\u0902\u0917\u0947\u0924 \u0930\u093e\u0939\u0924\u093e\u0924',
    'sync.pending': '\u092a\u094d\u0930\u0932\u0902\u092c\u093f\u0924 \u0932\u094b\u0915\u0932 \u0928\u094b\u0902\u0926\u0940',
    'sync.msgqueue': '\u0938\u0930\u094d\u0935\u0930 \u0938\u0902\u0926\u0947\u0936 \u0930\u093e\u0902\u0917',
    'sync.last': '\u0936\u0947\u0935\u091f\u091a\u0947 \u0938\u093f\u0902\u0915',
    'sync.never': '\u0915\u0927\u0940\u0939\u0940 \u0928\u093e\u0939\u0940',
    'th.type': '\u092a\u094d\u0930\u0915\u093e\u0930',
    'th.created': '\u0924\u092f\u093e\u0930 \u0915\u0947\u0932\u0947',
    'th.status': '\u0938\u094d\u0925\u093f\u0924\u0940',
    'btn.sync_now': '\u0906\u0924\u093e \u0938\u093f\u0902\u0915 \u0915\u0930\u093e \u2192',
    'summary.empty': '\u0905\u0938\u093f\u0902\u0915 \u0928\u094b\u0902\u0926\u0940 \u0928\u093e\u0939\u0940\u0924 \u2014 \u0938\u0930\u094d\u0935 \u0905\u0926\u094d\u092f\u092f\u093e\u0935\u0924.',
    'summary.pending': '{0} \u0928\u094b\u0902\u0926\u0940 \u0938\u093f\u0902\u0915\u091a\u094d\u092f\u093e \u092a\u094d\u0930\u0924\u0940\u0915\u094d\u0937\u0947\u0924: {1}',
    'type.patient': '\u0930\u0941\u0917\u094d\u0923',
    'type.encounter': '\u092d\u0947\u091f',
    'type.triage': '\u0924\u092a\u093e\u0938\u0923\u0940',
    'status.queued': '\u0930\u093e\u0902\u0917\u0947\u0924',
    'msg.queued': '\u0930\u093e\u0902\u0917\u0947\u0924\u0940\u0932 SMS: {0} \u092a\u093e\u0920\u0935\u0923\u094d\u092f\u093e\u091a\u094d\u092f\u093e \u092a\u094d\u0930\u0924\u0940\u0915\u094d\u0937\u0947\u0924',
    'msg.queued_offline': '\u0930\u093e\u0902\u0917\u0947\u0924\u0940\u0932 SMS: \u2014 (\u0911\u092b\u0932\u093e\u0907\u0928; \u0911\u0928\u0932\u093e\u0907\u0928 \u091d\u093e\u0932\u094d\u092f\u093e\u0935\u0930 \u0924\u092a\u093e\u0938\u093e)',
    't.valid_abha': '\u092f\u094b\u0917\u094d\u092f 14 \u0905\u0902\u0915\u0940 ABHA ID \u092a\u094d\u0930\u0935\u093f\u0937\u094d\u091f \u0915\u0930\u093e',
    't.not_found': '\u0930\u0941\u0917\u094d\u0923 \u0938\u093e\u092a\u0921\u0932\u093e \u0928\u093e\u0939\u0940',
    't.not_found_offline': '\u0930\u0941\u0917\u094d\u0923 \u0938\u093e\u092a\u0921\u0932\u093e \u0928\u093e\u0939\u0940 (\u0911\u092b\u0932\u093e\u0907\u0928 \u0915\u0948\u0936\u092e\u0927\u094d\u092f\u0947 \u0928\u093e\u0939\u0940)',
    't.loaded_server': '\u0930\u0941\u0917\u094d\u0923 \u0938\u0930\u094d\u0935\u0939\u0930\u0935\u0930\u0942\u0928 \u092e\u093f\u0933\u093e\u0932\u093e',
    't.loaded_cache': '\u0930\u0941\u0917\u094d\u0923 \u0932\u094b\u0915\u0932 \u0915\u0948\u0936\u092e\u0927\u0942\u0928 \u092e\u093f\u0933\u093e\u0932\u093e',
    't.qr_scanned': 'QR \u0938\u094d\u0915\u0948\u0928 \u091d\u093e\u0932\u0947: {0}',
    't.fill_required': '\u0915\u0943\u092a\u092f\u093e \u0906\u0935\u0936\u094d\u092f\u0915 \u092e\u093e\u0939\u093f\u0924\u0940 \u092d\u0930\u093e: {0}',
    't.phone_invalid': '\u092f\u094b\u0917\u094d\u092f 10 \u0905\u0902\u0915\u0940 \u092e\u094b\u092c\u093e\u0907\u0932 \u0915\u094d\u0930\u092e\u093e\u0902\u0915 \u092a\u094d\u0930\u0935\u093f\u0937\u094d\u091f \u0915\u0930\u093e',
    't.pincode_invalid': '\u092f\u094b\u0917\u094d\u092f 6 \u0905\u0902\u0915\u0940 \u092a\u093f\u0928 \u0915\u094b\u0921 \u092a\u094d\u0930\u0935\u093f\u0937\u094d\u091f \u0915\u0930\u093e',
    't.saved_synced': '\u091c\u0924\u0928 + \u0938\u093f\u0902\u0915 \u091d\u093e\u0932\u0947 ({0} \u0924\u092f\u093e\u0930)',
    't.saved_offline': '\u0932\u094b\u0915\u0932 \u091c\u0924\u0928 \u091d\u093e\u0932\u0947 \u2014 \u0911\u0928\u0932\u093e\u0907\u0928 \u091d\u093e\u0932\u094d\u092f\u093e\u0935\u0930 \u0938\u093f\u0902\u0915 \u0939\u094b\u0908\u0932',
    't.sync_failed': '\u0932\u094b\u0915\u0932 \u091c\u0924\u0928 \u091d\u093e\u0932\u0947; \u0938\u093f\u0902\u0915 \u0905\u092f\u0936\u0938\u094d\u0935\u0940: {0}',
    't.abha_created': '\u0938\u093f\u092e\u094d\u092f\u0941\u0932\u0947\u091f\u0947\u0921 ABHA ID \u0924\u092f\u093e\u0930 \u091d\u093e\u0932\u0940: {0}',
    't.dup_local': '\u092f\u093e ABHA ID \u091a\u093e \u0930\u0941\u0917\u094d\u0923 \u0906\u0927\u0940\u092a\u093e\u0938\u0942\u0928 \u092f\u093e \u0921\u093f\u0935\u094d\u0939\u093e\u0907\u0938\u0935\u0930 \u0906\u0939\u0947',
    't.triage_saved': '\u0924\u092a\u093e\u0938\u0923\u0940 \u091c\u0924\u0928 + \u0938\u093f\u0902\u0915 \u091d\u093e\u0932\u0940 ({0} \u0928\u094b\u0902\u0926\u0940 \u0924\u092f\u093e\u0930)',
    't.triage_offline': '\u0924\u092a\u093e\u0938\u0923\u0940 \u0911\u092b\u0932\u093e\u0907\u0928 \u091c\u0924\u0928 \u091d\u093e\u0932\u0940 \u2014 \u0921\u0949\u0915\u094d\u091f\u0930 \u0930\u093e\u0902\u0917\u0947\u0924 \u0938\u093f\u0902\u0915 \u0915\u0930\u0923\u094d\u092f\u093e\u0938\u093e\u0920\u0940 \u0911\u0928\u0932\u093e\u0907\u0928 \u0915\u0930\u093e',
    't.net_online': '\u0928\u0947\u091f\u0935\u0930\u094d\u0915 \u0911\u0928\u0932\u093e\u0907\u0928 \u2014 \u092a\u094d\u0930\u0932\u0902\u092c\u093f\u0924 \u0928\u094b\u0902\u0926\u0940 + SMS \u0930\u093e\u0902\u0917 \u092a\u093e\u0920\u0935\u0932\u0940 \u091c\u093e\u0924 \u0906\u0939\u0947\u2026',
    't.net_offline': '\u0928\u0947\u091f\u0935\u0930\u094d\u0915 \u0911\u092b\u0932\u093e\u0907\u0928 \u2014 \u0928\u0935\u0940\u0928 \u0928\u094b\u0902\u0926\u0940 \u092f\u093e \u0921\u093f\u0935\u094d\u0939\u093e\u0907\u0938\u0935\u0930 \u0930\u093e\u0902\u0917\u0947\u0924 \u091c\u093e\u0924\u0940\u0932',
    't.toggle_first': '\u092a\u094d\u0930\u0925\u092e \u0928\u0947\u091f\u0935\u0930\u094d\u0915 \u0911\u0928\u0932\u093e\u0907\u0928 \u0915\u0930\u093e',
    't.sync_done': '\u0938\u093f\u0902\u0915 \u092a\u0942\u0930\u094d\u0923: {0} \u0924\u092f\u093e\u0930, {1} \u0905\u092a\u0921\u0947\u091f \u00b7 {2} SMS \u092a\u093e\u0920\u0935\u0932\u094d\u092f\u093e',
    't.sync_fail': '\u0938\u093f\u0902\u0915 \u0905\u092f\u0936\u0938\u094d\u0935\u0940: {0}',
    't.bg_sync_done': '\u092c\u0948\u0915\u0917\u094d\u0930\u093e\u0909\u0902\u0921 \u0938\u093f\u0902\u0915: {0} \u0924\u092f\u093e\u0930',
    'abha.step1.title': 'आधारवरून ABHA ID तयार करा',
    'abha.step1.desc': 'लाभार्थ्याचे नाव व आधार क्रमांक ABDM द्वारे सत्यापित केले जातात (प्रत्यक्षात आधार OTP ने). <i>डेमो नोंद: सिम्युलेटेड — आधार क्रमांक कुठेही साठवला किंवा पाठवला जात नाही.</i>',
    'abha.aadhaar_name': 'पूर्ण नाव (आधाराप्रमाणे)',
    'abha.aadhaar': 'आधार क्रमांक (12 अंक)',
    'abha.create_btn': 'ABHA ID तयार करा',
    'abha.created_title': '✅ ABHA ID तयार झाले',
    'abha.created_next': 'आता खाली लाभार्थ्याचा तपशील पूर्ण करा आणि रुग्ण जतन करा.',
    'abha.aadhaar_invalid': 'कृपया 12 अंकांचा योग्य आधार क्रमांक द्या',
    'abha.create_first': 'आधी ABHA ID तयार करा',
    'card.health': 'आरोग्य तपशील',
    'card.hr': 'उच्च धोका',
    'card.chronic': 'जुनाट आजार',
    'card.latest': 'अलीकडील तपासणी (ट्रायेज)',
    'card.referral': 'रेफरल',
    'card.followup': 'पुढील फॉलो-अप',
    'card.none': 'अजून आरोग्य नोंदी नाहीत — तपासणी करा किंवा भेट नोंद जोडा',
  },

  bn: {
    'title.tasks': '🩺 গ্রামআরোগ্য · আমার কাজ',
    'nav.task': 'আমার কাজ',
    'hint.tasks': '<b>দৈনিক ফলো-আপ তালিকা</b> আপনার কাছে বরাদ্দ উচ্চ-ঝুঁকি ফলো-আপ (মাতৃত্ব, শিশু টিকাকরণ, ডায়াবেটিস, উচ্চ রক্তচাপ, TB, বয়স্ক)। কাজ সম্পন্ন চিহ্নিত করুন — এগুলো PHC-তে সিঙ্ক হয় ও ড্যাশবোর্ড আপডেট করে।',
    'lbl.family': 'পারিবারিক ID (ঐচ্ছিক)',
    'tasks.stat.due_today': 'আজ দিতে হবে',
    'tasks.stat.upcoming': 'আসন্ন',
    'tasks.stat.overdue': 'বিলম্বিত',
    'tasks.stat.completed': 'সম্পন্ন',
    'tasks.loading': 'কাজ লোড হচ্ছে…',
    'tasks.offline_cached': 'অফলাইন তালিকা দেখানো হচ্ছে — রিফ্রেশ করতে সিঙ্ক করুন',
    'tasks.empty': 'কোনো {0} কাজ নেই',
    'tasks.due': 'দিতে হবে: {0}',
    'tasks.cat': '{0} যত্ন',
    'tasks.mark_done': '✓ সম্পন্ন',
    'tasks.done_offline': 'অফলাইনে সংরক্ষিত — পরে সিঙ্ক হবে',
    'tasks.done_synced': 'ফলো-আপ সম্পন্ন ও সিঙ্ক হয়েছে',
    'tasks.done_failed': 'সংরক্ষণ করা যায়নি: {0}',
    'emer.title': '🚨 জরুরি ব্যবস্থা — স্বাভাবিক সারি এড়িয়ে',
    'emer.to': 'রেফার করুন (সুবিধা)',
    'emer.auto': 'জেলা হাসপাতাল (না বাছলে স্বয়ংক্রিয়)',
    'emer.reason_ph': 'কারণ (যেমন বুকে ব্যথা ও শ্বাসকষ্ট)',
    'emer.btn': 'জরুরি রেফারেল তৈরি করুন',
    'emer.no_abha': 'উপরে ১৪ অঙ্কের ABHA ID দিন যাতে রেফারেল রোগীর সাথে যুক্ত হয়',
    'emer.created_offline': 'জরুরি রেফারেল সারিতে — পাঠাতে সিঙ্ক করুন',
    'emer.created_synced': 'জরুরি রেফারেল তৈরি ও সিঙ্ক হয়েছে',

    // teleconsult (Feature 5) — request a doctor call for the shown patient
    'btn.tele': '📞 ডাক্তার কলের অনুরোধ করুন',
    'tele.title': 'ডাক্তার টেলিকনসাল্টেশনের অনুরোধ',
    'tele.patient': 'রোগী: {0}',
    'tele.mode': 'কলের ধরন',
    'tele.mode.audio': 'অডিও (কম ব্যান্ডউইথ)',
    'tele.mode.video': 'ভিডিও',
    'tele.mode.chat': 'চ্যাট / শুধু নোট',
    'tele.reason': 'কলের কারণ',
    'tele.reason_ph': 'যেমন ২ দিন ধরে জ্বর, ডাক্তারের পরামর্শ দরকার',
    'tele.request': 'কলের অনুরোধ করুন',
    'tele.queued': 'কল অনুরোধ সংরক্ষিত — অনলাইনে এলে সিঙ্ক হবে',
    'tele.sent': 'কল অনুরোধ ডাক্তারের কাছে পাঠানো হয়েছে',
    'tele.no_patient': 'আগে রোগী খুঁজুন বা নিবন্ধন করুন',
    'tele.status.requested': 'ডাক্তার কল গ্রহণ করার অপেক্ষায়',
    'tele.status.accepted': '{0} কল গ্রহণ করেছেন — শীঘ্রই শুরু হবে',
    'tele.status.live': 'কল চলছে — এখনই রোগীর সাথে যুক্ত হন',
    'tele.status.declined': 'ডাক্তার এই অনুরোধ প্রত্যাখ্যান করেছেন',
    'tele.status.completed': 'কল শেষ হয়েছে',
    'tele.doctor': 'ডাক্তার',
    'tele.join': 'কলে যোগ দিন',
    'tele.notify.accepted': '{0} কল গ্রহণ করেছেন — যোগ দেওয়ার প্রস্তুতি নিন',
    'tele.notify.live': '📞 ডাক্তার কল শুরু করেছেন — এখনই যোগ দিন',
    'tele.notify.declined': 'ডাক্তার এই কল অনুরোধ প্রত্যাখ্যান করেছেন',
    'type.referral': 'রেফারেল',
    'type.followup': 'ফলো-আপ',
    'type.teleconsult': 'টেলিকনসাল্ট',
    'nav.referrals': 'রেফারেল',
    'title.referral': '🩺 গ্রামআরোগ্য · নতুন রেফারেল',
    'title.tracking': '🩺 গ্রামআরোগ্য · রেফারেল',
    'hint.referral': '<b>রেফারেল তৈরি করুন</b> রোগীকে উচ্চতর সুবিধায় (CHC / জেলা হাসপাতাল) পাঠান। প্রথমে এই ডিভাইসে সংরক্ষিত হয়, অনলাইনে এলে PHC-তে সিঙ্ক হয়। সর্বশেষ ট্রায়েজ স্বয়ংক্রিয়ভাবে যুক্ত হয়।',
    'hint.tracking': '<b>রেফারেল ট্র্যাকিং</b> পাঠানো প্রতিটি রেফারেল অনুসরণ করুন: পাঠানো → গৃহীত → সম্পূর্ণ। অফলাইন রেফারেল কুইনে আসামাত্র এখানে দেখা যায়।',
    'lbl.age': 'বয়স (ঐচ্ছিক, জন্মতারিখ অজানা থাকলে)',
    'reg.highrisk': 'উচ্চ-ঝুঁকি বিভাগ (সব প্রযোজ্য নির্বাচন করুন)',
    'reg.allergies': 'অ্যালার্জি (ঐচ্ছিক)',
    'reg.allergies_ph': 'যেমন পেনিসিলিন, চিনাবাদাম',
    'reg.chronic_conditions': 'দীর্ঘস্থায়ী রোগ (ঐচ্ছিক)',
    'reg.chronic_ph': 'যেমন টিবি, হাঁপানি, ডায়াবেটিস',
    'hr.pregnant': 'গর্ভবতী',
    'hr.diabetic': 'ডায়াবেটিক',
    'hr.htn': 'উচ্চ রক্তচাপ',
    'hr.elderly': 'বয়স্ক (65+)',
    'hr.chronic': 'দীর্ঘস্থায়ী রোগ',
    'mp.title': '👥 আমার রোগী',
    'mp.search_ph': 'নাম, ABHA ID বা গ্রাম দিয়ে খুঁজুন…',
    'mp.f.all': 'সব',
    'mp.f.highrisk': 'উচ্চ-ঝুঁকি',
    'mp.f.followups': 'ফলো-আপ বাকি',
    'mp.f.pending': 'সিঙ্ক বাকি',
    'mp.empty': 'এখনো কোনো রোগী নিবন্ধিত নয়। প্রথম রোগী নিবন্ধন করুন!',
    'mp.view': 'রেকর্ড দেখুন',
    'mp.new_triage': 'নতুন ট্রায়েজ',
    'mp.pending': 'সিঙ্ক বাকি',
    'mp.synced': 'সিঙ্ক হয়েছে',
    'mp.fu_due': 'এই সপ্তাহে ফলো-আপ বাকি',
    'ref.title': 'নতুন রেফারেল',
    'ref.patient': 'রোগী',
    'ref.patient_ph': 'রোগীর নাম বা ABHA খুঁজুন…',
    'ref.reason': 'রেফারেলের কারণ',
    'ref.r.specialist': 'বিশেষজ্ঞ পরামর্শ প্রয়োজন',
    'ref.r.diagnostics': 'ডায়াগনস্টিক পরীক্ষা প্রয়োজন',
    'ref.r.emergency': 'জরুরি পরিচর্যা',
    'ref.r.routine': 'নিয়মিত পরীক্ষা',
    'ref.r.pregnancy': 'গর্ভাবস্থা জটিলতা',
    'ref.r.chronic': 'দীর্ঘস্থায়ী রোগ ব্যবস্থাপনা',
    'ref.priority': 'অগ্রাধিকার',
    'ref.p.routine': '🟢 নিয়মিত',
    'ref.p.urgent': '🟡 জরুরি',
    'ref.p.emergency': '🔴 জরুরি অবস্থা',
    'ref.facility': 'কোন সুবিধায় পাঠাবেন',
    'ref.facility_ph': 'সুবিধা নির্বাচন করুন…',
    'ref.notes': 'অতিরিক্ত নোট (ঐচ্ছিক)',
    'ref.notes_ph': 'যেমন সাথে নেওয়ার রিপোর্ট…',
    'ref.submit': 'রেফারেল পাঠান',
    'ref.need_patient': 'আগে রোগী নির্বাচন করুন',
    'ref.need_facility': 'আগে সুবিধা নির্বাচন করুন',
    'ref.sent_synced': 'রেফারেল পাঠানো হয়েছে! PHC শীঘ্রই পর্যালোচনা করবে',
    'ref.sent_queued': 'রেফারেল ডিভাইসে সংরক্ষিত — অনলাইনে এলে সিঙ্ক হবে',
    'ref.triage_pending': '{0}টি অপেক্ষমাণ স্থানীয় ট্রায়েজ রিপোর্ট যুক্ত হচ্ছে',
    'ref.triage_attached': 'সর্বশেষ ট্রায়েজ যুক্ত: {0} ({1})',
    'track.title': 'রেফারেল ট্র্যাকিং',
    'track.new': '+ নতুন রেফারেল',
    'track.f.sent': '🟡 পাঠানো',
    'track.f.accepted': '🟢 গৃহীত',
    'track.f.completed': '🔵 সম্পূর্ণ',
    'track.f.noshow': '🔴 অনুপস্থিত',
    'track.f.rejected': 'প্রত্যাখ্যাত',
    'track.empty': 'এখনো কোনো রেফারেল তৈরি হয়নি',
    'track.to_phc': 'PHC (সিঙ্ক বাকি)',
    'track.details': 'বিস্তারিত দেখুন',
    'track.contact': 'PHC-তে যোগাযোগ',
    'track.status': 'অবস্থা',
    'track.accepted': 'গৃহীত',
    'track.completed': 'সম্পূর্ণ',
    'track.accepted_on': '{0} তারিখে গৃহীত',
    'track.s.sent': 'পাঠানো',
    'track.s.accepted': 'গৃহীত',
    'track.s.completed': 'সম্পূর্ণ',
    'track.s.no_show': 'অনুপস্থিত',
    'track.s.rejected': 'প্রত্যাখ্যাত',
    'track.s.pending_sync': 'সিঙ্ক বাকি',
    'track.s.created': 'তৈরি',
    'tasks.overdue_count': '{0}টি বিলম্বিত ফলো-আপ',
    'tasks.overdue_by': '{0} দিন বিলম্বিত',
    'tasks.days_left': '{0} দিন বাকি',
    'tasks.due_today': 'আজ নির্ধারিত',
    'tasks.resched': 'পুনর্নির্ধারণ',
    'tasks.resched_online': 'পুনর্নির্ধারণের জন্য ইন্টারনেটে যুক্ত হন',
    'tasks.need_date': 'নতুন তারিখ নির্বাচন করুন',
    'tasks.resched_done': 'ফলো-আপ পুনর্নির্ধারিত হয়েছে',
    'tasks.done_title': 'ফলো-আপ সম্পূর্ণ চিহ্নিত করুন',
    'tasks.vitals': 'ভাইটাল রেকর্ড করা হয়েছে (BP, শর্করা, ওজন…)',
    'tasks.advised': 'রোগীকে পরামর্শ দেওয়া হয়েছে',
    'tasks.meds': 'ঔষধ দেওয়া হয়েছে',
    'tasks.notes': 'নোট (ঐচ্ছিক)',
    'tasks.notes_ph': 'যেমন BP 130/85, লবণ কমানোর পরামর্শ…',
    'tasks.confirm_done': 'সম্পূর্ণ নিশ্চিত করুন',
    'tasks.all_checks': 'ভাইটাল, পরামর্শ ও ঔষধ — সব রেকর্ড করা হয়েছে',
    'tasks.resched_title': 'ফলো-আপ পুনর্নির্ধারণ করুন',
    'tasks.new_date': 'নতুন নির্ধারিত তারিখ',
    'tasks.confirm_resched': 'পুনর্নির্ধারণ করুন',
    'sos.btn': 'SOS',
    'sos.title': '🚨 জরুরি SOS',
    'sos.patient': 'রোগী',
    'sos.select_patient': 'রোগী নির্বাচন করুন…',
    'sos.type': 'জরুরি ধরন',
    'sos.t.chest': '🫀 বুকে ব্যথা',
    'sos.t.stroke': '🧠 স্ট্রোক',
    'sos.t.bleed': '🩸 তীব্র রক্তক্ষরণ',
    'sos.t.uncon': '😵 অজ্ঞান',
    'sos.t.preg': '🤰 গর্ভাবস্থা জটিলতা',
    'sos.t.conv': '🤒 তীব্র জ্বর + খিঁচুনি',
    'sos.t.other': '🚑 অন্যান্য',
    'sos.location': 'অবস্থান (GPS স্বয়ংক্রিয়)',
    'sos.details': 'অতিরিক্ত বিবরণ (ঐচ্ছিক)',
    'sos.details_ph': 'কী ঘটেছে বর্ণনা করুন…',
    'sos.send': 'জরুরি সতর্কতা পাঠান',
    'sos.confirm_txt': 'আপনি কি নিশ্চিত? এটি শুধুমাত্র জরুরি অবস্থার জন্য।',
    'sos.confirm_yes': 'হ্যাঁ, সতর্কতা পাঠান',
    'sos.need_patient': 'আগে রোগী নির্বাচন করুন',
    'sos.need_type': 'জরুরি ধরন নির্বাচন করুন',
    'sos.sent': 'জরুরি সতর্কতা পাঠানো হয়েছে!',
    'sos.synced': 'জরুরি রেফারেল তৈরি হয়ে PHC-তে সিঙ্ক হয়েছে',
    'sos.queued': 'সতর্কতা ডিভাইসে কুইনে — অনলাইনে এলে সিঙ্ক হবে',
    'sos.eta': 'অ্যাম্বুলেন্স ETA: ১৫ মিনিট',
    'sos.call_phc': 'PHC-তে কল করুন',
    'sos.call_patient': 'রোগীকে কল করুন',
    'sync.status_title': 'সিঙ্ক অবস্থা',
    'sync.total': 'মোট অপেক্ষমাণ',
    'sync.progress': 'ব্যাচ {0} / {1} সিঙ্ক হচ্ছে…',
    'sync.starting': 'সিঙ্ক শুরু হচ্ছে…',
    'sync.auto_sync': 'ইন্টারনেট ফিরে এসেছে। অপেক্ষমাণ ডেটা সিঙ্ক হচ্ছে…',
    'sync.failed': '⚠️ ব্যর্থ আইটেম',
    'sync.retry_all': 'সব পুনরায় চেষ্টা করুন',
    'sync.retry': 'পুনরায় চেষ্টা',
    'sync.delete': 'মুছুন',
    'sync.failed_short': 'ব্যর্থ',
    'sync.pending_short': 'অপেক্ষমাণ',
    'th.detail': 'রোগী',
    'call.title': 'কল',
    'call.dial': 'এখনই কল করুন',
    'call.copy': 'নম্বর কপি করুন',
    'call.copied': 'নম্বর কপি হয়েছে',
    'call.copy_fail': 'কপি করা যায়নি — নম্বরটি নিজে লিখে নিন',
    'call.no_number': 'ফাইলে কোনো ফোন নম্বর নেই',
    'asha_phone.title': 'আমার মোবাইল নম্বর (SMS সতর্কতা)',
    'asha_phone.hint': 'আপনার পাঠানো রেফারেল গৃহীত/প্রত্যাখ্যাত/অনুপস্থিত হলে এখানে SMS আসবে।',
    'asha_phone.save': 'সংরক্ষণ',
    'asha_phone.saved': 'সংরক্ষিত — SMS সতর্কতা এখানে আসবে',
    'asha_phone.cleared': 'মুছে ফেলা হয়েছে',
    'title.index': '\ud83e\ude7a \u0997\u09cd\u09b0\u09be\u09ae\u0986\u09b0\u09cb\u0997\u09cd\u09af \u00b7 \u0986\u09b6\u09be',
    'title.triage': '\ud83e\ude7a \u0997\u09cd\u09b0\u09be\u09ae\u0986\u09b0\u09cb\u0997\u09cd\u09af \u00b7 \u099f\u09cd\u09b0\u09be\u09af\u09be\u099c',
    'title.sync': '\ud83e\ude7a \u0997\u09cd\u09b0\u09be\u09ae\u0986\u09b0\u09cb\u0997\u09cd\u09af \u00b7 \u09b8\u09bf\u0982\u0995',
    'nav.search': '\u09b0\u09cb\u0997\u09c0 \u0996\u09c1\u0981\u099c\u09c1\u09a8',
    'nav.triage': '\u099f\u09cd\u09b0\u09be\u09af\u09be\u099c',
    'nav.sync': '\u09b8\u09bf\u0982\u0995',
    'pill.online': '\u0985\u09a8\u09b2\u09be\u0987\u09a8',
    'pill.offline': '\u0985\u09ab\u09b2\u09be\u0987\u09a8',
    'hint.index': '<b>\u09aa\u09cd\u09b0\u09a5\u09ae\u09c7 \u0985\u09ab\u09b2\u09be\u0987\u09a8</b> \u0987\u09a8\u09cd\u099f\u09be\u09b0\u09a8\u09c7\u099f \u099b\u09be\u09a1\u09bc\u09be\u0987 \u0995\u09be\u099c \u0995\u09b0\u09c7\u0964 14 \u0985\u0982\u0995\u09c7\u09b0 ABHA ID \u09a6\u09bf\u09a8, \u0985\u09a5\u09ac\u09be \u09a8\u09c0\u099a\u09c7\u09b0 QR \u09b8\u09cd\u0995\u09cd\u09af\u09be\u09a8 \u0995\u09b0\u09c1\u09a8\u0964 \u09b0\u09c7\u0995\u09b0\u09cd\u09a1 \u09a1\u09bf\u09ad\u09be\u0987\u09b8\u09c7 \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09bf\u09a4 \u09b9\u09df \u098f\u09ac\u0982 \u0985\u09a8\u09b2\u09be\u0987\u09a8\u09c7 \u09ab\u09bf\u09b0\u09b2\u09c7 \u09b8\u09bf\u0982\u0995 \u09b9\u09df\u0964',
    'find.title': 'ABHA ID \u09a6\u09bf\u09af\u09bc\u09c7 \u09b0\u09cb\u0997\u09c0 \u0996\u09c1\u0981\u099c\u09c1\u09a8',
    'ph.abha_search': '14 \u0985\u0982\u0995\u09c7\u09b0 ABHA (\u09af\u09c7\u09ae\u09a8 91214455667701)',
    'find.btn': '\u09b0\u09cb\u0997\u09c0 \u0996\u09c1\u0981\u099c\u09c1\u09a8',
    'reg.title': '\u09a8\u09a4\u09c1\u09a8 \u09b0\u09cb\u0997\u09c0 \u09a8\u09bf\u09ac\u09a8\u09cd\u09a7\u09a8 (\u0985\u09ab\u09b2\u09be\u0987\u09a8\u09c7 \u0995\u09be\u099c \u0995\u09b0\u09c7)',
    'reg.question': '\u09b2\u09be\u09ad\u099c\u09a8\u0995\u09c7\u09b0 \u0995\u09be\u099b\u09c7 \u0995\u09bf \u0986\u0997\u09c7 \u09a5\u09c7\u0995\u09c7\u0987 ABHA ID \u0986\u099b\u09c7?',
    'reg.has_yes': '\u09b9\u09cd\u09af\u09be\u0981 \u2014 ABHA ID \u0986\u099b\u09c7',
    'reg.has_no': '\u09a8\u09be \u2014 \u09a8\u09a4\u09c1\u09a8 \u09a4\u09c8\u09b0\u09bf \u0995\u09b0\u09c1\u09a8',
    'lbl.abha': 'ABHA ID (14 \u0985\u0982\u0995)',
    'abha.title': '\u09a8\u09c0\u099a\u09c7\u09b0 \u09a4\u09a5\u09cd\u09af \u09a5\u09c7\u0995\u09c7 \u09a8\u09a4\u09c1\u09a8 ABHA ID \u09a4\u09c8\u09b0\u09bf \u0995\u09b0\u09c1\u09a8',
    'abha.desc': '\u098f\u0987 \u09b8\u09ac \u09a4\u09a5\u09cd\u09af \u0985\u09ab\u09bf\u09b8\u09bf\u09af\u09bc\u09be\u09b2 ABHA \u09a8\u09bf\u09ac\u09a8\u09cd\u09a7\u09a8 \u09ab\u09b0\u09cd\u09ae\u09c7 \u099a\u09be\u0993\u09af\u09bc\u09be \u09b9\u09df (\u09a8\u09be\u09ae, \u09b2\u09bf\u0982\u0997, \u099c\u09a8\u09cd\u09ae\u09a4\u09be\u09b0\u09bf\u0996, \u09ae\u09cb\u09ac\u09be\u0987\u09b2 \u09a8\u09ae\u09cd\u09ac\u09b0, \u09b8\u09ae\u09cd\u09aa\u09c2\u09b0\u09cd\u09a3 \u09a0\u09bf\u0995\u09be\u09a8\u09be)\u0964 14 \u0985\u0982\u0995\u09c7\u09b0 ABHA ID ABHA \u09ab\u09b0\u09cd\u09ae\u09cd\u09af\u09be\u099f\u09c7 \u09a4\u09c8\u09b0\u09bf \u09b9\u09df\u09c7 \u09b0\u09cb\u0997\u09c0\u09b0 \u09b8\u09be\u09a5\u09c7 \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09bf\u09a4 \u09b9\u09ac\u09c7\u0964 <i>\u09a1\u09c7\u09ae\u09cb \u09a8\u09cb\u099f: \u0986\u0987\u09a1\u09bf\u099f\u09bf \u09b8\u09bf\u09ae\u09c1\u09b2\u09c7\u099f\u09c7\u09a1 \u2014 \u09aa\u09cd\u09b0\u0995\u09c3\u09a4 ABHA (ABDM) \u0985\u09cd\u09af\u09be\u09aa\u09c7\u09b0 \u09b8\u09be\u09a5\u09c7 \u09af\u09c1\u0995\u09cd\u09a4\u09bf \u09aa\u09b0\u09c7 \u09b9\u09ac\u09c7\u0964</i>',
    'lbl.name': '\u09aa\u09c1\u09b0\u09cb \u09a8\u09be\u09ae',
    'lbl.dob': '\u099c\u09a8\u09cd\u09ae\u09a4\u09be\u09b0\u09bf\u0996',
    'lbl.gender': '\u09b2\u09bf\u0982\u0997',
    'lbl.phone': '\u09ae\u09cb\u09ac\u09be\u0987\u09b2 \u09a8\u09ae\u09cd\u09ac\u09b0',
    'lbl.village': '\u0997\u09cd\u09b0\u09be\u09ae / \u098f\u09b2\u09be\u0995\u09be',
    'lbl.district': '\u099c\u09c7\u09b2\u09be',
    'lbl.state': '\u09b0\u09be\u099c\u09cd\u09af',
    'lbl.pincode': '\u09aa\u09bf\u09a8 \u0995\u09cb\u09a1',
    'btn.save': '\u09b0\u09cb\u0997\u09c0 \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09a3 \u0995\u09b0\u09c1\u09a8 (\u09b2\u09cb\u0995\u09be\u09b2)',
    'btn.create': 'ABHA \u09a4\u09c8\u09b0\u09bf \u0995\u09b0\u09c1\u09a8 \u0993 \u09b0\u09cb\u0997\u09c0 \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09a3 \u0995\u09b0\u09c1\u09a8',
    'g.female': '\u09ae\u09b9\u09bf\u09b2\u09be',
    'g.male': '\u09aa\u09c1\u09b0\u09c1\u09b7',
    'g.other': '\u0985\u09a8\u09cd\u09af\u09be\u09a8\u09cd\u09af',
    'no_patient': '\u0995\u09cb\u09a8\u09cb \u09b0\u09cb\u0997\u09c0 \u09aa\u09be\u0993\u09af\u09bc\u09be \u09af\u09be\u09af\u09bc\u09a8\u09bf\u0964',
    'card.unknown': '\u0985\u099c\u09be\u09a8\u09be',
    'unit.yrs': '\u09ac\u099b\u09b0',
    'alert.allergy': '\u26a0 \u0985\u09cd\u09af\u09be\u09b2\u09be\u09b0\u09cd\u099c\u09bf: {0}',
    'qr.title': '\u09a1\u09c7\u09ae\u09cb QR \u09b8\u09cd\u0995\u09cd\u09af\u09be\u09a8\u09be\u09b0 (\u0985\u09b8\u09cd\u09a5\u09be\u09af\u09bc\u09c0)',
    'qr.desc': '\u09aa\u09cd\u09b0\u0995\u09c3\u09a4\u09aa\u0995\u09cd\u09b7\u09c7 \u098f\u099f\u09bf \u09b2\u09be\u09ad\u099c\u09a8\u0995\u09c7\u09b0 \u0995\u09be\u09b0\u09cd\u09a1\u09c7 \u099b\u09be\u09aa\u09be ABHA QR \u0995\u09cb\u09a1 \u09aa\u09a1\u09bc\u09ac\u09c7\u0964 \u09b8\u09cd\u0995\u09cd\u09af\u09be\u09a8 \u0985\u09a8\u09c1\u0995\u09b0\u09a3 \u0995\u09b0\u09a4\u09c7 \u0995\u09be\u09b0\u09cd\u09a1\u09c7 \u099f\u09cd\u09af\u09be\u09aa \u0995\u09b0\u09c1\u09a8:',
    'btn.close': '\u09ac\u09a8\u09cd\u09a7 \u0995\u09b0\u09c1\u09a8',
    'hint.triage': '<b>\u09a1\u09bf\u099c\u09bf\u099f\u09be\u09b2 \u099f\u09cd\u09b0\u09be\u09af\u09be\u099c \u0995\u09cd\u09af\u09be\u09b2\u0995\u09c1\u09b2\u09c7\u099f\u09b0</b> \u0989\u09aa\u09b8\u09b0\u09cd\u0997 \u09ac\u09be\u099b\u09c1\u09a8 \u0993 \u09ad\u09be\u0987\u099f\u09be\u09b2 \u09a6\u09bf\u09a8, \u09a4\u09be\u09b0\u09aa\u09b0 <b>\u09ae\u09c2\u09b2\u09cd\u09af\u09be\u09af\u09bc\u09a8</b> \u099a\u09be\u09aa\u09c1\u09a8\u0964 \u098f\u099f\u09bf \u09a1\u09bf\u09ad\u09be\u0987\u09b8\u09c7\u0987 \u099a\u09be\u09b2\u09c7 \u2014 \u09b8\u09ae\u09cd\u09aa\u09c2\u09b0\u09cd\u09a3 \u0985\u09ab\u09b2\u09be\u0987\u09a8\u09c7 \u0995\u09be\u099c \u0995\u09b0\u09c7\u0964 \u0985\u09a8\u09b2\u09be\u0987\u09a8\u09c7 \u09ab\u09bf\u09b0\u09b2\u09c7 \u09ab\u09b2\u09be\u09ab\u09b2 PHC \u09a1\u09be\u0995\u09cd\u09a4\u09be\u09b0\u09c7\u09b0 \u09b8\u09be\u09b0\u09bf\u09a4\u09c7 \u09b8\u09bf\u0982\u0995 \u09b9\u09df\u0964',
    'patient.title': '\u09b0\u09cb\u0997\u09c0',
    'lbl.abha_opt': 'ABHA ID (\u0990\u099a\u09cd\u099b\u09bf\u0995)',
    'triage.symptoms': '\u0989\u09aa\u09b8\u09b0\u09cd\u0997',
    'triage.vitals': '\u09ad\u09be\u0987\u099f\u09be\u09b2',
    'v.pulse': '\u09a8\u09be\u09a1\u09bc\u09bf (bpm)',
    'v.spo2': 'SpO\u2082 (%)',
    'v.sbp': '\u09b8\u09bf\u09b8\u09cd\u099f\u09cb\u09b2\u09bf\u0995 BP',
    'v.dbp': '\u09a1\u09be\u09af\u09bc\u09be\u09b8\u09cd\u099f\u09cb\u09b2\u09bf\u0995 BP',
    'v.temp': '\u09a4\u09be\u09aa\u09ae\u09be\u09a4\u09cd\u09b0\u09be (\u00b0C)',
    'v.rr': '\u09b6\u09cd\u09ac\u09be\u09b8\u09c7\u09b0 \u09b9\u09be\u09b0 (/min)',
    'btn.assess': '\u09b0\u09cb\u0997\u09c0\u09b0 \u09ae\u09c2\u09b2\u09cd\u09af\u09be\u09af\u09bc\u09a8 \u0995\u09b0\u09c1\u09a8',
    'btn.reset': '🗑 নতুন রোগী — সব মুছুন',
    'btn.reset.done': 'ফর্ম সাফ — পরের রোগীর জন্য প্রস্তুত',
    'ci.title': '🩺 OPD চেক-ইন / টোকেন',
    'ci.hint': 'OPD স্লট বুক করুন এবং GA-… টোকেন নিন। ইন্টারনেট দরকার — টোকেন PHC সার্ভার দেয়।',
    'ci.priority': 'অগ্রাধিকার',
    'ci.btn': '🎫 OPD টোকেন তৈরি করুন',
    'ci.badabha': 'আগে ১৪ সংখ্যার সঠিক ABHA ID দিন।',
    'ci.offline': 'আপনি অফলাইনে — OPD টোকেন PHC সার্ভার দেয়। ট্রায়েজ অফলাইনে সেভ হয়।',
    'ci.thinking': 'OPD স্লট বুক হচ্ছে…',
    'ci.notfound': 'রোগী পাওয়া যায়নি — আগে রোগী সেভ করুন।',
    'ci.nofac': 'চেক-ইনের জন্য কোনো সুবিধা নেই।',
    'ci.failed': 'টোকেন ব্যর্থ: {0}',
    'ci.wait': 'আনুমানিক অপেক্ষা ~{0} মিনিট',
    'sym.chest_pain': '\u09ac\u09c1\u0995\u09c7 \u09ac\u09cd\u09af\u09a5\u09be',
    'sym.difficulty_breathing': '\u09b6\u09cd\u09ac\u09be\u09b8 \u09a8\u09bf\u09a4\u09c7 \u0995\u09b7\u09cd\u099f',
    'sym.unconscious': '\u0985\u099c\u09cd\u099e\u09be\u09a8 / \u09b8\u09be\u09a1\u09bc\u09be \u09a8\u09c7\u0987',
    'sym.severe_bleeding': '\u09a4\u09c0\u09ac\u09cd\u09b0 \u09b0\u0995\u09cd\u09a4\u0995\u09cd\u09b7\u09b0\u09a3',
    'sym.stiff_neck': '\u0998\u09be\u09a1\u09bc \u09b6\u0995\u09cd\u09a4 \u09b9\u09df\u09c7 \u09af\u09be\u0993\u09af\u09bc\u09be',
    'sym.pregnancy_complication': '\u0997\u09b0\u09cd\u09ad\u09be\u09ac\u09b8\u09cd\u09a5\u09be\u09b0 \u099c\u099f\u09bf\u09b2\u09a4\u09be',
    'sym.high_fever': '\u0989\u099a\u09cd\u099a \u099c\u09cd\u09ac\u09b0',
    'sym.continuous_vomiting': '\u098f\u0995\u099f\u09be\u09a8\u09be \u09ac\u09ae\u09bf',
    'sym.severe_headache': '\u09a4\u09c0\u09ac\u09cd\u09b0 \u09ae\u09be\u09a5\u09be\u09ac\u09cd\u09af\u09a5\u09be',
    'sym.dehydration': '\u09b6\u09b0\u09c0\u09b0\u09c7 \u099c\u09b2\u09b6\u09c2\u09a8\u09cd\u09af\u09a4\u09be\u09b0 \u09b2\u0995\u09cd\u09b7\u09a3',
    'sym.severe_abdominal_pain': '\u09a4\u09c0\u09ac\u09cd\u09b0 \u09aa\u09c7\u099f\u09c7 \u09ac\u09cd\u09af\u09a5\u09be',
    'sym.severe_injury': '\u09ae\u09be\u09b0\u09be\u09a4\u09cd\u09ae\u0995 \u0986\u0998\u09be\u09a4 / \u09b9\u09be\u09a1\u09bc \u09ad\u09be\u0999\u09be',
    'sym.abdominal_pain': '\u09aa\u09c7\u099f\u09c7 \u09ac\u09cd\u09af\u09a5\u09be',
    'sym.diarrhea': '\u09a1\u09be\u09af\u09bc\u09b0\u09bf\u09af\u09bc\u09be',
    'sym.cough_cold': '\u0995\u09be\u09b6\u09bf / \u09b8\u09b0\u09cd\u09a6\u09bf',
    'sym.fatigue': '\u0995\u09cd\u09b2\u09be\u09a8\u09cd\u09a4\u09bf / \u09a6\u09c1\u09b0\u09cd\u09ac\u09b2\u09a4\u09be',
    'sym.body_ache': '\u09b6\u09b0\u09c0\u09b0\u09c7 \u09ac\u09cd\u09af\u09a5\u09be',
    'sym.urination_problem': '\u09ac\u09be\u09b0\u09ac\u09be\u09b0 / \u09af\u09a8\u09cd\u09a4\u09cd\u09b0\u09a3\u09be\u09af\u09bc \u09b8\u09ae\u09b8\u09cd\u09af\u09be',
    'sym.sore_throat': '\u0997\u09b2\u09be \u09ac\u09cd\u09af\u09a5\u09be / \u0997\u09b2\u09be\u09af\u09bc \u09ac\u09cd\u09af\u09a5\u09be',
    'sym.joint_pain': '\u0997\u09c1\u09a1\u09bc\u09be\u09b2\u09c7 \u09ac\u09cd\u09af\u09a5\u09be / \u09ab\u09c1\u09b2\u09c7\u0989',
    'sym.back_pain': '\u09aa\u09bf\u09a0\u09c7\u09b0 \u09ac\u09cd\u09af\u09a5\u09be',
    'sym.skin_rash': '\u099a\u09be\u09ae\u09a1\u09bc\u09be\u09af\u09bc \u09b0\u09be\u09b6 / \u099a\u09c1\u09b2\u0995\u09be\u09a8\u09bf',
    'sym.eye_problem': '\u099a\u09cb\u0996 \u09b2\u09be\u09b2 / \u09aa\u09be\u09a8\u09bf / \u09ac\u09cd\u09af\u09a5\u09be',
    'sym.ear_pain': '\u0995\u09be\u09a8 \u09ac\u09cd\u09af\u09a5\u09be / \u09b8\u09cd\u09b0\u09be\u09ac',
    'sym.dizziness': '\u09ae\u09c1\u0996 \u0998\u09c1\u09b0\u09be\u09a8\u09cb / \u099a\u09ae\u0995',
    'sym.acidity': '\u098f\u09b8\u09bf\u09a1\u09bf\u099f\u09bf / \u09ac\u09c2\u0995\u09be / \u0997\u09cd\u09af\u09be\u09b8',
    'sym.constipation': '\u0995\u09cb\u09b7\u09a0\u0995\u09cd\u0995\u09a4\u09be',
    'sym.toothache': '\u09a6\u09be\u0981\u09a4 \u09ac\u09cd\u09af\u09a5\u09be / \u09ae\u09a1\u09bc\u09bf \u09b8\u09ae\u09b8\u09cd\u09af\u09be',
    'sym.numbness': '\u0985\u09ac\u09b6 \u09b9\u09ac\u09be / \u099d\u09bf\u09a8\u099d\u09bf\u09a8\u09bf',
    'sym.swelling': '\u09ab\u09c1\u09b2\u09c7\u0989 (\u09ae\u09c1\u0996 / \u09b9\u09be\u09a4 / \u09aa\u09be)',
    'color.RED': '\u09b2\u09be\u09b2 (RED)',
    'color.YELLOW': '\u09b9\u09b2\u09c1\u09a6 (YELLOW)',
    'color.GREEN': '\u09b8\u09ac\u09c1\u099c (GREEN)',
    'priority': '\u0985\u0997\u09cd\u09b0\u09be\u09a7\u09bf\u0995\u09be\u09b0 {0}',
    'action': '\u0995\u09b0\u09a3\u09c0\u09af\u09bc',
    'reason.symptom': '\u0989\u09aa\u09b8\u09b0\u09cd\u0997: {0}',
    'reason.spo2_critical': 'SpO2 {0}% \u2014 \u09ae\u09be\u09b0\u09be\u09a4\u09cd\u09ae\u0995 \u09b9\u09be\u0987\u09aa\u0995\u09cd\u09b8\u09bf\u09af\u09bc\u09be (< 90%)',
    'reason.pulse_critical': '\u09a8\u09be\u09a1\u09bc\u09bf {0} bpm (40\u2013140-\u098f\u09b0 \u09ac\u09be\u0987\u09b0\u09c7)',
    'reason.sbp_critical': '\u09b8\u09bf\u09b8\u09cd\u099f\u09cb\u09b2\u09bf\u0995 BP {0} mmHg (\u2264 90 \u09ac\u09be \u2265 180)',
    'reason.temp_critical': '\u09a4\u09be\u09aa\u09ae\u09be\u09a4\u09cd\u09b0\u09be {0}\u00b0C (\u0985\u09a4\u09cd\u09af\u09a7\u09bf\u0995 \u099c\u09cd\u09ac\u09b0, \u2265 41)',
    'reason.rr_critical': '\u09b6\u09cd\u09ac\u09be\u09b8\u09c7\u09b0 \u09b9\u09be\u09b0 {0}/min (8\u201330-\u098f\u09b0 \u09ac\u09be\u0987\u09b0\u09c7)',
    'reason.spo2_border': 'SpO2 {0}% (90\u201393%, \u09b8\u09c0\u09ae\u09be\u09a8\u09cd\u09a4\u09ac\u09b0\u09cd\u09a4\u09c0)',
    'reason.pulse_border': '\u09a8\u09be\u09a1\u09bc\u09bf {0} bpm (\u09b8\u09c0\u09ae\u09be\u09a8\u09cd\u09a4\u09ac\u09b0\u09cd\u09a4\u09c0)',
    'reason.sbp_border': '\u09b8\u09bf\u09b8\u09cd\u099f\u09cb\u09b2\u09bf\u0995 BP {0} mmHg (\u09b8\u09c0\u09ae\u09be\u09a8\u09cd\u09a4\u09ac\u09b0\u09cd\u09a4\u09c0)',
    'reason.temp_border': '\u09a4\u09be\u09aa\u09ae\u09be\u09a4\u09cd\u09b0\u09be {0}\u00b0C (\u0989\u099a\u09cd\u099a \u099c\u09cd\u09ac\u09b0, 39\u201341)',
    'reason.multi_moderate': '\u098f\u0995\u09be\u09a7\u09bf\u0995 \u09ae\u09be\u099d\u09be\u09b0\u09bf \u0989\u09aa\u09b8\u09b0\u09cd\u0997: {0}',
    'reason.no_findings': '\u0995\u09cb\u09a8\u09cb RED/YELLOW \u09b2\u0995\u09cd\u09b7\u09a3 \u09a8\u09c7\u0987 \u2014 \u09ad\u09be\u0987\u099f\u09be\u09b2 \u09b8\u09be\u09a7\u09be\u09b0\u09a3 \u09b8\u09c0\u09ae\u09be\u09b0 \u09ae\u09a7\u09cd\u09af\u09c7',
    'rec.red': '\u099c\u09b0\u09c1\u09b0\u09bf: \u098f\u0996\u09a8\u0987 \u09aa\u09b0\u09bf\u09ac\u09b9\u09a8\u09c7\u09b0 \u09ac\u09cd\u09af\u09ac\u09b8\u09cd\u09a5\u09be \u0995\u09b0\u09c1\u09a8 / 108 \u09a8\u09ae\u09cd\u09ac\u09b0\u09c7 \u0995\u09b2 \u0995\u09b0\u09c1\u09a8\u0964 \u09b0\u09cb\u0997\u09c0\u0995\u09c7 \u0985\u09aa\u09cd\u09b0\u09af\u09bc\u09cb\u099c\u09a8\u09c7 \u09a8\u09be\u09a1\u09bc\u09be\u09ac\u09c7\u09a8 \u09a8\u09be\u0964 \u098f\u0996\u09a8\u0987 \u09a8\u09bf\u0995\u099f\u09b8\u09cd\u09a5 \u09b9\u09be\u09b8\u09aa\u09be\u09a4\u09be\u09b2\u0995\u09c7 \u099c\u09be\u09a8\u09be\u09a8\u0964',
    'rec.yellow': '\u099c\u09b0\u09c1\u09b0\u09bf: \u09b0\u09cb\u0997\u09c0\u0995\u09c7 \u0986\u099c\u0987 PHC (\u09aa\u09cd\u09b0\u09be\u09a5\u09ae\u09bf\u0995 \u09b8\u09cd\u09ac\u09be\u09b8\u09cd\u09a5\u09cd\u09af\u0995\u09c7\u09a8\u09cd\u09a6\u09cd\u09b0) \u09aa\u09cc\u0981\u099b\u09be\u09a8\u09cb\u09b0 \u09aa\u09b0\u09be\u09ae\u09b0\u09cd\u09b6 \u09a6\u09bf\u09a8\u0964 \u0989\u09aa\u09b8\u09b0\u09cd\u0997 \u09a5\u09be\u0995\u09b2\u09c7 \u09ac\u09be \u0996\u09be\u09b0\u09be\u09aa \u09b9\u09b2\u09c7 4 \u0998\u09a3\u09cd\u099f\u09be\u09af\u09bc \u0986\u09ac\u09be\u09b0 \u09ae\u09c2\u09b2\u09cd\u09af\u09be\u09af\u09bc\u09a8 \u0995\u09b0\u09c1\u09a8\u0964',
    'rec.green': '\u09b8\u09be\u09a7\u09be\u09b0\u09a3: \u09ac\u09be\u09a1\u09bc\u09bf\u09a4\u09c7 \u09af\u09a4\u09cd\u09a8\u09c7\u09b0 \u09aa\u09b0\u09be\u09ae\u09b0\u09cd\u09b6\u0964 48 \u0998\u09a3\u09cd\u099f\u09be\u09b0 \u09ac\u09c7\u09b6\u09bf \u0989\u09aa\u09b8\u09b0\u09cd\u0997 \u09a5\u09be\u0995\u09b2\u09c7 PHC-\u09a4\u09c7 \u09a8\u09bf\u09af\u09bc\u09ae\u09bf\u09a4 \u09aa\u09b0\u09bf\u09a6\u09b0\u09cd\u09b6\u09a8\u09c7\u09b0 \u09ac\u09cd\u09af\u09ac\u09b8\u09cd\u09a5\u09be \u0995\u09b0\u09c1\u09a8\u0964',
    'hint.sync': '<b>\u09a8\u09c7\u099f\u0993\u09af\u09bc\u09be\u09b0\u09cd\u0995 \u0985\u09ac\u09b8\u09cd\u09a5\u09be\u09b0 \u0985\u09a8\u09c1\u0995\u09b0\u09a3 \u0995\u09b0\u09c1\u09a8</b> \u09b8\u09ae\u09cd\u09aa\u09c2\u09b0\u09cd\u09a3 \u0985\u09ab\u09b2\u09be\u0987\u09a8 \u2192 \u0985\u09a8\u09b2\u09be\u0987\u09a8 \u09aa\u09c1\u09a8\u09b0\u09c1\u09a6\u09cd\u09a7\u09be\u09b0 \u09a6\u09c7\u0996\u09be\u09a4\u09c7 \u09b8\u09c1\u0987\u099a \u099f\u09cb\u0997\u09b2 \u0995\u09b0\u09c1\u09a8: <b>\u0985\u09ab\u09b2\u09be\u0987\u09a8</b> \u0985\u09ac\u09b8\u09cd\u09a5\u09be\u09af\u09bc \u09aa\u09cd\u09b0\u09a4\u09bf\u099f\u09bf \u09b0\u09c7\u0995\u09b0\u09cd\u09a1 \u098f\u0987 \u09a1\u09bf\u09ad\u09be\u0987\u09b8\u09c7 \u09b8\u09be\u09b0\u09bf\u09ac\u09a6\u09cd\u09a7 \u09b9\u09df\u0964 \u0986\u09ac\u09be\u09b0 <b>\u0985\u09a8\u09b2\u09be\u0987\u09a8</b> \u0995\u09b0\u09b2\u09c7 \u09b0\u09cb\u0997\u09c0\u09b0 \u09b0\u09c7\u0995\u09b0\u09cd\u09a1 \u09ac\u09cd\u09af\u09be\u0995\u09c7\u09a8\u09cd\u09a1\u09c7 \u09af\u09be\u09af\u09bc <i>\u098f\u09ac\u0982</i> \u09b8\u09be\u09b0\u09cd\u09ac\u09be\u09b0\u09c7\u09b0 \u09b8\u09be\u09b0\u09bf\u09ac\u09a6\u09cd\u09a7 SMS \u098f\u0995 \u09b8\u09c1\u09a4\u09cd\u09b0\u09c7 \u09aa\u09be\u09a0\u09be\u09a8\u09cb \u09b9\u09df\u0964',
    'net.online_label': '\u09a8\u09c7\u099f\u0993\u09af\u09bc\u09be\u09b0\u09cd\u0995: \u0985\u09a8\u09b2\u09be\u0987\u09a8',
    'net.offline_label': '\u09a8\u09c7\u099f\u0993\u09af\u09bc\u09be\u09b0\u09cd\u0995: \u0985\u09ab\u09b2\u09be\u0987\u09a8',
    'net.sub.online': '\u09b0\u09c7\u0995\u09b0\u09cd\u09a1 \u09b8\u0999\u09cd\u0997\u09c7 \u09b8\u0999\u09cd\u0997\u09c7 \u09b8\u09bf\u0982\u0995 \u09b9\u09df',
    'net.sub.offline': '\u0985\u09a8\u09b2\u09be\u0987\u09a8 \u0995\u09b0\u09be \u09aa\u09b0\u09cd\u09af\u09a8\u09cd\u09a4 \u09b0\u09c7\u0995\u09b0\u09cd\u09a1 \u09b2\u09cb\u0995\u09be\u09b2\u09bf \u09b8\u09be\u09b0\u09bf\u09ac\u09a6\u09cd\u09a7 \u09a5\u09be\u0995\u09ac\u09c7',
    'sync.pending': '\u0985\u09aa\u09c7\u0995\u09cd\u09b7\u09ae\u09be\u09a3 \u09b2\u09cb\u0995\u09be\u09b2 \u09b0\u09c7\u0995\u09b0\u09cd\u09a1',
    'sync.msgqueue': '\u09b8\u09be\u09b0\u09cd\u09ac\u09be\u09b0 \u09ac\u09be\u09b0\u09cd\u09a4\u09be \u09b8\u09be\u09b0\u09bf',
    'sync.last': '\u09b6\u09c7\u09b7 \u09b8\u09bf\u0982\u0995',
    'sync.never': '\u0995\u0996\u09a8\u09cb \u09a8\u09df',
    'th.type': '\u09a7\u09b0\u09a8',
    'th.created': '\u09a4\u09c8\u09b0\u09bf \u09b9\u09df\u09c7\u099b\u09c7',
    'th.status': '\u0985\u09ac\u09b8\u09cd\u09a5\u09be',
    'btn.sync_now': '\u098f\u0996\u09a8\u0987 \u09b8\u09bf\u0982\u0995 \u0995\u09b0\u09c1\u09a8 \u2192',
    'summary.empty': '\u0985\u09b8\u09bf\u0982\u0995 \u09b0\u09c7\u0995\u09b0\u09cd\u09a1 \u09a8\u09c7\u0987 \u2014 \u09b8\u09ac \u09b9\u09be\u09b2\u09a8\u09be\u0997\u09a6 \u0986\u099b\u09c7\u0964',
    'summary.pending': '{0} \u099f\u09bf \u09b0\u09c7\u0995\u09b0\u09cd\u09a1 \u09b8\u09bf\u0982\u0995\u09c7\u09b0 \u0985\u09aa\u09c7\u0995\u09cd\u09b7\u09be\u09af\u09bc: {1}',
    'type.patient': '\u09b0\u09cb\u0997\u09c0',
    'type.encounter': '\u09aa\u09b0\u09bf\u09a6\u09b0\u09cd\u09b6\u09a8',
    'type.triage': '\u09ae\u09c2\u09b2\u09cd\u09af\u09be\u09af\u09bc\u09a8',
    'status.queued': '\u09b8\u09be\u09b0\u09bf\u09ac\u09a6\u09cd\u09a7',
    'msg.queued': '\u09b8\u09be\u09b0\u09bf\u09ac\u09a6\u09cd\u09a7 SMS: {0} \u099f\u09bf \u09aa\u09be\u09a0\u09be\u09a8\u09cb\u09b0 \u0985\u09aa\u09c7\u0995\u09cd\u09b7\u09be\u09af\u09bc',
    'msg.queued_offline': '\u09b8\u09be\u09b0\u09bf\u09ac\u09a6\u09cd\u09a7 SMS: \u2014 (\u0985\u09ab\u09b2\u09be\u0987\u09a8; \u0985\u09a8\u09b2\u09be\u0987\u09a8\u09c7 \u09ab\u09bf\u09b0\u09b2\u09c7 \u09a6\u09c7\u0996\u09c1\u09a8)',
    't.valid_abha': '\u09b8\u09a0\u09bf\u0995 14 \u0985\u0982\u0995\u09c7\u09b0 ABHA ID \u09a6\u09bf\u09a8',
    't.not_found': '\u09b0\u09cb\u0997\u09c0 \u09aa\u09be\u0993\u09af\u09bc\u09be \u09af\u09be\u09af\u09bc\u09a8\u09bf',
    't.not_found_offline': '\u09b0\u09cb\u0997\u09c0 \u09aa\u09be\u0993\u09af\u09bc\u09be \u09af\u09be\u09af\u09bc\u09a8\u09bf (\u0985\u09ab\u09b2\u09be\u0987\u09a8 \u0995\u09cd\u09af\u09be\u09b6\u09c7 \u09a8\u09c7\u0987)',
    't.loaded_server': '\u09b0\u09cb\u0997\u09c0 \u09b8\u09be\u09b0\u09cd\u09ac\u09be\u09b0 \u09a5\u09c7\u0995\u09c7 \u09aa\u09be\u0993\u09af\u09bc\u09be \u0997\u09c7\u099b\u09c7',
    't.loaded_cache': '\u09b0\u09cb\u0997\u09c0 \u09b2\u09cb\u0995\u09be\u09b2 \u0995\u09cd\u09af\u09be\u09b6\u09c7 \u09a5\u09c7\u0995\u09c7 \u09aa\u09be\u0993\u09af\u09bc\u09be \u0997\u09c7\u099b\u09c7',
    't.qr_scanned': 'QR \u09b8\u09cd\u0995\u09cd\u09af\u09be\u09a8 \u09b9\u09df\u09c7\u099b\u09c7: {0}',
    't.fill_required': '\u0985\u09a8\u09c1\u0997\u09cd\u09b0\u09b9 \u0995\u09b0\u09c7 \u09aa\u09cd\u09b0\u09af\u09bc\u09cb\u099c\u09a8\u09c0\u09af\u09bc \u09a4\u09a5\u09cd\u09af \u09aa\u09c2\u09b0\u09a3 \u0995\u09b0\u09c1\u09a8: {0}',
    't.phone_invalid': '\u09b8\u09a0\u09bf\u0995 10 \u0985\u0982\u0995\u09c7\u09b0 \u09ae\u09cb\u09ac\u09be\u0987\u09b2 \u09a8\u09ae\u09cd\u09ac\u09b0 \u09a6\u09bf\u09a8',
    't.pincode_invalid': '\u09b8\u09a0\u09bf\u0995 6 \u0985\u0982\u0995\u09c7\u09b0 \u09aa\u09bf\u09a8 \u0995\u09cb\u09a1 \u09a6\u09bf\u09a8',
    't.saved_synced': '\u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09bf\u09a4 + \u09b8\u09bf\u0982\u0995 \u09b9\u09df\u09c7\u099b\u09c7 ({0} \u099f\u09bf \u09a4\u09c8\u09b0\u09bf)',
    't.saved_offline': '\u09b2\u09cb\u0995\u09be\u09b2\u09bf \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09bf\u09a4 \u2014 \u0985\u09a8\u09b2\u09be\u0987\u09a8\u09c7 \u09ab\u09bf\u09b0\u09b2\u09c7 \u09b8\u09bf\u0982\u0995 \u09b9\u09ac\u09c7',
    't.sync_failed': '\u09b2\u09cb\u0995\u09be\u09b2\u09bf \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09bf\u09a4; \u09b8\u09bf\u0982\u0995 \u09ac\u09cd\u09af\u09b0\u09cd\u09a5: {0}',
    't.abha_created': '\u09b8\u09bf\u09ae\u09c1\u09b2\u09c7\u099f\u09c7\u09a1 ABHA ID \u09a4\u09c8\u09b0\u09bf \u09b9\u09df\u09c7\u099b\u09c7: {0}',
    't.dup_local': '\u098f\u0987 ABHA ID-\u09b0 \u09b0\u09cb\u0997\u09c0 \u0986\u0997\u09c7 \u09a5\u09c7\u0995\u09c7\u0987 \u098f\u0987 \u09a1\u09bf\u09ad\u09be\u0987\u09b8\u09c7 \u0986\u099b\u09c7',
    't.triage_saved': '\u09ae\u09c2\u09b2\u09cd\u09af\u09be\u09af\u09bc\u09a8 \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09bf\u09a4 + \u09b8\u09bf\u0982\u0995 \u09b9\u09df\u09c7\u099b\u09c7 ({0} \u099f\u09bf \u09b0\u09c7\u0995\u09b0\u09cd\u09a1 \u09a4\u09c8\u09b0\u09bf)',
    't.triage_offline': '\u09ae\u09c2\u09b2\u09cd\u09af\u09be\u09af\u09bc\u09a8 \u0985\u09ab\u09b2\u09be\u0987\u09a8\u09c7 \u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09bf\u09a4 \u2014 \u09a1\u09be\u0995\u09cd\u09a4\u09be\u09b0\u09c7\u09b0 \u09b8\u09be\u09b0\u09bf\u09a4\u09c7 \u09b8\u09bf\u0982\u0995 \u0995\u09b0\u09a4\u09c7 \u0985\u09a8\u09b2\u09be\u0987\u09a8 \u0995\u09b0\u09c1\u09a8',
    't.net_online': '\u09a8\u09c7\u099f\u0993\u09af\u09bc\u09be\u09b0\u09cd\u0995 \u0985\u09a8\u09b2\u09be\u0987\u09a8 \u2014 \u0985\u09aa\u09c7\u0995\u09cd\u09b7\u09ae\u09be\u09a3 \u09b0\u09c7\u0995\u09b0\u09cd\u09a1 + SMS \u09b8\u09be\u09b0\u09bf \u09aa\u09be\u09a0\u09be\u09a8\u09cb \u09b9\u099a\u09cd\u099b\u09c7\u2026',
    't.net_offline': '\u09a8\u09c7\u099f\u0993\u09af\u09bc\u09be\u09b0\u09cd\u0995 \u0985\u09ab\u09b2\u09be\u0987\u09a8 \u2014 \u09a8\u09a4\u09c1\u09a8 \u09b0\u09c7\u0995\u09b0\u09cd\u09a1 \u098f\u0987 \u09a1\u09bf\u09ad\u09be\u0987\u09b8\u09c7 \u09b8\u09be\u09b0\u09bf\u09ac\u09a6\u09cd\u09a7 \u09b9\u09ac\u09c7',
    't.toggle_first': '\u0986\u0997\u09c7 \u09a8\u09c7\u099f\u0993\u09af\u09bc\u09be\u09b0\u09cd\u0995 \u0985\u09a8\u09b2\u09be\u0987\u09a8 \u0995\u09b0\u09c1\u09a8',
    't.sync_done': '\u09b8\u09bf\u0982\u0995 \u09b8\u09ae\u09cd\u09aa\u09c2\u09b0\u09cd\u09a3: {0} \u099f\u09bf \u09a4\u09c8\u09b0\u09bf, {1} \u099f\u09bf \u0986\u09aa\u09a1\u09c7\u099f \u00b7 {2} \u099f\u09bf SMS \u09aa\u09be\u09a0\u09be\u09a8\u09cb \u09b9\u09df\u09c7\u099b\u09c7',
    't.sync_fail': '\u09b8\u09bf\u0982\u0995 \u09ac\u09cd\u09af\u09b0\u09cd\u09a5: {0}',
    't.bg_sync_done': '\u09ac\u09cd\u09af\u09be\u0995\u0997\u09cd\u09b0\u09be\u0989\u09a8\u09cd\u09a1 \u09b8\u09bf\u0982\u0995: {0} \u099f\u09bf \u09a4\u09c8\u09b0\u09bf',
    'abha.step1.title': 'আধার দিয়ে ABHA ID তৈরি করুন',
    'abha.step1.desc': 'লাভজনকের নাম ও আধার নম্বর ABDM দিয়ে যাচাই করা হয় (প্রকৃতিতে আধার OTP-র মাধ্যমে)। <i>ডেমো নোট: সিমুলেটেড — আধার নম্বর কোথাও সংরক্ষিত বা পাঠানো হয় না।</i>',
    'abha.aadhaar_name': 'পুরো নাম (আধার অনুযায়ী)',
    'abha.aadhaar': 'আধার নম্বর (১২ সংখ্যা)',
    'abha.create_btn': 'ABHA ID তৈরি করুন',
    'abha.created_title': '✅ ABHA ID তৈরি হয়েছে',
    'abha.created_next': 'এখন নিচের লাভজনকের বিবরণ সম্পূর্ণ করে রোগী সংরক্ষণ করুন।',
    'abha.aadhaar_invalid': 'অনুগ্রহ করে ১২ সংখ্যার সঠিক আধার নম্বর দিন',
    'abha.create_first': 'আগে ABHA ID তৈরি করুন',
    'card.health': 'স্বাস্থ্য বিবরণ',
    'card.hr': 'উচ্চ ঝুঁকি',
    'card.chronic': 'দীর্ঘমেয়াদি রোগ',
    'card.latest': 'সাম্প্রতিক ট্রায়াজ',
    'card.referral': 'রেফারেল',
    'card.followup': 'পরবর্তী ফলো-আপ',
    'card.none': 'এখনও কোনো স্বাস্থ্য রেকর্ড নেই — ট্রায়াজ করুন বা ভিজিট নোট যোগ করুন',
  },
};

function currentLang() {
  const saved = localStorage.getItem(LANG_KEY);
  return LANGS.indexOf(saved) !== -1 ? saved : 'en';
}

function setLang(lang) {
  localStorage.setItem(LANG_KEY, lang);
}

function t(key, vars) {
  const lang = currentLang();
  const dict = I18N[lang] || I18N.en;
  let s;
  if (dict[key] !== undefined) s = dict[key];
  else if (I18N.en[key] !== undefined) s = I18N.en[key];
  else if (typeof AI_I18N !== 'undefined' && AI_I18N[lang] && AI_I18N[lang][key] !== undefined) s = AI_I18N[lang][key];
  else if (typeof AI_I18N !== 'undefined' && AI_I18N.en && AI_I18N.en[key] !== undefined) s = AI_I18N.en[key];
  else s = key;
  if (vars !== undefined) {
    s = s.replace(/\{(\d+)\}/g, (m, i) => (vars[i] !== undefined ? String(vars[i]) : m));
  }
  return s;
}

function applyStaticI18n() {
  const lang = currentLang();
  document.documentElement.lang = lang;
  const sel = document.getElementById('lang-select');
  if (sel) sel.value = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}

function symptomLabel(key) {
  return t('sym.' + key);
}

function genderLabel(value) {
  if (value && I18N.en['g.' + value]) return t('g.' + value);
  return value || '\u2014';
}

/* ------------------------------------------------------------------ */
/* Network simulation                                                    */
/* ------------------------------------------------------------------ */
function isOnline() {
  return localStorage.getItem('gramarogya_online') !== 'offline';
}

function setNetworkState(state) {
  localStorage.setItem('gramarogya_online', state);
}

/* ------------------------------------------------------------------ */
/* Utilities                                                            */
/* ------------------------------------------------------------------ */
function newClientId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function utcNowIso() {
  return new Date().toISOString();
}

function toast(message, kind = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast show ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 4000);
}

/* Resolve `promise` unless it takes longer than `ms`, then reject so the UI
 * never hangs silently (used for the online AI chat). */
function withTimeout(ms, promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

async function apiFetch(path, options = {}) {
  if (!isOnline()) {
    const err = new Error('OFFLINE \u2014 request not sent, record queued locally');
    err.offline = true;
    throw err;
  }
  const headers = {
    'Content-Type': 'application/json',
    'X-GramArogya-Role': 'asha',  // demo RBAC: ASHA-originated API writes
    ...(options.headers || {}),
  };
  const res = await fetch(API_BASE + path, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch (e) { /* keep statusText */ }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.json();
}

/* ------------------------------------------------------------------ */
/* Local triage engine (mirror of backend/app/services/triage.py)      */
/* ------------------------------------------------------------------ */
const RED_SYMPTOMS = ['chest_pain', 'difficulty_breathing', 'unconscious', 'severe_bleeding', 'stiff_neck', 'pregnancy_complication'];
const YELLOW_SYMPTOMS = ['high_fever', 'continuous_vomiting', 'severe_headache', 'dehydration', 'severe_abdominal_pain', 'severe_injury'];
const MODERATE_SYMPTOMS = ['abdominal_pain', 'diarrhea', 'cough_cold', 'fatigue', 'body_ache'];
// Common outpatient problems added for wider coverage (voice fill)
const COMMON_SYMPTOMS = ['urination_problem', 'sore_throat', 'joint_pain', 'back_pain', 'skin_rash', 'eye_problem', 'ear_pain', 'dizziness', 'acidity', 'constipation', 'toothache', 'numbness', 'swelling'];
const SYMPTOM_ORDER = RED_SYMPTOMS.concat(YELLOW_SYMPTOMS, MODERATE_SYMPTOMS, COMMON_SYMPTOMS);

function num(vitals, key) {
  const v = vitals[key];
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function localTriage(symptoms, vitals) {
  const reasons = [];
  let red = false;

  for (const sym of RED_SYMPTOMS) {
    if (symptoms[sym]) { red = true; reasons.push(t('reason.symptom', [symptomLabel(sym)])); }
  }
  const spo2 = num(vitals, 'spo2');
  const pulse = num(vitals, 'pulse');
  const sbp = num(vitals, 'systolic_bp');
  const temp = num(vitals, 'temperature');
  const rr = num(vitals, 'respiratory_rate');

  if (spo2 !== null && spo2 < 90) { red = true; reasons.push(t('reason.spo2_critical', [spo2])); }
  if (pulse !== null && (pulse <= 40 || pulse >= 140)) { red = true; reasons.push(t('reason.pulse_critical', [pulse])); }
  if (sbp !== null && (sbp <= 90 || sbp >= 180)) { red = true; reasons.push(t('reason.sbp_critical', [sbp])); }
  if (temp !== null && temp >= 41.0) { red = true; reasons.push(t('reason.temp_critical', [temp])); }
  if (rr !== null && (rr < 8 || rr > 30)) { red = true; reasons.push(t('reason.rr_critical', [rr])); }

  if (red) {
    return { color: 'RED', score: 100, reasons, recommendation: t('rec.red') };
  }

  let yellow = false;
  for (const sym of YELLOW_SYMPTOMS) {
    if (symptoms[sym]) { yellow = true; reasons.push(t('reason.symptom', [symptomLabel(sym)])); }
  }
  if (spo2 !== null && spo2 >= 90 && spo2 <= 93) { yellow = true; reasons.push(t('reason.spo2_border', [spo2])); }
  if (pulse !== null && ((pulse >= 120 && pulse <= 139) || (pulse >= 41 && pulse <= 49))) { yellow = true; reasons.push(t('reason.pulse_border', [pulse])); }
  if (sbp !== null && ((sbp >= 91 && sbp <= 99) || (sbp >= 160 && sbp <= 179))) { yellow = true; reasons.push(t('reason.sbp_border', [sbp])); }
  if (temp !== null && temp >= 39.0 && temp < 41.0) { yellow = true; reasons.push(t('reason.temp_border', [temp])); }

  const moderate = MODERATE_SYMPTOMS.filter((s) => symptoms[s]);
  if (moderate.length >= 2) {
    yellow = true;
    reasons.push(t('reason.multi_moderate', [moderate.map((s) => symptomLabel(s)).join(', ')]));
  }

  if (yellow) {
    return { color: 'YELLOW', score: 50, reasons, recommendation: t('rec.yellow') };
  }

  if (!reasons.length) reasons.push(t('reason.no_findings'));
  return { color: 'GREEN', score: 10, reasons, recommendation: t('rec.green') };
}

/* ------------------------------------------------------------------ */
/* Sync flow                                                            */
/* ------------------------------------------------------------------ */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* Upload the pending queue in batches of 10. Successful records are removed;
 * failed/skipped ones stay queued flagged `sync_failed` so the Sync page can
 * offer Retry / Delete. `opts.onProgress(done, total)` drives the progress bar.
 */
async function flushPending(opts = {}) {
  const pending = await db.getPending();
  if (!pending.length) return { synced: 0, results: [] };

  const deviceSetting = await db.getSetting('device_id');
  const deviceId = (deviceSetting && deviceSetting.value) || 'asha-demo-device';
  const batches = chunk(pending, 10);
  const results = [];
  let synced = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    let res;
    try {
      res = await apiFetch('/sync', {
        method: 'POST',
        body: JSON.stringify({ records: batch, device_id: deviceId }),
      });
    } catch (e) {
      // Network/server error: flag the whole batch, keep for retry
      for (const rec of batch) {
        await db.savePending(Object.assign({}, rec, { sync_failed: true, error: e.message }));
      }
      if (opts.onProgress) opts.onProgress(i + 1, batches.length);
      throw e;
    }
    results.push(...(res.results || []));
    for (const rec of batch) {
      const r = (res.results || []).find((x) => x.client_id === rec.client_id);
      if (r && r.status !== 'skipped') {
        await db.removePending(rec.client_id);
        synced++;
      } else if (r) {
        // skipped (e.g. unresolvable patient) — flag so the worker can act
        await db.savePending(Object.assign({}, rec, { sync_failed: true, error: r.detail }));
      }
    }
    if (opts.onProgress) opts.onProgress(i + 1, batches.length);
  }

  await db.setSetting('last_sync_at', new Date().toISOString());
  return { synced: synced, results: results, counts: { created: synced } };
}

async function dispatchMessages() {
  if (!isOnline()) return null;
  return apiFetch('/messages/dispatch', { method: 'POST' });
}

async function fullSync(onProgress) {
  const syncRes = await flushPending({ onProgress: onProgress });
  const msgRes = await dispatchMessages();
  return { syncRes, msgRes };
}

/* ------------------------------------------------------------------ */
/* Shared UI helpers                                                    */
/* ------------------------------------------------------------------ */
function renderPatientCard(patient, containerId) {
  const box = document.getElementById(containerId);
  if (!box) return;
  lastShownPatient = patient || null;
  if (!patient) {
    box.innerHTML = '<p class="muted">' + t('no_patient') + '</p>';
    return;
  }
  const age = patient.dob
    ? (() => { const d = new Date(patient.dob); const now = new Date(); return now.getFullYear() - d.getFullYear() - ((now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) ? 1 : 0); })()
    : '?';
  const gender = genderLabel(patient.gender);
  const loc = [patient.village, patient.district, patient.state].filter(Boolean).join(', ') +
    (patient.pincode ? ' \u2013 ' + patient.pincode : '');
  box.innerHTML =
    '<div class="patient-card">' +
    '<div class="patient-main">' +
    '<strong>' + (patient.name || t('card.unknown')) + '</strong>' +
    '<span class="muted">' + age + ' ' + t('unit.yrs') + ' \u00b7 ' + gender + (patient.blood_group ? ' \u00b7 ' + patient.blood_group : '') + '</span>' +
    '</div>' +
    '<div class="patient-meta">' +
    '<span>ABHA: <b>' + (patient.abha_id || '').replace(/(\d{2})(\d{4})(\d{4})(\d{4})/, '$1-$2-$3-$4') + '</b></span>' +
    (loc ? '<span>\ud83d\udccd ' + loc + '</span>' : '') +
    (patient.allergies && patient.allergies.length ? '<span class="alert-text">' + t('alert.allergy', [patient.allergies.join(', ')]) + '</span>' : '') +
    '</div>' +
    '</div>' +
    (PAGE === 'index'
      ? '<button id="tele-btn" class="secondary" style="width:100%;margin-top:10px">📞 ' + t('btn.tele') + '</button>' +
        '<div id="tele-status" class="tele-status"></div>'
      : '');
  refreshTeleconsultStatus();
}

async function searchPatient(abhaId) {
  if (isOnline()) {
    try {
      const rows = await apiFetch('/patients?abha_id=' + encodeURIComponent(abhaId));
      if (rows.length) {
        await db.savePatient(rows[0]);
        return rows[0];
      }
    } catch (e) {
      if (!e.offline) console.warn('Server search failed', e);
    }
  }
  return db.getPatient(abhaId);
}

/* ------------------------------------------------------------------ */
/* Service worker + background sync registration                       */
/* ------------------------------------------------------------------ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { scope: '/asha/' })
      .then((reg) => {
        console.log('Service worker registered:', reg.scope);
        if ('sync' in reg) {
          navigator.serviceWorker.ready.then((r) => {
            r.sync.register('gramarogya-sync').catch(() => {});
          }).catch(() => {});
        }
      })
      .catch((err) => console.warn('Service worker registration failed', err));
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'run-sync') {
      fullSync().then((r) => {
        if (PAGE === 'sync') renderSyncPage();
        const n = r.syncRes && r.syncRes.results ? r.syncRes.results.filter((x) => x.status === 'created').length : 0;
        toast(t('t.bg_sync_done', [n]), 'ok');
      }).catch(() => {});
    }
  });
}

function updateNetPill() {
  const pill = document.getElementById('net-pill');
  if (pill) {
    pill.textContent = isOnline() ? t('pill.online') : t('pill.offline');
    pill.classList.toggle('offline', !isOnline());
  }
}

/* ------------------------------------------------------------------ */
/* Index page: ABHA search + QR placeholder + ABHA-first registration  */
/* ------------------------------------------------------------------ */
function regMode() {
  const checked = document.querySelector('input[name="abha-exists"]:checked');
  return checked && checked.value === 'no' ? 'no' : 'yes';
}

/* ABHA ID minted in the Aadhaar step when the beneficiary has no ID yet */
let createdAbha = '';

function updateRegModeUI() {
  const createMode = regMode() === 'no';
  const existingBox = document.getElementById('abha-existing-box');
  const createFlow = document.getElementById('abha-create-flow');
  const createStep = document.getElementById('abha-create-step');
  const createdBox = document.getElementById('abha-created-box');
  const details = document.getElementById('reg-details');
  const btn = document.getElementById('register-btn');
  if (existingBox) existingBox.hidden = createMode;
  if (createFlow) createFlow.hidden = !createMode;
  if (createStep) createStep.hidden = createMode ? !!createdAbha : true;
  if (createdBox) createdBox.hidden = !createMode || !createdAbha;
  if (details) details.hidden = createMode && !createdAbha;
  if (btn) btn.textContent = t('btn.save');
  document.querySelectorAll('.seg-btn').forEach((lb) => {
    const rb = lb.querySelector('input');
    if (rb) lb.classList.toggle('active', rb.checked);
  });
}

/* Step 1 of the no-ABHA flow: take name + Aadhaar, mint the ABHA ID
 * (simulated). Mirrors real ABDM enrolment, where the ABHA is created from
 * the Aadhaar identity — only a format check happens on the number here. */
async function createAbhaFromAadhaar() {
  const nameEl = document.getElementById('np-aadhaar-name');
  const adEl = document.getElementById('np-aadhaar');
  const name = (nameEl.value || '').trim();
  const aadhaar = (adEl.value || '').replace(/\s+/g, '');
  if (!name) { toast(t('t.fill_required', [t('abha.aadhaar_name')]), 'warn'); return; }
  if (!/^\d{12}$/.test(aadhaar)) { toast(t('abha.aadhaar_invalid'), 'warn'); return; }

  createdAbha = await generateFakeAbhaId();
  const disp = document.getElementById('abha-created-id');
  if (disp) {
    disp.textContent = createdAbha.replace(/(\d{2})(\d{4})(\d{4})(\d{4})/, '$1-$2-$3-$4');
  }
  // The name comes from the Aadhaar step — prefill so it isn't asked twice
  const npName = document.getElementById('np-name');
  if (npName && !npName.value.trim()) npName.value = name;
  adEl.value = '';  // never retain the Aadhaar number
  updateRegModeUI();
  toast(t('t.abha_created', [disp ? disp.textContent : createdAbha]), 'ok');
}

async function generateFakeAbhaId() {
  // SIMULATED ABHA: 14 digits in real-ABHA format (starts with 91). Real ABHA
  // numbers are minted by ABDM after enrolment verification — this placeholder
  // will be replaced by the ABHA API integration later.
  const local = await db.getAllPatients();
  const used = new Set((local || []).map((p) => p.abha_id));
  for (let i = 0; i < 30; i++) {
    const digits = String(Math.floor(Math.random() * 1e12)).padStart(12, '0');
    const id = '91' + digits;
    if (!used.has(id)) return id;
  }
  return '91' + Date.now().toString().slice(-12);
}

/* Doctor teleconsult request (Feature 5) — works offline; syncs into the
 * doctor's teleconsult queue when connectivity returns. */
function openTeleModal() {
  const p = lastShownPatient;
  if (!p) { toast(t('tele.no_patient'), 'warn'); return; }
  const who = document.getElementById('tele-patient');
  if (who) who.textContent = t('tele.patient', [p.name || t('card.unknown')]);
  const modal = document.getElementById('tele-modal');
  if (modal) modal.classList.add('open');
}

function closeTeleModal() {
  const modal = document.getElementById('tele-modal');
  if (modal) modal.classList.remove('open');
}

async function requestTeleconsult() {
  const p = lastShownPatient;
  if (!p) { toast(t('tele.no_patient'), 'warn'); return; }
  const mode = document.getElementById('tele-mode').value;
  const reason = (document.getElementById('tele-reason').value || '').trim();
  const now = utcNowIso();
  const clientId = newClientId();
  await db.enqueue({
    type: 'teleconsult',
    client_id: clientId,
    updated_at: now,
    data: {
      abha_id: p.abha_id,
      patient_id: p.id,
      mode: mode,
      reason: reason || null,
      requested_by: 'ASHA Worker',
      requested_at: now,
    },
  });
  closeTeleModal();
  document.getElementById('tele-reason').value = '';
  if (isOnline()) {
    try {
      const res = await flushPending();
      const r = (res.results || []).find((x) => x.client_id === clientId);
      toast(r && r.status === 'created' ? t('tele.sent') : t('tele.queued'),
            r && r.status === 'created' ? 'ok' : 'warn');
    } catch (e) {
      toast(t('tele.queued'), 'warn');
    }
  } else {
    toast(t('tele.queued'), 'warn');
  }
  refreshTeleconsultStatus();
}

/* ---- Teleconsult status for the shown patient ---------------------------
 * Polls the server so the ASHA worker sees the doctor accept / start the
 * call and gets the join link — same room the doctor portal embeds. */
let TELECONFIG = { provider: 'jitsi', daily_domain: '', simulated: false };
let lastTeleSeen = { abha: null, key: null };  // one-time notification per patient

async function initTeleconfig() {
  try { TELECONFIG = await apiFetch('/teleconsult/config'); } catch (e) { /* keep default */ }
}

function buildJoinUrl(req) {
  if (req.join_url) return req.join_url;
  const room = 'gramarogya-' + req.id;
  if (TELECONFIG.provider === 'daily' && TELECONFIG.daily_domain) {
    return 'https://' + TELECONFIG.daily_domain + '/' + room;
  }
  return 'https://meet.jit.si/GramArogya-' + req.id;
}

async function refreshTeleconsultStatus() {
  const el = document.getElementById('tele-status');
  const p = lastShownPatient;
  if (!el || !p) return;
  if (!p.abha_id) { el.innerHTML = ''; return; }

  // Offline: reflect what is still queued on this device
  if (!isOnline()) {
    const pending = (await db.getPending()) || [];
    const queued = pending.filter((r) => r.type === 'teleconsult' &&
      r.data && r.data.abha_id === p.abha_id);
    el.innerHTML = queued.length
      ? '<span class="tele-status-chip warn">' + t('tele.queued') + '</span>'
      : '';
    return;
  }

  let reqs = [];
  try { reqs = await apiFetch('/teleconsult'); } catch (e) { return; }
  const mine = (reqs || [])
    .filter((r) => r.abha_id === p.abha_id)
    .sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
  const r = mine[0];
  if (!r) { el.innerHTML = ''; return; }

  // One-time notification when the shown patient's request changes state
  const key = r.status + ':' + (r.started_at ? '1' : '0');
  const samePatient = lastTeleSeen.abha === p.abha_id;
  const changed = samePatient && lastTeleSeen.key !== null && lastTeleSeen.key !== key;
  lastTeleSeen = { abha: p.abha_id, key: key };
  if (changed) {
    if (r.status === 'accepted' && r.started_at) toast(t('tele.notify.live'), 'ok');
    else if (r.status === 'accepted') toast(t('tele.notify.accepted', [r.doctor_name || t('tele.doctor')]), 'ok');
    else if (r.status === 'declined') toast(t('tele.notify.declined'), 'warn');
  }

  if (r.status === 'requested') {
    el.innerHTML = '<span class="tele-status-chip warn">⏳ ' + t('tele.status.requested') + '</span>';
  } else if (r.status === 'declined') {
    el.innerHTML = '<span class="tele-status-chip error">✕ ' + t('tele.status.declined') + '</span>';
  } else if (r.status === 'completed') {
    el.innerHTML = '<span class="tele-status-chip ok">✓ ' + t('tele.status.completed') + '</span>';
  } else if (r.status === 'accepted') {
    if (r.started_at) {
      el.innerHTML =
        '<span class="tele-status-chip live">📞 ' + t('tele.status.live') + '</span> ' +
        '<a class="tele-join-btn" href="' + esc(buildJoinUrl(r)) + '" target="_blank" rel="noopener">' +
        t('tele.join') + '</a>';
    } else {
      el.innerHTML = '<span class="tele-status-chip ok">👨‍⚕️ ' +
        t('tele.status.accepted', [r.doctor_name || t('tele.doctor')]) + '</span>';
    }
  }
}

function initIndexPage() {
  updateNetPill();
  updateRegModeUI();
  initTeleconfig();
  setInterval(refreshTeleconsultStatus, 20000);
  initMyPatients();
  initSOS();

  const langSel = document.getElementById('lang-select');
  if (langSel) {
    langSel.addEventListener('change', () => {
      setLang(langSel.value);
      applyStaticI18n();
      updateNetPill();
      updateRegModeUI();
      if (lastShownPatient) renderPatientCard(lastShownPatient, 'patient-result');
    });
  }

  document.querySelectorAll('input[name="abha-exists"]').forEach((radio) => {
    radio.addEventListener('change', updateRegModeUI);
  });
  const abhaCreateBtn = document.getElementById('abha-create-btn');
  if (abhaCreateBtn) abhaCreateBtn.addEventListener('click', createAbhaFromAadhaar);

  const abhaInput = document.getElementById('abha-input');
  const searchBtn = document.getElementById('search-btn');
  const scanBtn = document.getElementById('scan-btn');
  const registerBtn = document.getElementById('register-btn');

  const doSearch = async () => {
    const abha = (abhaInput.value || '').trim();
    if (!/^\d{14}$/.test(abha)) {
      toast(t('t.valid_abha'), 'warn');
      return;
    }
    const patient = await searchPatient(abha);
    renderPatientCard(patient, 'patient-result');
    if (!patient) {
      toast(isOnline() ? t('t.not_found') : t('t.not_found_offline'), 'warn');
    } else {
      toast(isOnline() ? t('t.loaded_server') : t('t.loaded_cache'), 'ok');
    }
  };
  searchBtn.addEventListener('click', doSearch);
  abhaInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  // ---- Placeholder QR scanner -------------------------------------------
  const modal = document.getElementById('qr-modal');
  const grid = document.getElementById('qr-grid');
  const DEMO_PATIENTS = [
    { abha: '91214455667701', name: 'Sunita Devi' },
    { abha: '91214455667702', name: 'Ram Prasad' },
    { abha: '91214455667703', name: 'Meena Kumari' },
    { abha: '91214455667706', name: 'Mohan Lal' },
  ];
  DEMO_PATIENTS.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'qr-card';
    card.innerHTML = '<div class="qr-box"></div><b>' + p.name + '</b><small>' + p.abha + '</small>';
    card.addEventListener('click', () => {
      abhaInput.value = p.abha;
      modal.classList.remove('open');
      toast(t('t.qr_scanned', [p.name]), 'ok');
      doSearch();
    });
    grid.appendChild(card);
  });
  scanBtn.addEventListener('click', () => modal.classList.add('open'));
  document.getElementById('qr-close').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });

  // ---- Doctor teleconsult request (Feature 5) -----------------------------
  const teleModal = document.getElementById('tele-modal');
  document.getElementById('patient-result').addEventListener('click', (e) => {
    if (e.target && e.target.id === 'tele-btn') openTeleModal();
  });
  document.getElementById('tele-send').addEventListener('click', requestTeleconsult);
  document.getElementById('tele-cancel').addEventListener('click', closeTeleModal);
  if (teleModal) {
    teleModal.addEventListener('click', (e) => { if (e.target === teleModal) closeTeleModal(); });
  }

  // ---- ABHA-first offline registration -----------------------------------
  registerBtn.addEventListener('click', async () => {
    const mode = regMode();
    const val = (id) => document.getElementById(id).value.trim();
    const name = val('np-name');
    const dob = val('np-dob');
    const phone = val('np-phone');
    const village = val('np-village');
    const district = val('np-district');
    const state = val('np-state');
    const pincode = val('np-pincode');
    const familyId = val('np-family');
    const ageStr = val('np-age');
    const age = ageStr ? Number(ageStr) : null;
    const highRisk = Array.from(document.querySelectorAll('.hr-grid input:checked'))
      .map((cb) => cb.value);
    const allergies = (val('np-allergies') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const chronic = val('np-chronic');

    // Required-field labels (localized) for the validation message
    const fieldKeys = {
      abha: 'lbl.abha', name: 'lbl.name', dob: 'lbl.dob', phone: 'lbl.phone',
      village: 'lbl.village', district: 'lbl.district', state: 'lbl.state', pincode: 'lbl.pincode',
    };
    const missing = [];
    if (mode === 'yes') { if (!val('np-abha')) missing.push('abha'); }
    else if (!dob && !age) missing.push('dob');
    if (!name) missing.push('name');
    if (!village) missing.push('village');
    if (!district) missing.push('district');
    if (!state) missing.push('state');
    if (!pincode) missing.push('pincode');
    if (missing.length) {
      toast(t('t.fill_required', [missing.map((k) => t(fieldKeys[k])).join(', ')]), 'warn');
      return;
    }
    if (mode === 'no' && !/^(\+91[\s-]?)?[6-9]\d{9}$/.test(phone)) {
      toast(t('t.phone_invalid'), 'warn');
      return;
    }
    if (!/^\d{6}$/.test(pincode)) {
      toast(t('t.pincode_invalid'), 'warn');
      return;
    }
    // Age can stand in for an unknown date of birth (approx: born N years ago)
    if (!dob && age) {
      const d = new Date();
      d.setFullYear(d.getFullYear() - age);
      dob = d.toISOString().slice(0, 10);
    }

    let abha;
    let created = false;
    if (mode === 'yes') {
      abha = val('np-abha');
      if (!/^\d{14}$/.test(abha)) {
        toast(t('t.valid_abha'), 'warn');
        return;
      }
    } else {
      // The ABHA must already have been minted in the Aadhaar step above
      if (!createdAbha) {
        toast(t('abha.create_first'), 'warn');
        return;
      }
      abha = createdAbha;
      created = true;
    }

    // Guard: the same ABHA already exists on this device -> show it instead
    const existing = await db.getPatient(abha);
    if (existing) {
      renderPatientCard(existing, 'patient-result');
      toast(t('t.dup_local'), 'warn');
      return;
    }

    const clean = (s) => String(s == null ? '' : s).replace(/[<>]/g, '').trim();
    const patient = {
      abha_id: abha,
      name: clean(name),
      dob: dob || '2000-01-01',
      gender: document.getElementById('np-gender').value,
      phone: clean(phone),
      village: clean(village),
      district: clean(district),
      state: clean(state),
      pincode: clean(pincode),
      family_id: clean(familyId) || undefined,
      high_risk_category: highRisk.length ? highRisk : undefined,
      allergies: allergies.length ? allergies : undefined,
      chronic_conditions: clean(chronic) || undefined,
    };
    await db.savePatient(patient);
    await db.enqueue({
      type: 'patient',
      client_id: newClientId(),
      updated_at: utcNowIso(),
      data: patient,
    });

    let savedMsg;
    let kind = 'ok';
    if (isOnline()) {
      try {
        const res = await flushPending();
        savedMsg = t('t.saved_synced', [res.counts ? (res.counts.created || 0) : 0]);
      } catch (e) {
        savedMsg = t('t.sync_failed', [e.message]);
        kind = 'error';
      }
    } else {
      savedMsg = t('t.saved_offline');
    }
    if (created) savedMsg = t('t.abha_created', [abha]) + ' \u2014 ' + savedMsg;
    toast(savedMsg, kind);
    // Next registration starts fresh: clear the minted ABHA + Aadhaar step
    createdAbha = '';
    const aadhaarNameEl = document.getElementById('np-aadhaar-name');
    if (aadhaarNameEl) aadhaarNameEl.value = '';
    updateRegModeUI();
    renderPatientCard(patient, 'patient-result');
  });
}

/* ------------------------------------------------------------------ */
/* Triage page: local rule engine + queueing                           */
/* ------------------------------------------------------------------ */
function buildSymptomGrid() {
  const grid = document.getElementById('symptom-grid');
  if (!grid) return;
  const checked = {};
  grid.querySelectorAll('input:checked').forEach((cb) => { checked[cb.value] = true; });
  grid.innerHTML = '';
  SYMPTOM_ORDER.forEach((key) => {
    const label = document.createElement('label');
    label.innerHTML = '<input type="checkbox" value="' + key + '"' + (checked[key] ? ' checked' : '') + '> ' + symptomLabel(key);
    grid.appendChild(label);
  });
}

function initTriagePage() {
  updateNetPill();
  initSOS();
  buildSymptomGrid();
  initVoiceFill();
  initAiAutoRefresh();
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', resetTriageForm);
  initCheckin();

  // Pre-fill ABHA when arriving from "New Triage" on a patient card
  const preAbha = new URLSearchParams(location.search).get('abha');
  if (preAbha) {
    const abhaInput = document.getElementById('t-abha');
    if (abhaInput) abhaInput.value = preAbha;
  }

  const langSel = document.getElementById('lang-select');
  if (langSel) {
    langSel.addEventListener('change', () => {
      setLang(langSel.value);
      applyStaticI18n();
      updateNetPill();
      buildSymptomGrid();
      refreshVoiceUI();
      if (lastTriageData) {
        const rerun = localTriage(lastTriageData.symptoms, lastTriageData.vitals);
        renderTriageResult(rerun);
        if (rerun.color === 'RED') renderEmergencyPanel();
      }
      if (lastAiData) renderAiPanel();
    });
  }

  const val = (id) => {
    const el = document.getElementById(id);
    const v = el && el.value !== '' ? Number(el.value) : null;
    return v;
  };

  document.getElementById('assess-btn').addEventListener('click', async () => {
    const symptoms = {};
    const grid = document.getElementById('symptom-grid');
    grid.querySelectorAll('input:checked').forEach((cb) => { symptoms[cb.value] = true; });
    const vitals = {
      pulse: val('v-pulse'),
      systolic_bp: val('v-sbp'),
      diastolic_bp: val('v-dbp'),
      spo2: val('v-spo2'),
      temperature: val('v-temp'),
      respiratory_rate: val('v-rr'),
    };
    lastTriageData = { symptoms, vitals };
    const result = localTriage(symptoms, vitals);
    renderTriageResult(result);

    const abha = document.getElementById('t-abha').value.trim();
    const data = {
      symptoms: symptoms,
      vitals: vitals,
      assessed_by: 'asha_worker',
      assessed_at: utcNowIso(),
    };
    if (/^\d{14}$/.test(abha)) data.abha_id = abha;
    await db.enqueue({
      type: 'triage',
      client_id: newClientId(),
      updated_at: utcNowIso(),
      data: data,
    });

    if (isOnline()) {
      try {
        const res = await flushPending();
        toast(t('t.triage_saved', [res.counts ? (res.counts.created || 0) : 0]), 'ok');
      } catch (e) {
        toast(t('t.sync_failed', [e.message]), 'error');
      }
    } else {
      toast(t('t.triage_offline'), 'warn');
    }
    if (result.color === 'RED') renderEmergencyPanel();
  });

  const aiBtn = document.getElementById('ai-btn');
  if (aiBtn) aiBtn.addEventListener('click', runAiSuggestions);
}

function renderTriageResult(result) {
  const box = document.getElementById('triage-result');
  if (!box) return;
  box.innerHTML =
    '<div class="result ' + result.color + '">' +
    '<h3>' + t('color.' + result.color) + ' \u00b7 ' + t('priority', [result.score]) + '</h3>' +
    '<ul>' + result.reasons.map((r) => '<li>' + r + '</li>').join('') + '</ul>' +
    '<p><b>' + t('action') + ':</b> ' + result.recommendation +    '</p>' +
    '</div>';
}

/* ------------------------------------------------------------------ */
/* Voice symptom fill (Web Speech API). Keywords + detection live in   */
/* ai.js so the mapping is unit-testable offline; this section only    */
/* manages the microphone, transcript box and auto-ticking the grid.   */
/* ------------------------------------------------------------------ */
const AI_VOICE_SR = { en: 'en-US', hi: 'hi-IN', mr: 'mr-IN' };
let voiceRecognition = null; // active SpeechRecognition instance
let voiceLang = null;        // en | hi | mr
let voiceFilled = {};        // symptom keys auto-filled by voice this session
let voiceLastTranscript = '';

function speechRecognitionCtor() {
  const w = window;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function voiceSrLang() {
  if (!voiceLang) {
    voiceLang = (currentLang() === 'hi' || currentLang() === 'mr') ? currentLang() : 'en';
  }
  return AI_VOICE_SR[voiceLang] || 'en-US';
}

function voiceBtn() { return document.getElementById('voice-btn'); }

function setVoiceStatus(text, isErr) {
  const el = document.getElementById('voice-status');
  if (!el) return;
  if (text === null) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = 'voice-status' + (isErr ? ' err' : '');
}

function renderVoiceFilled() {
  const wrap = document.getElementById('voice-detected');
  const clearWrap = document.getElementById('voice-clear-wrap');
  if (!wrap || !clearWrap) return;
  const keys = Object.keys(voiceFilled);
  if (!keys.length) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    clearWrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = '<b>' + esc(t('ai.voice.filled')) + '</b>' +
    keys.map((k) => '<span class="voice-chip">✓ ' + esc(symptomLabel(k)) + '</span>').join('');
  clearWrap.hidden = false;
}

function applyVoiceDetection(detected) {
  const grid = document.getElementById('symptom-grid');
  if (!grid || !detected || !detected.found || !detected.found.length) return;
  let added = 0;
  detected.found.forEach((key) => {
    if (voiceFilled[key]) return;
    voiceFilled[key] = true;
    added += 1;
    const cb = grid.querySelector('input[value="' + key + '"]');
    if (cb) cb.checked = true;
  });
  if (added > 0) {
    renderVoiceFilled();
    toast(t('ai.voice.toast', [added]), 'ok');
  }
  maybeRefreshAiPanel();
}

function startVoiceListening() {
  const SR = speechRecognitionCtor();
  if (!SR) return;
  stopVoiceListening();
  const rec = new SR();
  rec.lang = voiceSrLang();
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  voiceRecognition = rec;
  voiceLastTranscript = '';

  const btn = voiceBtn();
  const setUi = (listening) => {
    if (!btn) return;
    btn.classList.toggle('listening', listening);
    const label = btn.querySelector('span');
    if (label) label.textContent = listening ? t('ai.voice.stop') : t('ai.voice.btn');
  };
  setUi(true);
  setVoiceStatus(t('ai.voice.listening'), false);

  rec.onresult = (event) => {
    let finalTxt = '';
    let interim = '';
    for (let i = 0; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalTxt += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    const shown = (finalTxt + ' ' + interim).trim();
    voiceLastTranscript = finalTxt.trim();
    setVoiceStatus(t('ai.voice.live', [shown]), false);
    if (typeof GramArogyaAI !== 'undefined' && GramArogyaAI.detectFromTranscript) {
      applyVoiceDetection(GramArogyaAI.detectFromTranscript(shown));
    }
  };

  rec.onerror = () => {
    setUi(false);
    setVoiceStatus(t('ai.voice.err'), true);
  };

  rec.onend = () => {
    if (voiceRecognition === rec) voiceRecognition = null;
    setUi(false);
    const total = Object.keys(voiceFilled).length;
    if (!total && !voiceLastTranscript) {
      setVoiceStatus(t('ai.voice.none'), false);
    } else if (!total && voiceLastTranscript) {
      setVoiceStatus(t('ai.voice.live', [voiceLastTranscript]) + ' — ' + t('ai.voice.none'), false);
    } else {
      setVoiceStatus(t('ai.voice.live', [voiceLastTranscript || '…']), false);
    }
  };

  try {
    rec.start();
  } catch (e) {
    voiceRecognition = null;
    setUi(false);
    setVoiceStatus(t('ai.voice.err'), true);
  }
}

function stopVoiceListening() {
  if (voiceRecognition) {
    try { voiceRecognition.stop(); } catch (e) { /* noop */ }
  }
  voiceRecognition = null;
}

function clearVoiceFills() {
  const grid = document.getElementById('symptom-grid');
  if (grid) {
    Object.keys(voiceFilled).forEach((key) => {
      const cb = grid.querySelector('input[value="' + key + '"]');
      if (cb) cb.checked = false;
    });
  }
  voiceFilled = {};
  maybeRefreshAiPanel();
  renderVoiceFilled();
}

function refreshVoiceUI() {
  renderVoiceFilled();
  const btn = voiceBtn();
  if (!btn) return;
  const label = btn.querySelector('span');
  if (label) {
    label.textContent = btn.classList.contains('listening') ? t('ai.voice.stop') : t('ai.voice.btn');
  }
}

function initVoiceFill() {
  const btn = voiceBtn();
  if (!btn) return;
  if (!speechRecognitionCtor()) {
    btn.disabled = true;
    setVoiceStatus(t('ai.voice.unsupported'), true);
    return;
  }
  btn.addEventListener('click', () => {
    if (voiceRecognition) stopVoiceListening();
    else startVoiceListening();
  });
  const langSel = document.getElementById('voice-lang');
  if (langSel) {
    langSel.value = (currentLang() === 'hi' || currentLang() === 'mr') ? currentLang() : 'en';
    langSel.addEventListener('change', () => { voiceLang = langSel.value; });
  }
  const clearBtn = document.getElementById('voice-clear');
  if (clearBtn) clearBtn.addEventListener('click', clearVoiceFills);
  renderVoiceFilled();
}

/* ------------------------------------------------------------------ */
/* AI assistant panel — rule suggestions when the doctor is not        */
/* available. Engine lives in ai.js; rendered here through t().         */
/* ------------------------------------------------------------------ */
let lastAiData = null;

function aiBox() { return document.getElementById('ai-result'); }

function hasAiInput(pd) {
  const anySym = Object.keys(pd.symptoms || {}).length > 0;
  const vit = pd.vitals || {};
  const anyVital = Object.keys(vit).some((k) => {
    const v = vit[k];
    return v !== null && v !== undefined && v !== '';
  });
  return anySym || anyVital;
}

function collectTriageForm() {
  const symptoms = {};
  const grid = document.getElementById('symptom-grid');
  if (grid) {
    grid.querySelectorAll('input:checked').forEach((cb) => { symptoms[cb.value] = true; });
  }
  const n = (id) => {
    const el = document.getElementById(id);
    const v = el ? el.value : '';
    return v === '' ? null : Number(v);
  };
  const vitals = {
    pulse: n('v-pulse'),
    systolic_bp: n('v-sbp'),
    diastolic_bp: n('v-dbp'),
    spo2: n('v-spo2'),
    temperature: n('v-temp'),
    respiratory_rate: n('v-rr'),
  };
  const ck = (id) => { const el = document.getElementById(id); return !!(el && el.checked); };
  const history = {
    pregnant: ck('ctx-pregnant'),
    diabetic: ck('ctx-diabetic'),
    hypertension: ck('ctx-htn'),
  };
  return { symptoms, vitals, history };
}

function runAiSuggestions() {
  const pd = collectTriageForm();
  if (!hasAiInput(pd)) {
    toast(t('ai.need'), 'warn');
    return;
  }
  lastAiData = pd;
  renderAiPanel();
}

/* ------------------------------------------------------------------ */
/* OPD check-in / token generation (ASHA_WORKER role)                  */
/* Issues a GA-... token for this patient at the worker's PHC. Tokens   */
/* are sequenced by the facility server, so check-in needs connectivity; */
/* field triage itself still works fully offline.                       */
/* ------------------------------------------------------------------ */
let workerFacCache = null;

async function workerFacility() {
  if (workerFacCache) return workerFacCache;
  try {
    const facs = await apiFetch('/facilities');
    workerFacCache = facs.find((f) => f.facility_type === 'phc') || facs[0] || null;
  } catch (e) {
    workerFacCache = null;
  }
  return workerFacCache;
}

function initCheckin() {
  const btn = document.getElementById('ci-btn');
  if (!btn) return;
  btn.addEventListener('click', runCheckin);
}

async function runCheckin() {
  const abha = (document.getElementById('t-abha').value || '').trim();
  const out = document.getElementById('ci-result');
  if (!/^\d{14}$/.test(abha)) {
    out.innerHTML = '<p class="ai-warn">' + esc(t('ci.badabha')) + '</p>';
    return;
  }
  if (!isOnline()) {
    out.innerHTML = '<p class="ai-warn">' + esc(t('ci.offline')) + '</p>';
    return;
  }
  out.innerHTML = '<p class="muted">' + esc(t('ci.thinking')) + '</p>';
  try {
    const pats = await apiFetch('/patients?q=' + encodeURIComponent(abha));
    const pat = (pats || []).find((p) => p.abha_id === abha);
    if (!pat) {
      out.innerHTML = '<p class="ai-warn">' + esc(t('ci.notfound')) + '</p>';
      return;
    }
    const fac = await workerFacility();
    if (!fac) {
      out.innerHTML = '<p class="ai-warn">' + esc(t('ci.nofac')) + '</p>';
      return;
    }
    const appt = await apiFetch('/appointments', {
      method: 'POST',
      body: JSON.stringify({
        patient_id: pat.id,
        facility_id: fac.id,
        priority: document.getElementById('ci-priority').value,
        reason: 'OPD check-in (ASHA)',
        department: 'GMED',
        counter: 'WEB01',
      }),
    });
    out.innerHTML = '<div class="ci-token"><b>' + esc(appt.token_label) + '</b><br>' +
      '<span class="muted small">' + esc(fac.name) + ' · ' +
      esc(t('ci.wait', [appt.est_wait_min || 0])) + '</span></div>';
    toast(t('ci.btn'), 'ok');
  } catch (e) {
    out.innerHTML = '<p class="ai-warn">' + esc(t('ci.failed', [e.message])) + '</p>';
  }
}

/* One-tap reset for the NEXT patient: clears symptoms, vitals, background,
 * ABHA, triage result and the AI panel — no page refresh needed. */
function resetTriageForm() {
  clearVoiceFills();
  const grid = document.getElementById('symptom-grid');
  if (grid) grid.querySelectorAll('input:checked').forEach((cb) => { cb.checked = false; });
  ['v-pulse', 'v-sbp', 'v-dbp', 'v-spo2', 'v-temp', 'v-rr'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['ctx-pregnant', 'ctx-diabetic', 'ctx-htn'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  const abha = document.getElementById('t-abha');
  if (abha) abha.value = '';
  lastTriageData = null;
  lastAiData = null;
  const tr = document.getElementById('triage-result');
  if (tr) tr.innerHTML = '';
  const ai = document.getElementById('ai-result');
  if (ai) ai.innerHTML = '';
  const ci = document.getElementById('ci-result');
  if (ci) ci.innerHTML = '';
  toast(t('btn.reset.done'), 'ok');
}

/* Re-run the panel from the live form, but only if it is already shown
 * (so ticking symptoms/vitals never re-renders before the first run). */
function maybeRefreshAiPanel() {
  if (!lastAiData) return;
  lastAiData = collectTriageForm();
  renderAiPanel();
}

/* Live re-analysis: once the AI suggestions are shown, any change to
 * symptoms / vitals / background ticks updates the plan immediately
 * (no refresh, no need to click the button again). */
function initAiAutoRefresh() {
  const grid = document.getElementById('symptom-grid');
  if (grid) grid.addEventListener('change', maybeRefreshAiPanel);
  ['v-pulse', 'v-sbp', 'v-dbp', 'v-spo2', 'v-temp', 'v-rr'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', maybeRefreshAiPanel);
  });
  ['ctx-pregnant', 'ctx-diabetic', 'ctx-htn'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', maybeRefreshAiPanel);
  });
}

function riskLevel(score) {
  return score > 70 ? 'RED' : score > 40 ? 'YELLOW' : 'GREEN';
}

/* Render the ONE combined plan: all detected problems, a single
 * ordered action list, and the combined why/caution. */
function unifiedPlanHtml(plan) {
  const conds = plan.conditions.map((id, i) =>
    '<span class="ai-cond">' + esc(t(plan.titleKeys[i], plan.titleVars[i])) + '</span>'
  ).join('');
  const acts = plan.acts.map((k) => '<li>' + esc(t(k)) + '</li>').join('');
  const whys = plan.whyKeys.map((k) => '<li>' + esc(t(k)) + '</li>').join('');
  const warns = plan.warnKeys.map((k) => '<li>' + esc(t(k)) + '</li>').join('');
  const cta = plan.severity === 'RED'
    ? '<div class="ai-cta">' +
      '<a class="btn-link" href="tel:108">' + esc(t('ai.red.108')) + '</a>' +
      '<button type="button" class="btn-link ai-sos">' + esc(t('ai.red.sos')) + '</button>' +
      '</div>'
    : '';
  return '<div class="ai-card ' + plan.severity + ' ai-plan">' +
    '<h3>' + esc(t('ai.plan.detected')) + '</h3>' +
    '<div class="ai-conds">' + conds + '</div>' +
    '<p class="muted">' + esc(t('ai.plan.advice')) + '</p>' +
    '<b>' + esc(t('ai.plan.actions')) + ':</b><ol class="ai-acts">' + acts + '</ol>' +
    '<p class="ai-why"><b>' + esc(t('ai.why')) + ':</b></p><ul class="ai-list">' + whys + '</ul>' +
    '<p class="ai-warn"><b>' + esc(t('ai.warn')) + ':</b></p><ul class="ai-list">' + warns + '</ul>' +
    cta +
    '</div>';
}

function renderAiPanel() {
  const box = aiBox();
  if (!box || !lastAiData) return;
  if (typeof GramArogyaAI === 'undefined' || !GramArogyaAI.generateUnifiedPlan) return;
  const plan = GramArogyaAI.generateUnifiedPlan(lastAiData);
  const risk = GramArogyaAI.calculateRiskScore ? GramArogyaAI.calculateRiskScore(lastAiData) : 0;
  // The badge level follows the CLINICAL severity of the combined plan,
  // so a RED finding is always flagged "HIGH RISK — act now" even if the
  // raw heuristic score is low. The score is shown below as a reference.
  const level = plan ? plan.severity : riskLevel(risk);
  const riskTxt = level === 'RED' ? t('ai.risk.high')
    : level === 'YELLOW' ? t('ai.risk.medium')
    : t('ai.risk.low');
  const body = plan
    ? unifiedPlanHtml(plan)
    : '<p class="ai-none"><span>🩺</span>' + esc(t('ai.none')) + '</p>';
  box.innerHTML =
    '<div class="ai-box">' +
    '<h2>' + esc(t('ai.title')) + '</h2>' +
    '<p class="ai-sub">' + esc(t('ai.sub')) + '</p>' +
    '<div><span class="risk-badge ' + level + '">' + esc(riskTxt) + '</span></div>' +
    '<p class="risk-desc">' + esc(t('ai.risk', [risk])) + '</p>' +
    body +
    '<p class="ai-disclaimer">' + esc(t('ai.disclaimer')) + '</p>' +
    '</div>';
  box.querySelectorAll('.ai-sos').forEach((b) => {
    b.addEventListener('click', () => {
      const sos = document.getElementById('sos-btn');
      if (sos) sos.click();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Emergency escalation (RED triage -> bypass referral)                 */
/* ------------------------------------------------------------------ */
let FACILITY_OPTIONS_CACHE = null;

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function facilityDestOptions() {
  if (FACILITY_OPTIONS_CACHE) return FACILITY_OPTIONS_CACHE;
  try {
    const all = await apiFetch('/facilities');
    FACILITY_OPTIONS_CACHE = (all || []).filter((f) =>
      f.facility_type === 'chc' || f.facility_type === 'district_hospital');
  } catch (e) {
    FACILITY_OPTIONS_CACHE = [];
  }
  return FACILITY_OPTIONS_CACHE;
}

function renderEmergencyPanel() {
  const holder = document.getElementById('triage-result');
  if (!holder) return;
  const old = document.getElementById('emer-panel');
  if (old) old.remove();
  const abha = (document.getElementById('t-abha').value || '').trim();
  const hasAbha = /^\d{14}$/.test(abha);
  const panel = document.createElement('div');
  panel.id = 'emer-panel';
  panel.className = 'emer-panel';
  panel.innerHTML =
    '<div class="result RED" style="margin-top:14px">' +
    '<h3>' + t('emer.title') + '</h3>' +
    (!hasAbha ? '<p class="muted">' + t('emer.no_abha') + '</p>' : '') +
    '<label>' + t('emer.to') + '</label>' +
    '<select id="emer-fac"><option value="">' + t('emer.auto') + '</option></select>' +
    '<label>Reason</label>' +
    '<textarea id="emer-reason" rows="2" placeholder="' + t('emer.reason_ph') + '"></textarea>' +
    '<button id="emer-submit" class="danger"' + (hasAbha ? '' : ' disabled') + '>' + t('emer.btn') + '</button>' +
    '</div>';
  holder.appendChild(panel);

  facilityDestOptions().then((opts) => {
    const sel = document.getElementById('emer-fac');
    if (!sel) return;
    opts.forEach((f) => {
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = f.name;
      sel.appendChild(o);
    });
  });

  document.getElementById('emer-submit').addEventListener('click', submitEmergencyReferral);
}

async function submitEmergencyReferral() {
  const abha = (document.getElementById('t-abha').value || '').trim();
  if (!/^\d{14}$/.test(abha)) {
    toast(t('emer.no_abha'), 'warn');
    return;
  }
  const reason = (document.getElementById('emer-reason').value || '').trim();
  const toFacilityId = document.getElementById('emer-fac').value;
  const data = {
    abha_id: abha,
    priority: 'emergency',
    reason: reason,
    to_facility_id: toFacilityId || undefined,
    asha_phone: (await getAshaPhone()) || undefined,
    created_at: utcNowIso(),
  };
  const local = await db.getPatient(abha);
  if (local) {
    ['name', 'dob', 'gender', 'phone', 'village', 'district', 'state', 'pincode']
      .forEach((k) => { if (local[k]) data[k] = local[k]; });
  }
  await db.enqueue({
    type: 'referral',
    client_id: newClientId(),
    updated_at: utcNowIso(),
    data: data,
  });
  const btn = document.getElementById('emer-submit');
  if (btn) btn.disabled = true;
  if (isOnline()) {
    try {
      await flushPending();
      toast(t('emer.created_synced'), 'ok');
    } catch (e) {
      toast(t('tasks.done_failed', [e.message]), 'error');
    }
  } else {
    toast(t('emer.created_offline'), 'warn');
  }
}

/* ------------------------------------------------------------------ */
/* My Tasks page: daily high-risk follow-up list                        */
/* ------------------------------------------------------------------ */
const TASK_BUCKETS = ['due_today', 'upcoming', 'overdue', 'completed'];
let currentTasks = null;
let tasksStale = false;

function catLabel(c) {
  return String(c || '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function initTasksPage() {
  updateNetPill();
  initSOS();
  const langSel = document.getElementById('lang-select');
  if (langSel) {
    langSel.addEventListener('change', () => {
      setLang(langSel.value);
      applyStaticI18n();
      updateNetPill();
      renderTasksMarkup();
    });
  }
  const dm = document.getElementById('task-done-modal');
  if (dm) {
    document.getElementById('td-cancel').addEventListener('click', () => dm.classList.remove('open'));
    document.getElementById('td-submit').addEventListener('click', submitDoneModal);
    dm.addEventListener('click', (e) => { if (e.target === dm) dm.classList.remove('open'); });
  }
  const rm = document.getElementById('task-resched-modal');
  if (rm) {
    document.getElementById('tr-cancel').addEventListener('click', () => rm.classList.remove('open'));
    document.getElementById('tr-submit').addEventListener('click', submitReschedModal);
    rm.addEventListener('click', (e) => { if (e.target === rm) rm.classList.remove('open'); });
  }
  loadTasks();
  setInterval(loadTasks, 45000);
}

async function loadTasks() {
  const lists = document.getElementById('task-lists');
  if (!lists) return;
  lists.innerHTML = '<p class="muted">' + t('tasks.loading') + '</p>';
  try {
    const tasks = await apiFetch('/followups');
    currentTasks = tasks;
    tasksStale = false;
    await db.setSetting('tasks_cache', { saved_at: new Date().toISOString(), tasks: tasks });
  } catch (e) {
    const cache = await db.getSetting('tasks_cache');
    if (cache && cache.value && cache.value.tasks) {
      currentTasks = cache.value.tasks;
      tasksStale = true;
    } else {
      currentTasks = [];
      tasksStale = false;
    }
  }
  renderTasksMarkup();
}

function renderTasksMarkup() {
  const statsEl = document.getElementById('task-stats');
  const listsEl = document.getElementById('task-lists');
  const noteEl = document.getElementById('task-note');
  if (!listsEl) return;
  const tasks = currentTasks || [];
  const buckets = {};
  TASK_BUCKETS.forEach((b) => { buckets[b] = tasks.filter((x) => x.bucket === b); });

  renderOverdueAlerts(tasks);

  if (statsEl) {
    statsEl.innerHTML = TASK_BUCKETS.map((b) =>
      '<div class="task-stat"><b>' + buckets[b].length + '</b><span>' + t('tasks.stat.' + b) + '</span></div>'
    ).join('');
  }
  if (noteEl) noteEl.textContent = tasksStale ? t('tasks.offline_cached') : '';

  listsEl.innerHTML = TASK_BUCKETS.map((b) => {
    const rows = buckets[b];
    return '<h3 class="task-head">' + t('tasks.stat.' + b) + ' (' + rows.length + ')</h3>' +
      (rows.length === 0
        ? '<p class="muted">' + t('tasks.empty', [t('tasks.stat.' + b).toLowerCase()]) + '</p>'
        : rows.map(taskRow).join(''));
  }).join('');
  bindTaskButtons();
}

function daysFromDue(task) {
  const due = new Date(task.due_date + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}

function renderOverdueAlerts(tasks) {
  const el = document.getElementById('overdue-alerts');
  if (!el) return;
  const overdue = tasks.filter((x) => x.bucket === 'overdue');
  if (!overdue.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="overdue-box"><b>⚠️ ' + t('tasks.overdue_count', [overdue.length]) + '</b>' +
    overdue.map((x) => '<div class="overdue-row">' + esc(x.patient_name || '—') + ' · ' +
      esc(x.task || catLabel(x.category)) + ' · ' + esc(String(x.due_date || '')) + '</div>').join('') +
    '</div>';
}

function taskRow(task) {
  const done = task.status === 'completed';
  const urgent = task.priority === 'urgent' || task.priority === 'emergency';
  const overdue = !done && task.bucket === 'overdue';
  const days = daysFromDue(task);
  const dueLabel = overdue
    ? t('tasks.overdue_by', [Math.abs(days)])
    : (days === 0 ? t('tasks.due_today') : t('tasks.days_left', [days]));
  return '<div class="task-row' + (urgent ? ' urgent' : '') + (done ? ' done' : '') + (overdue ? ' overdue' : '') + '">' +
    '<div class="task-main"><b>' + esc(task.patient_name || '—') + '</b>' +
    '<span class="muted">' + esc(task.task || catLabel(task.category)) + '</span>' +
    '<span class="muted">' + (overdue ? '<b class="overdue-txt">⚠️ ' : '') + esc(dueLabel) + (overdue ? '</b>' : '') +
    ' · ' + t('tasks.due', [esc(String(task.due_date || ''))]) + '</span>' +
    (task.village ? '<span class="muted">📍 ' + esc(task.village) + '</span>' : '') +
    '</div>' +
    '<div class="task-actions">' +
    (task.patient_phone ? '<button class="small btn-link" data-call="' + esc(task.patient_phone) + '" data-call-label="' + esc(task.patient_name || '') + '">📞</button>' : '') +
    (done
      ? '<span class="task-status ok">' + t('tasks.stat.completed') + '</span>'
      : '<button class="small" data-done="' + task.id + '">' + t('tasks.mark_done') + '</button>' +
        '<button class="small secondary" data-resched="' + task.id + '">' + t('tasks.resched') + '</button>') +
    '</div></div>';
}

function bindTaskButtons() {
  document.querySelectorAll('[data-done]').forEach((btn) => {
    btn.addEventListener('click', () => openDoneModal(btn.getAttribute('data-done')));
  });
  document.querySelectorAll('[data-resched]').forEach((btn) => {
    btn.addEventListener('click', () => openReschedModal(btn.getAttribute('data-resched')));
  });
  bindCallButtons();
}

let activeDoneTask = null;
let activeReschedTask = null;

function openDoneModal(taskId) {
  const task = (currentTasks || []).find((x) => x.id === taskId);
  if (!task) return;
  activeDoneTask = taskId;
  document.getElementById('task-done-patient').textContent =
    (task.patient_name || '—') + ' · ' + t('tasks.due', [esc(String(task.due_date || ''))]);
  document.getElementById('td-vitals').checked = false;
  document.getElementById('td-advised').checked = false;
  document.getElementById('td-meds').checked = false;
  document.getElementById('td-notes').value = '';
  document.getElementById('task-done-modal').classList.add('open');
}

async function submitDoneModal() {
  if (!activeDoneTask) return;
  const notes = document.getElementById('td-notes').value.trim();
  const checks = [
    document.getElementById('td-vitals').checked,
    document.getElementById('td-advised').checked,
    document.getElementById('td-meds').checked,
  ];
  const summary = notes || (checks.every(Boolean) ? t('tasks.all_checks') : null);
  document.getElementById('task-done-modal').classList.remove('open');
  if (isOnline()) {
    try {
      await apiFetch('/followups/' + activeDoneTask, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed', notes: summary }),
      });
      currentTasks = (currentTasks || []).map((x) =>
        x.id === activeDoneTask ? Object.assign({}, x, { status: 'completed', bucket: 'completed', notes: summary }) : x);
      toast(t('tasks.done_synced'), 'ok');
      renderTasksMarkup();
      refreshTasksCache();
      return;
    } catch (e) { /* fall through to offline queueing */ }
  }
  await db.enqueue({
    type: 'followup',
    client_id: newClientId(),
    updated_at: utcNowIso(),
    data: { action: 'complete', task_id: activeDoneTask, notes: summary },
  });
  currentTasks = (currentTasks || []).map((x) =>
    x.id === activeDoneTask ? Object.assign({}, x, { status: 'completed', bucket: 'completed', notes: summary }) : x);
  toast(t('tasks.done_offline'), 'ok');
  renderTasksMarkup();
}

function openReschedModal(taskId) {
  const task = (currentTasks || []).find((x) => x.id === taskId);
  if (!task) return;
  if (!isOnline()) { toast(t('tasks.resched_online'), 'warn'); return; }
  activeReschedTask = taskId;
  document.getElementById('task-resched-patient').textContent = task.patient_name || '—';
  document.getElementById('td-newdate').value = task.due_date || '';
  document.getElementById('task-resched-modal').classList.add('open');
}

async function submitReschedModal() {
  if (!activeReschedTask) return;
  const due = document.getElementById('td-newdate').value;
  if (!due) { toast(t('tasks.need_date'), 'warn'); return; }
  try {
    await apiFetch('/followups/' + activeReschedTask, {
      method: 'PATCH',
      body: JSON.stringify({ due_date: due }),
    });
    currentTasks = (currentTasks || []).map((x) =>
      x.id === activeReschedTask ? Object.assign({}, x, { due_date: due }) : x);
    toast(t('tasks.resched_done'), 'ok');
    document.getElementById('task-resched-modal').classList.remove('open');
    renderTasksMarkup();
    refreshTasksCache();
  } catch (e) { toast(e.message, 'error'); }
}

async function refreshTasksCache() {
  try {
    const tasks = await apiFetch('/followups');
    await db.setSetting('tasks_cache', { saved_at: new Date().toISOString(), tasks: tasks });
  } catch (e) { /* offline: keep the previous snapshot */ }
}

async function markFollowUpDone(taskId) {
  if (isOnline()) {
    try {
      await apiFetch('/followups/' + taskId, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      });
      currentTasks = (currentTasks || []).map((x) =>
        x.id === taskId ? Object.assign({}, x, { status: 'completed', bucket: 'completed' }) : x);
      toast(t('tasks.done_synced'), 'ok');
      renderTasksMarkup();
      refreshTasksCache();
      return;
    } catch (e) { /* fall through to offline queueing */ }
  }
  await db.enqueue({
    type: 'followup',
    client_id: newClientId(),
    updated_at: utcNowIso(),
    data: { action: 'complete', task_id: taskId },
  });
  toast(t('tasks.done_offline'), 'ok');
  currentTasks = (currentTasks || []).map((x) =>
    x.id === taskId ? Object.assign({}, x, { status: 'completed', bucket: 'completed' }) : x);
  renderTasksMarkup();
}

/* ------------------------------------------------------------------ */
/* Sync page: network toggle + pending queue + unified flush           */
/* ------------------------------------------------------------------ */
function initSyncPage() {
  updateNetPill();
  initSOS();
  initAshaPhone();
  const toggle = document.getElementById('network-toggle');
  toggle.checked = isOnline();
  updateNetworkUI();

  const retryAll = document.getElementById('retry-all');
  if (retryAll) {
    retryAll.addEventListener('click', async () => {
      const pending = await db.getPending();
      for (const rec of pending) {
        if (rec.sync_failed) {
          await db.savePending(Object.assign({}, rec, { sync_failed: false, error: undefined }));
        }
      }
      renderSyncPage();
    });
  }

  const langSel = document.getElementById('lang-select');
  if (langSel) {
    langSel.addEventListener('change', () => {
      setLang(langSel.value);
      applyStaticI18n();
      updateNetPill();
      updateNetworkUI();
      renderSyncPage();
    });
  }

  toggle.addEventListener('change', async () => {
    setNetworkState(toggle.checked ? 'online' : 'offline');
    updateNetworkUI();
    if (toggle.checked) {
      toast(t('t.net_online'), 'info');
      await runFullSyncWithUI();
    } else {
      toast(t('t.net_offline'), 'warn');
    }
  });

  document.getElementById('sync-now').addEventListener('click', async () => {
    if (!isOnline()) { toast(t('t.toggle_first'), 'warn'); return; }
    await runFullSyncWithUI();
  });

  renderSyncPage();
  setInterval(renderSyncPage, 4000);
}

function updateNetworkUI() {
  const label = document.getElementById('network-label');
  const sub = document.getElementById('network-sub');
  const btn = document.getElementById('sync-now');
  const online = isOnline();
  if (label) {
    label.textContent = online ? t('net.online_label') : t('net.offline_label');
    label.className = 'network-label ' + (online ? 'online' : 'offline');
  }
  if (sub) sub.textContent = online ? t('net.sub.online') : t('net.sub.offline');
  if (btn) btn.disabled = !online;
  updateNetPill();
}

async function renderSyncPage() {
  const pending = await db.getPending();
  const byType = {};
  pending.forEach((r) => { byType[r.type] = (byType[r.type] || 0) + 1; });

  const countsEl = document.getElementById('sync-counts');
  if (countsEl) {
    const types = ['patient', 'triage', 'referral', 'followup', 'teleconsult'];
    countsEl.innerHTML = types.map((tp) =>
      '<div class="task-stat"><b>' + (byType[tp] || 0) + '</b><span>' + t('type.' + tp) + '</span></div>').join('') +
      '<div class="task-stat"><b>' + pending.length + '</b><span>' + t('sync.total') + '</span></div>';
  }

  const summary = document.getElementById('pending-summary');
  const tbody = document.getElementById('pending-body');
  if (!pending.length) {
    summary.textContent = t('summary.empty');
    tbody.innerHTML = '';
  } else {
    summary.textContent = t('summary.pending', [
      pending.length,
      Object.entries(byType).map(([type, n]) => t('type.' + type) + ' × ' + n).join(', '),
    ]);
    tbody.innerHTML = pending.map((r) => {
      const patient = r.type === 'patient' ? (r.data && r.data.name) : (r.data && r.data.abha_id) || '';
      const st = r.sync_failed ? t('sync.failed_short') : t('sync.pending_short');
      const cls = r.sync_failed ? 'rejected' : 'pending_sync';
      return '<tr><td><span class="badge ' + r.type + '">' + t('type.' + r.type) + '</span></td>' +
        '<td>' + esc(patient) + '</td>' +
        '<td>' + (r.updated_at ? new Date(r.updated_at).toLocaleTimeString() : '') + '</td>' +
        '<td><span class="ref-status ' + cls + '">' + esc(st) + '</span></td>' +
        '<td></td></tr>';
    }).join('');
  }

  // Failed items with retry / delete
  const failedCard = document.getElementById('failed-card');
  const failedList = document.getElementById('failed-list');
  if (failedCard && failedList) {
    const failed = pending.filter((r) => r.sync_failed);
    failedCard.hidden = failed.length === 0;
    if (failed.length) {
      failedList.innerHTML = failed.map((r) =>
        '<div class="failed-row"><span>' + esc(t('type.' + r.type)) + ' · ' + esc(r.error || '') + '</span>' +
        '<span class="row" style="gap:6px;flex:0 0 auto">' +
        '<button class="small" data-retry="' + esc(r.client_id) + '">' + t('sync.retry') + '</button>' +
        '<button class="small danger" data-del="' + esc(r.client_id) + '">' + t('sync.delete') + '</button>' +
        '</span></div>').join('');
      document.querySelectorAll('[data-retry]').forEach((b) => {
        b.addEventListener('click', async () => {
          const rec = failed.find((x) => x.client_id === b.getAttribute('data-retry'));
          if (rec) await db.savePending(Object.assign({}, rec, { sync_failed: false, error: undefined }));
          renderSyncPage();
        });
      });
      document.querySelectorAll('[data-del]').forEach((b) => {
        b.addEventListener('click', async () => {
          await db.removePending(b.getAttribute('data-del'));
          renderSyncPage();
        });
      });
    }
  }

  const lastSync = await db.getSetting('last_sync_at');
  document.getElementById('last-sync').textContent =
    lastSync ? new Date(lastSync.value).toLocaleString() : t('sync.never');

  if (isOnline()) {
    try {
      const queued = await apiFetch('/messages?status=queued');
      document.getElementById('msg-summary').textContent = t('msg.queued', [queued.length]);
    } catch (e) { /* keep last value */ }
  } else {
    document.getElementById('msg-summary').textContent = t('msg.queued_offline');
  }
}

async function runFullSyncWithUI() {
  const wrap = document.getElementById('sync-progress-wrap');
  const bar = document.getElementById('sync-progress-bar');
  const label = document.getElementById('sync-progress-label');
  const btn = document.getElementById('sync-now');
  if (wrap) wrap.hidden = false;
  if (bar) bar.style.width = '0%';
  if (label) label.textContent = t('sync.starting');
  if (btn) btn.disabled = true;
  try {
    const { syncRes, msgRes } = await fullSync((done, total) => {
      if (bar) bar.style.width = Math.round((done / total) * 100) + '%';
      if (label) label.textContent = t('sync.progress', [done, total]);
    });
    const created = syncRes ? (syncRes.synced || 0) : 0;
    const sent = msgRes ? msgRes.sent : 0;
    toast(t('t.sync_done', [created, sent]), 'ok');
    const log = document.getElementById('dispatch-log');
    if (log && msgRes && msgRes.log && msgRes.log.length) {
      log.innerHTML = msgRes.log.map((l) => '<div>\ud83d\udce8 ' + l + '</div>').join('');
    }
  } catch (e) {
    toast(t('t.sync_fail', [e.message]), 'error');
  }
  if (wrap) wrap.hidden = true;
  if (btn) btn.disabled = false;
  await renderSyncPage();
}

/* ------------------------------------------------------------------ */
/* My Patients dashboard (Feature 2)                                    */
/* ------------------------------------------------------------------ */
let myPatientsFilter = 'all';
let myPatientsQuery = '';

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  return now.getFullYear() - d.getFullYear() -
    ((now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) ? 1 : 0);
}

function fmtDT(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch (e) { return String(iso); }
}

function highRiskBadges(p) {
  const map = {
    pregnant: ['🤰', 'hr.pregnant'], diabetic: ['💉', 'hr.diabetic'],
    hypertension: ['❤️', 'hr.htn'], elderly: ['👴', 'hr.elderly'], chronic: ['🫁', 'hr.chronic'],
  };
  return (p.high_risk_category || []).map((k) => {
    const hit = map[k] || ['🏷️', 'hr.chronic'];
    return '<span class="hr-badge hr-' + esc(k) + '">' + hit[0] + ' ' + t(hit[1]) + '</span>';
  }).join('');
}

function patientCard(p) {
  const age = ageFromDob(p.dob);
  return '<div class="mp-card' + (p._highrisk ? ' highrisk' : '') + '">' +
    '<div class="mp-main"><b>' + esc(p.name) + '</b> ' +
    (p._pending
      ? '<span class="mp-sync pending" title="' + t('mp.pending') + '">🟡</span>'
      : '<span class="mp-sync" title="' + t('mp.synced') + '">🟢</span>') +
    '<span class="muted">' + (age == null ? '?' : age) + ' ' + t('unit.yrs') + ' · ' + genderLabel(p.gender) + ' · ' + esc(p.village || '—') + '</span></div>' +
    (p.abha_id ? '<div class="mp-meta">ABHA: <b>' + esc(p.abha_id) + '</b></div>' : '') +
    (p._due ? '<div class="mp-meta due">⏰ ' + t('mp.fu_due') + '</div>' : '') +
    '<div class="mp-badges">' + highRiskBadges(p) + '</div>' +
    '<div class="row mp-actions">' +
    '<button class="small" data-view="' + esc(p.abha_id) + '">' + t('mp.view') + '</button>' +
    '<button class="small" data-triage="' + esc(p.abha_id) + '">' + t('mp.new_triage') + '</button>' +
    (p.phone ? '<button class="small btn-link" data-call="' + esc(p.phone) + '" data-call-label="' + esc(p.name || '') + '">📞</button>' : '') +
    '</div></div>';
}

async function renderMyPatients() {
  const list = document.getElementById('mp-list');
  if (!list) return;
  const patients = (await db.getAllPatients()) || [];
  const pending = (await db.getPending()) || [];
  const pendingAbhas = new Set(
    pending.filter((r) => r.type === 'patient' && r.data && r.data.abha_id)
      .map((r) => r.data.abha_id));
  const cache = await db.getSetting('tasks_cache');
  const tasks = (cache && cache.value && cache.value.tasks) || [];
  const weekFromNow = Date.now() + 7 * 86400000;
  const dueAbhas = new Set(
    tasks.filter((x) => x.status === 'pending' && x.due_date &&
      new Date(x.due_date + 'T00:00:00').getTime() <= weekFromNow)
      .map((x) => x.abha_id));

  let rows = patients.map((p) => Object.assign({}, p, {
    _pending: pendingAbhas.has(p.abha_id),
    _highrisk: (p.high_risk_category || []).length > 0,
    _due: dueAbhas.has(p.abha_id),
  }));

  if (myPatientsFilter === 'highrisk') rows = rows.filter((p) => p._highrisk);
  else if (myPatientsFilter === 'pending') rows = rows.filter((p) => p._pending);
  else if (myPatientsFilter === 'followups') rows = rows.filter((p) => p._due);

  const q = myPatientsQuery.trim().toLowerCase();
  if (q) {
    rows = rows.filter((p) =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.abha_id || '').includes(q) ||
      (p.village || '').toLowerCase().includes(q));
  }

  rows.sort((a, b) => (b._highrisk - a._highrisk) ||
    String(b.updated_at || '').localeCompare(String(a.updated_at || '')));

  if (!rows.length) { list.innerHTML = '<p class="muted">' + t('mp.empty') + '</p>'; return; }
  list.innerHTML = rows.map(patientCard).join('');
  bindPatientCardActions();
}

function bindPatientCardActions() {
  document.querySelectorAll('[data-view]').forEach((b) => {
    b.addEventListener('click', async () => {
      const p = await db.getPatient(b.getAttribute('data-view'));
      if (p) openPatientModal(p);
    });
  });
  document.querySelectorAll('[data-triage]').forEach((b) => {
    b.addEventListener('click', () => {
      location.href = 'triage.html?abha=' + encodeURIComponent(b.getAttribute('data-triage'));
    });
  });
  bindCallButtons();
}

function openPatientModal(p) {
  const modal = document.getElementById('patient-modal');
  if (!modal) return;
  document.getElementById('pmodal-name').textContent = p.name || '—';
  const age = ageFromDob(p.dob);
  document.getElementById('pmodal-body').innerHTML =
    '<p class="muted">' + (age == null ? '?' : age) + ' ' + t('unit.yrs') + ' · ' + genderLabel(p.gender) + '</p>' +
    '<table class="kv">' +
    (p.abha_id ? '<tr><td>ABHA</td><td>' + esc(p.abha_id) + '</td></tr>' : '') +
    (p.phone ? '<tr><td>' + t('lbl.phone') + '</td><td>' + esc(p.phone) + '</td></tr>' : '') +
    (p.family_id ? '<tr><td>' + t('lbl.family') + '</td><td>' + esc(p.family_id) + '</td></tr>' : '') +
    ((p.village || p.district || p.state) ? '<tr><td>' + t('lbl.village') + '</td><td>' + esc([p.village, p.district, p.state].filter(Boolean).join(', ')) + '</td></tr>' : '') +
    ((p.high_risk_category || []).length ? '<tr><td>' + t('reg.highrisk') + '</td><td>' + highRiskBadges(p) + '</td></tr>' : '') +
    ((p.allergies || []).length ? '<tr><td>' + t('reg.allergies') + '</td><td>' + esc(p.allergies.join(', ')) + '</td></tr>' : '') +
    (p.chronic_conditions ? '<tr><td>' + t('reg.chronic_conditions') + '</td><td>' + esc(p.chronic_conditions) + '</td></tr>' : '') +
    '</table>';
  document.getElementById('pmodal-call').onclick = () => showCallModal(p.name || '', p.phone);
  document.getElementById('pmodal-triage').onclick = () => {
    location.href = 'triage.html?abha=' + encodeURIComponent(p.abha_id || '');
  };
  modal.classList.add('open');
}

function initMyPatients() {
  const search = document.getElementById('mp-search');
  if (search) search.addEventListener('input', () => { myPatientsQuery = search.value; renderMyPatients(); });
  const filters = document.getElementById('mp-filters');
  if (filters) {
    filters.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      filters.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      myPatientsFilter = btn.getAttribute('data-filter');
      renderMyPatients();
    });
  }
  const pm = document.getElementById('patient-modal');
  if (pm) {
    document.getElementById('pmodal-close').addEventListener('click', () => pm.classList.remove('open'));
    pm.addEventListener('click', (e) => { if (e.target === pm) pm.classList.remove('open'); });
  }
  renderMyPatients();
}

/* ------------------------------------------------------------------ */
/* Create Referral (Feature 3)                                          */
/* ------------------------------------------------------------------ */
async function initReferralPage() {
  updateNetPill();
  const langSel = document.getElementById('lang-select');
  if (langSel) {
    langSel.addEventListener('change', () => {
      setLang(langSel.value);
      applyStaticI18n();
      updateNetPill();
      populateReferralPatients();
    });
  }
  initSOS();
  populateReferralPatients();

  const sel = document.getElementById('ref-facility');
  if (sel && isOnline()) {
    try {
      const facs = await apiFetch('/facilities');
      (facs || []).filter((f) =>
        f.facility_type === 'chc' || f.facility_type === 'district_hospital' || f.facility_type === 'phc')
        .forEach((f) => {
          const o = document.createElement('option');
          o.value = f.id;
          o.textContent = f.name + ' (' + f.facility_type + ')';
          sel.appendChild(o);
        });
    } catch (e) { /* offline: facility select stays empty */ }
  }

  const input = document.getElementById('ref-patient');
  if (input) input.addEventListener('input', showRefTriage);
  document.getElementById('ref-submit').addEventListener('click', submitReferral);
}

async function populateReferralPatients() {
  const dl = document.getElementById('ref-patient-list');
  if (!dl) return;
  const patients = (await db.getAllPatients()) || [];
  dl.innerHTML = patients.map((p) =>
    '<option value="' + esc(p.abha_id) + ' — ' + esc(p.name || '') + '"></option>').join('');
}

async function findRefPatient(value) {
  const v = (value || '').trim();
  const patients = (await db.getAllPatients()) || [];
  return patients.find((p) => p.abha_id === v || (p.name || '') === v || v.includes(p.abha_id)) || null;
}

async function showRefTriage() {
  const note = document.getElementById('ref-triage-note');
  if (!note) return;
  const p = await findRefPatient(document.getElementById('ref-patient').value);
  if (!p) { note.hidden = true; return; }
  const pending = (await db.getPending()) || [];
  const localTriage = pending.filter((r) => r.type === 'triage' && r.data && r.data.abha_id === p.abha_id);
  if (localTriage.length) {
    note.hidden = false;
    note.innerHTML = '🧾 ' + t('ref.triage_pending', [localTriage.length]);
    return;
  }
  if (p.id && isOnline()) {
    try {
      const fhir = await apiFetch('/patients/' + p.id + '/fhir');
      const obs = ((fhir && fhir.entry) || [])
        .filter((e) => e.resource && e.resource.resourceType === 'Observation')
        .sort((a, b) => String(b.resource.effectiveDateTime || '').localeCompare(String(a.resource.effectiveDateTime || '')));
      const latest = obs[0];
      if (latest && latest.resource.interpretation && latest.resource.interpretation[0]) {
        note.hidden = false;
        note.innerHTML = '🧾 ' + t('ref.triage_attached', [
          latest.resource.interpretation[0].text,
          String(latest.resource.effectiveDateTime || '').slice(0, 10),
        ]);
      } else { note.hidden = true; }
    } catch (e) { note.hidden = true; }
  } else {
    note.hidden = true;
  }
}

async function submitReferral() {
  const p = await findRefPatient(document.getElementById('ref-patient').value);
  if (!p) { toast(t('ref.need_patient'), 'warn'); return; }
  const priority = (document.querySelector('input[name="ref-priority"]:checked') || {}).value || 'routine';
  const toFacilityId = document.getElementById('ref-facility').value;
  if (!toFacilityId) { toast(t('ref.need_facility'), 'warn'); return; }
  const reason = document.getElementById('ref-reason').value;
  const notes = document.getElementById('ref-notes').value.trim();

  const data = {
    abha_id: p.abha_id,
    patient_id: p.id,
    priority: priority,
    reason: reason,
    notes: notes || undefined,
    to_facility_id: toFacilityId,
    asha_phone: (await getAshaPhone()) || undefined,
    created_at: utcNowIso(),
  };
  ['name', 'dob', 'gender', 'phone', 'village', 'district', 'state', 'pincode']
    .forEach((k) => { if (p[k]) data[k] = p[k]; });
  await db.enqueue({ type: 'referral', client_id: newClientId(), updated_at: utcNowIso(), data: data });

  const btn = document.getElementById('ref-submit');
  btn.disabled = true;
  let msg;
  let kind = 'ok';
  if (isOnline()) {
    try {
      await flushPending();
      msg = t('ref.sent_synced');
    } catch (e) { msg = t('ref.sent_queued'); kind = 'warn'; }
  } else {
    msg = t('ref.sent_queued');
    kind = 'warn';
  }
  toast(msg, kind);
  btn.disabled = false;
  document.getElementById('ref-notes').value = '';
  document.getElementById('ref-reason').selectedIndex = 0;
  document.getElementById('ref-facility').selectedIndex = 0;
  document.getElementById('ref-triage-note').hidden = true;
}

/* ------------------------------------------------------------------ */
/* Referral tracking (Feature 3)                                        */
/* ------------------------------------------------------------------ */
let trackFilter = 'all';
let currentServerRefs = [];
let currentLocalRefs = [];
let FACILITY_PHONE = {};

function statusLabel(s) {
  return t('track.s.' + (s || 'created'));
}

function priorityBadge(pr) {
  const cls = { routine: 'routine', urgent: 'urgent', emergency: 'emergency' }[pr] || 'routine';
  return '<span class="ref-priority ' + cls + '">' + esc(pr) + '</span>';
}

async function initTrackingPage() {
  updateNetPill();
  const langSel = document.getElementById('lang-select');
  if (langSel) {
    langSel.addEventListener('change', () => {
      setLang(langSel.value);
      applyStaticI18n();
      updateNetPill();
      loadReferrals();
    });
  }
  initSOS();
  const filters = document.getElementById('track-filters');
  if (filters) {
    filters.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      filters.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      trackFilter = btn.getAttribute('data-filter');
      renderReferrals();
    });
  }
  const rm = document.getElementById('ref-modal');
  if (rm) {
    document.getElementById('ref-modal-close').addEventListener('click', () => rm.classList.remove('open'));
    rm.addEventListener('click', (e) => { if (e.target === rm) rm.classList.remove('open'); });
  }
  if (isOnline()) {
    try {
      const facs = await apiFetch('/facilities');
      (facs || []).forEach((f) => { if (f.contact_phone) FACILITY_PHONE[f.id] = f.contact_phone; });
    } catch (e) { /* keep empty map */ }
  }
  loadReferrals();
  setInterval(loadReferrals, 30000);
}

async function loadReferrals() {
  const list = document.getElementById('track-list');
  if (!list) return;
  let server = [];
  if (isOnline()) {
    try { server = await apiFetch('/referrals'); } catch (e) { /* offline */ }
  }
  currentServerRefs = server;
  const pending = (await db.getPending()) || [];
  currentLocalRefs = pending.filter((r) => r.type === 'referral').map((r) => ({
    id: r.client_id,
    local: true,
    patient_name: (r.data && r.data.name) || null,
    reason: r.data && r.data.reason,
    priority: (r.data && r.data.priority) || 'routine',
    status: 'pending_sync',
    created_at: r.data && r.data.created_at,
    notes: r.data && r.data.notes,
  }));
  renderReferrals();
}

function renderReferrals() {
  const list = document.getElementById('track-list');
  if (!list) return;
  let rows = currentLocalRefs.concat(currentServerRefs);
  if (trackFilter !== 'all') rows = rows.filter((r) => r.status === trackFilter);
  if (!rows.length) { list.innerHTML = '<p class="muted">' + t('track.empty') + '</p>'; return; }
  list.innerHTML = rows.map(referralCard).join('');
  document.querySelectorAll('[data-refid]').forEach((b) => {
    b.addEventListener('click', () => openReferralModal(b.getAttribute('data-refid')));
  });
}

function referralCard(r) {
  const cls = String(r.status || 'created').replace('_', '-');
  return '<div class="mp-card">' +
    '<div class="mp-main"><b>' + esc(r.patient_name || '—') + '</b> ' +
    '<span class="ref-status ' + cls + '">' + esc(statusLabel(r.status)) + '</span>' +
    '<span class="muted">' + esc(r.reason || '') + '</span></div>' +
    '<div class="mp-meta">' + priorityBadge(r.priority) + ' · ' +
    esc(r.to_facility_name || t('track.to_phc')) + '</div>' +
    '<div class="mp-meta muted">' + (r.created_at ? fmtDT(r.created_at) : '') + '</div>' +
    (r.accepted_at ? '<div class="mp-meta">👨‍⚕️ ' + t('track.accepted_on', [fmtDT(r.accepted_at)]) + '</div>' : '') +
    '<div class="row mp-actions">' +
    '<button class="small" data-refid="' + esc(r.id) + '">' + t('track.details') + '</button>' +
    '</div></div>';
}

function openReferralModal(id) {
  const r = currentLocalRefs.concat(currentServerRefs).find((x) => x.id === id);
  if (!r) return;
  document.getElementById('ref-modal-body').innerHTML =
    '<table class="kv">' +
    '<tr><td>' + t('ref.patient') + '</td><td>' + esc(r.patient_name || '—') + '</td></tr>' +
    '<tr><td>' + t('ref.reason') + '</td><td>' + esc(r.reason || '—') + '</td></tr>' +
    '<tr><td>' + t('ref.priority') + '</td><td>' + priorityBadge(r.priority) + '</td></tr>' +
    '<tr><td>' + t('track.status') + '</td><td>' + esc(statusLabel(r.status)) + '</td></tr>' +
    '<tr><td>' + t('ref.facility') + '</td><td>' + esc(r.to_facility_name || t('track.to_phc')) + '</td></tr>' +
    '<tr><td>' + t('th.created') + '</td><td>' + (r.created_at ? fmtDT(r.created_at) : '—') + '</td></tr>' +
    (r.accepted_at ? '<tr><td>' + t('track.accepted') + '</td><td>' + fmtDT(r.accepted_at) + '</td></tr>' : '') +
    (r.completed_at ? '<tr><td>' + t('track.completed') + '</td><td>' + fmtDT(r.completed_at) + '</td></tr>' : '') +
    (r.notes ? '<tr><td>' + t('ref.notes') + '</td><td>' + esc(r.notes) + '</td></tr>' : '') +
    '</table>';
  const callBtn = document.getElementById('ref-modal-call');
  const phone = r.to_facility_id && FACILITY_PHONE[r.to_facility_id];
  callBtn.hidden = !phone;
  callBtn.onclick = () => showCallModal(r.to_facility_name || t('track.contact'), phone);
  document.getElementById('ref-modal').classList.add('open');
}

/* ------------------------------------------------------------------ */
/* Call modal — tel: links do nothing on desktop, so every call button  */
/* opens a modal showing the number with Dial + Copy actions.            */
/* ------------------------------------------------------------------ */
function showCallModal(label, phone) {
  if (!phone) { toast(t('call.no_number'), 'warn'); return; }
  const old = document.getElementById('call-modal');
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.id = 'call-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal call-modal">' +
    '<h2 style="margin-top:0">📞 ' + t('call.title') + '</h2>' +
    '<p class="muted" id="call-modal-label"></p>' +
    '<div class="call-number" id="call-modal-number"></div>' +
    '<div class="row">' +
    '<a id="call-modal-dial" class="btn-link" href="#" style="text-align:center">📞 ' + t('call.dial') + '</a>' +
    '<button id="call-modal-copy" class="secondary" style="margin:0">📋 ' + t('call.copy') + '</button>' +
    '</div>' +
    '<button id="call-modal-close" class="secondary">' + t('btn.close') + '</button>' +
    '</div>';
  document.body.appendChild(overlay);
  document.getElementById('call-modal-label').textContent = label || '';
  document.getElementById('call-modal-number').textContent = phone;
  document.getElementById('call-modal-dial').href = 'tel:' + phone;
  document.getElementById('call-modal-dial').addEventListener('click', (e) => {
    e.preventDefault();
    location.href = 'tel:' + phone;
  });
  document.getElementById('call-modal-copy').addEventListener('click', async () => {
    const n = document.getElementById('call-modal-number').textContent;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(n);
      } else {
        const ta = document.createElement('textarea');
        ta.value = n;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast(t('call.copied'), 'ok');
    } catch (err) { toast(t('call.copy_fail'), 'error'); }
  });
  document.getElementById('call-modal-close').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
  overlay.classList.add('open');
}

function bindCallButtons(scope) {
  (scope || document).querySelectorAll('[data-call]').forEach((b) => {
    b.addEventListener('click', () =>
      showCallModal(b.getAttribute('data-call-label') || '', b.getAttribute('data-call')));
  });
}

/* ASHA worker's own phone — captured once on the Sync page and attached to
 * every referral/SOS record so the backend can SMS them on status changes. */
async function getAshaPhone() {
  const s = await db.getSetting('asha_phone');
  return (s && s.value) || '';
}

async function initAshaPhone() {
  const input = document.getElementById('asha-phone');
  if (!input) return;
  input.value = await getAshaPhone();
  const save = document.getElementById('asha-phone-save');
  if (save) {
    save.addEventListener('click', async () => {
      const v = input.value.trim();
      if (v && !/^(\+91[\s-]?)?[6-9]\d{9}$/.test(v)) { toast(t('t.phone_invalid'), 'warn'); return; }
      await db.setSetting('asha_phone', v);
      toast(v ? t('asha_phone.saved') : t('asha_phone.cleared'), 'ok');
    });
  }
}

/* ------------------------------------------------------------------ */
/* Emergency SOS (Feature 5)                                            */
/* ------------------------------------------------------------------ */
let sosType = null;
let PHC_PHONE = null;

async function loadPhcPhone() {
  if (PHC_PHONE) return PHC_PHONE;
  try {
    const facs = await apiFetch('/facilities');
    const phc = (facs || []).find((f) => f.facility_type === 'phc') || (facs || [])[0];
    PHC_PHONE = (phc && phc.contact_phone) || null;
  } catch (e) { PHC_PHONE = null; }
  return PHC_PHONE;
}

function initSOS() {
  const btn = document.getElementById('sos-btn');
  if (!btn) return;
  btn.addEventListener('click', openSOS);
  document.getElementById('sos-cancel').addEventListener('click', closeSOS);
  document.getElementById('sos-send').addEventListener('click', () => {
    document.getElementById('sos-confirm').hidden = false;
  });
  document.getElementById('sos-confirm-no').addEventListener('click', () => {
    document.getElementById('sos-confirm').hidden = true;
  });
  document.getElementById('sos-confirm-yes').addEventListener('click', sendSOSAlert);
  const modal = document.getElementById('sos-modal');
  modal.addEventListener('click', (e) => { if (e.target === modal) closeSOS(); });
  document.querySelectorAll('.sos-type').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.sos-type').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      sosType = b.getAttribute('data-type');
    });
  });
  populateSOSPatients();
  loadPhcPhone();
}

async function populateSOSPatients() {
  const sel = document.getElementById('sos-patient');
  if (!sel) return;
  const patients = (await db.getAllPatients()) || [];
  sel.innerHTML = '<option value="">' + t('sos.select_patient') + '</option>' +
    patients.map((p) =>
      '<option value="' + esc(p.abha_id) + '">' + esc(p.name || p.abha_id) + '</option>').join('');
}

async function openSOS() {
  sosType = null;
  document.querySelectorAll('.sos-type').forEach((x) => x.classList.remove('active'));
  document.getElementById('sos-details').value = '';
  document.getElementById('sos-confirm').hidden = true;
  document.getElementById('sos-result').hidden = true;
  document.getElementById('sos-send').disabled = false;
  document.getElementById('sos-cancel').textContent = t('btn.close');
  await populateSOSPatients();
  const loc = document.getElementById('sos-location');
  loc.value = '';
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => { loc.value = pos.coords.latitude.toFixed(5) + ', ' + pos.coords.longitude.toFixed(5); },
      () => { /* GPS unavailable — leave blank */ }
    );
  }
  document.getElementById('sos-modal').classList.add('open');
}

function closeSOS() {
  document.getElementById('sos-modal').classList.remove('open');
}

async function sendSOSAlert() {
  const abha = document.getElementById('sos-patient').value;
  if (!abha) { toast(t('sos.need_patient'), 'warn'); return; }
  if (!sosType) { toast(t('sos.need_type'), 'warn'); return; }
  const p = await db.getPatient(abha);
  const location = document.getElementById('sos-location').value.trim();
  const details = document.getElementById('sos-details').value.trim();
  const data = {
    abha_id: abha,
    priority: 'emergency',
    reason: t('sos.t.' + sosType) + (details ? ' — ' + details : '') + (location ? ' @ ' + location : ''),
    to_facility_id: undefined,
    asha_phone: (await getAshaPhone()) || undefined,
    created_at: utcNowIso(),
  };
  if (p) {
    ['name', 'dob', 'gender', 'phone', 'village', 'district', 'state', 'pincode']
      .forEach((k) => { if (p[k]) data[k] = p[k]; });
  }
  await db.enqueue({ type: 'referral', client_id: newClientId(), updated_at: utcNowIso(), data: data });

  let synced = false;
  if (isOnline()) {
    try { await flushPending(); synced = true; } catch (e) { /* stays queued */ }
  }
  // Alert the PHC by SMS through the server message queue (offline-aware)
  const phcPhone = await loadPhcPhone();
  if (phcPhone && isOnline()) {
    try {
      await apiFetch('/messages', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: p && p.id ? p.id : null,
          recipient_name: 'PHC Duty Doctor',
          recipient_phone: phcPhone,
          message_text: 'EMERGENCY: ' + (p ? p.name : abha) + ' needs immediate care. Type: ' +
            t('sos.t.' + sosType) + (location ? '. Location: ' + location : '') + ' — GramArogya',
          channel: 'sms',
        }),
      });
    } catch (e) { /* message queued on next sync */ }
  }

  const result = document.getElementById('sos-result');
  result.hidden = false;
  result.innerHTML =
    '<b>🚨 ' + t('sos.sent') + '</b>' +
    '<p>' + (synced ? t('sos.synced') : t('sos.queued')) + '</p>' +
    '<p>🚑 ' + t('sos.eta') + '</p>' +
    (phcPhone ? '<button class="btn-link" data-call="' + esc(phcPhone) + '" data-call-label="' + t('sos.call_phc') + '">📞 ' + t('sos.call_phc') + '</button>' : '') +
    (p && p.phone ? ' <button class="btn-link" data-call="' + esc(p.phone) + '" data-call-label="' + t('sos.call_patient') + '">📞 ' + t('sos.call_patient') + '</button>' : '');
  bindCallButtons(result);
  document.getElementById('sos-confirm').hidden = true;
  document.getElementById('sos-send').disabled = true;
}

/* ------------------------------------------------------------------ */
/* Page initializers                                                    */
/* ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  applyStaticI18n();
  if (PAGE === 'index') initIndexPage();
  if (PAGE === 'triage') initTriagePage();
  if (PAGE === 'tasks') initTasksPage();
  if (PAGE === 'sync') initSyncPage();
  if (PAGE === 'referral') initReferralPage();
  if (PAGE === 'tracking') initTrackingPage();

  // Auto-sync queued records when the network comes back
  window.addEventListener('online', () => {
    if (isOnline()) {
      toast(t('sync.auto_sync'), 'info');
      flushPending().catch(() => {});
    }
  });
});
