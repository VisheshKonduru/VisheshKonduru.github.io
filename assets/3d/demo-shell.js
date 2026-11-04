// Shared demo layout: scene tabs, flow row, view (+ optional side view with its own tabs),
// one status sentence, a Details disclosure, and first-run coach marks.
// Every demo builds its controls through this so they all look and behave the same.
const CSS = new URL('demo-shell.css', import.meta.url).href;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.25,.1,.25,1)';

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}
export const fade = (el, from = 0.35) => { if (!reduce() && el.animate) el.animate([{ opacity: from }, { opacity: 1 }], { duration: 280, easing: EASE }); };

function tabRow(label, items, onPick, initial) {
  const row = h('div', { class: 'ds-tabs', role: 'tablist', 'aria-label': label });
  const ind = h('span', { class: 'ds-ind', 'aria-hidden': 'true' });
  const tabs = items.map(it => h('button', { type: 'button', role: 'tab', 'data-id': it.id, 'aria-selected': String(it.id === initial), tabindex: it.id === initial ? '0' : '-1', text: it.label }));
  row.append(...tabs, ind);
  const place = () => { const t = tabs.find(x => x.getAttribute('aria-selected') === 'true'); if (!t || !t.offsetWidth) return; ind.style.width = t.offsetWidth + 'px'; ind.style.top = '0'; ind.style.bottom = 'auto'; ind.style.transform = `translate(${t.offsetLeft}px, ${t.offsetTop + t.offsetHeight - 6}px)`; };
  const select = (id, fire = true) => {
    tabs.forEach(t => { const on = t.dataset.id === id; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    place(); if (fire) onPick(id);
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => { if (t.getAttribute('aria-selected') !== 'true') select(t.dataset.id); });
    t.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); n.click(); e.preventDefault();
    });
  });
  new ResizeObserver(place).observe(row); requestAnimationFrame(place);
  return { row, tabs, select, place };
}

