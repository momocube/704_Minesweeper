// ── Live playable cyberpunk view ─────────────────────────
// Connects to server WS, renders real game state, sends touches.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

const SENSOR_PER_CELL_X = 2;
const SENSOR_PER_CELL_Y = 4;
const RED_WAVE_DURATION_MS = 1800;
const RESTART_DELAY_AFTER_WAVE_MS = 400;

// 投播模式:控制台跟投影視窗用同一個 view,投播時隱藏 UI / disable click / 隱藏 cursor
const PROJECTOR_MODE = new URLSearchParams(location.search).get('projector') === '1';

// 跨 BrowserWindow 同步 tweaks(palette / cellStyle / scanlines / vignette)
// 控制台改 → 投播即時跟著變(同 origin,Electron BroadcastChannel 跨 BrowserWindow 可用)
const twChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('cyber-tw') : null;

// 每面 cell 內容旋轉(站在房間看時數字正向)
function faceContentRotation(reserved) {
  switch (reserved) {
    case 'top':    return 0;
    case 'bottom': return 180;
    case 'left':   return -90;
    case 'right':  return 90;
    default:       return 0;
  }
}

// ── WebSocket state client ───────────────────────────────
function useGameState() {
  const [state, setState] = useState(null);
  const [lockState, setLockState] = useState(null);
  const [conn, setConn] = useState(false);
  const wsRef = useRef(null);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = null;

    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(`ws://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => setConn(true);
      ws.onclose = () => {
        setConn(false);
        if (!stopped) timer = setTimeout(connect, 1500);
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'snapshot') {
          setState(msg);
        } else if (msg.type === 'game-start' || msg.type === 'game-over' || msg.type === 'reset' ||
                   msg.type === 'pause' || msg.type === 'resume') {
          setState(msg.snapshot);
        } else if (msg.type === 'lock') {
          setState(s => s ? { ...s, lockedCellId: msg.cellId } : s);
        } else if (msg.type === 'unlock') {
          setState(s => s ? { ...s, lockedCellId: null } : s);
        } else if (msg.type === 'cell-update') {
          setState(s => {
            if (!s) return s;
            const cells = s.cells.slice();
            for (const c of msg.cells) cells[c.id] = c;
            return {
              ...s, cells,
              flaggedCount: msg.flaggedCount ?? s.flaggedCount,
              revealedCount: msg.revealedCount ?? s.revealedCount,
            };
          });
        } else if (msg.type === 'lock-snapshot') {
          setLockState({
            lockedCells: msg.lockedCells || [],
            lockMode: !!msg.lockMode,
            filteredCount: msg.filteredCount || 0,
            hotCounts: msg.hotCounts || {},
          });
        } else if (msg.type === 'lock-update') {
          const s = msg.snapshot || {};
          setLockState({
            lockedCells: s.lockedCells || [],
            lockMode: !!s.lockMode,
            filteredCount: s.filteredCount || 0,
            hotCounts: s.hotCounts || {},
          });
        } else if (msg.type === 'lock-stats') {
          setLockState(p => p ? { ...p, filteredCount: msg.filteredCount || 0 } : p);
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try { wsRef.current?.close(); } catch {}
    };
  }, []);

  return { state, lockState, send, conn };
}

// ── live timer tick ─────────────────────────────────────
function useTimerTick(active) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => force(n => n + 1), 250);
    return () => clearInterval(t);
  }, [active]);
}

// ── showRestart flag: true 時 FloorTerminal 改顯示 CenterButton(start/restart) ────
function useShowRestart(state) {
  const [showRestart, setShowRestart] = useState(false);
  useEffect(() => {
    if (!state) { setShowRestart(false); return; }
    if (state.phase === 'idle') { setShowRestart(true); return; }
    if (state.phase === 'playing') { setShowRestart(false); return; }
    if (state.phase === 'gameOver') {
      if (state.won) { setShowRestart(true); return; }
      setShowRestart(false);
      const t = setTimeout(() => setShowRestart(true),
        RED_WAVE_DURATION_MS + RESTART_DELAY_AFTER_WAVE_MS);
      return () => clearTimeout(t);
    }
  }, [state?.phase, state?.gameEndMs, state?.won]);
  return showRestart;
}

// ── Main App ─────────────────────────────────────────────
function App() {
  const { state, lockState, send, conn } = useGameState();
  const [tw, setTw] = useState(() => {
    const saved = localStorage.getItem('cyber-tw');
    return saved ? { ...TWEAK_DEFAULTS, ...JSON.parse(saved) } : TWEAK_DEFAULTS;
  });
  const svgRef = useRef(null);

  useTimerTick(state?.phase === 'playing');
  const showRestart = useShowRestart(state);

  const setTwk = useCallback((key, value) => {
    setTw(p => {
      const next = { ...p, [key]: value };
      localStorage.setItem('cyber-tw', JSON.stringify(next));
      // 同步通知其他 window(投播視窗)— BroadcastChannel 比 storage event 可靠
      // (storage event 在某些 Electron 版本不會跨 BrowserWindow 觸發)
      try { twChannel?.postMessage(next); } catch {}
      return next;
    });
  }, []);

  // 接收其他 window 的 tweaks 變更(控制台改 palette → 投播即時跟著變)
  useEffect(() => {
    if (!twChannel) return;
    const onMsg = (e) => {
      if (e.data && typeof e.data === 'object') {
        setTw({ ...TWEAK_DEFAULTS, ...e.data });
      }
    };
    twChannel.addEventListener('message', onMsg);
    // storage event 作為 fallback(同 origin 同分區的另一個 BrowserWindow 有時會收到)
    const onStorage = (e) => {
      if (e.key === 'cyber-tw' && e.newValue) {
        try { setTw({ ...TWEAK_DEFAULTS, ...JSON.parse(e.newValue) }); } catch {}
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      twChannel.removeEventListener('message', onMsg);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const palette = PALETTES[tw.palette] || PALETTES["cyan-magenta"];

  // adapt server faces or fall back to mock
  const faces = useMemo(() => {
    if (state?.faces) return state.faces.map(adaptFace);
    return MOCK_FACES;
  }, [state?.faces]);

  // group cells by face name
  const cellsByFace = useMemo(() => {
    if (!state?.cells) return {};
    const m = {};
    for (const cell of state.cells) {
      (m[cell.faceName] ??= []).push(cell);
    }
    return m;
  }, [state?.cells]);

  const lockedCell = (state?.lockedCellId != null) ? state.cells[state.lockedCellId] : null;

  // cyber view state for FloorTerminal / RedWave overlay
  const cyberState = !state ? 'idle'
    : state.phase === 'idle' ? 'idle'
    : state.phase === 'playing' ? 'playing'
    : state.phase === 'paused' ? 'paused'
    : state.phase === 'gameOver' ? (showRestart ? 'gameover-final' : 'gameover-wave')
    : 'playing';

  // elapsed timer — plain expression so every re-render (driven by useTimerTick) re-reads Date.now()
  // 凍結優先序:gameEndMs (gameOver) > pausedAt (paused) > Date.now() (playing)
  const elapsedMs = (!state || state.gameStartMs == null) ? 0
    : (state.gameEndMs ?? state.pausedAt ?? Date.now()) - state.gameStartMs;

  // Lock-mode handlers (operator UI on top of the normal game canvas)
  const lockMode = !!lockState?.lockMode;
  const toggleLockMode = useCallback(() => {
    send({ type: 'lock-mode-set', on: !lockMode });
  }, [send, lockMode]);
  const onToggleCell = useCallback((face, col, row) => {
    send({ type: 'lock-toggle-cell', face, sensorCol: col, sensorRow: row });
  }, [send]);
  const onClearLocked = useCallback(() => { send({ type: 'lock-clear' }); }, [send]);

  // click handlers
  const handleCellClick = useCallback((face, c, r, e) => {
    if (PROJECTOR_MODE) return;
    if (lockMode) return; // lock overlay owns clicks while calibrating
    e.stopPropagation();
    const sensorCol = c * SENSOR_PER_CELL_X + 1;
    const sensorRow = r * SENSOR_PER_CELL_Y + 2;
    send({ type: 'inject-touch', face: face.name, sensorCol, sensorRow });
  }, [send, lockMode]);

  const handleSVGClick = useCallback((ev) => {
    if (PROJECTOR_MODE) return;
    if (lockMode) return; // lock overlay handles all clicks via its own catchers
    if (!state || !svgRef.current) return;
    const pt = svgRef.current.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const local = pt.matrixTransform(svgRef.current.getScreenCTM().inverse());
    const face = state.faces.find(f =>
      local.x >= f.originX && local.x < f.originX + f.width &&
      local.y >= f.originY && local.y < f.originY + f.height);
    if (!face) return;
    if (face.name === 'Entrance') return;
    if (face.isBoard) return; // handled by cell <g> onClick
    // Floor click
    const relX = local.x - face.originX;
    const relY = local.y - face.originY;
    const sensorCol = Math.floor(relX / face.cellPxW);
    const sensorRow = Math.floor(relY / face.cellPxH);
    send({ type: 'inject-touch', face: face.name, sensorCol, sensorRow });
  }, [state, send]);

  // ── Not yet connected: connecting screen ───────────
  if (!state) {
    return <ConnectingScreen palette={palette} tw={tw} conn={conn} setTwk={setTwk}/>;
  }

  const totalSafe = state.cells.length - state.mineCount;
  const flaggedCount = state.flaggedCount ?? 0;
  const revealedCount = state.revealedCount ?? 0;

  return (
    <div className={`stage ${tw.scanlines ? 'scan' : ''}`}>
      {tw.vignette && <div className="vignette"/>}

      <svg ref={svgRef} className="venue"
           viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
           preserveAspectRatio={PROJECTOR_MODE ? "none" : "xMidYMid meet"}
           onClick={handleSVGClick}>
        {!PROJECTOR_MODE && <VenueBadge palette={palette} state={cyberState}/>}
        {!PROJECTOR_MODE && <TopRightStatusLive palette={palette} state={state} conn={conn}/>}
        <FaceConnectors palette={palette}/>

        {faces.map(face => (
          <g key={face.name} transform={`translate(${face.originX},${face.originY})`}>
            <FaceFrame face={face} palette={palette}/>

            {face.isFloor && (
              <>
                <FloorGrid face={face} palette={palette}/>
                <FloorTerminal face={face} palette={palette}
                  state={cyberState}
                  lockedCellId={state.lockedCellId}
                  lockedFaceName={lockedCell?.faceName}
                  lockedCol={lockedCell?.col}
                  lockedRow={lockedCell?.row}/>
              </>
            )}

            {face.isBoard && (
              <>
                {(cellsByFace[face.name] || []).map(cell => {
                  const rot = faceContentRotation(face.reservedSide);
                  const cellProps = {
                    state: (cell.revealed && cell.mine) ? 'mine'
                         : cell.revealed ? 'revealed'
                         : cell.flagged ? 'flagged'
                         : (state.phase === 'gameOver' && cell.mine) ? 'mine'
                         : 'hidden',
                    adjacent: cell.adjacent ?? 0,
                    mine: cell.mine,
                    locked: cell.id === state.lockedCellId,
                  };
                  return (
                    <g key={cell.id}
                       transform={`translate(${cell.col*CELL},${cell.row*CELL})`}
                       onClick={(e) => handleCellClick(face, cell.col, cell.row, e)}
                       style={{cursor: state.phase === 'playing' ? 'pointer' : 'default'}}>
                      <rect x={0} y={0} width={CELL} height={CELL} fill="transparent"/>
                      <g transform={`rotate(${rot}, ${CELL/2}, ${CELL/2})`}>
                        <Cell cell={cellProps} palette={palette} cellStyle={tw.cellStyle}/>
                      </g>
                    </g>
                  );
                })}
                <FaceHUD face={face} palette={palette}
                  state={cyberState}
                  elapsedMs={elapsedMs}
                  mineCount={state.mineCount}
                  flaggedCount={flaggedCount}
                  revealedCount={revealedCount}
                  totalSafe={totalSafe}/>
              </>
            )}
          </g>
        ))}

        {cyberState === 'paused' && (() => {
          const floor = faces.find(f => f.isFloor);
          return (
            <g pointerEvents="none">
              {/* 全場 mask:半透明深色蓋住所有牆面/cells/HUD */}
              <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H}
                fill="rgba(2,4,10,0.62)"/>
              {/* Floor 上方加一層深色背板,讓 RESUME/ABORT 視覺乾淨 */}
              {floor && (
                <g transform={`translate(${floor.originX},${floor.originY})`}>
                  <rect x={0} y={0} width={floor.w} height={floor.h}
                    fill="rgba(4,6,12,0.55)"/>
                  <PausedControls face={floor} palette={palette}/>
                </g>
              )}
            </g>
          );
        })()}

        {(cyberState === 'gameover-wave' || cyberState === 'gameover-final') &&
          <RedWaveOverlay palette={palette} state={state}/>}

        {/* Sensor lock calibration overlay — on top of everything inside the SVG */}
        {!PROJECTOR_MODE && <LockOverlay
          faces={state.faces} lockState={lockState}
          onToggleCell={onToggleCell}/>}
      </svg>

      {!PROJECTOR_MODE && <TweaksPanel tw={tw} setTwk={setTwk} conn={conn} state={state}/>}
      {!PROJECTOR_MODE && <BroadcastBtn/>}
      {!PROJECTOR_MODE && <LockPill lockState={lockState} onToggle={toggleLockMode}/>}
      {!PROJECTOR_MODE && <LockControlCard lockState={lockState}
        onClear={onClearLocked} onClose={toggleLockMode}/>}
    </div>
  );
}

// ── Broadcast button (Electron only) ─────────────────────
function BroadcastBtn() {
  const electron = (typeof window !== 'undefined' && window.electron704mine) || null;
  const [isOpen, setIsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [displays, setDisplays] = useState([]);
  const ref = useRef(null);

  useEffect(() => {
    if (!electron) return;
    let mounted = true;
    electron.isProjectorOpen().then(v => mounted && setIsOpen(!!v)).catch(() => {});
    const off = electron.onProjectorState((v) => mounted && setIsOpen(!!v));
    return () => { mounted = false; if (typeof off === 'function') off(); };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [menuOpen]);

  if (!electron) return null;

  const onMain = async (e) => {
    e.stopPropagation();
    if (isOpen) {
      try { await electron.closeProjector(); } catch {}
      return;
    }
    try {
      const list = await electron.listDisplays();
      setDisplays(list || []);
      setMenuOpen(true);
    } catch {}
  };

  const pick = async (action) => {
    setMenuOpen(false);
    try { await action(); } catch {}
  };

  return (
    <div className="broadcast-overlay" ref={ref}>
      <button className={`broadcast-btn ${isOpen ? 'on' : ''}`} onClick={onMain}>
        {isOpen ? 'STOP_BROADCAST' : 'BROADCAST'}
      </button>
      {menuOpen && (
        <div className="broadcast-menu">
          <button className="bmi" onClick={() => pick(() => electron.openProjector({ windowed: true }))}>
            <span>🪟 視窗模式</span><span className="meta">OBS · NDI</span>
          </button>
          {displays.length >= 2 && (
            <button className="bmi" onClick={() => pick(() => electron.openProjectorOnSecondary())}>
              <span>🖥 自動 → 第二螢幕</span><span className="meta">FULLSCREEN</span>
            </button>
          )}
          {displays.map(d => (
            <button key={d.id} className="bmi"
              onClick={() => pick(() => electron.openProjector({ displayId: d.id, windowed: false }))}>
              <span>{d.label}{d.isPrimary ? ' · 主螢幕' : ''}</span>
              <span className="meta">{d.bounds.width}×{d.bounds.height}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Connecting screen ────────────────────────────────────
function ConnectingScreen({ palette, tw, conn, setTwk }) {
  return (
    <div className={`stage ${tw.scanlines ? 'scan' : ''}`}>
      {tw.vignette && <div className="vignette"/>}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: palette.primary,
        fontFamily: 'JetBrains Mono', fontSize: 18,
        letterSpacing: '0.3em',
      }}>
        <div style={{textAlign: 'center'}}>
          <div style={{
            fontFamily: 'Orbitron', fontSize: 36, fontWeight: 700,
            color: palette.primary, marginBottom: 16,
            filter: `drop-shadow(0 0 8px ${palette.primary})`,
            letterSpacing: '0.2em',
          }}>704.MINESWEEPER</div>
          <div style={{opacity: 0.6, marginBottom: 8}}>
            {conn ? '// AWAITING_SNAPSHOT...' : '// CONNECTING_TO_SERVER...'}
          </div>
          <div style={{fontSize: 12, opacity: 0.4}}>
            ws://{location.host}/ws
          </div>
        </div>
      </div>
      <TweaksPanel tw={tw} setTwk={setTwk} conn={conn} state={null}/>
    </div>
  );
}

// ── Top-right status (live) ──────────────────────────────
function TopRightStatusLive({ palette, state, conn }) {
  const connColor = conn ? palette.accent : palette.danger;
  const connText = conn ? '● CONN' : '○ DISC';
  const phaseColor = state.phase === 'gameOver' ? palette.danger
                   : state.phase === 'playing' ? palette.accent
                   : palette.primary;
  return (
    <g transform={`translate(${CANVAS_W - 40}, 60)`}>
      <text x={0} y={0} fontFamily="JetBrains Mono" fontSize={14}
        fill="rgba(143,168,184,0.6)" letterSpacing="0.2em" textAnchor="end">
        WS: <tspan fill={connColor}>{connText}</tspan>
      </text>
      <text x={0} y={22} fontFamily="JetBrains Mono" fontSize={14}
        fill="rgba(143,168,184,0.6)" letterSpacing="0.2em" textAnchor="end">
        PHASE: <tspan fill={phaseColor}>{state.phase.toUpperCase()}</tspan>
      </text>
      <text x={0} y={44} fontFamily="JetBrains Mono" fontSize={14}
        fill="rgba(143,168,184,0.6)" letterSpacing="0.2em" textAnchor="end">
        CELLS: {state.cells.length} · MINES: {state.mineCount}
      </text>
    </g>
  );
}

// ── Tweaks panel ─────────────────────────────────────────
function TweaksPanel({ tw, setTwk, conn, state }) {
  return (
    <div className="tweaks-panel">
      <h3>Tweaks · 704_LIVE</h3>
      <SegRow label="PALETTE" value={tw.palette} setValue={(v) => setTwk('palette', v)}
        opts={[
          ['cyan-magenta', 'CYAN×MAG'],
          ['amber-red', 'AMBER×RED'],
          ['tron-blue', 'TRON'],
          ['synthwave', 'SYNTHWAVE'],
        ]}/>
      <SegRow label="CELL STYLE" value={tw.cellStyle} setValue={(v) => setTwk('cellStyle', v)}
        opts={[['bracket', 'BRACKETS'], ['hologram', 'HOLOGRAM']]}/>
      <SegRow label="SCAN LINES" value={tw.scanlines ? 'on' : 'off'}
        setValue={(v) => setTwk('scanlines', v === 'on')}
        opts={[['off', 'OFF'], ['on', 'ON']]}/>
      <SegRow label="VIGNETTE" value={tw.vignette ? 'on' : 'off'}
        setValue={(v) => setTwk('vignette', v === 'on')}
        opts={[['off', 'OFF'], ['on', 'ON']]}/>
      <div className="tweak-foot">
        WS: {conn ? '●' : '○'} {conn ? 'connected' : 'reconnecting...'}
        {state && ` · phase: ${state.phase}`}
      </div>
    </div>
  );
}

function SegRow({ label, value, setValue, opts }) {
  return (
    <div className="tweak-row">
      <label>{label}</label>
      <div className="seg">
        {opts.map(([v, l]) => (
          <button key={v} className={value === v ? 'active' : ''}
            onClick={() => setValue(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);