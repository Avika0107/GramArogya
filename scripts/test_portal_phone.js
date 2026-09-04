/* CDP interaction test for the portal phone field. */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8124;
const DEBUG_PORT = 9333;
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-ga-'));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Start uvicorn
  const uvicorn = spawn('python', ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], {
    cwd: 'backend', stdio: 'ignore', detached: true,
  });
  await sleep(4000);

  // Start chrome with remote debugging
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDir}`,
    '--window-size=400,900',
    'about:blank',
  ], { stdio: 'ignore', detached: true });
  await sleep(2500);

  // Get the ws URL for the page target
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  function send(method, params = {}) {
    const id = ++msgId;
    return new Promise(resolve => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evalJs(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (res.result && res.result.exceptionDetails) {
      return { error: JSON.stringify(res.result.exceptionDetails) };
    }
    return res.result && res.result.result ? res.result.result.value : res;
  }

  await send('Page.enable');
  await send('Runtime.enable');
  // Collect console errors
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      errors.push(m.params.type + ': ' + m.params.args.map(a => a.value || a.description).join(' '));
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/portal/` });
  await sleep(2500);

  // 1. Switch to register view, keep ASHA role
  await evalJs(`document.getElementById('to-register').click()`);
  await sleep(300);
  const view = await evalJs(`document.getElementById('view-register').hidden === false`);
  console.log('Register view visible:', view);

  // 2. Type into the phone field with realistic events
  await evalJs(`(() => {
    const el = document.getElementById('asha-phone');
    el.focus();
    el.value = '9876543210';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { value: el.value, maxLength: el.maxLength };
  })()`);
  const phoneVal = await evalJs(`document.getElementById('asha-phone').value`);
  console.log('Phone value after typing:', phoneVal);

  // 3. Click Send OTP and wait
  await evalJs(`document.getElementById('asha-otp-send').click()`);
  await sleep(1800);
  const otpStatus = await evalJs(`document.getElementById('asha-otp-status').textContent`);
  const otpRowVisible = await evalJs(`!document.getElementById('asha-otp-row').hidden`);
  console.log('OTP status after send:', JSON.stringify(otpStatus));
  console.log('OTP row visible:', otpRowVisible);

  // 4. Fill the OTP (grab demo code from the status text) and verify
  const otpCode = await evalJs(`(document.getElementById('asha-otp-status').textContent.match(/OTP is (\\d{6})/) || [])[1] || ''`);
  console.log('Demo OTP code extracted:', otpCode);
  await evalJs(`(() => {
    const el = document.getElementById('asha-otp');
    el.value = '${otpCode}';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('asha-otp-verify').click();
  })()`);
  await sleep(1800);
  const otpVerified = await evalJs(`document.getElementById('asha-otp-status').textContent`);
  const phoneVerified = await evalJs(`document.getElementById('asha-phone').dataset.verified`);
  console.log('OTP status after verify:', JSON.stringify(otpVerified));
  console.log('Phone dataset.verified:', phoneVerified);

  // 5. Fill the rest of the ASHA form minimally and submit
  await evalJs(`(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('asha-name', 'Test Worker');
    set('asha-village', 'Sanda');
    set('asha-block', 'Hilsa');
    set('asha-district', 'Nalanda');
    set('asha-state', 'Bihar');
    set('asha-pincode', '803216');
    set('asha-id', 'ABC1234567');
    set('asha-phc', 'PHC Sanda');
    set('asha-dob', '1995-06-15');
    set('asha-pass', 'Test@1234');
    set('asha-pass2', 'Test@1234');
  })()`);
  await evalJs(`document.getElementById('form-asha').requestSubmit()`);
  await sleep(2200);

  const successMsg = await evalJs(`document.getElementById('success-msg').textContent`);
  const successVisible = await evalJs(`!document.getElementById('view-success').hidden`);
  console.log('Success visible:', successVisible);
  console.log('Success message:', JSON.stringify(successMsg));

  console.log('Console errors/warnings:', errors.length ? errors : 'none');

  // ---- 6. Now sign out to login view and log in as the registered user ----
  await evalJs(`document.getElementById('success-done').click()`);
  await sleep(400);
  await evalJs(`(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('login-user', '9876543210');
    set('login-pass', 'Test@1234');
    document.getElementById('login-form').requestSubmit();
  })()`);
  await sleep(2200);
  const loginMsg = await evalJs(`document.getElementById('success-msg').textContent`);
  console.log('Login as registered user:', JSON.stringify(loginMsg));

  ws.close();
  chrome.kill('SIGKILL');
  uvicorn.kill('SIGKILL');
  process.exit(0);
}

main().catch(err => { console.error('TEST FAILED:', err); process.exit(1); });