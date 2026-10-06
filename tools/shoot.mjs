// node shoot.mjs <out.jpg> <url> <w> <h> [dpr] [lang] [js-to-run-before-shot]
// One headless Chrome, own profile, form/chat/WhatsApp hosts mapped to 0.0.0.0; stops only its own PID.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const [out, url, w = '1440', h = '900', dpr = '1', lang = 'en', before = ''] = process.argv.slice(2);
const PROFILE = join(import.meta.dirname, 'chrome-profile-shoot'); rmSync(PROFILE, { recursive: true, force: true }); mkdirSync(PROFILE);
const BLOCK = ['formspree.io', '*.formspree.io', 'wa.me', 'api.whatsapp.com', '*.workers.dev', 'api.anthropic.com'];
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--user-data-dir=${PROFILE}`, '--remote-debugging-port=0',
  `--host-resolver-rules=${BLOCK.map(x => `MAP ${x} 0.0.0.0`).join(', ')}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const stop = () => { try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} };
process.on('uncaughtException', e => { console.error('ERR', e.message); stop(); process.exit(1); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let port; for (let i = 0; i < 100 && !port; i++) { await sleep(100); const f = join(PROFILE, 'DevToolsActivePort'); if (existsSync(f)) { try { port = Number(readFileSync(f, 'utf8').split('\n')[0]) || undefined; } catch {} } }
const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('skyline_lang','${lang}');localStorage.setItem('skyline_cookie_consent','accepted')}catch(e){}` });
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: +dpr, mobile: +w < 800 });
await send('Page.navigate', { url }); await sleep(4500);
if (before) { const r = await send('Runtime.evaluate', { expression: before, awaitPromise: true, returnByValue: true }); console.log('before ->', JSON.stringify(r.result?.result?.value)); await sleep(1500); }
const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
writeFileSync(out, Buffer.from(s.result.data, 'base64'));
console.log('shot', out, errs.length ? 'JS ERRORS: ' + errs.join(' | ') : 'no JS errors');
ws.close(); stop();
