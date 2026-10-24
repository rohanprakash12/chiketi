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
let enabledScreens = []; // [{id, name, html, duration}]
let pauseUntil = 0;
let lastRotate = Date.now();
const PAUSE_MS = __PAUSE_S__ * 1000;
const BUILD = '__BUILD__';  // this page's code; see _display_build() in server.py
/* This display's own settings, from the control panel or its Settings screen
   (see pairing.js). null only before approval. */
let device = null;
let screenRotation = {}; // {id: {enabled, duration}}
let defaultDuration = 10; // server-provided default (--rotate-interval)
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

/* ── Screen registry for current theme ──────────────────────────────────
   Every family names all five of its own screens. Nothing falls through to
   another family's renderer any more: screen 3 was one generic board serving
   all sixteen themes, and screen 4 handed the Terminal palettes the Sci-Fi
   TOS panel -- which is how a green-on-black tty rotated into gold LCARS
   every fourth screen and took itself back afterwards. */
function getScreenRegistry(c) {
  const fam = activeFamily, v = activeVariant;
  let fns, second;
  if (fam === 'Sci-Fi') {
    second = 'NPU';
    fns = v === 'DS9' ? [sfDs9Screen1, sfDs9NpuScreen, sfDs9ClaudeScreen, sfDs9GpuScreen, sfDs9Screen2]
        : v === 'TNG' ? [sfTngScreen1, sfTngNpuScreen, sfTngClaudeScreen, sfTngGpuScreen, sfTngScreen2]
                      : [sfTosScreen1, sfTosNpuScreen, sfTosClaudeScreen, sfTosGpuScreen, sfTosScreen2];
  } else if (fam === 'Vintage') {
    second = 'NPU';
    fns = v === 'Tubes' ? [tubeScreen1, tubeNpuScreen, tubeClaudeScreen, tubeGpuScreen, tubeScreen2]
        : v === 'VFD'   ? [vfdScreen1, vfdNpuScreen, vfdClaudeScreen, vfdGpuScreen, vfdScreen2]
                        : [scanScreen1, scanNpuScreen, scanClaudeScreen, scanGpuScreen, scanScreen2];
  } else if (fam === 'Others') {
    second = 'NPU';
    fns = [claudeScreen1, claudeNpuScreen, claudeClaudeScreen, claudeGpuScreen, claudeClockScreen];
  } else if (DISTRO_SCREENS[v]) {
    // The distro boards draw the time in block characters on screen 1, so the
    // family has no separate clock screen to toggle.
    second = 'AI Monitor';
    fns = [DISTRO_SCREENS[v], DISTRO_AI_SCREENS[v], DISTRO_CLAUDE_SCREENS[v],
           DISTRO_GPU_SCREENS[v], null];
  } else {
    second = 'AI Monitor';
    fns = [terminalScreen1, terminalScreen2, terminalClaudeScreen, terminalGpuScreen, null];
  }
  const screens = [
    {id: 'screen1', name: 'System Stats', fn: fns[0], fluid: false},
    {id: 'screen2', name: second, fn: fns[1], fluid: false},
    {id: 'screen3', name: 'Claude Usage', fn: fns[2], fluid: false},
    // Adaptive: the GPU screen picks its own density from the card count, so a
    // single-card box and a four-card rig both read correctly with no
    // configuration. Switch it off in Settings on a machine with no GPU.
    {id: 'screen4', name: 'GPU', fn: fns[3], fluid: false},
  ];
  // The Sci-Fi clock is fluid: it fills any landscape shape.
  if (fns[4]) screens.push({id: 'screen5', name: 'Clock', fn: fns[4], fluid: fam === 'Sci-Fi' || fam === 'Others'});
  // Live Claude Code sessions: Sci-Fi and Others only for now, and only on a chiketi
  // that has a session feed configured -- a stock install gains no empty screen.
  const sess = fam === 'Sci-Fi' ? (v === 'DS9' ? sfDs9Sessions : v === 'TNG' ? sfTngSessions : sfTosSessions)
    : fam === 'Others' ? claudeSessions : null;
  const ss = m('sessions.status');
  if (sess && ss.available && ss.value !== 'unconfigured') {
    screens.push({id: 'screen7', name: 'Claude Sessions', fn: sess, fluid: true});
  }
  // Home Lab: Sci-Fi and Others for now, and only on a chiketi that has a
  // homelab.toml -- a stock install gains no empty screen. After Sessions, in
  // the same order as the tabs.
  const hl = fam === 'Sci-Fi' ? (v === 'DS9' ? sfDs9Homelab : v === 'TNG' ? sfTngHomelab : sfTosHomelab)
    : fam === 'Others' ? claudeHomelab : null;
  if (hl && hlConfigured()) {
    screens.push({id: 'screen6', name: 'Home Lab', fn: hl, fluid: true});
  }
  return screens;
}

