#!/usr/bin/env node
/* Real-browser fit check for fluid screens. Not part of CI (needs Chromium).
 *   npm i --no-save playwright-core      (or point NODE_PATH at an install)
 *   python -m chiketi --no-kiosk --bind 127.0.0.1 &
 *   CHROME=/path/to/chrome node scripts/fit_check.mjs
 * SHAPES=1920x462,1800x1200 limits the screen sizes. CASES=<screen id>:<fixture>,...
 * picks screens (Kiosk ids like sessions/lab, Self ids like screen5); TABS=n
 * gives a Kiosk case n selected tabs (the screen first, then the rest of the
 * Kiosk set). Pairing is stubbed with an approved device holding that mode and
 * those screens, so nothing is registered on the server.
 * Cases with a fixture name replace /api/metrics with that harness fixture;
 * 'LIVE' uses the server's real metrics. Rotation is off.
 * Fails if any element of the frame extends past the screen, a box that hides
 * overflow is cutting content off (other than deliberate ellipses), the wrong
 * screen is showing, or the tabs are not exactly the selection. */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const FIX = require('../tests/js/fixtures.js');

const BASE = process.env.CHIKETI_URL || 'http://127.0.0.1:7777';
const OUT = process.env.OUT || 'fit-shots';
const SHAPES = process.env.SHAPES ? process.env.SHAPES.split(',').map(x => x.split('x').map(Number))
  : [[1024, 576], [1024, 600], [1024, 640], [1800, 1200], [1024, 768], [1920, 462]];
const KIOSK_THEMES = [['Sci-Fi', 'TOS'], ['Others', 'Claude']];
const SELF_THEMES = KIOSK_THEMES.concat([['Sci-Fi', 'TNG'], ['Sci-Fi', 'DS9']]);
const CASES = (process.env.CASES ||
  'sessions:LIVE,sessions:FULL,sessions:SESS_MANY,sessions:SESS_OFFLINE,sessions:SESS_EMPTY,lab:FULL,lab:HL_RED,' +
  'gpus:FULL,gpus:GPU_HOUSE,gpus:GPU_HOUSE_MANY,screen5:FULL')
  .split(',').map(c => c.split(':'));
const TABS = Math.max(1, Number(process.env.TABS || 2));
const KIOSK = ['lab', 'sessions', 'overview', 'myday', 'home', 'harness', 'gpus'];
mkdirSync(OUT, { recursive: true });

// Which Kiosk screens can show, from screens.json's built + needs (as screenPlan does).
const SPEC = JSON.parse(readFileSync(new URL('../chiketi/assets/ui/screens.json', import.meta.url)));
const ready = (metrics) => KIOSK.filter(id => {
  const s = SPEC.screens[id];
  if (!s.built) return false;
  if (!s.needs) return true;
  const st = metrics[s.needs + '.status'];
  return !!(st && st.available && st.value !== 'unconfigured');
});
const liveMetrics = await (await fetch(BASE + '/api/metrics')).json();
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
let failures = 0;
for (const [sid, fx] of CASES) {
  const mode = /^screen/.test(sid) ? 'self' : 'kiosk';
  const screens = mode === 'self' ? [sid] : [sid].concat(KIOSK.filter(k => k !== sid)).slice(0, TABS);
  const metrics = fx === 'LIVE' ? liveMetrics : FIX[fx];
  const live = mode === 'kiosk' ? screens.filter(id => ready(metrics).includes(id)) : [];
  // What must show: the screen, or (Kiosk) the first ready one, or the notice.
  const want = mode === 'self' || live.includes(sid) ? sid : (live[0] || 'none');
  for (const [fam, variant] of (mode === 'kiosk' ? KIOSK_THEMES : SELF_THEMES)) {
    for (const [w, h] of SHAPES) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const settings = { id: 'fit', name: 'fit', auto_rotate: false, seconds: 600, theme: fam + '/' + variant,
                         gear: false, mode, screens };
      await page.route('**/api/register', r => r.fulfill({ json: { status: 'approved', settings } }));
      await page.route('**/api/device/**', r => r.fulfill({ json: { status: 'approved', settings } }));
      if (fx !== 'LIVE') await page.route('**/api/metrics', r => r.fulfill({ json: FIX[fx] }));
      await page.route('**/api/themes', async r => {
        const j = await (await r.fetch()).json();
        j.active_family = fam; j.active_variant = variant;
        if (mode === 'kiosk') j.kiosk_theme = fam + '/' + variant;
        r.fulfill({ json: j });
      });
      await page.goto(BASE + '/display');
      const name = `${variant}-${sid}-${fx}-t${screens.length}-${w}x${h}`;
      let bad = [];
      try {
        await page.waitForFunction(s => typeof enabledScreens !== 'undefined' && enabledScreens.length &&
          enabledScreens[currentScreenIdx].id === s, want, { timeout: 8000 });
      } catch (e) {
        bad.push('screen ' + want + ' never showed: ' +
          await page.evaluate(() => typeof enabledScreens === 'undefined' ? '-' : enabledScreens.map(s => s.id).join()));
      }
      await page.waitForTimeout(800);
      if (!bad.length) {
        bad = await page.evaluate(() => {
          const vw = window.innerWidth, vh = window.innerHeight, out = [];
          document.querySelectorAll('.screen-frame *').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) {
              out.push(el.tagName + ' "' + (el.textContent || '').trim().slice(0, 30) + '" ' +
                       [r.left, r.top, r.right, r.bottom].map(Math.round).join(','));
            }
            const cs = getComputedStyle(el);
            if (cs.overflow === 'hidden' && cs.textOverflow !== 'ellipsis' &&
                el.scrollHeight > el.clientHeight + 2) {
              out.push(el.tagName + ' clips: "' + (el.textContent || '').trim().slice(0, 30) + '"');
            }
          });
          return out.slice(0, 5);
        });
        if (mode === 'kiosk') {
          const tabs = await page.$$eval('[data-tab]', els => els.map(e => e.getAttribute('data-tab')));
          const taps = await page.$$eval('[data-screen]', els => els.map(e => e.getAttribute('data-screen')));
          if (tabs.join() !== screens.join()) bad.push('tabs ' + tabs.join() + ' != selection ' + screens.join());
          if (taps.join() !== live.join()) bad.push('tappable ' + taps.join() + ' != ready ' + live.join());
        }
      }
      bad = bad.concat(errors.map(e => 'page error: ' + e));
      await page.screenshot({ path: `${OUT}/${name}.png` });
      if (bad.length) { failures++; console.error('FAIL', name, bad); } else { console.log('ok  ', name); }
      await page.close();
    }
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
