/* GramArogya — Doctor (PHC) portal.
 *
 * One shared script; every page announces itself with <body data-page="...">.
 * Role header: X-GramArogya-Role: doctor (demo RBAC on write endpoints).
 */

const API = '/api/v1';
const ROLE = 'doctor';
const FAC_KEY = 'ga_doctor_facility';
const PAGE = document.body.dataset.page || 'dashboard';
const DOCTOR_NAME = 'Dr. Anil Verma';

let currentFacilityId = localStorage.getItem(FAC_KEY) || null;
let FACILITIES = null;
let MEDICINES = null;      // [{id, generic_name, brand_name}]
let MED_STOCK = {};        // medicine_id -> {stock, low, oos, inventory_id, facility}
let AVAILABILITY = {};     // medicine_id -> [nearby rows]

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json', 'X-GramArogya-Role': ROLE }, options.headers || {});
  const res = await fetch(API + path, Object.assign({}, options, { headers }));
  if (!res.ok) {
    let detail = res.statusText;
    try { const body = await res.json(); detail = body.detail || JSON.stringify(body); } catch (e) { /* keep status */ }
    throw new Error('HTTP ' + res.status + ': ' + detail);
  }
  return res.json();
}

function toast(msg, kind) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.hidden = false;
  el.textContent = msg;
  el.className = 'toast show ' + (kind || '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 4200);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtDur(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const m = Math.round(seconds / 60);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
function chip(label, extra) {
  return '<span class="badge ' + esc(extra || '') + '">' + esc(label) + '</span>';
}

async function getFacilities() {
  if (FACILITIES) return FACILITIES;
  FACILITIES = await api('/facilities');
  return FACILITIES;
}
async function ensureFacility() {
  const facs = await getFacilities();
  if (!currentFacilityId || !facs.some((f) => f.id === currentFacilityId)) {
    const phc = facs.find((f) => f.facility_type === 'phc') || facs[0];
    currentFacilityId = phc ? phc.id : null;
  }
  return currentFacilityId;
}
function facilityName(id) {
  const f = FACILITIES && FACILITIES.find((x) => x.id === id);
  return f ? f.name : '—';
}
function setFacility(id) {
  currentFacilityId = id;
  if (id) localStorage.setItem(FAC_KEY, id);
}
async function loadMedicineData() {
  if (MEDICINES) return;
  const [meds, inv] = await Promise.all([api('/inventory/medicines'), api('/inventory')]);
  MEDICINES = meds;
  inv.forEach((r) => {
    MED_STOCK[r.medicine_id] = {
      stock: r.stock_units, reorder: r.reorder_level,
      low: r.is_low, oos: r.is_out_of_stock,
      inventory_id: r.id, facility_id: r.facility_id, facility: r.facility_name,
    };
  });
}
async function availabilityFor(medicineId) {
  if (!AVAILABILITY[medicineId]) {
    try {
      const rows = await api('/inventory/medicine/' + medicineId + '/availability?facility_id=' + encodeURIComponent(currentFacilityId));
      AVAILABILITY[medicineId] = rows;
    } catch (e) { AVAILABILITY[medicineId] = []; }
  }
  return AVAILABILITY[medicineId];
}
function stockLabel(medId) {
  const s = MED_STOCK[medId];
  if (!s) return '';
  if (s.oos) return '<span class="badge out">Out of stock</span>';
  if (s.low) return '<span class="badge low">Low (' + s.stock + ')</span>';
  return '<span class="badge available">In stock (' + s.stock + ')</span>';
}
async function nearbyFallback(medId) {
  const s = MED_STOCK[medId];
  if (!s || (!s.oos && !s.low)) return '<span class="muted">—</span>';
  const rows = await availabilityFor(medId);
  const nearest = rows[0];
  if (!nearest) return '<span class="muted">No nearby stock found</span>';
  return '<span class="small">' + nearest.stock_units + ' units @ ' + esc(nearest.facility_name) +
    (nearest.distance_km != null ? ' (' + nearest.distance_km + ' km)' : '') + '</span>';
}

/* ------------------------------------------------------------------ */
/* Shared: facility select binding                                     */
/* ------------------------------------------------------------------ */
async function bindFacilitySelect(selectId, onPick) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const facs = await getFacilities();
  sel.innerHTML = facs.map((f) =>
    '<option value="' + f.id + '">' + esc(f.name) + ' (' + f.facility_type + ')</option>').join('');
  await ensureFacility();
  sel.value = currentFacilityId;
  sel.addEventListener('change', () => {
    setFacility(sel.value);
    if (onPick) onPick();
  });
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */
async function initDashboard() {
  await bindFacilitySelect('facility-select', () => loadDashboard());
  await loadDashboard();
}

async function loadDashboard() {
  await ensureFacility();
  const facId = currentFacilityId;
  const phc = await api('/dashboard/phc?facility_id=' + encodeURIComponent(facId));

  const statMap = {
    'Today\'s OPD': phc.opd_today, 'Patients in queue': phc.in_queue,
    'Waiting for consult': phc.waiting_appointments, 'RED / emergency': phc.red_cases,
    'Pending referrals': phc.pending_referrals, 'Pending lab reports': phc.pending_lab_orders,
    'Follow-ups due': phc.followups_due_today, 'Medicine stock-outs': phc.stockouts,
    'Queued SMS': phc.queued_messages,
  };
  const cards = document.querySelectorAll('#stat-cards .stat-card');
  cards.forEach((card) => {
    const label = card.querySelector('span').textContent;
    const v = statMap[label];
    card.querySelector('b').textContent = v === undefined ? '—' : v;
    const danger = label === 'RED / emergency' || label === 'Medicine stock-outs' || label === 'Follow-ups due';
    card.classList.toggle('danger', danger && v > 0);
  });

  const redAlert = document.getElementById('red-alert');
  if (redAlert) {
    redAlert.hidden = phc.red_cases === 0;
    document.getElementById('red-alert-text').textContent =
      phc.red_cases + ' patient(s) flagged RED by triage in the last 48h.';
  }

  // Weekly OPD chart
  const chart = document.getElementById('opd-chart');
  if (chart) {
    const max = Math.max(1, ...phc.weekly_opd.map((d) => d.count));
    chart.innerHTML = phc.weekly_opd.map((d) => {
      const h = Math.max(4, Math.round((d.count / max) * 130));
      return '<div class="bar-col"><div class="bar" style="height:' + h + 'px"><span>' + d.count + '</span></div>' +
        '<small>' + new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }) + '</small></div>';
    }).join('');
  }

  // Follow-ups due
  try {
    const fus = await api('/followups');
    const due = fus.filter((x) => x.bucket === 'due_today' || x.bucket === 'overdue');
    const body = document.getElementById('fu-due-body');
    body.innerHTML = due.slice(0, 8).map((x) =>
      '<tr><td><b>' + esc(x.patient_name) + '</b></td><td class="small">' + esc(x.task || x.category) + '</td>' +
      '<td>' + fmtDate(x.due_date) + '</td><td>' + chip(x.priority === 'urgent' ? 'urgent' : '—', x.priority) + '</td></tr>'
    ).join('');
    document.getElementById('fu-empty').hidden = due.length > 0;
  } catch (e) { /* non-critical */ }

  // Stock + queue previews
  try {
    const inv = await api('/inventory?facility_id=' + encodeURIComponent(facId) + '&low_only=true');
    document.getElementById('stock-body').innerHTML = inv.map((r) =>
      '<tr><td><b>' + esc(r.medicine_name || r.generic_name) + '</b></td>' +
      '<td>' + r.stock_units + '</td><td>' +
      (r.is_out_of_stock ? chip('OUT', 'out') : chip('LOW', 'low')) + '</td></tr>'
    ).join('');
  } catch (e) { /* ignore */ }

  try {
    const rows = await api('/appointments/queue/today?facility_id=' + encodeURIComponent(facId));
    const active = rows.filter((r) => r.status === 'waiting' || r.status === 'in_consultation').slice(0, 6);
    document.getElementById('queue-preview').innerHTML = active.map((r) =>
      '<tr><td><b>#' + r.token + '</b></td><td>' + esc(r.patient_name) +
      '</td><td>' + chip(r.priority, r.priority) + '</td><td>' + chip(r.status.replace('_', ' '), r.status) +
      '</td><td class="small"><a href="patient.html?id=' + r.patient_id + '&appt=' + r.id + '">Consult →</a></td></tr>'
    ).join('');
  } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* OPD Queue                                                           */
