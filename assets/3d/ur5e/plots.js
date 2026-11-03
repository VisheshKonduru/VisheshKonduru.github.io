// Small canvas plots drawn in the page's own type and colours. No library.

export const JOINT_COLORS_LIGHT = ['#0f8b8d', '#16171a', '#b0602a', '#6b7079', '#2f63a8', '#8a5a9e'];
export const JOINT_COLORS_DARK = ['#3cc3c4', '#eeece7', '#e09a62', '#a3a7ae', '#8db8f2', '#c49ad6'];

export function css(el, name, fb) { return getComputedStyle(el).getPropertyValue(name).trim() || fb; }

function setup(canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2), W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  return { g, W, H };
}
const niceStep = span => { const raw = span / 3, p = 10 ** Math.floor(Math.log10(raw)); return p * [1, 2, 5, 10].find(m => m * p >= raw * 0.999); };
const minus = s => s.replace('-', '−');
const tickText = (y, step) => { const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9)); return minus((Math.abs(y) < step / 1e6 ? 0 : y).toFixed(d)); };

// Time series. series: [{ t:[], y:[], color, dash, width, label }]; marks: [{t, label}]
export function timePlot(canvas, root, { series, marks = [], tNow, window = 10, yLabel = '', zero = false }) {
  const { g, W, H } = setup(canvas);
  const ink2 = css(root, '--ink-2', '#3d4047'), rule = css(root, '--rule', '#dedad2'), font = getComputedStyle(root).fontFamily;
  const L = 48, Rt = 22, T = 8, B = 20, pw = W - L - Rt, ph = H - T - B;
  const t0 = Math.max(0, tNow - window);
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (let i = 0; i < s.t.length; i++) if (s.t[i] >= t0) { lo = Math.min(lo, s.y[i]); hi = Math.max(hi, s.y[i]); }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  if (zero) lo = Math.min(lo, 0);
  if (hi - lo < 1e-6) { if (zero) hi = lo + 1; else { hi += 0.5; lo -= 0.5; } }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step + 1e-9) * step; hi = Math.ceil(hi / step - 1e-9) * step;
  const X = t => L + ((t - t0) / window) * pw, Y = y => T + ph - ((y - lo) / (hi - lo)) * ph;
  g.font = `13px ${font}`; g.fillStyle = ink2; g.strokeStyle = rule; g.lineWidth = 1;
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let y = lo; y <= hi + step * 0.01; y += step) {
    const py = Math.round(Y(y)) + 0.5;
    g.beginPath(); g.moveTo(L, py); g.lineTo(L + pw, py); g.stroke();
    g.fillText(tickText(y, step), L - 6, py);
  }
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText(`time, ${window} s window`, L, T + ph + 4);
  if (yLabel) { g.textAlign = 'right'; g.fillText(yLabel, L + pw, T + ph + 4); }
  let mk = 0;
  for (const m of marks) if (m.t >= t0) {
    const ty = T + 1 + (mk++ % 2) * 15;
    const px = Math.round(X(m.t)) + 0.5;
    g.strokeStyle = ink2; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(px, T); g.lineTo(px, T + ph); g.stroke(); g.setLineDash([]);
    g.textBaseline = 'top'; g.fillStyle = ink2;
    if (px + 4 + g.measureText(m.label).width > L + pw) { g.textAlign = 'right'; g.fillText(m.label, px - 4, ty); }
    else { g.textAlign = 'left'; g.fillText(m.label, px + 4, ty); }
  }
  g.save(); g.beginPath(); g.rect(L, T - 2, pw + 2, ph + 4); g.clip();
  for (const s of series) {
    g.strokeStyle = s.color; g.lineWidth = s.width || 1.5; g.setLineDash(s.dash || []);
    g.beginPath(); let started = false;
    for (let i = 0; i < s.t.length; i++) { if (s.t[i] < t0) continue; const x = X(s.t[i]), y = Y(s.y[i]); started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; }
    g.stroke();
  }
  g.restore(); g.setLineDash([]);
  g.textAlign = 'left'; g.textBaseline = 'middle';
  const labs = series.filter(s => s.label && s.y.length).map(s => ({ s, y: Math.max(T + 6, Math.min(T + ph - 6, Y(s.y[s.y.length - 1]))) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labs.length; i++) labs[i].y = Math.max(labs[i].y, labs[i - 1].y + 13);
  const over = labs.length ? labs[labs.length - 1].y - (T + ph + 8) : 0;
  if (over > 0) labs.forEach(l => (l.y -= over));
  for (const l of labs) { g.fillStyle = l.s.color; g.fillText(l.s.label, L + pw + 6, l.y); }
}

// Joint torques against limits, split into parts. rows: [{ name, limit, total, parts:[{v}] }]
export function torqueBars(canvas, root, rows, partColors) {
  const { g, W, H } = setup(canvas);
  const ink = css(root, '--ink', '#16171a'), ink2 = css(root, '--ink-2', '#3d4047'), rule = css(root, '--rule', '#dedad2'), font = getComputedStyle(root).fontFamily;
  const L = 34, Rt = 108, rowH = H / rows.length, pw = W - L - Rt, cx = L + pw / 2;
  g.font = `13px ${font}`; g.textBaseline = 'middle';
  rows.forEach((r, k) => {
    const mid = k * rowH + rowH / 2, sx = (pw / 2) / r.limit;
    g.fillStyle = ink2; g.textAlign = 'left'; g.fillText(r.name, 0, mid);
    g.strokeStyle = rule; g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, Math.round(mid) + 0.5); g.lineTo(L + pw, Math.round(mid) + 0.5); g.stroke();
    g.strokeStyle = ink2;
    for (const x of [L, L + pw]) { g.beginPath(); g.moveTo(Math.round(x) + 0.5, mid - rowH * 0.38); g.lineTo(Math.round(x) + 0.5, mid + rowH * 0.38); g.stroke(); }
    g.beginPath(); g.moveTo(Math.round(cx) + 0.5, mid - rowH * 0.3); g.lineTo(Math.round(cx) + 0.5, mid + rowH * 0.3); g.stroke();
    const bh = Math.max(3, rowH * 0.16);
    r.parts.forEach((p, j) => {
      const v = Math.max(-r.limit, Math.min(r.limit, p.v));
      g.fillStyle = partColors[j];
      g.fillRect(Math.min(cx, cx + v * sx), mid - rowH * 0.36 + j * (bh + 1), Math.abs(v * sx), bh);
    });
    const tv = Math.max(-r.limit, Math.min(r.limit, r.total));
    g.fillStyle = ink; g.fillRect(Math.round(cx + tv * sx) - 1, mid - rowH * 0.42, 3, rowH * 0.84);
    g.textAlign = 'right';
    g.fillText(`${minus((Math.abs(r.total) < 0.05 ? 0 : r.total).toFixed(1))} / ${r.limit}`, W, mid);
  });
}

