// ── HUD strips, face labels, terminal command panel ──────

function FaceHUD({ face, palette, mineCount, flaggedCount, revealedCount, totalSafe, state, elapsedMs }) {
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
          elapsedMs={elapsedMs}/>
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

function HUDContent({ w, h, face, palette, mineCount, flaggedCount, revealedCount, totalSafe, state, elapsedMs }) {
  const wide = w > 800;
  const minesLeft = mineCount - flaggedCount;
  const timerStr = state === "idle" ? "00:00" : fmtTime(elapsedMs ?? 0);

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
      <text x={w/2} y={h*0.32} fontFamily="JetBrains Mono" fontSize={14}
        fill={palette.primary} textAnchor="middle" letterSpacing="0.2em" fontWeight={500}>
        {`// ${face.id}`}
      </text>
      <text x={w/2} y={h*0.55} fontFamily="Orbitron" fontWeight={700} fontSize={36}
        fill={state === "idle" ? "rgba(143,168,184,0.5)" : palette.primary}
        textAnchor="middle" letterSpacing="0.05em"
        style={{filter: state !== "idle" ? `drop-shadow(0 0 6px ${palette.primary})` : 'none'}}>
        {timerStr}
      </text>
      <text x={w/2} y={h*0.78} fontFamily="JetBrains Mono" fontSize={12}
        fill="rgba(143,168,184,0.5)" textAnchor="middle" letterSpacing="0.15em">
        {`${revealedCount}/${totalSafe} · T:${String(minesLeft).padStart(2,'0')}`}
      </text>
    </g>
  );
}

