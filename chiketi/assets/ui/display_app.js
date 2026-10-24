<script>
/* Fit the frame to the screen without cropping.
   Fluid screens are 1024 x FRAME_H and fill the screen exactly. Fixed screens
   are 1024x600 and are contained (letterboxed) on any other shape, centred. */
function scaleDisplay() {
  const frame = document.querySelector('.screen-frame');
  if (!frame) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  let s, x = 0, y = 0;
  // A fluid screen with no strip layout is letterboxed on a bar display
  // rather than stretched past its edges.
  if (frame.classList.contains('fluid') && layoutClass() === 'strip' && !frame.classList.contains('strip')) {
    frame.classList.remove('fluid');
  }
  if (frame.classList.contains('fluid')) {
    s = vw / 1024;
  } else {
    s = Math.min(vw / 1024, vh / 600);
    x = (vw - 1024 * s) / 2;
    y = (vh - 600 * s) / 2;
  }
  frame.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
  frame.style.transformOrigin = 'top left';
  const inner = frame.firstElementChild;
  if (inner) document.body.style.background = getComputedStyle(inner).backgroundColor;
}
/* Frame height in kiosk units from the real screen. Returns true if it changed. */
function measureFrame() {
  const before = frameH();
  setFrameH(1024 * window.innerHeight / window.innerWidth);
  document.getElementById('display').style.setProperty('--frame-h', frameH() + 'px');
  return frameH() !== before;
}
new MutationObserver(scaleDisplay).observe(document.getElementById('display'), {childList: true});
window.addEventListener('resize', function () {
  if (measureFrame() && typeof renderDisplay === 'function') renderDisplay();
  scaleDisplay();
});
</script>

<script>
const API = window.location.origin;
const PANEL_SPEC = __PANEL_SPEC_JSON__;
const SCREEN_SPEC = __SCREEN_SPEC_JSON__;   // assets/ui/screens.json
let metrics = null;
let activeFamily = null, activeVariant = null;
let themeColors = null;
let currentScreenIdx = 0;
let enabledScreens = []; // what this display shows now: [{id, name, fn, fluid}]
let currentId = null;     // the showing screen, kept by id across plan changes
let themeData = null;     // the last good /api/themes
let pauseUntil = 0;
let lastRotate = Date.now();
const PAUSE_MS = __PAUSE_S__ * 1000;
const BUILD = '__BUILD__';  // this page's code; see _display_build() in server.py
/* This display's own settings, from the control panel or its Settings screen
   (see pairing.js). null only before approval. */
let device = null;
let polling = false;
const POLL_DEADLINE_MS = 8000;
let rotateTimer = null;
let clockTimer = null;

/* ── Data helpers ── */
function m(key) {
  if (!metrics || !metrics[key]) return { value: null, available: false, unit: '', extra: {} };
  return metrics[key];
}
function mv(key, suffix) {
  const d = m(key);
  if (!d.available) return 'N/A';
  return esc(suffix ? d.value + suffix : String(d.value));
}

function cleanModel() {
  const d = m('llama.model');
  if (!d.available) return '--';
  return esc(String(d.value).replace(/\.gguf$/i, '').replace(/[-_]Q\d[A-Z0-9_]*$/i, '').replace(/_/g, ' ').replace(/-$/, ''));
}

/* ── Shared rendering helpers ── */
__SHARED_HELPERS__
/* ═══ Screen renderers (identical to control panel) ═══ */

__SCREEN_FUNCTIONS__

/* A display's seconds arrive from the server (its device settings), so the
   page must not trust them. A 0, negative, NaN or
   non-numeric duration makes setTimeout(onRotate, 0) reschedule itself
   forever, re-rendering ~130KB of innerHTML every iteration. Bounds match
   ROTATE_MIN_S/ROTATE_MAX_S in __main__.py and the API clamp in server.py. */
const ROTATE_MIN_S = 3, ROTATE_MAX_S = 600, ROTATE_FALLBACK_S = 10;
function clampDuration(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return ROTATE_FALLBACK_S;
  return Math.max(ROTATE_MIN_S, Math.min(ROTATE_MAX_S, n));
}

/* The theme this display shows: its own if its mode allows it, else its mode's
   house theme, else the mode's default. A Kiosk display never lands on Terminal. */
