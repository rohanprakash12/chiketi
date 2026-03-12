import { useState, useEffect } from "react";

const FONT = "'Antonio', sans-serif";
const C = {
  tanoi: "#FFCC99", goldenTanoi: "#FFCC66", neonCarrot: "#FF9933",
  lilac: "#CC99CC", anakiwa: "#99CCFF", eggplant: "#664466",
  mariner: "#3366CC", bahama: "#006699", paleCanary: "#FFFF99",
  sunflower: "#FFCC99", ice: "#99CCFF", bluey: "#8899FF",
  africanViolet: "#CC99FF", hopbush: "#CC6699", mars: "#FF2200",
  green: "#999933", gold: "#FFAA00",
  thermBlue: "#99CCFF", thermGreen: "#99CC66", thermYellow: "#FFCC66",
  thermOrange: "#FF9933", thermDarkRed: "#CC4444",
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

// ─── LCARS PILL BUTTON ───
function Pill({ color, text, w, h = 22, textColor = "#000", textAlign = "right", fontSize = 14 }) {
  return (
    <div style={{
      background: color, borderRadius: h / 2, height: h, width: w || "auto",
      padding: `0 ${h / 2}px`, display: "flex", alignItems: "center",
      justifyContent: textAlign === "right" ? "flex-end" : textAlign === "center" ? "center" : "flex-start",
    }}>
      {text && <span style={{ color: textColor, fontSize, fontFamily: FONT, fontWeight: 400, textTransform: "uppercase", letterSpacing: 1 }}>{text}</span>}
    </div>
  );
}

// ─── LCARS DONUT (clockwise, LCARS style) ───
function LcarsDonut({ pct, label, color, size = 68 }) {
  const sw = 5;
  const r = (size - sw - 4) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  const valColor = pct > 80 ? C.mars : C.paleCanary;
  const cx = size / 2, cy = size / 2;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: C.tanoi, fontSize: 14, fontFamily: FONT, letterSpacing: 1, marginBottom: 2, textTransform: "uppercase" }}>{label}</div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a1a2a" strokeWidth={sw} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 0.8s ease" }} />
        <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="central"
          fill={valColor} fontSize="20" fontFamily={FONT} fontWeight="400">
          {Math.round(pct)}%
        </text>
      </svg>
    </div>
  );
}

// ─── THERMAL BAR (LCARS style) ───
function LcarsThermalBar({ temp, label }) {
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
      <span style={{ color: C.tanoi, fontSize: 14, fontFamily: FONT, width: 28, textAlign: "right", flexShrink: 0, textTransform: "uppercase" }}>{label}</span>
      <div style={{ flex: 1, height: 14, background: "#1a1a2a", borderRadius: 7, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, background: fillColor, borderRadius: 7,
          transition: "width 0.8s ease, background 0.5s ease",
        }} />
      </div>
    </div>
  );
}