// Quintic time scaling s(tau) and its rate, with the current point.
export function quinticPlot(canvas, root, u, color) {
  const { g, W, H } = setup(canvas);
  const ink = css(root, '--ink', '#16171a'), ink2 = css(root, '--ink-2', '#3d4047'), rule = css(root, '--rule', '#dedad2'), font = getComputedStyle(root).fontFamily;
  const L = 48, Rt = 96, T = 8, B = 20, pw = W - L - Rt, ph = H - T - B;
  const X = x => L + x * pw, Y = y => T + ph - y * ph;
  g.strokeStyle = rule; g.lineWidth = 1;
  for (const y of [0, 1]) { g.beginPath(); g.moveTo(L, Math.round(Y(y)) + 0.5); g.lineTo(L + pw, Math.round(Y(y)) + 0.5); g.stroke(); }
  g.font = `13px ${font}`; g.fillStyle = ink2; g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillText('1', L - 6, Y(1)); g.fillText('0', L - 6, Y(0));
  g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText('τ = t / T, from 0 to 1', L, T + ph + 4);
  const s = x => 10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5, sd = x => (30 * x ** 2 - 60 * x ** 3 + 30 * x ** 4) / 1.875;
  for (const [f, c, d, lab, ly] of [[s, ink, [], 's(τ)', Y(1)], [sd, color, [5, 3], 'ds/dτ, scaled', Y(0.12)]]) {
    g.strokeStyle = c; g.lineWidth = 1.5; g.setLineDash(d); g.beginPath();
    for (let i = 0; i <= 60; i++) { const x = i / 60; i ? g.lineTo(X(x), Y(f(x))) : g.moveTo(X(x), Y(f(x))); }
    g.stroke(); g.setLineDash([]);
    g.fillStyle = c; g.textBaseline = 'middle'; g.fillText(lab, X(1) + 6, ly);
  }
  if (u != null) {
    g.fillStyle = ink; g.beginPath(); g.arc(X(u), Y(s(u)), 4, 0, 7); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc(X(u), Y(sd(u)), 4, 0, 7); g.fill();
  }
}
