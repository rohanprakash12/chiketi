import { useState, useEffect } from "react";

const MONO = "'Share Tech Mono', monospace";
const BG = "#0A0A08";

// Multi-phosphor VFD color system
const V = {
  green: "#00DDAA", greenBright: "#44FFCC", greenDim: "#008866", greenGhost: "#0A1A15",
  amber: "#FFAA22", amberBright: "#FFCC66", amberDim: "#886611", amberGhost: "#1A1508",
  blue: "#4499FF", blueBright: "#77BBFF", blueDim: "#224488", blueGhost: "#0A1018",
  red: "#FF4433", redBright: "#FF7766", redDim: "#882211", redGhost: "#1A0A08",
  ghost: "#0A1A15", ghostOutline: "#0D2219",
  filament: "#332211", filamentWarm: "#443322", grid: "#1A1A18",
  substrate: "#0A0A08", label: "#556655",
};

function pal(c) {
  return { main: V[c], bright: V[c+"Bright"], dim: V[c+"Dim"], ghost: V[c+"Ghost"] || V.ghost };
}

const SEG_PATHS = {
  a: "M 3,1 L 17,1 L 15,4 L 5,4 Z",
  b: "M 18,2 L 18,15 L 16,13 L 16,5 Z",
  c: "M 18,17 L 18,30 L 16,28 L 16,19 Z",
  d: "M 3,31 L 17,31 L 15,28 L 5,28 Z",
  e: "M 2,17 L 2,30 L 4,28 L 4,19 Z",
  f: "M 2,2 L 2,15 L 4,13 L 4,5 Z",
  g: "M 3,16 L 17,16 L 15,18 L 5,18 L 3,16 Z",
};
const CHAR_MAP = {
  "0":"abcdef","1":"bc","2":"abdeg","3":"abcdg","4":"bcfg","5":"acdfg",
  "6":"acdefg","7":"abc","8":"abcdefg","9":"abcdfg",".":"",":":"","/":"","-":"g"," ":"",
};

// ─── DATA HOOKS ───
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

// ─── MAIN APP ───
export default function App() {
  const [screen, setScreen] = useState(0);
  const d = useAnimatedData();
  const now = useTime();

  useEffect(() => {
    const id = setInterval(() => setScreen(s => (s + 1) % 2), 10000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ width: 1024, height: 600, overflow: "hidden", background: BG, cursor: "pointer", position: "relative" }}
      onClick={() => setScreen(s => (s + 1) % 2)}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.15} }
        @keyframes spinFan { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
      {screen === 0 ? <SystemScreen d={d} /> : <ClockScreen now={now} tick={d.tick} />}
    </div>
  );
}

// ═══════════════════════════════════
// VFD PANEL — glass envelope with filament + grid
// ═══════════════════════════════════
function VfdPanel({ children, style = {} }) {
  return (
    <div style={{
      background: V.substrate, border: "1px solid #1a1a16", borderRadius: 3,
      position: "relative", overflow: "hidden",
      boxShadow: "inset 0 0 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.02), 0 2px 8px rgba(0,0,0,0.6)",
      ...style,
    }}>
      {/* Filament wires */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", zIndex: 20,
        backgroundImage: `linear-gradient(0deg, transparent 0px, transparent 11px, ${V.filamentWarm}18 11px, ${V.filamentWarm}18 12px, transparent 12px, transparent 23px, ${V.filament}12 23px, ${V.filament}12 24px, transparent 24px)`,
        backgroundSize: "100% 24px",
      }} />
      {/* Grid mesh */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", zIndex: 21, opacity: 0.06,
        backgroundImage: `linear-gradient(0deg, ${V.grid} 1px, transparent 1px), linear-gradient(90deg, ${V.grid} 1px, transparent 1px)`,
        backgroundSize: "4px 4px",
      }} />
      {/* Glass tint */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", zIndex: 22,
        background: "radial-gradient(ellipse at 50% 40%, transparent 50%, rgba(0,0,0,0.15) 100%)",
      }} />
      {children}
    </div>
  );
}

