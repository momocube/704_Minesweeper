// ── HUD strips, face labels, terminal command panel ──────

function FaceHUD({ face, palette, mineCount, flaggedCount, revealedCount, totalSafe, state, elapsedMs, currentMode }) {
  const reserved = face.reserved;
  if (!reserved) return null;

  const depth = 2 * CELL;
  let rect;
  switch (reserved) {
    case "top":    rect = { x: 0, y: 0, w: face.w, h: depth, rot: 0 }; break;
    case "bottom": rect = { x: 0, y: face.h - depth, w: face.w, h: depth, rot: 180 }; break;
    case "left":   rect = { x: 0, y: 0, w: depth, h: face.h, rot: 270 }; break;
    case "right":  rect = { x: face.w - depth, y: 0, w: depth, h: face.h, rot: 90 }; break;
  }

  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const w = (rect.rot === 0 || rect.rot === 180) ? rect.w : rect.h;
  const h = (rect.rot === 0 || rect.rot === 180) ? rect.h : rect.w;

  return (
    <g>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h}
        fill="rgba(0, 255, 229, 0.03)"/>
      {reserved === "top" && <rect x={rect.x} y={rect.y + rect.h - 3} width={rect.w} height={3} fill={palette.primary} opacity={0.7}/>}
      {reserved === "bottom" && <rect x={rect.x} y={rect.y} width={rect.w} height={3} fill={palette.primary} opacity={0.7}/>}
      {reserved === "left" && <rect x={rect.x + rect.w - 3} y={rect.y} width={3} height={rect.h} fill={palette.primary} opacity={0.7}/>}
      {reserved === "right" && <rect x={rect.x} y={rect.y} width={3} height={rect.h} fill={palette.primary} opacity={0.7}/>}

      <HUDTicks rect={rect} reserved={reserved} palette={palette}/>

      <g transform={`translate(${cx},${cy}) rotate(${rect.rot}) translate(${-w/2},${-h/2})`}>
        <HUDContent w={w} h={h} face={face} palette={palette}
          mineCount={mineCount} flaggedCount={flaggedCount}
          revealedCount={revealedCount} totalSafe={totalSafe} state={state}
          elapsedMs={elapsedMs} currentMode={currentMode}/>
      </g>
    </g>
  );
}

function HUDTicks({ rect, reserved, palette }) {
  const ticks = [];
  const len = (reserved === "top" || reserved === "bottom") ? rect.w : rect.h;
  const step = 64;
  const count = Math.floor(len / step);
  for (let i = 0; i <= count; i++) {
    const p = i * step;
    const isMajor = i % 5 === 0;
    if (reserved === "top") {
      ticks.push(<line key={i} x1={rect.x + p} y1={rect.y} x2={rect.x + p} y2={rect.y + (isMajor ? 8 : 4)}
        stroke={palette.primary} strokeWidth={1} opacity={isMajor ? 0.6 : 0.25}/>);
    }
    if (reserved === "bottom") {
      ticks.push(<line key={i} x1={rect.x + p} y1={rect.y + rect.h} x2={rect.x + p} y2={rect.y + rect.h - (isMajor ? 8 : 4)}
        stroke={palette.primary} strokeWidth={1} opacity={isMajor ? 0.6 : 0.25}/>);
    }
    if (reserved === "left") {
      ticks.push(<line key={i} x1={rect.x} y1={rect.y + p} x2={rect.x + (isMajor ? 8 : 4)} y2={rect.y + p}
        stroke={palette.primary} strokeWidth={1} opacity={isMajor ? 0.6 : 0.25}/>);
    }
    if (reserved === "right") {
      ticks.push(<line key={i} x1={rect.x + rect.w} y1={rect.y + p} x2={rect.x + rect.w - (isMajor ? 8 : 4)} y2={rect.y + p}
        stroke={palette.primary} strokeWidth={1} opacity={isMajor ? 0.6 : 0.25}/>);
    }
  }
  return <>{ticks}</>;
}

