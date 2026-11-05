// Usage: node rec.mjs <driver.mjs> <outdir>
// Launches headless Edge, loads the page, freezes time, runs the driver at a fixed 30 fps timestep,
// screenshots the demo stage each frame.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
const [,, driverPath, outDir] = process.argv;
import { pathToFileURL } from 'node:url'; const D = (await import(pathToFileURL(path.resolve(driverPath)).href)).default;
fs.mkdirSync(outDir, { recursive: true });
const PORT = 9300 + Math.floor(Math.random() * 500);
const udd = path.resolve('edge-' + Date.now());
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${udd}`,
  '--window-size=1440,1100', '--hide-scrollbars', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--no-first-run', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { require_kill(); } catch {} };
function require_kill() { spawnSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); setTimeout(() => { try { fs.rmSync(udd, { recursive: true, force: true }); } catch {} }, 100); }
process.on('exit', cleanup);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tgt; for (let i = 0; i < 60; i++) { try { tgt = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); if (tgt) break; } catch {} await sleep(250); }
const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let mid = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.log('console.error', m.params.args.map(a => a.value || a.description).join(' ')); else if (m.method === 'Runtime.exceptionThrown') console.log('exception', m.params.exceptionDetails.exception?.description); };
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++mid; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const V=window.__vt={on:false,t:0,q:[],base:0,dbase:0};
const pn=performance.now.bind(performance),dn=Date.now,rr=window.requestAnimationFrame.bind(window),cr=window.cancelAnimationFrame.bind(window);let id=1e6;
performance.now=()=>V.on?V.base+V.t:pn(); Date.now=()=>V.on?V.dbase+V.t:dn();
window.requestAnimationFrame=cb=>{if(V.on){const i=++id;V.q.push([i,cb]);return i;}return rr(ts=>{if(V.on){V.q.push([++id,cb]);}else cb(ts);});};
window.cancelAnimationFrame=i=>{V.q=V.q.filter(x=>x[0]!==i);cr(i);};
V.start=()=>{V.base=pn();V.dbase=dn();V.t=0;V.on=true;};
const st=window.setTimeout.bind(window),ct=window.clearTimeout.bind(window),si=window.setInterval.bind(window),ci=window.clearInterval.bind(window);V.tm=[];
window.setTimeout=(cb,ms,...a)=>{if(!V.on)return st(cb,ms,...a);const i=++id;V.tm.push({i,due:V.t+(+ms||0),cb,a});return i;};
window.setInterval=(cb,ms,...a)=>{if(!V.on)return si(cb,ms,...a);const i=++id;V.tm.push({i,due:V.t+Math.max(+ms||0,4),cb,a,iv:Math.max(+ms||0,4)});return i;};
window.clearTimeout=window.clearInterval=i=>{V.tm=V.tm.filter(x=>x.i!==i);ct(i);ci(i);};
V.fire=()=>{for(let k=0;k<50;k++){V.tm.sort((x,y)=>x.due-y.due);const x=V.tm[0];if(!x||x.due>V.t)break;if(x.iv)x.due+=x.iv;else V.tm.shift();try{typeof x.cb==='function'?x.cb(...x.a):0;}catch(e){console.error(e);}}};
V.step=async dt=>{const end=V.t+dt;while(true){V.tm.sort((x,y)=>x.due-y.due);const n=V.tm[0];if(!n||n.due>end)break;V.t=Math.max(V.t,n.due);V.fire();await Promise.resolve();await new Promise(r=>st(r,0));}V.t=end;V.fire();const q=V.q;V.q=[];const now=V.base+V.t;for(const [,cb] of q){try{cb(now);}catch(e){console.error(e);}}};})();` });
await send('Page.navigate', { url: D.url });
await sleep(1500); await ev("(document.querySelector('#live-demo')||document.body).scrollIntoView({block:'start'}), true").catch(()=>{});
for (let i = 0; i < 240; i++) { await sleep(500); if (await ev(D.ready).catch(() => false)) break; if (i === 239 || (process.env.DBG && i === 20)) { console.log(await ev("location.href+' '+document.readyState+' '+String(!!window.__tb3)+' '+document.querySelectorAll('canvas').length+' '+(document.querySelector('.ds-status')||{}).textContent+' scroll '+scrollY")); throw new Error('not ready'); } }
await sleep(D.settle ?? 1500);
const sel = D.crop || '.ds-stage';
await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'start'}); window.scrollBy(0,-20); true`);
await sleep(300);
if (D.before) await D.before({ ev, send, sleep });
await ev('__vt.start(), true');
const FPS = 30, N = Math.round(D.seconds * FPS);
const mouse = (type, x, y, buttons = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
const ctx = { ev, send, sleep, mouse };
let endAt = Infinity;
for (let f = 0; f < N && f < endAt; f++) {
  const t = f / FPS;
  if (D.done && endAt === Infinity && f % 10 === 0 && await ev(D.done).catch(() => false)) endAt = f + Math.round((D.tail ?? 1) * FPS);
  if (D.frame) await D.frame(t, ctx);
  for (let k = 0; k < (D.speed || 1); k++) await ev(`__vt.step(${1000/30}).then(()=>true)`);
  await sleep(D.wait ?? 15);
  const r = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(),m=document.querySelector(".ds-main").getBoundingClientRect();return [r.left,r.top+scrollY,r.width,Math.max(m.height,${D.minH||0})]})()`);
  const W = Math.round(r[2]), H = Math.round(r[3]) & ~1;
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: r[0], y: r[1], width: W, height: H, scale: 1280 / W }, captureBeyondViewport: false });
  fs.writeFileSync(path.join(outDir, `f${String(f).padStart(4, '0')}.png`), Buffer.from(shot.data, 'base64'));
}
console.log('frames', Math.min(N, endAt));
ws.close(); cleanup(); await sleep(2000); process.exit(0);
