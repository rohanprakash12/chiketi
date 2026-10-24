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
const SCREEN_SPEC = __SCREEN_SPEC_JSON__;   // assets/ui/screens.json
let currentData = null, metrics = null;
let selectedFamily = null, selectedVariant = null;
/* The display this panel is editing: '' = the house defaults (server-wide). */
let selectedDevice = '';
let devices = { devices: [], pending: [], now: 0 };
/* Which house theme the picker sets with no display selected: 'self' is the
   house theme proper, 'kiosk' the Kiosk displays' (POST /api/kiosk-theme). */
let houseMode = 'self';
/* The selected display's screens being edited: [{id, on}] in display order,
   and the server state it was built from (device id|mode|screens), so a
   refresh only replaces an edit when that display changed on the server. */
let pick = null, pickBase = null;
let activeFamily = null;   // kioskNotice() picks its skin from it in the previews

function ago(t, now) {
  if (!t) return 'never seen';
  const s = Math.max(0, Math.round(now - t));
  if (s > 120) return 'offline';
  return s + ' s ago';
}
function currentDevice() {
  return devices.devices.find(d => d.id === selectedDevice) || null;
}
/* Device lists are numbered: one that arrives after a newer one is dropped,
   or it would put back old screens and throw away the edit in progress. */
let devicesSeq = 0, devicesApplied = 0;
async function loadDevices() {
  const seq = ++devicesSeq;
  let got;
  try {
    got = await (await fetch(API + '/api/devices')).json();
  } catch (e) { return; }
  if (seq < devicesApplied) return;
  devicesApplied = seq;
  devices = got;
  if (selectedDevice && !currentDevice()) {
    // Forgotten elsewhere: drop back to the house scope everywhere, so no
    // control keeps writing to a device that no longer exists.
    selectedDevice = '';
    applyDeviceScope();
    return;
  }
  renderDeviceBar();
  const d = currentDevice();
  if (!currentData) return;
  // Mode or screens changed on the server (elsewhere, or just now by this
  // panel): rebuild the display's card from the server.
  if (d && pickKey(d) !== pickBase) { applyDeviceScope(); return; }
  // Keep "(live)" current, but redraw only when it moved: replacing the
  // buttons every poll would steal keyboard focus.
  if (selectedDevice && liveThemeKey() !== lastLiveKey) renderVariantRow();
}
let lastLiveKey = null;
function renderDeviceBar() {
  const sel = document.getElementById('deviceSelect');
  const opts = [['', 'House defaults (all displays)']].concat(
    devices.devices.map(d => [d.id, d.name + ' · ' + ago(d.last_seen, devices.now)]));
  // Rebuilding the options closes a drop-down the user has open, so only
  // rebuild when something in it changed.
  const html = opts.map(([v, t]) =>
    `<option value="${esc(v)}"${v === selectedDevice ? ' selected' : ''}>${esc(t)}</option>`).join('');
  if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; }
  if (sel.value !== selectedDevice) sel.value = selectedDevice;
  sel.onchange = () => { selectedDevice = sel.value; applyDeviceScope(); };
  const d = currentDevice();
  const caps = d ? d.caps || {} : {};
  document.getElementById('deviceInfo').textContent = d
    ? `${d.id} · ${caps.w || '?'}×${caps.h || '?'} · ${caps.touch ? 'touch' : 'no touch'} · ${d.addr || ''}`
    : 'Theme and rotation for displays that have no setting of their own';
  document.getElementById('renameDevice').hidden = !d;
  document.getElementById('forgetDevice').hidden = !d;
  const pend = document.getElementById('pendingList');
  pend.innerHTML = devices.pending.map(p => {
    const c = p.caps || {};
    return `<div class="pending-card" data-id="${esc(p.id)}">` +
      `<span class="code">${esc(p.code.slice(0, 2) + '-' + p.code.slice(2))}</span>` +
      `<span>New display · ${esc(p.addr)} · ${c.w || '?'}×${c.h || '?'} · ` +
      `${c.touch ? 'touch' : 'no touch'} · ${esc(c.browser || '')}${c.feed === 'picture' ? ' · picture feed' : ''}</span>` +
      `<button class="setting-btn" data-act="approve">Approve</button>` +
      `<button class="setting-btn" data-act="reject">Reject</button></div>`;
  }).join('');
  pend.querySelectorAll('button').forEach(b => {
    b.onclick = async () => {
      const id = b.closest('.pending-card').dataset.id;
      if (b.dataset.act === 'approve') {
        const name = prompt('Name this display (code on screen must match):');
        if (!name) return;
        await post(`/api/devices/${id}/approve`, { name });
        selectedDevice = id;
      } else {
        await post(`/api/devices/${id}/reject`, {});
      }
      await loadDevices();
      applyDeviceScope();
    };
  });
}
/* Point the theme picker, preview shape and display settings at the selection. */
function applyDeviceScope() {
  const d = currentDevice();
  document.getElementById('deviceSettings').hidden = !d;
  document.getElementById('houseModeRow').hidden = !!d;
  if (!currentData) { renderDeviceBar(); return; }
  // Rebuild the card from the server only for a different display or when its
  // mode or screens changed there; a theme change keeps unsaved edits.
  const fresh = !d || !pick || pickKey(d) !== pickBase;
  if (d && fresh) {
    document.getElementById('devAutoRotate').checked = d.auto_rotate;
    document.getElementById('devSeconds').value = d.seconds;
    document.getElementById('devGear').checked = d.gear;
    const radio = document.querySelector('input[name=devMode][value="' + d.mode + '"]');
    if (radio) radio.checked = true;
    pick = pickFrom(d);
    pickBase = pickKey(d);
    if (d.caps && d.caps.w && d.caps.h) updatePreviewAspectRatio(d.caps.w, d.caps.h);
  } else if (!d) {
    pick = null;
    pickBase = null;
    loadSettings();
  }
  const fv = liveThemeKey().split('/');
  selectedFamily = fv[0]; selectedVariant = fv[1];
  renderDeviceBar();
  renderCategoryDropdown(); renderVariantRow(); renderScreens(); renderPick();
}

