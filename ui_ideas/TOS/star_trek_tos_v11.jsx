import { useState, useEffect } from "react";

const FONT = "'Chakra Petch', monospace";
const C = {
  gold: "#FDCD06", red: "#BF0F0F", blue: "#165FC5", green: "#B9C92F",
  teal: "#11709F", amber: "#FF8800", maroon: "#8B0000",
  thermBlue: "#2288DD", thermGreen: "#22BB44", thermYellow: "#DDCC00",
  thermOrange: "#FF7700", thermDarkRed: "#AA0000",
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

// ─── DONUT GAUGE (anticlockwise, label ABOVE) ───
function Donut({ pct, label, color, size = 72 }) {
  const sw = 6;
  const r = (size - sw - 4) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  const valColor = pct > 80 ? C.red : "#FFFFFF";
  const cx = size / 2, cy = size / 2;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: "#aaa", fontSize: 16, fontFamily: FONT, fontWeight: 600, letterSpacing: 1, marginBottom: 2 }}>{label}</div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a1a1a" strokeWidth={sw} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`translate(${size}, 0) scale(-1, 1) rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 0.8s ease" }} />
        <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="central"
          fill={valColor} fontSize="22" fontFamily={FONT} fontWeight="700">
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
      <span style={{ color: C.gold, fontSize: 16, fontFamily: FONT, fontWeight: 700, width: 32, textAlign: "right", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 12, background: "#1a1a1a", borderRadius: 2, overflow: "hidden", position: "relative" }}>
        <div style={{
          position: "absolute", top: 0, left: 0, height: "100%",
          width: `${pct}%`, background: fillColor, borderRadius: 2,
          transition: "width 0.8s ease, background 0.5s ease",
        }} />
      </div>
    </div>
  );
}

