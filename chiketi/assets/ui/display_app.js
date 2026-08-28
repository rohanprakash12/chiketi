<script>
/* Scale the 1024x600 screen-frame to fill the viewport */
function scaleDisplay() {
  const frame = document.querySelector('.screen-frame');
  if (!frame) return;
  const sx = window.innerWidth / 1024;
  const sy = window.innerHeight / 600;
  const s = Math.max(sx, sy);
  frame.style.transform = 'scale(' + s + ')';
  frame.style.transformOrigin = 'top left';
}
new MutationObserver(scaleDisplay).observe(document.getElementById('display'), {childList: true});
window.addEventListener('resize', scaleDisplay);
</script>

<script>
const API = window.location.origin;
const PANEL_SPEC = __PANEL_SPEC_JSON__;
let metrics = null;
let activeFamily = null, activeVariant = null;
let themeColors = null;
let currentScreenIdx = 0;
let enabledScreens = []; // [{id, name, html, duration}]
let pauseUntil = 0;
let lastRotate = Date.now();
const PAUSE_MS = __PAUSE_S__ * 1000;
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

/* ── Screen registry for current theme ── */
function getScreenRegistry(c) {
  const isPanel = activeFamily === 'Sci-Fi';
  const isVintage = activeFamily === 'Vintage';
  const isCoral = isPanel && activeVariant === 'TNG';
  const isTeal = isPanel && activeVariant === 'DS9';
  let screens;
  if (isTeal) screens = [{id:'screen1',name:'System Stats',fn:sfDs9Screen1},{id:'screen2',name:'NPU',fn:sfDs9NpuScreen},{id:'screen5',name:'Clock',fn:sfDs9Screen2}];
  else if (isCoral) screens = [{id:'screen1',name:'System Stats',fn:sfTngScreen1},{id:'screen2',name:'NPU',fn:sfTngNpuScreen},{id:'screen5',name:'Clock',fn:sfTngScreen2}];
  else if (isPanel) screens = [{id:'screen1',name:'System Stats',fn:sfTosScreen1},{id:'screen2',name:'NPU',fn:sfTosNpuScreen},{id:'screen5',name:'Clock',fn:sfTosScreen2}];
  else if (isVintage && activeVariant === 'Tubes') screens = [{id:'screen1',name:'System Stats',fn:tubeScreen1},{id:'screen2',name:'NPU',fn:tubeNpuScreen},{id:'screen5',name:'Clock',fn:tubeScreen2}];
  else if (isVintage && activeVariant === 'VFD') screens = [{id:'screen1',name:'System Stats',fn:vfdScreen1},{id:'screen2',name:'NPU',fn:vfdNpuScreen},{id:'screen5',name:'Clock',fn:vfdScreen2}];
  else if (isVintage) screens = [{id:'screen1',name:'System Stats',fn:scanScreen1},{id:'screen2',name:'NPU',fn:scanNpuScreen},{id:'screen5',name:'Clock',fn:scanScreen2}];
  else if (DISTRO_SCREENS[activeVariant]) screens = [{id:'screen1',name:'System Stats',fn:DISTRO_SCREENS[activeVariant]},{id:'screen2',name:'AI Monitor',fn:terminalScreen2}];
  else screens = [{id:'screen1',name:'System Stats',fn:terminalScreen1},{id:'screen2',name:'AI Monitor',fn:terminalScreen2}];
  screens.push({id:'screen3',name:'Claude Usage',fn:claudeScreen3});
  // Adaptive: the screen picks its own density from gpu.count, so a
  // single-card box and a four-card rig both read correctly with no
  // configuration. Switch it off in Settings on a machine with no GPU.
  const gpuFn = DISTRO_GPU_SCREENS[activeVariant] ? DISTRO_GPU_SCREENS[activeVariant]
              : isTeal ? sfDs9GpuScreen
              : isCoral ? sfTngGpuScreen
              : isVintage && activeVariant === 'Tubes' ? tubeGpuScreen
              : isVintage && activeVariant === 'VFD' ? vfdGpuScreen
              : isVintage ? scanGpuScreen
              : sfTosGpuScreen;
  screens.push({id:'screen4',name:'GPU',fn:gpuFn});
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
    return { id: s.id, name: s.name, fn: s.fn, duration: clampDuration((cfg && cfg.duration) || defaultDuration) };
  });
  if (list.length === 0) {
    // Fallback: show first screen if all disabled
    const s0 = allScreens[0];
    list = [{ id: s0.id, name: s0.name, fn: s0.fn, duration: clampDuration(defaultDuration) }];
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
    const [tr, mr, dr] = await Promise.all([
      fetch(API + '/api/themes'),
      fetch(API + '/api/metrics'),
      fetch(API + '/api/display'),
    ]);
    const themeData = await tr.json();
    metrics = await mr.json();
    const displayData = await dr.json();

    // Apply per-screen rotation config
    if (displayData.screen_rotation) screenRotation = displayData.screen_rotation;
    // Clamp: a 0/negative duration turns scheduleRotate() into a hot
    // setTimeout(0) loop that re-renders the whole screen continuously.
    if (typeof displayData.default_duration === 'number' && isFinite(displayData.default_duration)) {
      defaultDuration = clampDuration(displayData.default_duration);
    }

    const newFamily = themeData.active_family;
    const newVariant = themeData.active_variant;
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
  if (enabledScreens.length <= 1) return;
  const raw = (enabledScreens[currentScreenIdx] || {}).duration || defaultDuration;
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

/* ── Keyboard shortcuts ── */
document.addEventListener('keydown', (e) => {
  const n = enabledScreens.length || 1;
  if (e.key >= '1' && e.key <= '9') { currentScreenIdx = Math.min(parseInt(e.key) - 1, n - 1); pauseUntil = Date.now() + PAUSE_MS; lastRotate = Date.now(); renderDisplay(); scheduleRotate(); scheduleClockTick(); }
  else if (e.key === ' ') { e.preventDefault(); currentScreenIdx = (currentScreenIdx + 1) % n; pauseUntil = Date.now() + PAUSE_MS; lastRotate = Date.now(); renderDisplay(); scheduleRotate(); scheduleClockTick(); }
  else if (e.key === 'Escape') { window.close(); }
});

/* ── Start ── */
poll();
setInterval(poll, 2500);
</script>