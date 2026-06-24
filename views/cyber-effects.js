// ── Visual effects: face frame, scan overlays, red wave ──

// ── Entrance dynamic backdrop ─────────────────────────
// 低調動態:5 條 code rain + 慢掃光帶 + 中央散光暈 + 右上慢眨警示
// SMIL animation 跑在 GPU compositor,不卡 React;clipPath 確保不溢出 face 邊界
function EntranceBackdrop({ face, palette }) {
  const { w, h, id } = face;
  const clipId = `ent-clip-${id}`;
  const beamGradId = `ent-beam-${id}`;
  const scopeGradId = `ent-scope-${id}`;

  // Perf: 3 columns × 14 lines = 42 text elements + 3 SMIL animations
  // (vs 5 × 24 = 120 + 5 animations) — 約三分之一的負擔
  const HEX = '0123456789ABCDEF';
  const COLS = 3;
  const LINES_PER_COL = 14;
  const lineH = 26;
  const totalH = LINES_PER_COL * lineH;

  const columns = Array.from({ length: COLS }, (_, ci) => ({
    x: ((ci + 0.5) / COLS) * w,
    dur: 18 + ((ci * 7) % 12),
    delay: -((ci * 41) % 25),
    chars: Array.from({ length: LINES_PER_COL }, (_, li) =>
      HEX[(ci * 13 + li * 7) % 16] + HEX[(ci * 19 + li * 11 + 3) % 16]),
  }));

  return (
    <g pointerEvents="none">
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={w} height={h}/>
        </clipPath>
        <linearGradient id={beamGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.primary} stopOpacity="0"/>
          <stop offset="50%" stopColor={palette.primary} stopOpacity="0.28"/>
          <stop offset="100%" stopColor={palette.primary} stopOpacity="0"/>
        </linearGradient>
        <radialGradient id={scopeGradId} cx="0.5" cy="0.5" r="0.55">
          <stop offset="0%" stopColor={palette.primary} stopOpacity="0.10"/>
          <stop offset="60%" stopColor={palette.primary} stopOpacity="0.03"/>
          <stop offset="100%" stopColor={palette.primary} stopOpacity="0"/>
        </radialGradient>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        {/* 中央光暈 */}
        <rect x={0} y={0} width={w} height={h} fill={`url(#${scopeGradId})`}/>

        {/* code rain — 每條 column 獨立週期 + 不同 begin offset 錯開 */}
        {columns.map((col, ci) => (
          <g key={ci}>
            {col.chars.map((ch, li) => (
              <text key={li} x={col.x} y={li * lineH}
                textAnchor="middle"
                fontFamily="JetBrains Mono" fontSize={16}
                fill={palette.primary}
                opacity={li === 0 ? 0.55 : 0.14 + ((li * 37 + ci * 23) % 12) * 0.014}
                letterSpacing="0.08em">
                {ch}
              </text>
            ))}
            <animateTransform attributeName="transform" type="translate"
              from={`0 ${-totalH}`} to={`0 ${h + lineH}`}
              dur={`${col.dur}s`}
              begin={`${col.delay}s`}
              repeatCount="indefinite"/>
          </g>
        ))}

        {/* 慢掃光帶 */}
        <rect x={0} y={0} width={w} height={180}
          fill={`url(#${beamGradId})`}>
          <animate attributeName="y"
            from={-180} to={h}
            dur="11s"
            repeatCount="indefinite"/>
        </rect>

        {/* 右上 INTRUSION BLOCKED 警示(慢眨紅點) */}
        <g transform={`translate(${w - 30}, 36)`}>
          <circle r={5} fill={palette.danger} className="pulse-slow"
            style={{filter: `drop-shadow(0 0 6px ${palette.danger})`}}/>
          <text x={-14} y={-2} textAnchor="end"
            fontFamily="JetBrains Mono" fontSize={10}
            fill="rgba(143,168,184,0.45)" letterSpacing="0.2em">
            INTRUSION
          </text>
          <text x={-14} y={12} textAnchor="end"
            fontFamily="JetBrains Mono" fontSize={10}
            fill={palette.danger} letterSpacing="0.2em" opacity={0.75}>
            BLOCKED
          </text>
        </g>
      </g>
    </g>
  );
}