function resolveTheme(td) {
  const mode = device && SCREEN_SPEC.modes[device.mode] ? device.mode : 'self';
  const ok = function (k) {
    if (typeof k !== 'string') return false;
    const fv = k.split('/');
    return !!(td.families[fv[0]] && td.families[fv[0]][fv[1]]) && themeAllowed(mode, k);
  };
  const house = mode === 'kiosk' ? td.kiosk_theme : td.active_family + '/' + td.active_variant;
  const own = device && device.theme;
  return (ok(own) ? own : ok(house) ? house : SCREEN_SPEC.modes[mode].default_theme).split('/');
}

/* A Kiosk display with nothing to show draws the notice (with its tabs). */
const NOTICE = { id: 'none', name: 'No screens', fn: kioskNotice, fluid: true };

/* The one place settings become a screen: theme, plan, tabs and the current
   screen (kept by id) are worked out together and drawn in one step. Only the
   visible screen's renderer runs. */
function renderDisplay() {
  if (!themeData) return;
  const fv = resolveTheme(themeData);
  if (fv[0] !== activeFamily || fv[1] !== activeVariant) {
    activeFamily = fv[0]; activeVariant = fv[1]; currentId = null; lastRotate = Date.now();
  }
  themeColors = (themeData.families[activeFamily] || {})[activeVariant];
  if (!themeColors) return;
  const plan = screenPlan({ mode: device ? device.mode : 'self', screens: device ? device.screens : null,
                            family: activeFamily, variant: activeVariant });
  setTabPlan(plan.mode === 'kiosk' ? plan.tabs : null);
  enabledScreens = plan.empty ? [NOTICE] : plan.list;
  let idx = enabledScreens.findIndex(function (x) { return x.id === currentId; });
  if (idx === -1) idx = 0;
  currentScreenIdx = idx;
  currentId = enabledScreens[idx].id;
  document.getElementById('display').innerHTML = enabledScreens[idx].fn(themeColors);
}

/* ── Polling: one at a time, each with a deadline. A stalled request must not
   stop the display updating (or noticing a new build), and a failed batch
   commits nothing: the last good render stays up. ── */
async function poll() {
  if (polling) return;
  polling = true;
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, POLL_DEADLINE_MS);
  const get = function (p) {
    return fetch(API + p, { signal: ctl.signal }).then(function (r) {
      if (!r.ok) throw new Error(p + ' ' + r.status);
      return r.json();
    });
  };
  try {
    if (window.chiketiPollDevice) window.chiketiPollDevice();
    measureFrame();
    const got = await Promise.all([get('/api/themes'), get('/api/metrics'), get('/api/display')]);
    // The server is running newer code than this page: load it.
    if (got[2].build && got[2].build !== BUILD) { location.reload(); return; }
    themeData = got[0];
    metrics = got[1];
    window.__chiketiPolls = (window.__chiketiPolls || 0) + 1;
    renderDisplay();
    scheduleRotate();
    scheduleClockTick();
  } catch (e) {
    ctl.abort();      // the rest of the batch, if one request failed first; retry next poll
  } finally {
    clearTimeout(timer);
    polling = false;
  }
}

/* ── Auto-rotate: schedule a single timer for the next rotation instead of
   polling every animation frame (idle CPU/GPU on the Pi between rotations). ── */
function scheduleRotate() {
  if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
  if (enabledScreens.length <= 1 || !device || !device.auto_rotate) return;
  const durationMs = clampDuration(device.seconds) * 1000;
  // Next rotation is `durationMs` after the last one, but never before any
  // active manual-pause window expires.
  const target = Math.max(lastRotate + durationMs, pauseUntil);
  rotateTimer = setTimeout(onRotate, Math.max(0, target - Date.now()));
}
function onRotate() {
  if (!enabledScreens.length) return;
  currentId = enabledScreens[(currentScreenIdx + 1) % enabledScreens.length].id;
  lastRotate = Date.now();
  renderDisplay();
  scheduleRotate();
  scheduleClockTick();
}

/* ── Clock tick ──
   Clock screens render live seconds, but metrics only refresh every 2500ms,
   so the seconds digit visibly skips (2 -> 4 -> 7). Repaint those screens
   once a second on a separate timer instead of speeding up the poll, which
   would triple metric traffic for every screen.

   Non-clock screens are deliberately left alone: renderDisplay() replaces
   ~130KB of innerHTML and that is not worth doing every second on a Pi. */