function HUDContent({ w, h, face, palette, mineCount, flaggedCount, revealedCount, totalSafe, state, elapsedMs, currentMode }) {
  const wide = w > 800;
  const minesLeft = mineCount - flaggedCount;
  const timerStr = state === "idle" ? "00:00" : fmtTime(elapsedMs ?? 0);

  // 模式提示色 + 字 — 只在 playing 顯示;mode 變化時加 mode-flash 動畫
  const showMode = state === "playing" && (currentMode === 'flag' || currentMode === 'reveal');
  const modeColor  = currentMode === 'flag' ? palette.secondary : palette.accent;
  const modeLabel  = currentMode === 'flag' ? 'MARK · FLAG' : 'SCAN · REVEAL';
  const modeGlyph  = currentMode === 'flag' ? '⚑' : '◎';

  if (wide) {
    return (
      <g>
        <g transform={`translate(40, ${h/2})`}>
          <rect x={0} y={-30} width={6} height={60} fill={palette.primary}/>
          <text x={20} y={-8} fontFamily="JetBrains Mono" fontSize={18}
            fill={palette.primary} letterSpacing="0.2em" fontWeight={500}>
            {`// ${face.id}`}
          </text>
          <text x={20} y={20} fontFamily="JetBrains Mono" fontSize={14}
            fill="rgba(143,168,184,0.7)" letterSpacing="0.1em">
            {`${face.cols}×${face.rows}_GRID`}
          </text>
        </g>

        <g transform={`translate(${w/2}, ${h/2})`}>
          <text x={0} y={-22} fontFamily="JetBrains Mono" fontSize={14}
            fill="rgba(143,168,184,0.6)" textAnchor="middle" letterSpacing="0.25em">
            T.UPTIME
          </text>
          <text x={0} y={20} fontFamily="Orbitron" fontWeight={700} fontSize={56}
            fill={state === "idle" ? "rgba(143,168,184,0.5)" : palette.primary}
            textAnchor="middle" letterSpacing="0.05em"
            style={{filter: state !== "idle" ? `drop-shadow(0 0 8px ${palette.primary})` : 'none'}}>
            {timerStr}
          </text>
          {showMode && (
            // mode 變化時 React 把 key 重設 → 重新觸發 mode-flash 動畫
            <g key={`mode-${currentMode}`} className="mode-flash"
               transform={`translate(0, 52)`}>
              <text x={0} y={0} fontFamily="JetBrains Mono" fontSize={13}
                fill="rgba(143,168,184,0.6)" textAnchor="middle" letterSpacing="0.3em">
                MODE
              </text>
              <text x={0} y={24} fontFamily="Orbitron" fontWeight={900} fontSize={22}
                fill={modeColor} textAnchor="middle" letterSpacing="0.18em"
                style={{filter: `drop-shadow(0 0 6px ${modeColor})`}}>
                {`${modeGlyph} ${modeLabel}`}
              </text>
            </g>
          )}
        </g>

        <g transform={`translate(${w - 40}, ${h/2})`}>
          <g transform="translate(-220, 0)">
            <text x={0} y={-8} fontFamily="JetBrains Mono" fontSize={12}
              fill="rgba(143,168,184,0.6)" textAnchor="end" letterSpacing="0.2em">SAFE</text>
            <text x={0} y={20} fontFamily="Orbitron" fontWeight={700} fontSize={28}
              fill={palette.accent} textAnchor="end" letterSpacing="0.05em"
              style={{filter: `drop-shadow(0 0 4px ${palette.accent})`}}>
              {`${revealedCount}/${totalSafe}`}
            </text>
          </g>
          <g transform="translate(0, 0)">
            <text x={0} y={-8} fontFamily="JetBrains Mono" fontSize={12}
              fill="rgba(143,168,184,0.6)" textAnchor="end" letterSpacing="0.2em">THREAT</text>
            <text x={0} y={20} fontFamily="Orbitron" fontWeight={700} fontSize={28}
              fill={palette.danger} textAnchor="end" letterSpacing="0.05em"
              style={{filter: `drop-shadow(0 0 4px ${palette.danger})`}}>
              {String(minesLeft).padStart(3, '0')}
            </text>
          </g>
        </g>
      </g>
    );
  }

  return (
    <g>
      <text x={w/2} y={h*0.24} fontFamily="JetBrains Mono" fontSize={14}
        fill={palette.primary} textAnchor="middle" letterSpacing="0.2em" fontWeight={500}>
        {`// ${face.id}`}
      </text>
      <text x={w/2} y={h*0.46} fontFamily="Orbitron" fontWeight={700} fontSize={36}
        fill={state === "idle" ? "rgba(143,168,184,0.5)" : palette.primary}
        textAnchor="middle" letterSpacing="0.05em"
        style={{filter: state !== "idle" ? `drop-shadow(0 0 6px ${palette.primary})` : 'none'}}>
        {timerStr}
      </text>
      {showMode && (
        <g key={`mode-${currentMode}`} className="mode-flash">
          <text x={w/2} y={h*0.66} fontFamily="Orbitron" fontWeight={900} fontSize={16}
            fill={modeColor} textAnchor="middle" letterSpacing="0.18em"
            style={{filter: `drop-shadow(0 0 4px ${modeColor})`}}>
            {`${modeGlyph} ${modeLabel}`}
          </text>
        </g>
      )}
      <text x={w/2} y={h*0.85} fontFamily="JetBrains Mono" fontSize={12}
        fill="rgba(143,168,184,0.5)" textAnchor="middle" letterSpacing="0.15em">
        {`${revealedCount}/${totalSafe} · T:${String(minesLeft).padStart(2,'0')}`}
      </text>
    </g>
  );
}