/* ------------------------------------------------------------------ */
async function initQueue() {
  await ensureFacility();
  document.getElementById('refresh-btn').addEventListener('click', loadQueue);
  document.getElementById('queue-filter').addEventListener('change', renderOpdTable);
  document.getElementById('book-btn').addEventListener('click', bookAppointment);
  document.getElementById('new-appt-patient').addEventListener('input', debounce(searchApptPatient, 350));

  await loadQueue();
  setInterval(loadQueue, 20000);
}

function debounce(fn, ms) {
  let t = null;
  return function () { clearTimeout(t); t = setTimeout(fn, ms); };
}

let QUEUE_OPD = [];
let QUEUE_TRIAGE = [];

async function loadQueue() {
  await ensureFacility();
  try {
    QUEUE_OPD = await api('/appointments/queue/today?facility_id=' + encodeURIComponent(currentFacilityId));
  } catch (e) { QUEUE_OPD = []; }
  try {
    QUEUE_TRIAGE = await api('/queue?facility_id=' + encodeURIComponent(currentFacilityId) + '&hours=48');
  } catch (e) { QUEUE_TRIAGE = []; }
  document.getElementById('updated-at').textContent = 'Updated ' + new Date().toLocaleTimeString();
  renderTriageTable();
  renderOpdTable();
}

function renderTriageTable() {
  const rows = QUEUE_TRIAGE;
  const body = document.getElementById('triage-body');
  body.innerHTML = rows.map((r) => {
    const color = r.triage_color || '—';
    const flash = color === 'RED' ? ' class="flash"' : '';
    return '<tr' + flash + '><td><b>' + esc(r.patient_name) + '</b><br><span class="patient-id">' +
      esc(r.abha_id) + '</span></td>' +
      '<td>' + esc(r.chief_complaint || '—') + '</td>' +
      '<td>' + (color !== '—' ? chip(color, color) : '—') + '</td>' +
      '<td class="small">' + esc((r.triage_reasons || []).join('; ')) + '</td>' +
      '<td>' + fmtDT(r.visited_at) + '</td>' +
      '<td><button class="small" onclick="location.href=\'patient.html?id=' + r.patient_id +
      '&enc=' + r.encounter_id + '&from=triage\'">Consult →</button></td></tr>';
  }).join('');
  document.getElementById('triage-empty').hidden = rows.length > 0;
}

function renderOpdTable() {
  const filter = document.getElementById('queue-filter').value;
  const rows = QUEUE_OPD.filter((r) => filter === 'all' || r.status === filter);
  const body = document.getElementById('opd-body');
  body.innerHTML = rows.map((r) =>
    '<tr><td><b>#' + r.token + '</b></td>' +
    '<td><b>' + esc(r.patient_name) + '</b><br><span class="patient-id">' + esc(r.abha_id) + '</span></td>' +
    '<td>' + chip(r.priority.replace('_', ' '), r.priority) + '</td>' +
    '<td class="small">' + esc(r.reason || '—') + '</td>' +
    '<td class="small">' + (r.status === 'waiting' ? '~' + r.est_wait_min + ' min' : '—') + '</td>' +
    '<td>' + statusSelect(r) + '</td>' +
    '<td>' + (r.status === 'waiting'
      ? '<button class="small" onclick="location.href=\'patient.html?id=' + r.patient_id + '&appt=' + r.id + '\'">Consult →</button>'
      : '') + '</td></tr>'
  ).join('');
  document.getElementById('opd-empty').hidden = rows.length > 0;
  bindApptStatus();
}

