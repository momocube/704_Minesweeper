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

// ── Operator-triggered intro ─────────────────────────────
// Server owns the start timestamp so the all-in-one view and every projector
// face enter the same ten-second presentation even after a reconnect.
const INTRO_DURATION_S = 10;

function animationDurationSeconds(state, key, fallback) {
  const value = Number(state?.animationDurations?.[key]);
  return Number.isFinite(value) && value > 0 ? value / 1000 : fallback;
}

function resultPanelRotation(reservedSide) {
  switch (reservedSide) {
    case 'left': return -90;
    case 'right': return 90;
    case 'bottom': return 180;
    default: return 0;
  }
}

// Wall Left is 640px wide in the unfolded venue. After -90deg rotation the
// panel's canonical height becomes its visible width, so keep that dimension
// below 640px while using the available width generously.
const RESULT_PANEL_W = 560;
const RESULT_PANEL_H = 620;

function IntroOverlay({ state, faces, palette, nowMs = () => Date.now() }) {
  if (state?.phase !== 'intro') return null;

  const origin = state.animationOrigins?.intro;
  const ox = origin?.x ?? CANVAS_W / 2;
  const oy = origin?.y ?? CANVAS_H / 2;
  const durationS = animationDurationSeconds(state, 'intro', INTRO_DURATION_S);
  const startedAt = state.introStartedAt ?? nowMs();
  const elapsed = Math.max(0, Math.min(durationS, (nowMs() - startedAt) / 1000));
  const negativeDelay = `${-elapsed}s`;
  const mainFaces = faces.filter(f => f.isBoard || f.isFloor || f.name === 'Entrance');

  return (
    <g key={`intro-${startedAt}`} pointerEvents="none">
      <style>{`
        .intro-cover { animation: introCover ${durationS}s ease-out 1 both; }
        .intro-ring { animation: introRing ${durationS}s cubic-bezier(.2,.8,.2,1) 1 both; transform-origin: ${ox}px ${oy}px; }
        .intro-ring-2 { animation-delay: .12s; }
        .intro-ring-3 { animation-delay: .24s; }
        .intro-title { animation: introTitle ${durationS}s ease-out 1 both; }
        .intro-trigger { animation: introTrigger ${durationS}s ease-out 1 both; }
        .intro-grid { animation: introGrid ${durationS}s ease-out 1 both; }
        @keyframes introCover {
          0%, 8% { opacity: .72; }
          78% { opacity: .52; }
          92% { opacity: .24; }
          100% { opacity: 0; }
        }
        @keyframes introRing {
          0% { opacity: 0; transform: scale(.06); }
          14% { opacity: .95; }
          72% { opacity: .34; transform: scale(1.18); }
          100% { opacity: 0; transform: scale(1.55); }
        }
        /* Full title at 45%; hold through 95% = five seconds before fade. */
        @keyframes introTitle {
          0%, 38% { opacity: 0; }
          45%, 95% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes introTrigger {
          0%, 5% { opacity: 0; }
          8%, 32% { opacity: 1; }
          46%, 100% { opacity: 0; }
        }
        @keyframes intro-core {
          0% { opacity: 0; transform: scale(.2); }
          12%, 65% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(.4); }
        }
        @keyframes introGrid {
          0%, 72% { opacity: .02; }
          100% { opacity: .24; }
        }
      `}</style>

      <rect className="intro-cover" x={0} y={0} width={CANVAS_W} height={CANVAS_H}
        fill="#02040A" opacity=".72" style={{animationDelay: negativeDelay}}/>

      <g transform={`translate(${ox},${oy})`}>
        {[180, 420, 760].map((r, i) => (
          <circle key={r} className={`intro-ring intro-ring-${i + 1}`}
            cx={0} cy={0} r={r} fill="none"
            stroke={i === 2 ? palette.primary : palette.accent}
            strokeWidth={i === 0 ? 8 : 4}
            strokeDasharray={i === 2 ? '24 18' : 'none'}
            style={{animationDelay: `${-(Math.max(0, elapsed - i * 0.12))}s`}}/>
        ))}
        <circle cx={0} cy={0} r={26} fill={palette.accent}
          style={{animation: `intro-core ${durationS}s ease-out 1 both`, animationDelay: negativeDelay,
                  filter: `drop-shadow(0 0 22px ${palette.accent})`}}/>
      </g>

      {mainFaces.map(face => (
        <g key={face.name} className="intro-grid" style={{animationDelay: negativeDelay}}>
          <rect x={face.originX + 16} y={face.originY + 16}
            width={Math.max(0, face.w - 32)} height={Math.max(0, face.h - 32)}
            fill="none" stroke={palette.primary} strokeWidth={2}
            strokeDasharray="18 22"/>
        </g>
      ))}

      {(() => {
        const wallLeft = faces.find(f => f.name === 'Wall Left');
        if (!wallLeft) return null;
        const readableW = wallLeft.h;
        const readableH = wallLeft.w;
        const wallRotation = wallLeft.reservedSide === 'left' ? -90
          : wallLeft.reservedSide === 'right' ? 90
            : wallLeft.reservedSide === 'bottom' ? 180 : 0;
        const startButton = state.startButton;
        const triggerCellSize = startButton && wallLeft.boardCols
          ? wallLeft.width / wallLeft.boardCols
          : CELL;
        const triggerSize = startButton
          ? triggerCellSize * 3
          : 0;
        const triggerScale = triggerCellSize / CELL;
        const triggerTiles = startButton ? Array.from({ length: 9 }, (_, index) => {
          const row = Math.floor(index / 3);
          const col = index % 3;
          const isCenter = row === 1 && col === 1;
          return (
            <g key={index} transform={`translate(${col * CELL},${row * CELL})`}>
              <Cell
                cell={{
                  state: isCenter ? 'revealed' : 'hidden',
                  adjacent: isCenter ? 1 : 0,
                  locked: false,
                }}
                palette={palette}
                cellStyle="bracket"
              />
            </g>
          );
        }) : null;
        return (
          <>
            {startButton && (
              <g className="intro-trigger" style={{animationDelay: negativeDelay}}
                 transform={`translate(${startButton.x},${startButton.y}) rotate(${wallRotation}) translate(${-triggerSize / 2},${-triggerSize / 2}) scale(${triggerScale})`}
                 pointerEvents="none">
                <g style={{filter: `drop-shadow(0 0 18px ${palette.primary})`}}>
                  {triggerTiles}
                </g>
              </g>
            )}
            <g transform={`translate(${wallLeft.originX + wallLeft.w / 2},${wallLeft.originY + wallLeft.h / 2}) rotate(${wallRotation}) translate(${-readableW / 2},${-readableH / 2})`}>
              <g className="intro-title" style={{animationDelay: negativeDelay}}>
                <text x={readableW / 2} y={readableH / 2 - 92}
                  textAnchor="middle" fontFamily="Orbitron" fontSize={112} fontWeight={900}
                  fill="#DFF5FA" letterSpacing="0.18em"
                  style={{filter: `drop-shadow(0 0 18px ${palette.primary})`}}>
                  CYBERCUBE
                </text>
                <text x={readableW / 2} y={readableH / 2 + 42}
                  textAnchor="middle" fontFamily="Orbitron" fontSize={84} fontWeight={900}
                  fill={palette.primary} letterSpacing="0.16em"
                  style={{filter: `drop-shadow(0 0 20px ${palette.primary})`}}>
                  MINESWEEPER
                </text>
                <line x1={readableW / 2 - 420} y1={readableH / 2 + 116}
                  x2={readableW / 2 + 420} y2={readableH / 2 + 116}
                  stroke={palette.primary} strokeWidth={3} opacity=".65"/>
                <text x={readableW / 2} y={readableH / 2 + 150}
                  textAnchor="middle" fontFamily="JetBrains Mono" fontSize={18}
                  fill="rgba(223,245,250,0.78)" letterSpacing="0.22em">
                  FIELD INITIALIZING · 704
                </text>
              </g>
            </g>
          </>
        );
      })()}
    </g>
  );
}

