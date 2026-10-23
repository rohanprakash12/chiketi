/* Pairing: runs before the dashboard app, in ES5, so even a browser too old
   for chiketi gets a readable page. Works out this display's id and
   capabilities, registers, shows a pairing code while pending, and starts
   the app (window.chiketiStart) once the control panel approves it. */
(function () {
  var API = window.location.origin;
  var params = {};
  window.location.search.replace(/^\?/, '').split('&').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
  });
  var ID_RE = /^[a-z0-9-]{1,32}$/;
  var root = document.getElementById('pairing');
  var app = document.getElementById('display');
  var started = false, pollTimer = null, house = null;

  function escH(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function deviceId() {
    if (params.device && ID_RE.test(params.device)) return params.device;
    var id = null;
    try { id = window.localStorage.getItem('chiketi.device'); } catch (e) { id = null; }
    if (!id || !ID_RE.test(id)) {
      var abc = 'abcdefghijklmnopqrstuvwxyz0123456789', s = 'display-';
      for (var i = 0; i < 6; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
      id = s;
      try { window.localStorage.setItem('chiketi.device', id); } catch (e) { /* this page only */ }
    }
    return id;
  }
  var ID = deviceId();

  function browserName() {
    var ua = navigator.userAgent, m;
    if ((m = ua.match(/Edg\/(\d+)/))) return 'Edge ' + m[1];
    if ((m = ua.match(/Firefox\/(\d+)/))) return 'Firefox ' + m[1];
    if ((m = ua.match(/(?:Chrome|CriOS)\/(\d+)/))) return 'Chrome ' + m[1];
    if ((m = ua.match(/Version\/(\d+).*Safari/))) return 'Safari ' + m[1];
    return 'Browser';
  }
  function caps() {
    var touch = (navigator.maxTouchPoints || 0) > 0 ||
      !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    return { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1,
             touch: touch, browser: browserName(),
             feed: params.feed === 'picture' ? 'picture' : 'live' };
  }
  function capsText(c) {
    var f = 1024 * c.h / c.w;
    var shape = (f >= 576 && f <= 770) ? 'landscape' : (f <= 341 ? 'strip' : 'no layout yet');
    return c.w + '×' + c.h + ' · ' + shape + ' · ' +
      (c.touch ? 'touch' : 'no touch') + ' · ' + c.browser +
      (c.feed === 'picture' ? ' · picture feed' : '');
  }
  function supported() {
    return !!(window.CSS && CSS.supports && CSS.supports('container-type', 'inline-size'));
  }

  function xhr(method, path, body, cb) {
    var r = new XMLHttpRequest();
    r.open(method, API + path);
    r.timeout = 5000;
    if (body) r.setRequestHeader('Content-Type', 'application/json');
    r.onload = function () {
      var j = null;
      try { j = JSON.parse(r.responseText); } catch (e) { j = null; }
      cb(r.status === 200 ? j : null);
    };
    r.onerror = r.ontimeout = function () { cb(null); };
    r.send(body ? JSON.stringify(body) : null);
  }

  function show(html) {
    var bg = house ? house.background : '#000', fg = house ? house.primary : '#ccc';
    var dim = house ? house.dim : '#888';
    // No `inset`, `gap` or `min()` without a fallback: this page must render on
    // browsers older than chiketi supports, to tell them so.
    root.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;text-align:center;' +
      'font-family:sans-serif;background:' + bg + ';color:' + fg;
    document.body.style.background = bg;
    root.innerHTML = html.replace(/\{dim\}/g, dim);
    root.hidden = false;
    app.style.display = 'none';
  }
  function showPending(code) {
    var c = caps();
    show('<div style="letter-spacing:.3em;font-size:4vw;font-size:min(4vw,7vh)">NEW DISPLAY</div>' +
      '<div style="font-weight:700;letter-spacing:.12em;font-size:16vw;font-size:min(16vw,34vh);line-height:1.15;margin:1vh 0 2vh">' +
        escH(code.slice(0, 2) + '-' + code.slice(2)) + '</div>' +
      '<div style="font-size:2.6vw;font-size:min(2.6vw,5vh)">Approve in the chiketi control panel at ' +
        escH(window.location.host) + '</div>' +
      '<div style="font-size:2vw;font-size:min(2vw,4vh);color:{dim}">' + escH(capsText(c)) +
        ' · ' + escH(ID) + '</div>');
  }
  function showConnecting() {
    show('<div style="letter-spacing:.3em;font-size:4vw;font-size:min(4vw,7vh)">CONNECTING TO CHIKETI\u2026</div>' +
      '<div style="font-size:2vw;font-size:min(2vw,4vh);color:{dim}">' + escH(window.location.host) +
      ' \u00b7 ' + escH(ID) + '</div>');
  }
  function showTooOld() {
    show('<div style="font-size:4vw;font-size:min(4vw,8vh)">This browser is too old: needs Chrome 105+, ' +
      'Safari 16+ or Firefox 110+</div><div style="font-size:2vw;font-size:min(2vw,4vh);color:{dim}">' +
      escH(capsText(caps())) + '</div>');
  }

  function start(settings) {
    window.chiketiDevice = { id: ID, settings: settings };
    if (started) {
      if (window.chiketiApplyDevice) window.chiketiApplyDevice(settings);
      return;
    }
    started = true;
    root.style.cssText = '';     // the inline display:flex would beat [hidden]
    root.hidden = true;
    root.innerHTML = '';
    app.style.display = '';
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (window.chiketiStart) window.chiketiStart(settings);
    else window.CHIKETI_PENDING_START = settings;
  }

  function handle(out) {
    if (!out) return;
    if (out.status === 'approved') start(out.settings);
    else if (out.status === 'pending') {
      if (started) { window.location.reload(); return; }   // forgotten: back to pairing
      showPending(out.code);
      if (!pollTimer) pollTimer = setInterval(poll, 3000);
    } else if (out.status === 'unknown') {
      if (started) { window.location.reload(); return; }
      register();
    }
  }
  // A failed registration retries with backoff (3 s doubling to 30 s), so a
  // display that boots before the chiketi server answers recovers on its own.
  var retryDelay = 3000, retryTimer = null;
  function register() {
    xhr('POST', '/api/register', { id: ID, caps: caps() }, function (out) {
      if (!out) {
        if (!started) {
          showConnecting();
          if (!retryTimer) {
            retryTimer = setTimeout(function () { retryTimer = null; register(); }, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 30000);
          }
        }
        return;
      }
      retryDelay = 3000;
      handle(out);
    });
  }
  function poll() { xhr('GET', '/api/device/' + ID, null, handle); }
  window.chiketiRegister = register;
  // Report a new shape (a rotated tablet, a resized window) once it settles,
  // whether pending or approved.
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { resizeTimer = null; if (supported()) register(); }, 1000);
  });
  window.chiketiPollDevice = function () { xhr('GET', '/api/device/' + ID, null, handle); };

  xhr('GET', '/api/themes', null, function (t) {
    if (t && t.families && t.families[t.active_family]) house = t.families[t.active_family][t.active_variant];
    if (!supported()) { showTooOld(); return; }
    register();
  });
})();