// ═══════════════════════════════════
// VFD SEVEN-SEGMENT DIGIT
// ═══════════════════════════════════
function VfdDigit({ char, size = 32, id = "0", color = "green" }) {
  const p = pal(color);
  const activeSegs = CHAR_MAP[char] || "";
  const w = size * 0.6, h = size;
  const fid = `vg-${id}`;
  return (
    <svg width={w} height={h} viewBox="0 0 20 32" style={{ overflow: "visible" }}>
      <defs>
        <filter id={fid} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="g1" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="g2" />
          <feMerge><feMergeNode in="g2" /><feMergeNode in="g1" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {Object.entries(SEG_PATHS).map(([seg, path]) => (
        <path key={`g-${seg}`} d={path} fill={p.ghost} stroke={`${p.ghost}88`} strokeWidth="0.3" />
      ))}
      {Object.entries(SEG_PATHS).map(([seg, path]) => {
        if (!activeSegs.includes(seg)) return null;
        return (<g key={`a-${seg}`}>
          <path d={path} fill={p.main} opacity="0.6" filter={`url(#${fid})`} />
          <path d={path} fill={p.main} opacity="0.95" />
          <path d={path} fill={p.bright} opacity="0.3" />
        </g>);
      })}
    </svg>
  );
}

// ─── VFD COLON ───
function VfdColon({ size = 32, tick, color = "green" }) {
  const p = pal(color);
  const on = tick % 2 === 0;
  return (
    <svg width={size * 0.25} height={size} viewBox="0 0 5 32" style={{ overflow: "visible" }}>
      <defs><filter id={`cg-${color}`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.2" /></filter></defs>
      <circle cx="2.5" cy="10" r="1.2" fill={p.ghost} />
      <circle cx="2.5" cy="22" r="1.2" fill={p.ghost} />
      {on && <>
        <circle cx="2.5" cy="10" r="1.2" fill={p.main} opacity="0.5" filter={`url(#cg-${color})`} />
        <circle cx="2.5" cy="10" r="1.2" fill={p.main} />
        <circle cx="2.5" cy="22" r="1.2" fill={p.main} opacity="0.5" filter={`url(#cg-${color})`} />
        <circle cx="2.5" cy="22" r="1.2" fill={p.main} />
      </>}
    </svg>
  );
}

// ─── VFD DONUT GAUGE ───
function VfdDonut({ pct, label, color = "green", size = 80 }) {
  const p = pal(color);
  const cx = size / 2, cy = size / 2;
  const r = (size - 14) / 2;
  const sw = size * 0.08;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  const isHigh = pct > 80;
  const ac = isHigh ? V.red : p.main;
  const ab = isHigh ? V.redBright : p.bright;
  const fid = `dn-${label}`;

  const ticks = Array.from({ length: 20 }).map((_, i) => {
    const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
    return {
      x1: cx + (r - sw/2 - 1) * Math.cos(a), y1: cy + (r - sw/2 - 1) * Math.sin(a),
      x2: cx + (r + sw/2 + 1) * Math.cos(a), y2: cy + (r + sw/2 + 1) * Math.sin(a),
    };
  });

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: p.main, textShadow: `0 0 4px ${p.dim}`, fontSize: 16, fontFamily: MONO, letterSpacing: 3, marginBottom: 3 }}>{label}</div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block", overflow: "visible" }}>
        <defs>
          <filter id={`${fid}-b`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="g1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="g2" />
            <feMerge><feMergeNode in="g2" /><feMergeNode in="g1" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={p.ghost} strokeWidth={sw} />
        {ticks.map((t, i) => <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={V.substrate} strokeWidth="1" />)}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={ac} strokeWidth={sw} strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="butt" transform={`rotate(-90 ${cx} ${cy})`} opacity="0.5" filter={`url(#${fid}-b)`} style={{ transition: "stroke-dashoffset 0.8s ease, stroke 0.5s ease" }} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={ac} strokeWidth={sw} strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="butt" transform={`rotate(-90 ${cx} ${cy})`} opacity="0.95" style={{ transition: "stroke-dashoffset 0.8s ease, stroke 0.5s ease" }} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={ab} strokeWidth={sw * 0.5} strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="butt" transform={`rotate(-90 ${cx} ${cy})`} opacity="0.3" style={{ transition: "stroke-dashoffset 0.8s ease, stroke 0.5s ease" }} />
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="central" fill={ac} fontSize={size * 0.22} fontFamily={MONO} style={{ filter: `drop-shadow(0 0 3px ${ac}88)` }}>{Math.round(pct)}%</text>
      </svg>
    </div>
  );
}

