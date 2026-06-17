# chiketi Family Site — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Plan location note:** brainstorming default is `docs/superpowers/plans/`, but `docs/` is the GitHub Pages root here, so this plan lives in `plans/`.

**Goal:** Build a single-page static site for the chiketi monitoring family with an interactive, theme-switchable dashboard hero "mounted in hardware", replacing `chiketi/docs/index.html`.

**Architecture:** Vanilla HTML/CSS/JS, no build step. A frozen data snapshot (`data.js`) plus the product's own renderers (`shared_helpers.js` + `screen_functions.js`) bundled into `dashboard.js` let the page render any of the 12 themes client-side with no server. A small shim drives a chosen theme into a DOM node; the hero and gallery reuse it.

**Tech Stack:** HTML/CSS/JS (no framework, no bundler), Python (one generator script), headless chromium (verification).

**Spec:** `chiketi/specs/2026-06-16-chiketi-site-design.md`

---

## File Structure

```
chiketi/
  scripts/gen_site_assets.py     # CREATE — generates data.js + dashboard.js from the product
  docs/
    index.html                   # REPLACE at the end (new site)
    index-legacy.html            # CREATE — preserved copy of the current landing
    site/
      site.css                   # CREATE — all site styling (chassis, sections, responsive)
      data.js                    # GENERATED — window.PANEL_SPEC / SITE_METRICS / SITE_THEMES
      dashboard.js               # GENERATED — shared_helpers + screen_functions + render shim
      site.js                    # CREATE — theme switcher, install tabs, nav behavior
```

Source of truth for the renderers stays `chiketi/assets/ui/`; `dashboard.js` is regenerated from it, never hand-edited.

## Verification model

This is a static visual site with no unit-test framework, so each task's "test" is an **observable check**: serve the dir and screenshot with headless chromium, or `curl` a file. Reuse this recipe throughout:

```bash
# serve docs/ on a free port (run once per verification; kill after)
cd /home/rohan/projects/chiketi/docs && python3 -m http.server 8801 >/tmp/site.log 2>&1 &
# screenshot (snap chromium: output MUST be a non-hidden home dir)
/usr/bin/chromium-browser --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1440,2400 --virtual-time-budget=4000 \
  --screenshot=/home/rohan/chiketi_shots/site_<name>.png "http://127.0.0.1:8801/index.html"
# free the port by number (never `pkill -f http.server` — it self-matches the shell)
fuser -k 8801/tcp 2>/dev/null
```

---

### Task 1: Scaffold + preserve the legacy page

**Files:**
- Create: `chiketi/docs/index-legacy.html` (copy of current `docs/index.html`)
- Create: `chiketi/docs/site/site.css` (empty placeholder ok this task)
- Create: `chiketi/docs/site/site.js` (empty placeholder ok this task)
- Create: `chiketi/docs/site-dev.html` (the working page during the build; promoted to index.html in the final task)

- [ ] **Step 1: Preserve the current landing**

```bash
cd /home/rohan/projects/chiketi
cp docs/index.html docs/index-legacy.html
```

- [ ] **Step 2: Create the working page skeleton** `docs/site-dev.html`

```html
<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>chiketi — retro system monitor</title>
<link rel="stylesheet" href="site/site.css">
</head><body>
<div id="app"><!-- sections injected by build tasks --></div>
<script src="site/data.js"></script>
<script src="site/dashboard.js"></script>
<script src="site/site.js"></script>
</body></html>
```

- [ ] **Step 3: Verify it serves**

```bash
cd /home/rohan/projects/chiketi/docs && python3 -m http.server 8801 >/tmp/site.log 2>&1 &
sleep 1; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8801/site-dev.html; fuser -k 8801/tcp 2>/dev/null
```
Expected: `200`

- [ ] **Step 4: Commit**

```bash
git add docs/index-legacy.html docs/site-dev.html docs/site/site.css docs/site/site.js
git commit -m "chore(site): scaffold new site + preserve legacy landing"
```

---

### Task 2: Generate the frozen data + bundled renderer

