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

const ROLE_LABELS = {
  asha:   'ASHA Worker',
  doctor: 'Doctor',
  admin:  'Admin',
  lab:    'Lab Technician',
};

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

  try {
    const res = await fetch(real, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || ('HTTP ' + res.status));
    return data;
  } catch (err) {
    // Network-level failure only -> local mock fallback. Validation errors
    // from the server (401/403/409) are real and must surface as-is.
    if (err instanceof TypeError) return null;
    throw err;
  }
}

async function postMock(url, body) {
  const real = await realPost(url, body);
  if (real) {
    console.info('[api POST]', url, real);
    return real;
  }
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

/* In-memory "database" for registered users, persisted for the browser
   session so a reload keeps the accounts you just created. */
const DB = {
  users: JSON.parse(sessionStorage.getItem('ga.users') || '[]'),
  otp: {},          // phone -> { code, expiresAt }
  save() {
    sessionStorage.setItem('ga.users', JSON.stringify(this.users));
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
    if (!entry || entry.expiresAt < Date.now()) throw new Error('OTP expired. Please request a new one.');
    if (entry.code !== body.code) throw new Error('Incorrect OTP. Please try again.');
    return { ok: true };
  }
  if (url === '/api/auth/register') {
    const exists = DB.users.some((u) => u.phone === body.phone);
    if (exists) throw new Error('An account with this phone number already exists.');
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
    const user = DB.users.find((u) => u.phone === body.phone);
    if (!user) throw new Error('No account found for this phone number.');
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
    const user = DB.users.find((u) => u.role === role && u.phone === username && u.password === password);
    if (user) {
      if (user.approved === false) throw new Error('Your registration is awaiting admin approval. Please try again later.');
      return { ok: true, user: { name: user.name, phone: user.phone, role } };
    }
    throw new Error('Invalid phone number or password.');
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
  required: (v) => (v.trim() ? '' : 'This field is required.'),
  name: (v) => (/^[\p{L}][\p{L}\p{M}\s.'-]*$/u.test(v.trim()) ? '' : 'Name can contain only letters, spaces, dots, apostrophes and hyphens.'),
  phone: (v) => (/^[6-9]\d{9}$/.test(v.trim()) ? '' : 'Enter a valid 10-digit mobile number.'),
  email: (v) => (!v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Enter a valid email address.'),
  pincode: (v) => (/^\d{6}$/.test(v.trim()) ? '' : 'Enter a valid 6-digit PIN code.'),
  ashaId: (v) => (/^[A-Za-z0-9-]{6,20}$/.test(v.trim()) ? '' : 'Enter a valid ASHA ID (6+ letters/digits).'),
  regNo: (v) => (/^[A-Za-z0-9/]{4,20}$/.test(v.trim()) ? '' : 'Enter a valid registration number.'),
  empId: (v) => (/^[A-Za-z0-9-]{3,20}$/.test(v.trim()) ? '' : 'Enter a valid employee ID.'),
  certNo: (v) => (/^[A-Za-z0-9-]{4,20}$/.test(v.trim()) ? '' : 'Enter a valid certification number.'),
  dob: (v) => {
    if (!v) return 'This field is required.';
    const age = (Date.now() - new Date(v).getTime()) / (365.25 * 24 * 3600 * 1000);
    if (age < 18) return 'You must be at least 18 years old.';
    if (age > 75) return 'Please check the date of birth.';
    return '';
  },
  exp: (v) => {
    const n = Number(v);
    if (!v.trim()) return 'This field is required.';
    if (!Number.isFinite(n) || n < 0 || n > 60) return 'Enter years between 0 and 60.';
    return '';
  },
  password: (v) => {
    if (!v) return 'Set a password.';
    if (v.length < 8) return 'Password must be at least 8 characters.';
    if (!/[a-zA-Z]/.test(v) || !/\d/.test(v)) return 'Use both letters and numbers.';
    return '';
  },
  confirm: (v, form) => {
    const main = form.querySelector('input[type="password"]');
    return !v ? 'Confirm your password.' : (v === main.value ? '' : 'Passwords do not match.');
  },
  // Radio groups: the value passed is the radio's own value, so check the
  // group's checked state on the form instead. Error element is looked up
  // by the group `name` (handled in validateField).
  radioRequired: (_v, form) => {
    return form.querySelector('input[type="radio"]:checked') ? '' : 'Please select an option.';
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
      meter.textContent = v ? (score <= 1 ? 'Weak password' : score <= 3 ? 'Okay password' : 'Strong password') : '';
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
      setLoading(btn, true, 'Sending…');
      try {
        const res = await postMock('/api/auth/send-otp', { phone: phoneInput.value });
        statusEl.className = 'status ok';
        // Demo only: real deployments send the code by SMS instead of showing it.
        statusEl.textContent = `Demo SMS sent to ${phoneInput.value.slice(0, 2)}******${phoneInput.value.slice(-2)} — OTP is ${res.demoCode}`;
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
        statusEl.textContent = 'Enter the 6-digit OTP.';
        return;
      }
      setLoading(btn, true, 'Verifying…');
      try {
        await postMock('/api/auth/verify-otp', { phone: phone.value, code: otpInput.value });
        statusEl.className = 'status ok';
        statusEl.textContent = '✅ Phone verified.';
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
    toast('Location not available on this device — please pick your PHC from the list.', 'bad');
    return;
  }
  setLoading(btn, true, 'Detecting…');
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
    toast(`📍 Nearest facility detected: ${nearest.name}`, 'ok');
  } catch {
    toast('Could not detect location. Please search and pick your PHC manually.', 'bad');
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
    `<b>Demo ${ROLE_LABELS[state.role]} login</b>` +
    `Phone: <a href="#" class="link" data-fill="phone">${demo.phone}</a> · ` +
    `Password: <a href="#" class="link" data-fill="pass">${demo.pass}</a> · ` +
    `(<a href="#" class="link" data-fill="all">tap to fill</a>)`;
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
  setLoading(btn, true, 'Signing in…');
  try {
    const { username, password } = {
      username: $('#login-user').value.trim(),
      password: $('#login-pass').value,
    };
    const res = await postMock('/api/auth/login', { role: state.role, username, password });
    showSuccess(`Welcome, ${res.user.name}! You are signed in as ${ROLE_LABELS[state.role]}.`, {
      btn: 'Continue to ' + ROLE_LABELS[state.role] + ' portal',
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
    markInvalid(phoneInput, 'Please verify your phone number with OTP first.');
    phoneInput.focus();
    return;
  }

  const firstBad = validateForm(form);
  if (firstBad) { firstBad.focus(); return; }

  const btn = form.querySelector('.submit-btn');
  setLoading(btn, true, 'Submitting…');
  try {
    const payload = collectForm(form);
    const res = await postMock('/api/auth/register', payload);

    let msg;
    if (role === 'doctor') {
      msg = `Thank you, ${payload.name}! Your doctor registration has been submitted. An admin will review and approve it — you can sign in once approved.`;
    } else if (role === 'asha') {
      msg = `Welcome, ${payload.name}! Your ASHA Worker account has been created. You can sign in now.`;
    } else {
      msg = `Welcome, ${payload.name}! Your ${ROLE_LABELS[role]} account has been created. You can sign in now.`;
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

    showSuccess(msg, { btn: 'Go to sign in', href: null });
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
      statusEl.textContent = 'Enter the 6-digit OTP.';
      return;
    }
    setLoading(btn, true, 'Verifying…');
    try {
      await postMock('/api/auth/verify-otp', { phone: phone.value, code: otpInput.value });
      statusEl.className = 'status ok';
      statusEl.textContent = '✅ Verified. Now set your new password.';
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
    setLoading(btn, true, 'Resetting…');
    try {
      await postMock('/api/auth/reset-password', {
        role: state.role,
        phone: $('#forgot-phone').value.trim(),
        password: $('#forgot-pass').value,
      });
      toast('Password updated. Please sign in with your new password.', 'ok');
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
  done.textContent = btn || 'Continue';
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
    msg.textContent = 'You are offline. The portal still works — forms are saved and will sync when you are back online.';
  } else if (slow) {
    banner.hidden = false;
    banner.classList.remove('offline');
    icon.textContent = '📶';
    msg.textContent = 'Low connectivity — this page is lightweight and works on slow networks.';
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
  populateSelects();
  populatePhcList();
  wireStrength();
  wireOtp();
  wirePhcDetect();
  wireForgot();

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
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
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