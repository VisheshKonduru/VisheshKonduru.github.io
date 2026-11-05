// Lite mode: swaps the live 3D demos for recorded loops, and back, without a reload.
// The choice lives in localStorage under KEY ('on' or 'off'). With no stored choice, lite is the
// default only for reduced data, Save-Data or a very weak device; otherwise the live demo runs,
// its frame time is measured for about 2 s, and a slow or failed start falls back to the loop.
(function () {
  var KEY = 'liteMode';
  var store = {
    get: function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set: function (v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  };
  var mm = function (q) { try { return matchMedia(q).matches; } catch (e) { return false; } };
  var still = mm('(prefers-reduced-motion: reduce)');
  var nav = navigator, conn = nav.connection || {};
  var weak = mm('(prefers-reduced-data: reduce)') || conn.saveData === true ||
    (nav.deviceMemory && nav.deviceMemory <= 2) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2);
  var saved = store.get();
  var lite = saved ? saved === 'on' : !!weak;
  var medians = [];
  var demos = [].slice.call(document.querySelectorAll('[data-demo]'));
  var btn = null;

  function webglOk() {
    try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
  }
  // A weak GPU name is only a hint (modern Iris Xe runs the demos fine): it keeps the measuring on longer.
  function gpuHint() {
    try {
      var g = document.createElement('canvas').getContext('webgl'), x = g && g.getExtension('WEBGL_debug_renderer_info');
      var s = x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : '';
      return /SwiftShader|llvmpipe|UHD|Iris|Intel/i.test(s || '');
    } catch (e) { return false; }
  }

  // ---------- header control ----------
  function header() {
    var navEl = document.querySelector('.site-nav');
    if (!navEl) return;
    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'lite-toggle';
    btn.addEventListener('click', function () { setLite(!lite, true); });
    navEl.appendChild(btn);
    label();
  }
  function label() {
    if (!btn) return;
    btn.textContent = lite ? 'Lite mode: on' : 'Lite mode: off';
    btn.setAttribute('aria-pressed', String(lite));
  }
  function setLite(v, remember) {
    lite = v; if (remember) store.set(v ? 'on' : 'off');
    label(); demos.forEach(apply);
  }

  // ---------- one embed ----------
  function parts(d) {
    if (d._lite) return d._lite;
    var fig = d.querySelector('.live-fig');
    var cfg = JSON.parse(d.getAttribute('data-lite') || '{"loops":[]}');
    var box = document.createElement('div'); box.className = 'lite'; box.hidden = true;
    var tabs = null, cur = 0;
    var v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'none';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.setAttribute('aria-label', cfg.label || 'Demo');
    var frame = document.createElement('div'); frame.className = 'lite-frame';
    frame.appendChild(v);
    if (cfg.loops.length > 1) {
      tabs = document.createElement('div'); tabs.className = 'lite-tabs'; tabs.setAttribute('role', 'tablist');
      cfg.loops.forEach(function (l, i) {
        var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = l.label;
        b.addEventListener('click', function () { pick(i); });
        tabs.appendChild(b);
      });
      box.appendChild(tabs);
    }
    box.appendChild(frame);
    var row = document.createElement('p'); row.className = 'lite-row';
    var play = null;
    if (still) {
      play = document.createElement('button'); play.type = 'button'; play.className = 'lite-play'; play.textContent = 'Play';
      play.addEventListener('click', function () { if (v.paused) { v.play().catch(function () {}); } else v.pause(); });
      v.addEventListener('play', function () { play.textContent = 'Pause'; });
      v.addEventListener('pause', function () { play.textContent = 'Play'; });
      row.appendChild(play);
    }
    var run = document.createElement('a'); run.href = '#' + (d.id || ''); run.className = 'lite-run'; run.textContent = 'Run it live';
    run.addEventListener('click', function (e) { e.preventDefault(); d._forceLive = true; store.set('off'); setLite(false, false); });
    row.appendChild(run);
    box.appendChild(row);
    d.insertBefore(box, fig);
    function pick(i) {
      cur = i; var l = cfg.loops[i]; if (!l) return;
      if (tabs) [].forEach.call(tabs.children, function (b, j) { b.setAttribute('aria-selected', String(j === i)); b.tabIndex = j === i ? 0 : -1; });
      frame.style.aspectRatio = l.w + ' / ' + l.h;
      v.poster = l.poster;
      v.innerHTML = '<source src="' + l.av1 + '" type="video/mp4; codecs=av01.0.08M.08"><source src="' + l.mp4 + '" type="video/mp4">';
      v.load();
      if (P.inView && !still) v.play().catch(function () {});
    }
    var P = d._lite = { box: box, fig: fig, v: v, pick: pick, inView: false };
    pick(0);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          P.inView = e.isIntersecting;
          if (box.hidden) return;
          if (e.isIntersecting && !still) v.play().catch(function () {}); else v.pause();
        });
      }, { threshold: 0.25 }).observe(frame);
    }
    return P;
  }

  function apply(d) {
    var P = parts(d);
    if (lite && !d._forceLive) {
      P.box.hidden = false; P.fig.hidden = true;
      if (P.inView && !still) P.v.play().catch(function () {});
    } else {
      P.box.hidden = true; P.fig.hidden = false; P.v.pause();
      watch(d);
    }
  }

  // ---------- live loading, with a measured fallback ----------
  var lo = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { lo.unobserve(e.target); load(e.target); } });
  }, { rootMargin: '300px' }) : null;
  function watch(d) { if (d.dataset.loaded) return; if (lo) lo.observe(d); else load(d); }
  function load(d) {
    if (d.dataset.loaded || (lite && !d._forceLive)) return;
    if (!webglOk()) { fallback(d); return; }
    d.dataset.loaded = '1';
    var t0 = performance.now();
    if (!store.get()) measure(d, t0);
    import(new URL(d.dataset.demo, location.href).href).catch(function (e) { console.error(e); fallback(d); });
  }
  // Once the demo's canvas exists, frame intervals are sampled in 2 s windows while it is on
  // screen, for the first 30 s on screen (60 s on a GPU named like an integrated one) (most demos render only on demand, so the first slow
  // window is often the first interaction). Two windows in a row whose median is over the limit fall back.
  function measure(d, t0) {
    var limit = 40, span = gpuHint() ? 60000 : 30000, times = [], last = 0, onScreen = false, win = 0, seen = 0, slow = 0, mounted = 0;
    var io = new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; }, { threshold: 0.2 });
    io.observe(d.querySelector('.live-fig'));
    function stop() { io.disconnect(); }
    function tick(now) {
      if (store.get() || lite) { stop(); return; }                 // the visitor chose, or lite is on
      if (!d.querySelector('.live-fig .ds-view canvas')) {                     // not mounted after 20 s counts as failed
        if (now - t0 > 20000) { stop(); fallback(d); } else requestAnimationFrame(tick);
        return;
      }
      if (!mounted) mounted = now;
      var dt = last ? now - last : 0; last = now;
      if (now - mounted < 1500) { requestAnimationFrame(tick); return; }   // meshes and shaders still loading
      if (!onScreen || document.hidden || dt > 3000) { win = 0; times = []; requestAnimationFrame(tick); return; }
      if (!win) { win = now + 400; requestAnimationFrame(tick); return; }   // skip frames right after showing
      if (now > win) { times.push(dt); seen += dt; }
      if (now - win > 2000 && times.length) {
        times.sort(function (a, b) { return a - b; });
        medians.push(Math.round(times[times.length >> 1]));
        slow = times[times.length >> 1] > limit ? slow + 1 : 0;
        if (slow >= 2) { stop(); fallback(d); return; }                   // two slow windows in a row
        times = []; win = now;
        if (seen > span) { stop(); return; }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  function fallback(d) {
    if (d._forceLive) return;
    store.set('on'); setLite(true, false);
  }

  header();
  demos.forEach(apply);
  window.__lite = { set: setLite, get: function () { return lite; }, medians: medians };
})();
