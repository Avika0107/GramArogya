/* ==========================================================================
   GramArogya — Connectivity Portal (login + registration SPA)

   Vanilla JS, zero dependencies — deliberately no build step, so it runs
   on any low-cost Android phone's browser, works over 2G, and even works
   offline (the whole flow is mock/local).

   Design decisions for ASHA-worker phone optimization:
     1. Single page, no routing library — view switching is just
        show/hide on <section>s, so nothing re-fetches on navigation.
     2. input font-size 16px+ prevents iOS auto-zoom on focus.
     3. Every interactive element is >= 44px tall and full-width.
     4. The role selector uses four big tappable cards at the top —
        visible without scrolling on a 360px-wide phone.
     5. OTP flow is inline (no page change) and mock — the code is shown
        in the UI because there is no real SMS gateway in the prototype.
     6. Datalists (not JS dropdown libs) power the searchable PHC field:
        zero JS cost, native keyboard support.
     7. Geolocation auto-detect fills the nearest PHC with one tap, for
        workers who don't know the facility's official name.
     8. State (role, typed fields) lives in the DOM + localStorage, so
        switching Login <-> Register never loses what the user typed.
   ========================================================================== */
'use strict';

/* --------------------------------------------------------------------------
   Mock data (stand-ins for the real API until auth is wired to the backend)
   -------------------------------------------------------------------------- */
const STATES = [
  'Bihar', 'Jharkhand', 'Uttar Pradesh', 'Madhya Pradesh', 'Rajasthan',
  'Maharashtra', 'West Bengal', 'Odisha', 'Chhattisgarh', 'Gujarat',
  'Punjab', 'Haryana', 'Uttarakhand', 'Himachal Pradesh', 'Assam', 'Tamil Nadu',
  'Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana', 'Delhi', 'Other',
];

const DISTRICTS = [
  'Nalanda', 'Patna', 'Gaya', 'Jehanabad', 'Nawada', 'Sheikhpura',
  'Lakhisarai', 'Vaishali', 'Bhojpur', 'Rohtas', 'Saran', 'Muzaffarpur',
];

const COUNCILS = [
  'NMC (National Medical Commission)',
  'Bihar Medical Council',
  'Uttar Pradesh Medical Council',
  'Madhya Pradesh Medical Council',
  'Maharashtra Medical Council',
  'West Bengal Medical Council',
  'Other State Medical Council',
];

const SPECIALIZATIONS = [
  'General Medicine', 'General Surgery', 'Pediatrics', 'Gynecology & Obstetrics',
  'Orthopedics', 'ENT', 'Ophthalmology', 'Dermatology', 'Psychiatry',
  'Family Medicine', 'Public Health', 'Radiology', 'Anesthesiology',
];

/* Mock PHC directory — lat/lng let us "auto-detect" the nearest facility. */
const PHCS = [
  { id: 'phc-sanda',    name: 'PHC Sanda',         district: 'Nalanda',    lat: 25.32, lng: 85.55 },
  { id: 'phc-hilsa',    name: 'PHC Hilsa',         district: 'Nalanda',    lat: 25.28, lng: 85.42 },
  { id: 'phc-ekangar',  name: 'PHC Ekangarsarai',  district: 'Nalanda',    lat: 25.27, lng: 85.33 },
  { id: 'chc-rajgir',   name: 'CHC Rajgir',        district: 'Nalanda',    lat: 25.02, lng: 85.42 },
  { id: 'phc-silao',    name: 'PHC Silao',         district: 'Nalanda',    lat: 25.08, lng: 85.42 },
  { id: 'phc-biharshf', name: 'PHC Biharsharif',   district: 'Nalanda',    lat: 25.20, lng: 85.52 },
  { id: 'phc-danapur',  name: 'PHC Danapur',       district: 'Patna',      lat: 25.62, lng: 85.05 },
  { id: 'chc-patna',    name: 'CHC Patna City',    district: 'Patna',      lat: 25.59, lng: 85.18 },
  { id: 'phc-gaya',     name: 'PHC Gaya',          district: 'Gaya',       lat: 24.80, lng: 85.00 },
  { id: 'phc-jhnabad',  name: 'PHC Jehanabad',     district: 'Jehanabad',  lat: 25.21, lng: 84.99 },
];

/* Demo users for the mock login. Real auth would hit /api/v1/auth. */
const DEMO_USERS = {
  asha:   { name: 'Sunita Devi',      phone: '9876543210', pass: 'demo@1234' },
  doctor: { name: 'Dr. Rajesh Kumar', phone: '9123456780', pass: 'demo@1234' },
  admin:  { name: 'Anita Sharma',     phone: '9000000001', pass: 'demo@1234' },
  lab:    { name: 'Ramesh Yadav',     phone: '9111111111', pass: 'demo@1234' },
};

/* Role display names live in the I18N dictionary ('role.asha', 'role.doctor',
   ...) so they translate everywhere they appear (demo hint, welcome messages).
   -------------------------------------------------------------------------- */
/* --------------------------------------------------------------------------
   i18n — English (default), Hindi, Marathi, Bengali.
   Uses the same localStorage key as the ASHA Worker app ('gramarogya_lang'),
   so a language chosen on any GramArogya page applies across the whole suite.
   -------------------------------------------------------------------------- */
const LANGS = ['en', 'hi', 'mr', 'bn'];
const LANG_KEY = 'gramarogya_lang';

