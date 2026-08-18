// ── Four-step synchronized wall tutorial ──────────────────
// The four physical directions receive the same lesson. Wall Right little is
// deliberately excluded: it is a secondary strip, not one of the four main walls.
const TUTORIAL_MAIN_FACES = new Set([
  "Wall Top", "Wall Left", "Wall Button", "Wall Right Big",
]);

function TutorialWallOverlay({ state, faces, palette }) {
  const tutorial = state?.phase === 'tutorial';
  const ready = state?.phase === 'tutorialReady';
  const countdown = state?.phase === 'countdown';
  if (!tutorial && !ready && !countdown) return null;
  const step = Math.max(0, Math.min(3, state.tutorialStep ?? 0));
  const boardFaces = faces.filter(f => f.isBoard);
  return (
    <g pointerEvents="none">
      {boardFaces.map(face => TUTORIAL_MAIN_FACES.has(face.name) ? (
        <TutorialOnFace key={face.name} face={face} step={step} ready={ready}
          countdownValue={countdown ? state.countdownValue : null} palette={palette}/>
      ) : (
        <TutorialAmbientFace key={face.name} face={face} palette={palette}/>
      ))}
    </g>
  );
}

function TutorialOnFace({ face, step, ready, countdownValue, palette }) {
  const rot = faceContentRotation(face.reservedSide);
  const contentW = (rot === 0 || rot === 180) ? face.width : face.height;
  const contentH = (rot === 0 || rot === 180) ? face.height : face.width;
  const scale = Math.min(contentW / 1408, contentH / 640);
  const cx = face.originX + face.width / 2;
  const cy = face.originY + face.height / 2;
  const offsetX = (contentW - 1408 * scale) / 2;
  const offsetY = (contentH - 640 * scale) / 2;
  return (
    <g className="tutorial-wall-stage" data-step={countdownValue != null ? `countdown-${countdownValue}` : ready ? 'ready' : step}
       data-face={face.name}>
      {/* Full-face opaque backdrop. This is outside canonical scaling so even
          letterbox bands are tutorial art, never the real game. */}
      <TutorialFaceBackdrop face={face} palette={palette}/>
      <g transform={`translate(${cx},${cy}) rotate(${rot}) translate(${-contentW/2},${-contentH/2}) translate(${offsetX},${offsetY}) scale(${scale})`}>
        <rect x={0} y={0} width={1408} height={640} fill="#04060A"/>
        <rect x={12} y={12} width={1384} height={616} rx={18}
          fill="#070D16" stroke={ready ? palette.accent : palette.primary} strokeWidth={2}/>
        {countdownValue != null ? <CountdownPage value={countdownValue} palette={palette}/>
          : ready ? <TutorialReadyPage palette={palette}/> : <>
          <TutorialHeader step={step} palette={palette}/>
          {step === 0 && <TutorialModes palette={palette}/>}
          {step === 1 && <TutorialGrid palette={palette}/>}
          {step === 2 && <TutorialHud palette={palette}/>}
          {step === 3 && <TutorialButtons palette={palette}/>}
        </>}
      </g>
    </g>
  );
}

function TutorialFaceBackdrop({ face, palette }) {
  const clipId = `tutorial-clip-${face.id}`;
  const gridId = `tutorial-grid-${face.id}`;
  const glowId = `tutorial-glow-${face.id}`;
  return (
    <g>
      <defs>
        <clipPath id={clipId}><rect x={face.originX} y={face.originY} width={face.width} height={face.height}/></clipPath>
        <pattern id={gridId} width="96" height="96" patternUnits="userSpaceOnUse">
          <path d="M96 0H0V96" fill="none" stroke={palette.primary} strokeWidth="1" opacity="0.10"/>
          <circle cx="4" cy="4" r="1.5" fill={palette.primary} opacity="0.18"/>
        </pattern>
        <radialGradient id={glowId} cx="50%" cy="50%" r="68%">
          <stop offset="0%" stopColor={palette.primary} stopOpacity="0.12"/>
          <stop offset="58%" stopColor="#07101A" stopOpacity="0.96"/>
          <stop offset="100%" stopColor="#02040A" stopOpacity="1"/>
        </radialGradient>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect x={face.originX} y={face.originY} width={face.width} height={face.height} fill="#02040A"/>
        <rect x={face.originX} y={face.originY} width={face.width} height={face.height} fill={`url(#${glowId})`}/>
        <rect x={face.originX} y={face.originY} width={face.width} height={face.height} fill={`url(#${gridId})`}/>
        <line x1={face.originX} y1={face.originY + face.height*0.14}
          x2={face.originX + face.width} y2={face.originY + face.height*0.14}
          stroke={palette.primary} strokeWidth="2" opacity="0.18"/>
      </g>
    </g>
  );
}

function TutorialAmbientFace({ face }) {
  // East secondary is too short to hold the canonical tutorial composition.
  // Leave it intentionally blank instead of squeezing an ambient title into it.
  return (
    <g className="tutorial-ambient-stage tutorial-ambient-blank" data-face={face.name}>
      <rect x={face.originX} y={face.originY} width={face.width} height={face.height}
        fill="#000000"/>
    </g>
  );
}

function CountdownPage({ value, palette }) {
  const color = value === 3 ? palette.accent : value === 2 ? palette.warn : palette.danger;
  return (
    <g className="countdown-wall-page" data-countdown={value}>
      <style>{`
        .countdown-pulse { animation: countdownPulse .92s cubic-bezier(.2,.8,.2,1) both; transform-origin:704px 315px; }
        @keyframes countdownPulse { 0%{opacity:0;transform:scale(.55)} 22%{opacity:1;transform:scale(1.08)} 100%{opacity:1;transform:scale(1)} }
      `}</style>
      <text x={704} y={148} textAnchor="middle" fontFamily="JetBrains Mono"
        fontSize={22} fontWeight={700} fill={palette.primary} letterSpacing="0.24em">GAME STARTING</text>
      <g key={value} className="countdown-pulse">
        <text x={704} y={390} textAnchor="middle" dominantBaseline="central"
          fontFamily="Orbitron" fontSize={310} fontWeight={900} fill={color}
          style={{filter:`drop-shadow(0 0 28px ${color})`}}>{value}</text>
      </g>
      <text x={704} y={552} textAnchor="middle" fontFamily="Microsoft JhengHei"
        fontSize={27} fontWeight={700} fill="#DFF5FA">準備開始</text>
    </g>
  );
}

function TutorialReadyPage({ palette }) {
  return (
    <g className="tutorial-ready-page tutorial-ready-text-only">
      {/* Text only — no circle, triangle or button-like shape on the wall. The
          only actionable PLAY control is physically on the floor. */}
      <text x={704} y={252} textAnchor="middle" fontFamily="Orbitron" fontSize={76}
        fontWeight={900} fill={palette.accent} letterSpacing="0.18em"
        style={{filter:`drop-shadow(0 0 14px ${palette.accent})`}}>READY</text>
      <line x1={450} y1={292} x2={958} y2={292} stroke={palette.accent}
        strokeWidth={2} opacity={0.55}/>
      <text x={704} y={360} textAnchor="middle" fontFamily="Microsoft JhengHei"
        fontSize={38} fontWeight={700} fill="#DFF5FA">教學完成</text>
      <text x={704} y={438} textAnchor="middle" fontFamily="Microsoft JhengHei"
        fontSize={34} fontWeight={700} fill="#DFF5FA">如果準備好了，按下 PLAY 開始遊戲</text>
      <text x={704} y={500} textAnchor="middle" fontFamily="JetBrains Mono"
        fontSize={20} fill={palette.primary} letterSpacing="0.22em">PLAY IS ON THE FLOOR CENTER</text>
    </g>
  );
}

const TUTORIAL_TITLES = [
  ['DUAL MODE', '雙模式操作'],
  ['GRID LOGIC', '格子與數字'],
  ['STATUS HUD', '時間與威脅'],
  ['SESSION CONTROL', '暫停與其他按鈕'],
];

function TutorialHeader({ step, palette }) {
  const [en, zh] = TUTORIAL_TITLES[step];
  return (
    <g>
      <text x={52} y={60} fontFamily="JetBrains Mono" fontSize={20}
        fill={palette.primary} letterSpacing="0.18em">{`// TUTORIAL ${step + 1} / 4`}</text>
      <text x={52} y={112} fontFamily="Orbitron" fontSize={44} fontWeight={900}
        fill="#DFF5FA" letterSpacing="0.10em">{en}</text>
      <text x={1350} y={106} textAnchor="end" fontFamily="Microsoft JhengHei" fontSize={28}
        fontWeight={700} fill={palette.primary}>{zh}</text>
      <line x1={52} y1={132} x2={1356} y2={132} stroke={palette.primary} strokeWidth={2} opacity={0.45}/>
    </g>
  );
}

const MODE_CARD_W = 550;
const MODE_CARD_H = 466;
const MODE_CARD_Y = 146;
const MODE_CELL = 62;
const MODE_GRID_X = (MODE_CARD_W - MODE_CELL * 3) / 2;  // 182
const MODE_GRID_Y = 180;                                 // grid spans 180..366

function TutorialCard({ x, y, w, h, color, glyph, title, zh, children }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height={h} rx={18} fill="rgba(8,14,22,0.94)"
        stroke={color} strokeWidth={3} style={{filter: `drop-shadow(0 0 12px ${color})`}}/>
      <text x={w/2} y={52} textAnchor="middle" fontFamily="Orbitron"
        fontSize={42} fontWeight={900} fill={color}>{glyph}</text>
      <text x={w/2} y={108} textAnchor="middle" fontFamily="Orbitron"
        fontSize={36} fontWeight={900} fill={color} letterSpacing="0.16em">{title}</text>
      <text x={w/2} y={149} textAnchor="middle" fontFamily="Microsoft JhengHei"
        fontSize={22} fontWeight={700} fill="#DFF5FA">{zh}</text>
      <line x1={w*0.18} y1={166} x2={w*0.82} y2={166}
        stroke={color} strokeWidth={1.5} opacity={0.4}/>
      {children}
    </g>
  );
}

function TutorialModeGrid({ mode, palette }) {
  const scan = mode === 'scan';
  const color = scan ? palette.accent : palette.secondary;
  const cell = MODE_CELL;
  return (
    <g className={`tutorial-mode-grid tutorial-mode-grid-${mode}`}
      transform={`translate(${MODE_GRID_X},${MODE_GRID_Y})`}>
      {Array.from({ length: 9 }, (_, i) => {
        const c = i % 3, r = Math.floor(i / 3), center = i === 4;
        return (
          <g key={i} transform={`translate(${c*cell},${r*cell})`}>
            <rect x={2} y={2} width={cell-4} height={cell-4} rx={6}
              fill="#07141E" stroke={color} strokeWidth={center ? 2.5 : 1.3}
              opacity={center ? 1 : 0.55}/>
            {center && <rect className={`tutorial-mode-target tutorial-mode-target-${mode}`}
              x={1} y={1} width={cell-2} height={cell-2} rx={6}
              fill={color} fillOpacity={0.10} stroke={color} strokeWidth={3}/>}
            {center && scan && <text className="tutorial-mode-reveal-number"
              x={cell/2} y={cell/2+12} textAnchor="middle" fontFamily="Orbitron"
              fontSize={38} fontWeight={900} fill={color}>2</text>}
            {center && !scan && <g className="tutorial-mode-flag">
              <line x1={cell*.42} y1={cell*.22} x2={cell*.42} y2={cell*.75}
                stroke={color} strokeWidth={3}/>
              <polygon points={`${cell*.43},${cell*.24} ${cell*.78},${cell*.36} ${cell*.43},${cell*.49}`}
                fill={color}/>
            </g>}
          </g>
        );
      })}
    </g>
  );
}

function TutorialModes({ palette }) {
  return (
    <g>
      <style>{`
        .tutorial-mode-scan { animation: tutModeScan 6.4s ease-in-out infinite; transform-origin: 385px 379px; }
        .tutorial-mode-mark { animation: tutModeMark 6.4s ease-in-out infinite; transform-origin: 1023px 379px; }
        .tutorial-mode-grid-scan { animation: tutScanGrid 6.4s ease-in-out infinite; }
        .tutorial-mode-grid-mark { animation: tutMarkGrid 6.4s ease-in-out infinite; }
        .tutorial-mode-target-scan { animation: tutScanTarget 6.4s ease-in-out infinite; }
        .tutorial-mode-reveal-number { animation: tutScanReveal 6.4s ease-in-out infinite; }
        .tutorial-mode-target-mark { animation: tutMarkTarget 6.4s ease-in-out infinite; }
        .tutorial-mode-flag { animation: tutMarkFlag 6.4s ease-in-out infinite; transform-origin: 31px 31px; }
        @keyframes tutModeScan {
          0%,42% { opacity:1; transform:scale(1); }
          50%,92% { opacity:.38; transform:scale(.97); }
          100% { opacity:1; transform:scale(1); }
        }
        @keyframes tutModeMark {
          0%,42% { opacity:.38; transform:scale(.97); }
          50%,92% { opacity:1; transform:scale(1); }
          100% { opacity:.38; transform:scale(.97); }
        }
        @keyframes tutScanGrid {
          0%,45% { opacity:1; }
          50%,100% { opacity:.32; }
        }
        @keyframes tutMarkGrid {
          0%,45% { opacity:.32; }
          50%,100% { opacity:1; }
        }
        @keyframes tutScanTarget {
          0%,6% { opacity:.18; }
          14%,45% { opacity:1; }
          50%,100% { opacity:.18; }
        }
        @keyframes tutScanReveal {
          0%,14% { opacity:0; transform:scale(.65); }
          23%,45% { opacity:1; transform:scale(1); }
          50%,100% { opacity:0; transform:scale(.65); }
        }
        @keyframes tutMarkTarget {
          0%,52% { opacity:.18; }
          60%,94% { opacity:1; }
          100% { opacity:.18; }
        }
        @keyframes tutMarkFlag {
          0%,58% { opacity:0; transform:scale(.55); }
          66%,84% { opacity:1; transform:scale(1); }
          92%,100% { opacity:0; transform:scale(.55); }
        }
      `}</style>
      <g className="tutorial-mode-scan">
        <TutorialCard x={110} y={MODE_CARD_Y} w={MODE_CARD_W} h={MODE_CARD_H}
          color={palette.accent} glyph="◎" title="SCAN" zh="揭露格子">
          <TutorialModeGrid mode="scan" palette={palette}/>
          <text x={MODE_CARD_W/2} y={404} textAnchor="middle" fontFamily="Microsoft JhengHei"
            fontSize={22} fill="rgba(223,245,250,0.82)">摸中央格 → 揭露數字</text>
          <text x={MODE_CARD_W/2} y={436} textAnchor="middle" fontFamily="JetBrains Mono"
            fontSize={17} fill={palette.accent}>CENTER CELL REVEAL</text>
        </TutorialCard>
      </g>
      <g className="tutorial-mode-mark">
        <TutorialCard x={748} y={MODE_CARD_Y} w={MODE_CARD_W} h={MODE_CARD_H}
          color={palette.secondary} glyph="⚑" title="MARK" zh="插旗／取消旗子">
          <TutorialModeGrid mode="mark" palette={palette}/>
          <text x={MODE_CARD_W/2} y={404} textAnchor="middle" fontFamily="Microsoft JhengHei"
            fontSize={22} fill="rgba(223,245,250,0.82)">摸中央格 → 插旗／再摸取消</text>
          <text x={MODE_CARD_W/2} y={436} textAnchor="middle" fontFamily="JetBrains Mono"
            fontSize={17} fill={palette.secondary}>TOGGLE CENTER FLAG</text>
        </TutorialCard>
      </g>
    </g>
  );
}

function TutorialGrid({ palette }) {
  const cell = 100, gx = 165, gy = 190;
  const cells = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const center = r === 1 && c === 1;
    const mine = (r === 0 && c === 2) || (r === 2 && c === 0);
    cells.push(
      <g key={`${c}-${r}`} transform={`translate(${gx + c*cell},${gy + r*cell})`}>
        <rect x={4} y={4} width={92} height={92} rx={9}
          fill="rgba(8,20,28,0.92)" stroke={palette.primary} strokeWidth={2} opacity={0.78}/>
        {center && <rect className="tutorial-center-scan" x={3} y={3} width={94} height={94} rx={9}
          fill={palette.accent} fillOpacity={0.13} stroke={palette.accent} strokeWidth={5}
          style={{filter:`drop-shadow(0 0 12px ${palette.accent})`}}/>}
        {center && <text className="tutorial-center-number" x={50} y={58} textAnchor="middle"
          fontFamily="Orbitron" fontSize={52} fontWeight={900} fill={palette.accent}>2</text>}
        {mine && <g className="tutorial-nearby-mine">
          <circle cx={50} cy={50} r={22} fill="none" stroke={palette.danger} strokeWidth={4}/>
          <circle cx={50} cy={50} r={9} fill={palette.danger}/>
        </g>}
      </g>
    );
  }
  return (
    <g>
      <style>{`
        /* Slower 6-second lesson: lock center, keep 2 readable, then keep the two
           nearby mines visible long enough for players on every wall to connect them. */
        .tutorial-center-number { animation: tutNumber 6s ease-in-out infinite; }
        .tutorial-center-scan { animation: tutScan 6s ease-in-out infinite; }
        .tutorial-nearby-mine { animation: tutMine 6s ease-in-out infinite; }
        @keyframes tutNumber {
          0%,20% { opacity:0; }
          30%,90% { opacity:1; }
          100% { opacity:0; }
        }
        @keyframes tutScan {
          0%,10% { opacity:.15; }
          22%,62% { opacity:1; }
          90% { opacity:.55; }
          100% { opacity:.15; }
        }
        @keyframes tutMine {
          0%,48% { opacity:0; transform:scale(.78); }
          58%,90% { opacity:1; transform:scale(1); }
          100% { opacity:0; transform:scale(.78); }
        }
      `}</style>
      {cells}
      <g transform="translate(560,190)">
        <text x={0} y={48} fontFamily="Microsoft JhengHei" fontSize={34} fontWeight={700}
          fill={palette.accent}>揭露中央格</text>
        <text x={0} y={112} fontFamily="Microsoft JhengHei" fontSize={30} fontWeight={700}
          fill="#DFF5FA">數字 2 代表：</text>
        <text x={0} y={166} fontFamily="Microsoft JhengHei" fontSize={28}
          fill="rgba(223,245,250,0.82)">周圍 8 格中共有 2 顆地雷</text>
        <text x={0} y={246} fontFamily="JetBrains Mono" fontSize={22}
          fill={palette.danger} letterSpacing="0.12em">CHECK ALL 8 DIRECTIONS</text>
      </g>
    </g>
  );
}

// Same typography constants as HUDContent: labels use JetBrains Mono; values use
// Orbitron 700 and the exact primary/danger colors and glow treatment.
function TutorialHud({ palette }) {
  return (
    <g>
      <g transform="translate(100,180)">
        <rect width={560} height={330} rx={18} fill="rgba(8,14,22,0.94)" stroke={palette.primary} strokeWidth={3}/>
        <text x={280} y={82} textAnchor="middle" fontFamily="JetBrains Mono" fontSize={20}
          fill="rgba(143,168,184,0.7)" letterSpacing="0.25em">T.UPTIME</text>
        <text x={280} y={190} textAnchor="middle" fontFamily="Orbitron" fontWeight={700}
          fontSize={92} fill={palette.primary} letterSpacing="0.05em"
          style={{filter:`drop-shadow(0 0 10px ${palette.primary})`}}>01:24</text>
        <text x={280} y={270} textAnchor="middle" fontFamily="Microsoft JhengHei" fontSize={26}
          fill="#DFF5FA">本局已進行時間</text>
      </g>
      <g transform="translate(748,180)">
        <rect width={560} height={330} rx={18} fill="rgba(8,14,22,0.94)" stroke={palette.danger} strokeWidth={3}/>
        <text x={280} y={82} textAnchor="middle" fontFamily="JetBrains Mono" fontSize={20}
          fill="rgba(143,168,184,0.7)" letterSpacing="0.25em">THREAT</text>
        <text x={280} y={190} textAnchor="middle" fontFamily="Orbitron" fontWeight={700}
          fontSize={92} fill={palette.danger} letterSpacing="0.05em"
          style={{filter:`drop-shadow(0 0 10px ${palette.danger})`}}>120</text>
        <text x={280} y={258} textAnchor="middle" fontFamily="Microsoft JhengHei" fontSize={24}
          fill="#DFF5FA">預估剩餘地雷</text>
        <text x={280} y={294} textAnchor="middle" fontFamily="Microsoft JhengHei" fontSize={20}
          fill="rgba(223,245,250,0.68)">地雷總數 − 旗子數</text>
      </g>
    </g>
  );
}

function TutorialButtons({ palette }) {
  const buttons = [
    { x: 78, color: palette.warn, glyph: 'Ⅱ', title: 'PAUSE', zh: '暫停遊戲與計時' },
    { x: 408, color: palette.accent, glyph: '▶', title: 'RESUME', zh: '踩內圈繼續' },
    { x: 738, color: palette.danger, glyph: '■', title: 'ABORT', zh: '踩外環放棄本局' },
    { x: 1068, color: palette.primary, glyph: '⏏', title: 'STANDBY', zh: '結束後回到待機' },
  ];
  return (
    <g>
      {buttons.map(b => (
        <g key={b.title} transform={`translate(${b.x},185)`}>
          <rect width={262} height={330} rx={16} fill="rgba(8,14,22,0.94)"
            stroke={b.color} strokeWidth={3}/>
          <text x={131} y={108} textAnchor="middle" fontFamily="Orbitron"
            fontSize={70} fontWeight={900} fill={b.color}
            style={{filter:`drop-shadow(0 0 10px ${b.color})`}}>{b.glyph}</text>
          <text x={131} y={186} textAnchor="middle" fontFamily="Orbitron"
            fontSize={26} fontWeight={900} fill={b.color}>{b.title}</text>
          <text x={131} y={250} textAnchor="middle" fontFamily="Microsoft JhengHei"
            fontSize={22} fontWeight={700} fill="#DFF5FA">{b.zh}</text>
        </g>
      ))}
    </g>
  );
}

Object.assign(window, { TutorialWallOverlay });