// ─── VFD THERMAL BAR (discrete segments) ───
function VfdThermalBar({ temp, label }) {
  const minT = 20, maxT = 120;
  const pct = ((Math.max(minT, Math.min(maxT, temp)) - minT) / (maxT - minT)) * 100;
  let color = "blue";
  if (temp >= 100) color = "red";
  else if (temp >= 80) color = "amber";
  else if (temp >= 50) color = "green";
  const p = pal(color);
  const totalSegs = 16;
  const litSegs = Math.round((pct / 100) * totalSegs);
  const fid = `tb-${label}`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: V.green, textShadow: `0 0 3px ${V.greenDim}`, fontSize: 16, fontFamily: MONO, width: 34, textAlign: "right", flexShrink: 0 }}>{label}</span>
      <svg width="100%" height="20" viewBox="0 0 160 20" preserveAspectRatio="none" style={{ flex: 1, overflow: "visible" }}>
        <defs><filter id={fid} x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.2 0.8" /></filter></defs>
        {Array.from({ length: totalSegs }).map((_, i) => {
          const x = i * (160 / totalSegs) + 0.5;
          const w = (160 / totalSegs) - 1.5;
          return <rect key={`g-${i}`} x={x} y="1" width={w} height="18" rx="1" fill={V.ghost} stroke={`${V.ghost}66`} strokeWidth="0.3" />;
        })}
        {Array.from({ length: litSegs }).map((_, i) => {
          const x = i * (160 / totalSegs) + 0.5;
          const w = (160 / totalSegs) - 1.5;
          return (<g key={`l-${i}`}>
            <rect x={x} y="1" width={w} height="18" rx="1" fill={p.main} opacity="0.5" filter={`url(#${fid})`} />
            <rect x={x} y="1" width={w} height="18" rx="1" fill={p.main} opacity="0.9" />
            <rect x={x} y="3" width={w} height="14" rx="0.5" fill={p.bright} opacity="0.25" />
          </g>);
        })}
      </svg>
    </div>
  );
}

// ─── VFD SCALE ───
function VfdScale() {
  const marks = [20, 50, 70, 90, 110, 120];
  return (
    <div style={{ marginLeft: 36, position: "relative", height: 20 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `${V.green}22` }} />
      {marks.map(t => (
        <div key={t} style={{ position: "absolute", left: `${((t - 20) / 100) * 100}%`, top: 0, transform: "translateX(-50%)" }}>
          <div style={{ width: 1, height: 5, background: `${V.green}44` }} />
          <div style={{ color: V.green, textShadow: `0 0 2px ${V.greenDim}`, fontSize: 14, fontFamily: MONO, textAlign: "center", marginTop: 1 }}>{t}</div>
        </div>
      ))}
    </div>
  );
}

// ─── FAN INDICATOR ───
function FanIcon({ rpm }) {
  const speed = Math.max(0.5, 4 - (rpm / 500));
  return (
    <svg width="20" height="20" viewBox="0 0 40 40" style={{ animation: `spinFan ${speed}s linear infinite` }}>
      {[0, 90, 180, 270].map(a => (
        <rect key={a} x="17" y="4" width="6" height="14" rx="3" fill={V.green} opacity="0.7" transform={`rotate(${a} 20 20)`} />
      ))}
      <circle cx="20" cy="20" r="4" fill={BG} stroke={`${V.green}66`} strokeWidth="1" />
    </svg>
  );
}

// ─── SECTION LABEL ───
function SectionLabel({ text, color = "green", rightText, rightColor }) {
  const p = pal(color);
  const rp = rightColor ? pal(rightColor) : p;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
      <span style={{ color: p.main, textShadow: `0 0 4px ${p.dim}`, fontSize: 17, fontFamily: MONO, letterSpacing: 3 }}>{text}</span>
      <div style={{ flex: 1, height: 1, background: `${p.main}18`, margin: "0 8px" }} />
      {rightText && <span style={{ color: rp.main, textShadow: `0 0 3px ${rp.dim}`, fontSize: 13, fontFamily: MONO, letterSpacing: 2 }}>{rightText}</span>}
    </div>
  );
}

// ─── DATA ROW ───
function VfdRow({ label, value, color = "green", valueSize = 30 }) {
  const p = pal(color);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ color: `${p.dim}`, textShadow: `0 0 2px ${p.dim}44`, fontSize: 15, fontFamily: MONO, letterSpacing: 1 }}>{label}</span>
      <span style={{ color: p.main, textShadow: `0 0 4px ${p.main}66, 0 0 10px ${p.dim}`, fontSize: valueSize, fontFamily: MONO }}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════
