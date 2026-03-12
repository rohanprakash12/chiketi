import { useState, useEffect, useMemo } from "react";

const NIXIE = "'Nixie One', cursive";
const MONO = "'IBM Plex Mono', monospace";
const BG = "#0A0806";       // tube interior dark warm black per reference
const GLASS_TINT = "#181210"; // glass tint per reference

// Exact colors from the tube emulation reference document
const N = {
  // Nixie glow layers (Section 1.3)
  core: "#FF8833",         // Standard glow
  bright: "#FF6E0B",       // Core glow / bloom source
  warm: "#FF9944",         // Warm glow
  dimEdge: "#CC5500",      // Outer glow falloff
  bloom: "#FF4400",        // Ambient halo (far bloom)
  cathode: "#1A1410",      // Dark cathode metal
  mesh: "#332820",         // Anode mesh color
  mercury: "#9966CC",      // Mercury blue fringe
  // Bargraph IN-13 (Section 6.2)
  barCore: "#FF7733",      // Center of glow bar
  barStd: "#FF6622",       // Normal bar
  barTip: "#FF5511",       // Leading edge, slightly redder
  barDim: "#CC4400",       // Keep-alive / dim base
  // Magic Eye (Section 2.2)
  eyeFull: "#33FF33",      // Full brightness phosphor
  eyeStd: "#22DD22",       // Standard glow
  eyeDim: "#118811",       // Low-signal areas
  eyeShadow: "#0A1A0A",   // Shadow zone
  eyeUnexcited: "#0D1A0D", // Phosphor at rest
  eyeBg: "#050A05",        // Near-black green tint
  // Dekatron (Section 4.2)
  dekOrange: "#FF6600",    // Neon dot
  dekInactive: "#181410",  // Dark cathode pin
  dekGuide: "#552200",     // Guide cathode dim flash
  // General
  label: "#AA8855",        // Etched brass labels
  glass: "#332818",        // Tube housing border
  dim: "#2A1E14",          // Inactive bg
  tubeInterior: "#0C0A06", // Bargraph unlit
};

function useAnimatedData() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id); }, []);
  const sin = (f, o = 0) => Math.sin((tick * f + o) * 0.3);
  return {
    cpu: Math.max(0, Math.min(100, 34 + sin(1.2) * 18 + sin(3.1, 2) * 8)),
    ram: Math.max(0, Math.min(100, 62 + sin(0.5, 1) * 5)),
    ssd: 47,
    secUsed: 1.4, secTotal: 2.0, hasSecondary: true,
    cpuTemp: Math.max(20, Math.min(120, 52 + sin(0.9, 1) * 8)),
    mbTemp: Math.max(20, Math.min(120, 38 + sin(0.4, 2) * 4)),
    gpuTemp: Math.max(20, Math.min(120, 68 + sin(0.6) * 7)),
    fans: [
      { label: "CPU", rpm: 1200 + Math.round(sin(0.8) * 200) },
      { label: "CAS1", rpm: 900 + Math.round(sin(0.5, 1) * 100) },
      { label: "CAS2", rpm: 850 + Math.round(sin(0.6, 2) * 100) },
      { label: "CAS3", rpm: 880 + Math.round(sin(0.4, 3) * 100) },
    ],
    netUp: Math.max(0, 2.4 + sin(2, 5) * 1.2),
    netDown: Math.max(0, 12.8 + sin(1.8, 3) * 5),
    vramUsed: 18.2 + sin(0.3, 2) * 2,
    vramTotal: 24,
    tokSec: Math.max(0, 42 + sin(1.5, 4) * 12),
    tick,
  };
}

function useTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  return now;
}

// ═══════════════════════════════════════
// NIXIE DIGIT — 4-layer glow per reference Section 1.5
// ═══════════════════════════════════════
function NixieDigit({ value, size = 28, showTube = false }) {
  const allDigits = "0123456789";
  const chars = String(value).split("");

  // Per-reference glow: core #FF8833, tight blur #FF6E0B@60%, medium #FF6E0B@25%, ambient #FF4400@10%
  const nixieGlow = (sz) => `
    0 0 ${sz * 0.06}px ${N.bright},
    0 0 ${sz * 0.15}px ${N.bright}99,
    0 0 ${sz * 0.3}px ${N.bright}40,
    0 0 ${sz * 0.6}px ${N.bloom}1A
  `;

  return (
    <span style={{ display: "inline-flex", gap: showTube ? 3 : 0 }}>
      {chars.map((ch, ci) => {
        const isDigit = /\d/.test(ch);
        return (
          <span key={ci} style={{
            position: "relative", display: "inline-block",
            width: showTube ? size * 0.7 : "auto",
            height: showTube ? size * 1.3 : "auto",
            textAlign: "center",
            background: showTube
              ? `radial-gradient(ellipse at 40% 35%, rgba(255,68,0,0.04) 0%, ${BG} 60%), linear-gradient(180deg, ${GLASS_TINT}88 0%, ${BG}22 10%, ${BG}11 20%, ${BG}11 80%, ${BG}22 90%, ${GLASS_TINT}88 100%)`
              : `linear-gradient(180deg, ${GLASS_TINT}55 0%, transparent 20%, transparent 80%, ${GLASS_TINT}55 100%)`,
            border: showTube ? `1px solid ${N.glass}55` : `1px solid ${N.glass}33`,
            borderBottom: showTube ? `3px solid ${N.glass}88` : undefined,
            borderRadius: showTube ? `${size * 0.3}px ${size * 0.3}px 4px 4px` : 2,
            backdropFilter: showTube ? "blur(0.5px)" : undefined,
            WebkitBackdropFilter: showTube ? "blur(0.5px)" : undefined,
            boxShadow: showTube
              ? `inset 0 0 ${size * 0.4}px rgba(255,68,0,0.07), inset 0 0 ${size*0.15}px rgba(255,100,34,0.1), inset 0 ${size*0.15}px ${size*0.3}px rgba(0,0,0,0.4), 0 0 ${size*0.25}px rgba(255,68,0,0.1)`
              : undefined,
            overflow: "hidden", padding: showTube ? 0 : "0 1px",
          }}>
            {/* Ghost cathodes — dark wire silhouettes at varying depths */}
            {isDigit && allDigits.split("").filter(g => g !== ch).map((g, gi) => (
              <span key={gi} style={{
                position: "absolute", left: "50%", top: showTube ? "48%" : "50%",
                transform: "translate(-50%, -50%)",
                fontSize: size, fontFamily: NIXIE,
                color: "transparent",
                WebkitTextStroke: `0.5px ${N.cathode}`,
                opacity: 0.4 - gi * 0.03,
                filter: `blur(${0.2 + gi * 0.12}px)`,
                zIndex: gi,
              }}>{g}</span>
            ))}

            {/* Single element with 5-layer stacked text-shadow per Chromium technique */}
            {/* Core = pale filament, glow layers go white → orange → red → deep ambient */}
            <span style={{
              position: showTube ? "absolute" : "relative",
              left: showTube ? "50%" : "auto", top: showTube ? "48%" : "auto",
              transform: showTube ? "translate(-50%, -50%)" : "none",
              fontSize: size, fontFamily: isDigit ? NIXIE : MONO,
              color: "#FFAA55",
              textShadow: `
                0 0 ${Math.max(2, size * 0.03)}px #FFFFFF,
                0 0 ${Math.max(8, size * 0.1)}px #FFAA55,
                0 0 ${Math.max(16, size * 0.22)}px #FF6600,
                0 0 ${Math.max(32, size * 0.45)}px rgba(255,68,0,0.5),
                0 0 ${Math.max(60, size * 0.8)}px rgba(255,0,0,0.2)
              `,
              zIndex: 13,
              animation: `nixieFlicker ${2.5 + Math.random() * 2}s ease-in-out infinite, nixieMicroFlicker ${0.8 + Math.random() * 0.5}s linear infinite`,
            }}>{ch}</span>

            {/* Hex anode mesh */}
            {showTube && (
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='10' height='9'><path d='M5 0L10 2.8V6.2L5 9L0 6.2V2.8Z' fill='none' stroke='rgba(51,40,32,0.1)' stroke-width='0.4'/></svg>`)}")`,
                backgroundSize: "10px 9px",
                zIndex: 14, pointerEvents: "none",
              }} />
            )}

            {/* Glass reflections — specular highlight */}
            {showTube && <>
              {/* Primary specular — elongated curved highlight on upper right */}
              <div style={{ position: "absolute", top: "8%", right: "10%", width: "45%", height: "15%", background: "linear-gradient(130deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02) 60%, transparent)", borderRadius: "50%", transform: "rotate(25deg)", zIndex: 15, pointerEvents: "none" }} />
              {/* Secondary highlight — small bright spot */}
              <div style={{ position: "absolute", top: "15%", right: "20%", width: "12%", height: "6%", background: "rgba(255,255,255,0.05)", borderRadius: "50%", zIndex: 15, pointerEvents: "none" }} />
              {/* Bottom rim reflection */}
              <div style={{ position: "absolute", bottom: "3px", left: "15%", width: "70%", height: "3%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent)", borderRadius: "50%", zIndex: 15, pointerEvents: "none" }} />
            </>}

            {/* Mercury blue fringe at edges */}
            {showTube && (
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: `radial-gradient(ellipse at center, transparent 50%, ${N.mercury}08 100%)`, zIndex: 14, pointerEvents: "none" }} />
            )}
          </span>
        );
      })}
    </span>
  );
}

// ═══════════════════════════════════════
// IN-13 BARGRAPH TUBE — per reference Section 6
// Plasma sheath around wire, bright center dim edges, rounded tip, all neon orange
// ═══════════════════════════════════════
function BargraphBar({ pct, label, color }) {
  const barColor = color || N.barStd;
  const filterId = `glow-${label}`;
  const svgW = 300;
  const h = 22;
  const barW = (Math.max(0, pct) / 100) * (svgW - 4);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: N.label, textShadow: `0 0 2px ${N.label}33`, fontSize: 12, fontFamily: MONO, width: 26, textAlign: "right", flexShrink: 0 }}>{label}</span>
      <svg width="100%" height={h} viewBox={`0 0 ${svgW} ${h}`} preserveAspectRatio="none" style={{ overflow: "visible", flex: 1 }}>
        <defs>
          <filter id={`${filterId}-wide`} x="-50%" y="-300%" width="200%" height="700%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8 4" />
          </filter>
          <filter id={`${filterId}-med`} x="-30%" y="-200%" width="160%" height="500%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4 3" />
          </filter>
          <filter id={`${filterId}-tight`} x="-10%" y="-100%" width="120%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2 1.5" />
          </filter>
        </defs>

        {/* Tube housing */}
        <rect x="0" y="0" width={svgW} height={h} rx="11" ry="11"
          fill={N.tubeInterior} stroke={`${N.glass}44`} strokeWidth="1" />
        
        {/* Cathode wire full length */}
        <line x1="4" y1={h/2} x2={svgW-4} y2={h/2}
          stroke={N.cathode} strokeWidth="0.5" opacity="0.35" />

        {/* Layer 5: Ambient red fill */}
        <rect x="2" y="1" width={Math.max(0, barW)} height={h-2} rx="10" ry="10"
          fill="rgba(255,0,0,0.08)"
          style={{ transition: "width 0.8s ease" }} />

        {/* Layer 4: Wide bloom */}
        <rect x="2" y={h/2 - 6} width={Math.max(0, barW)} height="12" rx="6" ry="6"
          fill={barColor} opacity="0.5"
          filter={`url(#${filterId}-wide)`}
          style={{ transition: "width 0.8s ease" }} />

        {/* Layer 3: Plasma halo */}
        <rect x="2" y={h/2 - 4} width={Math.max(0, barW)} height="8" rx="4" ry="4"
          fill={barColor} opacity="0.7"
          filter={`url(#${filterId}-med)`}
          style={{ transition: "width 0.8s ease" }} />

        {/* Layer 2.5: Transition blend */}
        <rect x="2" y={h/2 - 3} width={Math.max(0, barW)} height="6" rx="3" ry="3"
          fill={barColor} opacity="0.5"
          filter={`url(#${filterId}-tight)`}
          style={{ transition: "width 0.8s ease" }} />

        {/* Layer 2: Tight warm halo */}
        <rect x="2" y={h/2 - 2} width={Math.max(0, barW)} height="4" rx="2" ry="2"
          fill="#FFCC88" opacity="0.85"
          filter={`url(#${filterId}-tight)`}
          style={{ transition: "width 0.8s ease" }} />

        {/* Layer 1: Hot wire core */}
        <rect x="2" y={h/2 - 0.75} width={Math.max(0, barW)} height="1.5" rx="0.75" ry="0.75"
          fill="#FFDDAA"
          style={{ transition: "width 0.8s ease" }} />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════
// MAGIC EYE (6E5) — ported from reference HTML implementation
// ═══════════════════════════════════════
function polar(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function sectorPath(cx, cy, rOuter, rInner, startDeg, endDeg) {
  const spanRaw = endDeg - startDeg;
  const span = ((spanRaw % 360) + 360) % 360;
  const largeArc = span > 180 ? 1 : 0;
  const p1 = polar(cx, cy, rOuter, startDeg);
  const p2 = polar(cx, cy, rOuter, endDeg);
  const p3 = polar(cx, cy, rInner, endDeg);
  const p4 = polar(cx, cy, rInner, startDeg);
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
    `Z`
  ].join(" ");
}

function MagicEye({ pct, label, size = 70 }) {
  const s = size / 420;
  const cx = 210, cy = 210;
  const rOuter = 146, rInner = 66;

  const minAngle = 4;
  const maxAngle = 320;
  const wedgeAngle = minAngle + (pct / 100) * (maxAngle - minAngle);
  const startDeg = -wedgeAngle / 2;
  const endDeg = wedgeAngle / 2;

  const shadowPath = sectorPath(cx, cy, rOuter, rInner, startDeg, endDeg);
  const shadowSoftPath = sectorPath(cx, cy, rOuter + 4, rInner - 3, startDeg - 2.5, endDeg + 2.5);
  const holeSize = rInner * 2 * s;

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: N.label, textShadow: `0 0 3px ${N.label}44`, fontSize: 14, fontFamily: MONO, letterSpacing: 3, marginBottom: 3 }}>{label}</div>
      <div style={{
        position: "relative", width: size, height: size, margin: "0 auto",
        filter: `drop-shadow(0 0 ${4*s}px rgba(50,255,90,0.08)) drop-shadow(0 0 ${10*s}px rgba(50,255,90,0.06)) drop-shadow(0 0 ${16*s}px rgba(50,255,90,0.05))`,
      }}>
        <svg viewBox="0 0 420 420" width={size} height={size} style={{ display: "block" }}>
          <defs>
            <filter id={`og-${label}`} x="-150%" y="-150%" width="400%" height="400%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="14" result="g1" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="28" result="g2" />
              <feMerge><feMergeNode in="g2" /><feMergeNode in="g1" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id={`sb-${label}`} x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
            <radialGradient id={`ph-${label}`} cx="50%" cy="47%" r="50%">
              <stop offset="0%" stopColor="#baff9f" stopOpacity="1" />
              <stop offset="26%" stopColor="#7fff63" stopOpacity="0.98" />
              <stop offset="52%" stopColor="#46ef3f" stopOpacity="0.95" />
              <stop offset="78%" stopColor="#1fc62c" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#0c7e1c" stopOpacity="0.90" />
            </radialGradient>
            <radialGradient id={`rf-${label}`} cx="50%" cy="50%" r="58%">
              <stop offset="62%" stopColor="rgba(0,0,0,0)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.40)" />
            </radialGradient>
            <clipPath id={`fc-${label}`}><circle cx="210" cy="210" r="146" /></clipPath>
            <mask id={`fm-${label}`}>
              <rect width="420" height="420" fill="black" />
              <circle cx="210" cy="210" r="146" fill="white" />
              <circle cx="210" cy="210" r="66" fill="black" />
            </mask>
          </defs>

          <circle cx="210" cy="210" r="132" fill="#31e13a" opacity="0.12" filter={`url(#og-${label})`} />

          <g mask={`url(#fm-${label})`}>
            <circle cx="210" cy="210" r="146" fill={`url(#ph-${label})`} filter={`url(#og-${label})`} opacity="0.78" />
            <circle cx="210" cy="210" r="146" fill={`url(#ph-${label})`} opacity="0.92" />
            <g clipPath={`url(#fc-${label})`} opacity="0.08">
              <path d="M210 210 L210 64 A146 146 0 0 1 292 90 Z" fill="#d8ffbd" />
              <path d="M210 210 L292 90 A146 146 0 0 1 346 175 Z" fill="#b2ff8e" />
              <path d="M210 210 L346 175 A146 146 0 0 1 330 292 Z" fill="#73ff5f" />
              <path d="M210 210 L330 292 A146 146 0 0 1 224 356 Z" fill="#9eff77" />
            </g>
            <path d={shadowSoftPath} fill="rgba(0,0,0,0.34)" filter={`url(#sb-${label})`} style={{ transition: "d 0.5s ease" }} />
            <path d={shadowPath} fill="rgba(0,0,0,0.96)" style={{ transition: "d 0.5s ease" }} />
            <circle cx="210" cy="210" r="146" fill={`url(#rf-${label})`} opacity="0.95" />
          </g>
        </svg>

        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: holeSize, height: holeSize, borderRadius: "50%",
          background: "radial-gradient(circle at 38% 30%, #141714 0%, #090a09 28%, #030303 72%, #000 100%)",
          boxShadow: `inset 0 1px 1px rgba(255,255,255,0.02), inset 0 -${5*s}px ${10*s}px rgba(0,0,0,0.92), 0 0 0 1px rgba(255,255,255,0.02)`,
          display: "grid", placeItems: "center",
        }}>
          <span style={{
            color: "#eefdeb", fontSize: Math.max(11, holeSize * 0.3),
            fontWeight: 700, fontFamily: NIXIE, lineHeight: 1,
            textShadow: "0 0 4px rgba(140,255,160,0.10), 0 0 8px rgba(140,255,160,0.05)",
          }}>{Math.round(pct)}%</span>
        </div>
      </div>
    </div>
  );
}

// Scale for bargraph section
function TubeScale() {
  const marks = [20, 50, 70, 90, 110, 120];
  return (
    <div style={{ marginLeft: 32, position: "relative", height: 20 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `${N.core}33` }} />
      {marks.map(t => (
        <div key={t} style={{ position: "absolute", left: `${((t - 20) / 100) * 100}%`, top: 0, transform: "translateX(-50%)" }}>
          <div style={{ width: 1, height: 6, background: `${N.core}66` }} />
          <div style={{ color: N.core, textShadow: `0 0 3px ${N.bright}55`, fontSize: 12, fontFamily: MONO, textAlign: "center", marginTop: 1 }}>{t}</div>
        </div>
      ))}
    </div>
  );
}

// Dekatron with trail per reference Section 4.4
function Dekatron({ rpm, size = 20 }) {
  const speed = Math.max(0.5, 4 - (rpm / 500));
  return (
    <div style={{ width: size, height: size, position: "relative", animation: `spin ${speed}s linear infinite` }}>
      {Array.from({ length: 10 }).map((_, i) => {
        const angle = (i / 10) * Math.PI * 2;
        const x = size / 2 + (size / 2 - 3) * Math.cos(angle) - 1.5;
        const y = size / 2 + (size / 2 - 3) * Math.sin(angle) - 1.5;
        // Active dot + 2-dot trail per reference
        const isActive = i === 0;
        const isTrail1 = i === 9;
        const isTrail2 = i === 8;
        const dotColor = isActive ? N.dekOrange : isTrail1 ? N.dekGuide : N.dekInactive;
        const dotOpacity = isActive ? 1 : isTrail1 ? 0.4 : isTrail2 ? 0.15 : 0.15;
        const dotGlow = isActive ? `0 0 4px ${N.dekOrange}, 0 0 10px ${N.dekOrange}66` : isTrail1 ? `0 0 3px ${N.dekGuide}` : "none";
        return (
          <div key={i} style={{
            position: "absolute", left: x, top: y, width: 3, height: 3, borderRadius: "50%",
            background: dotColor, boxShadow: dotGlow, opacity: dotOpacity,
          }} />
        );
      })}
    </div>
  );
}

function SectionLabel({ text, color = N.core, rightText, rightColor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
      <span style={{ color, textShadow: `0 0 2px #FFFFFF66, 0 0 6px ${color}88, 0 0 14px ${color}44`, fontSize: 13, fontFamily: MONO, letterSpacing: 3 }}>{text}</span>
      <div style={{ flex: 1, height: 1, background: `${color}18`, margin: "0 8px" }} />
      {rightText && <span style={{ color: rightColor || color, textShadow: `0 0 2px #FFFFFF44, 0 0 6px ${(rightColor||color)}66, 0 0 12px ${(rightColor||color)}33`, fontSize: 13, fontFamily: MONO, letterSpacing: 2 }}>{rightText}</span>}
    </div>
  );
}

function TubeRow({ label, value, valueSize = 22 }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ color: N.label, textShadow: `0 0 2px ${N.label}33`, fontSize: 12, fontFamily: MONO, letterSpacing: 1 }}>{label}</span>
      <NixieDigit value={value} size={valueSize} />
    </div>
  );
}

// ═══════════════════════════════════════
// SYSTEM SCREEN
// ═══════════════════════════════════════
function SystemScreen({ d }) {
  const temps = [d.cpuTemp, d.mbTemp, d.gpuTemp];
  const anyDanger = temps.some(t => t >= 100);
  const anyOrange = temps.some(t => t >= 80);
  const status = anyDanger ? "CRITICAL" : anyOrange ? "WARNING" : "NOMINAL";
  const statusColor = anyDanger ? "#FF3322" : anyOrange ? N.core : N.eyeStd;
  const secPct = d.hasSecondary ? (d.secUsed / d.secTotal) * 100 : 0;
  const tempPct = (t) => ((Math.max(20, Math.min(120, t)) - 20) / 100) * 100;

  // #6: Color based on temp range
  const tempColor = (t) => {
    if (t >= 100) return "#FF3322";   // red
    if (t >= 80) return N.core;       // orange #FF8833
    if (t >= 50) return N.eyeStd;     // green #22DD22
    return "#4488DD";                  // blue
  };

  return (
    <div style={{ width: "100%", height: "100%", background: BG, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
      {/* #1 FIX: ZION on Core Systems side, not merging with Thermals */}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <SectionLabel text="CORE SYSTEMS" color={N.core} rightText="ZION" rightColor={N.warm} />
        </div>
        <div style={{ flex: 1 }}>
          <SectionLabel text="THERMALS" color={N.warm} rightText={status} rightColor={statusColor} />
        </div>
      </div>

      {/* Row 2: Magic eyes | Bargraph bars */}
      <div style={{ display: "flex", gap: 8, flex: 1 }}>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-around", alignItems: "center" }}>
          <MagicEye pct={d.cpu} label="CPU" size={100} />
          <MagicEye pct={d.ram} label="RAM" size={100} />
          <MagicEye pct={d.ssd} label="SSD" size={100} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
          {/* #6: Color changes based on temp */}
          <BargraphBar pct={tempPct(d.cpuTemp)} label="CPU" color={tempColor(d.cpuTemp)} />
          <BargraphBar pct={tempPct(d.mbTemp)} label="MB" color={tempColor(d.mbTemp)} />
          <BargraphBar pct={tempPct(d.gpuTemp)} label="GPU" color={tempColor(d.gpuTemp)} />
          <TubeScale />
        </div>
      </div>

      {/* Row 3: Secondary | Fans */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {/* Secondary bar — SVG glow approach */}
        <div style={{ flex: 1 }}>
          {d.hasSecondary ? (
            <div style={{ position: "relative" }}>
              <svg width="100%" height="20" viewBox="0 0 300 20" preserveAspectRatio="none" style={{ overflow: "visible", display: "block" }}>
                <defs>
                  <filter id="sec-wide" x="-50%" y="-300%" width="200%" height="700%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="8 4" />
                  </filter>
                  <filter id="sec-med" x="-30%" y="-200%" width="160%" height="500%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="4 3" />
                  </filter>
                  <filter id="sec-tight" x="-10%" y="-100%" width="120%" height="300%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="2 1.5" />
                  </filter>
                </defs>
                <rect x="0" y="0" width="300" height="20" rx="10" ry="10" fill={N.tubeInterior} stroke={`${N.glass}44`} strokeWidth="1" />
                <line x1="4" y1="10" x2="296" y2="10" stroke={N.cathode} strokeWidth="0.5" opacity="0.35" />
                <rect x="2" y="1" width={secPct * 2.96} height="18" rx="9" fill="rgba(0,50,255,0.06)" style={{ transition: "width 0.8s ease" }} />
                <rect x="2" y="4" width={secPct * 2.96} height="12" rx="6" fill="#4488DD" opacity="0.5" filter="url(#sec-wide)" style={{ transition: "width 0.8s ease" }} />
                <rect x="2" y="6" width={secPct * 2.96} height="8" rx="4" fill="#4488DD" opacity="0.7" filter="url(#sec-med)" style={{ transition: "width 0.8s ease" }} />
                <rect x="2" y="7" width={secPct * 2.96} height="6" rx="3" fill="#4488DD" opacity="0.5" filter="url(#sec-tight)" style={{ transition: "width 0.8s ease" }} />
                <rect x="2" y="8" width={secPct * 2.96} height="4" rx="2" fill="#AACCEE" opacity="0.8" filter="url(#sec-tight)" style={{ transition: "width 0.8s ease" }} />
                <rect x="2" y="9.25" width={secPct * 2.96} height="1.5" rx="0.75" fill="#CCDDFF" style={{ transition: "width 0.8s ease" }} />
              </svg>
              {/* Text overlay on top */}
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 20, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 10px", fontFamily: MONO, fontSize: 10, color: "#CCDDFF", textShadow: "0 0 2px #4488DD88", zIndex: 2, pointerEvents: "none" }}>
                <span>SECONDARY</span><span>{d.secUsed}T / {d.secTotal}T</span>
              </div>
            </div>
          ) : (
            <div style={{ height: 20, background: N.dim, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 10, color: N.barDim }}>SECONDARY — NONE</div>
          )}
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
          <span style={{ color: N.label, fontSize: 11, fontFamily: MONO }}>CPU</span>
          <Dekatron rpm={d.fans[0].rpm} />
          <div style={{ width: 6 }} />
          <span style={{ color: N.label, fontSize: 11, fontFamily: MONO }}>CASE</span>
          {d.fans.slice(1).map((f, i) => <Dekatron key={i} rpm={f.rpm} />)}
        </div>
      </div>

      {/* Row 4: Headers */}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}><SectionLabel text="COMMS" color="#4488DD" rightText="1 GBPS" /></div>
        <div style={{ flex: 1 }}><SectionLabel text="NPU" color={N.warm} rightText="LLAMA.CPP" /></div>
      </div>

      {/* #3 FIX: Strict two-column layout, upload/download stays in left, T/S+VRAM in right */}
      <div style={{ display: "flex", gap: 8, flex: 1 }}>
        {/* Left: Comms */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TubeRow label="IP" value="192.168.1.42" />
            <TubeRow label="MAC" value="AB:CD:EF:12:34" />
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: N.eyeStd, textShadow: `0 0 4px ${N.eyeStd}88`, fontSize: 10, fontFamily: MONO }}>▲</span>
              <NixieDigit value={d.netUp.toFixed(1)} size={22} />
              <span style={{ color: N.label, fontSize: 10, fontFamily: MONO }}>MB/s</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#4488DD", textShadow: `0 0 4px #4488DD88`, fontSize: 10, fontFamily: MONO }}>▼</span>
              <NixieDigit value={d.netDown.toFixed(1)} size={22} />
              <span style={{ color: N.label, fontSize: 10, fontFamily: MONO }}>MB/s</span>
            </div>
          </div>
        </div>
        {/* Right: NPU — T/S and VRAM clearly in this column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TubeRow label="MODEL" value="Qwen3-30B-A3B" valueSize={17} />
            <TubeRow label="QUANT" value="Q4_K_M" valueSize={17} />
            <TubeRow label="CTX" value="8192" valueSize={17} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ color: N.label, fontSize: 11, fontFamily: MONO }}>T/S</span>
              <NixieDigit value={d.tokSec.toFixed(0)} size={26} />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ color: N.label, fontSize: 11, fontFamily: MONO }}>VRAM</span>
              <NixieDigit value={`${d.vramUsed.toFixed(1)}/${d.vramTotal}`} size={26} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// CLOCK SCREEN
// ═══════════════════════════════════════
function ClockScreen({ now }) {
  const h = now.getHours().toString().padStart(2, "0");
  const m = now.getMinutes().toString().padStart(2, "0");
  const s = now.getSeconds().toString().padStart(2, "0");
  const days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

  return (
    <div style={{ width: "100%", height: "100%", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: MONO }}>
      <div style={{ color: N.barDim, textShadow: `0 0 3px ${N.barDim}44`, fontSize: 11, letterSpacing: 8, marginBottom: 14 }}>NIXIE TUBE CHRONOMETER</div>

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <NixieDigit value={h[0]} size={90} showTube={true} />
        <NixieDigit value={h[1]} size={90} showTube={true} />
        <span style={{
          color: "#FFAA55", fontSize: 60, fontFamily: NIXIE,
          textShadow: `0 0 3px #fff, 0 0 8px #FFAA55, 0 0 16px #FF6600, 0 0 32px #FF4400AA, 0 0 50px #FF000044`,
          animation: "blink 1s infinite", margin: "0 2px",
        }}>:</span>
        <NixieDigit value={m[0]} size={90} showTube={true} />
        <NixieDigit value={m[1]} size={90} showTube={true} />
        <div style={{ width: 8 }} />
        <NixieDigit value={s[0]} size={50} showTube={true} />
        <NixieDigit value={s[1]} size={50} showTube={true} />
      </div>

      <div style={{ color: "#FFAA55", textShadow: `0 0 3px #fff, 0 0 8px #FFAA55, 0 0 18px #FF660066, 0 0 35px #FF440033`, fontSize: 26, fontFamily: NIXIE, letterSpacing: 8, marginTop: 14 }}>{days[now.getDay()]}</div>
      <div style={{ color: "#FFAA55", textShadow: `0 0 3px #fff, 0 0 8px #FFAA55, 0 0 18px #FF660066, 0 0 35px #FF440033`, fontSize: 30, fontFamily: NIXIE, letterSpacing: 4, marginTop: 4 }}>
        {months[now.getMonth()]} {now.getDate()}, {now.getFullYear()}
      </div>

      {/* Neon indicator lamps */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
        {[N.dekOrange, N.warm, N.eyeStd, "#8855DD", N.eyeStd, N.warm, N.dekOrange].map((c, i) => (
          <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: c, boxShadow: `0 0 4px ${c}, 0 0 8px ${c}66, 0 0 14px ${c}22`, opacity: 0.7 }} />
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
const SCREENS = ["System", "Clock"];
export default function App() {
  const [screen, setScreen] = useState(0);
  const d = useAnimatedData();
  const now = useTime();
  return (
    <div style={{ background: "#0E0A06", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nixie+One&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.1} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes nixieFlicker {
          0% { opacity: 1; }
          5% { opacity: 0.98; }
          10% { opacity: 1; }
          15% { opacity: 0.96; }
          17% { opacity: 1; }
          50% { opacity: 1; }
          52% { opacity: 0.97; }
          54% { opacity: 1; }
          80% { opacity: 1; }
          82% { opacity: 0.95; }
          83% { opacity: 1; }
          90% { opacity: 0.98; }
          100% { opacity: 1; }
        }
        @keyframes nixieMicroFlicker {
          0%, 100% { filter: brightness(1); }
          25% { filter: brightness(0.97); }
          50% { filter: brightness(1.02); }
          75% { filter: brightness(0.98); }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>
      <div style={{ color: N.barDim, textShadow: `0 0 3px ${N.barDim}33`, fontSize: 12, fontFamily: MONO, letterSpacing: 6, marginBottom: 12 }}>
        TUBE — NIXIE / MAGIC EYE / DEKATRON / IN-13 BARGRAPH
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {SCREENS.map((s, i) => (
          <button key={s} onClick={() => setScreen(i)} style={{
            padding: "6px 18px", border: `1px solid ${screen === i ? N.core : N.barDim}`,
            borderRadius: 2, background: screen === i ? `${N.bright}11` : "transparent",
            color: screen === i ? N.core : N.barDim,
            textShadow: screen === i ? `0 0 4px ${N.bright}66` : "none",
            cursor: "pointer", fontFamily: MONO, fontSize: 12, letterSpacing: 3, transition: "all 0.2s",
          }}>{s}</button>
        ))}
      </div>
      <div style={{
        width: 620, height: 364, border: `1px solid ${N.glass}55`, borderRadius: 3,
        background: BG, overflow: "hidden",
        boxShadow: `inset 0 0 40px ${BG}, 0 0 20px #00000088`,
      }}>
        {screen === 0 ? <SystemScreen d={d} /> : <ClockScreen now={now} />}
      </div>
      <div style={{ color: N.barDim, fontSize: 10, fontFamily: MONO, marginTop: 12, letterSpacing: 3, opacity: 0.4 }}>
        SIMULATED LIVE DATA • 7″ 1024×600
      </div>
    </div>
  );
}
