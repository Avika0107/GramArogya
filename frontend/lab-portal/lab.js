/* GramArogya — Lab Technician portal.
 * Pipeline board, structured result entry with auto-flags, report upload,
 * turnaround-time view. Role header: X-GramArogya-Role: lab.
 */

const API = '/api/v1';
const ROLE = 'lab';
const PIPELINE = ['ordered', 'sample_collected', 'dispatched', 'received', 'processing', 'report_ready'];

let ORDERS = [];
let TESTS = [];

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

function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtDur(sec) {
  if (sec === null || sec === undefined) return '—';
  const m = Math.round(sec / 60);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

const NEXT = {
  ordered: { status: 'sample_collected', label: 'Mark sample collected' },
  sample_collected: { status: 'dispatched', label: 'Dispatch to lab' },
  dispatched: { status: 'received', label: 'Mark received' },
  received: { status: 'processing', label: 'Start processing' },
  processing: { status: 'report_ready', label: 'Report ready' },
};

async function loadAll() {
  ORDERS = await api('/lab/orders');
  TESTS = await api('/lab/tests');
  renderPipeline();
  renderOrders();
  renderTat();
  document.getElementById('updated-at').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

function renderPipeline() {
  const counts = {};
  PIPELINE.forEach((s) => { counts[s] = 0; });
  ORDERS.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
  document.getElementById('pipeline').innerHTML = PIPELINE.map((s) =>
    '<div class="step"><b>' + counts[s] + '</b><span>' + s.replace('_', ' ') + '</span></div>').join('');
}

function actionButtons(o) {
  const btns = [];
  if (o.status === 'received' || o.status === 'processing' || o.status === 'sample_collected') {
    btns.push('<button class="small" onclick="openResults(\'' + o.id + '\')">Enter results</button>');
  }
  if (o.status !== 'report_ready') {
    const step = NEXT[o.status];
    if (step) btns.push('<button class="small secondary" onclick="advance(\'' + o.id + '\',\'' + step.status + '\')">' + step.label + '</button>');
  }
  return btns.join(' ');
}

function testList(o) {
  return (o.tests || []).map((t) => t.name).join(', ');
}

function renderOrders() {
  const box = document.getElementById('orders');
  const act = ORDERS.filter((o) => o.status !== 'report_ready');
  box.innerHTML = act.map((o) =>
    '<div class="order-card" style="border-left-color:' + stepColor(o.status) + '">' +
    '<div class="spread"><div><b>' + esc(o.patient_name || '—') + '</b> ' +
    '<span class="badge ' + esc(o.status) + '">' + o.status.replace('_', ' ') + '</span>' +
    (o.facility_name ? ' <span class="muted small">' + esc(o.facility_name) + '</span>' : '') +
    '</div><span class="muted small">ordered ' + fmtDT(o.ordered_at) + '</span></div>' +
    '<div class="tests">🔬 ' + esc(testList(o)) + (o.report_file ? ' · 📎 ' + esc(o.report_file) : '') + '</div>' +
    '<div class="row">' + actionButtons(o) + '</div></div>'
  ).join('');
  document.getElementById('orders-empty').hidden = act.length > 0;
}

function stepColor(s) {
  const map = { ordered: '#8aa0b8', sample_collected: '#6a4fbf', dispatched: '#1d4e89',
    received: '#1565c0', processing: '#b26a00', report_ready: '#0a7a46' };
  return map[s] || '#8aa0b8';
}

async function advance(orderId, status) {
  try {
    await api('/lab/orders/' + orderId + '/status', {
      method: 'PATCH', body: JSON.stringify({ status: status }),
    });
    toast('Order → ' + status.replace('_', ' '), 'ok');
    loadAll();
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------------- Results entry ---------------- */
let CURRENT_ORDER = null;
let reportBase64 = null;
let reportFileName = null;

function testByCode(code) {
  return TESTS.find((t) => t.code === code);
}

function flagPreview(test, value) {
  if (!test || test.is_radiology || !test.unit) return { flag: '', cls: 'muted', label: 'text result' };
  const n = Number(String(value).trim());
  if (!Number.isFinite(n)) return { flag: '', cls: 'muted', label: 'text result' };
  if (test.ref_critical_low != null && n < test.ref_critical_low) return { flag: 'critical', cls: 'flag-critical', label: 'CRITICAL' };
  if (test.ref_critical_high != null && n > test.ref_critical_high) return { flag: 'critical', cls: 'flag-critical', label: 'CRITICAL' };
  if (test.ref_low != null && n < test.ref_low) return { flag: 'low', cls: 'flag-low', label: 'LOW' };
  if (test.ref_high != null && n > test.ref_high) return { flag: 'high', cls: 'flag-high', label: 'HIGH' };
  return { flag: 'normal', cls: 'flag-normal', label: 'NORMAL' };
}

function openResults(orderId) {
  CURRENT_ORDER = ORDERS.find((o) => o.id === orderId);
  if (!CURRENT_ORDER) return;
  reportBase64 = null;
  reportFileName = null;
  document.getElementById('upload-status').textContent = '';

  const tests = (CURRENT_ORDER.tests || []).map((t) => testByCode(t.code) || null);
  const rows = document.getElementById('results-rows');
  rows.innerHTML = tests.map((test, i) => {
    const label = test ? test.name : 'Unknown test';
    const unit = test && test.unit ? test.unit : '';
    const ref = test && test.ref_display ? ' (ref ' + test.ref_display + ')' : (test && test.is_radiology ? ' (report text)' : '');
    return '<div class="spread" style="align-items:end;margin-bottom:8px">' +
      '<div style="flex:1.4"><label style="margin:0">' + esc(label) + ref + '</label>' +
      '<input type="text" data-code="' + esc(test ? test.code : '') + '" data-name="' + esc(label) + '"' +
      (test && test.is_radiology ? ' placeholder="e.g. Normal study — no acute findings"' : '') + '></div>' +
      '<div style="flex:0.4"><label style="margin:0">Unit</label><input type="text" value="' + esc(unit) + '" data-unit></div>' +
      '<div style="flex:0.5"><label style="margin:0">Flag</label><div data-flag style="padding:9px 4px" class="muted small">—</div></div>' +
      '</div>';
  }).join('');
  document.getElementById('results-title').textContent = 'Enter results — ' + CURRENT_ORDER.patient_name;

  rows.querySelectorAll('input[data-code]').forEach((input) => {
    const update = () => {
      const test = testByCode(input.getAttribute('data-code'));
      const flag = flagPreview(test, input.value);
      const flagEl = input.closest('.spread').querySelector('[data-flag]');
      flagEl.className = flag.cls;
      flagEl.textContent = flag.flag ? flag.label : flag.label;
    };
    input.addEventListener('input', update);
    update();
  });

  document.getElementById('report-file').value = '';
  document.getElementById('results-overlay').classList.add('open');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('refresh-btn').addEventListener('click', loadAll);
  document.getElementById('results-close').addEventListener('click', () => {
    document.getElementById('results-overlay').classList.remove('open');
  });
  document.getElementById('results-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'results-overlay') document.getElementById('results-overlay').classList.remove('open');
  });
  document.getElementById('report-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      reportBase64 = await fileToBase64(f);
      reportFileName = f.name;
      document.getElementById('upload-status').textContent = 'Attached: ' + f.name + ' (' + Math.round(f.size / 1024) + ' KB)';
    } catch (err) {
      document.getElementById('upload-status').textContent = 'Could not read file';
    }
  });
  document.getElementById('submit-results').addEventListener('click', submitResults);
  loadAll();
  setInterval(loadAll, 30000);
});

