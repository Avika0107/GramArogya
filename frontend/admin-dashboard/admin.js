/* GramArogya — Block/District Admin dashboard.
 * Roll-ups: district totals, referral funnel, follow-up compliance,
 * diagnostic TAT, stock-out alerts, facility performance table.
 * Role header: X-GramArogya-Role: admin.
 */

const API = '/api/v1';
const ROLE = 'admin';

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

function pct(v) { return v === null || v === undefined ? '—' : v + '%'; }

function kpi(label, value, danger, warn) {
  return '<div class="card stat-card' + (danger ? ' danger' : warn ? ' warn' : '') + '">' +
    '<b>' + value + '</b><span>' + label + '</span></div>';
}

async function load() {
  const q = new URLSearchParams({
    district: document.getElementById('f-district').value.trim() || 'Barabanki',
  });
  const type = document.getElementById('f-type').value;
  if (type) q.set('facility_type', type);
  const from = document.getElementById('f-from').value;
  const to = document.getElementById('f-to').value;
  if (from) q.set('date_from', from);
  if (to) q.set('date_to', to);

  let d;
  try {
    d = await api('/dashboard/district?' + q.toString());
  } catch (e) {
    toast('Load failed: ' + e.message, 'error');
    return;
  }

  // ---- KPI cards ---------------------------------------------------------
  document.getElementById('kpis').innerHTML =
    kpi('Facilities', d.total_facilities) +
    kpi('Patients registered', d.total_patients) +
    kpi('OPD last 7 days', d.opd_7d) +
    kpi('Referrals', d.referrals) +
    kpi('Referral completion', pct(d.referral_completion_pct), (d.referral_completion_pct || 0) < 50) +
    kpi('Follow-up compliance', pct(d.followup_compliance_pct), (d.followup_compliance_pct || 0) < 60) +
    kpi('Avg diagnostic TAT', d.avg_tat_minutes === null || d.avg_tat_minutes === undefined ? '—' : d.avg_tat_minutes + ' min') +
    kpi('Stock-outs', d.stockouts_total, d.stockouts_total > 0) +
    kpi('Queued SMS', d.pending_messages) +
    kpi('Follow-ups total', d.followups_total) +
    kpi('Follow-ups completed', d.followups_completed);

  // ---- Funnel -------------------------------------------------------------
  const funnel = d.funnel || [];
  const maxF = Math.max(1, ...funnel.map((s) => s.count));
  document.getElementById('funnel').innerHTML = funnel.map((s) =>
    '<div class="funnel-row"><span class="lbl">' + s.stage + '</span>' +
    '<div class="funnel-bar-wrap"><div class="funnel-bar ' + barColor(s.stage) + '" style="width:' +
    Math.max(2, Math.round((s.count / maxF) * 100)) + '%"></div></div>' +
    '<span class="cnt">' + s.count + '</span></div>'
  ).join('');

  // ---- Follow-up status -----------------------------------------------------
  const fu = d.followup_status || [];
  const maxFu = Math.max(1, ...fu.map((s) => s.count));
  document.getElementById('followup-status').innerHTML = fu.map((s) =>
    '<div class="funnel-row"><span class="lbl">' + s.stage + '</span>' +
    '<div class="funnel-bar-wrap"><div class="funnel-bar ' + (s.stage === 'missed' ? 'red' : s.stage === 'pending' ? 'amber' : '') +
    '" style="width:' + Math.max(2, Math.round((s.count / maxFu) * 100)) + '%"></div></div>' +
    '<span class="cnt">' + s.count + '</span></div>'
  ).join('');

  // ---- Weekly chart ---------------------------------------------------------
  const weekly = d.weekly_opd || [];
  const maxW = Math.max(1, ...weekly.map((x) => x.count));
  document.getElementById('weekly-chart').innerHTML = weekly.map((x) =>
    '<div class="bar-col"><div class="bar" style="height:' + Math.max(4, Math.round((x.count / maxW) * 130)) + 'px">' +
    '<span>' + x.count + '</span></div>' +
    '<small>' + new Date(x.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }) + '</small></div>'
  ).join('');

  // ---- Facility performance table ------------------------------------------
  const body = document.getElementById('facility-body');
  body.innerHTML = d.facilities.map((f) =>
    '<tr><td><b>' + esc(f.facility_name) + '</b></td>' +
    '<td class="patient-id">' + esc(f.hfr_id) + '</td>' +
    '<td>' + esc(f.facility_type) + '</td>' +
    '<td>' + f.opd_7d + '</td><td>' + f.appointments_7d + '</td>' +
    '<td>' + f.referrals + '</td>' +
    '<td>' + pct(f.referral_completion_pct) + '</td>' +
    '<td>' + f.followups_due + '</td>' +
    '<td>' + pct(f.followup_compliance_pct) + '</td>' +
    '<td>' + (f.avg_tat_minutes === null || f.avg_tat_minutes === undefined ? '—' : f.avg_tat_minutes + ' min') + '</td>' +
    '<td>' + (f.stockouts > 0 ? '<span class="badge emergency">' + f.stockouts + '</span>' : f.stockouts) + '</td>' +
    '<td>' + f.pending_lab + '</td></tr>'
  ).join('');
  document.getElementById('facility-empty').hidden = d.facilities.length > 0;

  // ---- Stock-out alerts (summary endpoint) ----------------------------------
  try {
    const s = await api('/dashboard/summary');
    document.getElementById('stockout-body').innerHTML = s.stockout_alerts.map((a) =>
      '<tr><td><b>' + esc(a.medicine_name) + '</b> <span class="muted small">' + esc(a.generic_name) + '</span></td>' +
      '<td>' + esc(a.facility_name) + ' <span class="patient-id">' + esc(a.hfr_id) + '</span></td>' +
      '<td>' + a.stock_units + ' (reorder ' + a.reorder_level + ')</td>' +
      '<td>' + (a.is_critical ? chip('critical', 'emergency') : '—') + '</td></tr>'
    ).join('');
  } catch (e) { /* ignore */ }
}

function chip(label, cls) {
  return '<span class="badge ' + esc(cls) + '">' + esc(label) + '</span>';
}
function barColor(stage) {
  const map = { completed: '', accepted: '', sent: 'blue', created: 'amber', no_show: 'red', rejected: 'red' };
  return map[stage] || '';
}

document.addEventListener('DOMContentLoaded', () => {
  // Default range = last 7 days
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 6);
  document.getElementById('f-to').value = to.toISOString().slice(0, 10);
  document.getElementById('f-from').value = from.toISOString().slice(0, 10);
  document.getElementById('apply-filters').addEventListener('click', load);
  document.getElementById('load-btn').addEventListener('click', load);
  load();
});
