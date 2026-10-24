#!/usr/bin/env node
/* Control-panel previews of the Kiosk looks. Not part of CI (needs Chromium).
 *   python -m chiketi --no-kiosk --bind 127.0.0.1 &
 *   CHROME=/path/to/chrome node scripts/preview_check.mjs
 * For every Kiosk theme (from screens.json), the panel's own renderScreens() draws
 * three selections: the whole Kiosk set (house scope), one tab, and none (a display
 * with nothing selected). Each preview must be the theme's own look (data-look),
 * keep its content inside the preview box, and the empty selection must show the
 * theme's notice. Metrics are the harness's FULL fixture at a fixed instant.
 * SHAPES=1024x600,1920x462 sets the controlled display's shape (default both and
 * a 3:2 Go). */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const NOW_MS = Date.UTC(2026, 9, 24, 14, 3, 0);
const FREEZE = `(() => { const T = ${NOW_MS}; const RD = Date; class FD extends RD { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } } window.Date = FD; })();`;
{ const RD = Date; class FD extends RD { constructor(...a) { if (a.length) super(...a); else super(NOW_MS); } static now() { return NOW_MS; } } globalThis.Date = FD; }
const FIX = require('../tests/js/fixtures.js');

const BASE = process.env.CHIKETI_URL || 'http://127.0.0.1:7777';
const SPEC = JSON.parse(readFileSync(new URL('../chiketi/assets/ui/screens.json', import.meta.url)));
const THEMES = SPEC.modes.kiosk.themes.map(k => k.split('/'));
const SHAPES = (process.env.SHAPES || '1024x600,1536x1024,1920x462').split(',').map(x => x.split('x').map(Number));
const CASES = [['house', null], ['one', ['gpus']], ['none', []]];

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(FREEZE);
await page.route('**/api/metrics', r => r.fulfill({ json: FIX.FULL }));
await page.goto(BASE + '/');
await page.waitForFunction(() => typeof renderScreens === 'function' && typeof currentData !== 'undefined' && currentData, null, { timeout: 10000 });
// The panel's own polls would redraw the previews from the server mid-check.
await page.evaluate(() => { const top = setTimeout(function () {}, 0); for (let i = 1; i <= top; i++) { clearTimeout(i); clearInterval(i); } });
let failures = 0;
for (const [fam, v] of THEMES) {
  for (const [w, h] of SHAPES) {
    for (const [name, sel] of CASES) {
      const res = await page.evaluate(async ([fam, v, w, h, sel, fx]) => {
        metrics = fx;
        selectedFamily = fam; selectedVariant = v;
        if (sel === null) { selectedDevice = ''; houseMode = 'kiosk'; }
        else {
          devices = { devices: [{ id: 'pv', name: 'pv', mode: 'kiosk', screens: sel, theme: fam + '/' + v, caps: {} }], pending: [], now: 0 };
          selectedDevice = 'pv';
          pick = sel.map(function (id) { return { id: id, on: true }; });
        }
        updatePreviewAspectRatio(w, h);
        renderScreens();
        await document.fonts.ready;
        await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
        const frames = [...document.querySelectorAll('#screens .screen-frame')];
        const bad = [];
        if (!frames.length) bad.push('no preview');
        frames.forEach(function (f) {
          const look = f.getAttribute('data-look');
          if (look && look !== fam + '/' + v) bad.push('preview is ' + look);
          const fr = f.getBoundingClientRect();
          f.querySelectorAll('*').forEach(function (el) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            // A skin's glass may overscan on purpose (Scanlines: scale(1.008), clipped by
            // the frame): allow exactly that much past the edge, nothing more.
            let tol = 1;
            for (let a = el; a && a !== f; a = a.parentElement) {
              const sc = /scale\(([\d.]+)\)/.exec(a.style.transform || '');
              if (sc) { tol += (Number(sc[1]) - 1) / 2 * Math.max(fr.width, fr.height); break; }
            }
            if (r.right > fr.right + tol || r.bottom > fr.bottom + tol || r.left < fr.left - tol || r.top < fr.top - tol) {
              bad.push('outside the preview: ' + el.tagName + ' "' + (el.textContent || '').trim().slice(0, 24) + '"');
            }
          });
        });
        const isNew = !!(KIOSK_RENDERERS[fam + '/' + v] && KIOSK_RENDERERS[fam + '/' + v].fluid === 'landscape');
        if (isNew && frames.length && !frames.every(function (f) { return f.getAttribute('data-look') === fam + '/' + v; })) bad.push('not the look\'s own frame');
        if (sel && sel.length === 0 && document.getElementById('screens').textContent.indexOf('NO SCREENS TO SHOW') === -1) bad.push('no notice');
        return bad.slice(0, 4);
      }, [fam, v, w, h, sel, FIX.FULL]);
      const label = `${fam}/${v} ${w}x${h} ${name}`;
      if (res.length) { failures++; console.error('FAIL', label, res); } else console.log('ok  ', label);
    }
  }
}
if (errors.length) { failures++; console.error('FAIL page errors', errors.slice(0, 5)); }
await browser.close();
process.exit(failures ? 1 : 0);