const I18N = {
  en: {
    'title.portal': 'GramArogya — Connectivity Portal',
    'brand.tagline': 'Healthcare Connectivity Portal',
    'nav.home_aria': 'Back to main site',
    'footer.text': 'GramArogya · Smart India Hackathon prototype · <a href="/" class="link">Back to main site</a>',
    'role.asha': 'ASHA Worker',
    'role.doctor': 'Doctor',
    'role.admin': 'Admin',
    'role.lab': 'Lab Technician',
    'tabs.login_aria': 'Choose your role',
    'tabs.register_aria': 'Register as',
    'login.title': 'Sign in to GramArogya',
    'login.user': 'Phone number or username',
    'login.user_ph': 'e.g. 9876543210',
    'login.pass': 'Password',
    'login.show_pass': 'Show password',
    'login.hide_pass': 'Hide password',
    'login.remember': 'Remember my role',
    'login.forgot': 'Forgot password?',
    'login.btn': 'Sign in',
    'login.new_user': 'New user?',
    'login.register_here': 'Register here',
    'login.welcome': 'Welcome, {0}! You are signed in as {1}.',
    'login.continue_to': 'Continue to {0} portal',
    'reg.title': 'Create an account',
    'reg.asha_heading': 'ASHA Worker registration',
    'reg.doctor_heading': 'Doctor registration',
    'reg.admin_heading': 'Admin registration',
    'reg.lab_heading': 'Lab Technician registration',
    'reg.doctor_notice': '⏳ Registrations need <b>admin approval</b> before you can sign in.',
    'reg.asha_submit': 'Create ASHA Worker account',
    'reg.doctor_submit': 'Submit for approval',
    'reg.admin_submit': 'Create admin account',
    'reg.lab_submit': 'Create lab account',
    'reg.verify_first': 'Please verify your phone number with OTP first.',
    'reg.msg_doctor': 'Thank you, {0}! Your doctor registration has been submitted. An admin will review and approve it — you can sign in once approved.',
    'reg.msg_asha': 'Welcome, {0}! Your ASHA Worker account has been created. You can sign in now.',
    'reg.msg_other': 'Welcome, {0}! Your {1} account has been created. You can sign in now.',
    'reg.go_signin': 'Go to sign in',
    'form.required_note': 'Fields marked <span class="req">*</span> are required.',
    'form.already': 'Already registered?',
    'lbl.full_name': 'Full Name',
    'lbl.phone': 'Phone Number',
    'lbl.email': 'Email',
    'lbl.address': 'Address',
    'lbl.village': 'Village / Ward',
    'lbl.block': 'Block',
    'lbl.district': 'District',
    'lbl.state': 'State',
    'lbl.select_state': 'Select state',
    'lbl.pincode': 'PIN code',
    'lbl.asha_id': 'ASHA ID / Registration Number',
    'lbl.nearest_phc': 'Nearest PHC',
    'lbl.dob': 'Date of Birth',
    'lbl.set_pass': 'Set Password',
    'lbl.confirm_pass': 'Confirm Password',
    'lbl.reg_no': 'Medical Registration Number',
    'lbl.council': 'Council Name',
    'lbl.select_council': 'Select council',
    'lbl.spec': 'Specialization',
    'lbl.select_spec': 'Select specialization',
    'lbl.phc_hospital': 'Assigned PHC / Hospital',
    'lbl.phc_lab': 'Assigned PHC / Lab',
    'lbl.exp': 'Years of Experience',
    'lbl.emp_id': 'Employee ID',
    'lbl.jurisdiction': 'Department / Jurisdiction',
    'lbl.select_level': 'Select level',
    'lbl.jur_name': 'Jurisdiction name',
    'lbl.access_level': 'Admin Access Level',
    'lbl.cert_no': 'Lab Certification Number',
    'ph.asha_id': 'e.g. 1012345678',
    'ph.phc': 'Search or pick a PHC',
    'ph.facility': 'Search or pick a facility',
    'jur.district': 'District',
    'jur.block': 'Block',
    'jur.phc': 'PHC',
    'level.super': 'Super Admin',
    'level.district_admin': 'District Admin',
    'level.block_admin': 'Block Admin',
    'otp.send': 'Send OTP',
    'otp.verify': 'Verify',
    'otp.enter_label': 'Enter the 6-digit OTP sent to your phone',
    'otp.enter_err': 'Enter the 6-digit OTP.',
    'otp.verified': '✅ Phone verified.',
    'otp.demo_sms': 'Demo SMS sent to {0} — OTP is {1}',
    'phc.auto_detect': '📍 Auto-detect',
    'phc.no_geo': 'Location not available on this device — please pick your PHC from the list.',
    'phc.detected': '📍 Nearest facility detected: {0}',
    'phc.detect_fail': 'Could not detect location. Please search and pick your PHC manually.',
    'forgot.title': 'Reset your password',
    'forgot.phone': 'Registered phone number',
    'forgot.new_pass': 'New Password',
    'forgot.confirm_pass': 'Confirm New Password',
    'forgot.submit': 'Reset password',
    'forgot.remembered': 'Remembered it?',
    'forgot.back': 'Back to sign in',
    'forgot.verified': '✅ Verified. Now set your new password.',
    'forgot.updated': 'Password updated. Please sign in with your new password.',
    'success.title': 'Success!',
    'success.continue': 'Continue',
    'net.offline': 'You are offline. The portal still works — forms are saved and will sync when you are back online.',
    'net.slow': 'Low connectivity — this page is lightweight and works on slow networks.',
    'load.sending': 'Sending…',
    'load.verifying': 'Verifying…',
    'load.detecting': 'Detecting…',
    'load.signing': 'Signing in…',
    'load.submitting': 'Submitting…',
    'load.resetting': 'Resetting…',
    'strength.weak': 'Weak password',
    'strength.mid': 'Okay password',
    'strength.strong': 'Strong password',
    'rule.required': 'This field is required.',
    'rule.name': 'Name can contain only letters, spaces, dots, apostrophes and hyphens.',
    'rule.phone': 'Enter a valid 10-digit mobile number.',
    'rule.email': 'Enter a valid email address.',
    'rule.pincode': 'Enter a valid 6-digit PIN code.',
    'rule.asha_id': 'Enter a valid ASHA ID (6+ letters/digits).',
    'rule.reg_no': 'Enter a valid registration number.',
    'rule.emp_id': 'Enter a valid employee ID.',
    'rule.cert_no': 'Enter a valid certification number.',
    'rule.dob_age': 'You must be at least 18 years old.',
    'rule.dob_check': 'Please check the date of birth.',
    'rule.exp_range': 'Enter years between 0 and 60.',
    'rule.pass_set': 'Set a password.',
    'rule.pass_len': 'Password must be at least 8 characters.',
    'rule.pass_mix': 'Use both letters and numbers.',
    'rule.confirm_req': 'Confirm your password.',
    'rule.confirm_match': 'Passwords do not match.',
    'rule.radio': 'Please select an option.',
    'err.otp_expired': 'OTP expired. Please request a new one.',
    'err.otp_wrong': 'Incorrect OTP. Please try again.',
    'err.dup_phone': 'An account with this phone number already exists.',
    'err.no_account': 'No account found for this phone number.',
    'err.pending_approval': 'Your registration is awaiting admin approval. Please try again later.',
    'err.bad_login': 'Invalid phone number or password.',
    'demo.title': 'Demo {0} login',
    'demo.phone': 'Phone:',
    'demo.pass': 'Password:',
    'demo.tap_fill': 'tap to fill',
    'pw.show': 'Show password',
    'pw.hide': 'Hide password',
  },

  hi: {
    'title.portal': 'ग्रामआरोग्य — कनेक्टिविटी पोर्टल',
    'brand.tagline': 'स्वास्थ्य सेवा कनेक्टिविटी पोर्टल',
    'nav.home_aria': 'मुख्य साइट पर वापस जाएँ',
    'footer.text': 'ग्रामआरोग्य · स्मार्ट इंडिया हैकाथॉन प्रोटोटाइप · <a href="/" class="link">मुख्य साइट पर वापस जाएँ</a>',
    'role.asha': 'आशा कार्यकर्ता',
    'role.doctor': 'डॉक्टर',
    'role.admin': 'प्रशासक',
    'role.lab': 'लैब तकनीशियन',
    'tabs.login_aria': 'अपनी भूमिका चुनें',
    'tabs.register_aria': 'इस रूप में पंजीकरण करें',
    'login.title': 'ग्रामआरोग्य में साइन इन करें',
    'login.user': 'फ़ोन नंबर या उपयोगकर्ता नाम',
    'login.user_ph': 'जैसे 9876543210',
    'login.pass': 'पासवर्ड',
    'login.show_pass': 'पासवर्ड दिखाएँ',
    'login.hide_pass': 'पासवर्ड छिपाएँ',
    'login.remember': 'मेरी भूमिका याद रखें',
    'login.forgot': 'पासवर्ड भूल गए?',
    'login.btn': 'साइन इन करें',
    'login.new_user': 'नए उपयोगकर्ता?',
    'login.register_here': 'यहाँ पंजीकरण करें',
    'login.welcome': 'स्वागत है, {0}! आप {1} के रूप में साइन इन हैं।',
    'login.continue_to': '{0} पोर्टल पर जारी रखें',
    'reg.title': 'खाता बनाएँ',
    'reg.asha_heading': 'आशा कार्यकर्ता पंजीकरण',
    'reg.doctor_heading': 'डॉक्टर पंजीकरण',
    'reg.admin_heading': 'प्रशासक पंजीकरण',
    'reg.lab_heading': 'लैब तकनीशियन पंजीकरण',
    'reg.doctor_notice': '⏳ साइन इन करने से पहले पंजीकरण को <b>प्रशासक की मंज़ूरी</b> चाहिए।',
    'reg.asha_submit': 'आशा कार्यकर्ता खाता बनाएँ',
    'reg.doctor_submit': 'मंज़ूरी के लिए भेजें',
    'reg.admin_submit': 'प्रशासक खाता बनाएँ',
    'reg.lab_submit': 'लैब खाता बनाएँ',
    'reg.verify_first': 'कृपया पहले OTP से अपना फ़ोन नंबर सत्यापित करें।',
    'reg.msg_doctor': 'धन्यवाद, {0}! आपका डॉक्टर पंजीकरण भेज दिया गया है। एक प्रशासक इसकी समीक्षा कर मंज़ूरी देगा — मंज़ूरी मिलने पर आप साइन इन कर सकते हैं।',
    'reg.msg_asha': 'स्वागत है, {0}! आपका आशा कार्यकर्ता खाता बन गया है। आप अभी साइन इन कर सकते हैं।',
    'reg.msg_other': 'स्वागत है, {0}! आपका {1} खाता बन गया है। आप अभी साइन इन कर सकते हैं।',
    'reg.go_signin': 'साइन इन पर जाएँ',
    'form.required_note': '<span class="req">*</span> से चिह्नित फ़ील्ड आवश्यक हैं।',
    'form.already': 'पहले से पंजीकृत?',
    'lbl.full_name': 'पूरा नाम',
    'lbl.phone': 'फ़ोन नंबर',
    'lbl.email': 'ईमेल',
    'lbl.address': 'पता',
    'lbl.village': 'गाँव / वार्ड',
    'lbl.block': 'प्रखंड',
    'lbl.district': 'ज़िला',
    'lbl.state': 'राज्य',
    'lbl.select_state': 'राज्य चुनें',
    'lbl.pincode': 'पिन कोड',
    'lbl.asha_id': 'आशा ID / पंजीकरण संख्या',
    'lbl.nearest_phc': 'निकटतम PHC',
    'lbl.dob': 'जन्म तिथि',
    'lbl.set_pass': 'पासवर्ड सेट करें',
    'lbl.confirm_pass': 'पासवर्ड की पुष्टि करें',
    'lbl.reg_no': 'मेडिकल पंजीकरण संख्या',
    'lbl.council': 'परिषद का नाम',
    'lbl.select_council': 'परिषद चुनें',
    'lbl.spec': 'विशेषज्ञता',
    'lbl.select_spec': 'विशेषज्ञता चुनें',
    'lbl.phc_hospital': 'नियुक्त PHC / अस्पताल',
    'lbl.phc_lab': 'नियुक्त PHC / लैब',
    'lbl.exp': 'अनुभव के वर्ष',
    'lbl.emp_id': 'कर्मचारी ID',
    'lbl.jurisdiction': 'विभाग / अधिकार क्षेत्र',
    'lbl.select_level': 'स्तर चुनें',
    'lbl.jur_name': 'अधिकार क्षेत्र का नाम',
    'lbl.access_level': 'प्रशासक पहुँच स्तर',
    'lbl.cert_no': 'लैब प्रमाणन संख्या',
    'ph.asha_id': 'जैसे 1012345678',
    'ph.phc': 'PHC खोजें या चुनें',
    'ph.facility': 'सुविधा खोजें या चुनें',
    'jur.district': 'ज़िला',
    'jur.block': 'प्रखंड',
    'jur.phc': 'PHC',
    'level.super': 'सुपर एडमिन',
    'level.district_admin': 'जिला एडमिन',
    'level.block_admin': 'प्रखंड एडमिन',
    'otp.send': 'OTP भेजें',
    'otp.verify': 'सत्यापित करें',
    'otp.enter_label': 'आपके फ़ोन पर भेजा गया 6-अंकीय OTP दर्ज करें',
    'otp.enter_err': '6-अंकीय OTP दर्ज करें।',
    'otp.verified': '✅ फ़ोन सत्यापित।',
    'otp.demo_sms': 'डेमो SMS {0} पर भेजा गया — OTP है {1}',
    'phc.auto_detect': '📍 स्वतः पता लगाएँ',
    'phc.no_geo': 'इस डिवाइस पर स्थान उपलब्ध नहीं है — कृपया सूची से अपना PHC चुनें।',
    'phc.detected': '📍 निकटतम सुविधा मिली: {0}',
    'phc.detect_fail': 'स्थान का पता नहीं चल सका। कृपया खोजकर अपना PHC मैन्युअली चुनें।',
    'forgot.title': 'अपना पासवर्ड रीसेट करें',
    'forgot.phone': 'पंजीकृत फ़ोन नंबर',
    'forgot.new_pass': 'नया पासवर्ड',
    'forgot.confirm_pass': 'नए पासवर्ड की पुष्टि करें',
    'forgot.submit': 'पासवर्ड रीसेट करें',
    'forgot.remembered': 'याद आया?',
    'forgot.back': 'साइन इन पर वापस जाएँ',
    'forgot.verified': '✅ सत्यापित। अब अपना नया पासवर्ड सेट करें।',
    'forgot.updated': 'पासवर्ड अपडेट हो गया। कृपया अपने नए पासवर्ड से साइन इन करें।',
    'success.title': 'सफलता!',
    'success.continue': 'जारी रखें',
    'net.offline': 'आप ऑफ़लाइन हैं। पोर्टल फिर भी काम करता है — फ़ॉर्म सहेजे जाते हैं और वापस ऑनलाइन होने पर सिंक होंगे।',
    'net.slow': 'कम कनेक्टिविटी — यह पेज हल्का है और धीमे नेटवर्क पर काम करता है।',
    'load.sending': 'भेजा जा रहा है…',
    'load.verifying': 'सत्यापित किया जा रहा है…',
    'load.detecting': 'पता लगाया जा रहा है…',
    'load.signing': 'साइन इन हो रहा है…',
    'load.submitting': 'भेजा जा रहा है…',
    'load.resetting': 'रीसेट हो रहा है…',
    'strength.weak': 'कमज़ोर पासवर्ड',
    'strength.mid': 'ठीक पासवर्ड',
    'strength.strong': 'मज़बूत पासवर्ड',
    'rule.required': 'यह फ़ील्ड आवश्यक है।',
    'rule.name': 'नाम में केवल अक्षर, स्थान, बिंदु, एपॉस्ट्रोफ़ और हाइफ़न हो सकते हैं।',
    'rule.phone': '10 अंकों का सही मोबाइल नंबर दर्ज करें।',
    'rule.email': 'सही ईमेल पता दर्ज करें।',
    'rule.pincode': '6 अंकों का सही पिन कोड दर्ज करें।',
    'rule.asha_id': 'सही आशा ID दर्ज करें (6+ अक्षर/अंक)।',
    'rule.reg_no': 'सही पंजीकरण संख्या दर्ज करें।',
    'rule.emp_id': 'सही कर्मचारी ID दर्ज करें।',
    'rule.cert_no': 'सही प्रमाणन संख्या दर्ज करें।',
    'rule.dob_age': 'आपकी आयु कम से कम 18 वर्ष होनी चाहिए।',
    'rule.dob_check': 'कृपया जन्म तिथि जाँचें।',
    'rule.exp_range': '0 से 60 के बीच वर्ष दर्ज करें।',
    'rule.pass_set': 'पासवर्ड सेट करें।',
    'rule.pass_len': 'पासवर्ड कम से कम 8 अक्षरों का होना चाहिए।',
    'rule.pass_mix': 'अक्षर और अंक दोनों उपयोग करें।',
    'rule.confirm_req': 'अपने पासवर्ड की पुष्टि करें।',
    'rule.confirm_match': 'पासवर्ड मेल नहीं खाते।',
    'rule.radio': 'कृपया एक विकल्प चुनें।',
    'err.otp_expired': 'OTP समाप्त हो गया। कृपया नया अनुरोध करें।',
    'err.otp_wrong': 'गलत OTP। कृपया फिर से प्रयास करें।',
    'err.dup_phone': 'इस फ़ोन नंबर से एक खाता पहले से मौजूद है।',
    'err.no_account': 'इस फ़ोन नंबर के लिए कोई खाता नहीं मिला।',
    'err.pending_approval': 'आपका पंजीकरण प्रशासक की मंज़ूरी की प्रतीक्षा में है। कृपया बाद में प्रयास करें।',
    'err.bad_login': 'गलत फ़ोन नंबर या पासवर्ड।',
    'demo.title': 'डेमो {0} लॉगिन',
    'demo.phone': 'फ़ोन:',
    'demo.pass': 'पासवर्ड:',
    'demo.tap_fill': 'भरने के लिए टैप करें',
    'pw.show': 'पासवर्ड दिखाएँ',
    'pw.hide': 'पासवर्ड छिपाएँ',
  },

  mr: {
    'title.portal': 'ग्रामआरोग्य — कनेक्टिव्हिटी पोर्टल',
    'brand.tagline': 'आरोग्य सेवा कनेक्टिव्हिटी पोर्टल',
    'nav.home_aria': 'मुख्य साइटवर परत जा',
    'footer.text': 'ग्रामआरोग्य · स्मार्ट इंडिया हॅकाथॉन प्रोटोटाइप · <a href="/" class="link">मुख्य साइटवर परत जा</a>',
    'role.asha': 'आशा कार्यकर्ता',
    'role.doctor': 'डॉक्टर',
    'role.admin': 'प्रशासक',
    'role.lab': 'प्रयोगशाळा तंत्रज्ञ',
    'tabs.login_aria': 'तुमची भूमिका निवडा',
    'tabs.register_aria': 'म्हणून नोंदणी करा',
    'login.title': 'ग्रामआरोग्यमध्ये साइन इन करा',
    'login.user': 'फोन नंबर किंवा वापरकर्तानाव',
    'login.user_ph': 'उदा. 9876543210',
    'login.pass': 'पासवर्ड',
    'login.show_pass': 'पासवर्ड दाखवा',
    'login.hide_pass': 'पासवर्ड लपवा',
    'login.remember': 'माझी भूमिका लक्षात ठेवा',
    'login.forgot': 'पासवर्ड विसरलात?',
    'login.btn': 'साइन इन करा',
    'login.new_user': 'नवीन वापरकर्ता?',
    'login.register_here': 'येथे नोंदणी करा',
    'login.welcome': 'स्वागत आहे, {0}! तुम्ही {1} म्हणून साइन इन आहात.',
    'login.continue_to': '{0} पोर्टलवर पुढे जा',
    'reg.title': 'खाते तयार करा',
    'reg.asha_heading': 'आशा कार्यकर्ता नोंदणी',
    'reg.doctor_heading': 'डॉक्टर नोंदणी',
    'reg.admin_heading': 'प्रशासक नोंदणी',
    'reg.lab_heading': 'प्रयोगशाळा तंत्रज्ञ नोंदणी',
    'reg.doctor_notice': '⏳ साइन इन करण्यापूर्वी नोंदणीला <b>प्रशासकाची मंजुरी</b> आवश्यक आहे.',
    'reg.asha_submit': 'आशा कार्यकर्ता खाते तयार करा',
    'reg.doctor_submit': 'मंजुरीसाठी सादर करा',
    'reg.admin_submit': 'प्रशासक खाते तयार करा',
    'reg.lab_submit': 'प्रयोगशाळा खाते तयार करा',
    'reg.verify_first': 'कृपया प्रथम OTP ने तुमचा फोन नंबर सत्यापित करा.',
    'reg.msg_doctor': 'धन्यवाद, {0}! तुमची डॉक्टर नोंदणी सादर केली आहे. प्रशासक त्याचे पुनरावलोकन करून मंजुरी देईल — मंजुरी मिळाल्यावर तुम्ही साइन इन करू शकता.',
    'reg.msg_asha': 'स्वागत आहे, {0}! तुमचे आशा कार्यकर्ता खाते तयार झाले आहे. तुम्ही आता साइन इन करू शकता.',
    'reg.msg_other': 'स्वागत आहे, {0}! तुमचे {1} खाते तयार झाले आहे. तुम्ही आता साइन इन करू शकता.',
    'reg.go_signin': 'साइन इनवर जा',
    'form.required_note': '<span class="req">*</span> ने चिन्हांकित फील्ड आवश्यक आहेत.',
    'form.already': 'आधीच नोंदणी केली आहे?',
    'lbl.full_name': 'पूर्ण नाव',
    'lbl.phone': 'फोन नंबर',
    'lbl.email': 'ईमेल',
    'lbl.address': 'पत्ता',
    'lbl.village': 'गाव / वॉर्ड',
    'lbl.block': 'तालुका',
    'lbl.district': 'जिल्हा',
    'lbl.state': 'राज्य',
    'lbl.select_state': 'राज्य निवडा',
    'lbl.pincode': 'पिन कोड',
    'lbl.asha_id': 'आशा ID / नोंदणी क्रमांक',
    'lbl.nearest_phc': 'जवळचे PHC',
    'lbl.dob': 'जन्म तारीख',
    'lbl.set_pass': 'पासवर्ड सेट करा',
    'lbl.confirm_pass': 'पासवर्डची पुष्टी करा',
    'lbl.reg_no': 'वैद्यकीय नोंदणी क्रमांक',
    'lbl.council': 'परिषदेचे नाव',
    'lbl.select_council': 'परिषद निवडा',
    'lbl.spec': 'विशेषीकरण',
    'lbl.select_spec': 'विशेषीकरण निवडा',
    'lbl.phc_hospital': 'नियुक्त PHC / रुग्णालय',
    'lbl.phc_lab': 'नियुक्त PHC / प्रयोगशाळा',
    'lbl.exp': 'अनुभवाची वर्षे',
    'lbl.emp_id': 'कर्मचारी ID',
    'lbl.jurisdiction': 'विभाग / अधिकार क्षेत्र',
    'lbl.select_level': 'स्तर निवडा',
    'lbl.jur_name': 'अधिकार क्षेत्राचे नाव',
    'lbl.access_level': 'प्रशासक प्रवेश स्तर',
    'lbl.cert_no': 'प्रयोगशाळा प्रमाणन क्रमांक',
    'ph.asha_id': 'उदा. 1012345678',
    'ph.phc': 'PHC शोधा किंवा निवडा',
    'ph.facility': 'सुविधा शोधा किंवा निवडा',
    'jur.district': 'जिल्हा',
    'jur.block': 'तालुका',
    'jur.phc': 'PHC',
    'level.super': 'सुपर अ‍ॅडमिन',
    'level.district_admin': 'जिल्हा अ‍ॅडमिन',
    'level.block_admin': 'तालुका अ‍ॅडमिन',
    'otp.send': 'OTP पाठवा',
    'otp.verify': 'सत्यापित करा',
    'otp.enter_label': 'तुमच्या फोनवर पाठवलेला 6-अंकी OTP प्रविष्ट करा',
    'otp.enter_err': '6-अंकी OTP प्रविष्ट करा.',
    'otp.verified': '✅ फोन सत्यापित.',
    'otp.demo_sms': 'डेमो SMS {0} वर पाठवला — OTP आहे {1}',
    'phc.auto_detect': '📍 आपोआप शोधा',
    'phc.no_geo': 'या डिव्हाइसवर स्थान उपलब्ध नाही — कृपया यादीतून तुमचे PHC निवडा.',
    'phc.detected': '📍 जवळची सुविधा आढळली: {0}',
    'phc.detect_fail': 'स्थान शोधता आले नाही. कृपया शोधून तुमचे PHC स्वतः निवडा.',
    'forgot.title': 'तुमचा पासवर्ड रीसेट करा',
    'forgot.phone': 'नोंदणीकृत फोन नंबर',
    'forgot.new_pass': 'नवीन पासवर्ड',
    'forgot.confirm_pass': 'नवीन पासवर्डची पुष्टी करा',
    'forgot.submit': 'पासवर्ड रीसेट करा',
    'forgot.remembered': 'आठवले?',
    'forgot.back': 'साइन इनवर परत जा',
    'forgot.verified': '✅ सत्यापित. आता तुमचा नवीन पासवर्ड सेट करा.',
    'forgot.updated': 'पासवर्ड अपडेट झाला. कृपया तुमच्या नवीन पासवर्डने साइन इन करा.',
    'success.title': 'यश!',
    'success.continue': 'पुढे जा',
    'net.offline': 'तुम्ही ऑफलाइन आहात. पोर्टल तरीही कार्य करते — फॉर्म सेव्ह होतात आणि परत ऑनलाइन झाल्यावर सिंक होतात.',
    'net.slow': 'कमी कनेक्टिव्हिटी — हे पेज हलके आहे आणि मंद नेटवर्कवर कार्य करते.',
    'load.sending': 'पाठवत आहे…',
    'load.verifying': 'सत्यापित करत आहे…',
    'load.detecting': 'शोधत आहे…',
    'load.signing': 'साइन इन होत आहे…',
    'load.submitting': 'सादर करत आहे…',
    'load.resetting': 'रीसेट होत आहे…',
    'strength.weak': 'कमकुवत पासवर्ड',
    'strength.mid': 'ठीक पासवर्ड',
    'strength.strong': 'मजबूत पासवर्ड',
    'rule.required': 'हे फील्ड आवश्यक आहे.',
    'rule.name': 'नावात फक्त अक्षरे, स्थान, ठिपके, अपोस्ट्रॉफी आणि हायफन असू शकतात.',
    'rule.phone': '10 अंकी वैध मोबाइल क्रमांक प्रविष्ट करा.',
    'rule.email': 'वैध ईमेल पत्ता प्रविष्ट करा.',
    'rule.pincode': '6 अंकी वैध पिन कोड प्रविष्ट करा.',
    'rule.asha_id': 'वैध आशा ID प्रविष्ट करा (6+ अक्षरे/अंक).',
    'rule.reg_no': 'वैध नोंदणी क्रमांक प्रविष्ट करा.',
    'rule.emp_id': 'वैध कर्मचारी ID प्रविष्ट करा.',
    'rule.cert_no': 'वैध प्रमाणन क्रमांक प्रविष्ट करा.',
    'rule.dob_age': 'तुमचे वय किमान 18 वर्षे असणे आवश्यक आहे.',
    'rule.dob_check': 'कृपया जन्म तारीख तपासा.',
    'rule.exp_range': '0 ते 60 दरम्यानची वर्षे प्रविष्ट करा.',
    'rule.pass_set': 'पासवर्ड सेट करा.',
    'rule.pass_len': 'पासवर्ड किमान 8 अक्षरांचा असावा.',
    'rule.pass_mix': 'अक्षरे आणि अंक दोन्ही वापरा.',
    'rule.confirm_req': 'तुमच्या पासवर्डची पुष्टी करा.',
    'rule.confirm_match': 'पासवर्ड जुळत नाहीत.',
    'rule.radio': 'कृपया एक पर्याय निवडा.',
    'err.otp_expired': 'OTP कालबाह्य झाला. कृपया नवीन विनंती करा.',
    'err.otp_wrong': 'चुकीचा OTP. कृपया पुन्हा प्रयत्न करा.',
    'err.dup_phone': 'या फोन नंबरवर खाते आधीच अस्तित्वात आहे.',
    'err.no_account': 'या फोन नंबरसाठी खाते आढळले नाही.',
    'err.pending_approval': 'तुमची नोंदणी प्रशासकाच्या मंजुरीच्या प्रतीक्षेत आहे. कृपया नंतर पुन्हा प्रयत्न करा.',
    'err.bad_login': 'चुकीचा फोन नंबर किंवा पासवर्ड.',
    'demo.title': 'डेमो {0} लॉगिन',
    'demo.phone': 'फोन:',
    'demo.pass': 'पासवर्ड:',
    'demo.tap_fill': 'भरण्यासाठी टॅप करा',
    'pw.show': 'पासवर्ड दाखवा',
    'pw.hide': 'पासवर्ड लपवा',
  },

  bn: {
    'title.portal': 'গ্রামআরোগ্য — কানেক্টিভিটি পোর্টাল',
    'brand.tagline': 'স্বাস্থ্যসেবা কানেক্টিভিটি পোর্টাল',
    'nav.home_aria': 'মূল সাইটে ফিরে যান',
    'footer.text': 'গ্রামআরোগ্য · স্মার্ট ইন্ডিয়া হ্যাকাথন প্রোটোটাইপ · <a href="/" class="link">মূল সাইটে ফিরে যান</a>',
    'role.asha': 'আশা কর্মী',
    'role.doctor': 'ডাক্তার',
    'role.admin': 'প্রশাসক',
    'role.lab': 'ল্যাব টেকনিশিয়ান',
    'tabs.login_aria': 'আপনার ভূমিকা নির্বাচন করুন',
    'tabs.register_aria': 'হিসেবে নিবন্ধন করুন',
    'login.title': 'গ্রামআরোগ্যে সাইন ইন করুন',
    'login.user': 'ফোন নম্বর বা ব্যবহারকারীর নাম',
    'login.user_ph': 'যেমন 9876543210',
    'login.pass': 'পাসওয়ার্ড',
    'login.show_pass': 'পাসওয়ার্ড দেখান',
    'login.hide_pass': 'পাসওয়ার্ড লুকান',
    'login.remember': 'আমার ভূমিকা মনে রাখুন',
    'login.forgot': 'পাসওয়ার্ড ভুলে গেছেন?',
    'login.btn': 'সাইন ইন করুন',
    'login.new_user': 'নতুন ব্যবহারকারী?',
    'login.register_here': 'এখানে নিবন্ধন করুন',
    'login.welcome': 'স্বাগতম, {0}! আপনি {1} হিসাবে সাইন ইন করেছেন।',
    'login.continue_to': '{0} পোর্টালে চালিয়ে যান',
    'reg.title': 'একটি অ্যাকাউন্ট তৈরি করুন',
    'reg.asha_heading': 'আশা কর্মী নিবন্ধন',
    'reg.doctor_heading': 'ডাক্তার নিবন্ধন',
    'reg.admin_heading': 'প্রশাসক নিবন্ধন',
    'reg.lab_heading': 'ল্যাব টেকনিশিয়ান নিবন্ধন',
    'reg.doctor_notice': '⏳ সাইন ইন করার আগে নিবন্ধনের জন্য <b>প্রশাসকের অনুমোদন</b> প্রয়োজন।',
    'reg.asha_submit': 'আশা কর্মী অ্যাকাউন্ট তৈরি করুন',
    'reg.doctor_submit': 'অনুমোদনের জন্য জমা দিন',
    'reg.admin_submit': 'প্রশাসক অ্যাকাউন্ট তৈরি করুন',
    'reg.lab_submit': 'ল্যাব অ্যাকাউন্ট তৈরি করুন',
    'reg.verify_first': 'অনুগ্রহ করে আগে OTP দিয়ে আপনার ফোন নম্বর যাচাই করুন।',
    'reg.msg_doctor': 'ধন্যবাদ, {0}! আপনার ডাক্তার নিবন্ধন জমা হয়েছে। একজন প্রশাসক এটি পর্যালোচনা করে অনুমোদন দেবেন — অনুমোদিত হলে আপনি সাইন ইন করতে পারবেন।',
    'reg.msg_asha': 'স্বাগতম, {0}! আপনার আশা কর্মী অ্যাকাউন্ট তৈরি হয়েছে। আপনি এখন সাইন ইন করতে পারেন।',
    'reg.msg_other': 'স্বাগতম, {0}! আপনার {1} অ্যাকাউন্ট তৈরি হয়েছে। আপনি এখন সাইন ইন করতে পারেন।',
    'reg.go_signin': 'সাইন ইন-এ যান',
    'form.required_note': '<span class="req">*</span> দিয়ে চিহ্নিত ক্ষেত্রগুলি প্রয়োজনীয়।',
    'form.already': 'ইতিমধ্যে নিবন্ধিত?',
    'lbl.full_name': 'পুরো নাম',
    'lbl.phone': 'ফোন নম্বর',
    'lbl.email': 'ইমেইল',
    'lbl.address': 'ঠিকানা',
    'lbl.village': 'গ্রাম / ওয়ার্ড',
    'lbl.block': 'ব্লক',
    'lbl.district': 'জেলা',
    'lbl.state': 'রাজ্য',
    'lbl.select_state': 'রাজ্য নির্বাচন করুন',
    'lbl.pincode': 'পিন কোড',
    'lbl.asha_id': 'আশা ID / নিবন্ধন নম্বর',
    'lbl.nearest_phc': 'নিকটতম PHC',
    'lbl.dob': 'জন্ম তারিখ',
    'lbl.set_pass': 'পাসওয়ার্ড সেট করুন',
    'lbl.confirm_pass': 'পাসওয়ার্ড নিশ্চিত করুন',
    'lbl.reg_no': 'মেডিকেল নিবন্ধন নম্বর',
    'lbl.council': 'কাউন্সিলের নাম',
    'lbl.select_council': 'কাউন্সিল নির্বাচন করুন',
    'lbl.spec': 'বিশেষায়ন',
    'lbl.select_spec': 'বিশেষায়ন নির্বাচন করুন',
    'lbl.phc_hospital': 'নিযুক্ত PHC / হাসপাতাল',
    'lbl.phc_lab': 'নিযুক্ত PHC / ল্যাব',
    'lbl.exp': 'অভিজ্ঞতার বছর',
    'lbl.emp_id': 'কর্মচারী ID',
    'lbl.jurisdiction': 'বিভাগ / এখতিয়ার',
    'lbl.select_level': 'স্তর নির্বাচন করুন',
    'lbl.jur_name': 'এখতিয়ারের নাম',
    'lbl.access_level': 'প্রশাসক অ্যাক্সেস স্তর',
    'lbl.cert_no': 'ল্যাব সার্টিফিকেশন নম্বর',
    'ph.asha_id': 'যেমন 1012345678',
    'ph.phc': 'PHC খুঁজুন বা নির্বাচন করুন',
    'ph.facility': 'সুবিধা খুঁজুন বা নির্বাচন করুন',
    'jur.district': 'জেলা',
    'jur.block': 'ব্লক',
    'jur.phc': 'PHC',
    'level.super': 'সুপার অ্যাডমিন',
    'level.district_admin': 'জেলা অ্যাডমিন',
    'level.block_admin': 'ব্লক অ্যাডমিন',
    'otp.send': 'OTP পাঠান',
    'otp.verify': 'যাচাই করুন',
    'otp.enter_label': 'আপনার ফোনে পাঠানো 6-অঙ্কের OTP লিখুন',
    'otp.enter_err': '6-অঙ্কের OTP লিখুন।',
    'otp.verified': '✅ ফোন যাচাই হয়েছে।',
    'otp.demo_sms': 'ডেমো SMS {0} এ পাঠানো হয়েছে — OTP হল {1}',
    'phc.auto_detect': '📍 স্বয়ংক্রিয়ভাবে খুঁজুন',
    'phc.no_geo': 'এই ডিভাইসে অবস্থান উপলব্ধ নেই — অনুগ্রহ করে তালিকা থেকে আপনার PHC বেছে নিন।',
    'phc.detected': '📍 নিকটতম সুবিধা পাওয়া গেছে: {0}',
    'phc.detect_fail': 'অবস্থান সনাক্ত করা যায়নি। অনুগ্রহ করে খুঁজে আপনার PHC নিজে বেছে নিন।',
    'forgot.title': 'আপনার পাসওয়ার্ড রিসেট করুন',
    'forgot.phone': 'নিবন্ধিত ফোন নম্বর',
    'forgot.new_pass': 'নতুন পাসওয়ার্ড',
    'forgot.confirm_pass': 'নতুন পাসওয়ার্ড নিশ্চিত করুন',
    'forgot.submit': 'পাসওয়ার্ড রিসেট করুন',
    'forgot.remembered': 'মনে পড়েছে?',
    'forgot.back': 'সাইন ইন-এ ফিরে যান',
    'forgot.verified': '✅ যাচাই হয়েছে। এখন আপনার নতুন পাসওয়ার্ড সেট করুন।',
    'forgot.updated': 'পাসওয়ার্ড আপডেট হয়েছে। অনুগ্রহ করে আপনার নতুন পাসওয়ার্ড দিয়ে সাইন ইন করুন।',
    'success.title': 'সফল!',
    'success.continue': 'চালিয়ে যান',
    'net.offline': 'আপনি অফলাইনে আছেন। পোর্টাল তবুও কাজ করে — ফর্ম সংরক্ষিত হয় এবং আবার অনলাইনে এলে সিঙ্ক হবে।',
    'net.slow': 'কম সংযোগ — এই পৃষ্ঠাটি হালকা এবং ধীর নেটওয়ার্কে কাজ করে।',
    'load.sending': 'পাঠানো হচ্ছে…',
    'load.verifying': 'যাচাই করা হচ্ছে…',
    'load.detecting': 'সন্ধান করা হচ্ছে…',
    'load.signing': 'সাইন ইন হচ্ছে…',
    'load.submitting': 'জমা দেওয়া হচ্ছে…',
    'load.resetting': 'রিসেট হচ্ছে…',
    'strength.weak': 'দুর্বল পাসওয়ার্ড',
    'strength.mid': 'ঠিক আছে এমন পাসওয়ার্ড',
    'strength.strong': 'শক্তিশালী পাসওয়ার্ড',
    'rule.required': 'এই ক্ষেত্রটি প্রয়োজনীয়।',
    'rule.name': 'নামে শুধু অক্ষর, স্থান, বিন্দু, apostrophe এবং হাইফেন থাকতে পারে।',
    'rule.phone': 'একটি বৈধ 10-অঙ্কের মোবাইল নম্বর লিখুন।',
    'rule.email': 'একটি বৈধ ইমেইল ঠিকানা লিখুন।',
    'rule.pincode': 'একটি বৈধ 6-অঙ্কের পিন কোড লিখুন।',
    'rule.asha_id': 'একটি বৈধ আশা ID লিখুন (6+ অক্ষর/অঙ্ক)।',
    'rule.reg_no': 'একটি বৈধ নিবন্ধন নম্বর লিখুন।',
    'rule.emp_id': 'একটি বৈধ কর্মচারী ID লিখুন।',
    'rule.cert_no': 'একটি বৈধ সার্টিফিকেশন নম্বর লিখুন।',
    'rule.dob_age': 'আপনার বয়স কমপক্ষে 18 বছর হতে হবে।',
    'rule.dob_check': 'অনুগ্রহ করে জন্ম তারিখ পরীক্ষা করুন।',
    'rule.exp_range': '0 থেকে 60 এর মধ্যে বছর লিখুন।',
    'rule.pass_set': 'একটি পাসওয়ার্ড সেট করুন।',
    'rule.pass_len': 'পাসওয়ার্ড কমপক্ষে 8 অক্ষরের হতে হবে।',
    'rule.pass_mix': 'অক্ষর এবং সংখ্যা দুটোই ব্যবহার করুন।',
    'rule.confirm_req': 'আপনার পাসওয়ার্ড নিশ্চিত করুন।',
    'rule.confirm_match': 'পাসওয়ার্ড মেলে না।',
    'rule.radio': 'অনুগ্রহ করে একটি বিকল্প নির্বাচন করুন।',
    'err.otp_expired': 'OTP মেয়াদ শেষ হয়েছে। অনুগ্রহ করে একটি নতুন অনুরোধ করুন।',
    'err.otp_wrong': 'ভুল OTP। অনুগ্রহ করে আবার চেষ্টা করুন।',
    'err.dup_phone': 'এই ফোন নম্বরে একটি অ্যাকাউন্ট ইতিমধ্যে আছে।',
    'err.no_account': 'এই ফোন নম্বরের জন্য কোনো অ্যাকাউন্ট পাওয়া যায়নি।',
    'err.pending_approval': 'আপনার নিবন্ধন প্রশাসকের অনুমোদনের অপেক্ষায় রয়েছে। অনুগ্রহ করে পরে আবার চেষ্টা করুন।',
    'err.bad_login': 'ভুল ফোন নম্বর বা পাসওয়ার্ড।',
    'demo.title': 'ডেমো {0} লগইন',
    'demo.phone': 'ফোন:',
    'demo.pass': 'পাসওয়ার্ড:',
    'demo.tap_fill': 'পূরণ করতে ট্যাপ করুন',
    'pw.show': 'পাসওয়ার্ড দেখান',
    'pw.hide': 'পাসওয়ার্ড লুকান',
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
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}

/* --------------------------------------------------------------------------
   Mock API layer — swap these two functions for real fetch() calls later.
   Both return Promises with an artificial network delay so loading states
   are exercised exactly like production.
   -------------------------------------------------------------------------- */
const API_DELAY = 900;

/* Real backend endpoints (served by the FastAPI app at /api/v1). OTP stays
   local-mock (no SMS gateway in the prototype) so only register / login /
   reset hit the server; everything falls back to the in-page mock below
   when the backend is unreachable (offline / file:// demo). */
const REAL_AUTH = {
  '/api/auth/register': '/api/v1/auth/register',
  '/api/auth/login': '/api/v1/auth/login',
  '/api/auth/reset-password': '/api/v1/auth/reset-password',
};

async function realPost(url, body) {
  const real = REAL_AUTH[url];
  if (!real) return null;  // not a backend endpoint (e.g. OTP) — stay mock

  // Demo hint allows signing in with the demo NAME; the backend matches on
  // phone, so normalise before sending.
  if (url === '/api/auth/login' && DEMO_USERS[body.role] &&
      body.username === DEMO_USERS[body.role].name) {
    body = { ...body, username: DEMO_USERS[body.role].phone };
  }

  // 12s cap so a dead/hanging network can never leave a submit button stuck
  // in its loading state — a timed-out request falls back to the local mock.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(real, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 404/405/501 mean this server does not host the /api/v1 routes at all
      // (the page was opened from a plain static server — e.g. `python -m
      // http.server` answers POST with 501 — rather than the FastAPI
      // backend), so fall back to the local mock and the demo keeps working.
      // Real backend validation errors (401/403/409/422) still surface as-is.
      if (res.status === 404 || res.status === 405 || res.status === 501) return null;
      const err = new Error(data.detail || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (err) {
    clearTimeout(timer);
    // Network-level failure (or the 12s abort above) -> local mock fallback.
    // Validation errors from the server (401/403/409) are real and must
    // surface as-is.
    if (err instanceof TypeError || err.name === 'AbortError' || err.name === 'TimeoutError') return null;
    throw err;
  }
}

async function postMock(url, body) {
  // 1) Real backend first — when it answers, it is authoritative.
  const real = await realPost(url, body).catch(async (err) => {
    // A server 401 on login can simply mean the account was created earlier
    // without the backend (offline registration lives in the local store).
    // Check the local store before reporting "invalid credentials".
    if (url === '/api/auth/login' && err && err.status === 401) {
      try { return { local: handleMockPost(url, body) }; }
      catch { /* fall through — surface the server's error */ }
    }
    throw err;
  });

  if (real) {
    // Backend confirmed the action — mirror the account into the local store
    // so the same credentials keep working offline, or even if the server
    // database is later reset. (Demo-grade prototype: the local mirror stores
    // the plaintext password, exactly like the offline mock already does.)
    if (url === '/api/auth/register') {
      DB.upsert({
        role: body.role, name: body.name, phone: body.phone,
        password: body.password, approved: real.status === 'approved',
        createdAt: new Date().toISOString(),
      });
    } else if (url === '/api/auth/login' && real.user && !real.local) {
      // Only mirror a server-confirmed login; a local-store login (server
      // 401 fallback) is already in the local store and lacks `status`.
      DB.upsert({
        role: body.role, name: real.user.name, phone: real.user.phone,
        password: body.password, approved: real.user.status === 'approved',
      });
    } else if (url === '/api/auth/reset-password') {
      const u = DB.find(body.role, body.phone);
      if (u) { u.password = body.password; DB.save(); }
    }
    console.info(real.local ? '[mock POST]' : '[api POST]', url, real.local || real);
    return real.local || real;
  }

  // 2) No backend reachable (network down / static server / file://) -> the
  //    offline mock store in localStorage.
  console.info('[mock POST]', url, body);
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(handleMockPost(url, body)); }
      catch (err) { reject(err); }
    }, API_DELAY + Math.random() * 400);
  });
}

function fetchMock(url) {
  console.info('[mock GET]', url);
  return new Promise((resolve) => {
    setTimeout(() => resolve(handleMockGet(url)), 400);
  });
}

/* Local "database" for registered users. Persisted in localStorage (not
   sessionStorage) so accounts survive closing the tab/browser — the whole
   flow works offline and the registered users keep working next visit.
   When the real backend is reachable, register/login go to the server and
   this store is only the offline fallback. */
const DB = {
  users: JSON.parse(localStorage.getItem('ga.users') || '[]'),
  otp: {},          // phone -> { code, expiresAt }
  save() {
    localStorage.setItem('ga.users', JSON.stringify(this.users));
  },
  // An account is uniquely (role, phone) — the same number may hold both an
  // ASHA and a doctor account, so never key on the phone alone.
  find(role, phone) {
    return this.users.find((u) => u.role === role && u.phone === phone);
  },
  // Add, or refresh an existing (role, phone) account. Used both by the
  // offline mock and to mirror accounts the real backend has confirmed.
  upsert(user) {
    const existing = this.find(user.role, user.phone);
    if (existing) Object.assign(existing, user);
    else this.users.push(user);
    this.save();
  },
};

function handleMockPost(url, body) {
  if (url === '/api/auth/send-otp') {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    DB.otp[body.phone] = { code, expiresAt: Date.now() + 5 * 60 * 1000 };
    return { ok: true, demoCode: code }; // demo only — real API sends SMS
  }
  if (url === '/api/auth/verify-otp') {
    const entry = DB.otp[body.phone];
    if (!entry || entry.expiresAt < Date.now()) throw new Error(t('err.otp_expired'));
    if (entry.code !== body.code) throw new Error(t('err.otp_wrong'));
    return { ok: true };
  }
  if (url === '/api/auth/register') {
    if (DB.find(body.role, body.phone)) throw new Error(t('err.dup_phone'));
    // Doctors need admin approval before they can sign in (mirrors the
    // "Submit for approval" notice on the doctor form); everyone else is
    // approved instantly in this mock.
    const user = {
      ...body,
      approved: body.role !== 'doctor',
      createdAt: new Date().toISOString(),
    };
    DB.users.push(user);
    DB.save();
    return { ok: true, user };
  }
  if (url === '/api/auth/reset-password') {
    const user = DB.find(body.role, body.phone);
    if (!user) throw new Error(t('err.no_account'));
    user.password = body.password;
    DB.save();
    return { ok: true };
  }
  if (url === '/api/auth/login') {
    const { role, username, password } = body;
    const demo = DEMO_USERS[role];
    if (demo && (username === demo.phone || username === demo.name) && password === demo.pass) {
      return { ok: true, user: { ...demo, role } };
    }
    const found = DB.find(role, username);
    const user = found && found.password === password ? found : null;
    if (user) {
      if (user.approved === false) throw new Error(t('err.pending_approval'));
      return { ok: true, user: { name: user.name, phone: user.phone, role } };
    }
    throw new Error(t('err.bad_login'));
  }
  throw new Error('Unknown mock endpoint: ' + url);
}

function handleMockGet(url) {
  if (url.startsWith('/api/phcs')) {
    const q = (new URLSearchParams(url.split('?')[1] || '').get('q') || '').toLowerCase();
    const list = q ? PHCS.filter((p) => (p.name + ' ' + p.district).toLowerCase().includes(q)) : PHCS;
    return { phcs: list };
  }
  if (url === '/api/districts') return { districts: DISTRICTS };
  return {};
}

/* --------------------------------------------------------------------------
   Tiny DOM helpers
   -------------------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 3800);
}

/* Loading state: swaps a button's label for a spinner, disables it. */
function setLoading(btn, on, label) {
  if (!btn) return;
  if (on) {
    if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.querySelector('.btn-label')?.innerHTML || btn.textContent;
    btn.disabled = true;
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    btn.innerHTML = '';
    btn.appendChild(spinner);
    btn.appendChild(document.createTextNode(' ' + label));
  } else {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-label">' + (btn.dataset.origLabel || '') + '</span>';
    delete btn.dataset.origLabel;
  }
}

/* --------------------------------------------------------------------------
   Application state
   -------------------------------------------------------------------------- */
const state = {
  role: localStorage.getItem('ga.role') || 'asha',
  rememberRole: true,
};

function setRole(role, { persist = true } = {}) {
  state.role = role;
  // Sync the two tab bars (login view + register view).
  $$('.role-tab').forEach((tab) => {
    const active = tab.dataset.role === role;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  // Show only the active role's registration form.
  $$('.role-form').forEach((form) => {
    form.hidden = form.dataset.role !== role;
  });
  if (persist && state.rememberRole) localStorage.setItem('ga.role', role);
  updateDemoHint();
}

/* --------------------------------------------------------------------------
   View switching — views stay in the DOM, so typed values and the chosen
   role survive Login <-> Register navigation (requirement: preserve state).
   -------------------------------------------------------------------------- */
const VIEWS = ['login', 'register', 'forgot', 'success'];

function showView(name) {
  VIEWS.forEach((v) => {
    const el = $('#view-' + v);
    if (el) el.hidden = v !== name;
  });
  window.scrollTo(0, 0);
  const title = $('#view-' + name + ' .view-title');
  if (title) title.focus({ preventScroll: true });
}

/* --------------------------------------------------------------------------
   Validation rules. Each rule returns an error string or '' when valid.
   -------------------------------------------------------------------------- */
const RULES = {
  required: (v) => (v.trim() ? '' : t('rule.required')),
  name: (v) => (/^[\p{L}][\p{L}\p{M}\s.'-]*$/u.test(v.trim()) ? '' : t('rule.name')),
  phone: (v) => (/^[6-9]\d{9}$/.test(v.trim()) ? '' : t('rule.phone')),
  email: (v) => (!v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : t('rule.email')),
  pincode: (v) => (/^\d{6}$/.test(v.trim()) ? '' : t('rule.pincode')),
  ashaId: (v) => (/^[A-Za-z0-9-]{6,20}$/.test(v.trim()) ? '' : t('rule.asha_id')),
  regNo: (v) => (/^[A-Za-z0-9/]{4,20}$/.test(v.trim()) ? '' : t('rule.reg_no')),
  empId: (v) => (/^[A-Za-z0-9-]{3,20}$/.test(v.trim()) ? '' : t('rule.emp_id')),
  certNo: (v) => (/^[A-Za-z0-9-]{4,20}$/.test(v.trim()) ? '' : t('rule.cert_no')),
  dob: (v) => {
    if (!v) return t('rule.required');
    const age = (Date.now() - new Date(v).getTime()) / (365.25 * 24 * 3600 * 1000);
    if (age < 18) return t('rule.dob_age');
    if (age > 75) return t('rule.dob_check');
    return '';
  },
  exp: (v) => {
    const n = Number(v);
    if (!v.trim()) return t('rule.required');
    if (!Number.isFinite(n) || n < 0 || n > 60) return t('rule.exp_range');
    return '';
  },
  password: (v) => {
    if (!v) return t('rule.pass_set');
    if (v.length < 8) return t('rule.pass_len');
    if (!/[a-zA-Z]/.test(v) || !/\d/.test(v)) return t('rule.pass_mix');
    return '';
  },
  confirm: (v, form) => {
    const main = form.querySelector('input[type="password"]');
    return !v ? t('rule.confirm_req') : (v === main.value ? '' : t('rule.confirm_match'));
  },
  // Radio groups: the value passed is the radio's own value, so check the
  // group's checked state on the form instead. Error element is looked up
  // by the group `name` (handled in validateField).
  radioRequired: (_v, form) => {
    return form.querySelector('input[type="radio"]:checked') ? '' : t('rule.radio');
  },
};

/* Validate one field: shows the inline error, returns valid bool. */
function validateField(input, form) {
  // Radio buttons don't have per-input error elements — use the group's
  // error element, keyed by the `name` attribute (e.g. adm-level-err).
  const errId = input.type === 'radio' ? input.name + '-err' : input.id + '-err';
  const errEl = document.getElementById(errId);
  const rules = input.dataset.rules ? input.dataset.rules.split(',') : [];
  let msg = '';
  for (const rule of rules) {
    msg = RULES[rule] ? RULES[rule](input.value, form) : '';
    if (msg) break;
  }
  if (errEl) errEl.textContent = msg;
  input.classList.toggle('invalid', !!msg);
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  return !msg;
}

/* Validate an entire form; returns the first invalid input (for focus). */
function validateForm(form) {
  let firstBad = null;
  form.querySelectorAll('input[data-rules], select[data-rules]').forEach((input) => {
    const ok = validateField(input, form);
    if (!ok && !firstBad) firstBad = input;
  });
  return firstBad;
}

/* Mark one field invalid (used for OTP gate and login failure). */
function markInvalid(input, msg) {
  const errId = input.type === 'radio' ? input.name + '-err' : input.id + '-err';
  const errEl = document.getElementById(errId);
  if (errEl) errEl.textContent = msg;
  input.classList.add('invalid');
  input.setAttribute('aria-invalid', 'true');
}

/* Password strength meter (live, updates as the user types). */
function wireStrength() {
  $$('input[type="password"]').forEach((input) => {
    if (input.id.endsWith('-pass2') || input.id === 'login-pass') return;
    input.addEventListener('input', () => {
      const meter = document.getElementById(input.id + '-strength');
      if (!meter) return;
      const v = input.value;
      let score = 0;
      if (v.length >= 8) score++;
      if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
      if (/\d/.test(v)) score++;
      if (/[^A-Za-z0-9]/.test(v)) score++;
      meter.className = 'strength ' + (score <= 1 ? 'weak' : score <= 3 ? 'mid' : 'strong');
      meter.textContent = v ? (score <= 1 ? t('strength.weak') : score <= 3 ? t('strength.mid') : t('strength.strong')) : '';
    });
  });
}

/* --------------------------------------------------------------------------
   OTP flow (mock). Real implementation would call the SMS gateway; here the
   code is displayed inline so the demo is fully self-contained.
   -------------------------------------------------------------------------- */
function wireOtp() {
  $$('.otp-send').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const phoneInput = document.getElementById(btn.dataset.phone);
      const statusEl = document.getElementById(btn.dataset.phone.replace('phone', 'otp-status'));
      const otpRow = document.getElementById(btn.dataset.phone.replace('phone', 'otp-row'));

      const phoneErr = RULES.phone(phoneInput.value); // '' when valid, message when invalid
      if (phoneErr) {
        statusEl.className = 'status bad';
        statusEl.textContent = phoneErr;
        phoneInput.focus();
        return;
      }
      setLoading(btn, true, t('load.sending'));
      try {
        const res = await postMock('/api/auth/send-otp', { phone: phoneInput.value });
        statusEl.className = 'status ok';
        // Demo only: real deployments send the code by SMS instead of showing it.
        statusEl.textContent = t('otp.demo_sms', [phoneInput.value.slice(0, 2) + '******' + phoneInput.value.slice(-2), res.demoCode]);
        otpRow.hidden = false;
      } catch (err) {
        statusEl.className = 'status bad';
        statusEl.textContent = err.message;
      } finally {
        setLoading(btn, false);
      }
    });
  });

  // Only bind the generic verify handler inside registration role forms —
  // the forgot-password view has its own (extended) verify handler.
  $$('.role-form [data-otp]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const phone = document.getElementById(btn.dataset.phone);
      const otpInput = document.getElementById(btn.dataset.otp);
      const statusEl = document.getElementById(btn.dataset.phone.replace('phone', 'otp-status'));

      if (!/^\d{6}$/.test(otpInput.value)) {
        statusEl.className = 'status bad';
        statusEl.textContent = t('otp.enter_err');
        return;
      }
      setLoading(btn, true, t('load.verifying'));
      try {
        await postMock('/api/auth/verify-otp', { phone: phone.value, code: otpInput.value });
        statusEl.className = 'status ok';
        statusEl.textContent = t('otp.verified');
        phone.dataset.verified = 'true';
        otpInput.disabled = true;
        btn.disabled = true;
      } catch (err) {
        statusEl.className = 'status bad';
        statusEl.textContent = err.message;
      } finally {
        setLoading(btn, false);
      }
    });
  });
}

/* --------------------------------------------------------------------------
   PHC field: searchable datalist + geolocation auto-detect.
   -------------------------------------------------------------------------- */
function populatePhcList() {
  const datalist = $('#phc-list');
  datalist.innerHTML = PHCS.map((p) => `<option value="${p.name}">${p.district}</option>`).join('');
}

function wirePhcDetect() {
  $$('[data-phc]').forEach((btn) => {
    btn.addEventListener('click', () => detectNearestPhc(btn));
  });
}

async function detectNearestPhc(btn) {
  const input = document.getElementById(btn.dataset.phc);
  if (!navigator.geolocation) {
    toast(t('phc.no_geo'), 'bad');
    return;
  }
  setLoading(btn, true, t('load.detecting'));
  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 300000 })
    );
    const { latitude: lat, longitude: lng } = pos.coords;
    // Nearest facility by simple Euclidean distance (fine at PHC scale).
    const nearest = PHCS.reduce((best, p) => {
      const d = Math.hypot(p.lat - lat, p.lng - lng);
      return !best || d < best.d ? { p, d } : best;
    }, null).p;
    input.value = nearest.name;
    const errEl = document.getElementById(input.id + '-err');
    if (errEl) errEl.textContent = '';
    input.classList.remove('invalid');
    toast(t('phc.detected', [nearest.name]), 'ok');
  } catch {
    toast(t('phc.detect_fail'), 'bad');
  } finally {
    setLoading(btn, false);
  }
}

