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
    'type.referral': 'referral',
    'type.followup': 'follow-up',
    'type.teleconsult': 'teleconsult',

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
    'type.referral': 'रिफ़रल',
    'type.followup': 'फ़ॉलो-अप',
    'type.teleconsult': 'टेलीकंसल्ट',
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
    'type.referral': 'रेफरल',
    'type.followup': 'फॉलो-अप',
    'type.teleconsult': 'टेलिकन्सल्ट',
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
    'type.referral': 'রেফারেল',
    'type.followup': 'ফলো-আপ',
    'type.teleconsult': 'টেলিকনসাল্ট',
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
  const dict = I18N[currentLang()] || I18N.en;
  let s = dict[key] !== undefined ? dict[key] : (I18N.en[key] !== undefined ? I18N.en[key] : key);
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
const SYMPTOM_ORDER = RED_SYMPTOMS.concat(YELLOW_SYMPTOMS, MODERATE_SYMPTOMS);

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
async function flushPending() {
  const pending = await db.getPending();
  if (!pending.length) return { synced: 0, results: [] };

  const deviceSetting = await db.getSetting('device_id');
  const deviceId = (deviceSetting && deviceSetting.value) || 'asha-demo-device';
  const res = await apiFetch('/sync', {
    method: 'POST',
    body: JSON.stringify({ records: pending, device_id: deviceId }),
  });

  for (const rec of pending) {
    const r = res.results.find((x) => x.client_id === rec.client_id);
    if (r && r.status !== 'skipped') {
      await db.removePending(rec.client_id);
    }
  }
  await db.setSetting('last_sync_at', new Date().toISOString());
  return res;
}

async function dispatchMessages() {
  if (!isOnline()) return null;
  return apiFetch('/messages/dispatch', { method: 'POST' });
}

async function fullSync() {
  const syncRes = await flushPending();
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
    (PAGE === 'index' ? '<button id="tele-btn" class="secondary" style="width:100%;margin-top:10px">📞 ' + t('btn.tele') + '</button>' : '');
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

function updateRegModeUI() {
  const createMode = regMode() === 'no';
  const existingBox = document.getElementById('abha-existing-box');
  const createBox = document.getElementById('abha-create-box');
  const btn = document.getElementById('register-btn');
  if (existingBox) existingBox.hidden = createMode;
  if (createBox) createBox.hidden = !createMode;
  if (btn) btn.textContent = t(createMode ? 'btn.create' : 'btn.save');
  document.querySelectorAll('.seg-btn').forEach((lb) => {
    const rb = lb.querySelector('input');
    if (rb) lb.classList.toggle('active', rb.checked);
  });
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
}

function initIndexPage() {
  updateNetPill();
  updateRegModeUI();

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

    // Required-field labels (localized) for the validation message
    const fieldKeys = {
      abha: 'lbl.abha', name: 'lbl.name', dob: 'lbl.dob', phone: 'lbl.phone',
      village: 'lbl.village', district: 'lbl.district', state: 'lbl.state', pincode: 'lbl.pincode',
    };
    const missing = [];
    if (mode === 'yes') { if (!val('np-abha')) missing.push('abha'); }
    else if (!dob) missing.push('dob');
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

    let abha;
    let created = false;
    if (mode === 'yes') {
      abha = val('np-abha');
      if (!/^\d{14}$/.test(abha)) {
        toast(t('t.valid_abha'), 'warn');
        return;
      }
    } else {
      abha = await generateFakeAbhaId();
      created = true;
    }

    // Guard: the same ABHA already exists on this device -> show it instead
    const existing = await db.getPatient(abha);
    if (existing) {
      renderPatientCard(existing, 'patient-result');
      toast(t('t.dup_local'), 'warn');
      return;
    }

    const patient = {
      abha_id: abha,
      name: name,
      dob: dob || '2000-01-01',
      gender: document.getElementById('np-gender').value,
      phone: phone,
      village: village,
      district: district,
      state: state,
      pincode: pincode,
      family_id: familyId || undefined,
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
  buildSymptomGrid();

  const langSel = document.getElementById('lang-select');
  if (langSel) {
    langSel.addEventListener('change', () => {
      setLang(langSel.value);
      applyStaticI18n();
      updateNetPill();
      buildSymptomGrid();
      if (lastTriageData) {
        const rerun = localTriage(lastTriageData.symptoms, lastTriageData.vitals);
        renderTriageResult(rerun);
        if (rerun.color === 'RED') renderEmergencyPanel();
      }
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
  const langSel = document.getElementById('lang-select');
  if (langSel) {
    langSel.addEventListener('change', () => {
      setLang(langSel.value);
      applyStaticI18n();
      updateNetPill();
      renderTasksMarkup();
    });
  }
  loadTasks();
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

function taskRow(task) {
  const done = task.status === 'completed';
  const urgent = task.priority === 'urgent' || task.priority === 'emergency';
  return '<div class="task-row' + (urgent ? ' urgent' : '') + (done ? ' done' : '') + '">' +
    '<div class="task-main"><b>' + esc(task.patient_name || '\u2014') + '</b>' +
    '<span class="muted">' + esc(task.task || catLabel(task.category)) + ' \u00b7 ' +
    t('tasks.due', [esc(String(task.due_date || ''))]) + '</span>' +
    (task.village ? '<span class="muted">\ud83d\udccd ' + esc(task.village) + '</span>' : '') +
    '</div>' +
    (done
      ? '<span class="task-status ok">' + t('tasks.stat.completed') + '</span>'
      : '<button class="small" data-done="' + task.id + '">' + t('tasks.mark_done') + '</button>') +
    '</div>';
}

function bindTaskButtons() {
  document.querySelectorAll('[data-done]').forEach((btn) => {
    btn.addEventListener('click', () => markFollowUpDone(btn.getAttribute('data-done')));
  });
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
  const toggle = document.getElementById('network-toggle');
  toggle.checked = isOnline();
  updateNetworkUI();

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

  const summary = document.getElementById('pending-summary');
  const tbody = document.getElementById('pending-body');
  if (!pending.length) {
    summary.textContent = t('summary.empty');
    tbody.innerHTML = '';
  } else {
    summary.textContent = t('summary.pending', [
      pending.length,
      Object.entries(byType).map(([type, n]) => t('type.' + type) + ' \u00d7 ' + n).join(', '),
    ]);
    tbody.innerHTML = pending.map((r) =>
      '<tr><td><span class="badge ' + r.type + '">' + t('type.' + r.type) + '</span></td>' +
      '<td>' + new Date(r.updated_at).toLocaleTimeString() + '</td>' +
      '<td class="muted">' + t('status.queued') + '</td></tr>'
    ).join('');
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
  try {
    const { syncRes, msgRes } = await fullSync();
    const created = syncRes ? (syncRes.counts.created || 0) : 0;
    const updated = syncRes ? (syncRes.counts.updated || 0) : 0;
    const sent = msgRes ? msgRes.sent : 0;
    toast(t('t.sync_done', [created, updated, sent]), 'ok');
    const log = document.getElementById('dispatch-log');
    if (log && msgRes && msgRes.log && msgRes.log.length) {
      log.innerHTML = msgRes.log.map((l) => '<div>\ud83d\udce8 ' + l + '</div>').join('');
    }
  } catch (e) {
    toast(t('t.sync_fail', [e.message]), 'error');
  }
  await renderSyncPage();
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
});
