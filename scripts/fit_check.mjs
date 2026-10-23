#!/usr/bin/env node
/* Real-browser fit check for fluid screens. Not part of CI (needs Chromium).
 *   npm i --no-save playwright-core      (or point NODE_PATH at an install)
 *   python -m chiketi --no-kiosk --bind 127.0.0.1 &
 *   CHROME=/path/to/chrome node scripts/fit_check.mjs
 * SHAPES=1920x462,1800x1200 limits the screen sizes.
 * Cases with a fixture name replace /api/metrics with that harness fixture;
 * 'LIVE' uses the server's real metrics. Rotation is pinned to one screen.
 * Fails if any element of the frame extends past the screen, or a box that
 * hides overflow is cutting content off (other than deliberate ellipses). */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const FIX = require('../tests/js/fixtures.js');

const BASE = process.env.CHIKETI_URL || 'http://127.0.0.1:7777';
const OUT = process.env.OUT || 'fit-shots';
const SHAPES = process.env.SHAPES ? process.env.SHAPES.split(',').map(x => x.split('x').map(Number))
  : [[1024, 576], [1024, 600], [1024, 640], [1800, 1200], [1024, 768], [1920, 462]];
const THEMES = [['Sci-Fi', 'TOS'], ['Sci-Fi', 'TNG'], ['Sci-Fi', 'DS9'], ['Others', 'Claude']];
const CASES = (process.env.CASES || 'screen7:LIVE,screen7:FULL,screen7:SESS_MANY,screen7:SESS_OFFLINE,screen7:SESS_EMPTY,screen5:FULL')
  .split(',').map(c => c.split(':'));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
let failures = 0;
for (const [fam, variant] of THEMES) {
  for (const [sid, fx] of CASES) {
    for (const [w, h] of SHAPES) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      if (fx !== 'LIVE') await page.route('**/api/metrics', r => r.fulfill({ json: FIX[fx] }));
      await page.route('**/api/themes', async r => {
        const j = await (await r.fetch()).json();
        j.active_family = fam; j.active_variant = variant;
        r.fulfill({ json: j });
      });
      await page.route('**/api/display', async r => {
        const j = await (await r.fetch()).json();
        j.screen_rotation = {};
        for (const id of ['screen1', 'screen2', 'screen3', 'screen4', 'screen5', 'screen6', 'screen7']) {
          j.screen_rotation[id] = { enabled: id === sid, duration: 600 };
        }
        r.fulfill({ json: j });
      });
      await page.goto(BASE + '/display');
      await page.waitForSelector('.screen-frame');
      await page.waitForTimeout(1200);
      const bad = await page.evaluate(() => {
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
      const name = `${variant}-${sid}-${fx}-${w}x${h}`;
      await page.screenshot({ path: `${OUT}/${name}.png` });
      if (bad.length) { failures++; console.error('FAIL', name, bad); } else { console.log('ok  ', name); }
      await page.close();
    }
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