/* --------------------------------------------------------------------------
   Login
   -------------------------------------------------------------------------- */
function updateDemoHint() {
  const demo = DEMO_USERS[state.role];
  if (!demo) return;
  const hint = $('#demo-hint');
  if (!hint) return;
  hint.innerHTML =
    `<b>${t('demo.title', [t('role.' + state.role)])}</b>` +
    `${t('demo.phone')} <a href="#" class="link" data-fill="phone">${demo.phone}</a> · ` +
    `${t('demo.pass')} <a href="#" class="link" data-fill="pass">${demo.pass}</a> · ` +
    `(<a href="#" class="link" data-fill="all">${t('demo.tap_fill')}</a>)`;
  hint.querySelectorAll('[data-fill]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (a.dataset.fill === 'phone') $('#login-user').value = demo.phone;
      else if (a.dataset.fill === 'pass') $('#login-pass').value = demo.pass;
      else { $('#login-user').value = demo.phone; $('#login-pass').value = demo.pass; }
    });
  });
}

async function onLogin(e) {
  e.preventDefault();
  const form = e.target;
  const firstBad = validateForm(form);
  if (firstBad) { firstBad.focus(); return; }

  const btn = $('#login-btn');
  setLoading(btn, true, t('load.signing'));
  try {
    const { username, password } = {
      username: $('#login-user').value.trim(),
      password: $('#login-pass').value,
    };
    const res = await postMock('/api/auth/login', { role: state.role, username, password });
    showSuccess(t('login.welcome', [res.user.name, t('role.' + state.role)]), {
      btn: t('login.continue_to', [t('role.' + state.role)]),
      href: portalPath(state.role),
    });
  } catch (err) {
    markInvalid($('#login-pass'), err.message);
  } finally {
    setLoading(btn, false);
  }
}

