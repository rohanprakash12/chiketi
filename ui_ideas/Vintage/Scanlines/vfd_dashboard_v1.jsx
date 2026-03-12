import { useState, useEffect } from "react";

const FONT = "'Share Tech Mono', monospace";
const BG = "#060810";
const GLASS = "#0C1018";

// VFD phosphor colors with glow definitions
const V = {
  cyan: "#00FFCC",      // classic VFD cyan-green
  cyanDim: "#009977",
  amber: "#FFAA00",     // warm amber
  amberDim: "#996600",
  green: "#00FF88",     // bright green
  greenDim: "#009944",
  red: "#FF3344",       // alert red
  redDim: "#992222",
  blue: "#4488FF",      // cool blue
  blueDim: "#224488",
  white: "#CCDDEE",     // faint white
  dim: "#334455",       // inactive/background
  grid: "#0D1520",      // grid line color
};

// Glow helper — returns textShadow or boxShadow
const glow = (color, spread = 6) => `0 0 ${spread}px ${color}, 0 0 ${spread * 2}px ${color}44`;
const textGlow = (color, spread = 4) => ({ color, textShadow: `0 0 ${spread}px ${color}, 0 0 ${spread * 2}px ${color}66` });

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

// ─── VFD DONUT ───
function VfdDonut({ pct, label, color, size = 72 }) {
  const sw = 4;
  const r = (size - sw - 6) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  const valColor = pct > 80 ? V.red : color;
  const cx = size / 2, cy = size / 2;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ ...textGlow(color, 3), fontSize: 13, fontFamily: FONT, letterSpacing: 2, marginBottom: 2 }}>{label}</div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ filter: `drop-shadow(0 0 4px ${color}66)` }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={V.dim} strokeWidth={sw} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="butt"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 0.8s ease", filter: `drop-shadow(0 0 3px ${color})` }} />
        <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="central"
          fill={valColor} fontSize="20" fontFamily={FONT} style={{ filter: `drop-shadow(0 0 4px ${valColor})` }}>
          {Math.round(pct)}%
        </text>
      </svg>
    </div>
  );
}

// ─── VFD THERMAL BAR ───
function VfdThermalBar({ temp, label }) {
  const minT = 20, maxT = 120;
  const clampT = Math.max(minT, Math.min(maxT, temp));
  const pct = ((clampT - minT) / (maxT - minT)) * 100;
  let fillColor = V.blue;
  if (clampT >= 110) fillColor = V.red;
  else if (clampT >= 90) fillColor = V.amber;
  else if (clampT >= 70) fillColor = V.amber;
  else if (clampT >= 50) fillColor = V.green;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ ...textGlow(V.cyan, 3), fontSize: 13, fontFamily: FONT, width: 28, textAlign: "right", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 10, background: V.dim, borderRadius: 1, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, background: fillColor, borderRadius: 1,
          transition: "width 0.8s ease, background 0.5s ease",
          boxShadow: glow(fillColor, 4),
        }} />
      </div>
    </div>
  );
}

// ─── VFD SCALE ───
function VfdScale() {
  const minT = 20, maxT = 120;
  const marks = [20, 50, 70, 90, 110, 120];
  return (
    <div style={{ marginLeft: 34, position: "relative", height: 16 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: V.dim }} />
      {marks.map(t => {
        const pct = ((t - minT) / (maxT - minT)) * 100;
        return (
          <div key={t} style={{ position: "absolute", left: `${pct}%`, top: 0, transform: "translateX(-50%)" }}>
            <div style={{ width: 1, height: 5, background: V.cyanDim }} />
            <div style={{ ...textGlow(V.cyanDim, 2), fontSize: 10, fontFamily: FONT, textAlign: "center", marginTop: 1 }}>{t}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── VFD FAN ───
function FanIcon({ rpm, size = 18 }) {
  const speed = Math.max(0.3, 3 - (rpm / 600));
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ animation: `spin ${speed}s linear infinite`, filter: `drop-shadow(0 0 3px ${V.cyan}66)` }}>
      {[0, 90, 180, 270].map(angle => (
        <path key={angle} d="M20 20 C18 10, 12 4, 20 2 C28 4, 22 10, 20 20Z"
          fill={V.cyan} opacity="0.7" transform={`rotate(${angle} 20 20)`} />
      ))}
      <circle cx="20" cy="20" r="4" fill={BG} stroke={V.cyan} strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

// ─── VFD SECTION LABEL ───
function SectionLabel({ text, color = V.cyan, rightText, rightColor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
      <span style={{ ...textGlow(color, 4), fontSize: 14, fontFamily: FONT, letterSpacing: 3 }}>{text}</span>
      <div style={{ flex: 1, height: 1, background: `${color}33`, margin: "0 8px" }} />
      {rightText && <span style={{ ...textGlow(rightColor || color, 3), fontSize: 14, fontFamily: FONT, letterSpacing: 2 }}>{rightText}</span>}
    </div>
  );
}

// ─── VFD DATA ROW ───
function VfdRow({ label, value, color = V.cyan, valueSize = 22 }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ ...textGlow(V.cyanDim, 2), fontSize: 12, fontFamily: FONT, letterSpacing: 1 }}>{label}</span>
      <span style={{ ...textGlow(color, 4), fontSize: valueSize, fontFamily: FONT }}>{value}</span>
    </div>
  );
}

// ─── SCANLINE OVERLAY ───
function Scanlines() {
  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none",
      background: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)`,
      zIndex: 10,
    }} />
  );
}

// ═══════════════════════════════════════
// SYSTEM SCREEN
// ═══════════════════════════════════════
function SystemScreen({ d }) {
  const temps = [d.cpuTemp, d.mbTemp, d.gpuTemp];
  const anyDanger = temps.some(t => t >= 110);
  const anyOrange = temps.some(t => t >= 90);
  const status = anyDanger ? "CRITICAL" : anyOrange ? "WARNING" : "NOMINAL";
  const statusColor = anyDanger ? V.red : anyOrange ? V.amber : V.green;
  const secPct = d.hasSecondary ? (d.secUsed / d.secTotal) * 100 : 0;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: BG, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
      <Scanlines />

      {/* ROW 1: Headers */}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}><SectionLabel text="CORE SYSTEMS" color={V.cyan} rightText="ZION" /></div>
        <div style={{ flex: 1 }}><SectionLabel text="THERMALS" color={V.amber} rightText={status} rightColor={statusColor} /></div>
      </div>

      {/* ROW 2: Donuts | Bars */}
      <div style={{ display: "flex", gap: 8, flex: 1 }}>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-around", alignItems: "center" }}>
          <VfdDonut pct={d.cpu} label="CPU" color={V.amber} size={72} />
          <VfdDonut pct={d.ram} label="RAM" color={V.cyan} size={72} />
          <VfdDonut pct={d.ssd} label="SSD" color={V.green} size={72} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
          <VfdThermalBar temp={d.cpuTemp} label="CPU" />
          <VfdThermalBar temp={d.mbTemp} label="MB" />
          <VfdThermalBar temp={d.gpuTemp} label="GPU" />
          <VfdScale />
        </div>
      </div>

      {/* ROW 3: Secondary | Fans */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          {d.hasSecondary ? (
            <div style={{ position: "relative", height: 16, background: V.dim, borderRadius: 1, overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${secPct}%`, background: V.green, borderRadius: 1, transition: "width 0.8s ease", boxShadow: glow(V.green, 3) }} />
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px", fontFamily: FONT, fontSize: 10, ...textGlow(BG, 0) }}>
                <span style={{ color: BG }}>SECONDARY</span><span style={{ color: BG }}>{d.secUsed}T / {d.secTotal}T</span>
              </div>
            </div>
          ) : (
            <div style={{ height: 16, background: V.dim, borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: 10, color: V.dim }}>SECONDARY — NONE</div>
          )}
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
          <span style={{ ...textGlow(V.cyanDim, 2), fontSize: 12, fontFamily: FONT }}>CPU</span>
          <FanIcon rpm={d.fans[0].rpm} />
          <div style={{ width: 6 }} />
          <span style={{ ...textGlow(V.cyanDim, 2), fontSize: 12, fontFamily: FONT }}>CASE</span>
          {d.fans.slice(1).map((f, i) => <FanIcon key={i} rpm={f.rpm} />)}
        </div>
      </div>

      {/* ROW 4: Headers */}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}><SectionLabel text="COMMS" color={V.blue} rightText="1 GBPS" /></div>
        <div style={{ flex: 1 }}><SectionLabel text="NPU" color={V.amber} rightText="LLAMA.CPP" /></div>
      </div>

      {/* ROW 5+6: Data */}
      <div style={{ display: "flex", gap: 8, flex: 1 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <VfdRow label="IP" value="192.168.1.42" color={V.cyan} />
            <VfdRow label="MAC" value="AB:CD:EF:12:34" color={V.cyan} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...textGlow(V.green, 4), fontSize: 10, fontFamily: FONT }}>▲</span>
              <span style={{ ...textGlow(V.green, 4), fontSize: 24, fontFamily: FONT }}>{d.netUp.toFixed(1)} <span style={{ fontSize: 12 }}>MB/s</span></span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...textGlow(V.blue, 4), fontSize: 10, fontFamily: FONT }}>▼</span>
              <span style={{ ...textGlow(V.blue, 4), fontSize: 24, fontFamily: FONT }}>{d.netDown.toFixed(1)} <span style={{ fontSize: 12 }}>MB/s</span></span>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <VfdRow label="MODEL" value="Qwen3-30B-A3B" color={V.amber} valueSize={18} />
            <VfdRow label="QUANT" value="Q4_K_M" color={V.amber} valueSize={18} />
            <VfdRow label="CTX" value="8192" color={V.amber} valueSize={18} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ ...textGlow(V.cyanDim, 2), fontSize: 12, fontFamily: FONT }}>T/S</span>
              <span style={{ ...textGlow(V.cyan, 5), fontSize: 26, fontFamily: FONT }}>{d.tokSec.toFixed(0)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ ...textGlow(V.cyanDim, 2), fontSize: 12, fontFamily: FONT }}>VRAM</span>
              <span style={{ ...textGlow(V.cyan, 5), fontSize: 26, fontFamily: FONT }}>{d.vramUsed.toFixed(1)}/{d.vramTotal}</span>
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
    <div style={{ width: "100%", height: "100%", position: "relative", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      <Scanlines />

      {/* VFD phosphor glow header */}
      <div style={{ ...textGlow(V.cyanDim, 3), fontSize: 12, letterSpacing: 8, marginBottom: 12 }}>VACUUM FLUORESCENT CHRONOMETER</div>

      {/* Time display — big glowing digits */}
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <span style={{ ...textGlow(V.cyan, 10), fontSize: 130, letterSpacing: 6 }}>{h}</span>
        <span style={{ ...textGlow(V.amber, 8), fontSize: 90, animation: "blink 1s infinite", margin: "0 2px" }}>:</span>
        <span style={{ ...textGlow(V.cyan, 10), fontSize: 130, letterSpacing: 6 }}>{m}</span>
        <span style={{ ...textGlow(V.green, 6), fontSize: 56, marginLeft: 12 }}>{s}</span>
      </div>

      {/* Day */}
      <div style={{ ...textGlow(V.amber, 5), fontSize: 28, letterSpacing: 10, marginTop: 10 }}>{days[now.getDay()]}</div>

      {/* Date */}
      <div style={{ ...textGlow(V.cyan, 4), fontSize: 32, letterSpacing: 4, marginTop: 4 }}>
        {months[now.getMonth()]} {now.getDate()}, {now.getFullYear()}
      </div>

      {/* Decorative bottom bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, width: "70%" }}>
        <div style={{ flex: 1, height: 1, background: V.cyan, opacity: 0.15, boxShadow: glow(V.cyan, 2) }} />
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: V.green, boxShadow: glow(V.green, 4) }} />
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: V.amber, boxShadow: glow(V.amber, 4) }} />
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: V.cyan, boxShadow: glow(V.cyan, 4) }} />
        <div style={{ flex: 1, height: 1, background: V.cyan, opacity: 0.15, boxShadow: glow(V.cyan, 2) }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// MAIN
// ═══════════════════════════════════════
const SCREENS = ["System", "Clock"];

export default function App() {
  const [screen, setScreen] = useState(0);
  const d = useAnimatedData();
  const now = useTime();

  return (
    <div style={{ background: "#030406", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.1} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>

      <div style={{ ...textGlow(V.cyanDim, 2), fontSize: 13, fontFamily: FONT, letterSpacing: 6, marginBottom: 12 }}>
        VFD — VACUUM FLUORESCENT DISPLAY
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {SCREENS.map((s, i) => (
          <button key={s} onClick={() => setScreen(i)} style={{
            padding: "6px 20px", border: `1px solid ${screen === i ? V.cyan : V.dim}`,
            borderRadius: 1, background: screen === i ? `${V.cyan}11` : "transparent",
            ...textGlow(screen === i ? V.cyan : V.dim, screen === i ? 3 : 0),
            cursor: "pointer", fontFamily: FONT, fontSize: 13,
            letterSpacing: 3, transition: "all 0.2s",
          }}>{s}</button>
        ))}
      </div>

      <div style={{
        width: 620, height: 364, border: `1px solid ${V.dim}`, borderRadius: 2,
        background: BG, overflow: "hidden", position: "relative",
        boxShadow: `inset 0 0 60px ${BG}, 0 0 20px #00000088, 0 0 1px ${V.cyan}22`,
      }}>
        {screen === 0 ? <SystemScreen d={d} /> : <ClockScreen now={now} />}
      </div>

      <div style={{ ...textGlow(V.dim, 0), fontSize: 10, fontFamily: FONT, marginTop: 12, letterSpacing: 3 }}>
        SIMULATED LIVE DATA • 7″ 1024×600
      </div>
    </div>
  );
}