// ── Operator start transition ────────────────────────────
// A slow, simple fade separates external standby from the armed mine trigger.
// The venue map and 3x3 button remain underneath the curtain.
function OperatorStartTransitionOverlay({ state, palette, nowMs = () => Date.now() }) {
  if (state?.phase !== 'armed' || state.operatorTransitionStartedAt == null) return null;

  const durationMs = Math.max(1, Number(
    state.operatorTransitionDurationMs ||
    state.animationDurations?.operatorTransition ||
    4000,
  ));
  const durationS = durationMs / 1000;
  const elapsedS = Math.max(0, Math.min(durationS,
    (nowMs() - state.operatorTransitionStartedAt) / 1000));
  const negativeDelay = `${-elapsedS}s`;

  return (
    <g key={`operator-transition-${state.operatorTransitionStartedAt}`}
      pointerEvents="none">
      <style>{`
        .operator-start-curtain {
          animation: operatorStartCurtain ${durationS}s ease-in-out 1 both;
        }
        @keyframes operatorStartCurtain {
          0% { opacity: 0; }
          30% { opacity: .12; }
          52% { opacity: .48; }
          70% { opacity: .34; }
          100% { opacity: 0; }
        }
      `}</style>
      <rect className="operator-start-curtain" x={0} y={0}
        width={CANVAS_W} height={CANVAS_H}
        fill="#02040A" style={{animationDelay: negativeDelay}}/>
    </g>
  );
}