/* Rotation durations arrive from the server (--rotate-interval and the
   per-screen config), so the page must not trust them. A 0, negative, NaN or
   non-numeric duration makes setTimeout(onRotate, 0) reschedule itself
   forever, re-rendering ~130KB of innerHTML every iteration. Bounds match
   ROTATE_MIN_S/ROTATE_MAX_S in __main__.py and the API clamp in server.py. */
const ROTATE_MIN_S = 3, ROTATE_MAX_S = 600, ROTATE_FALLBACK_S = 10;
function clampDuration(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return ROTATE_FALLBACK_S;
  return Math.max(ROTATE_MIN_S, Math.min(ROTATE_MAX_S, n));
}

/* Build the list of enabled screens as lightweight metadata (no HTML).
   Only the currently-visible screen's renderer runs, in renderDisplay(). */
function buildEnabledScreens() {
  const c = themeColors;
  const allScreens = getScreenRegistry(c);
  let list = allScreens.filter(s => {
    const cfg = screenRotation[s.id];
    return !cfg || cfg.enabled !== false;
  }).map(s => {
    const cfg = screenRotation[s.id];
    return { id: s.id, name: s.name, fn: s.fn, fluid: !!s.fluid,
             duration: clampDuration((cfg && cfg.duration) || defaultDuration) };
  });
  if (list.length === 0) {
    // Fallback: show first screen if all disabled
    const s0 = allScreens[0];
    list = [{ id: s0.id, name: s0.name, fn: s0.fn, fluid: !!s0.fluid, duration: clampDuration(defaultDuration) }];
  }
  return list;
}

function renderDisplay() {
  if (!themeColors || !activeFamily) return;
  enabledScreens = buildEnabledScreens();
  if (currentScreenIdx >= enabledScreens.length) currentScreenIdx = 0;
  // Render only the visible screen, not every enabled one.
  document.getElementById('display').innerHTML = enabledScreens[currentScreenIdx].fn(themeColors);
}

/* ── Polling ── */
async function poll() {
  try {
    if (window.chiketiPollDevice) window.chiketiPollDevice();
    measureFrame();
    const [tr, mr, dr] = await Promise.all([
      fetch(API + '/api/themes'),
      fetch(API + '/api/metrics'),
      fetch(API + '/api/display'),
    ]);
    const themeData = await tr.json();
    metrics = await mr.json();
    const displayData = await dr.json();

    // The server is running newer code than this page: load it.
    if (displayData.build && displayData.build !== BUILD) { location.reload(); return; }

    // Apply per-screen rotation config
    if (displayData.screen_rotation) screenRotation = displayData.screen_rotation;
    // Clamp: a 0/negative duration turns scheduleRotate() into a hot
    // setTimeout(0) loop that re-renders the whole screen continuously.
    if (typeof displayData.default_duration === 'number' && isFinite(displayData.default_duration)) {
      defaultDuration = clampDuration(displayData.default_duration);
    }

    // A device's own theme wins over the house theme, if it still exists.
    let newFamily = themeData.active_family, newVariant = themeData.active_variant;
    if (device && device.theme) {
      const [fam, variant] = device.theme.split('/');
      if (themeData.families[fam] && themeData.families[fam][variant]) {
        newFamily = fam; newVariant = variant;
      }
    }
    if (newFamily !== activeFamily || newVariant !== activeVariant) {
      activeFamily = newFamily;
      activeVariant = newVariant;
      currentScreenIdx = 0;
      lastRotate = Date.now();
    }
    themeColors = (themeData.families[activeFamily] || {})[activeVariant];

    renderDisplay();
    scheduleRotate();
    scheduleClockTick();
  } catch(e) { /* retry next poll */ }
}

