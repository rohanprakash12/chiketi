/* Escape dynamic metric text before it lands in an innerHTML template.
   Metrics come from local telemetry (hostname, model/process names), so this
   is defense-in-depth against a stray '<' breaking the layout. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function tBar(c, pct) {
  if (pct == null) return '';
  pct = Math.max(0, Math.min(100, pct));
  const filled = Math.round(pct / 5), empty = 20 - filled;
  return `<span class="t-bar"><span style="color:${c.primary}">${'\u2588'.repeat(filled)}</span><span style="color:${c.primary};opacity:0.2">${'\u2591'.repeat(empty)}</span></span>`;
}
function tPanel(c, title, rows) {
  return `<div class="t-panel" style="background:${c.panel};border:1px solid ${c.border}">` +
    `<div class="t-title" style="color:${c.header}">\u2500\u2500[ ${title} ]</div>${rows}</div>`;
}
function tRow(c, label, bar, val, color) {
  color = color || c.primary;
  return `<div class="t-row"><span class="t-label" style="color:${c.primary}">${label}</span>` +
    (bar || '') + `<span class="t-val" style="color:${color}">${val}</span></div>`;
}

const GOLD = PANEL_SPEC.colors.gold;
const AMBER = PANEL_SPEC.colors.amber;
const GREEN = PANEL_SPEC.colors.green;
const TEAL = PANEL_SPEC.colors.teal;
function _thermColor(t) {
  if (t >= 90) return PANEL_SPEC.colors.thermOrange || '#FF7700';
  if (t >= 70) return PANEL_SPEC.colors.thermYellow || '#DDCC00';
  if (t >= 50) return PANEL_SPEC.colors.thermGreen || '#22BB44';
  return PANEL_SPEC.colors.thermBlue || '#2288DD';
}
function lPanel(titleLeft, color, body, titleRight) {
  const right = titleRight ? `<span>${titleRight}</span>` : '';
  return `<div class="l-panel" style="border:2px solid ${color}">` +
    `<div class="l-titlebar" style="background:${color};display:flex;justify-content:space-between;align-items:center">`+
    `<span>${titleLeft}</span>${right}</div>` +
    `<div class="l-body">${body}</div></div>`;
}
function lStat(label, val, color) {
  return `<div class="l-stat"><span class="l-stat-label">${label}</span>` +
    `<span class="l-stat-val" style="color:${color}">${val}</span></div>`;
}
function lBar(color, pct) {
  if (pct == null) return '';
  return `<div class="l-bar"><div class="l-bar-fill" style="width:${Math.max(0,Math.min(100,pct))}%;background:${color}"></div></div>`;
}

/* Format a disk capacity metric for display, honouring the unit the collector
   chose. disk.py emits TiB for volumes >= 1 TiB and GiB below that, so a
   renderer that assumes one or the other is wrong half the time.
   Returns e.g. "1.2T", "300G", or "?" when unavailable. */
function fmtCapacity(d) {
  if (!d || !d.available || d.value == null || isNaN(d.value)) return '?';
  const unit = String(d.unit || 'GiB');
  let tib;
  if (unit === 'TiB') tib = Number(d.value);
  else if (unit === 'MiB') tib = Number(d.value) / (1024 * 1024);
  else tib = Number(d.value) / 1024;          // GiB, the collector's default
  if (tib >= 1) return tib.toFixed(1) + 'T';
  const gib = tib * 1024;
  if (gib >= 1) return Math.round(gib) + 'G';
  return Math.round(gib * 1024) + 'M';
}

/* Same, for the `extra.total` companion field, which carries no unit of its
   own -- it is always in the same unit as its parent metric. */
function fmtCapacityTotal(d) {
  if (!d || !d.available || !d.extra || d.extra.total == null) return '?';
  return fmtCapacity({ available: true, value: d.extra.total, unit: d.unit });
}

/* Coerce a list-valued metric to a real array. A metric flagged available is
   not a promise that it carries a list -- a collector that returns None for a
   field it normally fills would otherwise crash the renderer on `.length`. */
function asList(d) {
  return (d && d.available && Array.isArray(d.value)) ? d.value : [];
}

/* ── Frame model ─────────────────────────────────────────────────────────
 * The frame is always 1024 units wide; its height follows the real screen
 * (683 on a 3:2 Surface Go, 576 at 16:9). display_app.js / control_app.js set
 * it from the screen being drawn; the harness sets it per run.
 *
 * Layout classes are the extension point for screens of other shapes:
 * 'landscape' (aspect 1.33-1.78) and 'strip' (3:1 and wider). A screen with
 * no layout for the shape falls back to the landscape one, clamped and
 * centred -- never cropped. */
let FRAME_H = 600;
const LANDSCAPE_MIN_H = 576, LANDSCAPE_MAX_H = 770;
function setFrameH(h) {
  const n = Number(h);
  FRAME_H = (isFinite(n) && n >= 100 && n <= 4000) ? Math.round(n) : 600;
}
/* 'strip': bar displays of 3:1 and wider, e.g. a 1920x462 LCD (246 units). */
const STRIP_MAX_H = 341;
function layoutClass() {
  if (FRAME_H >= LANDSCAPE_MIN_H && FRAME_H <= LANDSCAPE_MAX_H) return 'landscape';
  return FRAME_H <= STRIP_MAX_H ? 'strip' : 'other';
}
/* Read access for code outside this file's scope (the harness evals it). */
function frameH() { return FRAME_H; }
function fluidH() { return Math.max(LANDSCAPE_MIN_H, Math.min(LANDSCAPE_MAX_H, FRAME_H)); }