async function submitResults() {
  if (!CURRENT_ORDER) return;
  const results = [];
  const rows = document.querySelectorAll('#results-rows .spread');
  rows.forEach((row) => {
    const code = row.querySelector('input[data-code]').getAttribute('data-code');
    const name = row.querySelector('input[data-code]').getAttribute('data-name');
    const value = row.querySelector('input[data-code]').value.trim();
    const unit = row.querySelector('[data-unit]').value.trim();
    if (!code) return;
    const test = testByCode(code);
    const f = flagPreview(test, value);
    results.push({
      test_code: code,
      test_name: name,
      value_text: value || (test && test.is_radiology ? 'Report attached' : ''),
      unit: unit || (test && test.unit) || undefined,
      flag: f.flag || undefined,
    });
  });

  const btn = document.getElementById('submit-results');
  btn.disabled = true;
  try {
    // Optional report upload first (PDF/image → base64)
    if (reportBase64 && reportFileName) {
      await api('/lab/orders/' + CURRENT_ORDER.id + '/report', {
        method: 'POST',
        body: JSON.stringify({ file_name: reportFileName, data_base64: reportBase64 }),
      });
    }
    await api('/lab/orders/' + CURRENT_ORDER.id + '/results', {
      method: 'POST',
      body: JSON.stringify({ results: results, report_note: reportFileName || null }),
    });
    toast('Report saved & flagged — status now report_ready', 'ok');
    document.getElementById('results-overlay').classList.remove('open');
    loadAll();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function renderTat() {
  const done = ORDERS.filter((o) => o.status === 'report_ready');
  const body = document.getElementById('tat-body');
  body.innerHTML = done.map((o) =>
    '<tr><td><b>' + esc(o.patient_name || '—') + '</b></td>' +
    '<td class="small">' + esc(testList(o)) + '</td>' +
    '<td>' + fmtDT(o.ordered_at) + '</td>' +
    '<td>' + fmtDT(o.ready_at) + '</td>' +
    '<td><b>' + fmtDur(o.tat_seconds) + '</b></td>' +
    '<td class="small">' + (o.report_file ? '📎 ' + esc(o.report_file) : '—') + '</td></tr>'
  ).join('');
  document.getElementById('tat-empty').hidden = done.length > 0;
}