function statusSelect(r) {
  const opts = ['waiting', 'in_consultation', 'completed', 'no_show']
    .map((s) => '<option value="' + s + '"' + (r.status === s ? ' selected' : '') + '>' +
      s.replace('_', ' ') + '</option>').join('');
  return '<select class="appt-status" data-id="' + r.id + '" style="width:auto">' + opts + '</select>';
}

function bindApptStatus() {
  document.querySelectorAll('.appt-status').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await api('/appointments/' + sel.getAttribute('data-id'), {
          method: 'PATCH',
          body: JSON.stringify({ status: sel.value }),
        });
        toast('Token status updated → ' + sel.value, 'ok');
        loadQueue();
      } catch (e) { toast('Update failed: ' + e.message, 'error'); loadQueue(); }
    });
  });
}

let SELECTED_PATIENT = null;
async function searchApptPatient() {
  const q = document.getElementById('new-appt-patient').value.trim();
  const hint = document.getElementById('appt-patient-hint');
  if (q.length < 4) { hint.textContent = ''; SELECTED_PATIENT = null; return; }
  try {
    const rows = await api('/patients?q=' + encodeURIComponent(q));
    if (!rows.length) { hint.textContent = 'No patient found.'; SELECTED_PATIENT = null; return; }
    hint.innerHTML = rows.map((p) =>
      '<button type="button" class="link" data-pick="' + p.id + '">' + esc(p.name) +
      ' · ' + p.abha_id + '</button>').join('<br>');
    hint.querySelectorAll('[data-pick]').forEach((b) => {
      b.addEventListener('click', () => {
        SELECTED_PATIENT = rows.find((p) => p.id === b.getAttribute('data-pick'));
        document.getElementById('new-appt-patient').value = SELECTED_PATIENT.name + ' (' + SELECTED_PATIENT.abha_id + ')';
        hint.textContent = 'Selected ✓';
      });
    });
  } catch (e) { hint.textContent = e.message; }
}

async function bookAppointment() {
  if (!SELECTED_PATIENT) { toast('Pick a patient first (search above)', 'warn'); return; }
  try {
    const appt = await api('/appointments', {
      method: 'POST',
      body: JSON.stringify({
        patient_id: SELECTED_PATIENT.id,
        facility_id: currentFacilityId,
        priority: document.getElementById('new-appt-priority').value,
        reason: document.getElementById('new-appt-reason').value,
      }),
    });
    toast('Booked — token #' + appt.token + ' for ' + appt.patient_name + ' (SMS reminder queued)', 'ok');
    document.getElementById('new-appt-patient').value = '';
    document.getElementById('new-appt-reason').value = '';
    SELECTED_PATIENT = null;
    loadQueue();
  } catch (e) { toast(e.message, 'error'); }
}

/* ------------------------------------------------------------------ */
/* Patient consult                                                     */
/* ------------------------------------------------------------------ */
const Q = new URLSearchParams(location.search);
let P = null;              // patient
let ENC_ID = Q.get('enc') || '';      // existing triage encounter (from queue)
let APPT_ID = Q.get('appt') || '';
let RX_ITEMS = [];
let CHECKED_TESTS = [];

async function initPatient() {
  await ensureFacility();
  const searchBtn = document.getElementById('patient-search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', searchPatients);
    document.getElementById('patient-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchPatients(); });
    document.getElementById('print-rx-btn').addEventListener('click', printPrescription);
    document.getElementById('add-med-btn').addEventListener('click', () => addRxRow());
    document.getElementById('save-consult-btn').addEventListener('click', saveConsultation);
  }
  await loadMedicineData();

  const id = Q.get('id');
  if (!id) {
    document.getElementById('no-patient').hidden = false;
    return;
  }
  document.getElementById('no-patient').hidden = true;
  try {
    P = await api('/patients/' + id);
  } catch (e) { toast('Patient not found', 'error'); return; }
  document.getElementById('patient-main').hidden = false;
  fillPatientHeader();
  renderTimeline();
  await buildTestChecks();
  addRxRow();
}

async function searchPatients() {
  const q = document.getElementById('patient-search').value.trim();
  const box = document.getElementById('patient-search-results');
  if (q.length < 3) return;
  try {
    const rows = await api('/patients?q=' + encodeURIComponent(q));
    box.innerHTML = rows.length
      ? rows.map((p) => '<div><a href="patient.html?id=' + p.id + '">' + esc(p.name) +
        ' · ' + p.abha_id + ' · ' + esc(p.village || '') + '</a></div>').join('')
      : '<span class="muted">No patients found.</span>';
  } catch (e) { box.textContent = e.message; }
}

function fillPatientHeader() {
  document.getElementById('p-name').textContent = P.name + ' ' + (P.blood_group ? '(' + P.blood_group + ')' : '');
  document.getElementById('enc-id').textContent = ENC_ID || 'new visit';
  const age = ageFrom(P.dob);
  document.getElementById('p-meta').innerHTML =
    '<dt>ABHA</dt><dd class="patient-id">' + esc(P.abha_id) + '</dd>' +
    '<dt>Age / Gender</dt><dd>' + age + ' yrs · ' + esc(P.gender) + '</dd>' +
    '<dt>Mobile</dt><dd>' + esc(P.phone || '—') + '</dd>' +
    '<dt>Address</dt><dd>' + esc([P.village, P.district, P.state].filter(Boolean).join(', ')) +
    (P.pincode ? ' – ' + P.pincode : '') + (P.family_id ? ' · Family ' + esc(P.family_id) : '') + '</dd>' +
    (P.allergies && P.allergies.length ? '<dt class="small" style="color:var(--red)">Allergies</dt><dd>' +
      esc(P.allergies.join(', ')) + '</dd>' : '');
}