The page needs three frozen JSON blobs and the product's renderers bundled with a shim. One Python script produces both `data.js` and `dashboard.js` so they stay single-sourced from `chiketi/assets/ui/` and the product modules.

**Files:**
- Create: `chiketi/scripts/gen_site_assets.py`
- Generates: `chiketi/docs/site/data.js`, `chiketi/docs/site/dashboard.js`

- [ ] **Step 1: Write the generator** `chiketi/scripts/gen_site_assets.py`

```python
"""Generate docs/site/data.js and docs/site/dashboard.js from the product.
Frozen snapshot — re-run when themes/panel_spec/renderers change.
Run: chiketi/.venv/bin/python scripts/gen_site_assets.py
"""
import json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from chiketi.panel_spec import web_spec
from chiketi.themes import get_families, get_active_family, get_active_theme

UI = ROOT / "chiketi" / "assets" / "ui"
OUT = ROOT / "docs" / "site"
OUT.mkdir(parents=True, exist_ok=True)

# --- 1. theme palettes: same shape as server.py /api/themes ---
THEME_FIELDS = ("primary","accent","background","panel","border","header","dim","critical")
families = {
    fam: {t.name: {f: getattr(t, f) for f in THEME_FIELDS} for t in themes}
    for fam, themes in get_families().items()
}
themes_blob = {"active_family": get_active_family(),
               "active_variant": get_active_theme().name,
               "families": families}

# --- 2. a curated demo metrics snapshot (nice-looking, not this machine) ---
def mval(value, unit="", extra=None, available=True):
    return {"value": value, "unit": unit, "available": available, "extra": extra or {}}
metrics = {
    "cpu.usage": mval(37, "%"), "cpu.per_core": mval([41,28,55,33,22,60,18,44]),
    "cpu.temp": mval(42), "cpu.mb_temp": mval(38), "cpu.fan": mval(1200),
    "cpu.fan_count": mval(2), "cpu.fans_cpu": mval([1200]), "cpu.fans_case": mval([900,950]),
    "mem.ram_used": mval(28.9, extra={"total":62.5,"percent":46}), "mem.ram_total": mval(62.5),
    "mem.ram_percent": mval(46, "%"), "mem.swap_used": mval(0, extra={"total":8,"percent":0}),
    "mem.swap_total": mval(8), "mem.swap_percent": mval(0, "%"),
    "disk.root_used": mval(0.41, extra={"total":1.0,"percent":41}), "disk.root_total": mval(1.0),
    "disk.root_percent": mval(41, "%"), "disk.home_used": mval(0, extra={"total":0}),
    "disk.home_percent": mval(0, "%"),
    "net.ip": mval("192.168.16.157"), "net.mac": mval("e8:9c:25:47:97:b6"),
    "net.speed": mval(1000), "net.dl": mval(2.7, "KB/s", {"raw_bytes_per_sec":2700}),
    "net.ul": mval(538.4, "KB/s", {"raw_bytes_per_sec":538400}),
    "sys.hostname": mval("mycroft"), "sys.uptime": mval("49d 2h 40m", extra={"seconds":4244400}),
    "gpu.name": mval("RTX 3090 Ti"), "gpu.temp": mval(50), "gpu.fan": mval(0),
    "gpu.power": mval(20, extra={"limit":450}), "gpu.vram_used": mval(22.0, extra={"total":24,"percent":92}),
    "gpu.vram_total": mval(24), "gpu.vram_percent": mval(92, "%"), "gpu.util": mval(0),
    "gpu.mem_util": mval(0), "gpu.clock_gpu": mval(210, extra={"max":2100}),
    "gpu.clock_mem": mval(405, extra={"max":10500}), "gpu.processes": mval([]),
    "llama.model": mval("Qwen3-32B"), "llama.quant": mval("Q4_K_M"), "llama.context": mval(12288),
    "llama.status": mval("running"), "llama.backend": mval("llama.cpp"),
    "claude.tokens_total": mval(25100000), "claude.session_total": mval(20200000),
    "claude.sparkline": mval([3,5,8,6,9,12,7,15,11,18]), "claude.agents_active": mval(2),
    "claude.sessions": mval(140), "claude.days_active": mval(31), "claude.token_rate": mval(0),
}

data_js = (
    "// GENERATED by scripts/gen_site_assets.py — do not edit by hand.\n"
    "window.PANEL_SPEC = " + json.dumps(web_spec()) + ";\n"
    "window.SITE_THEMES = " + json.dumps(themes_blob) + ";\n"
    "window.SITE_METRICS = " + json.dumps(metrics) + ";\n"
)
(OUT / "data.js").write_text(data_js)

# --- 3. dashboard.js = shared_helpers + screen_functions + shim ---
shared = (UI / "shared_helpers.js").read_text()
screens = (UI / "screen_functions.js").read_text()
shim = r"""
/* ── site render shim (replaces display_app.js poll loop) ── */
var metrics = window.SITE_METRICS;
var activeFamily = null, activeVariant = null, themeColors = null;
function m(key){ if(!metrics||!metrics[key]) return {value:null,available:false,unit:'',extra:{}}; return metrics[key]; }
function mv(key,suffix){ var d=m(key); if(!d.available) return 'N/A'; return suffix? d.value+suffix : String(d.value); }
function cleanModel(){ var d=m('llama.model'); if(!d.available) return '--';
  return String(d.value).replace(/\.gguf$/i,'').replace(/[-_]Q\d[A-Z0-9_]*$/i,'').replace(/_/g,' ').replace(/-$/,''); }
function getScreen1Fn(){
  var isPanel=activeFamily==='Panel', isVintage=activeFamily==='Vintage';
  if(isPanel && activeVariant==='Teal') return panelTealScreen1;
  if(isPanel && activeVariant==='Coral') return panelCoralScreen1;
  if(isPanel) return panelGoldScreen1;
  if(isVintage && activeVariant==='Tubes') return tubeScreen1;
  if(isVintage && activeVariant==='VFD') return vfdScreen1;
  if(isVintage) return scanScreen1;
  return terminalScreen1;
}
/* Render theme's primary (System Stats) screen into element id `elId`. */
function renderThemeInto(elId, family, variant){
  activeFamily=family; activeVariant=variant;
  themeColors=((window.SITE_THEMES.families[family]||{})[variant])||null;
  if(!themeColors) return;
  document.getElementById(elId).innerHTML = getScreen1Fn()(themeColors);
}
window.renderThemeInto = renderThemeInto;
window.SITE_THEME_LIST = (function(){ var o=window.SITE_THEMES.families, a=[];
  for(var fam in o){ for(var v in o[fam]) a.push({family:fam, variant:v}); } return a; })();
"""
(OUT / "dashboard.js").write_text(
    "// GENERATED by scripts/gen_site_assets.py — do not edit by hand.\n"
    + shared + "\n" + screens + "\n" + shim)
print("wrote data.js (%d themes) and dashboard.js" % sum(len(v) for v in families.values()))
```