// ─── THERMAL SCALE ───
function LcarsScale() {
  const minT = 20, maxT = 120;
  const marks = [20, 50, 70, 90, 110, 120];
  return (
    <div style={{ marginLeft: 34, position: "relative", height: 18 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "#333" }} />
      {marks.map(t => {
        const pct = ((t - minT) / (maxT - minT)) * 100;
        return (
          <div key={t} style={{ position: "absolute", left: `${pct}%`, top: 0, transform: "translateX(-50%)" }}>
            <div style={{ width: 1, height: 6, background: C.tanoi }} />
            <div style={{ color: C.tanoi, fontSize: 12, fontFamily: FONT, textAlign: "center", marginTop: 1 }}>{t}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── ROTATING FAN ───
function FanIcon({ rpm, size = 18 }) {
  const speed = Math.max(0.3, 3 - (rpm / 600));
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ animation: `spin ${speed}s linear infinite` }}>
      {[0, 90, 180, 270].map(angle => (
        <path key={angle} d="M20 20 C18 10, 12 4, 20 2 C28 4, 22 10, 20 20Z"
          fill="#AAAAAA" opacity="0.9" transform={`rotate(${angle} 20 20)`} />
      ))}
      <circle cx="20" cy="20" r="4" fill="#111" stroke="#AAAAAA" strokeWidth="1" />
    </svg>
  );
}

// ─── LCARS SECTION HEADER (pill divider) ───
function SectionHeader({ title, color = C.neonCarrot, rightText }) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
      <div style={{ background: color, borderRadius: 8, height: 16, padding: "0 10px", display: "flex", alignItems: "center" }}>
        <span style={{ color: "#000", fontSize: 12, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 1 }}>{title}</span>
      </div>
      <div style={{ flex: 1, height: 3, background: color, borderRadius: 2 }} />
      {rightText && (
        <span style={{ color, fontSize: 14, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 1 }}>{rightText}</span>
      )}
    </div>
  );
}

// ─── LCARS DATA ROW ───
function DataRow({ label, value, labelColor = C.tanoi, valueColor = C.paleCanary, valueSize = 24 }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ color: labelColor, fontSize: 14, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
      <span style={{ color: valueColor, fontSize: valueSize, fontFamily: FONT, textAlign: "right" }}>{value}</span>
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
  const statusColor = anyDanger ? C.mars : anyOrange ? C.neonCarrot : C.anakiwa;
  const secPct = d.hasSecondary ? (d.secUsed / d.secTotal) * 100 : 0;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#000", padding: 6, gap: 4 }}>
      {/* ROW 1: Headers */}
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }}><SectionHeader title="Core Systems" color={C.goldenTanoi} rightText="ZION" /></div>
        <div style={{ flex: 1 }}><SectionHeader title="Thermals" color={C.neonCarrot} rightText={status} /></div>
      </div>

      {/* ROW 2: Donuts | Thermal bars */}
      <div style={{ display: "flex", gap: 6, flex: 1 }}>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-around", alignItems: "center" }}>
          <LcarsDonut pct={d.cpu} label="CPU" color={C.neonCarrot} size={72} />
          <LcarsDonut pct={d.ram} label="RAM" color={C.anakiwa} size={72} />
          <LcarsDonut pct={d.ssd} label="SSD" color={C.lilac} size={72} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
          <LcarsThermalBar temp={d.cpuTemp} label="CPU" />
          <LcarsThermalBar temp={d.mbTemp} label="MB" />
          <LcarsThermalBar temp={d.gpuTemp} label="GPU" />
          <LcarsScale />
        </div>
      </div>

      {/* ROW 3: Secondary storage | Fans — same horizontal line */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          {d.hasSecondary ? (
            <div style={{ position: "relative", height: 18, background: C.eggplant, borderRadius: 9, overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${secPct}%`, background: C.goldenTanoi, borderRadius: 9, transition: "width 0.8s ease" }} />
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 10px", fontFamily: FONT, fontSize: 12, color: "#000" }}>
                <span>SECONDARY</span><span>{d.secUsed}T / {d.secTotal}T</span>
              </div>
            </div>
          ) : (
            <div style={{ height: 18, background: "#111", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: 12, color: C.eggplant }}>SECONDARY — NONE</div>
          )}
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#AAAAAA", fontSize: 14, fontFamily: FONT }}>CPU</span>
          <FanIcon rpm={d.fans[0].rpm} size={20} />
          <div style={{ width: 8 }} />
          <span style={{ color: "#AAAAAA", fontSize: 14, fontFamily: FONT }}>CASE</span>
          {d.fans.slice(1).map((f, i) => <FanIcon key={i} rpm={f.rpm} size={20} />)}
        </div>
      </div>

      {/* ROW 4: Comms + NPU headers */}
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }}><SectionHeader title="Comms" color={C.anakiwa} rightText="1 GBPS" /></div>
        <div style={{ flex: 1 }}><SectionHeader title="NPU" color={C.lilac} rightText="llama.cpp" /></div>
      </div>

      {/* ROW 5+6: Comms data | NPU data — strict two columns */}
      <div style={{ display: "flex", gap: 6, flex: 1 }}>
        {/* Left: Comms */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <DataRow label="IP" value="192.168.1.42" />
            <DataRow label="MAC" value="AB:CD:EF:12:34" />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <svg width="16" height="16" viewBox="0 0 24 24"><polygon points="12,2 4,14 20,14" fill={C.anakiwa} /></svg>
              <span style={{ color: C.anakiwa, fontSize: 26, fontFamily: FONT }}>{d.netUp.toFixed(1)} <span style={{ fontSize: 14 }}>MB/s</span></span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <svg width="16" height="16" viewBox="0 0 24 24"><polygon points="12,22 4,10 20,10" fill={C.mariner} /></svg>
              <span style={{ color: C.mariner, fontSize: 26, fontFamily: FONT }}>{d.netDown.toFixed(1)} <span style={{ fontSize: 14 }}>MB/s</span></span>
            </div>
          </div>
        </div>
        {/* Right: NPU */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <DataRow label="Model" value="Qwen3-30B-A3B" valueSize={20} />
            <DataRow label="Quant" value="Q4_K_M" valueSize={20} />
            <DataRow label="Ctx" value="8192" valueSize={20} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ color: C.tanoi, fontSize: 14, fontFamily: FONT }}>T/S</span>
              <span style={{ color: C.paleCanary, fontSize: 26, fontFamily: FONT }}>{d.tokSec.toFixed(0)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ color: C.tanoi, fontSize: 14, fontFamily: FONT }}>VRAM</span>
              <span style={{ color: C.paleCanary, fontSize: 26, fontFamily: FONT }}>{d.vramUsed.toFixed(1)}/{d.vramTotal}</span>
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
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#000" }}>
      {/* LCARS LEFT SIDEBAR */}
      <div style={{ width: 50, flexShrink: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ height: 28, display: "flex" }}>
          <div style={{ width: 50, height: 28, background: C.anakiwa, borderBottomLeftRadius: 20 }} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, paddingTop: 6 }}>
          <div style={{ background: C.goldenTanoi, height: 24, borderTopRightRadius: 12, borderBottomRightRadius: 12, width: 46 }} />
          <div style={{ background: C.neonCarrot, height: 24, borderTopRightRadius: 12, borderBottomRightRadius: 12, width: 46 }} />
          <div style={{ flex: 1 }} />
          <div style={{ background: C.lilac, height: 24, borderTopRightRadius: 12, borderBottomRightRadius: 12, width: 46 }} />
        </div>
        <div style={{ height: 20, display: "flex" }}>
          <div style={{ width: 50, height: 20, background: C.anakiwa, borderTopLeftRadius: 16 }} />
        </div>
      </div>

      {/* TOP + BOTTOM BARS + CENTER */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ height: 28, background: C.anakiwa, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 12 }}>
          <span style={{ color: "#000", fontSize: 18, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 3 }}>UNITED FEDERATION OF PLANETS</span>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ color: C.goldenTanoi, fontSize: 120, fontFamily: FONT, letterSpacing: 4 }}>{h}</span>
            <span style={{ color: C.neonCarrot, fontSize: 84, fontFamily: FONT, animation: "blink 1s infinite", margin: "0 4px" }}>:</span>
            <span style={{ color: C.goldenTanoi, fontSize: 120, fontFamily: FONT, letterSpacing: 4 }}>{m}</span>
            <span style={{ color: C.tanoi, fontSize: 52, fontFamily: FONT, marginLeft: 12 }}>{s}</span>
          </div>
          <div style={{ color: C.anakiwa, fontSize: 28, fontFamily: FONT, letterSpacing: 8, marginTop: 8, textTransform: "uppercase" }}>{days[now.getDay()]}</div>
          <div style={{ color: C.lilac, fontSize: 34, fontFamily: FONT, letterSpacing: 4, marginTop: 4 }}>
            {months[now.getMonth()]} {now.getDate()}, {now.getFullYear()}
          </div>
        </div>

        <div style={{ height: 20, background: C.anakiwa, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 12 }}>
          <span style={{ color: "#000", fontSize: 13, fontFamily: FONT, letterSpacing: 2 }}>SHIP CHRONOMETER</span>
        </div>
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
        @import url('https://fonts.googleapis.com/css2?family=Antonio:wght@100..700&display=swap');
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.12} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>

      <div style={{ color: "#888", fontSize: 14, fontFamily: FONT, textTransform: "uppercase", letterSpacing: 6, marginBottom: 12 }}>
        TNG — The Next Generation
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {SCREENS.map((s, i) => (
          <button key={s} onClick={() => setScreen(i)} style={{
            padding: "6px 20px", border: "none",
            borderRadius: 14, background: screen === i ? C.goldenTanoi : "#333",
            color: screen === i ? "#000" : "#555", cursor: "pointer",
            fontFamily: FONT, fontSize: 14, textTransform: "uppercase",
            letterSpacing: 3, transition: "all 0.2s",
          }}>{s}</button>
        ))}
      </div>

      <div style={{
        width: 620, height: 364, border: "3px solid #1a1a2a", borderRadius: 4,
        background: "#000", overflow: "hidden",
        boxShadow: "0 0 60px #00000088, 0 2px 20px #00000066",
      }}>
        {screen === 0 ? <SystemScreen d={d} /> : <ClockScreen now={now} />}
      </div>

      <div style={{ color: "#333", fontSize: 11, fontFamily: FONT, marginTop: 12, textTransform: "uppercase", letterSpacing: 3 }}>
        Simulated live data • 7″ 1024×600
      </div>
    </div>
  );
}