function ageFrom(dobIso) {
  if (!dobIso) return '?';
  const d = new Date(dobIso); const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a >= 0 ? a : '?';
}

async function renderTimeline() {
  const box = document.getElementById('timeline');
  try {
    const items = await api('/patients/' + P.id + '/timeline');
    if (!items.length) { box.innerHTML = '<p class="empty">No records yet.</p>'; return; }
    box.innerHTML = '<ul class="timeline">' + items.map((it) =>
      '<li class="kind-' + esc(it.kind) + ' ' + esc(it.status || '') + '">' +
      '<div class="t-title">' + esc(it.title) + '</div>' +
      (it.facility ? '<div class="t-meta">🏥 ' + esc(it.facility) + '</div>' : '') +
      (it.detail ? '<div class="t-detail">' + esc(it.detail) + '</div>' : '') +
      '<div class="t-meta">' + fmtDT(it.occurred_at) + (it.status ? ' · ' + esc(it.status) : '') + '</div>' +
      '</li>').join('') + '</ul>';
  } catch (e) { box.textContent = e.message; }
}

async function buildTestChecks() {
  const box = document.getElementById('test-checks');
  try {
    const tests = await api('/lab/tests');
    CHECKED_TESTS = [];
    box.innerHTML = tests.map((t) =>
      '<label style="font-weight:400;display:inline-flex;gap:6px;margin:2px 10px 2px 0;align-items:center">' +
      '<input type="checkbox" value="' + t.code + '" data-name="' + esc(t.name) + '" style="width:auto"> ' +
      esc(t.name) + (t.ref_display ? ' <span class="muted">(' + t.ref_display + ')</span>' : '') + '</label>').join('');
  } catch (e) { box.textContent = 'Lab catalogue unavailable'; }
}

function addRxRow() {
  const wrap = document.getElementById('rx-items');
  const row = document.createElement('div');
  row.className = 'prescription-item';
  row.innerHTML =
    '<div><label>Medicine</label><select class="rx-med">' +
    (MEDICINES || []).map((m) => '<option value="' + m.id + '">' + esc(m.brand_name || m.generic_name) + '</option>').join('') +
    '</select><div class="drug-hint"></div></div>' +
    '<div><label>Dosage</label><input type="text" class="rx-dose" placeholder="1 tab twice daily"></div>' +
    '<div><label>Duration</label><input type="text" class="rx-dur" placeholder="5 days"></div>' +
    '<button class="small secondary rx-del" type="button">✕</button>';
  wrap.appendChild(row);
  const hint = row.querySelector('.drug-hint');
  const sel = row.querySelector('.rx-med');
  const refresh = () => {
    const m = (MEDICINES || []).find((x) => x.id === sel.value);
    const s = MED_STOCK[m && m.id];
    if (!s) { hint.innerHTML = ''; return; }
    hint.innerHTML = stockLabel(m.id) + ' ';
    if (s.low || s.oos) {
      availabilityFor(m.id).then((rows) => {
        const n = rows[0];
        hint.innerHTML = stockLabel(m.id) + ' <span>→ ' + (n ? n.stock_units + ' at ' + esc(n.facility_name) +
          (n.distance_km != null ? ' (' + n.distance_km + ' km)' : '') : 'no nearby stock') + '</span>';
      });
    }
  };
  sel.addEventListener('change', refresh);
  refresh();
  row.querySelector('.rx-del').addEventListener('click', () => row.remove());
}

function collectRx() {
  const items = [];
  document.querySelectorAll('#rx-items .prescription-item').forEach((row) => {
    const m = (MEDICINES || []).find((x) => x.id === row.querySelector('.rx-med').value);
    const dose = row.querySelector('.rx-dose').value.trim();
    const dur = row.querySelector('.rx-dur').value.trim();
    if (!m) return;
    items.push({
      medicine_id: m.id,
      name: m.brand_name || m.generic_name,
      generic_name: m.generic_name,
      dosage: dose, duration: dur,
    });
  });
  return items;
}

async function saveConsultation() {
  const v = (id) => {
    const el = document.getElementById(id);
    const val = el && el.value !== '' ? Number(el.value) : null;
    return Number.isFinite(val) ? val : null;
  };
  const vitals = {
    temperature: v('v-temp'), pulse: v('v-pulse'),
    systolic_bp: v('v-sbp'), diastolic_bp: v('v-dbp'),
    spo2: v('v-spo2'), respiratory_rate: v('v-rr'),
  };
  const payload = {
    diagnosis: document.getElementById('c-diagnosis').value.trim() || null,
    notes: document.getElementById('c-notes').value.trim() || null,
    advice: document.getElementById('c-advice').value.trim() || null,
    status: document.getElementById('c-status').value,
    vitals: Object.values(vitals).some((x) => x !== null) ? vitals : null,
    follow_up_at: document.getElementById('c-followup').value ? new Date(document.getElementById('c-followup').value).toISOString() : null,
  };

  const btn = document.getElementById('save-consult-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    // 1) Open an OPD encounter if none exists yet (walk-in / appointment)
    if (!ENC_ID) {
      const created = await api('/encounters', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: P.id,
          facility_id: currentFacilityId,
          chief_complaint: payload.diagnosis || null,
          appointment_id: APPT_ID || null,
        }),
      });
      ENC_ID = created.id;
      document.getElementById('enc-id').textContent = ENC_ID;
    }

    // 2) Save consultation back to the encounter
    await api('/encounters/' + ENC_ID, { method: 'PATCH', body: JSON.stringify(payload) });

    // 3) e-prescription
    const items = collectRx();
    if (items.length) {
      await api('/prescriptions', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: P.id,
          facility_id: currentFacilityId,
          doctor_name: DOCTOR_NAME,
          items: items,
          follow_up_at: payload.follow_up_at,
        }),
      });
    }

    // 4) Lab orders
    const chosen = [];
    document.querySelectorAll('#test-checks input:checked').forEach((cb) => {
      chosen.push({ code: cb.value, name: cb.getAttribute('data-name') });
    });
    if (chosen.length) {
      await api('/lab/orders', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: P.id,
          encounter_id: ENC_ID,
          facility_id: currentFacilityId,
          ordered_by: DOCTOR_NAME,
          tests: chosen,
        }),
      });
    }

    toast('Consultation saved ✓ (diagnosis, ' + items.length + ' medicine(s)' +
      (chosen.length ? ', ' + chosen.length + ' lab order(s)' : '') + ')', 'ok');
    renderTimeline();
    CHECKED_TESTS = chosen;
    document.querySelectorAll('#test-checks input:checked').forEach((cb) => { cb.checked = false; });
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save consultation & prescription';
  }
}

