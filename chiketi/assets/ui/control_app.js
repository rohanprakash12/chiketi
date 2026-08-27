<script>
const API = window.location.origin;
/* Optional shared secret, sent on every control POST. Harmless when the server
   has no token configured.

   Read from the URL FRAGMENT (#token=…) in preference to the query string, and
   stripped from the address bar immediately. A query string lands in browser
   history, in any screenshot of the address bar, and in the Referer header of
   anything the page later links to; a fragment is never sent to a server, and
   removing it stops it being bookmarked by accident. ?token=… is still read so
   existing links keep working. */
const TOKEN = (function () {
  var fromHash = new URLSearchParams(
    (window.location.hash || '').replace(/^#/, '')).get('token');
  var fromQuery = new URLSearchParams(window.location.search).get('token');
  var tok = fromHash || fromQuery;
  if (tok) {
    try {
      sessionStorage.setItem('chiketi.token', tok);
    } catch (e) { /* private mode: keep it in memory only */ }
    try {
      history.replaceState(null, '', window.location.pathname);
    } catch (e) { /* nothing else to do; the value is already in memory */ }
  }
  if (!tok) {
    try { tok = sessionStorage.getItem('chiketi.token'); } catch (e) { tok = null; }
  }
  return tok;
})();
function post(path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers['X-Chiketi-Token'] = TOKEN;
  return fetch(API + path, {
    method: 'POST', headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const PANEL_SPEC = __PANEL_SPEC_JSON__;
let currentData = null, metrics = null;
let selectedFamily = null, selectedVariant = null;

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

function switchTab(tab) {
  document.querySelectorAll('.main-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));
}

async function loadThemes() {
  try {
    const [tr, mr] = await Promise.all([
      fetch(API + '/api/themes'), fetch(API + '/api/metrics')
    ]);
    currentData = await tr.json();
    metrics = await mr.json();
    if (!selectedFamily) selectedFamily = currentData.active_family;
    if (!selectedVariant) selectedVariant = currentData.active_variant;
    renderCategoryDropdown();
    renderVariantRow();
    renderScreens();
    renderScreenRotationUI();
    setStatus('Connected', true);
  } catch(e) { setStatus('Connection failed', false); }
}

function renderCategoryDropdown() {
  const sel = document.getElementById('categorySelect');
  sel.innerHTML = '';
  for (const fam of Object.keys(currentData.families)) {
    const opt = document.createElement('option');
    opt.value = fam;
    opt.textContent = fam;
    if (fam === selectedFamily) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = () => {
    selectedFamily = sel.value;
    selectedVariant = Object.keys(currentData.families[selectedFamily])[0];
    renderVariantRow();
    renderScreens();
  };
}

function renderVariantRow() {
  const el = document.getElementById('variantRow'); el.innerHTML = '';
  const variants = currentData.families[selectedFamily] || {};
  const isActive = selectedFamily === currentData.active_family;
  for (const [name, c] of Object.entries(variants)) {
    const btn = document.createElement('button');
    const active = name === selectedVariant;
    const live = isActive && name === currentData.active_variant;
    btn.className = 'variant-btn' + (active ? ' active' : '');
    btn.style.borderColor = active ? c.primary : '#333';
    btn.style.color = active ? c.primary : '#888';
    btn.innerHTML = `<span class="variant-dot" style="background:${c.primary}"></span>${name}` +
      (live ? ' <span style="font-size:10px;color:#666">(live)</span>' : '');
    btn.onclick = () => {
      selectedVariant = name;
      selectTheme(selectedFamily, name);
      renderVariantRow();
      renderScreens();
    };
    el.appendChild(btn);
  }
}

/* ═══════════════════════════════════════
   Shared rendering helpers
   ═══════════════════════════════════════ */
__SHARED_HELPERS__
__SCREEN_FUNCTIONS__


function getScreenRegistry(c) {
  const isPanel = selectedFamily === 'Panel';
  const isVintage = selectedFamily === 'Vintage';
  const isCoral = isPanel && selectedVariant === 'Coral';
  const isTeal = isPanel && selectedVariant === 'Teal';
  let screens;
  if (isTeal) screens = [{id:'screen1',name:'System Stats',fn:panelTealScreen1},{id:'screen2',name:'Clock',fn:panelTealScreen2}];
  else if (isCoral) screens = [{id:'screen1',name:'System Stats',fn:panelCoralScreen1},{id:'screen2',name:'Clock',fn:panelCoralScreen2}];
  else if (isPanel) screens = [{id:'screen1',name:'System Stats',fn:panelGoldScreen1},{id:'screen2',name:'Clock',fn:panelGoldScreen2}];
  else if (isVintage && selectedVariant === 'Tubes') screens = [{id:'screen1',name:'System Stats',fn:tubeScreen1},{id:'screen2',name:'Clock',fn:tubeScreen2}];
  else if (isVintage && selectedVariant === 'VFD') screens = [{id:'screen1',name:'System Stats',fn:vfdScreen1},{id:'screen2',name:'Clock',fn:vfdScreen2}];
  else if (isVintage) screens = [{id:'screen1',name:'System Stats',fn:scanScreen1},{id:'screen2',name:'Clock',fn:scanScreen2}];
  else screens = [{id:'screen1',name:'System Stats',fn:terminalScreen1},{id:'screen2',name:'AI Monitor',fn:terminalScreen2}];
  screens.push({id:'screen3',name:'Claude Usage',fn:claudeScreen3});
  // Adaptive: the screen picks its own density from gpu.count, so a
  // single-card box and a four-card rig both read correctly with no
  // configuration. Switch it off in Settings on a machine with no GPU.
  const gpuFn = isTeal ? panelTealGpuScreen
              : isCoral ? panelCoralGpuScreen
              : isVintage && selectedVariant === 'Tubes' ? tubeGpuScreen
              : isVintage && selectedVariant === 'VFD' ? vfdGpuScreen
              : isVintage ? scanGpuScreen
              : panelGoldGpuScreen;
  screens.push({id:'screen4',name:'GPU',fn:gpuFn});
  return screens;
}

function renderScreens() {
  const el = document.getElementById('screens'); el.innerHTML = '';
  const c = (currentData.families[selectedFamily] || {})[selectedVariant];
  if (!c) return;
  const screens = getScreenRegistry(c);
  for (const s of screens) {
    const div = document.createElement('div');
    div.innerHTML = `<div class="screen-label">${s.name}</div>${s.fn(c)}`;
    el.appendChild(div);
  }
}

async function selectTheme(family, variant) {
  try {
    const res = await post('/api/theme/' + family + '/' + variant);
    if (res.ok) { await loadThemes(); setStatus('Theme: ' + family + '/' + variant, true); }
  } catch(e) { setStatus('Failed to set theme', false); }
}

function setStatus(msg, ok) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (ok ? ' ok' : '');
}

loadThemes();

// Settings
let _outputsCache = [];
async function loadSettings() {
  try {
    const res = await fetch(API + '/api/display?outputs=1');
    const data = await res.json();
    _outputsCache = (data.outputs || []).filter(o => o.connected);
    populateOutputs(_outputsCache, data.current_output);
    document.getElementById('brightnessSlider').value = data.brightness || 1.0;
    document.getElementById('brightnessVal').textContent = (data.brightness || 1.0).toFixed(1);
    _serverScreenRotation = data.screen_rotation || {};
    _serverDefaultDuration = data.default_duration || 10;
    renderScreenRotationUI();
    updatePowerToggle(data.display_on || false);
    updateResDisplay();
    updatePreviewAspectRatio(data.width || 1024, data.height || 600);
  } catch(e) {}
}
function populateOutputs(outputs, current) {
  const sel = document.getElementById('outputSelect');
  sel.innerHTML = '';
  outputs.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.name;
    opt.textContent = o.name + (o.resolution ? ' (' + o.resolution + ')' : '');
    if (o.name === current) opt.selected = true;
    sel.appendChild(opt);
  });
  updateResDisplay();
}
function getSelectedResolution() {
  const name = document.getElementById('outputSelect').value;
  const o = _outputsCache.find(x => x.name === name);
  return o && o.resolution ? o.resolution : null;
}
function updateResDisplay() {
  const res = getSelectedResolution();
  document.getElementById('resDisplay').textContent = res || 'auto';
}
function parseResolution(res) {
  if (!res) return null;
  const m = res.match(/^(\d+)x(\d+)/);
  return m ? { w: parseInt(m[1]), h: parseInt(m[2]) } : null;
}
let _serverScreenRotation = {};
let _serverDefaultDuration = 10;
function renderScreenRotationUI() {
  const el = document.getElementById('screenRotationList');
  el.innerHTML = '';
  const c = (currentData && currentData.families[selectedFamily] || {})[selectedVariant];
  if (!c) return;
  const screens = getScreenRegistry(c);
  for (const s of screens) {
    const cfg = _serverScreenRotation[s.id] || { enabled: true, duration: _serverDefaultDuration };
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:4px 0;min-height:44px';
    row.innerHTML =
      `<label style="display:flex;align-items:center;gap:10px;color:#ccc;flex:1;cursor:pointer;min-height:44px">` +
        `<input type="checkbox" data-screen="${s.id}" class="sr-enable" ${cfg.enabled ? 'checked' : ''} style="accent-color:#0f0;width:22px;height:22px;flex-shrink:0">` +
        `${s.name}` +
      `</label>` +
      `<input type="number" data-screen="${s.id}" class="sr-duration" value="${cfg.duration}" min="3" max="600" ` +
        `style="width:64px;min-height:44px;background:#111;border:1px solid #333;color:#0f0;padding:6px;border-radius:4px;font-size:14px;text-align:center">` +
      `<span style="color:#9aa0a6;font-size:12px">sec</span>`;
    el.appendChild(row);
  }
}
function getScreenRotationFromUI() {
  const result = {};
  document.querySelectorAll('.sr-enable').forEach(cb => {
    const id = cb.dataset.screen;
    const dur = document.querySelector(`.sr-duration[data-screen="${id}"]`);
    result[id] = { enabled: cb.checked, duration: parseInt(dur.value) || _serverDefaultDuration };
  });
  return result;
}
let _displayOn = false;
function updatePowerToggle(isOn) {
  _displayOn = isOn;
  const toggle = document.getElementById('powerToggle');
  const knob = toggle.firstElementChild;
  const label = document.getElementById('powerLabel');
  if (isOn) {
    toggle.style.background = '#00aa44';
    knob.style.left = '22px';
    knob.style.background = '#fff';
    label.textContent = 'ON';
    label.style.color = '#00ff41';
  } else {
    toggle.style.background = '#333';
    knob.style.left = '2px';
    knob.style.background = '#888';
    label.textContent = 'OFF';
    label.style.color = '#888';
  }
}
document.getElementById('powerToggle').addEventListener('click', async function() {
  const newState = !_displayOn;
  try {
    const res = await post('/api/display', { display_on: newState });
    if (res.ok) {
      const data = await res.json();
      updatePowerToggle(data.display_on);
    }
  } catch(e) {}
});
function updatePreviewAspectRatio(w, h) {
  document.querySelectorAll('.screen-frame').forEach(f => {
    f.style.aspectRatio = w + ' / ' + h;
  });
}
document.getElementById('outputSelect').addEventListener('change', updateResDisplay);
document.getElementById('brightnessSlider').addEventListener('input', function() {
  document.getElementById('brightnessVal').textContent = parseFloat(this.value).toFixed(1);
});
document.getElementById('scanDisplays').addEventListener('click', async function() {
  try {
    const res = await fetch(API + '/api/display?outputs=1&refresh=1');
    const data = await res.json();
    _outputsCache = (data.outputs || []).filter(o => o.connected);
    populateOutputs(_outputsCache, data.current_output);
    document.getElementById('settingsStatus').textContent = 'Scanned ' + _outputsCache.length + ' connected';
    document.getElementById('settingsStatus').style.color = '#00ff41';
  } catch(e) {}
});
document.getElementById('applySettings').addEventListener('click', async function() {
  const dims = parseResolution(getSelectedResolution());
  const body = {
    output: document.getElementById('outputSelect').value,
    brightness: parseFloat(document.getElementById('brightnessSlider').value),
    screen_rotation: getScreenRotationFromUI(),
  };
  if (dims) { body.width = dims.w; body.height = dims.h; }
  try {
    const res = await post('/api/display', body);
    if (res.ok) {
      const data = await res.json();
      updatePreviewAspectRatio(data.width, data.height);
      const failed = data.applied === false;
      document.getElementById('settingsStatus').textContent =
        failed ? 'Saved, but display change failed' : 'Settings applied';
      document.getElementById('settingsStatus').style.color = failed ? '#ffaa00' : '#00ff41';
    } else {
      document.getElementById('settingsStatus').textContent = 'Failed to apply';
      document.getElementById('settingsStatus').style.color = '#ff4444';
    }
  } catch(e) {
    document.getElementById('settingsStatus').textContent = 'Error';
    document.getElementById('settingsStatus').style.color = '#ff4444';
  }
});
loadSettings();

// Refresh metrics every 3 seconds
setInterval(async () => {
  try {
    const res = await fetch(API + '/api/metrics');
    metrics = await res.json();
    renderScreens();
  } catch(e) {}
}, 3000);
</script>