/* ── Modes: what the selection may show ── */
function scopeMode() { const d = currentDevice(); return d ? d.mode : houseMode; }
function houseThemeKey(mode) {
  return mode === 'kiosk' ? currentData.kiosk_theme : currentData.active_family + '/' + currentData.active_variant;
}
/* The theme the selection actually shows (the display's own rules). */
function liveThemeKey() {
  const d = currentDevice(), mode = scopeMode();
  if (d && d.theme && themeAllowed(mode, d.theme)) return d.theme;
  const h = houseThemeKey(mode);
  return themeAllowed(mode, h) ? h : SCREEN_SPEC.modes[mode].default_theme;
}
function allowedVariants(fam) {
  return Object.keys(currentData.families[fam] || {}).filter(function (v) { return themeAllowed(scopeMode(), fam + '/' + v); });
}
function pickKey(d) { return d.id + '|' + d.mode + '|' + d.screens.join(); }
/* Ticked screens first in the display's order, then the rest in set order. */
function pickFrom(d) {
  const all = SCREEN_SPEC.modes[d.mode].screens;
  const on = d.screens.filter(function (id) { return all.indexOf(id) !== -1; });
  return on.map(function (id) { return { id: id, on: true }; })
    .concat(all.filter(function (id) { return on.indexOf(id) === -1; }).map(function (id) { return { id: id, on: false }; }));
}
function pickedIds() { return pick ? pick.filter(function (p) { return p.on; }).map(function (p) { return p.id; }) : null; }
function screenStatus(id) {
  const s = SCREEN_SPEC.screens[id];
  if (!s.built) return 'coming soon';
  if (!screenReady(id)) return 'not set up';
  if (!screenRenderer(id, selectedFamily, selectedVariant)) return 'not in this theme';
  return 'ready';
}
function renderPick() {
  const box = document.getElementById('devScreens');
  const warnBox = document.getElementById('devWarn');
  const d = currentDevice();
  if (!d || !pick) { box.innerHTML = ''; warnBox.textContent = ''; return; }
  box.innerHTML = pick.map(function (p, i) {
    return `<div class="pick-row" data-id="${esc(p.id)}"><label><input type="checkbox" class="pick-on"${p.on ? ' checked' : ''}> ` +
      `${esc(SCREEN_SPEC.screens[p.id].name)}</label><span class="pick-status">${screenStatus(p.id)}</span>` +
      `<button class="setting-btn pick-up" aria-label="Move up"${i ? '' : ' disabled'}>↑</button>` +
      `<button class="setting-btn pick-down" aria-label="Move down"${i < pick.length - 1 ? '' : ' disabled'}>↓</button></div>`;
  }).join('');
  box.querySelectorAll('.pick-row').forEach(function (row, i) {
    row.querySelector('.pick-on').onchange = function (e) { pick[i].on = e.target.checked; pickChanged(); };
    row.querySelector('.pick-up').onclick = function () { pick.splice(i - 1, 0, pick.splice(i, 1)[0]); pickChanged(); };
    row.querySelector('.pick-down').onclick = function () { pick.splice(i + 1, 0, pick.splice(i, 1)[0]); pickChanged(); };
  });
  renderPickWarnings();
}
/* Statuses and warnings follow the metrics (a feed comes up, a config appears).
   Text only: rebuilding the rows every refresh would steal focus mid-click. */