function printPrescription() {
  const items = collectRx();
  if (!items.length) { toast('Nothing prescribed yet — add medicines first', 'warn'); return; }
  const area = document.getElementById('print-area');
  const diagnosis = document.getElementById('c-diagnosis').value.trim();
  const advice = document.getElementById('c-advice').value.trim();
  const fu = document.getElementById('c-followup').value;
  area.innerHTML =
    '<h2 style="margin-top:0">GramArogya — e-Prescription</h2>' +
    '<p class="muted">' + facilityName(currentFacilityId) + ' · ' + new Date().toLocaleString() + '</p>' +
    '<hr>' +
    '<p><b>' + esc(P.name) + '</b> (' + ageFrom(P.dob) + 'y, ' + esc(P.gender) + ') · ABHA ' + esc(P.abha_id) + '<br>' +
    '<span class="muted">' + esc([P.village, P.district, P.state].filter(Boolean).join(', ')) + '</span></p>' +
    (diagnosis ? '<p><b>Diagnosis:</b> ' + esc(diagnosis) + '</p>' : '') +
    '<table style="width:100%"><tr><th>Medicine</th><th>Dosage</th><th>Duration</th></tr>' +
    items.map((i) => '<tr><td>' + esc(i.name) + '</td><td>' + esc(i.dosage) + '</td><td>' + esc(i.duration) + '</td></tr>').join('') +
    '</table>' +
    (advice ? '<p><b>Advice:</b> ' + esc(advice) + '</p>' : '') +
    (fu ? '<p><b>Next follow-up:</b> ' + new Date(fu).toLocaleString() + '</p>' : '') +
    '<p style="margin-top:24px">Dr. Anil Verma<br><span class="muted">Medical Officer</span></p>';
  window.print();
}

/* ------------------------------------------------------------------ */
/* Teleconsult                                                         */
/* ------------------------------------------------------------------ */
let ACTIVE_CALL = null;
let CALL_SECONDS = 0;
let CALL_TIMER = null;
let TELECONFIG = { provider: 'jitsi', daily_domain: '', simulated: false };
let LIVE_CALL_URL = null;

async function initTeleconsult() {
  await ensureFacility();
  try { TELECONFIG = await api('/teleconsult/config'); } catch (e) { /* keep default */ }
  document.getElementById('refresh-btn').addEventListener('click', loadTeleconsult);
  document.getElementById('call-end').addEventListener('click', endCall);
  document.getElementById('call-mute').addEventListener('click', toggleMute);
  document.getElementById('call-video-toggle').addEventListener('click', toggleVideo);
  document.getElementById('copy-link').addEventListener('click', copyJoinLink);
  document.getElementById('use-simulated').addEventListener('click', useSimulatedCall);
  document.getElementById('call-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'call-overlay') closeCall(false);
  });
  loadTeleconsult();
  setInterval(loadTeleconsult, 25000);
}

async function loadTeleconsult() {
  let reqs = [];
  try { reqs = await api('/teleconsult'); } catch (e) { toast(e.message, 'error'); }
  const requested = reqs.filter((r) => r.status === 'requested');
  const active = reqs.filter((r) => r.status === 'accepted');
  const history = reqs.filter((r) => r.status !== 'requested' && r.status !== 'accepted');

  document.getElementById('requested-body').innerHTML = requested.map((r) =>
    '<tr><td><b>' + esc(r.patient_name) + '</b><br><span class="muted small">' + esc(r.village || '') + ' · ' + r.age + 'y ' + esc(r.gender) + '</span></td>' +
    '<td>' + chip(r.mode, r.mode === 'video' ? 'in_consultation' : 'requested') + '</td>' +
    '<td>' + esc(r.requested_by) + '</td>' +
    '<td class="small">' + esc(r.reason || '—') + '</td>' +
    '<td>' + fmtDT(r.requested_at) + '</td>' +
    '<td><button class="small" onclick="actTeleconsult(\'' + r.id + '\',\'accept\')">Accept</button> ' +
    '<button class="small danger" onclick="actTeleconsult(\'' + r.id + '\',\'decline\')">Decline</button></td></tr>'
  ).join('');
  document.getElementById('requested-empty').hidden = requested.length > 0;

  document.getElementById('active-body').innerHTML = active.map((r) =>
    '<tr><td><b>' + esc(r.patient_name) + '</b><br><span class="muted small">' + esc(r.reason || '') + '</span></td>' +
    '<td>' + chip(r.mode, 'in_consultation') + '</td>' +
    '<td>' + (r.started_at ? fmtDT(r.started_at) : fmtDT(r.accepted_at)) + '</td>' +
    '<td class="small">' + esc(r.diagnosis || '—') + '</td>' +
    '<td><button class="small" onclick="openCall(\'' + r.id + '\')">' + (r.started_at ? 'Join call' : '▶ Start call') + '</button></td></tr>'
  ).join('');
  document.getElementById('active-empty').hidden = active.length > 0;

  document.getElementById('history-body').innerHTML = history.map((r) =>
    '<tr><td><b>' + esc(r.patient_name) + '</b></td>' +
    '<td>' + chip(r.mode, 'dispatched') + '</td>' +
    '<td>' + chip(r.status.replace('_', ' '), r.status) + '</td>' +
    '<td>' + esc(r.doctor_name || '—') + '</td>' +
    '<td class="small">' + esc(r.diagnosis || '—') + '</td>' +
    '<td>' + fmtDT(r.ended_at || r.requested_at) + '</td></tr>'
  ).join('');
  document.getElementById('history-empty').hidden = history.length > 0;
}

