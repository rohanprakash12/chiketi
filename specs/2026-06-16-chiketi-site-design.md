# chiketi family site — design spec

- **Date:** 2026-06-16
- **Status:** Draft for implementation
- **Topic:** A distinctive single-page product site for the chiketi monitoring family

> Spec location note: the brainstorming default is `docs/superpowers/specs/`, but
> `docs/` is the GitHub Pages root for this repo, so the spec lives in `specs/`
> to avoid being published.

## Summary

A single-page static product/marketing site for the **chiketi monitoring family**
(chiketi = local box via psutil; chiketi-appliance = remote fleet via SSH on a Pi),
served from the existing GitHub Pages, **replacing the current `docs/index.html`**.
Art direction: **"the dashboard, mounted in hardware"** (the approved A+C blend) —
real, theme-switchable chiketi dashboards framed inside physical device chassis
(bezels, corner screws, status LEDs, screen-glass/scanline overlay).

## Goals / success criteria

- A visitor understands what chiketi is within ~10 seconds (a retro dashboard for a
  dedicated display).
- The site reads as distinctive and intentional — derived from the product's own
  visual identity, not a stock SaaS/landing template.
- Both products are presented so a visitor can self-select (local vs. remote).
- All 12 themes are showcased.
- A clear install path for each product.
- Ships on the existing GitHub Pages with no backend and no build step.

## Audience

Homelab / self-hoster / developer users who would put a small display on a desk or in
a rack, plus GitHub visitors evaluating the project.

## Scope

**In:** one static page with 7 sections; an interactive (or screenshot-fallback) hero;
a 12-theme gallery; install instructions for both products; the family framing; footer.

**Out (for now):** multi-page docs/blog; a separate standalone site for the appliance
(its repo page links/redirects here); photos of real hardware (we use rendered
dashboards instead); analytics; i18n; any server/build tooling.

## Art direction

A+C blend (approved mockup: `.superpowers/brainstorm/.../blend-ac.html`).

- **Device-chassis framing:** brushed-metal gradient bezel, corner screws, status LEDs,
  subtle screen-glass highlight + scanline overlay over the dashboard.
- **Palette:** dark hardware-industrial base; the product's theme colors (gold/teal/
  coral/green/…) as accents. Default hero face = Panel/Gold.
- **Typography:** Chakra Petch for display (matches the product), a monospace
  (e.g. JetBrains Mono / the product's existing mono) for command/terminal bits, a
  clean sans for body. Reuse fonts already in `chiketi/assets/fonts/` where possible.
- **Motion:** subtle LED pulse + scanline shimmer; must respect `prefers-reduced-motion`.

## Key technical decisions

1. **Interactive live hero & gallery (with screenshot fallback).** Reuse the
   already-extracted `chiketi/assets/ui/screen_functions.js` + `shared_helpers.js` to
   render a *real, theme-switchable* dashboard in-page, backed by a **bundled static
   mock-metrics snapshot** and the 12 theme palettes — no server, no polling. Switching
   a theme re-renders using that theme's colors (same client-side mechanism the product
   uses). If live rendering proves too heavy/janky, fall back to pre-rendered PNGs from
   the existing 12-theme gallery.
2. **Location:** the site is `chiketi/docs/index.html` (Pages root), replacing the
   current landing page (preserved in git history). Supporting assets live under
   `chiketi/docs/site/` (css, js, mock data, theme palettes, fallback PNGs).
3. **Single page, static, no build step** — vanilla HTML/CSS/JS that works both opened
   as `file://` and served by Pages.

## Page structure

1. **Nav (sticky)** — `CHIKETI` wordmark + status LED; anchors: Themes · Appliance ·
   Install · GitHub; hardware-strip styling.
2. **Hero** — device-chassis dashboard on one side; headline, one-line pitch,
   `curl … | bash`, and CTAs (Get started / View themes) on the other.
3. **The family** — two physical "units" side by side: **chiketi** (this box · psutil)
   vs **appliance** (remote fleet · Pi + SSH), with a "which one am I?" line.
4. **Theme gallery** — the 12 themes as swappable faceplates shown in a device frame
   (drives the hero device or a dedicated gallery device).
5. **What it shows** — the monitored metrics (CPU/GPU/mem/disk/net/temps/fans +
   llama.cpp + Claude usage), kiosk mode, phone control panel, graceful degradation —
   as panel cards.
6. **Install** — tabbed (*chiketi* vs *appliance*) one-liners + a "grab a 7″ display"
   nudge + quick steps.
7. **Footer** — both repos, license, built-by.

## Static data the site bundles

Frozen snapshots generated once from the Python (so no runtime/server needed):

- A single realistic **mock-metrics** reading (JS/JSON).
- The **12 theme palettes** (color fields) as a static JS object, generated from
  `themes.py` — documented as a frozen snapshot that can drift from the product.
- `panel_spec.web_spec()` output as static JSON.

## Accessibility

- Body/secondary text ≥ 4.5:1 contrast (reuse the `#9aa0a6` choice from the polish pass).
- Respect `prefers-reduced-motion` (dampen scanline/LED animation).
- Keyboard-navigable nav and theme switcher; alt text on any images; visible focus.

## Risks / mitigations

- **Live-render heaviness** → one static metrics frame (no polling), lazy-init the
  gallery, PNG fallback ready.
- **Palette/spec drift from the product** → generate the JSON once from the Python and
  label it a frozen snapshot; a later task can regenerate it.
- **Replacing the Pages root** → keep the current landing in git history; appliance
  repo page redirects here.
- **Mobile** → the device-chassis hero must scale/stack gracefully on narrow screens.

## Verification

Build, then screenshot via headless chromium (desktop + 390px mobile): confirm the hero
renders, theme switching works across all 12, the install tabs work, the layout stacks
on mobile, and contrast holds. (Same harness/recipe used for the dashboard polish.)