// ─── THERMAL SCALE ───
function ThermalScale() {
  const minT = 20, maxT = 120;
  const marks = [20, 50, 70, 90, 110, 120];
  return (
    <div style={{ display: "flex", alignItems: "flex-start", marginLeft: 38 }}>
      <div style={{ flex: 1, position: "relative", height: 16 }}>
        {/* Tick line */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "#333" }} />
        {marks.map(t => {
          const pct = ((t - minT) / (maxT - minT)) * 100;
          return (
            <div key={t} style={{ position: "absolute", left: `${pct}%`, top: 0, transform: "translateX(-50%)" }}>
              <div style={{ width: 1, height: 6, background: "#555" }} />
              <div style={{ color: "#555", fontSize: 10, fontFamily: FONT, textAlign: "center", marginTop: 1 }}>{t}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ROTATING FAN ───
function FanIcon({ rpm, size = 20 }) {
  const speed = Math.max(0.3, 3 - (rpm / 600));
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ animation: `spin ${speed}s linear infinite` }}>
      {[0, 90, 180, 270].map(angle => (
        <path key={angle} d="M20 20 C18 10, 12 4, 20 2 C28 4, 22 10, 20 20Z"
          fill={C.red} opacity="0.9" transform={`rotate(${angle} 20 20)`} />
      ))}
      <circle cx="20" cy="20" r="4" fill="#333" stroke={C.red} strokeWidth="1" />
    </svg>
  );
}

// ─── PANEL ───
function Panel({ titleLeft, titleRight, titleRightColor, color = C.gold, children }) {
  return (
    <div style={{ border: `2px solid ${color}`, background: "#000", overflow: "hidden", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ background: color, padding: "1px 8px", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#000", fontSize: 18, fontFamily: FONT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 }}>{titleLeft}</span>
        {titleRight && (
          <span style={{ color: titleRightColor || "#000", fontSize: 18, fontFamily: FONT, fontWeight: 700, textTransform: "uppercase" }}>{titleRight}</span>
        )}
      </div>
      <div style={{ padding: "3px 6px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// CORE BOX
// ═══════════════════════════════════════
function CoreBox({ d }) {
  const secPct = d.hasSecondary ? (d.secUsed / d.secTotal) * 100 : 0;
  return (
    <Panel titleLeft="Core" titleRight="ZION" color={C.gold}>
      <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", flex: 1 }}>
        <Donut pct={d.cpu} label="CPU" color={C.gold} size={72} />
        <Donut pct={d.ram} label="RAM" color={C.blue} size={72} />
        <Donut pct={d.ssd} label="SSD" color={C.maroon} size={72} />
      </div>
      {d.hasSecondary ? (
        <div style={{ position: "relative", height: 20, background: C.green, borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            position: "absolute", top: 0, left: 0, height: "100%",
            width: `${secPct}%`, background: C.gold, borderRadius: 3,
            transition: "width 0.8s ease",
          }} />
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: "100%",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "0 8px", fontFamily: FONT, fontSize: 13, fontWeight: 700, color: "#000",
          }}>
            <span>SECONDARY</span>
            <span>{d.secUsed}T / {d.secTotal}T</span>
          </div>
        </div>
      ) : (
        <div style={{
          height: 20, background: "#111", borderRadius: 3,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: FONT, fontSize: 13, color: "#444",
        }}>SECONDARY — NONE</div>
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════
// THERMALS BOX — horizontal bars
// ═══════════════════════════════════════
function ThermalsBox({ d }) {
  const temps = [d.cpuTemp, d.mbTemp, d.gpuTemp];
  const anyDanger = temps.some(t => t >= 110);
  const anyOrange = temps.some(t => t >= 90);
  const status = anyDanger ? "CRITICAL" : anyOrange ? "WARNING" : "NORMAL";
  const statusColor = anyDanger ? C.thermDarkRed : anyOrange ? C.thermOrange : C.green;

  return (
    <Panel titleLeft="Thermals" titleRight={status} titleRightColor={statusColor} color={C.amber}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, justifyContent: "center" }}>
        <ThermalBar temp={d.cpuTemp} label="CPU" />
        <ThermalBar temp={d.mbTemp} label="MB" />
        <ThermalBar temp={d.gpuTemp} label="GPU" />
        <ThermalScale />
      </div>
      {/* Fan strip */}
      <div style={{
        background: `${C.red}22`, borderRadius: 3, padding: "3px 8px",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ color: C.red, fontSize: 14, fontFamily: FONT, fontWeight: 700 }}>CPU</span>
        <FanIcon rpm={d.fans[0].rpm} size={20} />
        <div style={{ width: 8 }} />
        <span style={{ color: C.red, fontSize: 14, fontFamily: FONT, fontWeight: 700 }}>CASE</span>
        {d.fans.slice(1).map((f, i) => (
          <FanIcon key={i} rpm={f.rpm} size={20} />
        ))}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════
// COMMS BOX
// ═══════════════════════════════════════
function CommsBox({ d }) {
  return (
    <Panel titleLeft="Comms" titleRight="1 GBPS" color={C.teal}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#666", fontSize: 14, fontFamily: FONT }}>IP</span>
          <span style={{ color: "#ddd", fontSize: 24, fontFamily: FONT, fontWeight: 700 }}>192.168.1.42</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#666", fontSize: 14, fontFamily: FONT }}>MAC</span>
          <span style={{ color: "#ddd", fontSize: 24, fontFamily: FONT, fontWeight: 700 }}>AB:CD:EF:12:34</span>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <polygon points="12,2 4,14 20,14" fill={C.green} />
          </svg>
          <span style={{ color: C.green, fontSize: 28, fontFamily: FONT, fontWeight: 700 }}>
            {d.netUp.toFixed(1)} <span style={{ fontSize: 16 }}>MB/s</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <polygon points="12,22 4,10 20,10" fill={C.teal} />
          </svg>
          <span style={{ color: C.teal, fontSize: 28, fontFamily: FONT, fontWeight: 700 }}>
            {d.netDown.toFixed(1)} <span style={{ fontSize: 16 }}>MB/s</span>
          </span>
        </div>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════
// NPU BOX
// ═══════════════════════════════════════
function NpuBox({ d }) {
  return (
    <Panel titleLeft="NPU" titleRight="llama.cpp" color={C.gold}>
      {[
        ["Model", "Qwen3-30B-A3B", 14, 20],
        ["Quant", "Q4_K_M", 14, 20],
        ["Ctx", "8192", 14, 20],
      ].map(([k, v, labelSize, valSize]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ color: "#666", fontSize: labelSize, fontFamily: FONT, textTransform: "uppercase" }}>{k}</span>
          <span style={{ color: "#ddd", fontSize: valSize, fontFamily: FONT, fontWeight: 700 }}>{v}</span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ color: "#666", fontSize: 14, fontFamily: FONT }}>T/S</span>
          <span style={{ color: "#ddd", fontSize: 28, fontFamily: FONT, fontWeight: 700 }}>{d.tokSec.toFixed(0)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ color: "#666", fontSize: 14, fontFamily: FONT }}>VRAM</span>
          <span style={{ color: "#ddd", fontSize: 28, fontFamily: FONT, fontWeight: 700 }}>{d.vramUsed.toFixed(1)}/{d.vramTotal}</span>
        </div>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════
function ClockScreen({ now }) {
  const h = now.getHours().toString().padStart(2, "0");
  const m = now.getMinutes().toString().padStart(2, "0");
  const s = now.getSeconds().toString().padStart(2, "0");
  const days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  return (
    <div style={{ background: "#000", width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      <div style={{ color: C.gold, fontSize: 14, textTransform: "uppercase", letterSpacing: 8, marginBottom: 6 }}>United Federation of Planets</div>
      <div style={{ border: `2px solid ${C.gold}`, padding: "14px 50px", position: "relative" }}>
        <div style={{ position: "absolute", top: -9, left: 24, background: "#000", padding: "0 10px", color: C.amber, fontSize: 12, letterSpacing: 2 }}>SHIP CHRONOMETER</div>
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <span style={{ color: C.gold, fontSize: 120, fontWeight: 700, textShadow: `0 0 30px ${C.gold}33` }}>{h}</span>
          <span style={{ color: C.gold, fontSize: 84, animation: "blink 1s infinite", margin: "0 2px" }}>:</span>
          <span style={{ color: C.gold, fontSize: 120, fontWeight: 700, textShadow: `0 0 30px ${C.gold}33` }}>{m}</span>
          <span style={{ color: C.amber, fontSize: 52, marginLeft: 10 }}>{s}</span>
        </div>
      </div>
      <div style={{ color: C.green, fontSize: 28, letterSpacing: 6, marginTop: 18, textTransform: "uppercase" }}>{days[now.getDay()]}</div>
      <div style={{ color: "#ddd", fontSize: 34, letterSpacing: 3, marginTop: 6 }}>
        {months[now.getMonth()]} {now.getDate()}, {now.getFullYear()}
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
    <div style={{ background: "#111", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;600;700&display=swap');
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.12} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>

      <div style={{ color: "#888", fontSize: 14, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 6, marginBottom: 12 }}>
        TOS — The Original Series
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {SCREENS.map((s, i) => (
          <button key={s} onClick={() => setScreen(i)} style={{
            padding: "6px 20px", border: `2px solid ${screen === i ? C.gold : "#333"}`,
            borderRadius: 0, background: screen === i ? `${C.gold}15` : "transparent",
            color: screen === i ? C.gold : "#555", cursor: "pointer",
            fontFamily: FONT, fontSize: 14, textTransform: "uppercase",
            letterSpacing: 3, transition: "all 0.2s",
          }}>{s}</button>
        ))}
      </div>

      <div style={{
        width: 620, height: 364, border: "3px solid #1a1a1a", borderRadius: 4,
        background: "#000", overflow: "hidden",
        boxShadow: "0 0 60px #00000088, 0 2px 20px #00000066",
      }}>
        {screen === 0 ? (
          <div style={{ width: "100%", height: "100%", padding: 4, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 4 }}>
            <CoreBox d={d} />
            <ThermalsBox d={d} />
            <CommsBox d={d} />
            <NpuBox d={d} />
          </div>
        ) : (
          <ClockScreen now={now} />
        )}
      </div>

      <div style={{ color: "#333", fontSize: 11, fontFamily: FONT, marginTop: 12, textTransform: "uppercase", letterSpacing: 3 }}>
        Simulated live data • 7″ 1024×600
      </div>
    </div>
  );
}