function FaceFrame({ face, palette }) {
  const { w, h, id, name } = face;
  const isInactive = name === "Entrance";
  const stroke = isInactive ? "rgba(60,80,100,0.5)" : palette.primary;

  return (
    <g>
      <rect x={0} y={0} width={w} height={h}
        fill={isInactive ? "rgba(8,12,18,0.6)" : "rgba(4,6,10,0.9)"}/>

      <rect x={4} y={4} width={w - 8} height={h - 8}
        fill="none" stroke={stroke} strokeWidth={1.5} opacity={0.45}/>
      <rect x={10} y={10} width={w - 20} height={h - 20}
        fill="none" stroke={stroke} strokeWidth={0.5} strokeDasharray="3 4" opacity={0.25}/>

      <g stroke={stroke} strokeWidth={3} fill="none" opacity={0.85}
         style={{filter: !isInactive ? `drop-shadow(0 0 4px ${stroke})` : 'none'}}>
        <polyline points={`0,40 0,0 40,0`}/>
        <polyline points={`${w-40},0 ${w},0 ${w},40`}/>
        <polyline points={`0,${h-40} 0,${h} 40,${h}`}/>
        <polyline points={`${w-40},${h} ${w},${h} ${w},${h-40}`}/>
      </g>

      {/* face callsign + size readout 拿掉 — 它們會蓋住格子;HUD 內已經有 callsign + 計時器 */}

      {isInactive && (
        <g>
          {/* 動態背景:慢飄 code rain + 掃描光帶 + 中央光暈 + 慢眨警示 */}
          <EntranceBackdrop face={face} palette={palette}/>

          {/* sealed 網紋(放在 backdrop 上面增加質感) */}
          <pattern id={`hatch-${id}`} patternUnits="userSpaceOnUse" width="16" height="16" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="16" stroke="rgba(60,80,100,0.18)" strokeWidth="1"/>
          </pattern>
          <rect x={0} y={0} width={w} height={h} fill={`url(#hatch-${id})`}/>
        </g>
      )}
    </g>
  );
}

// ── Bomb breach effect ─────────────────────────────────
// 紅波蔓延(v1 風格 + CSS 加速):
// 1784 個 rects 一次 render 完,各自依距離計算 CSS animation-delay,
// 由 browser GPU 處理 fade-in,React 不參與每幀更新 → 不卡。
// Component unmount 時 rects + 動畫一起消失,restart 後乾淨。
const RED_WAVE_DURATION_S = 1.8;

function RedWaveOverlay({ palette, state }) {
  if (!state?.redWave) return null;

  const wave = state.redWave;
  const maxDist = wave[wave.length - 1]?.dist || 1;

  // 炸彈位置 (canvas px center of bomb cell)
  let bx = CANVAS_W / 2, by = CANVAS_H / 2;
  let bombFaceName = "—", bombCol = 0, bombRow = 0;
  if (state.bombCellId != null && state.cells?.[state.bombCellId]) {
    const c = state.cells[state.bombCellId];
    const f = state.faces.find(x => x.name === c.faceName);
    if (f) {
      bx = f.originX + (c.col + 0.5) * CELL;
      by = f.originY + (c.row + 0.5) * CELL;
      bombFaceName = c.faceName;
      bombCol = c.col; bombRow = c.row;
    }
  }

  // faceName → face metadata 快取
  const faceMap = {};
  for (const f of state.faces) faceMap[f.name] = f;

  return (
    <g pointerEvents="none">
      {/* 逐格紅色蔓延 — CSS-driven,每格依距離計算 delay */}
      {wave.map((w, i) => {
        const face = faceMap[w.faceName];
        if (!face) return null;
        const x = face.originX + w.col * CELL;
        const y = face.originY + w.row * CELL;
        const delay = (w.dist / maxDist) * RED_WAVE_DURATION_S;
        return (
          <rect key={i} x={x} y={y} width={CELL} height={CELL}
            fill={palette.danger}
            style={{
              opacity: 0,
              animation: `breach-cell 0.7s ease-out ${delay.toFixed(2)}s 1 both`,
            }}
            pointerEvents="none"/>
        );
      })}

      {/* 炸彈核心快閃 (兩層) */}
      <g transform={`translate(${bx},${by})`} pointerEvents="none">
        <circle r={60} fill="#FFFFFF"
          style={{animation: 'breach-core 0.5s ease-out 1 both'}}/>
        <circle r={100} fill={palette.danger} opacity={0.7}
          style={{animation: 'breach-core-late 0.9s ease-out 0.05s 1 both'}}/>
      </g>

      {/* 終端機 cascade log (左下角) */}
      <BreachLog palette={palette}
        bombFaceName={bombFaceName} bombCol={bombCol} bombRow={bombRow}/>
    </g>
  );
}