// SYSTEM SCREEN
// ═══════════════════════════════════
function SystemScreen({ d }) {
  const temps = [d.cpuTemp, d.mbTemp, d.gpuTemp];
  const anyDanger = temps.some(t => t >= 100);
  const anyWarn = temps.some(t => t >= 80);
  const status = anyDanger ? "CRITICAL" : anyWarn ? "WARNING" : "NOMINAL";
  const statusColor = anyDanger ? "red" : anyWarn ? "amber" : "green";
  const secPct = d.hasSecondary ? (d.secUsed / d.secTotal) * 100 : 0;
  const secSegs = 20;
  const secLit = Math.round((secPct / 100) * secSegs);

  return (
    <VfdPanel style={{ width: "100%", height: "100%", borderRadius: 0, border: "none" }}>
      <div style={{ width: "100%", height: "100%", padding: 12, display: "flex", flexDirection: "column", gap: 5, position: "relative", zIndex: 10 }}>
        {/* ROW 1: Headers */}
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}><SectionLabel text="CORE SYSTEMS" color="green" rightText="ZION" rightColor="amber" /></div>
          <div style={{ flex: 1 }}><SectionLabel text="THERMALS" color="amber" rightText={status} rightColor={statusColor} /></div>
        </div>

        {/* ROW 2: Donuts | Bars */}
        <div style={{ display: "flex", gap: 10, flex: 1 }}>
          <div style={{ flex: 1, display: "flex", justifyContent: "space-around", alignItems: "center" }}>
            <VfdDonut pct={d.cpu} label="CPU" color="green" size={145} />
            <VfdDonut pct={d.ram} label="RAM" color="blue" size={145} />
            <VfdDonut pct={d.ssd} label="SSD" color="amber" size={145} />
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
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
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: V.blue, textShadow: `0 0 3px ${V.blueDim}`, fontSize: 10, fontFamily: MONO, flexShrink: 0 }}>SEC</span>
                <svg width="100%" height="20" viewBox="0 0 180 20" preserveAspectRatio="none" style={{ flex: 1, overflow: "visible" }}>
                  <defs><filter id="sec-g" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.2 0.8" /></filter></defs>
                  {Array.from({ length: secSegs }).map((_, i) => {
                    const x = i * (180 / secSegs) + 0.5; const w = (180 / secSegs) - 1.5;
                    return <rect key={`g-${i}`} x={x} y="1" width={w} height="18" rx="1" fill={V.blueGhost} stroke={`${V.blueGhost}66`} strokeWidth="0.3" />;
                  })}
                  {Array.from({ length: secLit }).map((_, i) => {
                    const x = i * (180 / secSegs) + 0.5; const w = (180 / secSegs) - 1.5;
                    return (<g key={`l-${i}`}>
                      <rect x={x} y="1" width={w} height="18" rx="1" fill={V.blue} opacity="0.5" filter="url(#sec-g)" />
                      <rect x={x} y="1" width={w} height="18" rx="1" fill={V.blue} opacity="0.9" />
                    </g>);
                  })}
                </svg>
                <span style={{ color: V.blue, textShadow: `0 0 3px ${V.blueDim}`, fontSize: 10, fontFamily: MONO, flexShrink: 0 }}>{d.secUsed}T/{d.secTotal}T</span>
              </div>
            ) : (
              <span style={{ color: V.ghost, fontSize: 12, fontFamily: MONO }}>SECONDARY — NONE</span>
            )}
          </div>
          <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
            <span style={{ color: V.greenDim, textShadow: `0 0 2px ${V.greenDim}44`, fontSize: 14, fontFamily: MONO }}>CPU</span>
            <FanIcon rpm={d.fans[0].rpm} />
            <div style={{ width: 6 }} />
            <span style={{ color: V.greenDim, textShadow: `0 0 2px ${V.greenDim}44`, fontSize: 14, fontFamily: MONO }}>CASE</span>
            {d.fans.slice(1).map((f, i) => <FanIcon key={i} rpm={f.rpm} />)}
          </div>
        </div>

        {/* ROW 4: Headers */}
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}><SectionLabel text="COMMS" color="blue" rightText="1 GBPS" /></div>
          <div style={{ flex: 1 }}><SectionLabel text="NPU" color="amber" rightText="LLAMA.CPP" /></div>
        </div>

        {/* ROW 5+6: Data */}
        <div style={{ display: "flex", gap: 10, flex: 1 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <VfdRow label="IP" value="192.168.1.42" color="green" />
              <VfdRow label="MAC" value="AB:CD:EF:12:34" color="green" />
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: V.green, textShadow: `0 0 4px ${V.greenDim}`, fontSize: 12, fontFamily: MONO }}>▲</span>
                <span style={{ color: V.green, textShadow: `0 0 4px ${V.green}66`, fontSize: 38, fontFamily: MONO }}>{d.netUp.toFixed(1)}</span>
                <span style={{ color: V.greenDim, fontSize: 12, fontFamily: MONO }}>MB/s</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: V.blue, textShadow: `0 0 4px ${V.blueDim}`, fontSize: 12, fontFamily: MONO }}>▼</span>
                <span style={{ color: V.blue, textShadow: `0 0 4px ${V.blue}66`, fontSize: 38, fontFamily: MONO }}>{d.netDown.toFixed(1)}</span>
                <span style={{ color: V.blueDim, fontSize: 12, fontFamily: MONO }}>MB/s</span>
              </div>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <VfdRow label="MODEL" value="Qwen3-30B-A3B" color="amber" valueSize={24} />
              <VfdRow label="QUANT" value="Q4_K_M" color="amber" valueSize={24} />
              <VfdRow label="CTX" value="8192" color="amber" valueSize={24} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ color: V.greenDim, fontSize: 14, fontFamily: MONO }}>T/S</span>
                <span style={{ color: V.green, textShadow: `0 0 5px ${V.green}66`, fontSize: 38, fontFamily: MONO }}>{d.tokSec.toFixed(0)}</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ color: V.blueDim, fontSize: 14, fontFamily: MONO }}>VRAM</span>
                <span style={{ color: V.blue, textShadow: `0 0 5px ${V.blue}66`, fontSize: 38, fontFamily: MONO }}>{d.vramUsed.toFixed(1)}/{d.vramTotal}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </VfdPanel>
  );
}