// Floor button geometry — 192×192 venue px each, chip-aligned, exactly
// matching server/game.js's FLOOR_BUTTONS so a physical step on the button
// area triggers the server-side action it visually represents.
//   MARK   chips 13..18 × 58..69  → face-local (416, 928) to (608, 1120)
//   CENTER chips 19..24 × 58..69  → face-local (608, 928) to (800, 1120)
//   SCAN   chips 25..30 × 58..69  → face-local (800, 928) to (992, 1120)
//   PAUSE  chips 19..24 × 104..115 → face-local (608,1664) to (800,1856)
const FLOOR_BTN = 192;
const FLOOR_BTN_ROW_Y = 928;     // top of MARK/CENTER/SCAN row
const FLOOR_PAUSE_Y   = 1664;    // top of PAUSE row
const FLOOR_MARK_X    = 416;
const FLOOR_CENTER_X  = 608;
const FLOOR_SCAN_X    = 800;

function FloorTerminal({ face, palette, state, currentMode }) {
  const cx = face.w / 2;
  const cy = face.h / 2;
  const CENTER = 192;

  if (state === "idle") {
    return <CenterButton kind="start" cx={cx} cy={cy} size={CENTER} palette={palette}/>;
  }
  if (state === "gameover-final") {
    return <CenterButton kind="endGame" cx={cx} cy={cy} size={CENTER} palette={palette}/>;
  }
  if (state === "gameover-wave") return null;
  if (state === "paused") {
    // PausedControls 在 cyber-app.js 統一 render 在 mask 上面
    return null;
  }

  const markActive = currentMode === 'flag';
  const scanActive = currentMode === 'reveal';
  const activeLabel = markActive ? 'MARK' : scanActive ? 'SCAN' : '—';
  const activeColor = markActive ? palette.secondary : palette.accent;

  return (
    <g>
      {/* 整片 Floor 套用 mode 顏色低透明度淡染 — 切換 mode 時整個地板顏色變,讓人從遠處就看到目前模式 */}
      <rect key={`tint-${currentMode}`} className="mode-tint"
        x={0} y={0} width={face.w} height={face.h}
        fill={activeColor} opacity={0.07}/>

      <g opacity={0.35}>
        <rect x={20} y={20} width={face.w - 40} height={face.h - 40}
          fill="none" stroke={activeColor} strokeWidth={1.5} strokeDasharray="8 6"/>
        <text x={40} y={50} fontFamily="JetBrains Mono" fontSize={20}
          fill={activeColor} letterSpacing="0.2em" opacity={0.85}>
          // INPUT.TERMINAL
        </text>
        <text x={face.w - 40} y={50} fontFamily="JetBrains Mono" fontSize={20}
          fill={activeColor} letterSpacing="0.2em" opacity={0.85} textAnchor="end">
          {`MODE: ${activeLabel}`}
        </text>
      </g>

      {/* MODE readout — 大字置中,顯示目前模式 */}
      <g transform={`translate(${cx}, ${FLOOR_BTN_ROW_Y - 96})`}>
        <text x={0} y={-22} fontFamily="JetBrains Mono" fontSize={20}
          fill="rgba(143,168,184,0.55)" textAnchor="middle" letterSpacing="0.32em">
          // ACTIVE MODE
        </text>
        <text x={0} y={28} fontFamily="Orbitron" fontWeight={900} fontSize={64}
          fill={activeColor} textAnchor="middle" letterSpacing="0.18em"
          style={{filter: `drop-shadow(0 0 10px ${activeColor})`}}>
          {activeLabel}
        </text>
        <text x={0} y={56} fontFamily="JetBrains Mono" fontSize={14}
          fill="rgba(143,168,184,0.45)" textAnchor="middle" letterSpacing="0.25em">
          {markActive ? '踩牆面格子 → 切換旗子' : '踩牆面格子 → 揭露'}
        </text>
      </g>

      <TerminalButton x={FLOOR_MARK_X} y={FLOOR_BTN_ROW_Y} size={FLOOR_BTN} palette={palette}
        kind="flag" label="MARK" accent={palette.secondary} active={markActive}/>
      <TerminalButton x={FLOOR_SCAN_X} y={FLOOR_BTN_ROW_Y} size={FLOOR_BTN} palette={palette}
        kind="reveal" label="SCAN" accent={palette.accent} active={scanActive}/>

      <PauseButton cx={cx} cy={FLOOR_PAUSE_Y + FLOOR_BTN/2} palette={palette}/>

      <g transform={`translate(${face.w/2}, ${face.h - 80})`}>
        <text x={0} y={0} fontFamily="JetBrains Mono" fontSize={18}
          fill={palette.primary} textAnchor="middle" letterSpacing="0.3em" opacity={0.5}>
          STEP MARK · STEP SCAN · STEP PAUSE
        </text>
      </g>
    </g>
  );
}