function portalPath(role) {
  const paths = { asha: '/asha/', doctor: '/doctor/', admin: '/admin/', lab: '/lab/' };
  return paths[role] || '/';
}

/* --------------------------------------------------------------------------
   Registration
   -------------------------------------------------------------------------- */
async function onRegister(e) {
  e.preventDefault();
  const form = e.target;
  const role = form.dataset.role;

  // ASHA workers must verify their phone with OTP before registering.
  const phoneInput = form.querySelector('input[type="tel"]');
  if (role === 'asha' && phoneInput && phoneInput.dataset.verified !== 'true') {
    markInvalid(phoneInput, t('reg.verify_first'));
    toast(t('reg.verify_first'), 'bad');  // visible near the button, not just the field
    phoneInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    phoneInput.focus({ preventScroll: true });
    return;
  }

  const firstBad = validateForm(form);
  if (firstBad) { firstBad.focus(); return; }

  const btn = form.querySelector('.submit-btn');
  setLoading(btn, true, t('load.submitting'));
  try {
    const payload = collectForm(form);
    const res = await postMock('/api/auth/register', payload);

    let msg;
    if (role === 'doctor') {
      msg = t('reg.msg_doctor', [payload.name]);
    } else if (role === 'asha') {
      msg = t('reg.msg_asha', [payload.name]);
    } else {
      msg = t('reg.msg_other', [payload.name, t('role.' + role)]);
    }

    form.reset();
    form.querySelectorAll('.err').forEach((el) => { el.textContent = ''; });
    form.querySelectorAll('.invalid').forEach((el) => {
      el.classList.remove('invalid');
      el.removeAttribute('aria-invalid');
    });
    if (phoneInput) { phoneInput.dataset.verified = ''; }
    $('#asha-otp-row').hidden = true;
    $('#asha-otp').disabled = false;
    $('#asha-otp-verify').disabled = false;
    $('#asha-otp-status').textContent = '';

    showSuccess(msg, { btn: t('reg.go_signin'), href: null });
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    setLoading(btn, false);
  }
}

