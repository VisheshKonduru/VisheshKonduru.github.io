// Feedback form in a dialog. Posts to Web3Forms, which emails the message to the site owner.
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
    '<input class="fb-hp" name="botcheck" tabindex="-1" autocomplete="off" aria-hidden="true">' +
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
    if (f.botcheck.value) { d.close(); return; }
    send.disabled = true; st.textContent = 'Sending…';
    var body = { access_key: '1bcc05fc-a3d6-4466-aae8-7e0c4a1c4355', subject: 'Portfolio feedback',
      from_name: 'Portfolio site', message: msg.value.trim(), name: f.name.value.trim(), email: em, page: location.pathname };
    var fd = new FormData(); for (var k in body) fd.append(k, body[k]);
    fetch('https://api.web3forms.com/submit', {
      method: 'POST', body: fd
    }).then(function (r) { return r.json().then(function (j) { return r.ok && String(j.success) === 'true'; }); })
      .then(function (ok) {
        if (!ok) throw 0;
        f.reset(); st.textContent = 'Sent. Thank you.';
      })
      .catch(function () { st.textContent = 'Couldn’t send right now. You can email ' + to + ' instead.'; })
      .then(function () { send.disabled = false; });
  });
})();