// ── Bomb breach effect ─────────────────────────────────
// 紅波蔓延(v1 風格 + CSS 加速):
// 1784 個 rects 一次 render 完,各自依距離計算 CSS animation-delay,
// 由 browser GPU 處理 fade-in,React 不參與每幀更新 → 不卡。
// Component unmount 時 rects + 動畫一起消失,restart 後乾淨。
const RED_WAVE_DURATION_S = 1.8;

function waveCellSize(face) {
  // redWave entries are always game-cell coordinates, including Floor.
  // Floor has no boardCols/boardRows in the snapshot, so derive its 64px
  // game-cell grid from the sensor dimensions instead of using 32x16 chips.
  const cols = face?.boardCols > 0
    ? face.boardCols
    : Math.floor(Number(face?.colCount || 0) / 2);
  const rows = face?.boardRows > 0
    ? face.boardRows
    : Math.floor(Number(face?.rowCount || 0) / 4);
  if (cols > 0 && rows > 0) {
    return [face.width / cols, face.height / rows];
  }
  return [
    Number(face?.cellPxW) || face.width / Math.max(1, face?.colCount || 1),
    Number(face?.cellPxH) || face.height / Math.max(1, face?.rowCount || 1),
  ];
}

function RedWaveOverlay({ palette, state, nowMs = () => Date.now() }) {
  if (!state?.redWave) return null;

  const wave = state.redWave;
  const maxDist = wave[wave.length - 1]?.dist || 1;
  const waveDurationS = animationDurationSeconds(state, 'redWave', RED_WAVE_DURATION_S);
  const waveElapsed = Math.max(0,
    (nowMs() - (state.redWaveStartedAt ?? nowMs())) / 1000);

  // 炸彈位置 (canvas px center of bomb cell). Timeout has no bomb cell, so
  // use the server-owned Floor visual origin instead of the unfolded canvas
  // center; that keeps the timeout wave aligned with the venue brief.
  const timeoutOrigin = state.animationOrigins?.timeout;
  let bx = timeoutOrigin?.x ?? CANVAS_W / 2;
  let by = timeoutOrigin?.y ?? CANVAS_H / 2;
  let bombFaceName = timeoutOrigin?.faceName ?? "—", bombCol = 0, bombRow = 0;
  if (state.bombCellId != null && state.cells?.[state.bombCellId]) {
    const c = state.cells[state.bombCellId];
    const f = state.faces.find(x => x.name === c.faceName);
    if (f) {
      const cellW = f.width / Math.max(1, f.boardCols || 1);
      const cellH = f.height / Math.max(1, f.boardRows || 1);
      bx = f.originX + (c.col + 0.5) * cellW;
      by = f.originY + (c.row + 0.5) * cellH;
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
        const [cellW, cellH] = waveCellSize(face);
        const x = face.originX + w.col * cellW;
        const y = face.originY + w.row * cellH;
        const delay = (w.dist / maxDist) * waveDurationS;
        return (
          <rect key={i} x={x} y={y} width={cellW} height={cellH}
            fill={palette.danger}
            style={{
              opacity: 0,
              animation: `breach-cell 0.7s ease-out ${(delay - waveElapsed).toFixed(2)}s 1 both`,
            }}
            pointerEvents="none"/>
        );
      })}

      {/* 炸彈核心快閃 (兩層) */}
      <g transform={`translate(${bx},${by})`} pointerEvents="none">
        <circle r={60} fill="#FFFFFF"
          style={{animation: `breach-core 0.5s ease-out ${(-waveElapsed).toFixed(2)}s 1 both`}}/>
        <circle r={100} fill={palette.danger} opacity={0.7}
          style={{animation: `breach-core-late 0.9s ease-out ${(0.05 - waveElapsed).toFixed(2)}s 1 both`}}/>
      </g>

      {/* 終端機 cascade log (左下角) */}
      <BreachLog palette={palette}
        bombFaceName={bombFaceName} bombCol={bombCol} bombRow={bombRow}/>
    </g>
  );
}