/* Role-specific input ids -> canonical payload keys, so the mock backend
   (and later the real one) receives a uniform user object: { name, phone,
   password, ... } regardless of which role form was filled. */
const CANONICAL_KEYS = {
  'asha-name': 'name', 'doc-name': 'name', 'adm-name': 'name', 'lab-name': 'name',
  'asha-phone': 'phone', 'doc-phone': 'phone', 'adm-phone': 'phone', 'lab-phone': 'phone',
  'asha-pass': 'password', 'doc-pass': 'password', 'adm-pass': 'password', 'lab-pass': 'password',
  'doc-email': 'email', 'adm-email': 'email', 'lab-email': 'email',
  'asha-village': 'village', 'asha-block': 'block', 'asha-district': 'district',
  'asha-state': 'state', 'asha-pincode': 'pincode', 'asha-id': 'ashaId',
  'asha-phc': 'phc', 'doc-phc': 'phc', 'lab-phc': 'phc', 'asha-dob': 'dob',
  'doc-regno': 'regNo', 'doc-council': 'council', 'doc-spec': 'specialization',
  'doc-exp': 'experience', 'adm-empid': 'empId', 'lab-empid': 'empId',
  'adm-jurisdiction': 'jurisdiction', 'adm-jur-name': 'jurisdictionName',
  'adm-level': 'accessLevel', 'lab-cert': 'certNo',
};

function collectForm(form) {
  const data = {};
  form.querySelectorAll('input, select').forEach((input) => {
    if (input.type === 'radio') {
      if (input.checked && !data[CANONICAL_KEYS[input.name] || input.name]) {
        data[CANONICAL_KEYS[input.name] || input.name] = input.value;
      }
    } else if (input.type === 'checkbox') {
      data[CANONICAL_KEYS[input.id] || input.id] = input.checked;
    } else if (input.type !== 'submit' && input.type !== 'button') {
      // Confirm-password fields are validation-only — never part of the
      // payload sent to the backend (it would land in the profile JSON).
      if (input.id.endsWith('-pass2')) return;
      data[CANONICAL_KEYS[input.id] || input.id] = input.value.trim();
    }
  });
  data.role = form.dataset.role;
  return data;
}

/* --------------------------------------------------------------------------
   Forgot password: phone -> OTP -> new password (single form, steps revealed)
   -------------------------------------------------------------------------- */
function wireForgot() {
  $('#forgot-otp-verify').addEventListener('click', async () => {
    const phone = $('#forgot-phone');
    const statusEl = $('#forgot-otp-status');
    const otpInput = $('#forgot-otp');
    const btn = $('#forgot-otp-verify');

    if (!/^\d{6}$/.test(otpInput.value)) {
      statusEl.className = 'status bad';
      statusEl.textContent = t('otp.enter_err');
      return;
    }
    setLoading(btn, true, 'Verifying…');
    try {
      await postMock('/api/auth/verify-otp', { phone: phone.value, code: otpInput.value });
      statusEl.className = 'status ok';
      statusEl.textContent = t('forgot.verified');
      $('#forgot-new-wrap').hidden = false;
      $('#forgot-confirm-wrap').hidden = false;
      $('#forgot-submit').hidden = false;
      otpInput.disabled = true;
      btn.disabled = true;
      $('#forgot-pass').focus();
    } catch (err) {
      statusEl.className = 'status bad';
      statusEl.textContent = err.message;
    } finally {
      setLoading(btn, false);
    }
  });

  $('#forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const firstBad = validateForm(form);
    if (firstBad) { firstBad.focus(); return; }

    const btn = $('#forgot-submit');
    setLoading(btn, true, t('load.resetting'));
    try {
      await postMock('/api/auth/reset-password', {
        role: state.role,
        phone: $('#forgot-phone').value.trim(),
        password: $('#forgot-pass').value,
      });
      toast(t('forgot.updated'), 'ok');
      form.reset();
      $('#forgot-new-wrap').hidden = true;
      $('#forgot-confirm-wrap').hidden = true;
      $('#forgot-submit').hidden = true;
      $('#forgot-otp-row').hidden = true;
      $('#forgot-otp-status').textContent = '';
      $('#forgot-otp').disabled = false;
      $('#forgot-otp-verify').disabled = false;
      showView('login');
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setLoading(btn, false);
    }
  });
}

/* --------------------------------------------------------------------------
   Success view
   -------------------------------------------------------------------------- */
function showSuccess(msg, { btn, href }) {
  $('#success-msg').textContent = msg;
  const done = $('#success-done');
  done.textContent = btn || t('success.continue');
  done.onclick = () => {
    if (href) window.location.href = href;
    else showView('login');
  };
  showView('success');
}

/* --------------------------------------------------------------------------
   Low-bandwidth / offline banner
   -------------------------------------------------------------------------- */
function updateNetStatus() {
  const banner = $('#net-banner');
  const msg = $('#net-msg');
  const icon = $('#net-icon');
  if (!banner) return;
  const conn = navigator.connection || {};
  const slow = ['slow-2g', '2g'].includes(conn.effectiveType);

  if (!navigator.onLine) {
    banner.hidden = false;
    banner.classList.add('offline');
    icon.textContent = '📵';
    msg.textContent = t('net.offline');
  } else if (slow) {
    banner.hidden = false;
    banner.classList.remove('offline');
    icon.textContent = '📶';
    msg.textContent = t('net.slow');
  } else {
    banner.hidden = true;
  }
}

/* --------------------------------------------------------------------------
   Wire-up + init
   -------------------------------------------------------------------------- */
function populateSelects() {
  const stateSel = $('#asha-state');
  STATES.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    stateSel.appendChild(opt);
  });
  $('#district-list').innerHTML = DISTRICTS.map((d) => `<option value="${d}">`).join('');
  const councilSel = $('#doc-council');
  COUNCILS.forEach((c) => councilSel.appendChild(new Option(c, c)));
  const specSel = $('#doc-spec');
  SPECIALIZATIONS.forEach((s) => specSel.appendChild(new Option(s, s)));
}

function init() {
  applyStaticI18n();
  populateSelects();
  populatePhcList();
  wireStrength();
  wireOtp();
  wirePhcDetect();
  wireForgot();

  // Language switcher: persist the choice and re-translate static + dynamic UI.
  const langSel = $('#lang-select');
  if (langSel) {
    langSel.addEventListener('change', () => {
      setLang(langSel.value);
      applyStaticI18n();
      updateDemoHint();
      updateNetStatus();
    });
  }

  // Role tabs: clicking a tab switches role on BOTH views.
  $$('.role-tab').forEach((tab) => {
    tab.addEventListener('click', () => setRole(tab.dataset.role));
  });

  // Login <-> Register <-> Forgot navigation (views stay in the DOM, so
  // whatever the user typed is preserved when they come back).
  $('#to-register').addEventListener('click', (e) => { e.preventDefault(); showView('register'); });
  $('#forgot-link').addEventListener('click', (e) => { e.preventDefault(); showView('forgot'); });
  $$('.to-login').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showView('login'); }));

  // Remember-role preference.
  $('#remember-role').addEventListener('change', (e) => {
    state.rememberRole = e.target.checked;
    if (!e.target.checked) localStorage.removeItem('ga.role');
    else localStorage.setItem('ga.role', state.role);
  });

  // Live re-validation on input (clears errors as the user fixes them).
  document.addEventListener('input', (e) => {
    if (e.target.matches('input, select') && e.target.closest('form')) {
      if (e.target.classList.contains('invalid')) validateField(e.target, e.target.closest('form'));
    }
  });

  // Password show/hide toggles.
  $$('.pw-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.for);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
      btn.setAttribute('aria-label', t(show ? 'pw.hide' : 'pw.show'));
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    });
  });

  // Form submissions.
  $('#login-form').addEventListener('submit', onLogin);
  $$('.role-form').forEach((form) => form.addEventListener('submit', onRegister));

  // Online / connectivity listeners.
  window.addEventListener('online', updateNetStatus);
  window.addEventListener('offline', updateNetStatus);
  if (navigator.connection) navigator.connection.addEventListener('change', updateNetStatus);
  updateNetStatus();

  // Restore remembered role and render.
  state.rememberRole = localStorage.getItem('ga.role') ? true : $('#remember-role').checked;
  setRole(state.role, { persist: false });
  showView('login');
}

document.addEventListener('DOMContentLoaded', init);