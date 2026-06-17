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