async function actTeleconsult(id, action) {
  try {
    await api('/teleconsult/' + id + '/action', {
      method: 'PATCH',
      body: JSON.stringify({ action: action, doctor_name: DOCTOR_NAME }),
    });
    toast(action === 'accept' ? 'Request accepted — start the call when ready' : 'Request declined', 'ok');
    loadTeleconsult();
  } catch (e) { toast(e.message, 'error'); }
}

async function openCall(id) {
  try {
    const reqs = await api('/teleconsult');
    const req = reqs.find((r) => r.id === id);
    if (!req) return;
    if (!req.started_at) {
      await api('/teleconsult/' + id + '/action', {
        method: 'PATCH', body: JSON.stringify({ action: 'start', doctor_name: DOCTOR_NAME }),
      });
    }
    ACTIVE_CALL = Object.assign({}, req, { started_at: new Date().toISOString() });
    document.getElementById('call-name').textContent = req.patient_name +
      (req.mode === 'audio' ? ' — audio' : req.mode === 'video' ? ' — video' : ' — chat');
    document.getElementById('call-diagnosis').value = req.diagnosis || '';
    document.getElementById('call-advice').value = req.advice || '';
    document.getElementById('call-notes').value = req.notes || '';
    document.getElementById('call-save-status').textContent = '';
    document.getElementById('call-overlay').classList.add('open');
    CALL_SECONDS = 0;
    tickTimer();
    CALL_TIMER = setInterval(tickTimer, 1000);
    setupLiveCall(req);
  } catch (e) { toast(e.message, 'error'); }
}

/* Live WebRTC call: Jitsi Meet by default (no API key), Daily.co if
 * TELECONSULT_PROVIDER=daily is configured. Falls back to the simulated
 * avatar/timer UI when the server says the provider is 'simulated'. */
function buildJoinUrl(req) {
  // Server supplies the canonical room link so the doctor and the ASHA
  // worker always see the same join URL.
  if (req.join_url) return req.join_url;
  const room = 'gramarogya-' + req.id;
  if (TELECONFIG.provider === 'daily' && TELECONFIG.daily_domain) {
    return 'https://' + TELECONFIG.daily_domain + '/' + room;
  }
  return 'https://meet.jit.si/GramArogya-' + req.id;
}

function setupLiveCall(req) {
  const liveBox = document.getElementById('call-live');
  const callBox = document.querySelector('.call-box');
  const simVideo = document.getElementById('call-video-sim');
  const simulated = TELECONFIG.simulated;
  if (simulated) {
    if (liveBox) liveBox.hidden = true;
    if (callBox) callBox.classList.remove('live');
    if (simVideo) simVideo.hidden = false;
    return;
  }

  const joinUrl = buildJoinUrl(req);
  LIVE_CALL_URL = joinUrl;
  document.getElementById('join-link').value = joinUrl;
  document.getElementById('call-iframe-wrap').innerHTML =
    '<iframe src="' + joinUrl + '" allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write" allowfullscreen></iframe>';
  document.getElementById('join-hint').textContent =
    'Send this link to the patient (SMS / WhatsApp) so they can join the live call.';
  if (liveBox) liveBox.hidden = false;
  if (callBox) callBox.classList.add('live');
  if (simVideo) simVideo.hidden = true;
  queueJoinLinkSms(req, joinUrl);
}

async function queueJoinLinkSms(req, joinUrl) {
  try {
    const p = await api('/patients/' + req.patient_id);
    if (p && p.phone) {
      await api('/messages', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: p.id,
          recipient_name: p.name,
          recipient_phone: p.phone,
          message_text: 'Your doctor video call link: ' + joinUrl + ' — GramArogya',
          channel: 'sms',
        }),
      });
      document.getElementById('join-hint').textContent =
        '📨 SMS with the join link queued to ' + p.phone + ' (dispatch fires on ASHA Sync / server restart).';
    } else {
      document.getElementById('join-hint').textContent =
        'No phone number on file — share the link via SMS/WhatsApp manually.';
    }
  } catch (e) { /* keep default hint */ }
}

function copyJoinLink() {
  if (!LIVE_CALL_URL) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(LIVE_CALL_URL).then(
      () => toast('Join link copied — send it to the patient', 'ok'),
      () => toast('Could not copy — link shown above', 'warn')
    );
  } else {
    document.getElementById('join-link').select();
    document.execCommand('copy');
    toast('Join link copied — send it to the patient', 'ok');
  }
}

