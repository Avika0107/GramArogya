/* GramArogya — OPD Self-Service Kiosk (KIOSK_DEVICE role).
 *
 * Issues walk-in tokens (GA-...-KIO01-0000XX) via POST /api/v1/kiosk/token,
 * respects the doctor availability gate, and shows the live queue.
 * Real-time via WebSocket, with a polling fallback every 15s.
 */

const API = '/api/v1';
const ROLE = 'kiosk';
const FAC_KEY = 'ga_kiosk_facility';

let currentFacilityId = localStorage.getItem(FAC_KEY) || null;
let SELECTED_PATIENT = null;

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
    try { const body = await res.json(); detail = body.detail || JSON.stringify(body); } catch (e) { /* keep */ }
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

function chip(text, kind) {
  return '<span class="chip ' + (kind || '') + '">' + esc(text) + '</span>';
}

/* ------------------------------------------------------------------ */
/* Facility (kiosk is placed at the first PHC)                         */
/* ------------------------------------------------------------------ */
async function ensureFacility() {
  if (currentFacilityId) return;
  const facs = await api('/facilities');
  const phc = facs.find((f) => f.facility_type === 'phc') || facs[0];
  if (phc) {
    currentFacilityId = phc.id;
    localStorage.setItem(FAC_KEY, phc.id);
  }
}

/* ------------------------------------------------------------------ */
/* Patient lookup + token issue                                        */
/* ------------------------------------------------------------------ */
const abhaInput = document.getElementById('k-abha');
const hint = document.getElementById('k-patient-hint');

async function lookupPatient() {
  const abha = (abhaInput.value || '').trim();
  if (!/^\d{14}$/.test(abha)) { hint.textContent = 'Enter the full 14-digit ABHA ID.'; SELECTED_PATIENT = null; return; }
  try {
    const rows = await api('/patients?q=' + encodeURIComponent(abha));
    const pat = rows.find((p) => p.abha_id === abha);
    if (pat) {
      SELECTED_PATIENT = pat;
      hint.innerHTML = '✓ <b>' + esc(pat.name) + '</b> · ' + pat.abha_id;
    } else {
      SELECTED_PATIENT = null;
      hint.textContent = 'ABHA not registered yet — please see the staff desk.';
    }
  } catch (e) { hint.textContent = e.message; SELECTED_PATIENT = null; }
}

async function issueToken() {
  const out = document.getElementById('k-result');
  if (!SELECTED_PATIENT) { toast('Enter a valid registered ABHA ID first', 'warn'); return; }
  try {
    out.innerHTML = '<p class="muted">Issuing token…</p>';
    const appt = await api('/kiosk/token', {
      method: 'POST',
      body: JSON.stringify({
        patient_id: SELECTED_PATIENT.id,
        facility_id: currentFacilityId,
        department: document.getElementById('k-dept').value,
        priority: document.getElementById('k-priority').value,
        reason: document.getElementById('k-reason').value,
        counter: 'KIO01',
      }),
    });
    const wait = appt.status === 'waiting' ? '~' + (appt.est_wait_min ?? '—') + ' min' : '—';
    out.innerHTML = '<div class="kiosk-token">' +
      '<div class="label">Your OPD token</div>' +
      '<div class="code">' + esc(appt.token_label) + '</div>' +
      '<div class="meta">' + esc(appt.patient_name) + ' · ' + esc(appt.department || 'GMED') + ' · est. wait ' + wait + '</div>' +
      '</div>';
    document.getElementById('k-abha').value = '';
    document.getElementById('k-reason').value = '';
    SELECTED_PATIENT = null;
    hint.textContent = '';
    loadQueue();
  } catch (e) {
    out.innerHTML = '<p class="ai-warn">' + esc(e.message) + '</p>';
    if (/409|OFFLINE/i.test(e.message)) loadAvailability();
  }
}

/* ------------------------------------------------------------------ */
/* Queue + availability                                                */
/* ------------------------------------------------------------------ */
async function loadAvailability() {
  try {
    const st = await api('/doctor/status?facility_id=' + encodeURIComponent(currentFacilityId));
    const banner = document.getElementById('kiosk-offline-banner');
    const btn = document.getElementById('k-issue');
    const offline = st.status === 'offline';
    banner.style.display = offline ? 'block' : 'none';
    if (btn) btn.disabled = offline;
  } catch (e) { /* keep */ }
}

async function loadQueue() {
  await ensureFacility();
  try {
    const rows = await api('/kiosk/queue?facility_id=' + encodeURIComponent(currentFacilityId));
    const body = document.getElementById('k-queue');
    body.innerHTML = rows.map((r) =>
      '<tr><td class="queue-token">' + esc(r.token_label || '#' + r.token) + '</td>' +
      '<td><b>' + esc(r.patient_name) + '</b></td>' +
      '<td>' + chip(r.priority.replace('_', ' '), r.priority) + '</td>' +
      '<td class="small">' + (r.status === 'waiting' ? '~' + r.est_wait_min + ' min' : '—') + '</td>' +
      '<td>' + chip(r.status.replace('_', ' '), r.status) + '</td></tr>'
    ).join('');
    document.getElementById('k-queue-empty').hidden = rows.length > 0;
    document.getElementById('k-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (e) { /* non-critical */ }
}

function connectSocket() {
  if (!currentFacilityId) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(proto + '://' + location.host +
    '/api/v1/ws/queue?facility_id=' + encodeURIComponent(currentFacilityId));
  sock.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.type === 'queue_changed') loadQueue();
      if (m.type === 'availability_changed') { loadQueue(); loadAvailability(); }
    } catch (e) { /* ignore */ }
  };
  sock.onclose = () => setTimeout(connectSocket, 5000);
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */
(async function init() {
  await ensureFacility();
  abhaInput.addEventListener('input', debounce(lookupPatient, 400));
  document.getElementById('k-issue').addEventListener('click', issueToken);
  abhaInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') issueToken(); });
  await loadAvailability();
  await loadQueue();
  setInterval(loadQueue, 15000);
  connectSocket();
})();

function debounce(fn, ms) {
  let t = null;
  return function () { clearTimeout(t); t = setTimeout(fn, ms); };
}