function PauseButton({ cx, cy, palette }) {
  const size = 192;
  const half = size / 2;
  const accent = palette.warn;
  return (
    <g transform={`translate(${cx - half},${cy - half})`}>
      {/* 不透明深色背板擋住 Floor 底色 */}
      <rect x={-20} y={-20} width={size + 40} height={size + 40}
        fill="#04060A" opacity={0.95}/>
      {/* 外圈 dashed ring */}
      <circle cx={half} cy={half} r={size * 0.7} fill="none"
        stroke={accent} strokeWidth={1.5} opacity={0.25}
        strokeDasharray="14 10" className="pulse-slow"/>
      {/* 主框 */}
      <rect x={0} y={0} width={size} height={size}
        fill={`${accent}26`} stroke={accent} strokeWidth={3}
        style={{filter: `drop-shadow(0 0 12px ${accent})`}}
        className="pulse-slow"/>
      {/* 4 個角 brackets */}
      <g stroke={accent} strokeWidth={4} fill="none">
        <polyline points={`-8,30 -8,-8 30,-8`}/>
        <polyline points={`${size-30},-8 ${size+8},-8 ${size+8},30`}/>
        <polyline points={`-8,${size-30} -8,${size+8} 30,${size+8}`}/>
        <polyline points={`${size-30},${size+8} ${size+8},${size+8} ${size+8},${size-30}`}/>
      </g>
      {/* 3x3 sub-grid */}
      <g opacity={0.25} stroke={accent} strokeWidth={1}>
        <line x1={size/3} y1={0} x2={size/3} y2={size}/>
        <line x1={size*2/3} y1={0} x2={size*2/3} y2={size}/>
        <line x1={0} y1={size/3} x2={size} y2={size/3}/>
        <line x1={0} y1={size*2/3} x2={size} y2={size*2/3}/>
      </g>
      {/* 暫停符號 (兩條粗豎線) */}
      <g style={{filter: `drop-shadow(0 0 6px ${accent})`}}>
        <rect x={half - 26} y={half - 36} width={16} height={72} fill={accent}/>
        <rect x={half + 10} y={half - 36} width={16} height={72} fill={accent}/>
      </g>
      {/* 標籤 */}
      <text x={half} y={size + 28} textAnchor="middle"
        fontFamily="Orbitron" fontSize={24} fontWeight={700} fill={accent}
        letterSpacing="0.2em"
        style={{filter: `drop-shadow(0 0 4px ${accent})`}}>
        PAUSE
      </text>
    </g>
  );
}

function PausedControls({ face, palette }) {
  const halfW = face.w / 2;
  return (
    <g>
      {/* PAUSED banner 在頂部 */}
      <g transform={`translate(${halfW}, ${FLOOR_BTN_ROW_Y - 100})`}>
        <text x={0} y={0} textAnchor="middle"
          fontFamily="Orbitron" fontSize={56} fontWeight={900}
          fill={palette.warn} letterSpacing="0.32em"
          style={{filter: `drop-shadow(0 0 12px ${palette.warn})`}}>
          ⏸ PAUSED
        </text>
        <text x={0} y={42} textAnchor="middle"
          fontFamily="JetBrains Mono" fontSize={18}
          fill="rgba(255,255,255,0.6)" letterSpacing="0.25em">
          SESSION SUSPENDED · AWAIT_OPERATOR_DECISION
        </text>
      </g>

      {/* RESUME 在 MARK 位置,ABORT 在 SCAN 位置 — 跟其他按鈕同樣 192×192 */}
      <PausedButton x={FLOOR_MARK_X} y={FLOOR_BTN_ROW_Y} size={FLOOR_BTN}
        glyph="▶" label="RESUME" sub="繼續遊戲" accent={palette.accent}/>
      <PausedButton x={FLOOR_SCAN_X} y={FLOOR_BTN_ROW_Y} size={FLOOR_BTN}
        glyph="◼" label="ABORT" sub="結束 · 回到待機" accent={palette.danger}/>
    </g>
  );
}