function useSimulatedCall() {
  const liveBox = document.getElementById('call-live');
  const callBox = document.querySelector('.call-box');
  const simVideo = document.getElementById('call-video-sim');
  if (liveBox) liveBox.hidden = true;
  if (callBox) callBox.classList.remove('live');
  if (simVideo) simVideo.hidden = false;
  document.getElementById('call-iframe-wrap').innerHTML = '';
}
function tickTimer() {
  CALL_SECONDS++;
  const m = String(Math.floor(CALL_SECONDS / 60)).padStart(2, '0');
  const s = String(CALL_SECONDS % 60).padStart(2, '0');
  document.getElementById('call-timer').textContent = m + ':' + s;
}
function toggleMute() {
  const b = document.getElementById('call-mute');
  b.classList.toggle('active-on');
  b.textContent = b.classList.contains('active-on') ? '🔇' : '🎤';
}
function toggleVideo() {
  const b = document.getElementById('call-video-toggle');
  b.classList.toggle('active-on');
  b.textContent = b.classList.contains('active-on') ? '📹 (on)' : '📹 (off)';
}
async function endCall() {
  if (!ACTIVE_CALL) return;
  clearInterval(CALL_TIMER);
  const id = ACTIVE_CALL.id;
  const payload = {
    diagnosis: document.getElementById('call-diagnosis').value.trim() || null,
    advice: document.getElementById('call-advice').value.trim() || null,
    notes: document.getElementById('call-notes').value.trim() || null,
  };
  try {
    await api('/teleconsult/' + id + '/notes', { method: 'PATCH', body: JSON.stringify(payload) });
    await api('/teleconsult/' + id + '/action', {
      method: 'PATCH', body: JSON.stringify({ action: 'complete', doctor_name: DOCTOR_NAME }),
    });
    toast('Call completed — notes saved to patient record', 'ok');
  } catch (e) {
    toast('Could not finalize: ' + e.message, 'error');
  }
  closeCall(true);
}
function closeCall(reload) {
  ACTIVE_CALL = null;
  LIVE_CALL_URL = null;
  clearInterval(CALL_TIMER);
  document.getElementById('call-iframe-wrap').innerHTML = '';
  const callBox = document.querySelector('.call-box');
  if (callBox) callBox.classList.remove('live');
  document.getElementById('call-overlay').classList.remove('open');
  if (reload) loadTeleconsult();
}

/* ------------------------------------------------------------------ */
/* Referrals                                                           */
/* ------------------------------------------------------------------ */
let REF_PATIENT = null;
let REFS = [];

async function initReferrals() {
  await ensureFacility();
  document.getElementById('refresh-btn').addEventListener('click', loadReferrals);
  document.getElementById('ref-filter').addEventListener('change', loadReferrals);
  document.getElementById('create-ref-btn').addEventListener('click', createReferral);
  document.getElementById('ref-patient').addEventListener('input', debounce(searchRefPatient, 350));

  const toSel = document.getElementById('ref-to');
  const facs = await getFacilities();
  toSel.innerHTML = facs
    .filter((f) => f.facility_type === 'chc' || f.facility_type === 'district_hospital' || f.facility_type === 'phc')
    .map((f) => '<option value="' + f.id + '">' + esc(f.name) + ' (' + f.facility_type + ')</option>').join('');

  loadReferrals();
}

async function loadReferrals() {
  const status = document.getElementById('ref-filter').value;
  try {
    REFS = await api('/referrals' + (status ? '?status=' + status : ''));
  } catch (e) { REFS = []; }
  const body = document.getElementById('ref-body');
  body.innerHTML = REFS.map((r) =>
    '<tr><td><b>' + esc(r.patient_name) + '</b><br><span class="patient-id">' + esc(r.abha_id || '') + '</span></td>' +
    '<td class="small">' + esc(r.from_facility_name) + ' →<br>' + esc(r.to_facility_name) + '</td>' +
    '<td class="small">' + esc(r.reason || '—') + '</td>' +
    '<td>' + chip(r.priority, r.priority === 'emergency' ? 'emergency' : r.priority === 'urgent' ? 'urgent' : 'routine') + '</td>' +
    '<td>' + chip(r.status.replace('_', ' '), r.status) + '</td>' +
    '<td>' + fmtDate(r.created_at) + '</td>' +
    '<td class="small">' + referralActions(r) + '</td></tr>'
  ).join('');
  document.getElementById('ref-empty').hidden = REFS.length > 0;

  // Status flow legend
  const counts = {};
  REFS.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const all = await api('/referrals');
  const stages = ['created', 'sent', 'accepted', 'completed', 'no_show', 'rejected'];
  const box = document.getElementById('referral-flow');
  box.innerHTML = '<b>Closed-loop status:</b> ' + stages
    .map((s) => s + ' (' + all.filter((r) => r.status === s).length + ')').join(' &nbsp;→&nbsp; ');
  box.hidden = false;
}

function referralActions(r) {
  const btns = [];
  if (r.status === 'created') btns.push('<button class="small" onclick="trackReferral(\'' + r.id + '\',\'send\')">Send</button>');
  if (r.status === 'sent') {
    btns.push('<button class="small" onclick="trackReferral(\'' + r.id + '\',\'accept\')">Accept</button>');
    btns.push('<button class="small danger" onclick="trackReferral(\'' + r.id + '\',\'reject\')">Reject</button>');
  }
  if (r.status === 'accepted') {
    btns.push('<button class="small" onclick="trackReferral(\'' + r.id + '\',\'complete\')">Complete</button>');
    btns.push('<button class="small warn" onclick="trackReferral(\'' + r.id + '\',\'no_show\')">No-show</button>');
  }
  if (r.status === 'no_show' || r.status === 'rejected') {
    btns.push('<button class="small" onclick="trackReferral(\'' + r.id + '\',\'send\')">Re-send</button>');
  }
  return btns.join(' ');
}

async function trackReferral(id, event) {
  try {
    const r = await api('/referrals/track', {
      method: 'PATCH',
      body: JSON.stringify({ referral_id: id, event: event }),
    });
    toast('Referral → ' + r.status, 'ok');
    loadReferrals();
  } catch (e) { toast(e.message, 'error'); }
}

