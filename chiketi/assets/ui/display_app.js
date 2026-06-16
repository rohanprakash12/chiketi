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

/* ── Data helpers ── */
function m(key) {
  if (!metrics || !metrics[key]) return { value: null, available: false, unit: '', extra: {} };
  return metrics[key];
}
function mv(key, suffix) {
  const d = m(key);
  if (!d.available) return 'N/A';
  return suffix ? d.value + suffix : String(d.value);
}

function cleanModel() {
  const d = m('llama.model');
  if (!d.available) return '--';
  return String(d.value).replace(/\.gguf$/i, '').replace(/[-_]Q\d[A-Z0-9_]*$/i, '').replace(/_/g, ' ').replace(/-$/, '');
}

/* ── Shared rendering helpers ── */
__SHARED_HELPERS__
/* ═══ Screen renderers (identical to control panel) ═══ */

__SCREEN_FUNCTIONS__

/* ── Screen registry for current theme ── */
function getScreenRegistry(c) {
  const isPanel = activeFamily === 'Panel';
  const isVintage = activeFamily === 'Vintage';
  const isCoral = isPanel && activeVariant === 'Coral';
  const isTeal = isPanel && activeVariant === 'Teal';
  let screens;
  if (isTeal) screens = [{id:'screen1',name:'System Stats',fn:panelTealScreen1},{id:'screen2',name:'Clock',fn:panelTealScreen2}];
  else if (isCoral) screens = [{id:'screen1',name:'System Stats',fn:panelCoralScreen1},{id:'screen2',name:'Clock',fn:panelCoralScreen2}];
  else if (isPanel) screens = [{id:'screen1',name:'System Stats',fn:panelGoldScreen1},{id:'screen2',name:'Clock',fn:panelGoldScreen2}];
  else if (isVintage && activeVariant === 'Tubes') screens = [{id:'screen1',name:'System Stats',fn:tubeScreen1},{id:'screen2',name:'Clock',fn:tubeScreen2}];
  else if (isVintage && activeVariant === 'VFD') screens = [{id:'screen1',name:'System Stats',fn:vfdScreen1},{id:'screen2',name:'Clock',fn:vfdScreen2}];
  else if (isVintage) screens = [{id:'screen1',name:'System Stats',fn:scanScreen1},{id:'screen2',name:'Clock',fn:scanScreen2}];
  else screens = [{id:'screen1',name:'System Stats',fn:terminalScreen1},{id:'screen2',name:'AI Monitor',fn:terminalScreen2}];
  screens.push({id:'screen3',name:'Claude Usage',fn:claudeScreen3});
  return screens;
}

function renderDisplay() {
  if (!themeColors || !activeFamily) return;
  const c = themeColors;
  const allScreens = getScreenRegistry(c);
  // Filter to enabled screens
  enabledScreens = allScreens.filter(s => {
    const cfg = screenRotation[s.id];
    return !cfg || cfg.enabled !== false;
  }).map(s => {
    const cfg = screenRotation[s.id];
    return { id: s.id, name: s.name, html: s.fn(c), duration: (cfg && cfg.duration) || 10 };
  });
  if (enabledScreens.length === 0) {
    // Fallback: show first screen if all disabled
    enabledScreens = [{ id: allScreens[0].id, name: allScreens[0].name, html: allScreens[0].fn(c), duration: 10 }];
  }
  if (currentScreenIdx >= enabledScreens.length) currentScreenIdx = 0;
  document.getElementById('display').innerHTML = enabledScreens[currentScreenIdx].html;
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
  } catch(e) { /* retry next poll */ }
}

/* ── Auto-rotate (per-screen durations) ── */
function tick() {
  const now = Date.now();
  if (enabledScreens.length > 1 && now > pauseUntil) {
    const currentDuration = (enabledScreens[currentScreenIdx] || {}).duration || 10;
    if (now - lastRotate >= currentDuration * 1000) {
      currentScreenIdx = (currentScreenIdx + 1) % enabledScreens.length;
      lastRotate = now;
      renderDisplay();
    }
  }
  requestAnimationFrame(tick);
}

/* ── Keyboard shortcuts ── */
document.addEventListener('keydown', (e) => {
  const n = enabledScreens.length || 1;
  if (e.key >= '1' && e.key <= '9') { currentScreenIdx = Math.min(parseInt(e.key) - 1, n - 1); pauseUntil = Date.now() + PAUSE_MS; lastRotate = Date.now(); renderDisplay(); }
  else if (e.key === ' ') { e.preventDefault(); currentScreenIdx = (currentScreenIdx + 1) % n; pauseUntil = Date.now() + PAUSE_MS; lastRotate = Date.now(); renderDisplay(); }
  else if (e.key === 'Escape') { window.close(); }
});

/* ── Start ── */
poll();
setInterval(poll, 2500);
requestAnimationFrame(tick);
</script>