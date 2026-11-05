// node shot.mjs <url> <width> <out.png> [js-before-load] [js-after] [throttle]
import { spawn, spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const [,, url, width, out, pre = '', post = '', thr = ''] = process.argv;
const PORT = 9800 + Math.floor(Math.random() * 150), udd = path.resolve('edge-s' + Date.now());
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${udd}`, '--hide-scrollbars', '--no-first-run', '--use-angle=d3d11', '--enable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let t; for (let i = 0; i < 60 && !t; i++) { await sleep(250); try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const P = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { P.get(m.id)?.(m); P.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') console.log('EXC', m.params.exceptionDetails.exception?.description); else if (m.method === 'Runtime.consoleAPICalled') console.log('console', m.params.args.map(a => a.value ?? a.description).join(' ')); };
const send = (method, params = {}) => new Promise(r => { P.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async e => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable');
const W = +width; await send('Emulation.setDeviceMetricsOverride', { width: W, height: W < 600 ? 844 : 900, deviceScaleFactor: W < 600 ? 2 : 1, mobile: W < 600 });
if (process.env.RM) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: process.env.CS || 'light' }] });
if (thr) await send('Emulation.setCPUThrottlingRate', { rate: +thr });
if (pre) await send('Page.addScriptToEvaluateOnNewDocument', { source: pre });
await send('Page.navigate', { url }); await sleep(4000);
if (post) console.log('post:', JSON.stringify(await ev(post)));
await sleep(+process.env.WAIT || 1500);
const s = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(s.result.data, 'base64'));
ws.close(); spawnSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); await sleep(800); try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
process.exit(0);
