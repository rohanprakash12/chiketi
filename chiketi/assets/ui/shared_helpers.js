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
