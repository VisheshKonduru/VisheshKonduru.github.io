// Activities: justified-rows gallery that expands inline under the clicked row (like Google Images).
(function () {
  var grid = document.querySelector('.jg');
  var shell = document.getElementById('act-shell');
  if (!grid || !shell) return;

  var EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  // Run fn when an animation ends, with a timer as a backstop.
  function once(anim, fn) { var done = false; function go() { if (!done) { done = true; fn(); } } anim.onfinish = go; setTimeout(go, 600); }
  var DUR = 420;
  var still = matchMedia('(prefers-reduced-motion: reduce)');
  var items = [].slice.call(grid.querySelectorAll('.jg-item'));
  var ids = items.map(function (li) { return li.querySelector('a').dataset.act; });
  var rowOf = {};                 // activity id -> row index, from the last layout
  var panel = null, current = null;

  /* ---------- justified rows ---------- */
  function layout() {
    var W = grid.clientWidth;
    if (!W) return;
    var gap = parseFloat(getComputedStyle(grid).columnGap) || 8;
    var target = W < 560 ? 160 : W < 900 ? 200 : 280;
    var row = [], sum = 0, r = 0;
    function set(list, h, fill) {
      var used = 0;
      list.forEach(function (li, i) {
        var w = Math.floor(+li.dataset.r * h);
        if (fill && i === list.length - 1) w = W - gap * (list.length - 1) - used;
        used += w;
        li.style.width = w + 'px';
        li.querySelector('.jg-frame').style.height = Math.round(h) + 'px';
        rowOf[li.querySelector('a').dataset.act] = r;
      });
      r++;
    }
    items.forEach(function (li) {
      row.push(li);
      sum += +li.dataset.r;
      if (sum * target + gap * (row.length - 1) >= W) {
        set(row, (W - gap * (row.length - 1)) / sum, true);
        row = []; sum = 0;
      }
    });
    if (row.length) set(row, target, false);
    if (panel && current && panel.isConnected) place(current);
  }

  function item(id) { return items[ids.indexOf(id)]; }
  function link(id) { return item(id).querySelector('.jg-link'); }
  function tileMedia(id) { return item(id).querySelector('.jg-media'); }
  function cover() { return panel && panel.querySelector('.act-cover .act-media'); }
  function name(el, n) { if (el) el.style.viewTransitionName = n || ''; }

  // Put the panel right after the last item of the given activity's row.
  function place(id) {
    var r = rowOf[id], last = null;
    items.forEach(function (li) { if (rowOf[li.querySelector('a').dataset.act] === r) last = li; });
    if (last.nextElementSibling !== panel) last.after(panel);
    // Notch under the source tile.
    var t = item(id).getBoundingClientRect(), g = grid.getBoundingClientRect();
    panel.style.setProperty('--notch', (t.left - g.left + t.width / 2) + 'px');
  }

  /* ---------- panel ---------- */
  function build() {
    panel = shell.content.firstElementChild.cloneNode(true);
    panel.querySelector('.act-close').addEventListener('click', requestClose);
    panel.querySelector('.act-prev').addEventListener('click', function () { step(-1); });
    panel.querySelector('.act-next').addEventListener('click', function () { step(1); });
    swipe(panel);
  }

  /* ---------- 3D robot viewers: loaded when their panel opens, disposed when it closes ---------- */
  var viewers = [];
  function unmountViewers() { viewers.forEach(function (v) { v.off = true; if (v.dispose) v.dispose(); }); viewers = []; }
  function mountViewers() {
    panel.querySelectorAll('.robot3d[data-demo]').forEach(function (el) {
      var v = { off: false, dispose: null };
      viewers.push(v);
      import(new URL(el.dataset.demo, location.href).href).then(function (m) {
        if (!v.off && el.isConnected) v.dispose = m.mount(el);
      }).catch(function (e) { console.error(e); });
    });
  }

  function fill(id) {
    unmountViewers();
    var t = tileMedia(id), big;
    if (t.tagName === 'IMG') {
      big = document.createElement('img');
      big.src = t.currentSrc || t.src;
      big.alt = t.dataset.alt || '';
      big.width = t.naturalWidth || t.width;
      big.height = t.naturalHeight || t.height;
      big.className = 'act-media zoom';
    } else {
      big = t.cloneNode(true);
      big.className = 'act-media todo';
    }
    panel.querySelector('.act-cover').replaceChildren(big);
    var body = panel.querySelector('.act-body');
    body.replaceChildren(document.getElementById('act-' + id).content.cloneNode(true));
    var inner = panel.querySelector('.act-inner');
    var oldMore = inner.querySelector(':scope > .act-more');
    if (oldMore) oldMore.remove();
    var more = body.querySelector('.act-more');
    if (more) inner.appendChild(more);
    body.querySelectorAll('.act-more img').forEach(function (im) { im.classList.add('zoom'); });
    body.querySelectorAll('.zoom, .act-cover .zoom').forEach(zoomable);
    panel.querySelectorAll('.act-cover .zoom').forEach(zoomable);
    var h = body.querySelector('.act-title');
    h.tabIndex = -1;
    panel.setAttribute('aria-label', h.textContent);
    mountViewers();
  }

  function scrollToPanel() {
    var head = document.querySelector('.site-head');
    var top = head ? head.getBoundingClientRect().bottom : 0;
    var t = item(current).getBoundingClientRect(), p = panel.getBoundingClientRect();
    var dy = 0;
    if (p.bottom > innerHeight - 16) dy = Math.min(p.bottom - innerHeight + 16, t.top - top - 16);
    if (t.top < top) dy = t.top - top - 16;
    if (dy) scrollBy(0, dy);
  }

  // Runs the DOM change with a shared-element transition from `fromEl` to whatever `toEl()` returns.
  function transition(fromEl, update, toEl, after) {
    if (still.matches || !document.startViewTransition) {
      update();
      if (!still.matches && toEl) flip(fromEl, toEl());
      if (after) after();
      return;
    }
    items.forEach(function (li, i) { name(li, 'jg-' + i); });
    if (panel && panel.isConnected) name(panel, 'act-panel');
    name(fromEl, 'act-photo');
    var vt = document.startViewTransition(function () {
      name(fromEl);
      update();
      if (panel && panel.isConnected) name(panel, 'act-panel');
      if (toEl) name(toEl(), 'act-photo');
    });
    vt.finished.finally(function () {
      items.forEach(function (li) { name(li); });
      if (panel) name(panel);
      if (toEl) name(toEl());
      if (after) after();
    });
  }

  function grow(el, open) {
    var h = el.offsetHeight;
    return el.animate(open ? [{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }]
                           : [{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }],
      { duration: 220, easing: 'ease' });
  }

  function flip(a, b) {
    var r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
    b.style.transformOrigin = '0 0';
    b.animate([{ transform: 'translate(' + (r1.left - r2.left) + 'px,' + (r1.top - r2.top) + 'px) scale(' + r1.width / r2.width + ',' + r1.height / r2.height + ')' },
               { transform: 'none' }], { duration: DUR, easing: EASE });
  }

  function mark(id, on) {
    var l = link(id);
    l.setAttribute('aria-expanded', on ? 'true' : 'false');
    item(id).classList.toggle('on', on);
  }

  function open(id, animate) {
    if (id === current) return;
    var prev = current;
    current = id;
    var sameRow = panel && prev && rowOf[prev] === rowOf[id];
    if (!panel) build();
    var wasOpen = !!prev;
    function update() {
      if (current !== id) return;
      if (prev) mark(prev, false);
      mark(id, true);
      fill(id);
      place(id);
      if (!sameRow || !wasOpen) scrollToPanel();
    }
    function after() { var h = panel.querySelector('.act-title'); if (h) h.focus({ preventScroll: true }); }
    if (!animate) { update(); after(); return; }
    if (still.matches) {
      update();
      if (!wasOpen) grow(panel, true); else panel.animate({ opacity: [0, 1] }, { duration: 200 });
      after();
      return;
    }
    transition(tileMedia(id), update, cover, after);
  }

  function close(animate) {
    if (!panel || !current) return;
    var id = current;
    current = null;
    function update() { mark(id, false); if (!current) { unmountViewers(); panel.remove(); } }
    function after() { link(id).focus({ preventScroll: true }); }
    if (!animate) { update(); after(); return; }
    if (still.matches) { once(grow(panel, false), function () { update(); after(); }); return; }
    var c = cover();
    if (!document.startViewTransition) {
      var t = tileMedia(id), r1 = c.getBoundingClientRect(), r2 = t.getBoundingClientRect();
      c.style.transformOrigin = '0 0';
      c.animate([{ transform: 'none' }, { transform: 'translate(' + (r2.left - r1.left) + 'px,' + (r2.top - r1.top) + 'px) scale(' + r2.width / r1.width + ',' + r2.height / r1.height + ')' }], { duration: DUR, easing: EASE, fill: 'forwards' });
      once(grow(panel, false), function () { update(); after(); });
      return;
    }
    transition(c, update, function () { return tileMedia(id); }, after);
  }

  function step(d) {
    if (!current) return;
    var id = ids[(ids.indexOf(current) + d + ids.length) % ids.length];
    history.replaceState({ act: id }, '', '#' + id);
    open(id, true);
  }

  /* ---------- URL hash and history ---------- */
  function fromHash() { var h = decodeURIComponent(location.hash.slice(1)); return ids.indexOf(h) >= 0 ? h : null; }

  function requestClose() {
    if (!current) return;
    if (history.state && history.state.act) history.back();
    else { history.replaceState(null, '', location.pathname + location.search); close(true); }
  }

  grid.addEventListener('click', function (e) {
    var a = e.target.closest('.jg-link');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    var id = a.dataset.act;
    if (id === current) { requestClose(); return; }
    if (current) history.replaceState({ act: id }, '', '#' + id);
    else history.pushState({ act: id }, '', '#' + id);
    open(id, true);
  });

  addEventListener('popstate', function () {
    var id = fromHash();
    if (id) open(id, true); else close(true);
  });

  document.addEventListener('keydown', function (e) {
    if (!current || lb.open || e.altKey || e.metaKey || e.ctrlKey) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'video' || tag === 'iframe') return;
    if (e.key === 'Escape') { e.preventDefault(); requestClose(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); }
  });

  // Swipe between activities on touch.
  function swipe(el) {
    var sx = null, sy = 0;
    el.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; } });
    el.addEventListener('pointerup', function (e) {
      if (sx === null) return;
      var dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    });
    el.addEventListener('pointercancel', function () { sx = null; });
  }

  /* ---------- larger photo ---------- */
  var lb = document.querySelector('dialog.lb');
  var lbImg = lb.querySelector('img'), lbFrom = null;
  function zoomable(im) {
    if (im.dataset.z) return;
    im.dataset.z = '1';
    im.tabIndex = 0;
    im.setAttribute('role', 'button');
    im.setAttribute('aria-label', 'View larger' + (im.alt ? ': ' + im.alt : ''));
    im.addEventListener('click', function () { zoom(im); });
    im.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoom(im); } });
  }
  function zoom(im) {
    lbFrom = im;
    lbImg.src = im.currentSrc || im.src;
    lbImg.alt = im.alt;
    if (still.matches || !document.startViewTransition) { lb.showModal(); return; }
    name(im, 'lb-photo');
    document.startViewTransition(function () { name(im); lb.showModal(); name(lbImg, 'lb-photo'); })
      .finished.finally(function () { name(lbImg); });
  }
  function unzoom() {
    if (!lb.open) return;
    var im = lbFrom;
    function done() { lb.close(); if (im) im.focus({ preventScroll: true }); }
    if (still.matches || !document.startViewTransition || !im) { done(); return; }
    name(lbImg, 'lb-photo');
    document.startViewTransition(function () { name(lbImg); done(); name(im, 'lb-photo'); })
      .finished.finally(function () { name(im); });
  }
  lb.addEventListener('cancel', function (e) { e.preventDefault(); unzoom(); });
  lb.addEventListener('click', unzoom);

  /* ---------- start ---------- */
  grid.classList.add('js');
  layout();
  if ('ResizeObserver' in window) new ResizeObserver(function () { layout(); }).observe(grid.parentElement);
  else addEventListener('resize', layout);

  document.addEventListener('click', function (e) {
    var yt = e.target.closest('.act-panel .yt');
    if (!yt) return;
    var f = document.createElement('iframe');
    f.className = 'short';
    f.src = 'https://www.youtube-nocookie.com/embed/' + yt.dataset.id + '?autoplay=1';
    f.title = yt.dataset.title;
    f.allow = 'autoplay; encrypted-media; picture-in-picture';
    f.allowFullscreen = true;
    yt.replaceWith(f); f.focus();
  });

  var first = fromHash();
  if (first) open(first, false);
})();