function PausedButton({ x, y, size, glyph, label, sub, accent }) {
  const half = size / 2;
  return (
    <g transform={`translate(${x},${y})`}>
      {/* 深色背板擋住 paused mask 透出來的 Floor 底色 */}
      <rect x={-12} y={-12} width={size + 24} height={size + 24}
        fill="#04060A" opacity={0.92}/>
      {/* 主框 + 角落 brackets */}
      <rect x={0} y={0} width={size} height={size}
        fill={`${accent}26`} stroke={accent} strokeWidth={3}
        style={{filter: `drop-shadow(0 0 12px ${accent})`}}
        className="pulse-slow"/>
      <g stroke={accent} strokeWidth={4} fill="none">
        <polyline points={`0,30 0,0 30,0`}/>
        <polyline points={`${size-30},0 ${size},0 ${size},30`}/>
        <polyline points={`0,${size-30} 0,${size} 30,${size}`}/>
        <polyline points={`${size-30},${size} ${size},${size} ${size},${size-30}`}/>
      </g>
      {/* glyph 置中 */}
      <text x={half} y={half - 8} textAnchor="middle" dominantBaseline="central"
        fontFamily="Orbitron" fontWeight={900} fontSize={size * 0.35}
        fill={accent}
        style={{filter: `drop-shadow(0 0 6px ${accent})`}}>
        {glyph}
      </text>
      {/* label */}
      <text x={half} y={half + size * 0.22} textAnchor="middle"
        fontFamily="Orbitron" fontWeight={700} fontSize={22}
        fill={accent} letterSpacing="0.18em"
        style={{filter: `drop-shadow(0 0 4px ${accent})`}}>
        {label}
      </text>
      <text x={half} y={half + size * 0.32} textAnchor="middle"
        fontFamily="JetBrains Mono" fontSize={13}
        fill="rgba(143,168,184,0.7)" letterSpacing="0.15em">
        {sub}
      </text>
    </g>
  );
}

function TerminalButton({ x, y, size, kind, label, palette, accent, active }) {
  const op = active ? 1 : 0.55;
  const sw = active ? 5 : 3;
  return (
    <g transform={`translate(${x},${y})`} opacity={op}>
      {/* 主框:active 時填色高亮 + pulse */}
      <rect x={0} y={0} width={size} height={size}
        fill={active ? `${accent}26` : 'rgba(4,6,10,0.55)'}
        stroke={accent} strokeWidth={sw}
        style={{filter: active ? `drop-shadow(0 0 16px ${accent})` : `drop-shadow(0 0 4px ${accent})`}}
        className={active ? 'pulse-slow' : ''}/>
      {/* 角落 brackets */}
      <g stroke={accent} strokeWidth={4} fill="none"
         style={{filter: `drop-shadow(0 0 6px ${accent})`}}>
        <polyline points={`0,30 0,0 30,0`}/>
        <polyline points={`${size-30},0 ${size},0 ${size},30`}/>
        <polyline points={`0,${size-30} 0,${size} 30,${size}`}/>
        <polyline points={`${size-30},${size} ${size},${size} ${size},${size-30}`}/>
      </g>
      {kind === "flag" && (
        <g transform={`translate(${size/2}, ${size/2 - 18})`}
           style={{filter: `drop-shadow(0 0 6px ${accent})`}}>
          <polygon points="0,-30 26,12 -26,12" fill={active ? accent : 'none'}
            stroke={accent} strokeWidth={4} strokeLinejoin="round"/>
          <line x1="0" y1="-20" x2="0" y2="30" stroke={accent} strokeWidth={4}/>
        </g>
      )}
      {kind === "reveal" && (
        <g transform={`translate(${size/2}, ${size/2 - 18})`}
           style={{filter: `drop-shadow(0 0 6px ${accent})`}}>
          <circle cx="0" cy="0" r="24" fill="none" stroke={accent} strokeWidth={3}/>
          <circle cx="0" cy="0" r="12" fill="none" stroke={accent} strokeWidth={3}/>
          <line x1="-30" y1="0" x2="-18" y2="0" stroke={accent} strokeWidth={3}/>
          <line x1="18" y1="0" x2="30" y2="0" stroke={accent} strokeWidth={3}/>
          <line x1="0" y1="-30" x2="0" y2="-18" stroke={accent} strokeWidth={3}/>
          <line x1="0" y1="18" x2="0" y2="30" stroke={accent} strokeWidth={3}/>
          <circle cx="0" cy="0" r="3" fill={accent}/>
        </g>
      )}
      <text x={size/2} y={size - 22} textAnchor="middle"
        fontFamily="Orbitron" fontSize={24} fontWeight={active ? 900 : 700} fill={accent}
        letterSpacing="0.2em"
        style={{filter: `drop-shadow(0 0 4px ${accent})`}}>
        {label}{active ? ' ●' : ''}
      </text>
    </g>
  );
}