async function searchRefPatient() {
  const q = document.getElementById('ref-patient').value.trim();
  const hint = document.getElementById('ref-patient-hint');
  if (q.length < 4) { hint.textContent = ''; REF_PATIENT = null; return; }
  try {
    const rows = await api('/patients?q=' + encodeURIComponent(q));
    if (!rows.length) { hint.textContent = 'No patient found.'; REF_PATIENT = null; return; }
    hint.innerHTML = rows.map((p) =>
      '<button type="button" class="link" data-pick="' + p.id + '">' + esc(p.name) + ' · ' +
      p.abha_id + '</button>').join('<br>');
    hint.querySelectorAll('[data-pick]').forEach((b) => {
      b.addEventListener('click', () => {
        REF_PATIENT = rows.find((p) => p.id === b.getAttribute('data-pick'));
        document.getElementById('ref-patient').value = REF_PATIENT.name + ' (' + REF_PATIENT.abha_id + ')';
        hint.textContent = 'Selected ✓';
      });
    });
  } catch (e) { hint.textContent = e.message; }
}

async function createReferral() {
  if (!REF_PATIENT) { toast('Pick a patient first', 'warn'); return; }
  const body = {
    patient_id: REF_PATIENT.id,
    from_facility_id: currentFacilityId,
    to_facility_id: document.getElementById('ref-to').value,
    reason: document.getElementById('ref-reason').value.trim(),
    priority: document.getElementById('ref-priority').value,
  };
  if (!body.to_facility_id) { toast('Choose a receiving facility', 'warn'); return; }
  try {
    const r = await api('/referrals', { method: 'POST', body: JSON.stringify(body) });
    toast('Referral created for ' + r.patient_name + ' (' + r.status + ')', 'ok');
    document.getElementById('ref-reason').value = '';
    document.getElementById('ref-patient').value = '';
    REF_PATIENT = null;
    loadReferrals();
  } catch (e) { toast(e.message, 'error'); }
}

/* ------------------------------------------------------------------ */
/* Pharmacy                                                            */
/* ------------------------------------------------------------------ */
async function initPharmacy() {
  await ensureFacility();
  document.getElementById('refresh-btn').addEventListener('click', loadInventory);
  document.getElementById('med-search').addEventListener('input', renderInventoryRows);
  document.getElementById('low-only').addEventListener('change', renderInventoryRows);
  loadInventory();
}

let INVENTORY = [];
async function loadInventory() {
  try {
    INVENTORY = await api('/inventory?facility_id=' + encodeURIComponent(currentFacilityId));
  } catch (e) { INVENTORY = []; }
  renderInventoryCards();
  renderInventoryRows();
}

function renderInventoryCards() {
  const oos = INVENTORY.filter((r) => r.is_out_of_stock);
  const low = INVENTORY.filter((r) => r.is_low && !r.is_out_of_stock);
  const ok = INVENTORY.filter((r) => !r.is_low);
  const box = document.getElementById('inv-cards');
  box.innerHTML =
    '<div class="card stat-card danger"><b>' + oos.length + '</b><span>Out of stock</span></div>' +
    '<div class="card stat-card warn"><b>' + low.length + '</b><span>Low stock</span></div>' +
    '<div class="card stat-card"><b>' + ok.length + '</b><span>Available</span></div>';
}

async function renderInventoryRows() {
  const q = (document.getElementById('med-search').value || '').trim().toLowerCase();
  const lowOnly = document.getElementById('low-only').checked;
  let rows = INVENTORY;
  if (q) rows = rows.filter((r) => (r.medicine_name || r.generic_name || '').toLowerCase().indexOf(q) !== -1);
  if (lowOnly) rows = rows.filter((r) => r.is_low);

  const body = document.getElementById('inv-body');
  body.innerHTML = rows.map((r) =>
    '<tr><td><b>' + esc(r.medicine_name || r.generic_name) + '</b>' +
    (r.is_critical ? ' <span class="badge emergency">critical</span>' : '') + '</td>' +
    '<td class="small">' + esc(r.generic_name || '') + '</td>' +
    '<td>' + r.stock_units + ' units</td>' +
    '<td>' + r.reorder_level + '</td>' +
    '<td>' + (r.is_out_of_stock ? chip('OUT', 'out') : r.is_low ? chip('LOW', 'low') : chip('OK', 'available')) + '</td>' +
    '<td class="small" id="near-' + r.id + '">…</td></tr>'
  ).join('');
  document.getElementById('inv-empty').hidden = rows.length > 0;

  // Lazy-fill the nearby-facility fallback column
  rows.forEach(async (r) => {
    if (r.is_low || r.is_out_of_stock) {
      const near = document.getElementById('near-' + r.id);
      if (near) {
        const rowsNear = await availabilityFor(r.medicine_id);
        const n = rowsNear[0];
        near.innerHTML = n
          ? n.stock_units + ' @ ' + esc(n.facility_name) + (n.distance_km != null ? ' (' + n.distance_km + ' km)' : '')
          : '<span class="muted">none nearby</span>';
      }
    } else {
      const near = document.getElementById('near-' + r.id);
      if (near) near.innerHTML = '<span class="muted">—</span>';
    }
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
function bindQueueLinks() {
  if (PAGE === 'queue') bindApptStatus();
}

document.addEventListener('DOMContentLoaded', () => {
  if (PAGE === 'dashboard') initDashboard();
  if (PAGE === 'queue') initQueue();
  if (PAGE === 'patient') initPatient();
  if (PAGE === 'teleconsult') initTeleconsult();
  if (PAGE === 'referrals') initReferrals();
  if (PAGE === 'pharmacy') initPharmacy();
  bindQueueLinks();
});
