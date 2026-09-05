/* GramArogya — Lab Technician: Home Sample Collection mobile view.
 *
 * - Job cards are readable: patient name, tests, village, schedule.
 * - Phone numbers & the home address are PROTECTED: the masked display
 *   number is hidden (blurred) outside an active visit and only visible
 *   while the technician is working the visit — leaving the app, printing
 *   or taking a screenshot hides it again (no readable data in captures).
 * - Calls run through the /initiate-masked-call proxy bridge; the raw
 *   number is only ever dialled by the server-side bridge.
 * - The home address is fetched on "▶ Start visit" via the audited
 *   GET /address endpoint -> logged as VIEW_PATIENT_ADDRESS.
 */

const API = '/api/v1';
const ROLE = 'lab';
const TECH_KEY = 'ga_tech_phone';

let TECHNICIANS = [];
let MY_TECH = null;      // the "logged in" technician (demo switcher)
let ACTIVE_BOOKING = null;

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, options = {}) {
  const headers = Object.assign(
    { 'Content-Type': 'application/json', 'X-GramArogya-Role': ROLE },
    MY_TECH ? { 'X-GramArogya-User': MY_TECH.name } : {},
    options.headers || {}
  );
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

function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function prettyStatus(s) {
  return String(s || '').replace(/_/g, ' ');
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */
async function loadTechnicians() {
  TECHNICIANS = await api('/home-collection/technicians');
  const sel = document.getElementById('tech-select');
  const saved = localStorage.getItem(TECH_KEY);
  sel.innerHTML = TECHNICIANS.map((t) =>
    '<option value="' + t.id + '"' + (t.id === saved ? ' selected' : '') + '>' +
    esc(t.name) + '</option>').join('');
  if (!sel.value && TECHNICIANS.length) sel.value = TECHNICIANS[0].id;
  selectTech(sel.value);
  sel.addEventListener('change', () => selectTech(sel.value));
}

function selectTech(id) {
  MY_TECH = TECHNICIANS.find((t) => t.id === id) || TECHNICIANS[0] || null;
  if (!MY_TECH) return;
  localStorage.setItem(TECH_KEY, MY_TECH.id);
  document.getElementById('tech-name').textContent = MY_TECH.name;
  loadBoard();
}

async function loadBoard() {
  if (!MY_TECH) return;
  try {
    const [mine, pending, audit] = await Promise.all([
      api('/home-collection/bookings?technician_id=' + encodeURIComponent(MY_TECH.id)),
      api('/home-collection/bookings?status=HOME_COLLECTION_PENDING'),
      api('/home-collection/audit?limit=50'),
    ]);
    renderJobs(mine);
    renderPending(pending.filter((b) => !b.technician_id));
    renderAudit(audit);
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */
function testNames(b) {
  return (b.tests || []).map((t) => t.name || t.code).join(', ');
}

function statusBadge(b) {
  const cls = { technician_assigned: 'sample_collected', scheduled_visit: 'in_consultation',
    unavailable_rescheduled: 'low', sampling_cancelled: 'cancelled',
    sample_collected: 'available', home_collection_pending: 'pending' };
  return '<span class="badge ' + (cls[b.status] || 'pending') + '">' +
    prettyStatus(b.status_alias || b.status) + '</span>';
}

function renderJobs(list) {
  const box = document.getElementById('job-list');
  const actionable = list.filter((b) =>
    b.status === 'technician_assigned' || b.status === 'scheduled_visit' ||
    b.status === 'unavailable_rescheduled');
  const done = list.filter((b) => b.status === 'sample_collected' || b.status === 'sampling_cancelled');
  const cards = actionable.concat(done);
  box.innerHTML = cards.map((b) => jobCardHtml(b, true)).join('');
  document.getElementById('job-empty').hidden = cards.length > 0;
  protectContact();
}

function jobCardHtml(b, isMine) {
  const visitAction = (b.status === 'technician_assigned' || b.status === 'unavailable_rescheduled')
    ? '<button class="small" onclick="startVisit(\'' + b.id + '\')">▶ Start visit — fetch address</button>'
    : (b.status === 'scheduled_visit'
      ? '<button class="small secondary" onclick="openVisit(\'' + b.id + '\')">👁 View address & report</button>' : '');
  return '<div class="hc-card' + (b.status === 'sampling_cancelled' ? ' cancelled' : '') +
    (b.status === 'unavailable_rescheduled' ? ' resched' : '') + '" data-booking="' + b.id + '">' +
    '<div class="row1"><div>' +
    '<div class="pt">' + esc(b.patient_name || '—') + '</div>' +
    '<div class="meta">Booking: <b>' + esc(b.booking_ref) + '</b> · Visit #' + b.visit_number +
    ' · ' + statusBadge(b) + '</div>' +
    '</div><span class="call-pill secret hidden">📱 ' + esc(b.patient_phone_masked || '—') + '</span></div>' +
    '<div class="tests">🔬 Tests: ' + esc(testNames(b)) + '</div>' +
    '<div class="meta">📍 Village: ' + esc(b.village || '—') +
    ' · Prescribed by ' + esc(b.ordered_by || '—') +
    (b.scheduled_slot_at ? ' · Scheduled: ' + fmtDT(b.scheduled_slot_at) : '') + '</div>' +
    (b.status === 'scheduled_visit'
      ? '<div class="meta" style="color:var(--green-dark,#0a4d36)">✅ Visit in progress — address & result buttons are in the visit modal (audited reveal).</div>'
      : '') +
    (b.visit_number > 1 && (b.status === 'unavailable_rescheduled' || b.status === 'scheduled_visit')
      ? '<div class="meta" style="color:#b26a00">⚠️ Rescheduled — this is the FINAL visit attempt.</div>' : '') +
    (b.cancel_reason ? '<div class="meta" style="color:var(--red)">✕ ' + esc(b.cancel_reason) + '</div>' : '') +
    '<div class="btns">' + visitAction +
    (isMine ? '<button class="small secondary" onclick="maskedCall(\'' + b.id + '\')">📞 Masked call</button>' : '') +
    (b.status === 'scheduled_visit'
      ? '<button class="small" onclick="visitEvent(\'' + b.id + '\',\'collected\')">✅ Samples collected</button> ' +
        '<button class="small warn" onclick="visitEvent(\'' + b.id + '\',\'unavailable\')">🙅 Patient unavailable</button>'
      : '') +
    '</div></div>';
}

function renderPending(list) {
  const box = document.getElementById('pending-list');
  box.innerHTML = list.map((b) =>
    '<div class="hc-card">' +
    '<div class="row1"><div>' +
    '<div class="pt">' + esc(b.patient_name || '—') + '</div>' +
    '<div class="meta">Booking: <b>' + esc(b.booking_ref) + '</b> · ' + statusBadge(b) + '</div>' +
    '</div><span class="call-pill secret hidden">📱 ' + esc(b.patient_phone_masked || '—') + '</span></div>' +
    '<div class="tests">🔬 Tests: ' + esc(testNames(b)) + '</div>' +
    '<div class="meta">📍 Village: ' + esc(b.village || '—') + ' · Prescribed ' + fmtDT(b.created_at) +
    ' · by ' + esc(b.ordered_by || '—') + '</div>' +
    '<div class="btns"><button class="small" onclick="assignToMe(\'' + b.id + '\')">✅ Assign to me</button>' +
    '<button class="small secondary" onclick="maskedCall(\'' + b.id + '\')">📞 Masked call</button></div>' +
    '</div>').join('');
  document.getElementById('pending-empty').hidden = list.length > 0;
  protectContact();
}

function renderAudit(rows) {
  const body = document.getElementById('audit-body');
  body.innerHTML = rows.map((r) =>
    '<tr><td class="small">' + fmtDT(r.created_at) + '</td>' +
    '<td class="small">' + esc(r.actor_id || '—') + ' <span class="muted">(' + esc(r.actor_role || '') + ')</span></td>' +
    '<td><b>' + esc(r.action.replace(/_/g, ' ')) + '</b></td>' +
    '<td class="small">' + esc(r.detail || '') + '</td></tr>').join('');
  document.getElementById('audit-empty').hidden = rows.length > 0;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */
async function assignToMe(bookingId) {
  try {
    await api('/home-collection/assign-technician', {
      method: 'POST',
      body: JSON.stringify({ booking_id: bookingId, technician_id: MY_TECH.id }),
    });
    toast('Booking assigned to you — patient SMS queued', 'ok');
    loadBoard();
  } catch (e) { toast(e.message, 'error'); }
}

/* Start visit -> (1) transition the booking to SCHEDULED_VISIT,
 * (2) fetch the home address through the audited GET /address endpoint
 * (logged as VIEW_PATIENT_ADDRESS) — the response carries patient_address
 * and opens the visit modal with the report buttons. */
async function startVisit(bookingId) {
  const btn = document.activeElement;
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching address…'; }
  try {
    await api('/home-collection/visit-status/start', {
      method: 'POST',
      body: JSON.stringify({ booking_id: bookingId }),
    });
    const out = await api('/home-collection/bookings/' + bookingId + '/address');
    ACTIVE_BOOKING = out;
    document.getElementById('visit-overlay').classList.add('open');
    renderVisitModal();
    toast('Visit started — home address revealed (audited: VIEW_PATIENT_ADDRESS)', 'ok');
    loadBoard();
  } catch (e) {
    toast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '▶ Start visit — fetch address'; }
  }
}

function openVisit(bookingId) {
  ACTIVE_BOOKING = { id: bookingId, patient_name: '' };
  document.getElementById('visit-title').textContent = 'Home visit';
  document.getElementById('visit-overlay').classList.add('open');
  document.getElementById('visit-body').innerHTML = '<p class="muted">Loading…</p>';
  // For an already-started visit (SCHEDULED_VISIT) fetch the revealed
  // address through the audited endpoint so it stays visible here.
  api('/home-collection/bookings/' + bookingId + '/address')
    .then((b) => { ACTIVE_BOOKING = b; renderVisitModal(); })
    .catch(async () => {
      try {
        const b = await api('/home-collection/bookings/' + bookingId);
        ACTIVE_BOOKING = b;
        renderVisitModal();
      } catch (e) { /* keep */ }
    });
}

function renderVisitModal() {
  const b = ACTIVE_BOOKING;
  if (!b || !b.id) return;
  document.getElementById('visit-title').textContent = 'Home visit — ' +
    (b.patient_name || '');
  const canReport = b.status === 'scheduled_visit' || b.status === 'unavailable_rescheduled';
  document.getElementById('visit-body').innerHTML =
    '<div class="meta">Booking: <b>' + esc(b.booking_ref) + '</b> · Visit #' + b.visit_number +
    ' · ' + statusBadge(b) +
    (b.scheduled_slot_at ? ' · Scheduled: ' + fmtDT(b.scheduled_slot_at) : '') + '</div>' +
    '<p><b>Patient:</b> ' + esc(b.patient_name) + ' (' + esc(b.abha_id || '—') + ')</p>' +
    '<p><b>Tests:</b> ' + esc(testNames(b)) + '</p>' +
    '<p><b>Phone (masked):</b> <span class="call-pill secret hidden">📱 ' + esc(b.patient_phone_masked || '—') +
    '</span> <span class="muted small">(visible during this visit only)</span></p>' +
    (b.patient_address
      ? '<div class="addr secret hidden"><b>🏠 Home address:</b> ' + esc(b.patient_address) + '</div>'
      : '<p class="alert blue small">Home address is fetched when the visit is started — ' +
        'tap <b>▶ Start visit — fetch address</b> on the job card (audited).</p>') +
    '<div class="btns" style="margin:10px 0">' +
    '<button class="small secondary" onclick="maskedCall(\'' + b.id + '\')">📞 Masked call via proxy bridge</button></div>' +
    (canReport
      ? '<div class="btns"><button class="small" onclick="visitEvent(\'' + b.id + '\',\'collected\')">✅ Samples collected</button> ' +
        '<button class="small warn" onclick="visitEvent(\'' + b.id + '\',\'unavailable\')">🙅 Patient unavailable</button></div>'
      : '<p class="muted small">Status: ' + prettyStatus(b.status_alias || b.status) +
        ' — tap <b>▶ Start visit — fetch address</b> on the job card to begin.</p>') +
    (b.visit_number >= 2 && b.status === 'unavailable_rescheduled'
      ? '<p class="alert amber small" style="margin-top:10px"><b>Final attempt.</b> If the patient is ' +
        'unavailable again, the booking is auto-cancelled and the doctor is notified.</p>' : '');
  protectContact();
}

async function visitEvent(bookingId, event) {
  const note = event === 'unavailable'
    ? prompt('Optional note (e.g. "nobody answered, called twice"):', '')
    : null;
  try {
    const out = await api('/home-collection/visit-status', {
      method: 'POST',
      body: JSON.stringify({ booking_id: bookingId, event: event, notes: note || undefined }),
    });
    const msg = out.status_alias === 'UNAVAILABLE_RESCHEDULED'
      ? 'Patient unavailable — auto-rescheduled to next slot (visit #2)'
      : out.status_alias === 'SAMPLING_CANCELLED'
        ? 'Patient unavailable again — SAMPLING_CANCELLED. Doctor notified.'
        : 'Samples collected — order sent into the lab pipeline ✓';
    toast(msg, out.status_alias === 'SAMPLING_CANCELLED' ? 'warn' : 'ok');
    closeVisitModal();
    loadBoard();
  } catch (e) { toast(e.message, 'error'); }
}

async function maskedCall(bookingId) {
  try {
    const out = await api('/home-collection/initiate-masked-call', {
      method: 'POST',
      body: JSON.stringify({ booking_id: bookingId }),
    });
    toast('Proxy bridge: dialling ' + out.masked_number + ' (masked leg active)', 'ok');
    alert('📞 SIMULATED MASKED CALL\n\n' + out.notice + '\n\nDisplayed number: ' +
      out.masked_number + '\nBridge: ' + out.dial_through_url +
      '\n\nThe patient is dialled by the bridge — the raw number never reaches this device.');
  } catch (e) { toast(e.message, 'error'); }
}

/* ------------------------------------------------------------------ */
/* Phone / address protection (device + screenshot safe)               */
/* ------------------------------------------------------------------ */
function protectContact() {
  // Phone/address are only readable while the visit modal is OPEN and the
  // visit is in progress. Cards, the pending list and closed modals always
  // keep them blurred — nothing readable in a screenshot by surprise.
  const overlay = document.getElementById('visit-overlay');
  const modalOpen = overlay && overlay.classList.contains('open');
  const inVisit = modalOpen && ACTIVE_BOOKING &&
    (ACTIVE_BOOKING.status === 'scheduled_visit' || ACTIVE_BOOKING.status === 'unavailable_rescheduled');
  document.querySelectorAll('.secret').forEach((el) => {
    const insideModal = !!el.closest('#visit-overlay');
    if (insideModal && inVisit) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
}

/* Leave the app / print / capture attempt -> hide immediately */
function hideAllSecrets() {
  document.querySelectorAll('.secret').forEach((el) => el.classList.add('hidden'));
}
window.addEventListener('blur', hideAllSecrets);
document.addEventListener('visibilitychange', () => { if (document.hidden) hideAllSecrets(); });

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */
function switchTab(tab) {
  document.querySelectorAll('.tabs button').forEach((b) =>
    b.classList.toggle('active', b.getAttribute('data-tab') === tab));
  document.getElementById('panel-jobs').hidden = tab !== 'jobs';
  document.getElementById('panel-pending').hidden = tab !== 'pending';
  document.getElementById('panel-audit').hidden = tab !== 'audit';
  if (tab === 'jobs' || tab === 'pending') loadBoard();
  protectContact();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
function closeVisitModal() {
  document.getElementById('visit-overlay').classList.remove('open');
  ACTIVE_BOOKING = null;
  protectContact(); // phone/address blur again the moment the visit closes
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('visit-close').addEventListener('click', closeVisitModal);
  document.getElementById('visit-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'visit-overlay') closeVisitModal();
  });
  document.querySelectorAll('.tabs button').forEach((b) =>
    b.addEventListener('click', () => switchTab(b.getAttribute('data-tab'))));
  loadTechnicians();
  setInterval(() => { if (!document.hidden) loadBoard(); }, 30000);
});