- [ ] **Step 2: Run it**

```bash
cd /home/rohan/projects/chiketi && .venv/bin/python scripts/gen_site_assets.py
```
Expected: `wrote data.js (12 themes) and dashboard.js`

- [ ] **Step 3: Verify the data**

```bash
cd /home/rohan/projects/chiketi && node -e "global.window={};require('./docs/site/data.js');var f=window.SITE_THEMES.families;console.log('families',Object.keys(f));console.log('total',Object.values(f).reduce((n,x)=>n+Object.keys(x).length,0));console.log('gold.primary',f.Panel.Gold.primary)"
```
Expected: `families [ 'Terminal', 'Panel', 'Vintage' ]`, `total 12`, a hex color for gold.primary.

- [ ] **Step 4: Commit**

```bash
git add scripts/gen_site_assets.py docs/site/data.js docs/site/dashboard.js
git commit -m "feat(site): generate frozen data + bundled dashboard renderer"
```

---

### Task 3: De-risk the core — prove all 12 themes render live

Before building UI around it, confirm `renderThemeInto` produces a correct dashboard for every theme in a real browser.

**Files:**
- Create (temporary): `chiketi/docs/site/_probe.html`

- [ ] **Step 1: Write the probe page** `docs/site/_probe.html`

```html
<!doctype html><html><head><meta charset="utf-8">
<style>
  body{background:#000;margin:0}
  .screen-frame{width:1024px;height:600px;container-type:inline-size;position:relative}
  /* dashboard layout classes the renderers rely on */
</style>
<link rel="stylesheet" href="display.css.probe.css">
</head><body>
<div class="screen-frame"><div id="display"></div></div>
<script src="data.js"></script><script src="dashboard.js"></script>
<script>
  // render the theme named in ?t=Family/Variant (default Panel/Gold)
  var q=(location.search.match(/t=([^&]+)/)||[])[1];
  var fv=q?decodeURIComponent(q).split('/'):['Panel','Gold'];
  renderThemeInto('display', fv[0], fv[1]);
</script>
</body></html>
```