const CLOCK_SCREEN_IDS = ['screen1', 'screen5'];
/* Families carrying a clock: Sci-Fi and Vintage show a chronometer on screen1
   and the standalone clock on screen5. Terminal's screen2 is the AI Monitor,
   so this is an allowlist rather than a Terminal denylist -- a family added
   later is correctly treated as non-clock by default.

   The distro Terminal variants are the exception: their screen1 draws the time
   in block characters, so they tick too. */
const CLOCK_FAMILIES = ['Sci-Fi', 'Vintage'];

function isClockScreen() {
  const s = enabledScreens[currentScreenIdx];
  if (!s) return false;
  if (CLOCK_SCREEN_IDS.indexOf(s.id) !== -1 &&
      CLOCK_FAMILIES.indexOf(activeFamily) !== -1) return true;
  return s.id === 'screen1' && !!DISTRO_SCREENS[activeVariant];
}

/* Idempotent: always clears the existing interval first, so calling it on
   every screen change can never accumulate timers, and leaving a clock screen
   through any path stops the tick. */
function scheduleClockTick() {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  if (!isClockScreen()) return;
  clockTimer = setInterval(function () {
    // renderDisplay() can itself move off this screen (it rebuilds
    // enabledScreens and resets currentScreenIdx when the list shrinks), so
    // re-check each tick rather than trusting the state at schedule time.
    if (!isClockScreen()) { scheduleClockTick(); return; }
    renderDisplay();
  }, 1000);
}

/* A backgrounded kiosk tab has nothing to repaint. */
document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  } else {
    scheduleClockTick();
  }
});

/* ── Manual navigation ──
   Keys, swipes and the screen tabs all land here, by screen id. A manual move
   pauses auto-rotation for PAUSE_MS, as the keys always did. Before the first
   render there is nothing to move to. */
function goToId(id) {
  if (!enabledScreens.some(function (x) { return x.id === id; })) return;
  currentId = id;
  pauseUntil = Date.now() + PAUSE_MS;
  lastRotate = Date.now();
  renderDisplay();
  scheduleRotate();
  scheduleClockTick();
}
function goToScreen(idx) {
  const n = enabledScreens.length;
  if (!n) return;
  goToId(enabledScreens[((idx % n) + n) % n].id);
}

document.addEventListener('keydown', (e) => {
  const n = enabledScreens.length;
  if (e.key >= '1' && e.key <= '9') { if (n) goToScreen(Math.min(parseInt(e.key) - 1, n - 1)); }
  else if (e.key === ' ') { e.preventDefault(); goToScreen(currentScreenIdx + 1); }
  else if (e.key === 'Escape') { window.close(); }
});

/* Swipe left for the next screen, right for the previous one. A mostly
   horizontal move of at least 8% of the width counts; anything shorter is
   a tap, which a screen tab may claim. The tab is noted at pointer-down: a
   redraw (every poll, every second on a clock) can replace the element under
   the finger before it lifts. */
let swipeStart = null;
document.addEventListener('pointerdown', function (e) {
  const tab = e.target.closest && e.target.closest('[data-screen]');
  swipeStart = { x: e.clientX, y: e.clientY, pointer: e.pointerId,
                 tab: tab ? tab.getAttribute('data-screen') : null };
});
document.addEventListener('pointerup', function (e) {
  const s = swipeStart;
  swipeStart = null;
  if (!s || e.pointerId !== s.pointer) return;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (Math.abs(dx) >= window.innerWidth * 0.08 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    goToScreen(currentScreenIdx + (dx < 0 ? 1 : -1));
    return;
  }
  // Go by the id noted at pointer-down, whatever element this landed on.
  if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && s.tab && s.tab !== currentId) goToId(s.tab);
});
document.addEventListener('pointercancel', function () { swipeStart = null; });

/* ── Start: pairing.js calls this once the display is approved ── */
/* New settings from pairing.js (in order: it drops stale replies). Mode,
   screens and theme all reach the screen at once, without waiting for a poll. */
window.chiketiApplyDevice = function (settings) {
  const before = JSON.stringify(device);
  device = settings;
  if (JSON.stringify(settings) === before) return;
  renderDisplay();
  scheduleRotate();
  scheduleClockTick();
};
window.chiketiStart = function (settings) {
  device = settings;
  poll();
  setInterval(poll, 2500);
};
if (window.CHIKETI_PENDING_START) window.chiketiStart(window.CHIKETI_PENDING_START);
</script>