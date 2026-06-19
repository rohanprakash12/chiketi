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

  // default face: Panel/Gold (override with ?t=Family/Variant for verification).
  // An invalid/malformed ?t= must NOT blank the device — validate, else fall back.
  var def = ['Panel', 'Gold'];
  var q = (location.search.match(/[?&]t=([^&]+)/) || [])[1];
  if (q) {
    var parts = decodeURIComponent(q).split('/');
    if (parts.length === 2 && isKnownTheme(parts[0], parts[1])) def = parts;
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

  function setGallery(f, v) {
    renderThemeInto('gallery-display', f, v);
    host.querySelectorAll('.swatch').forEach(function (s) {
      var on = s.dataset.f === f && s.dataset.v === v;
      s.classList.toggle('active', on);
      s.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // default the gallery to a DIFFERENT face than the hero, for variety at rest.
  setGallery('Vintage', 'Tubes');
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
    btn.addEventListener('click', function () {
      var text = btn.dataset.copy || '';
      var done = function () {
        var orig = btn.textContent;
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(function () { btn.textContent = orig; btn.classList.remove('copied'); }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        done();
      }
    });
  });
})();