- [ ] **Step 2: Provide the dashboard layout CSS the renderers need**

The renderers use classes from the product's `display.css` (`.l-screen`,`.l-2x2`,`.l-panel`,`.t-panel`,`.t-row`, fonts, etc.). Copy them so the probe (and later the site) style the dashboard correctly:

```bash
cd /home/rohan/projects/chiketi
cat chiketi/assets/ui/fonts.css chiketi/assets/ui/display.css > docs/site/dashboard.css
# point the probe at it
sed -i 's#display.css.probe.css#dashboard.css#' docs/site/_probe.html
```
Note: `@font-face` URLs in `fonts.css` are root-relative (`/assets/fonts/...`). For the site, copy the fonts so they resolve under `docs/`:
```bash
mkdir -p docs/assets && cp -r chiketi/assets/fonts docs/assets/fonts
```

- [ ] **Step 3: Screenshot all 12 themes**

```bash
cd /home/rohan/projects/chiketi/docs && python3 -m http.server 8801 >/tmp/site.log 2>&1 &
sleep 1
for t in Panel/Gold Panel/Teal Panel/Coral Terminal/hacker Terminal/cyan Terminal/amber Terminal/phosphor Terminal/red_alert Terminal/blue Vintage/Scanlines Vintage/Tubes Vintage/VFD; do
  n=$(echo "$t"|tr '/A-Z' '_a-z')
  /usr/bin/chromium-browser --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=1024,600 --virtual-time-budget=3000 --screenshot=/home/rohan/chiketi_shots/probe_$n.png "http://127.0.0.1:8801/site/_probe.html?t=$t" >/dev/null 2>&1
done
fuser -k 8801/tcp 2>/dev/null; ls /home/rohan/chiketi_shots/probe_*.png | wc -l
```
Expected: `12`. **Open the 12 `probe_*.png` and confirm each matches the corresponding `gallery_*` reference** (same dashboard, correct theme colors). If any theme is blank, the shim's family/variant mapping or a missing global is the cause — fix before proceeding.

- [ ] **Step 4: Commit**

```bash
git add docs/site/_probe.html docs/site/dashboard.css docs/assets/fonts
git commit -m "test(site): probe page proves all 12 themes render live"
```

---

### Task 4: Site base styles + design tokens

**Files:**
- Modify: `chiketi/docs/site/site.css`

- [ ] **Step 1: Write base tokens, reset, nav, and section rhythm**

Define CSS custom properties for the hardware-dark palette and typography, a minimal reset, sticky nav styling, a `.section` wrapper (max-width ~1100px, generous vertical padding), and `prefers-reduced-motion` guards. Use `Chakra Petch` (already in `docs/assets/fonts` via the product) for display and a system mono for code. Key tokens:

```css
:root{
  --bg:#08080b; --bg-2:#0e0e12; --panel:#15151c; --line:#2a2a32;
  --ink:#f3f4f6; --ink-2:#9aa0a6; --gold:#F5C518; --teal:#14b8a6; --green:#22c55e;
  --maxw:1100px; --radius:14px;
}
*{box-sizing:border-box} html{scroll-behavior:smooth}
body{margin:0;background:radial-gradient(1200px 600px at 70% -10%,#15151c,var(--bg));
  color:var(--ink);font-family:'Chakra Petch',system-ui,sans-serif}
.section{max-width:var(--maxw);margin:0 auto;padding:64px 22px}
.mono{font-family:ui-monospace,'JetBrains Mono',monospace}
.led{width:8px;height:8px;border-radius:50%;display:inline-block}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
```
(Full nav + button + label styles included here as well — see spec §Art direction for palette/typography.)

- [ ] **Step 2: Verify it loads with no console errors**

```bash
cd /home/rohan/projects/chiketi/docs && python3 -m http.server 8801 >/tmp/site.log 2>&1 &
sleep 1; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8801/site/site.css; fuser -k 8801/tcp 2>/dev/null
```
Expected: `200`

- [ ] **Step 3: Commit** — `git add docs/site/site.css && git commit -m "feat(site): base styles and design tokens"`

---

### Task 5: Sticky nav + hero shell (markup)

**Files:** Modify `docs/site-dev.html` (fill `#app`), `docs/site/site.css`

- [ ] **Step 1:** Add the nav (`CHIKETI` wordmark + green `.led`; anchor links Themes / Appliance / Install / GitHub) and an empty hero `<section id="hero">` with two columns: `.hero-copy` (eyebrow "RETRO SYSTEM MONITOR", h1 "See your machines at a glance.", subcopy, CTA buttons, `curl … | bash` line) and `.hero-device` (placeholder for the chassis, filled in Task 6). Markup mirrors the approved mockup `blend-ac.html`.
- [ ] **Step 2:** Style nav (sticky, hardware strip, blur backdrop) and hero grid in `site.css`.
- [ ] **Step 3:** Screenshot `site_hero-shell.png` (recipe above), confirm nav + copy render and the device area is reserved.
- [ ] **Step 4:** `git add -A && git commit -m "feat(site): sticky nav + hero shell"`

---

### Task 6: Hero device chassis + live dashboard + theme switcher

This is the centerpiece. The chassis frames a real rendered dashboard; a row of theme chips re-renders it.

**Files:** `docs/site-dev.html`, `docs/site/site.css`, `docs/site/site.js`

- [ ] **Step 1:** Add chassis markup inside `.hero-device`: outer `.chassis` with four `.screw` corners, a `.bezel-strip` (brand `CHIKETI · SYS-MON · v0.2` + status LEDs), a `.screen` containing `<div class="screen-frame"><div id="hero-display"></div></div>`, and a glass overlay div. Below the device, a `.theme-chips` row with one `<button class="chip" data-family=… data-variant=…>` per theme (generate from `window.SITE_THEME_LIST` in `site.js`, or hand-write 12).
- [ ] **Step 2:** Chassis CSS (brushed-metal gradient, inset highlight, screws, screen inset shadow, scanline+corner-highlight glass overlay) in `site.css`. The `.screen-frame` here is sized by container width (use `width:100%;aspect-ratio:1024/600;container-type:inline-size`) so the `cqw`-based dashboard scales to the device.
- [ ] **Step 3:** Wire the switcher in `site.js`:

```js
(function(){
  function setTheme(family, variant){
    renderThemeInto('hero-display', family, variant);
    document.querySelectorAll('.chip').forEach(c=>c.classList.toggle('active',
      c.dataset.family===family && c.dataset.variant===variant));
  }
  document.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',
    ()=>setTheme(c.dataset.family, c.dataset.variant)));
  setTheme('Panel','Gold'); // default face
})();
```
Ensure `site.css` includes `dashboard.css` rules (or `@import "dashboard.css";` at top of `site.css`) so the dashboard inside the hero is styled.

- [ ] **Step 4:** Screenshot `site_hero.png`, then click-through a few themes via `?` not available — instead screenshot after setting different defaults, OR add `?t=` handling. Confirm the device renders Gold by default and chips switch it (verify by temporarily defaulting to Vintage/Tubes and re-shooting). Confirm no horizontal overflow.
- [ ] **Step 5:** `git add -A && git commit -m "feat(site): hero device chassis with live theme-switchable dashboard"`

---

### Task 7: The family section

**Files:** `docs/site-dev.html`, `docs/site/site.css`

- [ ] **Step 1:** Add `<section id="appliance">` with two `.unit` cards (chiketi · "this box · psutil" green LED; appliance · "remote fleet · a Pi + SSH" teal LED), each with a one-line "which one am I?" hint and a link to its repo. Hardware-card styling consistent with the chassis.
- [ ] **Step 2:** Screenshot `site_family.png`; confirm two units, correct copy/links.
- [ ] **Step 3:** `git add -A && git commit -m "feat(site): product-family section"`

---

### Task 8: Theme gallery (faceplate switcher)

**Files:** `docs/site-dev.html`, `docs/site/site.css`, `docs/site/site.js`

- [ ] **Step 1:** Add `<section id="themes">` with a heading "12 themes · 3 families", a second device (`#gallery-display` in a `.screen-frame`), and 12 faceplate swatches grouped by family. Clicking a swatch calls `renderThemeInto('gallery-display', …)` (reuse the same shim). Default to a different theme than the hero (e.g. Vintage/Tubes) so the page shows variety at rest.
- [ ] **Step 2:** Style the swatch grid (group labels Panel/Terminal/Vintage; active state).
- [ ] **Step 3:** Screenshot `site_themes.png`; confirm the gallery device renders and swatches are grouped/labeled.
- [ ] **Step 4:** `git add -A && git commit -m "feat(site): theme gallery with faceplate switcher"`

---

### Task 9: "What it shows" section

**Files:** `docs/site-dev.html`, `docs/site/site.css`

- [ ] **Step 1:** Add `<section id="features">` — a grid of panel-style cards: **CPU/GPU/mem/disk/net/temps/fans**, **llama.cpp / local LLM**, **Claude Code usage**, **kiosk mode**, **phone control panel**, **graceful degradation**. Each card: short title + one line. Use the gold/teal accent borders to echo the dashboard.
- [ ] **Step 2:** Screenshot `site_features.png`; confirm the grid reads cleanly and wraps.
- [ ] **Step 3:** `git add -A && git commit -m "feat(site): features / what-it-shows section"`

---

### Task 10: Install section (tabbed)

**Files:** `docs/site-dev.html`, `docs/site/site.css`, `docs/site/site.js`

- [ ] **Step 1:** Add `<section id="install">` with two tabs (chiketi / appliance). Each panel shows the real install one-liner from each repo's README (`curl -fsSL …/scripts/install.sh | bash`), a copy button, a "grab a 7″ 1024×600 display" nudge, and 3 quick steps. Confirm the exact install commands by reading `chiketi/README.md` and `chiketi-appliance/README.md` before writing them — do not invent URLs.
- [ ] **Step 2:** Tab logic in `site.js`:

```js
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(x=>x.hidden=true);
  t.classList.add('active'); document.getElementById(t.dataset.panel).hidden=false;
}));
```
Copy button: `navigator.clipboard.writeText(...)` with a "copied" toast.

- [ ] **Step 3:** Screenshot `site_install.png` (both tabs — re-shoot with the appliance tab pre-activated); confirm commands match the READMEs and copy works.
- [ ] **Step 4:** `git add -A && git commit -m "feat(site): tabbed install section"`

---

### Task 11: Footer + responsive + accessibility

**Files:** `docs/site-dev.html`, `docs/site/site.css`

- [ ] **Step 1:** Add footer (both repo links, MIT license, "built by Rohan Prakash").
- [ ] **Step 2:** Responsive rules: at ≤820px stack hero columns (copy above device), shrink chassis padding, wrap chip rows, single-column feature/family grids, ensure the dashboard device never causes horizontal scroll (`overflow-x:hidden` on body as a backstop). Tap targets ≥44px for chips/tabs/buttons.
- [ ] **Step 3:** Accessibility: `aria-label` on icon-only/LED elements and the GitHub link; `alt` on any imgs; visible `:focus-visible` outlines; confirm `prefers-reduced-motion` disables the scanline/LED animation (from Task 4 guard).
- [ ] **Step 4:** Screenshot desktop `site_full_desktop.png` (1440×3000) AND mobile `site_full_mobile.png` (390×3000). Confirm: hero stacks on mobile, no horizontal scroll, all sections present.
- [ ] **Step 5:** `git add -A && git commit -m "feat(site): footer, responsive layout, a11y"`

---

### Task 12: Promote to index.html + cross-link appliance + final verification

**Files:** `chiketi/docs/index.html` (replace), `chiketi-appliance/docs/index.html` (redirect note)

- [ ] **Step 1: Promote the working page**

```bash
cd /home/rohan/projects/chiketi
mv docs/site-dev.html docs/index.html   # overwrites the old landing (already preserved as index-legacy.html)
```
Fix the page `<title>`/any `site-dev` self-references if present.

- [ ] **Step 2: Final full-site screenshots (desktop + mobile + theme switch sanity)** using the recipe; open them and confirm the site is correct end-to-end and the hero/gallery dashboards render.

- [ ] **Step 3: Decision gate — live vs fallback.** If on any target the live dashboard is blank/janky (e.g. font load race), switch that device to a static PNG: render once and reference `gallery_<theme>.png`. Default expectation: live works (proven in Task 3). Record which mode shipped in a comment in `index.html`.

- [ ] **Step 4: Appliance cross-link.** In `chiketi-appliance/docs/index.html`, add a top banner/link "Part of the chiketi family →" pointing at `https://rohanprakash12.github.io/chiketi`. (Keep the appliance's own page; just cross-link. Do this as a separate commit in that repo.)

- [ ] **Step 5: Commit + (optional) push**

```bash
cd /home/rohan/projects/chiketi
git add docs/index.html
git commit -m "feat(site): ship chiketi family site (replaces legacy landing)"
# push only when the user asks
```

- [ ] **Step 6: Enable Pages note.** Remind the user that Pages must point at `main` / `/docs` (the `gh api` command from earlier), and that `index-legacy.html` remains reachable if they want to compare.

---

## Self-Review

- **Spec coverage:** nav (T5) ✓, hero device+live dashboard (T6) ✓, family (T7) ✓, 12-theme gallery (T8) ✓, what-it-shows (T9) ✓, install tabbed (T10) ✓, footer (T11) ✓; interactive-with-PNG-fallback (T3 proves live, T12 gate) ✓; lives in docs/ replacing landing, legacy preserved (T1/T12) ✓; frozen data from Python (T2) ✓; accessibility + reduced-motion + mobile (T11) ✓; appliance cross-link (T12) ✓.
- **Placeholders:** generator, shim, switcher, tab logic, and verification commands are concrete. Repetitive section markup (features cards, family units, install steps) is specified by exact content + classes; execution reads the approved mockup `blend-ac.html` and the READMEs for literal copy — flagged where real values must be pulled (install commands) rather than invented.
- **Type/name consistency:** `renderThemeInto(elId,family,variant)`, `window.SITE_THEMES.families`, `window.SITE_METRICS`, `window.PANEL_SPEC`, `m()/mv()/cleanModel()` match the product's `display_app.js` usage and the generator output; element ids `hero-display` / `gallery-display` used consistently; chip `data-family`/`data-variant` consistent across T6/T8.

## Risks
- **Font load race** in headless screenshots can make the first render mis-measure `cqw` text — mitigated by `--virtual-time-budget` and re-shoot; live in a real browser is fine.
- **Palette drift:** `data.js` is a frozen snapshot; re-run `gen_site_assets.py` if themes change (noted in the generated header).
- **Pages serves `docs/`** so `_probe.html` and `dashboard.css` ship publicly — harmless; optionally delete `_probe.html` in T12.
