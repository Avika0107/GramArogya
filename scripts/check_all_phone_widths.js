/* Verify every phone field renders wide enough at 360px viewport. */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8126;
const DEBUG_PORT = 9335;
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-ga3-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const uv = spawn('python', ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], {
    cwd: 'backend', stdio: 'ignore', detached: true,
  });
  await sleep(4000);
  const ch = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDir}`,
    '--window-size=360,800', 'about:blank',
  ], { stdio: 'ignore', detached: true });
  await sleep(2500);

  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0;
  const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  const send = (method, params = {}) => {
    const i = ++id;
    return new Promise((res) => { pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  };
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
    if (r.result.exceptionDetails) {
      console.error('EVAL EXCEPTION:', JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
      return null;
    }
    return r.result.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/portal/` });
  await sleep(2500);

  // Measure the visible phone field per role by switching role tabs.
  const result = await ev(`(() => {
    document.getElementById('to-register').click(); // show register view
    const tabs = { asha: '#tab-reg-asha', doctor: '#tab-reg-doctor', admin: '#tab-reg-admin', lab: '#tab-reg-lab' };
    const ids = { asha: 'asha-phone', doctor: 'doc-phone', admin: 'adm-phone', lab: 'lab-phone' };
    const out = {};
    for (const role of Object.keys(tabs)) {
      document.querySelector(tabs[role]).click();
      const el = document.getElementById(ids[role]);
      out[role] = Math.round(el.getBoundingClientRect().width) + 'px';
    }
    // forgot-password phone field
    document.querySelector('.to-login').click();
    document.getElementById('forgot-link').click();
    const fp = document.getElementById('forgot-phone');
    out.forgot = Math.round(fp.getBoundingClientRect().width) + 'px';
    return out;
  })()`);
  console.log(JSON.stringify(result, null, 2));

  ws.close();
  ch.kill('SIGKILL');
  uv.kill('SIGKILL');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });