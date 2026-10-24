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
// Every page fails the run on an uncaught script error.
const newContext = browser.newContext.bind(browser);
browser.newContext = async (o) => {
  const c = await newContext(o);
  c.on('page', p => p.on('pageerror', e => fail('page error: ' + e.message)));
  return c;
};

// 1. A new display shows a pairing code and no dashboard.
const ctx = await browser.newContext({ viewport: { width: 1800, height: 1200 }, hasTouch: true });
const page = await ctx.newPage();
await page.goto(`${BASE}/display?device=${id}`);
await page.waitForSelector('#pairing:not([hidden])');
const text = await page.textContent('#pairing');
if (!/NEW DISPLAY/.test(text) || !/[2-9A-Z]{2}-[2-9A-Z]{2}/.test(text)) fail('pairing page: ' + text);
if (!/touch/.test(text) || !/landscape/.test(text)) fail('caps not shown: ' + text);
// Keys and a swipe before the first render must do nothing (and throw nothing).
await page.keyboard.press('1');
await page.keyboard.press(' ');
await page.mouse.move(900, 600); await page.mouse.down(); await page.mouse.move(300, 600); await page.mouse.up();
if (await page.isHidden('#pairing')) fail('input before approval left the pairing page');
console.log('ok   pairing page');

// 2. Approve -> dashboard within one poll; starting settings from touch.
const s = await api('POST', `/api/devices/${id}/approve`, { name: 'Check' });
// The dev server has a sessions.toml, so a new display starts in Kiosk.
if (s.auto_rotate !== false || s.gear !== true || s.mode !== 'kiosk') fail('starting settings ' + JSON.stringify(s));
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
// TNG is a Self theme: switch the display to Self in the panel first.
await panel.click('input[name=devMode][value=self]');
for (let i = 0; i < 20; i++) {
  if ((await api('GET', '/api/devices')).devices.find(d => d.id === pid).mode === 'self') break;
  await panel.waitForTimeout(250);
}
await panel.waitForSelector('#variantRow button:has-text("TNG")', { timeout: 8000 });
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
// ── Screen modes (13-18) ─────────────────────────────────────────────────
const FIX = require('../tests/js/fixtures.js');
const http = require('http');
const shown = (p) => p.evaluate(() => enabledScreens[currentScreenIdx].id);
const ids = (p) => p.evaluate(() => enabledScreens.map(s => s.id).join());

// 13. Mode and screens reach an open display without a reload; the theme follows the mode.
const kid = id + '-m';
const kctx = await browser.newContext({ viewport: { width: 1800, height: 1200 }, hasTouch: true });
const kp = await kctx.newPage();
await kp.route('**/api/metrics', r => r.fulfill({ json: FIX.FULL }));   // Home Lab and Sessions ready
await kp.goto(`${BASE}/display?device=${kid}`);
await kp.waitForSelector('#pairing:not([hidden])');
await api('POST', `/api/devices/${kid}/approve`, { name: 'Modes' });
await api('POST', `/api/devices/${kid}`, { mode: 'self', theme: 'Terminal/hacker' });
await kp.waitForFunction(() => activeFamily === 'Terminal' && enabledScreens[0].id === 'screen1', null, { timeout: 8000 });
await kp.evaluate(() => { window.__marker = 1; });
await api('POST', `/api/devices/${kid}`, { mode: 'kiosk' });
await kp.waitForFunction(() => activeVariant === 'TOS' && enabledScreens.map(s => s.id).join() === 'lab,sessions', null, { timeout: 8000 });
// Same theme across a mode change: Self/TOS -> Kiosk/TOS.
await api('POST', `/api/devices/${kid}`, { mode: 'self', theme: 'Sci-Fi/TOS' });
await kp.waitForFunction(() => enabledScreens[0].id === 'screen1', null, { timeout: 8000 });
await api('POST', `/api/devices/${kid}`, { mode: 'kiosk' });
await kp.waitForFunction(() => activeVariant === 'TOS' && enabledScreens[0].id === 'lab', null, { timeout: 8000 });
if (!(await kp.evaluate(() => window.__marker === 1))) fail('a mode change reloaded the page');
console.log('ok   mode switches reach the display; Kiosk falls back to TOS; same theme kept');

// 14. Tap each live tab; a tap straddling a redraw still navigates; a grey tab does nothing.
await api('POST', `/api/devices/${kid}`, { screens: ['sessions', 'overview', 'lab'] });
await kp.waitForFunction(() => enabledScreens.map(s => s.id).join() === 'sessions,lab', null, { timeout: 8000 });
for (const target of ['lab', 'sessions']) {
  await kp.tap(`[data-screen="${target}"]`);
  await kp.waitForFunction(t => enabledScreens[currentScreenIdx].id === t, target, { timeout: 3000 });
}
const tappable = await kp.$$eval('[data-screen]', els => els.map(e => e.getAttribute('data-screen')).join());
if (tappable !== 'sessions,lab') fail('tappable tabs ' + tappable);
await kp.tap('[data-tab="overview"]');
await kp.waitForTimeout(300);
if ((await shown(kp)) !== 'sessions') fail('a grey tab navigated');
const box = await (await kp.$('[data-screen="lab"]')).boundingBox();
// A real tap is atomic, so dispatch its halves by hand with a redraw between.
await kp.evaluate(({ x, y }) => {
  document.elementFromPoint(x, y).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 7 }));
  renderDisplay();                                   // the redraw lands mid-tap
  document.elementFromPoint(x, y).dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 7 }));
}, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
await kp.waitForFunction(() => enabledScreens[currentScreenIdx].id === 'lab', null, { timeout: 3000 });
console.log('ok   tabs navigate, also across a redraw; grey tabs do not');

// 15. A reorder keeps the current screen; into and out of an empty Kiosk plan.
await api('POST', `/api/devices/${kid}`, { screens: ['lab', 'sessions'] });
await kp.waitForFunction(() => enabledScreens.map(s => s.id).join() === 'lab,sessions' &&
  enabledScreens[currentScreenIdx].id === 'lab', null, { timeout: 8000 });
await api('POST', `/api/devices/${kid}`, { screens: ['sessions', 'lab'] });
await kp.waitForFunction(() => enabledScreens.map(s => s.id).join() === 'sessions,lab', null, { timeout: 8000 });
if ((await shown(kp)) !== 'lab') fail('a reorder moved the display off its screen');
await api('POST', `/api/devices/${kid}`, { screens: ['overview'] });
await kp.waitForFunction(() => /NO SCREENS TO SHOW/.test(document.getElementById('display').textContent), null, { timeout: 8000 });
await api('POST', `/api/devices/${kid}`, { screens: ['sessions'] });
await kp.waitForFunction(() => enabledScreens[0].id === 'sessions', null, { timeout: 8000 });
if (!(await kp.evaluate(() => window.__marker === 1))) fail('a screens change reloaded the page');
console.log('ok   reorder keeps the screen; the empty plan shows the notice and recovers');

// 18. The control panel's mode, screens and Save reach the open display; a
// refresh does not discard an edit; switching devices resets the baseline.
const pp = await (await browser.newContext({ viewport: { width: 1200, height: 1000 } })).newPage();
await pp.goto(`${BASE}/#token=${TOKEN}`);
await pp.waitForFunction(i => [...document.querySelectorAll('#deviceSelect option')].some(o => o.value === i), kid, { timeout: 8000 });
await pp.selectOption('#deviceSelect', kid);
await pp.waitForSelector('.pick-row[data-id="sessions"]');
await pp.click('input[name=devMode][value=self]');
await kp.waitForFunction(() => enabledScreens[0].id === 'screen1', null, { timeout: 8000 });
if ((await api('GET', '/api/devices')).devices.find(d => d.id === kid).mode !== 'self') fail('panel mode click did not reach the server');
await pp.click('input[name=devMode][value=kiosk]');
await pp.waitForSelector('.pick-row[data-id="lab"]');
await pp.waitForFunction(() => document.querySelector('.pick-row').dataset.id === 'lab');
await pp.uncheck('.pick-row[data-id="lab"] .pick-on');
for (let i = 0; i < 8 && (await pp.$eval('.pick-row', r => r.dataset.id)) !== 'sessions'; i++) {
  await pp.click('.pick-row[data-id="sessions"] .pick-up');
}
await pp.check('.pick-row[data-id="overview"] .pick-on');
await pp.waitForTimeout(3500);                      // one panel refresh: the edit survives
if (!(await pp.isChecked('.pick-row[data-id="overview"] .pick-on'))) fail('a refresh discarded an edit');
await pp.click('#devSave');
await kp.waitForFunction(() => [...document.querySelectorAll('[data-tab]')].map(e => e.dataset.tab).join() === 'sessions,overview',
  null, { timeout: 8000 });
const saved = (await api('GET', '/api/devices')).devices.find(d => d.id === kid).screens.join();
if (saved !== 'sessions,overview') fail('saved screens ' + saved);
if ((await ids(kp)) !== 'sessions') fail('display list after save ' + (await ids(kp)));
// Switch to another device and edit at once: the next refresh keeps the edit.
const other = id + '-b';
await fetch(BASE + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ id: other, caps: { w: 1024, h: 600 } }) });
await api('POST', `/api/devices/${other}/approve`, { name: 'Other' });
await pp.waitForFunction(i => [...document.querySelectorAll('#deviceSelect option')].some(o => o.value === i), other, { timeout: 8000 });
await pp.selectOption('#deviceSelect', other);
await pp.waitForSelector('.pick-row[data-id="sessions"]');
await pp.uncheck('.pick-row[data-id="sessions"] .pick-on');
await pp.waitForTimeout(3500);
if (await pp.isChecked('.pick-row[data-id="sessions"] .pick-on')) fail('switching devices then a refresh discarded the edit');
// A theme change (here: back to the house theme) keeps the unsaved edit.
await pp.click('#variantRow button:has-text("House theme")');
await pp.waitForTimeout(800);
if (await pp.isChecked('.pick-row[data-id="sessions"] .pick-on')) fail('a theme change discarded the edit');
// A refused mode change puts the radio back and keeps the edit.
await pp.route(`**/api/devices/${other}`, r => r.request().method() === 'POST'
  ? r.fulfill({ status: 403, body: 'Forbidden' }) : r.continue());
await pp.click('input[name=devMode][value=self]');
await pp.waitForTimeout(800);
if (!(await pp.isChecked('input[name=devMode][value=kiosk]'))) fail('a refused mode change left the wrong radio selected');
if (await pp.isChecked('.pick-row[data-id="sessions"] .pick-on')) fail('a refused mode change discarded the edit');
await pp.unroute(`**/api/devices/${other}`);
// A device list that arrives after a newer one is dropped, not applied over the edit.
let holdList = null, listHeld = false;
await pp.route('**/api/devices', async r => {
  if (listHeld) return r.continue();
  listHeld = true;
  const body = await (await r.fetch()).json();       // the state before Save, delivered late
  holdList = () => r.fulfill({ json: body });
});
for (let i = 0; i < 30 && !holdList; i++) await pp.waitForTimeout(200);
await pp.click('#devSave');                           // saves Other with Sessions unticked
for (let i = 0; i < 20; i++) {
  if (!(await api('GET', '/api/devices')).devices.find(d => d.id === other).screens.includes('sessions')) break;
  await pp.waitForTimeout(200);
}
await pp.waitForTimeout(500);
await pp.check('.pick-row[data-id="overview"] .pick-on');   // a new edit after the save
await holdList();
await pp.waitForTimeout(800);
if (!(await pp.isChecked('.pick-row[data-id="overview"] .pick-on')) ||
    await pp.isChecked('.pick-row[data-id="sessions"] .pick-on')) fail('a late device list replaced the draft');
await pp.unroute('**/api/devices');
console.log('ok   panel mode, screens, order and Save reach the display; edits survive refreshes');

// 16. A late registration reply does not roll settings back.
const oid = id + '-o';
const octx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
const op2 = await octx.newPage();
let holdRegister = null;
await op2.route('**/api/register', async r => {
  if (holdRegister === null) { holdRegister = false; return r.continue(); }
  const body = await (await r.fetch()).json();      // answered now, delivered late
  holdRegister = () => r.fulfill({ json: body });
});
await op2.goto(`${BASE}/display?device=${oid}`);
await op2.waitForSelector('#pairing:not([hidden])');
await api('POST', `/api/devices/${oid}/approve`, { name: 'Order' });
await op2.waitForSelector('#display .screen-frame', { timeout: 8000 });
await op2.setViewportSize({ width: 1000, height: 600 });           // resize -> re-register (held)
for (let i = 0; i < 30 && typeof holdRegister !== 'function'; i++) await op2.waitForTimeout(200);
if (typeof holdRegister !== 'function') fail('the resize did not re-register');
await api('POST', `/api/devices/${oid}`, { seconds: 77 });
await op2.waitForFunction(() => device.seconds === 77, null, { timeout: 8000 });
await holdRegister();
await op2.waitForTimeout(500);
if ((await op2.evaluate(() => device.seconds)) !== 77) fail('a late registration reply rolled settings back');
// ...nor does a late device-status reply.
let holdStatus = null, held = false;
await op2.route('**/api/device/**', async r => {
  if (held) return r.continue();
  held = true;
  const body = await (await r.fetch()).json();
  holdStatus = () => r.fulfill({ json: body });
});
for (let i = 0; i < 30 && !holdStatus; i++) await op2.waitForTimeout(200);
await api('POST', `/api/devices/${oid}`, { seconds: 88 });
await op2.waitForFunction(() => device.seconds === 88, null, { timeout: 8000 });
await holdStatus();
await op2.waitForTimeout(500);
if ((await op2.evaluate(() => device.seconds)) !== 88) fail('a late status reply rolled settings back');
console.log('ok   late replies are dropped');

// 17. A stalled poll commits nothing, keeps the last render, and recovers without a reload.
let stallHits = 0;
const stall = http.createServer((req, res) => {
  stallHits++;
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/hold') return;                                  // never answered
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.write('{"cpu.usage":');                                        // headers, then a body that never ends
});
await new Promise(r => stall.listen(0, '127.0.0.1', r));
const stallBase = 'http://127.0.0.1:' + stall.address().port;
const withHost = (h) => Object.assign({}, FIX.FULL, { 'sys.hostname': Object.assign({}, FIX.FULL['sys.hostname'], { value: h }) });
// The display follows the house theme, pinned to TOS here, so a theme reply
// committed from a failed batch (Claude, below) would show.
await api('POST', `/api/devices/${oid}`, { mode: 'self', screens: ['screen1'], theme: '', auto_rotate: false });
const themesAs = (fam, variant) => async r => {
  const j = await (await r.fetch()).json();
  j.active_family = fam; j.active_variant = variant;
  r.fulfill({ json: j });
};
await op2.route('**/api/themes', themesAs('Sci-Fi', 'TOS'));
await op2.route('**/api/metrics', r => r.fulfill({ json: withHost('before-stall') }));
await op2.waitForFunction(() => metrics && metrics['sys.hostname'] && metrics['sys.hostname'].value === 'before-stall' &&
  enabledScreens[0].id === 'screen1' && activeVariant === 'TOS', null, { timeout: 8000 });
await op2.evaluate(() => { window.__marker = 1; });
for (const phase of ['/hold', '/body']) {
  const snap = await op2.evaluate(() => ({ theme: activeFamily + '/' + activeVariant, polls: window.__chiketiPolls }));
  await op2.unroute('**/api/metrics');
  await op2.unroute('**/api/themes');
  await op2.route('**/api/metrics', r => r.continue({ url: stallBase + phase }));
  await op2.route('**/api/themes', themesAs('Others', 'Claude'));     // a distinguishable success
  const hits = stallHits;
  for (let i = 0; i < 40 && stallHits === hits; i++) await op2.waitForTimeout(250);
  if (stallHits === hits) fail('the stall server was never asked (' + phase + ')');
  await op2.waitForTimeout(9000);                                    // past the 8 s deadline
  const now = await op2.evaluate(() => ({ theme: activeFamily + '/' + activeVariant, polls: window.__chiketiPolls,
    host: metrics['sys.hostname'].value, text: document.getElementById('display').textContent.toUpperCase() }));
  if (now.theme !== snap.theme || now.polls !== snap.polls || now.host !== 'before-stall' || !now.text.includes('BEFORE-STALL')) {
    fail('a stalled poll (' + phase + ') committed or lost the render: ' + JSON.stringify({ snap, now: { theme: now.theme, polls: now.polls, host: now.host } }));
  }
}
await op2.unroute('**/api/metrics');
await op2.unroute('**/api/themes');
await op2.route('**/api/themes', themesAs('Sci-Fi', 'TOS'));
await op2.route('**/api/metrics', r => r.fulfill({ json: withHost('after-stall') }));
await op2.waitForFunction(() => metrics['sys.hostname'].value === 'after-stall' &&
  document.getElementById('display').textContent.toUpperCase().includes('AFTER-STALL'), null, { timeout: 20000 });
if (!(await op2.evaluate(() => window.__marker === 1))) fail('the display reloaded after a stall');
console.log('ok   stalled polls commit nothing and recover');

// Cleanup for 13-18.
stall.closeAllConnections && stall.closeAllConnections();
stall.close();
for (const d of [kid, oid, other]) await api('POST', `/api/devices/${d}/forget`, {});
await kctx.close(); await octx.close();
await browser.close();
console.log('devices check OK');