// opts: { id, label, scenes: [{id,label}], scene, onScene(id), side: bool, sideLabel, views: [{id,label}], view, onView(id) }
export function createShell(root, opts) {
  if (!document.querySelector('link[data-ds-css]')) document.head.append(h('link', { rel: 'stylesheet', href: CSS, 'data-ds-css': '' }));
  root.classList.add('ds');
  root.style.position = 'relative';
  const S = { scene: opts.scene || opts.scenes?.[0]?.id, buttons: {} };
  const tabs = opts.scenes && opts.scenes.length > 1 ? tabRow('Scene', opts.scenes, id => { S.scene = id; fade(view); opts.onScene && opts.onScene(id); }, S.scene) : null;
  const flow = h('div', { class: 'ds-flow' });
  const view = h('div', { class: 'ds-view', tabindex: '0', role: 'application', 'aria-label': opts.viewLabel || opts.label });
  const status = h('p', { class: 'ds-status', role: 'status', 'aria-live': 'polite' });
  const main = h('div', { class: 'ds-main' }, view, status);
  // Right-hand column (stacked under the view below 1100 px): optional side view, then the readout.
  let side = null, sideBody = null, sideTabs = null;
  if (opts.side) {
    sideBody = h('div', { class: 'ds-side-body' });
    sideTabs = opts.views ? tabRow(opts.sideLabel || 'View', opts.views, id => { fade(sideBody, 0.5); opts.onView && opts.onView(id); }, opts.view || opts.views[0].id) : null;
    side = h('div', { class: 'ds-side' }, sideTabs && sideTabs.row, sideBody);
  }
  const ro = h('div', { class: 'ds-ro', role: 'region', 'aria-label': 'Readout' });
  ro.hidden = true;
  const panels = h('div', { class: 'ds-panels' });
  const more = h('button', { type: 'button', class: 'ds-ro-more', text: 'Numbers', 'aria-expanded': 'false', onclick: () => { ro.hidden = !ro.hidden; more.setAttribute('aria-expanded', String(!ro.hidden)); if (!ro.hidden) fade(ro, 0); } });
  const col = h('aside', { class: 'ds-col' }, side, panels, more, ro);
  const stage = h('div', { class: 'ds-stage' }, main, col);
  const below = h('div', { class: 'ds-below' });
  const live = h('p', { style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);margin:0', 'aria-live': 'assertive' });
  root.append(...[tabs && tabs.row, flow, stage, below, live].filter(Boolean));
  // Desktop: the column is exactly as tall as the view, so the readout stays in sight.
  const wide = matchMedia('(min-width: 1100px)');
  const fit = () => { col.style.height = wide.matches ? view.offsetHeight + 'px' : ''; };
  new ResizeObserver(fit).observe(view); wide.addEventListener('change', fit);
  // Any old figure caption is dropped: the readout and status carry the information now.
  root.closest('figure')?.querySelector(':scope > figcaption')?.remove();

  // ---------- readout ----------
  // groups: [{ id, title, items: [{ id, label, unit, desc }] }]
  const cells = {}, groupEls = {};
  function readout(groups) {
    ro.replaceChildren();
    for (const g of groups) {
      const dl = h('dl', { class: 'ds-ro-list' });
      for (const it of g.items) {
        const v = h('span', { class: 'ds-ro-v', text: '–' });
        cells[it.id] = v;
        dl.append(h('div', { class: 'ds-ro-row' }, h('dt', { text: it.label }), h('dd', {}, v, it.unit ? h('span', { class: 'ds-ro-u', text: ' ' + it.unit }) : null), it.desc ? h('p', { class: 'ds-ro-d', text: it.desc }) : null));
      }
      const sec = h('section', { class: 'ds-ro-g' }, h('h3', { class: 'ds-ro-h', text: g.title }), dl);
      groupEls[g.id] = sec; ro.append(sec);
    }
  }
  function set(id, value) { const c = cells[id]; if (c && c.textContent !== String(value)) c.textContent = value; }
  // Put the group for the current scene or step first.
  function focusGroup(ids) { const order = [].concat(ids); for (const id of order.slice().reverse()) if (groupEls[id]) ro.prepend(groupEls[id]); }
  // ---------- small live visuals ----------
  // panel(title, height) -> { sec, canvas, draw(fn) }; fn(ctx, w, h, colours) runs on a DPR-sized canvas.
  function panel(title, height = 120) {
    const canvas = h('canvas', { class: 'ds-plot', style: `height:${height}px`, role: 'img', 'aria-label': title });
    const sec = h('section', { class: 'ds-panel' }, h('h3', { class: 'ds-ro-h', text: title }), canvas);
    panels.append(sec);
    const P = { sec, canvas, last: 0,
      draw(fn, force = false) {
        const now = performance.now(); if (!force && now - P.last < 100) return; P.last = now;   // at most 10 Hz
        if (!sec.offsetParent) return;
        const d = Math.min(devicePixelRatio || 1, 2), w = canvas.clientWidth, hh = canvas.clientHeight;
        if (canvas.width !== Math.round(w * d)) { canvas.width = Math.round(w * d); canvas.height = Math.round(hh * d); }
        const ctx = canvas.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, hh);
        ctx.font = '13px system-ui, sans-serif'; ctx.lineWidth = 1.25; ctx.textBaseline = 'alphabetic';
        fn(ctx, w, hh, colours());
      } };
    return P;
  }
  const colours = () => { const cs = getComputedStyle(root), g = (v, f) => cs.getPropertyValue(v).trim() || f;
    return { ink: g('--ink', '#16171a'), ink2: g('--ink-2', '#3d4047'), rule: g('--rule', '#dedad2'), mark: g('--mark', '#0f8b8d'), frame: g('--frame', '#eeebe4'), paper: g('--paper', '#faf8f4') }; };
  // Optional extra node at the end of the column (e.g. a checkbox).
  const colExtra = (n) => ro.after(n);

  let lastSaid = '', lastHead = '';
  function say(t) {
    if (t === lastSaid) return; lastSaid = t; status.textContent = t;
    const head = t.slice(0, 14); if (head !== lastHead) { lastHead = head; fade(status, 0); }
  }
  // items: { step: text, id } | { primary: label, onClick, id } | { node } ; more: [{ label, onClick, id, pressed }]
  function setFlow(items, more = []) {
    flow.replaceChildren(); S.buttons = {}; S.steps = {};
    items.forEach((it, i) => {
      if (i) flow.append(h('span', { class: 'ds-arr', 'aria-hidden': 'true', text: '→' }));
      let n;
      if (it.primary) n = S.buttons[it.id || it.primary] = h('button', { type: 'button', class: 'ds-primary', text: it.primary, onclick: it.onClick });
      else if (it.node) n = it.node;
      else n = h('span', { class: 'ds-step', text: it.step });
      if (it.id) S.steps[it.id] = n;
      flow.append(n);
    });
    const coachBtn = S.coach ? h('button', { type: 'button', text: 'Show steps again', onclick: () => startCoach(true) }) : null;
    const m = more.map(b => (S.buttons[b.id || b.label] = h('button', { type: 'button', text: b.label, onclick: b.onClick, 'aria-pressed': b.pressed == null ? null : String(b.pressed) })));
    if (m.length || coachBtn) flow.append(h('span', { class: 'ds-more' }, ...m, coachBtn));
    fade(flow, 0.4);
    return S.buttons;
  }
  function current(id) { for (const [k, n] of Object.entries(S.steps || {})) { if (k === id) n.setAttribute('aria-current', 'step'); else n.removeAttribute('aria-current'); } }

  // ---------- coach marks ----------
  // coach(sceneId, steps): steps = [{ key, text, target: () => Element, at?: [fx, fy] }]
  const coaches = {};
  let C = null;
  const box = h('div', { class: 'ds-coach', role: 'dialog', 'aria-modal': 'false', hidden: true });
  const boxText = h('p', { class: 'ds-coach-text' }), boxCount = h('span', { class: 'ds-coach-count' });
  const skip = h('button', { type: 'button', class: 'ds-coach-skip', text: 'Skip', onclick: () => endCoach(true) });
  const arrow = h('span', { class: 'ds-coach-arrow', 'aria-hidden': 'true' });
  box.append(arrow, boxText, h('div', { class: 'ds-coach-foot' }, boxCount, skip));
  root.append(box);
  // Completion lasts for this page view only: the steps come back on every load.
  const finished = new Set();
  const seen = (sc) => finished.has(sc);
  const mark = (sc) => finished.add(sc);
  function coach(sceneId, steps) { coaches[sceneId] = steps; S.coach = true; }
  function startCoach(force = false) {
    endCoach(false);
    const steps = coaches[S.scene]; if (!steps || (!force && seen(S.scene))) return;
    if (new URLSearchParams(location.search).has('nocoach') && !force) return;
    C = { scene: S.scene, steps, i: 0 }; showStep();
  }
  let target = null;
  function showStep() {
    if (target) target.classList.remove('ds-coach-target');
    const st = C.steps[C.i]; target = st.target();
    if (target) target.classList.add('ds-coach-target');
    boxText.textContent = st.text; boxCount.textContent = `${C.i + 1} of ${C.steps.length}`;
    live.textContent = `Step ${C.i + 1} of ${C.steps.length}. ${st.text}`;
    box.hidden = false; position();
    if (box.animate) box.animate(reduce() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 250, easing: EASE });
    if (target && C.focus !== false && (target.tabIndex >= 0 || /BUTTON|SELECT|INPUT/.test(target.tagName))) target.focus({ preventScroll: true });
  }
  function position() {
    if (!C || box.hidden) return;
    const st = C.steps[C.i], t = target; if (!t) return;
    const r0 = root.getBoundingClientRect(), r = t.getBoundingClientRect();
    let ax = r.left + r.width / 2, ay = r.bottom;
    if (st.at) ax = r.left + r.width * st.at[0];   // never cover the spot the visitor has to click: sit below the target
    const bw = Math.min(300, root.clientWidth - 16);
    box.style.width = bw + 'px';
    let left = ax - r0.left - 28; left = Math.max(0, Math.min(root.clientWidth - bw, left));
    box.style.left = left + 'px'; box.style.top = (ay - r0.top + 12) + 'px';
    arrow.style.left = Math.max(10, Math.min(bw - 22, ax - r0.left - left - 6)) + 'px';
  }
  new ResizeObserver(position).observe(root); addEventListener('resize', position);
  function done(key) {
    if (!C || C.steps[C.i].key !== key) return false;
    C.i++;
    if (C.i >= C.steps.length) endCoach(true); else showStep();
    return true;
  }
  function endCoach(complete) {
    if (target) target.classList.remove('ds-coach-target'); target = null;
    if (C && complete) mark(C.scene);
    C = null; box.hidden = true;
  }
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && C) { endCoach(true); e.stopPropagation(); } });

  return {
    root, view, side, sideBody, status, below, col, flow, tabs, sideTabs, readout, set, focusGroup, colExtra, panel, panels,
    get scene() { return S.scene; }, selectScene: (id, fire = true) => { S.scene = id; tabs && tabs.select(id, fire); },
    say, setFlow, current, buttons: () => S.buttons, coach, startCoach, done, endCoach, get coaching() { return C ? C.steps[C.i].key : null; }, position,
  };
}

