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

/* Convert any Unicode decimal digits (Devanagari, Bengali, Arabic, …) to
 * ASCII and strip separators/spaces, so a pasted or localized ABHA ID
 * still reads as plain 0-9 digits. */
function toAsciiDigits(s) {
  const BLOCKS = [
    [0x0660, 0x0669], [0x06F0, 0x06F9], [0x0966, 0x096F], [0x09E6, 0x09EF],
    [0x0A66, 0x0A6F], [0x0AE6, 0x0AEF], [0x0B66, 0x0B6F], [0x0BE6, 0x0BEF],
    [0x0C66, 0x0C6F], [0x0CE6, 0x0CEF], [0x0D66, 0x0D6F], [0x0DE6, 0x0DEF],
    [0x0E50, 0x0E59], [0x0ED0, 0x0ED9], [0x0F20, 0x0F29], [0x1040, 0x1049],
    [0x17E0, 0x17E9], [0x1810, 0x1819], [0xFF10, 0xFF19],
  ];
  return String(s || '').replace(/\p{Nd}/gu, (d) => {
    const cp = d.codePointAt(0);
    if (cp >= 48 && cp <= 57) return d;
    for (const [lo, hi] of BLOCKS) {
      if (cp >= lo && cp <= hi) return String.fromCharCode(48 + cp - lo);
    }
    return d;
  }).replace(/\D/g, '');
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
  const abha = toAsciiDigits(abhaInput.value);
  if (!/^\d{14}$/.test(abha)) {
    hint.textContent = 'Enter the full 14-digit ABHA ID.';
    SELECTED_PATIENT = null;
    return null;
  }
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
    return pat || null;
  } catch (e) {
    hint.textContent = e.message;
    SELECTED_PATIENT = null;
    return null;
  }
}

async function issueToken() {
  const out = document.getElementById('k-result');
  const abha = toAsciiDigits(abhaInput.value);
  if (!/^\d{14}$/.test(abha)) { toast('Enter the full 14-digit ABHA ID first', 'warn'); return; }
  // The debounced search may still be pending (or the field was edited after a
  // previous match) — resolve the patient now instead of trusting stale state.
  if (!SELECTED_PATIENT || SELECTED_PATIENT.abha_id !== abha) {
    const pat = await lookupPatient();
    if (!pat) { toast('ABHA not registered yet — please see the staff desk.', 'warn'); return; }
  }
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
  // Keep the ABHA field clean as the visitor types/pastes: convert localized
  // digits to ASCII and drop separators, capped at 14.
  abhaInput.addEventListener('input', () => {
    const clean = toAsciiDigits(abhaInput.value).slice(0, 14);
    if (clean !== abhaInput.value) abhaInput.value = clean;
  });
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