function BreachLog({ palette, bombFaceName, bombCol, bombRow }) {
  const lines = [
    { txt: `> CASCADE detected @ T+0.0ms`,                    delay: 0.05 },
    { txt: `> origin :: ${bombFaceName}[col.${String(bombCol).padStart(2,'0')}, row.${String(bombRow).padStart(2,'0')}]`, delay: 0.18 },
    { txt: `> stack_trace... 0x7FAA__ -> 0x004F_BR`,           delay: 0.30 },
    { txt: `> propagating signal across 7 surfaces`,           delay: 0.45 },
    { txt: `> containment :: FAILED`,                          delay: 0.60 },
    { txt: `> awaiting operator reset_______`,                 delay: 1.00 },
  ];
  // Place the log block at bottom-left in venue px (won't conflict with restart button at floor center)
  return (
    <g transform={`translate(80, ${CANVAS_H - 380})`}>
      {/* glass panel */}
      <rect x={-12} y={-40} width={1100} height={340}
        fill="rgba(8,2,12,0.78)" stroke={palette.danger} strokeWidth={2}
        style={{filter: `drop-shadow(0 0 18px ${palette.danger})`}}/>
      {/* corner ticks */}
      <g stroke={palette.danger} strokeWidth={3} fill="none">
        <polyline points="-12,-20 -12,-40 8,-40"/>
        <polyline points="1080,-40 1088,-40 1088,-20"/>
        <polyline points="-12,280 -12,300 8,300"/>
        <polyline points="1080,300 1088,300 1088,280"/>
      </g>
      {/* header */}
      <text x={4} y={0} fontFamily="JetBrains Mono" fontSize={26} fontWeight={700}
        fill={palette.danger} letterSpacing="0.18em"
        style={{filter: `drop-shadow(0 0 6px ${palette.danger})`}}>
        // BREACH.LOG :: 704_FATAL
      </text>
      <line x1={4} y1={14} x2={1078} y2={14} stroke={palette.danger} strokeWidth={1} opacity={0.5}/>

      {lines.map((l, i) => (
        <text key={i} x={4} y={50 + i * 36}
          fontFamily="JetBrains Mono" fontSize={24}
          fill={i === lines.length - 1 ? palette.secondary : "#FFD2D2"}
          letterSpacing="0.06em"
          style={{
            animation: `breach-log-line 0.28s ease-out ${l.delay}s 1 both`,
            filter: i === lines.length - 1 ? `drop-shadow(0 0 4px ${palette.secondary})` : 'none',
          }}>
          {l.txt}
        </text>
      ))}
    </g>
  );
}

