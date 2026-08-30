/* site.js — interactive behavior for the chiketi family site. */

/* ── hero device: live, theme-switchable dashboard ── */
(function () {
  var host = document.querySelector('.theme-chips');
  if (!host || !window.SITE_THEME_LIST) return;

  // accent dot color per theme, sourced from the frozen palette (primary).
  function dotColor(f, v) {
    var fam = (window.SITE_THEMES && window.SITE_THEMES.families[f]) || {};
    var t = fam[v];
    return (t && (t.primary || t.accent)) || '#9aa0a6';
  }

  // build a chip per theme.
  window.SITE_THEME_LIST.forEach(function (t) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.f = t.family;
    chip.dataset.v = t.variant;
    chip.setAttribute('aria-pressed', 'false');
    chip.innerHTML =
      '<span class="chip__dot" style="color:' + dotColor(t.family, t.variant) + '"></span>' +
      '<span>' + t.family + ' <span class="chip__var">&middot; ' + t.variant + '</span></span>';
    chip.addEventListener('click', function () { setTheme(t.family, t.variant); });
    host.appendChild(chip);
  });

  function setTheme(f, v) {
    renderThemeInto('hero-display', f, v);
    document.querySelectorAll('.chip').forEach(function (c) {
      var on = c.dataset.f === f && c.dataset.v === v;
      c.classList.toggle('active', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  window.__setHeroTheme = setTheme;

  // is (f,v) a real theme in the frozen list?
  function isKnownTheme(f, v) {
    return window.SITE_THEME_LIST.some(function (t) {
      return t.family === f && t.variant === v;
    });
  }

  // Default face (override with ?t=Family/Variant for verification). Validated
  // like ?t= is: this default was left as the retired Panel/Gold through the
  // Sci-Fi rename, renderThemeInto() rightly refused it, and the hero device
  // shipped blank. A default that is not a real theme now falls back to the
  // first one in the frozen list rather than to nothing.
  var def = ['Sci-Fi', 'TOS'];
  var q = (location.search.match(/[?&]t=([^&]+)/) || [])[1];
  if (q) {
    // A malformed escape (?t=%) makes decodeURIComponent throw a URIError, which
    // would abort this whole file and leave every later IIFE (the gallery, the
    // install tabs) unregistered. Swallow it and fall back to the default face.
    var decoded = null;
    try { decoded = decodeURIComponent(q); } catch (e) { decoded = null; }
    if (decoded) {
      var parts = decoded.split('/');
      if (parts.length === 2 && isKnownTheme(parts[0], parts[1])) def = parts;
    }
  }
  if (!isKnownTheme(def[0], def[1]) && window.SITE_THEME_LIST.length) {
    def = [window.SITE_THEME_LIST[0].family, window.SITE_THEME_LIST[0].variant];
  }
  setTheme(def[0], def[1]);
})();

/* ── theme gallery: a SECOND independent display with faceplate swatches ── */
(function () {
  var host = document.querySelector('.swatches');
  if (!host || !window.SITE_THEME_LIST || !window.SITE_THEMES) return;

  function faceColor(f, v) {
    var fam = (window.SITE_THEMES.families[f]) || {};
    var t = fam[v];
    return (t && (t.primary || t.accent)) || '#9aa0a6';
  }

  // group themes by family, preserving the order in SITE_THEME_LIST.
  var groups = {}, order = [];
  window.SITE_THEME_LIST.forEach(function (t) {
    if (!groups[t.family]) { groups[t.family] = []; order.push(t.family); }
    groups[t.family].push(t);
  });

  order.forEach(function (fam) {
    var wrap = document.createElement('div');
    wrap.className = 'swatch-group';
    var label = document.createElement('div');
    label.className = 'swatch-group__label';
    label.textContent = fam;
    wrap.appendChild(label);

    var row = document.createElement('div');
    row.className = 'swatch-group__row';
    groups[fam].forEach(function (t) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch';
      btn.dataset.f = t.family;
      btn.dataset.v = t.variant;
      btn.style.background = faceColor(t.family, t.variant);
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', t.family + ' ' + t.variant + ' theme');
      btn.title = t.family + ' · ' + t.variant;
      btn.addEventListener('click', function () { setGallery(t.family, t.variant); });
      row.appendChild(btn);
    });
    wrap.appendChild(row);
    host.appendChild(wrap);
  });

  // The gallery used to show screen 1 and nothing else, which made four fifths
  // of the product invisible to anyone who had not installed it. The screen
  // tabs are rebuilt per theme because the families do not agree on how many
  // screens they have: the distro boards draw the time on screen 1, so they
  // have no separate clock to offer.
  var tabHost = document.querySelector('.screen-tabs');
  var curF = null, curV = null, curI = 0;

  function buildTabs(f, v) {
    if (!tabHost || !window.SITE_SCREENS) return;
    var screens = window.SITE_SCREENS(f, v);
    if (curI >= screens.length) curI = 0;
    tabHost.innerHTML = '';
    screens.forEach(function (sc, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'screen-tab' + (i === curI ? ' active' : '');
      b.textContent = sc.name;
      b.setAttribute('aria-pressed', i === curI ? 'true' : 'false');
      b.addEventListener('click', function () { setGallery(f, v, i); });
      tabHost.appendChild(b);
    });
  }

  function setGallery(f, v, i) {
    curF = f; curV = v;
    if (typeof i === 'number') curI = i;
    var screens = window.SITE_SCREENS ? window.SITE_SCREENS(f, v) : [0];
    if (curI >= screens.length) curI = 0;
    renderThemeInto('gallery-display', f, v, curI);
    host.querySelectorAll('.swatch').forEach(function (s) {
      var on = s.dataset.f === f && s.dataset.v === v;
      s.classList.toggle('active', on);
      s.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    buildTabs(f, v);
  }

  // default the gallery to a DIFFERENT face than the hero, for variety at rest.
  setGallery('Vintage', 'Tubes', 0);
})();

/* ── install: real tabs (keyboard-accessible) + copy buttons ── */
(function () {
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs .tab'));
  if (tabs.length) {
    function activate(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.dataset.panel);
        if (panel) panel.hidden = !on;
      });
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { activate(tab); });
      tab.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabs[(i + 1) % tabs.length];
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabs[(i - 1 + tabs.length) % tabs.length];
        if (next) { e.preventDefault(); activate(next); next.focus(); }
      });
    });
  }

  document.querySelectorAll('.cmd__copy').forEach(function (btn) {
    // Capture the resting label ONCE, before any click can overwrite it: reading
    // it inside the handler would latch 'Copied' on a second click inside 1.6s.
    var orig = btn.textContent;
    var timer = null;
    var done = function (ok) {
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      btn.classList.toggle('copied', ok);
      btn.classList.toggle('copy-failed', !ok);
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        btn.textContent = orig;
        btn.classList.remove('copied');
        btn.classList.remove('copy-failed');
      }, 1600);
    };
    btn.addEventListener('click', function () {
      var text = btn.dataset.copy || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        // NB: .then(done, done) would run the SUCCESS path on rejection.
        navigator.clipboard.writeText(text).then(
          function () { done(true); },
          function () { done(false); }
        );
      } else {
        // execCommand fallback for non-secure contexts (plain http://, file://),
        // where navigator.clipboard is undefined. Report what actually happened.
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:absolute;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        done(ok);
      }
    });
  });
})();
