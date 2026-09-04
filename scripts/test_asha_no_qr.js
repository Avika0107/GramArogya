/* Verify QR feature is gone from the ASHA app and search still works. */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8128;
const DEBUG_PORT = 9337;
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-ga5-'));

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
    '--window-size=400,900', 'about:blank',
  ], { stdio: 'ignore', detached: true });
  await sleep(2500);

  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0;
  const pend = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && ['error'].includes(m.params.type)) {
      errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
    }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  const send = (method, params = {}) => {
    const i = ++id;
    return new Promise((res) => { pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  };
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) return { exc: r.result.exceptionDetails.text };
    return r.result.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/asha/` });
  await sleep(2500);

  const checks = await ev(`(() => {
    return {
      scanBtnGone: !document.getElementById('scan-btn'),
      qrModalGone: !document.getElementById('qr-modal'),
      qrGridGone: !document.getElementById('qr-grid'),
      hintText: document.querySelector('.hint') ? document.querySelector('.hint').textContent.trim().slice(0, 80) : null,
      abhaInputPresent: !!document.getElementById('abha-input'),
      searchBtnPresent: !!document.getElementById('search-btn'),
    };
  })()`);
  console.log(JSON.stringify(checks, null, 2));

  // ABHA search still works (server-backed)
  const search = await ev(`(async () => {
    const input = document.getElementById('abha-input');
    input.value = '91214455667701';
    document.getElementById('search-btn').click();
    await new Promise(r => setTimeout(r, 1500));
    const res = document.getElementById('patient-result');
    return res ? res.textContent.trim().slice(0, 120) : 'no result el';
  })()`);
  console.log('Search result:', JSON.stringify(search));
  console.log('Console errors:', errors.length ? errors : 'none');

  ws.close();
  ch.kill('SIGKILL');
  uv.kill('SIGKILL');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });