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

  // mode 顯示 = HUD 底色變色(不是另起一欄文字)
  // playing 時:整條 HUD 底色 = 該模式色(低 opacity);切換時 CSS transition 0.5s 滑順過渡
  const isPlaying = state === "playing";
  const modeBgColor = (isPlaying && currentMode === 'flag')   ? palette.secondary
                    : (isPlaying && currentMode === 'reveal') ? palette.accent
                    : palette.primary;
  const modeEdgeColor = modeBgColor;

  return (
    <g>
      {/* 底色:用 CSS transition 讓 fill 在 mode 變化時滑順過渡 0.5s */}
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h}
        fill={modeBgColor} opacity={isPlaying ? 0.13 : 0.04}
        style={{transition: 'fill 0.5s ease-out, opacity 0.5s ease-out'}}/>
      {/* 內側邊緣亮線(朝向 game area 那一邊),也跟著 mode 色 */}
      {reserved === "top" && <rect x={rect.x} y={rect.y + rect.h - 3} width={rect.w} height={3}
        fill={modeEdgeColor} opacity={0.75} style={{transition: 'fill 0.5s ease-out'}}/>}
      {reserved === "bottom" && <rect x={rect.x} y={rect.y} width={rect.w} height={3}
        fill={modeEdgeColor} opacity={0.75} style={{transition: 'fill 0.5s ease-out'}}/>}
      {reserved === "left" && <rect x={rect.x + rect.w - 3} y={rect.y} width={3} height={rect.h}
        fill={modeEdgeColor} opacity={0.75} style={{transition: 'fill 0.5s ease-out'}}/>}
      {reserved === "right" && <rect x={rect.x} y={rect.y} width={3} height={rect.h}
        fill={modeEdgeColor} opacity={0.75} style={{transition: 'fill 0.5s ease-out'}}/>}

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
  // mode 由 HUD 底色顯示(在 FaceHUD 那層處理),這裡內容不再放 MODE 欄

  if (wide) {
    // MODE 自己佔一個欄,放在 callsign 跟 timer 之間,跟 SAFE/THREAT 一樣
    // 是「左對齊 label + 大字數據」的 column 風格,跟計時器不再疊
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

  // 窄面 (Wall Right Little) — mode 由 HUD 底色顯示,文字保持簡潔三層
  return (
    <g>
      <text x={w/2} y={h*0.30} fontFamily="JetBrains Mono" fontSize={14}
        fill={palette.primary} textAnchor="middle" letterSpacing="0.2em" fontWeight={500}>
        {`// ${face.id}`}
      </text>
      <text x={w/2} y={h*0.58} fontFamily="Orbitron" fontWeight={700} fontSize={36}
        fill={state === "idle" ? "rgba(143,168,184,0.5)" : palette.primary}
        textAnchor="middle" letterSpacing="0.05em"
        style={{filter: state !== "idle" ? `drop-shadow(0 0 6px ${palette.primary})` : 'none'}}>
        {timerStr}
      </text>
      <text x={w/2} y={h*0.82} fontFamily="JetBrains Mono" fontSize={12}
        fill="rgba(143,168,184,0.6)" textAnchor="middle" letterSpacing="0.15em">
        {`${revealedCount}/${totalSafe} · T:${String(minesLeft).padStart(2,'0')}`}
      </text>
    </g>
  );
}

// Floor button geometry — 內 SCAN 圓 + 外 MARK 環(donut),四面牆都好踩到
// PAUSE 還是放在原本 chip rows 104..115 的方塊。
// 跟 server/game.js 的 SCAN_R / MARK_R / PAUSE box 一致。
const SCAN_INNER_R   = 210;   // scan 範圍拉大
const MARK_OUTER_R   = 290;   // mark 環變薄(80 venue px)
const FLOOR_PAUSE_Y  = 1664;
const FLOOR_BTN      = 192;

function FloorTerminal({ face, palette, state, currentMode, tutorialStep=0, tutorialTotal=4, countdownValue=null }) {
  const cx = face.w / 2;
  const cy = face.h / 2;

  if (state === "idle") {
    return <CenterButton kind="play" cx={cx} cy={cy} r={SCAN_INNER_R} palette={palette}/>;
  }
  if (state === "tutorial") {
    return <CenterButton kind="continue" cx={cx} cy={cy} r={SCAN_INNER_R}
      palette={palette} progress={`${tutorialStep + 1} / ${tutorialTotal}`}/>;
  }
  if (state === "tutorialReady") {
    return <CenterButton kind="playReady" cx={cx} cy={cy} r={SCAN_INNER_R} palette={palette}/>;
  }
  if (state === "countdown") {
    return <CountdownFloor cx={cx} cy={cy} palette={palette} value={countdownValue}/>;
  }
  if (state === "gameover-final") {
    return <CenterButton kind="endGame" cx={cx} cy={cy} r={SCAN_INNER_R} palette={palette}/>;
  }
  if (state === "gameover-wave") return null;
  if (state === "paused") {
    // PausedControls 在 cyber-app.js 統一 render 在 mask 上面
    return null;
  }

  const activeColor = currentMode === 'flag' ? palette.secondary : palette.accent;
  const activeLabel = currentMode === 'flag' ? 'MARK' : 'SCAN';

  return (
    <g>
      {/* 整片 Floor 淡染當前模式色 */}
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

      {/* DONUT — 內圈 SCAN + 外環 MARK,四面牆都能踩到 */}
      <FloorDonut cx={cx} cy={cy} innerR={SCAN_INNER_R} outerR={MARK_OUTER_R}
        innerColor={palette.accent}    innerGlyph="◎" innerLabel="SCAN" innerSub="揭露格子"
        outerColor={palette.secondary} outerGlyph="⚑" outerLabel="MARK" outerSub="切換旗子"
        mode={currentMode}/>

      <PauseButton cx={cx} cy={FLOOR_PAUSE_Y + FLOOR_BTN/2} palette={palette}/>

      <g transform={`translate(${face.w/2}, ${face.h - 80})`}>
        <text x={0} y={0} fontFamily="JetBrains Mono" fontSize={18}
          fill={palette.primary} textAnchor="middle" letterSpacing="0.3em" opacity={0.5}>
          INNER · SCAN ◎    OUTER RING · MARK ⚑    STEP PAUSE
        </text>
      </g>
    </g>
  );
}

// FloorDonut — 內圈 = inner action,外環 = outer action;四個方向都有外環標籤
// 讓站在任何牆邊的玩家都看得到該踩哪邊。
//   mode = 'reveal' → 內圈高亮
//   mode = 'flag'   → 外環高亮
//   mode = 'both'   → 兩邊都高亮(用於 paused 提示玩家二選一)
function FloorDonut({ cx, cy, innerR, outerR,
                      innerColor, outerColor,
                      innerGlyph, innerLabel, innerSub,
                      outerGlyph, outerLabel, outerSub,
                      mode }) {
  const midR = (innerR + outerR) / 2;
  const ringW = outerR - innerR;
  const innerActive = mode === 'reveal' || mode === 'both';
  const outerActive = mode === 'flag'   || mode === 'both';

  // Perf: 把 drop-shadow filter 限制到必要元素;background fill 不用 filter,
  // edges 跟 text 還是保留 glow。pulse-slow 只掛在 active 那一邊。
  return (
    <g>
      {/* ── Outer ring fill (no filter — opacity 切換已經夠視覺差) ── */}
      <circle cx={cx} cy={cy} r={midR} fill="none"
        stroke={outerColor} strokeWidth={ringW}
        opacity={outerActive ? 0.22 : 0.07}
        className={outerActive ? 'pulse-slow' : ''}
        style={{transition: 'opacity 0.4s ease-out'}}/>

      {/* ── Outer ring edges (glow on edges,不在 fill) ── */}
      <circle cx={cx} cy={cy} r={outerR} fill="none"
        stroke={outerColor} strokeWidth={outerActive ? 4 : 2}
        style={{filter: `drop-shadow(0 0 6px ${outerColor})`}}/>
      <circle cx={cx} cy={cy} r={innerR} fill="none"
        stroke={outerColor} strokeWidth={1.5} strokeDasharray="6 5"
        opacity={0.55}/>

      {/* ── Inner SCAN fill (no filter) ── */}
      <circle cx={cx} cy={cy} r={innerR}
        fill={innerColor} fillOpacity={innerActive ? 0.20 : 0.07}
        className={innerActive ? 'pulse-slow' : ''}
        style={{transition: 'fill-opacity 0.4s ease-out'}}/>
      <circle cx={cx} cy={cy} r={innerR} fill="none"
        stroke={innerColor} strokeWidth={innerActive ? 4 : 2.5}
        style={{filter: `drop-shadow(0 0 6px ${innerColor})`}}/>

      {/* ── Inner SCAN glyph + label (single filter on group) ── */}
      <g style={{filter: `drop-shadow(0 0 6px ${innerColor})`}}>
        <text x={cx} y={cy - 18} textAnchor="middle" dominantBaseline="central"
          fontFamily="Orbitron" fontSize={86} fontWeight={900}
          fill={innerColor} opacity={innerActive ? 1 : 0.55}>
          {innerGlyph}
        </text>
        <text x={cx} y={cy + 54} textAnchor="middle"
          fontFamily="Orbitron" fontSize={36} fontWeight={700}
          fill={innerColor} opacity={innerActive ? 1 : 0.55}
          letterSpacing="0.20em">
          {innerLabel}
        </text>
        {innerSub && (
          <text x={cx} y={cy + 90} textAnchor="middle"
            fontFamily="JetBrains Mono" fontSize={16}
            fill="rgba(143,168,184,0.7)" letterSpacing="0.18em">
            {innerSub}
          </text>
        )}
      </g>

      {/* ── Outer MARK labels at 4 cardinal positions ── */}
      {[
        { rot: 0,   dx: 0,        dy: -midR },
        { rot: 90,  dx: midR,     dy: 0 },
        { rot: 180, dx: 0,        dy: midR },
        { rot: 270, dx: -midR,    dy: 0 },
      ].map((p, i) => (
        <g key={i} transform={`translate(${cx + p.dx}, ${cy + p.dy}) rotate(${p.rot})`}
           style={{filter: `drop-shadow(0 0 4px ${outerColor})`}}>
          <text x={0} y={-6} textAnchor="middle" dominantBaseline="central"
            fontFamily="Orbitron" fontSize={30} fontWeight={900}
            fill={outerColor} opacity={outerActive ? 1 : 0.55}
            letterSpacing="0.20em">
            {outerGlyph} {outerLabel}
          </text>
        </g>
      ))}
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

function CountdownFloor({ cx, cy, palette, value }) {
  const color = value === 3 ? palette.accent : value === 2 ? palette.warn : palette.danger;
  return (
    <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={SCAN_INNER_R + 28} fill="#04060A" opacity={0.97}/>
      <circle cx={cx} cy={cy} r={SCAN_INNER_R} fill={color} fillOpacity={0.14}
        stroke={color} strokeWidth={4} style={{filter:`drop-shadow(0 0 18px ${color})`}}/>
      <text x={cx} y={cy - 18} textAnchor="middle" dominantBaseline="central"
        fontFamily="Orbitron" fontSize={146} fontWeight={900} fill={color}>{value}</text>
      <text x={cx} y={cy + 108} textAnchor="middle" fontFamily="Orbitron"
        fontSize={28} fontWeight={700} fill={color} letterSpacing="0.16em">GET READY</text>
    </g>
  );
}

function PausedControls({ face, palette }) {
  const cx = face.w / 2;
  const cy = face.h / 2;
  return (
    <g>
      {/* PAUSED banner 在 donut 上方 */}
      <g transform={`translate(${cx}, ${cy - MARK_OUTER_R - 60})`}>
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

      {/* 同 donut 結構:內圈 RESUME / 外環 ABORT;兩邊都亮表示「二選一」 */}
      <FloorDonut cx={cx} cy={cy} innerR={SCAN_INNER_R} outerR={MARK_OUTER_R}
        innerColor={palette.accent} innerGlyph="▶" innerLabel="RESUME" innerSub="繼續遊戲"
        outerColor={palette.danger} outerGlyph="◼" outerLabel="ABORT" outerSub="結束 · 回到待機"
        mode="both"/>
    </g>
  );
}

// TerminalButton 已由 FloorDonut 取代

// CenterButton — 跟 donut 統一視覺風格,在 idle / gameOver 顯示成一個圓圈
// (跟 playing 的 inner SCAN 圓同位置同半徑,讓動作位置在所有 phase 都一致)
function CenterButton({ kind, cx, cy, r, palette, progress=null }) {
  const isPlay = kind === "play" || kind === "playReady";
  const isContinue = kind === "continue";
  const accent = (isPlay || isContinue) ? (isContinue ? palette.primary : palette.accent) : palette.danger;
  const glyph = isContinue ? "›" : isPlay ? "▶" : (kind === "endGame" ? "⏏" : "↻");
  const label = isContinue ? "CONTINUE"
              : isPlay ? "PLAY"
              : kind === "endGame" ? "RETURN.STANDBY"
              : "EXECUTE.RESET";
  const sub   = isContinue ? `STEP ${progress}`
              : kind === "playReady" ? "開始正式遊戲"
              : kind === "play" ? "踩入觀看教學"
              : kind === "endGame" ? "結束 · 回到待機"
              : "踩入以重啟";
  return (
    <g>
      {/* 外圈呼吸 ring */}
      <circle cx={cx} cy={cy} r={r * 1.32} fill="none"
        stroke={accent} strokeWidth={1.5} opacity={0.18} strokeDasharray="22 14"
        className="pulse-slow"/>
      <circle cx={cx} cy={cy} r={r * 1.55} fill="none"
        stroke={accent} strokeWidth={1} opacity={0.08} strokeDasharray="6 12"/>

      {/* 主圓 — 不透明深色底擋住下層 + 帶色填充 */}
      <circle cx={cx} cy={cy} r={r + 28} fill="#04060A" opacity={0.95}/>
      <circle cx={cx} cy={cy} r={r}
        fill={accent} fillOpacity={0.22}
        stroke={accent} strokeWidth={4}
        className="pulse-slow"
        style={{filter: `drop-shadow(0 0 18px ${accent})`}}/>

      {/* 內部 sub-grid 紋理 */}
      <g opacity={0.18} stroke={accent} strokeWidth={1}>
        <line x1={cx - r * 0.7} y1={cy - r / 3} x2={cx + r * 0.7} y2={cy - r / 3}/>
        <line x1={cx - r * 0.7} y1={cy + r / 3} x2={cx + r * 0.7} y2={cy + r / 3}/>
        <line x1={cx - r / 3} y1={cy - r * 0.7} x2={cx - r / 3} y2={cy + r * 0.7}/>
        <line x1={cx + r / 3} y1={cy - r * 0.7} x2={cx + r / 3} y2={cy + r * 0.7}/>
      </g>

      <text x={cx} y={cy - 14} textAnchor="middle" dominantBaseline="central"
        fontFamily="Orbitron" fontWeight={900} fontSize={r * 0.55}
        fill={accent}
        style={{filter: `drop-shadow(0 0 8px ${accent})`}}>
        {glyph}
      </text>
      <text x={cx} y={cy + r * 0.42} textAnchor="middle"
        fontFamily="JetBrains Mono" fontWeight={500} fontSize={18}
        fill={accent} letterSpacing="0.2em">
        {label}
      </text>
      <text x={cx} y={cy + r * 0.42 + 22} textAnchor="middle"
        fontFamily="JetBrains Mono" fontSize={13}
        fill="rgba(143,168,184,0.7)" letterSpacing="0.15em">
        {sub}
      </text>
    </g>
  );
}

Object.assign(window, { FaceHUD, FloorTerminal, PausedControls });