// ── Win ending sequence ──────────────────────────────────
// The game state remains gameOver; this is a synchronized presentation layer:
// gold ripple → cell dissolve → full-field mask → Wall Left victory typography.
const WIN_ENDING_DURATION_S = 6.2;
const WIN_PARTICLES = Array.from({ length: 88 }, (_, index) => {
  const x = 36 + ((index * 197) % (CANVAS_W - 72));
  const y = 36 + ((index * 311) % (CANVAS_H - 72));
  const type = index % 11 === 0 ? 'flare' : index % 3 === 0 ? 'streak' : 'dust';
  const size = type === 'flare'
    ? 8 + ((index * 13) % 6)
    : type === 'streak'
      ? 4 + ((index * 17) % 4)
      : 2.5 + ((index * 13) % 4);
  const driftX = ((index * 47) % 241) - 120;
  const driftY = ((index * 29) % 181) - 90;
  const duration = 5.6 + ((index * 17) % 40) / 10;
  const opacity = type === 'flare'
    ? 0.78 + ((index * 11) % 18) / 100
    : 0.52 + ((index * 11) % 28) / 100;
  const color = index % 7 === 0 ? '#FFF2C1'
    : index % 3 === 0 ? '#FFE08A' : '#FFD166';
  return {
    x, y, type, size, driftX, driftY, duration, opacity, color,
    trailX: -driftX * 0.18,
    trailY: -driftY * 0.18,
    delay: `${-((index * 23) % 60) / 10}s`,
  };
});