function VenueBadge({ palette, state }) {
  return (
    <g transform="translate(40, 60)">
      <text x={0} y={0} fontFamily="JetBrains Mono" fontSize={20}
        fill={palette.primary} letterSpacing="0.25em" fontWeight={500}
        style={{filter: `drop-shadow(0 0 4px ${palette.primary})`}}>
        704.MINESWEEPER
      </text>
      <text x={0} y={28} fontFamily="JetBrains Mono" fontSize={14}
        fill="rgba(143,168,184,0.6)" letterSpacing="0.2em">
        CYBERCUBE.NANGANG // SESSION_E47
      </text>
      <line x1={0} y1={42} x2={280} y2={42} stroke={palette.primary} strokeWidth={1} opacity={0.4}/>
      <text x={0} y={62} fontFamily="JetBrains Mono" fontSize={12}
        fill={palette.primary} letterSpacing="0.15em">
        STATE: <tspan fill={palette.accent}>{stateLabel(state)}</tspan>
      </text>
    </g>
  );
}

function stateLabel(s) {
  switch (s) {
    case "idle": return "STANDBY / AWAIT_INIT";
    case "playing": return "ACTIVE / SCAN_IN_PROGRESS";
    case "gameover-wave": return "BREACH / WAVE_PROPAGATION";
    case "gameover-final": return "TERMINATED / AWAIT_RESET";
  }
  return s;
}

function TopRightStatus({ palette }) {
  return (
    <g transform={`translate(${CANVAS_W - 40}, 60)`}>
      <text x={0} y={0} fontFamily="JetBrains Mono" fontSize={14}
        fill="rgba(143,168,184,0.6)" letterSpacing="0.2em" textAnchor="end">
        UTC 17:42:08 · LAT 25.05 · LON 121.62
      </text>
      <text x={0} y={22} fontFamily="JetBrains Mono" fontSize={14}
        fill="rgba(143,168,184,0.6)" letterSpacing="0.2em" textAnchor="end">
        TOUCHSERVICE: <tspan fill={palette.accent}>● CONN</tspan> · LAT 102ms
      </text>
      <text x={0} y={44} fontFamily="JetBrains Mono" fontSize={14}
        fill="rgba(143,168,184,0.6)" letterSpacing="0.2em" textAnchor="end">
        PLAYERS: 03 · CHIPS: 14272 ONLINE
      </text>
    </g>
  );
}

function FaceConnectors({ palette }) {
  return (
    <g opacity={0.6}>
      <line x1={640} y1={640} x2={2048} y2={640}
        stroke={palette.primary} strokeWidth={2} strokeDasharray="20 8" opacity={0.5}/>
      <line x1={640} y1={2688} x2={2048} y2={2688}
        stroke={palette.primary} strokeWidth={2} strokeDasharray="20 8" opacity={0.5}/>
      <line x1={640} y1={640} x2={640} y2={2688}
        stroke={palette.primary} strokeWidth={2} strokeDasharray="20 8" opacity={0.5}/>
      <line x1={2048} y1={640} x2={2048} y2={2688}
        stroke={palette.primary} strokeWidth={2} strokeDasharray="20 8" opacity={0.5}/>

      {[[640, 640], [2048, 640], [640, 2688], [2048, 2688]].map((p, i) => (
        <g key={i} transform={`translate(${p[0]}, ${p[1]})`}>
          <circle r={10} fill={palette.primary} opacity={0.4}/>
          <circle r={5} fill={palette.primary}/>
          <circle r={20} fill="none" stroke={palette.primary} strokeWidth={1} opacity={0.3}/>
        </g>
      ))}
    </g>
  );
}

function FloorGrid({ face, palette }) {
  const lines = [];
  const step = 64;
  for (let x = step; x < face.w; x += step) {
    lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={face.h}
      stroke={palette.primary} strokeWidth={0.5} opacity={0.06}/>);
  }
  for (let y = step; y < face.h; y += step) {
    lines.push(<line key={`h${y}`} x1={0} y1={y} x2={face.w} y2={y}
      stroke={palette.primary} strokeWidth={0.5} opacity={0.06}/>);
  }
  return <g>{lines}</g>;
}

Object.assign(window, { FaceFrame, RedWaveOverlay, VenueBadge, TopRightStatus, FaceConnectors, FloorGrid });