// ---------- plot helpers (thin lines, axis labels, no gridlines) ----------
// Axes box with y label/unit at top-left, x label at bottom-right. Returns the inner rect.
export function axes(ctx, w, h, c, { yMax, yMin = 0, yLabel = '', xLabel = '', yFmt = (v) => String(v) }) {
  const L = 40, R = 8, T = 18, B = 20, iw = w - L - R, ih = h - T - B;
  ctx.strokeStyle = c.ink2; ctx.fillStyle = c.ink2; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, T + ih); ctx.lineTo(L + iw, T + ih); ctx.stroke();
  ctx.textAlign = 'right'; ctx.fillText(yFmt(yMax), L - 5, T + 4); ctx.fillText(yFmt(yMin), L - 5, T + ih);
  ctx.textAlign = 'left'; ctx.fillText(yLabel, L + 4, 12);
  ctx.textAlign = 'right'; ctx.fillText(xLabel, L + iw, h - 4); ctx.textAlign = 'left';
  const y = (v) => T + ih - (Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin || 1) * ih;
  return { L, T, iw, ih, y };
}
export function linePlot(ctx, w, h, c, { series, yMax, yMin = 0, yLabel, xLabel, yFmt, label }) {
  const n = Math.max(2, ...series.map(s => s.ys.length));
  const A = axes(ctx, w, h, c, { yMax, yMin, yLabel, xLabel, yFmt });
  for (const s of series) {
    if (!s.ys.length) continue;
    ctx.strokeStyle = s.color || c.mark; ctx.lineWidth = s.width || 1.5; ctx.setLineDash(s.dash || []);
    ctx.beginPath(); s.ys.forEach((v, i) => { const x = A.L + (i / (n - 1)) * A.iw; i ? ctx.lineTo(x, A.y(v)) : ctx.moveTo(x, A.y(v)); }); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (label) { ctx.fillStyle = c.ink; ctx.textAlign = 'right'; ctx.fillText(label, A.L + A.iw, A.T + 10); ctx.textAlign = 'left'; }
  return A;
}
export function barPlot(ctx, w, h, c, { values, yMax, yLabel, xLabel, yFmt, color, highlight = -1, label }) {
  const A = axes(ctx, w, h, c, { yMax, yLabel, xLabel, yFmt });
  const n = Math.max(values.length, 1), bw = A.iw / n;
  values.forEach((v, i) => { ctx.fillStyle = i === highlight ? (color || c.mark) : c.ink2; const y = A.y(v); ctx.fillRect(A.L + i * bw + bw * 0.15, y, Math.max(1, bw * 0.7), A.T + A.ih - y); });
  if (label) { ctx.fillStyle = c.ink; ctx.textAlign = 'right'; ctx.fillText(label, A.L + A.iw, A.T + 10); ctx.textAlign = 'left'; }
  return A;
}