function refreshPickStatus() {
  if (!pick || !currentDevice()) return;
  document.querySelectorAll('#devScreens .pick-row').forEach(function (row) {
    const st = row.querySelector('.pick-status');
    const want = screenStatus(row.dataset.id);
    if (st.textContent !== want) st.textContent = want;
  });
  renderPickWarnings();
}
function renderPickWarnings() {
  const d = currentDevice();
  const warnBox = document.getElementById('devWarn');
  if (!d || !pick) { warnBox.textContent = ''; return; }
  const warn = [];
  const plan = screenPlan({ mode: d.mode, screens: pickedIds(), family: selectedFamily, variant: selectedVariant });
  if (d.mode === 'kiosk' && d.caps && d.caps.layout === 'strip' && pickedIds().length > 5) {
    warn.push('The side column fits 5 at full size; icons will shrink.');
  }
  if (plan.empty) warn.push("This display will show 'No screens to show'.");
  const text = warn.join(' ');
  if (warnBox.textContent !== text) warnBox.textContent = text;
}
function pickChanged() { renderPick(); renderScreens(); }

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
    if (!selectedFamily) {
      const fv = liveThemeKey().split('/');
      selectedFamily = fv[0]; selectedVariant = fv[1];
    }
    renderCategoryDropdown();
    renderVariantRow();
    renderScreens();
    setStatus('Connected', true);
  } catch(e) { setStatus('Connection failed', false); }
}

