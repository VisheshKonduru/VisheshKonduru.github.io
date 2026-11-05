// Feedback form in a dialog. Posts to FormSubmit, which emails the message to the site owner.
// Without JS the button stays a plain mailto link.
(function () {
  var btn = document.querySelector('.feedback');
  if (!btn || !window.fetch || typeof HTMLDialogElement !== 'function') return;
  var to = btn.getAttribute('data-to');
  var d = document.createElement('dialog');
  d.className = 'fb';
  d.setAttribute('aria-labelledby', 'fb-title');
  d.innerHTML =
    '<form class="fb-form" novalidate>' +
    '<h2 id="fb-title">Feedback</h2>' +
    '<label for="fb-msg">Message</label>' +
    '<textarea id="fb-msg" name="message" rows="5" required></textarea>' +
    '<label for="fb-name">Name <span>(optional)</span></label>' +
    '<input id="fb-name" name="name" autocomplete="name">' +
    '<label for="fb-email">Email, if you want a reply <span>(optional)</span></label>' +
    '<input id="fb-email" name="email" type="email" autocomplete="email">' +
    '<input class="fb-hp" name="_honey" tabindex="-1" autocomplete="off" aria-hidden="true">' +
    '<p class="fb-status" role="status"></p>' +
    '<div class="fb-actions"><button type="button" class="fb-cancel">Close</button><button type="submit" class="fb-send">Send</button></div>' +
    '</form>';
  document.body.appendChild(d);
  var f = d.querySelector('form'), st = d.querySelector('.fb-status'), send = d.querySelector('.fb-send'), msg = d.querySelector('#fb-msg');

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    st.textContent = ''; d.showModal(); msg.focus();
  });
  d.querySelector('.fb-cancel').addEventListener('click', function () { d.close(); });
  d.addEventListener('click', function (e) { if (e.target === d) d.close(); });

  f.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!msg.value.trim()) { st.textContent = 'Write a message first.'; msg.focus(); return; }
    var em = f.email.value.trim();
    if (em && !f.email.checkValidity()) { st.textContent = 'That email address doesn’t look right.'; f.email.focus(); return; }
    if (f._honey.value) { d.close(); return; }
    send.disabled = true; st.textContent = 'Sending…';
    var body = { message: msg.value.trim(), name: f.name.value.trim(), email: em, page: location.pathname,
      _subject: 'Portfolio feedback', _template: 'table', _captcha: 'false' };
    fetch('https://formsubmit.co/ajax/' + to, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return r.ok && String(j.success) === 'true'; }); })
      .then(function (ok) {
        if (!ok) throw 0;
        f.reset(); st.textContent = 'Sent. Thank you.';
      })
      .catch(function () { st.textContent = 'Couldn’t send right now. You can email ' + to + ' instead.'; })
      .then(function () { send.disabled = false; });
  });
})();
