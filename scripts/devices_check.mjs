#!/usr/bin/env node
/* Real-browser check of pairing and the device-scoped control panel.
 *   python -m chiketi --no-kiosk --bind 127.0.0.1 --token secret &
 *   CHROME=/path/to/chrome NODE_PATH=... node scripts/devices_check.mjs
 * Uses the live server's API to approve/forget; it does not touch state on
 * any other machine. Exits 1 on the first failed expectation. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const BASE = process.env.CHIKETI_URL || 'http://127.0.0.1:7777';
const TOKEN = process.env.CHIKETI_TOKEN || 'secret';
const fail = (m) => { console.error('FAIL ' + m); process.exit(1); };
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json',
    'X-Chiketi-Token': TOKEN, Origin: BASE }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const id = 'check-' + Date.now().toString(36);
const browser = await chromium.launch({ executablePath: process.env.CHROME });

// 1. A new display shows a pairing code and no dashboard.
const ctx = await browser.newContext({ viewport: { width: 1800, height: 1200 }, hasTouch: true });
const page = await ctx.newPage();
await page.goto(`${BASE}/display?device=${id}`);
await page.waitForSelector('#pairing:not([hidden])');
const text = await page.textContent('#pairing');
if (!/NEW DISPLAY/.test(text) || !/[2-9A-Z]{2}-[2-9A-Z]{2}/.test(text)) fail('pairing page: ' + text);
if (!/touch/.test(text) || !/landscape/.test(text)) fail('caps not shown: ' + text);
console.log('ok   pairing page');

// 2. Approve -> dashboard within one poll; starting settings from touch.
const s = await api('POST', `/api/devices/${id}/approve`, { name: 'Check' });
if (s.auto_rotate !== false || s.gear !== true) fail('starting settings ' + JSON.stringify(s));
await page.waitForSelector('#display .screen-frame', { timeout: 8000 });
if (!(await page.isHidden('#pairing'))) fail('pairing still visible after approve');
console.log('ok   approve shows dashboard');

// 3. Per-device theme reaches the display.
await api('POST', `/api/devices/${id}`, { theme: 'Others/Claude' });
await page.waitForFunction(() => activeFamily === 'Others', null, { timeout: 8000 });
console.log('ok   device theme applied');

// 4. Forget -> back to pairing.
await api('POST', `/api/devices/${id}/forget`, {});
await page.waitForSelector('#pairing:not([hidden])', { timeout: 10000 });
console.log('ok   forget returns to pairing');

// 5. Strip shape and a hostile user agent: code fits, UA escaped.
const strip = await browser.newContext({ viewport: { width: 1920, height: 462 },
  userAgent: 'Mozilla/5.0 <img src=x onerror=alert(1)> Chrome/155.0' });
const sp = await strip.newPage();
await sp.goto(`${BASE}/display?device=${id}-s&feed=picture`);
await sp.waitForSelector('#pairing:not([hidden])');
if (await sp.$('#pairing img')) fail('user agent reached the page unescaped');
const over = await sp.evaluate(() => [...document.querySelectorAll('#pairing *')]
  .some(el => { const r = el.getBoundingClientRect(); return r.bottom > innerHeight + 1 || r.right > innerWidth + 1; }));
if (over) fail('pairing page overflows the strip');
console.log('ok   strip pairing page');

// 6. Too-old browser: message, no registration.
const old = await browser.newContext({ viewport: { width: 1024, height: 600 } });
await old.addInitScript(() => { CSS.supports = () => false; });
const op = await old.newPage();
await op.goto(`${BASE}/display?device=${id}-old`);
await op.waitForSelector('#pairing:not([hidden])');
if (!/too old/.test(await op.textContent('#pairing'))) fail('too-old message missing');
const listing = await api('GET', '/api/devices');
if (listing.pending.some(p => p.id === `${id}-old`)) fail('too-old browser registered');
console.log('ok   too-old browser');

// 7. Server forgets a pending request (restart) -> display registers again.
await api('POST', `/api/devices/${id}-s/reject`, {});
// The display finds out on its next poll (every 3 s) and registers again.
let back = false;
for (let i = 0; i < 20 && !back; i++) {
  await sp.waitForTimeout(500);
  back = (await api('GET', '/api/devices')).pending.some(p => p.id === `${id}-s`);
}
if (!back) fail('display did not register again');
console.log('ok   re-registers after losing its request');
await api('POST', `/api/devices/${id}-s/reject`, {});
// 8. Control panel: a pending display appears; approving it scopes the panel.
const pid = id + '-p';
const dpage = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
await dpage.goto(`${BASE}/display?device=${pid}`);
await dpage.waitForSelector('#pairing:not([hidden])');
const panel = await (await browser.newContext()).newPage();
panel.on('dialog', d => d.accept('Panel Check'));
await panel.goto(`${BASE}/#token=${TOKEN}`);
await panel.waitForSelector(`.pending-card[data-id="${pid}"]`, { timeout: 8000 });
await panel.click(`.pending-card[data-id="${pid}"] button[data-act="approve"]`);
await panel.waitForFunction(i => document.getElementById('deviceSelect').value === i, pid);
if (await panel.isHidden('#deviceSettings')) fail('device settings not shown for a device');
await panel.selectOption('#categorySelect', 'Sci-Fi');
await panel.click('#variantRow button:has-text("TNG")');
await panel.waitForTimeout(500);
const after = await api('GET', '/api/devices');
const dev = after.devices.find(d => d.id === pid);
if (!dev || dev.theme !== 'Sci-Fi/TNG') fail('theme click did not reach the device: ' + JSON.stringify(dev));
const themes = await (await fetch(BASE + '/api/themes')).json();
if (themes.active_variant === 'TNG') fail('device theme changed the house theme');
// The (live) marker follows the device's new theme.
await panel.waitForFunction(() => [...document.querySelectorAll('#variantRow button')]
  .some(b => /TNG/.test(b.textContent) && /live/.test(b.textContent)), null, { timeout: 8000 });
await panel.selectOption('#deviceSelect', '');
if (!(await panel.isHidden('#deviceSettings'))) fail('house scope still shows device settings');
// Forgotten from elsewhere while selected: the panel drops back to house scope.
await panel.selectOption('#deviceSelect', pid);
await panel.waitForSelector('#deviceSettings:not([hidden])');
await api('POST', `/api/devices/${pid}/forget`, {});
await panel.waitForFunction(() => document.getElementById('deviceSelect').value === '' &&
  document.getElementById('deviceSettings').hidden, null, { timeout: 8000 });
console.log('ok   control panel hub');
// 9. The first registration fails: the display says so and retries.
const flaky = await browser.newContext({ viewport: { width: 1024, height: 600 } });
let fails = 2;
await flaky.route('**/api/register', r => (fails-- > 0 ? r.fulfill({ status: 503, body: 'down' }) : r.continue()));
const fp = await flaky.newPage();
await fp.goto(`${BASE}/display?device=${id}-f`);
await fp.waitForFunction(() => /CONNECTING/i.test(document.getElementById('pairing').textContent), null, { timeout: 8000 });
await fp.waitForFunction(() => /NEW DISPLAY/.test(document.getElementById('pairing').textContent), null, { timeout: 30000 });
console.log('ok   retries a failed registration');
await api('POST', `/api/devices/${id}-f/reject`, {});