function renderCategoryDropdown() {
  const sel = document.getElementById('categorySelect');
  sel.innerHTML = '';
  // Only the families with a theme this selection's mode allows.
  const fams = Object.keys(currentData.families).filter(function (f) { return allowedVariants(f).length; });
  if (fams.indexOf(selectedFamily) === -1) {
    selectedFamily = fams[0];
    selectedVariant = allowedVariants(fams[0])[0];
  }
  for (const fam of fams) {
    const opt = document.createElement('option');
    opt.value = fam;
    opt.textContent = fam;
    if (fam === selectedFamily) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = () => {
    selectedFamily = sel.value;
    selectedVariant = allowedVariants(selectedFamily)[0];
    renderVariantRow();
    renderScreens();
  };
}

function renderVariantRow() {
  const el = document.getElementById('variantRow'); el.innerHTML = '';
  lastLiveKey = liveThemeKey();   // what this drawing shows
  const variants = currentData.families[selectedFamily] || {};
  const liveKey = lastLiveKey;
  for (const name of allowedVariants(selectedFamily)) {
    const c = variants[name];
    const btn = document.createElement('button');
    const active = name === selectedVariant;
    const live = liveKey === selectedFamily + '/' + name;
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
  if (currentDevice()) {
    const hb = document.createElement('button');
    hb.className = 'variant-btn' + (currentDevice().theme ? '' : ' active');
    hb.textContent = 'House theme';
    hb.onclick = async () => {
      await post(`/api/devices/${selectedDevice}`, { theme: '' });
      await loadDevices(); applyDeviceScope();
    };
    el.appendChild(hb);
  }
  renderPick();   // the screens' statuses depend on the theme
}

/* ═══════════════════════════════════════
   Shared rendering helpers
   ═══════════════════════════════════════ */
__SHARED_HELPERS__
__SCREEN_FUNCTIONS__


/* Previews: what the selection would show, from the same plan as the display
   (the display's draft screens, or the whole set of the house mode). */
const NOTICE = { id: 'none', name: 'No screens', fn: kioskNotice, fluid: true };
function renderScreens() {
  const el = document.getElementById('screens'); el.innerHTML = '';
  const c = (currentData.families[selectedFamily] || {})[selectedVariant];
  if (!c) return;
  const mode = scopeMode();
  const d = currentDevice();
  const plan = screenPlan({ mode: mode, screens: d ? pickedIds() : SCREEN_SPEC.modes[mode].screens,
                            family: selectedFamily, variant: selectedVariant });
  activeFamily = selectedFamily;
  for (const s of (plan.empty ? [NOTICE] : plan.list)) {
    setTabPlan(plan.mode === 'kiosk' ? plan.tabs : null);
    const div = document.createElement('div');
    div.innerHTML = `<div class="screen-label">${esc(s.name)}</div>${s.fn(c)}`;
    el.appendChild(div);
  }
  setTabPlan(null);
  applyPreviewAspect();
}

async function selectTheme(family, variant) {
  try {
    const key = family + '/' + variant;
    const res = selectedDevice ? await post(`/api/devices/${selectedDevice}`, { theme: key })
      : houseMode === 'kiosk' ? await post('/api/kiosk-theme/' + key)
      : await post('/api/theme/' + key);
    if (res.ok) {
      if (selectedDevice) await loadDevices(); else await loadThemes();
      setStatus((selectedDevice ? currentDevice().name : houseMode === 'kiosk' ? 'Kiosk house' : 'House') +
        ' theme: ' + family + '/' + variant, true);
    }
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
/* Fluid screens take the controlled display's shape; fixed screens stay
   1024/600, exactly as the kiosk letterboxes them. */
function applyPreviewAspect() {
  document.querySelectorAll('.screen-frame').forEach(f => {
    f.style.aspectRatio = f.classList.contains('fluid') ? '1024 / ' + frameH() : '1024 / 600';
  });
}
function updatePreviewAspectRatio(w, h) {
  const before = frameH();
  setFrameH(1024 * (Number(h) || 600) / (Number(w) || 1024));
  if (frameH() !== before) renderScreens(); else applyPreviewAspect();
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
    refreshPickStatus();
  } catch(e) {}
}, 3000);
document.getElementById('devSave').addEventListener('click', async () => {
  const body = {
    auto_rotate: document.getElementById('devAutoRotate').checked,
    seconds: parseInt(document.getElementById('devSeconds').value, 10) || 30,
    gear: document.getElementById('devGear').checked,
    screens: pickedIds(),
  };
  const res = await post(`/api/devices/${selectedDevice}`, body);
  document.getElementById('devStatus').textContent = res.ok ? 'Saved' : 'Failed to save';
  await loadDevices();
});
document.querySelectorAll('input[name=devMode]').forEach(function (r) {
  r.addEventListener('change', async function () {
    if (!selectedDevice) return;
    const res = await post(`/api/devices/${selectedDevice}`, { mode: r.value });
    document.getElementById('devStatus').textContent = res.ok ? 'Mode: ' + r.value : 'Failed to change mode';
    await loadDevices(); applyDeviceScope();
  });
});
document.querySelectorAll('input[name=houseMode]').forEach(function (r) {
  r.addEventListener('change', function () { houseMode = r.value; applyDeviceScope(); });
});
document.getElementById('renameDevice').addEventListener('click', async () => {
  const d = currentDevice(); if (!d) return;
  const name = prompt('New name for ' + d.name + ':', d.name);
  if (!name) return;
  await post(`/api/devices/${d.id}`, { name });
  await loadDevices();
});
document.getElementById('forgetDevice').addEventListener('click', async () => {
  const d = currentDevice(); if (!d) return;
  if (!confirm(`Forget ${d.name}? It will show a new pairing code.`)) return;
  await post(`/api/devices/${d.id}/forget`, {});
  selectedDevice = '';
  await loadDevices(); applyDeviceScope();
});
loadDevices();
setInterval(loadDevices, 3000);
</script>