function WinEndingOverlay({ state, faces, palette, nowMs = () => Date.now() }) {
  if (!state?.gameOver || !state.won) return null;

  const endedAt = state.gameEndMs ?? nowMs();
  const durationS = animationDurationSeconds(state, 'winEnding', WIN_ENDING_DURATION_S);
  const elapsed = Math.max(0, Math.min(durationS, (nowMs() - endedAt) / 1000));
  const negativeDelay = `${-elapsed}s`;
  const floor = faces.find(f => f.isFloor);
  const wallLeft = faces.find(f => f.name === 'Wall Left');
  const sourceCell = state.lastRevealCellId != null ? state.cells?.[state.lastRevealCellId] : null;
  const sourceFace = sourceCell ? faces.find(f => f.name === sourceCell.faceName) : null;
  const sourceX = sourceCell && sourceFace
    ? sourceFace.originX + (sourceCell.col + 0.5) * CELL
    : floor ? floor.originX + floor.w / 2 : CANVAS_W / 2;
  const sourceY = sourceCell && sourceFace
    ? sourceFace.originY + (sourceCell.row + 0.5) * CELL
    : floor ? floor.originY + floor.h / 2 : CANVAS_H / 2;
  const safeTotal = state.cells.length - state.mineCount;
  const elapsedMs = state.gameStartMs != null ? Math.max(0, endedAt - state.gameStartMs) : 0;
  const readableW = wallLeft ? wallLeft.h : 2048;
  const readableH = wallLeft ? wallLeft.w : 640;
  const titleSize = Math.min(280, readableW * 0.17);
  const subtitleSize = Math.min(30, readableW * 0.022);

  return (
    <g key={`win-${endedAt}`} pointerEvents="none">
      <style>{`
        .win-ripple { animation: winRipple 2.0s ease-out 1 both; transform-origin: ${sourceX}px ${sourceY}px; }
        .win-wall-title { animation: winWallTitle ${durationS}s ease-out 1 both; }
        .win-mask { animation: winMask ${durationS}s ease-out 1 both; }
        .win-wall-score { animation: winWallScore ${durationS}s ease-out 1 both; }
        .win-dissolve-cell { animation: winCellDissolve 1.8s ease-out 1 both; }
        @keyframes winRipple {
          0% { opacity: .95; transform: scale(.04); }
          35% { opacity: .72; }
          100% { opacity: 0; transform: scale(42); }
        }
        @keyframes winWallTitle {
          0%, 20% { opacity: 0; transform: translateY(14px) scale(.86); }
          30%, 65% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes winMask {
          0%, 38% { opacity: 0; }
          50%, 100% { opacity: .82; }
        }
        @keyframes winWallScore {
          0%, 45% { opacity: 0; transform: translateY(18px); }
          58%, 100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes winCellDissolve {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>

      <circle className="win-ripple" cx={sourceX} cy={sourceY} r={34}
        fill="none" stroke="#FFD166" strokeWidth={9}
        style={{animationDelay: negativeDelay, filter: 'drop-shadow(0 0 18px #FFD166)'}}/>
      <circle className="win-ripple" cx={sourceX} cy={sourceY} r={86}
        fill="none" stroke={palette.accent} strokeWidth={3}
        style={{animationDelay: `${-(elapsed - 0.18)}s`, filter: `drop-shadow(0 0 12px ${palette.accent})`}}/>

      <rect className="win-mask" x={0} y={0} width={CANVAS_W} height={CANVAS_H}
        fill="#02040A" style={{animationDelay: negativeDelay}}/>

      <defs>
        <clipPath id={`win-particles-clip-${endedAt}`}>
          <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H}/>
        </clipPath>
      </defs>
      <g className="win-particles" clipPath={`url(#win-particles-clip-${endedAt})`}>
        {WIN_PARTICLES.map((particle, index) => (
          <g key={`win-particle-${index}`}
            transform={`translate(${particle.x},${particle.y})`}>
            <g>
              {particle.type === 'streak' && (
                <line x1={particle.trailX} y1={particle.trailY} x2={0} y2={0}
                  stroke={particle.color} strokeWidth="2" opacity=".30"/>
              )}
              {particle.type === 'flare' ? (
                <>
                  <path
                    d={`M 0 ${-particle.size * 2.8}
                        L ${particle.size * 0.42} ${-particle.size * 0.42}
                        L ${particle.size * 2.8} 0
                        L ${particle.size * 0.42} ${particle.size * 0.42}
                        L 0 ${particle.size * 2.8}
                        L ${-particle.size * 0.42} ${particle.size * 0.42}
                        L ${-particle.size * 2.8} 0
                        L ${-particle.size * 0.42} ${-particle.size * 0.42} Z`}
                    fill={particle.color} opacity={particle.opacity}
                    style={{filter: `drop-shadow(0 0 14px ${particle.color})`}}/>
                  <path d={`M 0 ${-particle.size * 3.8} V ${particle.size * 3.8}
                    M ${-particle.size * 3.8} 0 H ${particle.size * 3.8}`}
                    stroke="#FFF2C1" strokeWidth="1.5" opacity=".72"/>
                </>
              ) : (
                <path
                  d={`M 0 ${-particle.size}
                      L ${particle.size} 0
                      L 0 ${particle.size}
                      L ${-particle.size} 0 Z`}
                  fill={particle.color} opacity={particle.opacity}
                  style={{filter: `drop-shadow(0 0 7px ${particle.color})`}}/>
              )}
              <animateTransform attributeName="transform" type="translate"
                from="0 0"
                to={`${particle.driftX} ${particle.driftY}`}
                dur={`${particle.duration}s`} begin={particle.delay}
                repeatCount="indefinite" additive="sum"/>
              <animate attributeName="opacity"
                values={`.18;${particle.opacity};.46;.18`}
                dur={`${particle.duration}s`} begin={particle.delay}
                repeatCount="indefinite"/>
            </g>
          </g>
        ))}
      </g>

      {wallLeft && (
        <g transform={`translate(${wallLeft.originX + wallLeft.w / 2}, ${wallLeft.originY + wallLeft.h / 2}) rotate(${resultPanelRotation(wallLeft.reservedSide)})`}>
          <g className="win-wall-title" style={{animationDelay: negativeDelay}}>
            <text x={0} y={-112} textAnchor="middle" dominantBaseline="central"
              fontFamily="Orbitron" fontSize={titleSize} fontWeight={900}
              fill="#FFD166" letterSpacing="0.08em"
              style={{filter: 'drop-shadow(0 0 24px #FFD166)'}}>
              YOU WIN
            </text>
            <text x={0} y={42} textAnchor="middle" dominantBaseline="central"
              fontFamily="JetBrains Mono" fontSize={subtitleSize} fontWeight={700}
              fill="#FFF2C1" letterSpacing="0.18em">
              ALL SAFE CELLS REVEALED
            </text>
          </g>
          <g className="win-wall-score" style={{animationDelay: negativeDelay}}>
            <line x1={-readableW * 0.30} y1={70} x2={readableW * 0.30} y2={70}
              stroke={palette.primary} strokeWidth={3} opacity=".58"/>
            <ResultMetric y={120} label="TIME" value={fmtTime(elapsedMs)}
              color={palette.primary} span={readableW * 0.25}
              labelSize={26} valueSize={58}/>
            <ResultMetric y={195} label="MARKED MINES"
              value={String(state.flaggedCount).padStart(3, '0')}
              color="#FFD166" span={readableW * 0.25}
              labelSize={26} valueSize={58}/>
            <ResultMetric y={270} label="SAFE CELLS"
              value={`${state.revealedCount}/${safeTotal}`}
              color={palette.accent} span={readableW * 0.25}
              labelSize={26} valueSize={58}/>
            <text x={0} y={readableH * 0.48} textAnchor="middle"
              fontFamily="JetBrains Mono" fontSize={18}
              fill="rgba(223,245,250,0.68)" letterSpacing="0.16em">
              PHOTO / RESULT MODE
            </text>
          </g>
        </g>
      )}
    </g>
  );
}

// Timeout's CONTINUE touch starts the same room-scale closing grammar as the
// win path, but keeps the red TIME OUT identity and uses the original
// gameEndMs for the score duration.
function TimeoutEndingOverlay({ state, faces, palette, nowMs = () => Date.now() }) {
  if (!state?.gameOver || state.endReason !== 'timeout' ||
      state.endStage !== 'timeout-ending') return null;

  const durationS = animationDurationSeconds(state, 'timeoutEnding', WIN_ENDING_DURATION_S);
  const startedAt = state.endingStartedAt ?? nowMs();
  const elapsed = Math.max(0, Math.min(durationS,
    (nowMs() - startedAt) / 1000));
  const negativeDelay = `${-elapsed}s`;
  const floor = faces.find(f => f.isFloor);
  const wallLeft = faces.find(f => f.name === 'Wall Left');
  const floorX = floor ? floor.originX + floor.w / 2 : CANVAS_W / 2;
  const floorY = floor ? floor.originY + floor.h / 2 : CANVAS_H / 2;
  const safeTotal = state.cells.length - state.mineCount;
  const elapsedMs = state.gameStartMs != null && state.gameEndMs != null
    ? Math.max(0, state.gameEndMs - state.gameStartMs) : 0;

  return (
    <g key={`timeout-ending-${startedAt}`} pointerEvents="none">
      <style>{`
        .timeout-end-mask { animation: timeoutEndMask ${durationS}s ease-out 1 both; }
        .timeout-end-results { animation: timeoutEndResults ${durationS}s ease-out 1 both; }
        .win-dissolve-cell { animation: timeoutCellDissolve 1.8s ease-out 1 both; }
        @keyframes timeoutEndMask {
          0%, 38% { opacity: 0; }
          50%, 100% { opacity: .84; }
        }
        @keyframes timeoutEndResults {
          0%, 89% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes timeoutCellDissolve {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>

      <rect className="timeout-end-mask" x={0} y={0} width={CANVAS_W} height={CANVAS_H}
        fill="#02040A" style={{animationDelay: negativeDelay}}/>

      <g opacity={Math.min(1, elapsed / 0.55)}>
        <text x={floorX} y={floorY - 340} textAnchor="middle"
          fontFamily="Orbitron" fontSize={112} fontWeight={900}
          fill={palette.danger} letterSpacing="0.12em"
          style={{filter: `drop-shadow(0 0 18px ${palette.danger})`}}>
          TIME OUT
        </text>
        <text x={floorX} y={floorY - 250} textAnchor="middle"
          fontFamily="JetBrains Mono" fontSize={24} fontWeight={700}
          fill="#FFD9DE" letterSpacing="0.18em">
          SESSION COMPLETE
        </text>
      </g>

      {wallLeft && (
        <g transform={`translate(${wallLeft.originX + wallLeft.w / 2}, ${wallLeft.originY + wallLeft.h / 2}) rotate(${resultPanelRotation(wallLeft.reservedSide)})`}>
          <g className="timeout-end-results" style={{animationDelay: negativeDelay}}>
            <rect x={-RESULT_PANEL_W / 2} y={-RESULT_PANEL_H / 2}
              width={RESULT_PANEL_W} height={RESULT_PANEL_H} rx={18}
              fill="rgba(7,13,22,0.94)" stroke={palette.danger} strokeWidth={3}
              style={{filter: `drop-shadow(0 0 18px ${palette.danger})`}}/>
            <text x={0} y={-238} textAnchor="middle" fontFamily="Orbitron"
              fontSize={30} fontWeight={900} fill="#FFD9DE" letterSpacing="0.10em">
              TIME OUT
            </text>
            <text x={0} y={-198} textAnchor="middle" fontFamily="Orbitron"
              fontSize={25} fontWeight={700} fill={palette.danger} letterSpacing="0.14em">
              THANK YOU FOR PLAYING
            </text>
            <line x1={-230} y1={-156} x2={230} y2={-156} stroke={palette.danger} opacity=".45"/>
            <ResultMetric y={-76} label="TIME" value={fmtTime(elapsedMs)} color={palette.danger}/>
            <ResultMetric y={12} label="MARKED MINES" value={String(state.flaggedCount).padStart(3, '0')} color="#FFD166"/>
            <ResultMetric y={100} label="SAFE CELLS" value={`${state.revealedCount}/${safeTotal}`} color={palette.accent}/>
            <text x={0} y={248} textAnchor="middle" fontFamily="JetBrains Mono"
              fontSize={17} fill="rgba(223,245,250,0.68)" letterSpacing="0.14em">
              PHOTO / RESULT MODE
            </text>
          </g>
        </g>
      )}
    </g>
  );
}

// Operator termination skips the win/timeout sequence and goes straight to the
// readable score page while preserving the current round counters.
function OperatorEndingOverlay({ state, faces, palette }) {
  if (!state?.gameOver || state.endReason !== 'operator') return null;

  const wallLeft = faces.find(f => f.name === 'Wall Left');
  const floor = faces.find(f => f.isFloor);
  const floorX = floor ? floor.originX + floor.w / 2 : CANVAS_W / 2;
  const floorY = floor ? floor.originY + floor.h / 2 : CANVAS_H / 2;
  const safeTotal = state.cells.length - state.mineCount;
  const elapsedMs = state.gameStartMs != null && state.gameEndMs != null
    ? Math.max(0, state.gameEndMs - state.gameStartMs) : 0;

  return (
    <g key={`operator-ending-${state.gameEndMs ?? 'now'}`} pointerEvents="none">
      <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H}
        fill="rgba(2,4,10,0.82)"/>
      <text x={floorX} y={floorY - 340} textAnchor="middle"
        fontFamily="Orbitron" fontSize={104} fontWeight={900}
        fill={palette.primary} letterSpacing="0.12em"
        style={{filter: `drop-shadow(0 0 18px ${palette.primary})`}}>
        GAME ENDED
      </text>
      <text x={floorX} y={floorY - 250} textAnchor="middle"
        fontFamily="JetBrains Mono" fontSize={24} fontWeight={700}
        fill="rgba(223,245,250,0.84)" letterSpacing="0.18em">
        OPERATOR STOP
      </text>

      {wallLeft && (
        <g transform={`translate(${wallLeft.originX + wallLeft.w / 2}, ${wallLeft.originY + wallLeft.h / 2}) rotate(${resultPanelRotation(wallLeft.reservedSide)})`}>
          <rect x={-RESULT_PANEL_W / 2} y={-RESULT_PANEL_H / 2}
            width={RESULT_PANEL_W} height={RESULT_PANEL_H} rx={18}
            fill="rgba(7,13,22,0.96)" stroke={palette.primary} strokeWidth={3}
            style={{filter: `drop-shadow(0 0 18px ${palette.primary})`}}/>
          <text x={0} y={-238} textAnchor="middle" fontFamily="Orbitron"
            fontSize={32} fontWeight={900} fill="#DFF5FA" letterSpacing="0.10em">
            GAME ENDED
          </text>
          <text x={0} y={-198} textAnchor="middle" fontFamily="Orbitron"
            fontSize={24} fontWeight={700} fill={palette.primary} letterSpacing="0.13em">
            THANK YOU FOR PLAYING
          </text>
          <line x1={-230} y1={-156} x2={230} y2={-156}
            stroke={palette.primary} opacity=".45"/>
          <ResultMetric y={-76} label="TIME" value={fmtTime(elapsedMs)} color={palette.primary}/>
          <ResultMetric y={12} label="MARKED MINES"
            value={String(state.flaggedCount).padStart(3, '0')} color="#FFD166"/>
          <ResultMetric y={100} label="SAFE CELLS"
            value={`${state.revealedCount}/${safeTotal}`} color={palette.accent}/>
          <text x={0} y={248} textAnchor="middle" fontFamily="JetBrains Mono"
            fontSize={17} fill="rgba(223,245,250,0.68)" letterSpacing="0.14em">
            OPERATOR RESULT MODE
          </text>
        </g>
      )}
    </g>
  );
}

function ResultMetric({ y, label, value, color, span = 230, labelSize = 18, valueSize = 38 }) {
  return (
    <g transform={`translate(0,${y})`}>
      <text x={-span} y={0} fontFamily="JetBrains Mono" fontSize={labelSize}
        fill="rgba(143,168,184,0.78)" letterSpacing="0.10em">{label}</text>
      <text x={span} y={0} textAnchor="end" fontFamily="Orbitron" fontSize={valueSize}
        fontWeight={700} fill={color} letterSpacing="0.04em"
        style={{filter: `drop-shadow(0 0 7px ${color})`}}>{value}</text>
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
    case "armed": return "ARMED / AWAIT_MINE_TRIGGER";
    case "intro": return "INTRO / FIELD_INITIALIZING";
    case "ready": return "READY / AWAIT_FIELD_START";
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

Object.assign(window, {
  FaceFrame, IntroOverlay, RedWaveOverlay, WinEndingOverlay, TimeoutEndingOverlay,
  OperatorEndingOverlay, OperatorStartTransitionOverlay,
  VenueBadge, TopRightStatus, FaceConnectors, FloorGrid,
});