/* ── Auto-rotate: schedule a single timer for the next rotation instead of
   polling every animation frame (idle CPU/GPU on the Pi between rotations). ── */
function scheduleRotate() {
  if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
  if (enabledScreens.length <= 1 || (device && !device.auto_rotate)) return;
  const raw = device ? device.seconds
    : ((enabledScreens[currentScreenIdx] || {}).duration || defaultDuration);
  const durationMs = clampDuration(raw) * 1000;
  // Next rotation is `durationMs` after the last one, but never before any
  // active manual-pause window expires.
  const target = Math.max(lastRotate + durationMs, pauseUntil);
  rotateTimer = setTimeout(onRotate, Math.max(0, target - Date.now()));
}
function onRotate() {
  currentScreenIdx = (currentScreenIdx + 1) % (enabledScreens.length || 1);
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
   Keys, swipes and the screen tabs all land here. A manual move pauses
   auto-rotation for PAUSE_MS, as the keys always did. */
function goToScreen(idx) {
  const n = enabledScreens.length || 1;
  currentScreenIdx = ((idx % n) + n) % n;
  pauseUntil = Date.now() + PAUSE_MS;
  lastRotate = Date.now();
  renderDisplay();
  scheduleRotate();
  scheduleClockTick();
}

document.addEventListener('keydown', (e) => {
  const n = enabledScreens.length || 1;
  if (e.key >= '1' && e.key <= '9') goToScreen(Math.min(parseInt(e.key) - 1, n - 1));
  else if (e.key === ' ') { e.preventDefault(); goToScreen(currentScreenIdx + 1); }
  else if (e.key === 'Escape') { window.close(); }
});

/* Swipe left for the next screen, right for the previous one. A mostly
   horizontal move of at least 8% of the width counts; anything shorter is
   a tap, which a screen tab may claim. */
let swipeStart = null;
document.addEventListener('pointerdown', function (e) {
  swipeStart = { x: e.clientX, y: e.clientY };
});
document.addEventListener('pointerup', function (e) {
  const s = swipeStart;
  swipeStart = null;
  if (!s) return;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (Math.abs(dx) >= window.innerWidth * 0.08 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    goToScreen(currentScreenIdx + (dx < 0 ? 1 : -1));
    return;
  }
  if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
    const tab = e.target.closest && e.target.closest('[data-screen]');
    if (!tab) return;
    const idx = enabledScreens.findIndex(function (x) { return x.id === tab.getAttribute('data-screen'); });
    if (idx !== -1 && idx !== currentScreenIdx) goToScreen(idx);
  }
});
document.addEventListener('pointercancel', function () { swipeStart = null; });

/* ── Start: pairing.js calls this once the display is approved ── */
window.chiketiApplyDevice = function (settings) {
  const before = device;
  device = settings;
  if (!before || before.theme !== settings.theme || before.auto_rotate !== settings.auto_rotate ||
      before.seconds !== settings.seconds) {
    scheduleRotate();
  }
};
window.chiketiStart = function (settings) {
  device = settings;
  poll();
  setInterval(poll, 2500);
};
if (window.CHIKETI_PENDING_START) window.chiketiStart(window.CHIKETI_PENDING_START);
</script>