function FloorTerminal({ face, palette, state, lockedCellId, lockedFaceName, lockedCol, lockedRow }) {
  const cx = face.w / 2;
  const cy = face.h / 2;
  const BTN = 200;
  const gap = 40;
  const flagX = cx - BTN - gap/2;
  const revX = cx + gap/2;
  const btnY = cy - BTN/2;
  const CENTER = 192;

  if (state === "idle") {
    return <CenterButton kind="start" cx={cx} cy={cy} size={CENTER} palette={palette}/>;
  }
  if (state === "gameover-final") {
    return <CenterButton kind="endGame" cx={cx} cy={cy} size={CENTER} palette={palette}/>;
  }
  if (state === "gameover-wave") {
    return null;
  }
  if (state === "paused") {
    // PausedControls + mask 在 cyber-app.js 統一 render 在所有 face 上面,
    // 這裡留空避免被後續 face <g> 蓋掉 mask 效果
    return null;
  }

  return (
    <g>
      <g opacity={0.4}>
        <rect x={20} y={20} width={face.w - 40} height={face.h - 40}
          fill="none" stroke={palette.primary} strokeWidth={1} strokeDasharray="8 6"/>
        <text x={40} y={50} fontFamily="JetBrains Mono" fontSize={20}
          fill={palette.primary} letterSpacing="0.2em" opacity={0.7}>
          // INPUT.TERMINAL
        </text>
        <text x={face.w - 40} y={50} fontFamily="JetBrains Mono" fontSize={20}
          fill={palette.primary} letterSpacing="0.2em" opacity={0.7} textAnchor="end">
          STATE: ACTIVE
        </text>
      </g>

      <rect x={0} y={0} width={face.w/2} height={face.h} fill={palette.secondary} opacity={0.04}/>
      <rect x={face.w/2} y={0} width={face.w/2} height={face.h} fill={palette.accent} opacity={0.04}/>

      <line x1={face.w/2} y1={60} x2={face.w/2} y2={face.h - 60}
        stroke={palette.primary} strokeWidth={1} strokeDasharray="4 8" opacity={0.5}/>

      <g transform={`translate(${face.w/2}, 100)`}>
        <text x={0} y={0} fontFamily="JetBrains Mono" fontSize={22}
          fill="rgba(143,168,184,0.6)" textAnchor="middle" letterSpacing="0.2em">
          {lockedCellId != null ? "// CURSOR LOCKED" : "// CURSOR.IDLE"}
        </text>
        {lockedCellId != null && (
          <text x={0} y={32} fontFamily="JetBrains Mono" fontSize={28}
            fill={palette.primary} textAnchor="middle" letterSpacing="0.15em" fontWeight={500}
            style={{filter: `drop-shadow(0 0 4px ${palette.primary})`}}>
            {`[${lockedFaceName}] :: COL.${String(lockedCol).padStart(2,'0')} ROW.${String(lockedRow).padStart(2,'0')}`}
          </text>
        )}
      </g>

      <TerminalButton x={flagX} y={btnY} size={BTN} palette={palette}
        kind="flag" label="MARK" accent={palette.secondary}/>
      <TerminalButton x={revX} y={btnY} size={BTN} palette={palette}
        kind="reveal" label="SCAN" accent={palette.accent}/>

      {/* PAUSE 按鈕(在 MARK / SCAN 下方,對齊 server pause 區域)
          server 認 chip rows 104..115 為 pause(cellPxH=16 → face-local y = 1664..1856)
          button 192×192,以 cy=1760(chip row 110 中心)放置 → span y 1664..1856,
          剛好落在 server 接受範圍內,且遠離 MARK/SCAN(y 924..1124),不再重疊 */}
      <PauseButton cx={cx} cy={1760} palette={palette}/>

      <g transform={`translate(${face.w/2}, ${face.h - 80})`}>
        <text x={0} y={0} fontFamily="JetBrains Mono" fontSize={18}
          fill={palette.primary} textAnchor="middle" letterSpacing="0.3em" opacity={0.5}>
          MARK · SCAN · PAUSE
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
  const cy = face.h / 2;
  return (
    <g>
      {/* 半邊 tint:左綠(resume)、右紅(abort) */}
      <rect x={0} y={0} width={halfW} height={face.h}
        fill={palette.accent} opacity={0.10}/>
      <rect x={halfW} y={0} width={halfW} height={face.h}
        fill={palette.danger} opacity={0.10}/>
      {/* 中央分隔 */}
      <line x1={halfW} y1={60} x2={halfW} y2={face.h - 60}
        stroke="rgba(255,255,255,0.5)" strokeWidth={3} strokeDasharray="14 18"/>

      {/* PAUSED banner 在頂部 */}
      <g transform={`translate(${halfW}, 110)`}>
        <text x={0} y={0} textAnchor="middle"
          fontFamily="Orbitron" fontSize={60} fontWeight={900}
          fill={palette.warn} letterSpacing="0.32em"
          style={{filter: `drop-shadow(0 0 12px ${palette.warn})`}}>
          ⏸ PAUSED
        </text>
        <text x={0} y={48} textAnchor="middle"
          fontFamily="JetBrains Mono" fontSize={22}
          fill="rgba(255,255,255,0.5)" letterSpacing="0.25em">
          SESSION SUSPENDED · AWAIT_OPERATOR_DECISION
        </text>
      </g>

      {/* 左:RESUME */}
      <g transform={`translate(${halfW * 0.5}, ${cy + 60})`}
         style={{filter: `drop-shadow(0 0 12px ${palette.accent})`}}>
        <g stroke={palette.accent} strokeWidth={3} fill="none" opacity={0.8}>
          <polyline points="-150,-26 -180,-26 -180,4"/>
          <polyline points="150,-26 180,-26 180,4"/>
          <polyline points="-150,90 -180,90 -180,60"/>
          <polyline points="150,90 180,90 180,60"/>
        </g>
        <text x={0} y={-58} textAnchor="middle"
          fontFamily="JetBrains Mono" fontSize={16}
          fill={palette.accent} letterSpacing="0.3em" fontWeight={500}>
          // STEP HERE TO
        </text>
        <text x={0} y={20} textAnchor="middle"
          fontFamily="Orbitron" fontSize={72} fontWeight={900}
          fill={palette.accent} letterSpacing="0.10em">
          ▶ RESUME
        </text>
        <text x={0} y={60} textAnchor="middle"
          fontFamily="JetBrains Mono" fontSize={18}
          fill="rgba(143,168,184,0.85)" letterSpacing="0.2em">
          繼續遊戲
        </text>
      </g>

      {/* 右:ABORT */}
      <g transform={`translate(${halfW * 1.5}, ${cy + 60})`}
         style={{filter: `drop-shadow(0 0 12px ${palette.danger})`}}>
        <g stroke={palette.danger} strokeWidth={3} fill="none" opacity={0.8}>
          <polyline points="-150,-26 -180,-26 -180,4"/>
          <polyline points="150,-26 180,-26 180,4"/>
          <polyline points="-150,90 -180,90 -180,60"/>
          <polyline points="150,90 180,90 180,60"/>
        </g>
        <text x={0} y={-58} textAnchor="middle"
          fontFamily="JetBrains Mono" fontSize={16}
          fill={palette.danger} letterSpacing="0.3em" fontWeight={500}>
          // STEP HERE TO
        </text>
        <text x={0} y={20} textAnchor="middle"
          fontFamily="Orbitron" fontSize={72} fontWeight={900}
          fill={palette.danger} letterSpacing="0.10em">
          ◼ ABORT
        </text>
        <text x={0} y={60} textAnchor="middle"
          fontFamily="JetBrains Mono" fontSize={18}
          fill="rgba(143,168,184,0.85)" letterSpacing="0.2em">
          結束 · 回到待機
        </text>
      </g>
    </g>
  );
}

function TerminalButton({ x, y, size, kind, label, palette, accent }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <g stroke={accent} strokeWidth={4} fill="none" style={{filter: `drop-shadow(0 0 6px ${accent})`}}>
        <polyline points={`0,30 0,0 30,0`}/>
        <polyline points={`${size-30},0 ${size},0 ${size},30`}/>
        <polyline points={`0,${size-30} 0,${size} 30,${size}`}/>
        <polyline points={`${size-30},${size} ${size},${size} ${size},${size-30}`}/>
      </g>
      {kind === "flag" && (
        <g transform={`translate(${size/2}, ${size/2 - 18})`}
           style={{filter: `drop-shadow(0 0 6px ${accent})`}}>
          <polygon points="0,-30 26,12 -26,12" fill="none" stroke={accent} strokeWidth={4} strokeLinejoin="round"/>
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
      <text x={size/2} y={size - 24} textAnchor="middle"
        fontFamily="Orbitron" fontSize={26} fontWeight={700} fill={accent}
        letterSpacing="0.2em"
        style={{filter: `drop-shadow(0 0 4px ${accent})`}}>
        {label}
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
