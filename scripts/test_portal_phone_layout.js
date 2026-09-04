/* Inspect the phone input's rendered geometry at mobile viewport. */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8125;
const DEBUG_PORT = 9334;
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-ga2-'));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const uvicorn = spawn('python', ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], {
    cwd: 'backend', stdio: 'ignore', detached: true,
  });
  await sleep(4000);

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDir}`,
    '--window-size=360,800',
    'about:blank',
  ], { stdio: 'ignore', detached: true });
  await sleep(2500);

  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let msgId = 0;
  const pending = new Map();
  function send(method, params = {}) {
    const id = ++msgId;
    return new Promise(resolve => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evalJs(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (res.result && res.result.exceptionDetails) return { error: JSON.stringify(res.result.exceptionDetails) };
    return res.result && res.result.result ? res.result.result.value : res;
  }
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/portal/` });
  await sleep(2500);

  await evalJs(`document.getElementById('to-register').click()`);
  await sleep(300);

  // Computed geometry + styles of the phone field
  const info = await evalJs(`(() => {
    const el = document.getElementById('asha-phone');
    const row = el.closest('.phone-row');
    const btn = document.getElementById('asha-otp-send');
    const cs = getComputedStyle(el);
    const rc = el.getBoundingClientRect();
    const rowc = row.getBoundingClientRect();
    const btnc = btn.getBoundingClientRect();
    return {
      input: { w: Math.round(rc.width), h: Math.round(rc.height), x: Math.round(rc.x), y: Math.round(rc.y) },
      row: { w: Math.round(rowc.width), h: Math.round(rowc.height) },
      button: { w: Math.round(btnc.width), h: Math.round(btnc.height) },
      css: {
        display: cs.display, width: cs.width, height: cs.height,
        flex: cs.flex, minWidth: cs.minWidth, maxWidth: cs.maxWidth,
        padding: cs.padding, boxSizing: cs.boxSizing,
        color: cs.color, fontSize: cs.fontSize, fontFamily: cs.fontFamily.split(',')[0],
        backgroundColor: cs.backgroundColor, textIndent: cs.textIndent,
      },
      parentDisplay: getComputedStyle(row).display,
      childFlex: [el, btn].map(e => getComputedStyle(e).flex),
    };
  })()`);
  console.log(JSON.stringify(info, null, 2));

  // Type a number and check visibility (scrollWidth vs clientWidth => clipped text?)
  const typed = await evalJs(`(() => {
    const el = document.getElementById('asha-phone');
    el.value = '9876543210';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const cs = getComputedStyle(el);
    return {
      value: el.value,
      clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
      overflowX: cs.overflowX, whiteSpace: cs.whiteSpace,
      textOverflow: cs.textOverflow, direction: cs.direction,
      lineHeight: cs.lineHeight,
    };
  })()`);
  console.log('Typed visibility:', JSON.stringify(typed, null, 2));

  ws.close();
  chrome.kill('SIGKILL');
  uvicorn.kill('SIGKILL');
  process.exit(0);
}

main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });