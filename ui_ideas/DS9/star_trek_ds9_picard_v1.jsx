import { useState, useEffect } from "react";

// DS9/Picard fusion: Rajdhani font, steel greys + teal + burnt orange
const FONT = "'Rajdhani', sans-serif";
const C = {
  burnt: "#E7442A",     // Picard red-orange — primary accent
  steel: "#9EA5BA",     // Picard steel grey — labels
  slate: "#6D748C",     // Picard slate — secondary
  navy: "#2F3749",      // Picard dark navy — backgrounds
  void: "#111419",      // Picard near-black
  teal: "#2A9D8F",      // DS9 teal — core accent
  cyan: "#66CCCC",      // DS9 light cyan — data values
  lavender: "#8888BB",  // DS9 light violet
  pale: "#AAAACC",      // DS9 pale lavender — primary text
  deepBlue: "#2A2A55",  // DS9 deep indigo
  warm: "#CCAA77",      // warm gold accent
  alert: "#FF4444",     // alert red
  thermBlue: "#4488AA", thermGreen: "#55AA77", thermYellow: "#CCAA44",
  thermOrange: "#DD7733", thermDarkRed: "#BB3333",
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

// ─── DS9 ANGULAR SECTION HEADER ───
// Angled left edge, straight right — Cardassian-inspired
function SectionHeader({ title, color = C.burnt, rightText }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 4, height: 20 }}>
      <svg width="14" height="20" viewBox="0 0 14 20" style={{ flexShrink: 0 }}>
        <polygon points="14,0 14,20 0,20" fill={color} />
      </svg>
      <div style={{ background: color, height: 20, padding: "0 10px", display: "flex", alignItems: "center" }}>
        <span style={{ color: C.void, fontSize: 13, fontFamily: FONT, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2 }}>{title}</span>
      </div>
      <div style={{ flex: 1, height: 2, background: color, opacity: 0.4 }} />
      {rightText && (
        <span style={{ color, fontSize: 14, fontFamily: FONT, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginLeft: 6 }}>{rightText}</span>
      )}
    </div>
  );
}

// ─── DS9 DONUT ───
function Ds9Donut({ pct, label, color, size = 72 }) {
  const sw = 5;
  const r = (size - sw - 4) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  const valColor = pct > 80 ? C.alert : C.pale;
  const cx = size / 2, cy = size / 2;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: C.steel, fontSize: 14, fontFamily: FONT, fontWeight: 600, letterSpacing: 1, marginBottom: 2, textTransform: "uppercase" }}>{label}</div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.navy} strokeWidth={sw} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="butt"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 0.8s ease" }} />
        <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="central"
          fill={valColor} fontSize="22" fontFamily={FONT} fontWeight="600">
          {Math.round(pct)}%
        </text>
      </svg>
    </div>
  );
}

// ─── THERMAL BAR ───
function ThermalBar({ temp, label }) {
  const minT = 20, maxT = 120;
  const clampT = Math.max(minT, Math.min(maxT, temp));
  const pct = ((clampT - minT) / (maxT - minT)) * 100;
  let fillColor = C.thermBlue;
  if (clampT >= 110) fillColor = C.thermDarkRed;
  else if (clampT >= 90) fillColor = C.thermOrange;
  else if (clampT >= 70) fillColor = C.thermYellow;
  else if (clampT >= 50) fillColor = C.thermGreen;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: C.steel, fontSize: 14, fontFamily: FONT, fontWeight: 600, width: 28, textAlign: "right", flexShrink: 0, textTransform: "uppercase" }}>{label}</span>
      <div style={{ flex: 1, height: 14, background: C.navy, borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, background: fillColor, borderRadius: 2,
          transition: "width 0.8s ease, background 0.5s ease",
        }} />
      </div>
    </div>
  );
}

// ─── SCALE ───
function ThermalScale() {
  const minT = 20, maxT = 120;
  const marks = [20, 50, 70, 90, 110, 120];
  return (
    <div style={{ marginLeft: 34, position: "relative", height: 18 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: C.slate }} />
      {marks.map(t => {
        const pct = ((t - minT) / (maxT - minT)) * 100;
        return (
          <div key={t} style={{ position: "absolute", left: `${pct}%`, top: 0, transform: "translateX(-50%)" }}>
            <div style={{ width: 1, height: 6, background: C.steel }} />
            <div style={{ color: C.steel, fontSize: 12, fontFamily: FONT, textAlign: "center", marginTop: 1 }}>{t}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── FAN ───
function FanIcon({ rpm, size = 20 }) {
  const speed = Math.max(0.3, 3 - (rpm / 600));
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ animation: `spin ${speed}s linear infinite` }}>
      {[0, 90, 180, 270].map(angle => (
        <path key={angle} d="M20 20 C18 10, 12 4, 20 2 C28 4, 22 10, 20 20Z"
          fill="#888899" opacity="0.9" transform={`rotate(${angle} 20 20)`} />
      ))}
      <circle cx="20" cy="20" r="4" fill={C.void} stroke="#888899" strokeWidth="1" />
    </svg>
  );
}

// ─── DATA ROW ───
function DataRow({ label, value, valueSize = 24 }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ color: C.steel, fontSize: 14, fontFamily: FONT, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
      <span style={{ color: C.pale, fontSize: valueSize, fontFamily: FONT, fontWeight: 600 }}>{value}</span>
    </div>
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
  const secPct = d.hasSecondary ? (d.secUsed / d.secTotal) * 100 : 0;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.void, padding: 6, gap: 4 }}>
      {/* ROW 1: Headers */}
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }}><SectionHeader title="Core Systems" color={C.teal} rightText="ZION" /></div>
        <div style={{ flex: 1 }}><SectionHeader title="Thermals" color={C.burnt} rightText={status} /></div>
      </div>

      {/* ROW 2: Donuts | Thermal bars */}
      <div style={{ display: "flex", gap: 6, flex: 1 }}>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-around", alignItems: "center" }}>
          <Ds9Donut pct={d.cpu} label="CPU" color={C.burnt} size={72} />
          <Ds9Donut pct={d.ram} label="RAM" color={C.teal} size={72} />
          <Ds9Donut pct={d.ssd} label="SSD" color={C.lavender} size={72} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
          <ThermalBar temp={d.cpuTemp} label="CPU" />
          <ThermalBar temp={d.mbTemp} label="MB" />
          <ThermalBar temp={d.gpuTemp} label="GPU" />
          <ThermalScale />
        </div>
      </div>

      {/* ROW 3: Secondary | Fans */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          {d.hasSecondary ? (
            <div style={{ position: "relative", height: 18, background: C.navy, borderRadius: 2, overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${secPct}%`, background: C.teal, borderRadius: 2, transition: "width 0.8s ease" }} />
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 10px", fontFamily: FONT, fontSize: 12, fontWeight: 600, color: C.void }}>
                <span>SECONDARY</span><span>{d.secUsed}T / {d.secTotal}T</span>
              </div>
            </div>
          ) : (
            <div style={{ height: 18, background: C.navy, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: 12, color: C.slate }}>SECONDARY — NONE</div>
          )}
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#888899", fontSize: 14, fontFamily: FONT, fontWeight: 600 }}>CPU</span>
          <FanIcon rpm={d.fans[0].rpm} />
          <div style={{ width: 8 }} />
          <span style={{ color: "#888899", fontSize: 14, fontFamily: FONT, fontWeight: 600 }}>CASE</span>
          {d.fans.slice(1).map((f, i) => <FanIcon key={i} rpm={f.rpm} />)}
        </div>
      </div>

      {/* ROW 4: Headers */}
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }}><SectionHeader title="Comms" color={C.lavender} rightText="1 GBPS" /></div>
        <div style={{ flex: 1 }}><SectionHeader title="NPU" color={C.warm} rightText="llama.cpp" /></div>
      </div>

      {/* ROW 5+6: Comms | NPU */}
      <div style={{ display: "flex", gap: 6, flex: 1 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <DataRow label="IP" value="192.168.1.42" />
            <DataRow label="MAC" value="AB:CD:EF:12:34" />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <svg width="16" height="16" viewBox="0 0 24 24"><polygon points="12,2 4,14 20,14" fill={C.teal} /></svg>
              <span style={{ color: C.teal, fontSize: 26, fontFamily: FONT, fontWeight: 600 }}>{d.netUp.toFixed(1)} <span style={{ fontSize: 14 }}>MB/s</span></span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <svg width="16" height="16" viewBox="0 0 24 24"><polygon points="12,22 4,10 20,10" fill={C.lavender} /></svg>
              <span style={{ color: C.lavender, fontSize: 26, fontFamily: FONT, fontWeight: 600 }}>{d.netDown.toFixed(1)} <span style={{ fontSize: 14 }}>MB/s</span></span>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <DataRow label="Model" value="Qwen3-30B-A3B" valueSize={20} />
            <DataRow label="Quant" value="Q4_K_M" valueSize={20} />
            <DataRow label="Ctx" value="8192" valueSize={20} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ color: C.steel, fontSize: 14, fontFamily: FONT, fontWeight: 600 }}>T/S</span>
              <span style={{ color: C.cyan, fontSize: 26, fontFamily: FONT, fontWeight: 600 }}>{d.tokSec.toFixed(0)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ color: C.steel, fontSize: 14, fontFamily: FONT, fontWeight: 600 }}>VRAM</span>
              <span style={{ color: C.cyan, fontSize: 26, fontFamily: FONT, fontWeight: 600 }}>{d.vramUsed.toFixed(1)}/{d.vramTotal}</span>
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
    <div style={{ width: "100%", height: "100%", background: C.void, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      {/* Angular accent lines top */}
      <div style={{ display: "flex", width: "80%", alignItems: "center", gap: 0, marginBottom: 8 }}>
        <div style={{ flex: 1, height: 2, background: C.teal, opacity: 0.4 }} />
        <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="0,14 14,0 14,14" fill={C.teal} opacity="0.6" /></svg>
        <div style={{ padding: "0 12px" }}>
          <span style={{ color: C.teal, fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 6 }}>BAJORAN SECTOR</span>
        </div>
        <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="0,0 14,14 0,14" fill={C.teal} opacity="0.6" /></svg>
        <div style={{ flex: 1, height: 2, background: C.teal, opacity: 0.4 }} />
      </div>

      <div style={{ display: "flex", alignItems: "baseline" }}>
        <span style={{ color: C.pale, fontSize: 120, fontWeight: 600, letterSpacing: 4 }}>{h}</span>
        <span style={{ color: C.burnt, fontSize: 84, animation: "blink 1s infinite", margin: "0 4px" }}>:</span>
        <span style={{ color: C.pale, fontSize: 120, fontWeight: 600, letterSpacing: 4 }}>{m}</span>
        <span style={{ color: C.steel, fontSize: 52, marginLeft: 12 }}>{s}</span>
      </div>
      <div style={{ color: C.teal, fontSize: 28, letterSpacing: 8, marginTop: 10, textTransform: "uppercase", fontWeight: 600 }}>{days[now.getDay()]}</div>
      <div style={{ color: C.lavender, fontSize: 34, letterSpacing: 4, marginTop: 4, fontWeight: 500 }}>
        {months[now.getMonth()]} {now.getDate()}, {now.getFullYear()}
      </div>

      {/* Angular accent lines bottom */}
      <div style={{ display: "flex", width: "80%", alignItems: "center", gap: 0, marginTop: 12 }}>
        <div style={{ flex: 1, height: 2, background: C.burnt, opacity: 0.3 }} />
        <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="0,10 10,0 10,10" fill={C.burnt} opacity="0.5" /></svg>
        <div style={{ padding: "0 10px" }}>
          <span style={{ color: C.steel, fontSize: 12, fontWeight: 600, letterSpacing: 3 }}>STATION CHRONOMETER</span>
        </div>
        <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="0,0 10,10 0,10" fill={C.burnt} opacity="0.5" /></svg>
        <div style={{ flex: 1, height: 2, background: C.burnt, opacity: 0.3 }} />
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
    <div style={{ background: "#0a0a0e", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&display=swap');
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.12} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>

      <div style={{ color: "#555", fontSize: 14, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 6, marginBottom: 12 }}>
        DS9 / PICARD — Deep Space Nine
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {SCREENS.map((s, i) => (
          <button key={s} onClick={() => setScreen(i)} style={{
            padding: "6px 20px", border: `1px solid ${screen === i ? C.teal : "#333"}`,
            borderRadius: 2, background: screen === i ? `${C.teal}22` : "transparent",
            color: screen === i ? C.teal : "#555", cursor: "pointer",
            fontFamily: FONT, fontSize: 14, fontWeight: 600, textTransform: "uppercase",
            letterSpacing: 3, transition: "all 0.2s",
          }}>{s}</button>
        ))}
      </div>

      <div style={{
        width: 620, height: 364, border: `2px solid ${C.navy}`, borderRadius: 2,
        background: C.void, overflow: "hidden",
        boxShadow: `0 0 40px ${C.void}, 0 0 2px ${C.teal}33`,
      }}>
        {screen === 0 ? <SystemScreen d={d} /> : <ClockScreen now={now} />}
      </div>

      <div style={{ color: "#333", fontSize: 11, fontFamily: FONT, marginTop: 12, textTransform: "uppercase", letterSpacing: 3 }}>
        Simulated live data \u2022 7\u2033 1024\u00D7600
      </div>
    </div>
  );
}