// 10. A pending display that changes shape reports it.
const rot = await browser.newContext({ viewport: { width: 1800, height: 1200 } });
const rp = await rot.newPage();
await rp.goto(`${BASE}/display?device=${id}-r`);
await rp.waitForSelector('#pairing:not([hidden])');
await rp.setViewportSize({ width: 1200, height: 1800 });
let rotated = false;
for (let i = 0; i < 20 && !rotated; i++) {
  await rp.waitForTimeout(300);
  const pend = (await api('GET', '/api/devices')).pending.find(p => p.id === `${id}-r`);
  rotated = !!pend && pend.caps.w === 1200;
}
if (!rotated) fail('pending display did not report its new shape');
console.log('ok   reports a new shape while pending');
await api('POST', `/api/devices/${id}-r/reject`, {});
// 11. Hostile strings are shown literally: capability text and a device name in
// the control panel, and server text on the pairing page.
const XSS = '<img src=x onerror=window.__xss=1>';
await fetch(BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ id: `${id}-x`, caps: { w: 800, h: 480, browser: XSS } }) });
await fetch(BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ id: `${id}-y`, caps: { w: 800, h: 480 } }) });
await api('POST', `/api/devices/${id}-y/approve`, { name: XSS });
const hp = await (await browser.newContext()).newPage();
await hp.goto(`${BASE}/#token=${TOKEN}`);
await hp.waitForSelector(`.pending-card[data-id="${id}-x"]`, { timeout: 8000 });
if (await hp.$('.pending-card img, #deviceSelect img')) fail('hostile text became markup in the panel');
if (!(await hp.textContent(`.pending-card[data-id="${id}-x"]`)).includes('<img')) fail('hostile caps not shown literally');
if (!(await hp.$$eval('#deviceSelect option', o => o.some(x => x.textContent.includes('<img'))))) fail('hostile name not shown literally');
if (await hp.evaluate(() => window.__xss)) fail('hostile script ran in the panel');
const hostile = await (await browser.newContext()).newPage();
await hostile.route('**/api/register', r => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ status: 'pending', code: 'AA<img src=x onerror=window.__xss=1>' }) }));
await hostile.goto(`${BASE}/display?device=${id}-h`);
await hostile.waitForSelector('#pairing:not([hidden])');
// The code is shown as XX-XXXX..., so 'AA' keeps the tag intact after the hyphen.
if (await hostile.$('#pairing img') || await hostile.evaluate(() => window.__xss)) fail('pairing page rendered server text as markup');
if (!(await hostile.textContent('#pairing')).includes('AA-<img src=x onerror=window.__xss=1>')) fail('server text not shown literally on the pairing page');
console.log('ok   hostile strings shown literally');
await api('POST', `/api/devices/${id}-x/reject`, {});
await api('POST', `/api/devices/${id}-y/forget`, {});

// 12. The panel's 3 s refresh does not steal keyboard focus from theme buttons.
const fpanel = await (await browser.newContext()).newPage();
await fpanel.goto(`${BASE}/#token=${TOKEN}`);
await fpanel.waitForSelector('#variantRow button');
await fpanel.focus('#variantRow button');
await fpanel.waitForTimeout(3500);
if (!(await fpanel.evaluate(() => document.activeElement && document.activeElement.closest('#variantRow')))) fail('refresh stole focus');
const fid = id + '-k';
await fetch(BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ id: fid, caps: { w: 800, h: 480 } }) });
await api('POST', `/api/devices/${fid}/approve`, { name: 'Focus' });
await fpanel.waitForFunction(i => [...document.querySelectorAll('#deviceSelect option')].some(o => o.value === i), fid, { timeout: 8000 });
await fpanel.selectOption('#deviceSelect', fid);
await fpanel.focus('#variantRow button');
await fpanel.waitForTimeout(3500);
if (!(await fpanel.evaluate(() => document.activeElement && document.activeElement.closest('#variantRow')))) fail('refresh stole focus with a device selected');
console.log('ok   refresh keeps focus');
await api('POST', `/api/devices/${fid}/forget`, {});
await browser.close();
console.log('devices check OK');
