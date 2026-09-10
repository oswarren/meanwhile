// Minimal Chrome DevTools Protocol driver using Node's built-in fetch and WebSocket (Node 22+, no packages).
// Used by browser-test.js. Launches a headless Chrome (or Edge) with a throwaway profile.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
function findBrowser() {
  const b = CANDIDATES.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
  if (!b) throw new Error('no Chrome or Edge found; set CHROME=<path to browser executable>');
  return b;
}

function freePort() {
  return new Promise((res, rej) => { const srv = require('net').createServer(); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => res(p)); }); srv.on('error', rej); });
}

async function launch(port, size = [1000, 760]) {
  const browser = findBrowser();
  if (!port) port = await freePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meanwhile-profile-'));
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, `--window-size=${size[0]},${size[1]}`, 'about:blank'], { stdio: 'ignore' });
  let info = [];
  for (let i = 0; i < 100 && !info.length; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch (e) { await sleep(200); }
  }
  const page = info.find(t => t.type === 'page');
  if (!page) { proc.kill(); throw new Error('browser did not expose a page target (is port ' + port + ' free?)'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = new Set(); const errors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method) { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); for (const l of listeners) l(m); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const waitEvent = method => new Promise(res => { const l = m => { if (m.method === method) { listeners.delete(l); res(m.params); } }; listeners.add(l); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false });
  return {
    send, waitEvent, errors, browser,
    async goto(url) { const p = waitEvent('Page.loadEventFired'); await send('Page.navigate', { url }); await p; await sleep(400); },
    async reload() { const p = waitEvent('Page.loadEventFired'); await send('Page.reload'); await p; await sleep(400); },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('page threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async shot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return file; },
    close() {
      try { ws.close(); } catch (e) {}
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); else proc.kill();
      setTimeout(() => { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {} }, 800);
    },
  };
}
module.exports = { launch, sleep };