// ═══════════════════════════════════
// CLOCK SCREEN
// ═══════════════════════════════════
function ClockScreen({ now, tick }) {
  const h = now.getHours().toString().padStart(2, "0");
  const m = now.getMinutes().toString().padStart(2, "0");
  const s = now.getSeconds().toString().padStart(2, "0");
  const days = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const dateStr = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <VfdPanel style={{ width: "100%", height: "100%", borderRadius: 0, border: "none" }}>
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center", gap: 12, position: "relative", zIndex: 10,
      }}>
        {/* VFD CHRONOMETER label */}
        <div style={{ color: V.greenDim, textShadow: `0 0 3px ${V.greenDim}44`, fontSize: 18, fontFamily: MONO, letterSpacing: 8 }}>VFD CHRONOMETER</div>

        {/* Decorative line */}
        <div style={{ width: 580, height: 1, background: `linear-gradient(90deg, transparent, ${V.green}33, ${V.amber}33, ${V.blue}33, transparent)` }} />

        {/* Main clock — seven segment digits */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <VfdDigit char={h[0]} size={140} id="ch0" color="green" />
          <VfdDigit char={h[1]} size={140} id="ch1" color="green" />
          <VfdColon size={140} tick={tick} color="green" />
          <VfdDigit char={m[0]} size={140} id="cm0" color="green" />
          <VfdDigit char={m[1]} size={140} id="cm1" color="green" />
          <VfdColon size={140} tick={tick} color="amber" />
          <VfdDigit char={s[0]} size={140} id="cs0" color="amber" />
          <VfdDigit char={s[1]} size={140} id="cs1" color="amber" />
        </div>

        {/* Day */}
        <div style={{ color: V.amber, textShadow: `0 0 5px ${V.amberDim}`, fontSize: 40, fontFamily: MONO, letterSpacing: 8 }}>{days[now.getDay()]}</div>

        {/* Date */}
        <div style={{ color: V.blue, textShadow: `0 0 5px ${V.blueDim}`, fontSize: 38, fontFamily: MONO, letterSpacing: 4 }}>{dateStr}</div>

        {/* Bottom label */}
        <div style={{ width: 580, height: 1, background: `linear-gradient(90deg, transparent, ${V.blue}33, ${V.amber}33, ${V.green}33, transparent)` }} />
        <div style={{ color: V.greenDim, textShadow: `0 0 3px ${V.greenDim}44`, fontSize: 13, fontFamily: MONO, letterSpacing: 6 }}>ZION • VACUUM FLUORESCENT DISPLAY</div>
      </div>
    </VfdPanel>
  );
}