function CenterButton({ kind, cx, cy, size, palette }) {
  const half = size / 2;
  const accent = kind === "start" ? palette.accent : palette.danger;
  const glyph = kind === "start" ? "▶" : (kind === "endGame" ? "⏏" : "↻");
  const label = kind === "start" ? "EXECUTE.START"
              : kind === "endGame" ? "RETURN.STANDBY"
              : "EXECUTE.RESET";
  const sub   = kind === "start" ? "踩入以啟動"
              : kind === "endGame" ? "結束 · 回到待機"
              : "踩入以重啟";
  const pad = 28;
  return (
    <g transform={`translate(${cx - half},${cy - half})`}>
      <circle cx={half} cy={half} r={size * 0.85} fill="none"
        stroke={accent} strokeWidth={2} opacity={0.15} className="pulse-slow"/>
      <circle cx={half} cy={half} r={size * 1.1} fill="none"
        stroke={accent} strokeWidth={1} opacity={0.08} strokeDasharray="20 14" className="pulse-slow"/>

      {/* 不透明深色背板:擋住下方紅波 / Floor 顏色,讓按鈕在任何狀態都清晰可見 */}
      <rect x={-pad} y={-pad} width={size + pad*2} height={size + pad*2}
        fill="#04060A" opacity={0.95}/>

      <rect x={0} y={0} width={size} height={size}
        fill={`${accent}33`} stroke={accent} strokeWidth={3}
        style={{filter: `drop-shadow(0 0 16px ${accent})`}}
        className="pulse-slow"/>

      <g stroke={accent} strokeWidth={4} fill="none">
        <polyline points={`-8,30 -8,-8 30,-8`}/>
        <polyline points={`${size-30},-8 ${size+8},-8 ${size+8},30`}/>
        <polyline points={`-8,${size-30} -8,${size+8} 30,${size+8}`}/>
        <polyline points={`${size-30},${size+8} ${size+8},${size+8} ${size+8},${size-30}`}/>
      </g>

      <g opacity={0.25} stroke={accent} strokeWidth={1}>
        <line x1={size/3} y1={0} x2={size/3} y2={size}/>
        <line x1={size*2/3} y1={0} x2={size*2/3} y2={size}/>
        <line x1={0} y1={size/3} x2={size} y2={size/3}/>
        <line x1={0} y1={size*2/3} x2={size} y2={size*2/3}/>
      </g>

      <text x={half} y={half - 6} textAnchor="middle" dominantBaseline="central"
        fontFamily="Orbitron" fontWeight={900} fontSize={size * 0.4}
        fill={accent}
        style={{filter: `drop-shadow(0 0 6px ${accent})`}}>
        {glyph}
      </text>
      <text x={half} y={half + size * 0.27} textAnchor="middle"
        fontFamily="JetBrains Mono" fontWeight={500} fontSize={20}
        fill={accent} letterSpacing="0.2em">
        {label}
      </text>
      <text x={half} y={half + size * 0.27 + 26} textAnchor="middle"
        fontFamily="JetBrains Mono" fontSize={14}
        fill="rgba(143,168,184,0.7)" letterSpacing="0.15em">
        {sub}
      </text>
    </g>
  );
}

Object.assign(window, { FaceHUD, FloorTerminal, PausedControls });
