// ── Live playable cyberpunk view ─────────────────────────
// Connects to server WS, renders real game state, sends touches.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

const SENSOR_PER_CELL_X = 2;
const SENSOR_PER_CELL_Y = 4;
const RED_WAVE_DURATION_MS = 1800;
const RESTART_DELAY_AFTER_WAVE_MS = 400;
const WIN_ENDING_DURATION_MS = 6200;
const ENDING_DISSOLVE_START_S = 3.20;
const ENDING_DISSOLVE_SPREAD_S = 0.50;
const IDLE_GRID_CELL = 64; // 25 × 25 cm physical game cell
const IDLE_ECHO_DURATION_MS = 1000;
const IDLE_BAR = Object.freeze({
  bg: '#121817',
  face: '#1B2421',
  line: '#D3AF68',
  accent: '#7C2D3A',
  blue: '#5B86B8',
  text: '#F4E5C0',
});
const IDLE_ECHO_FALLBACKS = Object.freeze([
  '#00FFE5', '#FF2D8F', '#39FF14', '#FFB000',
  '#FFFFFF', '#FFD166', '#7FF4FF', '#FF9F1C',
]);

function idleEchoColors(palette) {
  return [
    palette?.primary,
    palette?.secondary,
    palette?.accent,
    palette?.warn,
    ...IDLE_ECHO_FALLBACKS,
  ].filter(Boolean);
}

function idleGridColors(palette) {
  // Keep the standby map visually coherent: one saturated grid color per
  // palette, instead of mixing all four palette roles across the background.
  return [palette?.primary || palette?.idleGrid?.[0] || IDLE_BAR.line];
}

function idleGridMetrics(face) {
  const width = Number(face?.w ?? face?.width) || IDLE_GRID_CELL;
  const height = Number(face?.h ?? face?.height) || IDLE_GRID_CELL;
  const cols = Math.max(1, Number(face?.boardCols) ||
    Math.floor(Number(face?.colCount || 0) / SENSOR_PER_CELL_X) ||
    Math.ceil(width / IDLE_GRID_CELL));
  const rows = Math.max(1, Number(face?.boardRows) ||
    Math.floor(Number(face?.rowCount || 0) / SENSOR_PER_CELL_Y) ||
    Math.ceil(height / IDLE_GRID_CELL));
  return {
    width,
    height,
    cols,
    rows,
    cellW: width / cols,
    cellH: height / rows,
  };
}

function screenPointToVenue(svg, clientX, clientY) {
  const rect = svg?.getBoundingClientRect?.();
  if (rect && rect.width > 0 && rect.height > 0) {
    const preserve = PROJECTOR_MODE ? 'none' : 'meet';
    if (preserve === 'none') {
      return {
        x: (clientX - rect.left) * CANVAS_W / rect.width,
        y: (clientY - rect.top) * CANVAS_H / rect.height,
      };
    }

    // Account for preserveAspectRatio="xMidYMid meet" letterboxing. The
    // CSS transform that centers the SVG is already reflected by rect.left/top.
    const scale = Math.min(rect.width / CANVAS_W, rect.height / CANVAS_H);
    const renderedW = CANVAS_W * scale;
    const renderedH = CANVAS_H * scale;
    const offsetX = (rect.width - renderedW) / 2;
    const offsetY = (rect.height - renderedH) / 2;
    return {
      x: (clientX - rect.left - offsetX) / scale,
      y: (clientY - rect.top - offsetY) / scale,
    };
  }

  // Fallback for older embedded Chromium builds without a useful client rect.
  if (svg?.createSVGPoint && svg.getScreenCTM?.()) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: local.x, y: local.y };
  }
  return null;
}

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
  const [idleEchoes, setIdleEchoes] = useState([]);
  const [conn, setConn] = useState(false);
  const wsRef = useRef(null);
  const clockOffsetRef = useRef(0);
  const localEchoSeqRef = useRef(0);
  const pendingEchoIdsRef = useRef(new Set());

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const nowMs = useCallback(() => Date.now() + clockOffsetRef.current, []);

  // Paint a local echo on pointer-down, then let the server echo reconcile it
  // with the shared event so the originating display does not wait for a loop.
  const showIdleEcho = useCallback((faceName, cellCol, cellRow) => {
    const clientEchoId = `local-${Date.now()}-${++localEchoSeqRef.current}`;
    pendingEchoIdsRef.current.add(clientEchoId);
    const echo = {
      id: clientEchoId,
      clientEchoId,
      faceName,
      cellCol,
      cellRow,
      colorIndex: Math.floor(Math.random() * 8),
      durationMs: IDLE_ECHO_DURATION_MS,
      receivedAt: Date.now(),
    };
    setIdleEchoes(prev => [...prev, echo].slice(-48));
    setTimeout(() => {
      pendingEchoIdsRef.current.delete(clientEchoId);
      setIdleEchoes(prev => prev.filter(e => e.id !== clientEchoId));
    }, IDLE_ECHO_DURATION_MS + 250);
    return clientEchoId;
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
        const receivedAt = Date.now();
        const serverNowMs = msg.serverNowMs ?? msg.snapshot?.serverNowMs;
        if (Number.isFinite(Number(serverNowMs))) {
          clockOffsetRef.current = Number(serverNowMs) - receivedAt;
        }
        if (msg.type === 'snapshot') {
          setState(msg);
          if (msg.phase !== 'idle') setIdleEchoes([]);
        } else if (msg.type === 'game-start' || msg.type === 'game-over' || msg.type === 'reset' ||
                   msg.type === 'pause' || msg.type === 'resume' ||
                   msg.type === 'tutorial-start' || msg.type === 'tutorial-step' ||
                   msg.type === 'tutorial-ready' || msg.type === 'tutorial-setting' ||
                   msg.type === 'countdown-start' || msg.type === 'countdown-tick' ||
                   msg.type === 'armed' ||
                   msg.type === 'operator-transition-complete' ||
                   msg.type === 'intro-start' || msg.type === 'intro-complete' ||
                   msg.type === 'tutorial-transition-complete' ||
                   msg.type === 'ending-start') {
          setState(msg.snapshot);
          setIdleEchoes([]);
        } else if (msg.type === 'idle-echo') {
          const clientEchoId = msg.clientEchoId ? String(msg.clientEchoId) : null;
          const isLocalEcho = !!clientEchoId &&
            pendingEchoIdsRef.current.has(clientEchoId);
          if (isLocalEcho) pendingEchoIdsRef.current.delete(clientEchoId);
          const displayId = isLocalEcho ? clientEchoId : msg.id;
          const echo = {
            ...msg,
            id: displayId,
            clientEchoId,
            receivedAt: Date.now(),
          };
          setIdleEchoes(prev => {
            if (!isLocalEcho) {
              return [...prev.filter(e => e.id !== displayId), echo].slice(-48);
            }
            const index = prev.findIndex(e => e.id === displayId);
            if (index < 0) return [...prev, echo].slice(-48);
            const next = prev.slice();
            next[index] = echo;
            return next;
          });
          setTimeout(() => {
            setIdleEchoes(prev => prev.filter(e => e.id !== displayId));
          }, Number(msg.durationMs) || IDLE_ECHO_DURATION_MS);
        } else if (msg.type === 'mode-change') {
          setState(s => s ? { ...s, currentMode: msg.mode } : s);
        } else if (msg.type === 'freeze') {
          // Mine = 5s freeze, game continues. Mark cell + freezeUntil + 紅波
          // (跟一開始的 breach 動畫一樣) so the consequence is dramatic.
          setState(s => {
            if (!s) return s;
            const cells = s.cells.slice();
            for (const c of msg.cells || []) cells[c.id] = c;
            return { ...s, cells,
              freezeUntil: msg.freezeUntil,
              bombCellId: msg.bombCellId,
              redWave: msg.redWave || null,
              redWaveStartedAt: msg.redWaveStartedAt ?? Date.now() };
          });
        } else if (msg.type === 'unfreeze') {
          setState(s => s ? { ...s, freezeUntil: null, redWave: null, bombCellId: null } : s);
        } else if (msg.type === 'time-limit') {
          setState(s => s ? { ...s, timeLimit: msg.timeLimit } : s);
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

  return { state, lockState, idleEchoes, send, conn, nowMs, showIdleEcho };
}

// ── Freeze overlay (mine-hit 5s freeze) ─────────────────
// 純數字倒數,每面牆中央各 render 一個;沒有文字。
// 每面用 faceContentRotation 旋轉,讓站在那面牆前的玩家數字都是正向。
function FreezeOverlay({ state, palette, nowMs = () => Date.now() }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!state?.freezeUntil) return;
    const t = setInterval(() => force(n => n + 1), 100);
    return () => clearInterval(t);
  }, [state?.freezeUntil]);
  if (!state?.freezeUntil || nowMs() >= state.freezeUntil) return null;
  const remaining = Math.max(0, state.freezeUntil - nowMs());
  const seconds = Math.ceil(remaining / 1000);

  const boardFaces = (state.faces || []).filter(f => f.isBoard);

  return (
    <g pointerEvents="none">
      {boardFaces.map(face => {
        const cx = face.originX + face.width / 2;
        const cy = face.originY + face.height / 2;
        const size = Math.min(face.width, face.height) * 0.62;
        const rot = faceContentRotation(face.reservedSide);
        return (
          <g key={face.name}
             transform={`translate(${cx}, ${cy}) rotate(${rot})`}
             style={{filter: `drop-shadow(0 0 24px ${palette.danger})`}}>
            <text x={0} y={0} textAnchor="middle" dominantBaseline="central"
              fontFamily="Orbitron" fontSize={size} fontWeight={900}
              fill={palette.danger}>
              {seconds}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ── Game-end overlay (win / timeout) ─────────────────────
function GameEndOverlay({ state, palette, nowMs = () => Date.now() }) {
  if (!state || state.phase !== 'gameOver') return null;
  if (state.won) return null;

  // TIME OUT 要像踩雷 freeze 倒數一樣，在每一面牆中央各顯示一次。
  // 場地玩家只看得到自己面前的牆；如果只在整張展開圖中央放 banner，其他牆面
  // 只會看到紅波，不知道為什麼結束。依 physical-top 旋轉，確保每面都正向。
  if (state.endReason === 'timeout' && state.endStage === 'timeout-wave') {
    const boardFaces = (state.faces || []).filter(f => f.isBoard);
    const floor = (state.faces || []).find(f => f.isFloor);
    const timeoutFaces = floor ? [...boardFaces, floor] : boardFaces;
    return (
      <g pointerEvents="none">
        {timeoutFaces.map(face => {
          const cx = face.originX + face.width / 2;
          const cy = face.isFloor
            ? face.originY + face.height * 0.28
            : face.originY + face.height / 2;
          const rot = faceContentRotation(face.reservedSide);
          // 窄面也必須放得下完整 TIME OUT；寬度以面向玩家時的可讀寬度為準。
          const readableW = (rot === 0 || rot === 180) ? face.width : face.height;
          const titleSize = Math.min(92, readableW * 0.12);
          const subSize = Math.max(14, Math.min(24, titleSize * 0.27));
          return (
            <g key={face.name}
               transform={`translate(${cx}, ${cy}) rotate(${rot})`}>
              <rect x={-readableW * 0.44} y={-titleSize * 0.82}
                width={readableW * 0.88} height={titleSize * 1.72}
                rx={12} fill="rgba(4,6,12,0.90)"
                stroke={palette.danger} strokeWidth={3}
                style={{filter: `drop-shadow(0 0 20px ${palette.danger})`}}/>
              <text x={0} y={-titleSize * 0.12}
                textAnchor="middle" dominantBaseline="central"
                fontFamily="Orbitron" fontSize={titleSize} fontWeight={900}
                fill={palette.danger} letterSpacing="0.12em"
                style={{filter: `drop-shadow(0 0 16px ${palette.danger})`}}>
                TIME OUT
              </text>
              <text x={0} y={titleSize * 0.55}
                textAnchor="middle" dominantBaseline="central"
                fontFamily="JetBrains Mono" fontSize={subSize} fontWeight={700}
                fill="rgba(255,255,255,0.82)" letterSpacing="0.16em">
                TIME LIMIT EXCEEDED
              </text>
            </g>
          );
        })}
      </g>
    );
  }
}

function EndActionLayer({ state, faces, cyberState, palette }) {
  if (!state || state.phase !== 'gameOver') return null;
  const isContinue = cyberState === 'gameover-continue';
  const isReturn = cyberState === 'gameover-final';
  if (!isContinue && !isReturn) return null;
  const floor = faces.find(f => f.isFloor);
  if (!floor) return null;
  // Keep the new ending action on the existing central floor hit area. The
  // ending overlays place their title above it so the visual button and the
  // venue sensor geometry stay aligned.
  const actionY = Math.round(floor.h / 2);
  return (
    <g transform={`translate(${floor.originX},${floor.originY})`} pointerEvents="none">
      <CenterButton
        kind={isContinue ? 'continueEnd' : 'endGame'}
        cx={floor.w / 2}
        cy={actionY}
        r={180}
        palette={palette}/>
    </g>
  );
}

// ── Game setup card (time limit; controller only, idle phase) ───
function GameSetupCard({ state, send, conn }) {
  const tl = state?.timeLimit ?? { enabled: false, ms: 600_000 };
  const tutorialEnabled = state?.tutorialEnabled ?? true;
  const totalSec = Math.max(0, Math.floor((tl.ms || 0) / 1000));
  const initH = Math.floor(totalSec / 3600);
  const initM = Math.floor((totalSec % 3600) / 60);
  const initS = totalSec % 60;

  const [hours, setHours] = useState(String(initH));
  const [minutes, setMinutes] = useState(String(initM));
  const [seconds, setSeconds] = useState(String(initS));
  const [enabled, setEnabled] = useState(!!tl.enabled);

  // Re-sync when server-side setting updates (e.g., another tab applied)
  useEffect(() => {
    setHours(String(initH));
    setMinutes(String(initM));
    setSeconds(String(initS));
    setEnabled(!!tl.enabled);
  },
    [tl.enabled, tl.ms]);

  const isIdle = state?.phase === 'idle';
  const isAwaitingPlayerStart = state?.phase === 'armed';
  const hoursValue = parseTimePart(hours, 0, 23);
  const minutesValue = parseTimePart(minutes, 0, 59);
  const secondsValue = parseTimePart(seconds, 0, 59);
  const draftMs = ((hoursValue * 3600) + (minutesValue * 60) + secondsValue) * 1000;
  const draftTimeLabel = [hoursValue, minutesValue, secondsValue]
    .map(value => String(value).padStart(2, '0')).join(':');
  const isTimeLimitDirty = isIdle &&
    (enabled !== !!tl.enabled || draftMs !== Number(tl.ms || 0));

  const apply = useCallback(() => {
    if (!isIdle) return;
    send({ type: 'set-time-limit', enabled, ms: Math.max(1000, draftMs) });
  }, [draftMs, enabled, isIdle, send]);

  const startGame = useCallback(() => {
    if (!isIdle || !conn) return;
    send({ type: 'start-game' });
  }, [isIdle, conn, send]);

  const endGame = useCallback(() => {
    if (!conn || isIdle) return;
    send({ type: 'end-game' });
  }, [conn, isIdle, send]);

  return (
    <div className="setup-card">
      <h3>// GAME SETUP</h3>
      <button className="setup-start" disabled={!isIdle || !conn} onClick={startGame}>
        <span aria-hidden="true">▶</span> 開始遊戲 · START GAME
      </button>
      <div className="setup-start-note">
        {isIdle ? '後台啟動後，等待玩家按下 Wall Left 地雷按鈕' :
         isAwaitingPlayerStart ? '等待玩家按下 Wall Left 地雷按鈕以開始前導' :
         '本局已啟動，開始按鈕暫停使用'}
      </div>
      <button className="setup-end" disabled={isIdle || !conn} onClick={endGame}>
        <span aria-hidden="true">■</span> 結束遊戲 · END GAME
      </button>
      <label className="setup-check">
        <input type="checkbox" checked={tutorialEnabled} disabled={!isIdle}
          onChange={e => send({ type: 'set-tutorial-enabled', enabled: e.target.checked })}/>
        <span>每局播放教學</span>
      </label>
      <label className="setup-check">
        <input type="checkbox" checked={enabled} disabled={!isIdle}
          onChange={e => setEnabled(e.target.checked)}/>
        <span>啟用上限時間</span>
      </label>
      <div className="setup-row">
        <NumStepper value={hours}   onChange={setHours}   min={0} max={23} label="HH" disabled={!isIdle || !enabled}/>
        <span className="sep">:</span>
        <NumStepper value={minutes} onChange={setMinutes} min={0} max={59} label="MM" disabled={!isIdle || !enabled}/>
        <span className="sep">:</span>
        <NumStepper value={seconds} onChange={setSeconds} min={0} max={59} label="SS" disabled={!isIdle || !enabled}/>
      </div>
      <button className={`setup-apply ${isTimeLimitDirty ? 'is-dirty' : ''}`}
        disabled={!isIdle} onClick={apply}>
        套用 · APPLY
      </button>
      {isTimeLimitDirty && (
        <div className="setup-warning" role="alert">
          尚有未套用時間設定，請按 APPLY
        </div>
      )}
      <div className="setup-note">
        {!isIdle ? '遊戲進行中 — 僅可在 idle 時設定' :
         (enabled ? `將於 ${draftTimeLabel} 觸發 timeout` :
                    '未啟用 — 遊戲將持續到全部安全格揭露')}
      </div>
    </div>
  );
}

function parseTimePart(value, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function NumStepper({ value, onChange, min=0, max=99, label, disabled }) {
  const current = parseTimePart(value, min, max);
  const clamp = (v) => Math.min(max, Math.max(min, Number(v) || 0));
  return (
    <div className="num-stepper">
      <div className="num-label">{label}</div>
      <button disabled={disabled} onClick={() => onChange(String(clamp(current - 1)))}>−</button>
      <input type="text" inputMode="numeric" value={String(value ?? '')}
        maxLength={2} aria-label={label} disabled={disabled}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 2))}
        onBlur={() => onChange(String(current))}/>
      <button disabled={disabled} onClick={() => onChange(String(clamp(current + 1)))}>+</button>
    </div>
  );
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

// ── End-action gate: server supplies the absolute time at which the next
// floor action becomes touchable. Every client uses that timestamp so a
// reconnect cannot make a button appear or work too early.
function useEndActionReady(state, nowMs = () => Date.now()) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!state || state.phase !== 'gameOver' || state.endActionAt == null) {
      setReady(false);
      return;
    }
    setReady(false);
    const t = setTimeout(() => setReady(true),
      Math.max(0, state.endActionAt - nowMs()));
    return () => clearTimeout(t);
  }, [state?.phase, state?.endActionAt, state?.endStage, nowMs]);
  return ready;
}

// ── Main App ─────────────────────────────────────────────
function App() {
  const { state, lockState, idleEchoes, send, conn, nowMs, showIdleEcho } = useGameState();
  const [tw, setTw] = useState(() => {
    const saved = localStorage.getItem('cyber-tw');
    return saved ? { ...TWEAK_DEFAULTS, ...JSON.parse(saved) } : TWEAK_DEFAULTS;
  });
  const svgRef = useRef(null);

  useTimerTick(state?.phase === 'playing' || state?.phase === 'paused');
  const endActionReady = useEndActionReady(state, nowMs);

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

  // cyber view state for FloorTerminal / RedWave overlay
  const cyberState = !state ? 'idle'
    : state.phase === 'idle' ? 'idle'
    : state.phase === 'armed' ? 'armed'
    : state.phase === 'intro' ? 'intro'
    : state.phase === 'ready' ? 'ready'
    : state.phase === 'tutorial' ? 'tutorial'
    : state.phase === 'tutorialReady' ? 'tutorialReady'
    : state.phase === 'countdown' ? 'countdown'
    : state.phase === 'playing' ? 'playing'
    : state.phase === 'paused' ? 'paused'
    : state.phase === 'gameOver' ? (
        state.endReason === 'operator'
          ? 'gameover-final'
          : state.endStage === 'timeout-wave'
          ? (endActionReady ? 'gameover-continue' : 'gameover-wave')
          : state.endStage === 'timeout-ending'
            ? (endActionReady ? 'gameover-final' : 'gameover-timeout-ending')
            : (endActionReady ? 'gameover-final' : 'gameover-wave')
      )
    : 'playing';

  // elapsed timer — plain expression so every re-render (driven by useTimerTick) re-reads
  // the server-synchronized clock.
  // The server timestamp is the source of truth; pausing only locks input and
  // leaves the elapsed clock running, so paused uses Date.now() as well.
  const elapsedMs = (!state || state.gameStartMs == null) ? 0
    : (state.gameEndMs ?? nowMs()) - state.gameStartMs;

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
    const svg = ev.currentTarget;
    if (!state) return;
    const local = screenPointToVenue(svg, ev.clientX, ev.clientY);
    if (!local) return;
    const face = state.faces.find(f =>
      local.x >= f.originX && local.x < f.originX + f.width &&
      local.y >= f.originY && local.y < f.originY + f.height);
    if (!face) return;
    if (face.name === 'Entrance') return;
    if (state.phase === 'idle') {
      const { cols, rows, cellW, cellH } = idleGridMetrics(face);
      const col = Math.min(cols - 1,
        Math.max(0, Math.floor((local.x - face.originX) / cellW)));
      const row = Math.min(rows - 1,
        Math.max(0, Math.floor((local.y - face.originY) / cellH)));
      const clientEchoId = showIdleEcho(face.name, col, row);
      send({
        type: 'inject-touch',
        face: face.name,
        sensorCol: col * SENSOR_PER_CELL_X + 1,
        sensorRow: row * SENSOR_PER_CELL_Y + 2,
        clientEchoId,
      });
      return;
    }
    if (state.phase === 'armed') {
      if (face.name !== 'Wall Left') return;
      const relX = local.x - face.originX;
      const relY = local.y - face.originY;
      const sensorCol = Math.floor(relX / face.cellPxW);
      const sensorRow = Math.floor(relY / face.cellPxH);
      send({ type: 'inject-touch', face: face.name, sensorCol, sensorRow });
      return;
    }
    if (face.isBoard) return; // handled by cell <g> onClick
    // Floor click
    const relX = local.x - face.originX;
    const relY = local.y - face.originY;
    const sensorCol = Math.floor(relX / face.cellPxW);
    const sensorRow = Math.floor(relY / face.cellPxH);
    send({ type: 'inject-touch', face: face.name, sensorCol, sensorRow });
  }, [state, send, showIdleEcho]);

  // ── Not yet connected: connecting screen ───────────
  if (!state) {
    return <ConnectingScreen palette={palette} tw={tw} conn={conn} setTwk={setTwk}/>;
  }

  const totalSafe = state.cells.length - state.mineCount;
  const flaggedCount = state.flaggedCount ?? 0;
  const revealedCount = state.revealedCount ?? 0;
  // Tutorial/ready are standalone presentation stages, not overlays on the real
  // mine board. Do not even mount cells/HUD during these phases, so no board
  // details can bleed through via alpha, scaling letterbox, or future CSS changes.
  const isTutorialStage = state.phase === 'tutorial' ||
    state.phase === 'tutorialReady' || state.phase === 'countdown';
  const isCellDissolveStage = state.gameOver &&
    (state.won || state.endStage === 'timeout-ending');
  const dissolveStartedAt = state.won ? state.gameEndMs : state.endingStartedAt;
  const dissolveElapsedS = dissolveStartedAt == null ? 0
    : Math.max(0, (nowMs() - dissolveStartedAt) / 1000);
  const isIdleStage = state.phase === 'idle';
  const isAwaitingPlayerStart = state.phase === 'armed';
  const quietStage = isIdleStage || isAwaitingPlayerStart;
  const hidePreTutorialStatus = state.phase === 'intro' || state.phase === 'ready';
  const showGameHud = state.phase === 'playing' ||
    state.phase === 'paused' || state.phase === 'gameOver';

  return (
    <div className={`stage ${tw.scanlines ? 'scan' : ''} ${quietStage ? 'idle-stage' : ''}`}
      style={quietStage ? {'--idle-bg': palette.bg0 || IDLE_BAR.bg} : undefined}>
      {!quietStage && tw.vignette && <div className="vignette"/>}

      {(isIdleStage || isAwaitingPlayerStart) ? <>
        <IdleStageParticles palette={palette}/>
        <IdleVenueMap faces={faces} palette={palette} state={state}
          idleEchoes={idleEchoes} onClick={handleSVGClick}>
          {isAwaitingPlayerStart && <>
            <StartMineButton state={state} faces={faces} palette={palette}
              cellStyle={tw.cellStyle} nowMs={nowMs}/>
            <OperatorStartTransitionOverlay state={state} palette={palette}
              nowMs={nowMs}/>
          </>}
        </IdleVenueMap>
      </> : <>
        <svg ref={svgRef} className="venue"
           viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
           preserveAspectRatio={PROJECTOR_MODE ? "none" : "xMidYMid meet"}
           onClick={handleSVGClick}>
          {!PROJECTOR_MODE && !hidePreTutorialStatus &&
            <VenueBadge palette={palette} state={cyberState}/>}
          {!PROJECTOR_MODE && !hidePreTutorialStatus &&
            <TopRightStatusLive palette={palette} state={state} conn={conn}/>}
          <FaceConnectors palette={palette}/>

          {faces.map(face => (
            <g key={face.name} transform={`translate(${face.originX},${face.originY})`}>
              <FaceFrame face={face} palette={palette}/>

              {face.isFloor && (
                <>
                  <FloorGrid face={face} palette={palette}/>
                  <FloorTerminal face={face} palette={palette}
                    state={cyberState}
                    currentMode={state.currentMode}
                    tutorialStep={state.tutorialStep ?? 0}
                    tutorialTotal={state.tutorialTotal ?? 4}
                    countdownValue={state.countdownValue}/>
                </>
              )}

              {face.isBoard && !isTutorialStage && (
                <>
                  {(cellsByFace[face.name] || []).map(cell => {
                    const rot = faceContentRotation(face.reservedSide);
                    const cellProps = {
                      // wrongFlag 只有 server 在 gameOver 後才會給 true,要排在 flagged 前面
                      // (誤標的格子同時也是 flagged,先比對才不會被吃掉)
                      state: (cell.revealed && cell.mine) ? 'mine'
                           : cell.revealed ? 'revealed'
                           : cell.wrongFlag ? 'wrongFlag'
                           : cell.flagged ? 'flagged'
                           : (state.phase === 'gameOver' && cell.mine) ? 'mine'
                           : 'hidden',
                      adjacent: cell.adjacent ?? 0,
                      mine: cell.mine,
                      locked: false, // legacy prop — no per-cell lock under new mode flow
                    };
                    const winStyle = isCellDissolveStage ? {
                      animationDelay: `${(ENDING_DISSOLVE_START_S +
                        ((cell.id * 37) % 100) / 100 * ENDING_DISSOLVE_SPREAD_S -
                        dissolveElapsedS)}s`,
                      cursor: state.phase === 'playing' ? 'pointer' : 'default',
                    } : {
                      cursor: state.phase === 'playing' ? 'pointer' : 'default',
                    };
                    return (
                      <g key={cell.id}
                         className={isCellDissolveStage ? 'win-dissolve-cell' : undefined}
                         style={winStyle}
                         transform={`translate(${cell.col*CELL},${cell.row*CELL})`}
                         onClick={(e) => handleCellClick(face, cell.col, cell.row, e)}
                         >
                        <rect x={0} y={0} width={CELL} height={CELL} fill="transparent"/>
                        <g transform={`rotate(${rot}, ${CELL/2}, ${CELL/2})`}>
                          <Cell cell={cellProps} palette={palette} cellStyle={tw.cellStyle}/>
                        </g>
                      </g>
                    );
                  })}
                  {showGameHud && <FaceHUD face={face} palette={palette}
                    state={cyberState}
                    elapsedMs={elapsedMs}
                    mineCount={state.mineCount}
                    flaggedCount={flaggedCount}
                    revealedCount={revealedCount}
                    totalSafe={totalSafe}
                    currentMode={state.currentMode}/>}
                </>
              )}
            </g>
          ))}

          <IntroOverlay state={state} faces={faces} palette={palette} nowMs={nowMs}/>

          {/* Four synchronized pre-game tutorial pages cover the four main walls. */}
          <TutorialWallOverlay state={state} faces={faces} palette={palette}
            nowMs={nowMs}/>

          <WinEndingOverlay state={state} faces={faces} palette={palette} nowMs={nowMs}/>
          <TimeoutEndingOverlay state={state} faces={faces} palette={palette} nowMs={nowMs}/>
          <OperatorEndingOverlay state={state} faces={faces} palette={palette}/>

          {cyberState === 'paused' && (() => {
            const floor = faces.find(f => f.isFloor);
            return (
              <g pointerEvents="none">
                {/* 全場 mask:半透明深色蓋住所有牆面/cells/HUD */}
                <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H}
                  fill="rgba(2,4,10,0.62)"/>
                {/* Floor 上方加一層深色背板,讓 RESUME 視覺乾淨 */}
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

          {/* RedWave: 統一在 state.redWave 設定時 render(mine freeze + timeout 共用同一套動畫) */}
          {state.redWave && <RedWaveOverlay palette={palette} state={state} nowMs={nowMs}/>}

          {/* Mine-hit freeze overlay (5s countdown) — on top of redWave */}
          <FreezeOverlay state={state} palette={palette} nowMs={nowMs}/>

          {/* Win / Timeout banner at top */}
          <GameEndOverlay state={state} palette={palette} nowMs={nowMs}/>

          {/* End action must sit above the full-field ending mask. */}
          <EndActionLayer state={state} faces={faces} cyberState={cyberState} palette={palette}/>

          {/* Sensor lock calibration overlay — on top of everything inside the SVG */}
          {!PROJECTOR_MODE && <LockOverlay
            faces={state.faces} lockState={lockState}
            onToggleCell={onToggleCell}/>}
        </svg>
      </>}

      {!PROJECTOR_MODE && <TweaksPanel tw={tw} setTwk={setTwk} conn={conn} state={state}/>}
      {!PROJECTOR_MODE && <BroadcastBtn/>}
      {!PROJECTOR_MODE && <LockPill lockState={lockState} onToggle={toggleLockMode}/>}
      {!PROJECTOR_MODE && <LockControlCard lockState={lockState}
        onClear={onClearLocked} onClose={toggleLockMode}/>}
      {!PROJECTOR_MODE && <GameSetupCard state={state} send={send} conn={conn}/>}
    </div>
  );
}

function IdleStageParticles({ palette }) {
  const colors = idleEchoColors(palette);
  const particles = Array.from({ length: 30 }, (_, i) => ({
    x: `${(i * 37 + 11) % 101}%`,
    y: `${(i * 61 + 17) % 101}%`,
    size: `${2 + (i % 3)}px`,
    delay: `${-((i * 0.83) % 9).toFixed(2)}s`,
    duration: `${8 + (i % 5)}s`,
    drift: `${((i % 5) - 2) * 18}px`,
    color: colors[i % colors.length],
  }));
  return (
    <div className="idle-particles" aria-hidden="true">
      {particles.map((p, i) => (
        <span key={i} style={{
          '--particle-x': p.x,
          '--particle-y': p.y,
          '--particle-size': p.size,
          '--particle-delay': p.delay,
          '--particle-duration': p.duration,
          '--particle-drift': p.drift,
          '--particle-color': p.color,
        }}/>
      ))}
    </div>
  );
}

function IdleVenueMap({ faces, palette, state, idleEchoes, onClick, children }) {
  const joints = [[2048, 640], [640, 2688], [2048, 2688]];
  const start = state?.startButton;
  const gridColors = idleGridColors(palette);
  const echoColors = idleEchoColors(palette);
  const mapBg = palette?.bg1 || palette?.bg0 || IDLE_BAR.bg;
  const mapLine = palette?.primary || IDLE_BAR.line;
  const mapTrace = palette?.secondary || IDLE_BAR.accent;
  return (
    <svg className="venue idle-venue" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      preserveAspectRatio={PROJECTOR_MODE ? "none" : "xMidYMid meet"}
      aria-label="704 standby venue map" onPointerDown={onClick}>
      <g className="idle-map-faces">
        {faces.map(face => (
          <g key={face.name} className="idle-map-face"
            transform={`translate(${face.originX},${face.originY})`}>
            <rect x={0} y={0} width={face.w} height={face.h}
              fill={mapBg}
              fillOpacity={face.name === 'Entrance' ? 0.56 : 0.82}
              stroke={mapLine}
              strokeOpacity={face.name === 'Entrance' ? 0.30 : 0.72}
              strokeWidth="2"/>
            <IdleGrid face={face} colors={gridColors} faceIndex={faces.indexOf(face)}/>
            <polyline points={`0,56 0,0 56,0`}
              fill="none" stroke={mapLine} strokeWidth="5" opacity=".72"/>
            <polyline points={`${Math.max(0, face.w - 56)},0 ${face.w},0 ${face.w},56`}
              fill="none" stroke={mapLine} strokeWidth="5" opacity=".72"/>
            <polyline points={`0,${Math.max(0, face.h - 56)} 0,${face.h} 56,${face.h}`}
              fill="none" stroke={mapLine} strokeWidth="5" opacity=".72"/>
            <polyline points={`${Math.max(0, face.w - 56)},${face.h} ${face.w},${face.h} ${face.w},${Math.max(0, face.h - 56)}`}
              fill="none" stroke={mapLine} strokeWidth="5" opacity=".72"/>
          </g>
        ))}
      </g>

      <g className="idle-echoes" pointerEvents="none">
        {(idleEchoes || []).map(echo => {
          const face = faces.find(f => f.name === echo.faceName);
          if (!face) return null;
          const { cellW, cellH } = idleGridMetrics(face);
          const colorIndex = Math.abs(Number(echo.colorIndex) || 0) % echoColors.length;
          const color = echoColors[colorIndex];
          return (
            <g key={echo.id}
              transform={`translate(${face.originX + echo.cellCol * cellW},${face.originY + echo.cellRow * cellH})`}
              pointerEvents="none">
              <g className="idle-echo" style={{'--echo-color': color}}>
                <rect x="-8" y="-8" width={cellW + 16} height={cellH + 16}
                  fill={color} opacity=".18"/>
                <rect width={cellW} height={cellH} fill={color} opacity=".46"/>
                <rect className="idle-echo-ring" x="4" y="4"
                  width={Math.max(0, cellW - 8)} height={Math.max(0, cellH - 8)}
                  fill="none" stroke={color} strokeWidth="6"/>
                <circle className="idle-echo-core" cx={cellW / 2} cy={cellH / 2}
                  r={Math.min(cellW, cellH) * 0.18} fill={color}/>
              </g>
            </g>
          );
        })}
      </g>

      {joints.map(([x, y], index) => (
          <g key={`${x}-${y}`} className="idle-map-joint"
          transform={`translate(${x},${y})`}>
          <circle r="24" fill={mapBg}
            stroke={mapLine} strokeWidth="3"/>
          <circle r="7" fill={mapTrace}/>
        </g>
      ))}

      {start && state?.phase === 'idle' && (
        <g className="idle-map-beacon" transform={`translate(${start.x},${start.y})`}>
          <circle r="12" fill={mapTrace}/>
        </g>
      )}

      {children}
    </svg>
  );
}

function IdleGrid({ face, colors, faceIndex }) {
  const { width, height, cols, rows, cellW, cellH } = idleGridMetrics(face);
  const cellRects = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cellW;
      const y = row * cellH;
      const w = Math.min(cellW, width - x);
      const h = Math.min(cellH, height - y);
      if (w <= 0 || h <= 0) continue;
      cellRects.push(
      <rect key={`cell-${col}-${row}`} x={x} y={y} width={w} height={h}
          fill={colors[(col + row + faceIndex) % colors.length]} opacity=".055"/>
      );
    }
  }

  const verticals = Array.from({ length: cols + 1 }, (_, col) => (
    <line key={`v-${col}`} x1={Math.min(width, col * cellW)} y1={0}
      x2={Math.min(width, col * cellW)} y2={height}
      stroke={colors[(col + faceIndex) % colors.length]} strokeWidth="1"
      opacity=".52"/>
  ));
  const horizontals = Array.from({ length: rows + 1 }, (_, row) => (
      <line key={`h-${row}`} x1={0} y1={Math.min(height, row * cellH)}
      x2={width} y2={Math.min(height, row * cellH)}
      stroke={colors[(row + faceIndex + 1) % colors.length]} strokeWidth="1"
      opacity=".52"/>
  ));
  return <g className="idle-grid" pointerEvents="none">
    {cellRects}
    {verticals}
    {horizontals}
  </g>;
}

function StartMineButton({ state, faces, palette, cellStyle = 'hologram',
                           nowMs = () => Date.now() }) {
  const button = state?.startButton;
  if (!button) return null;
  const face = faces.find(f => f.name === button.faceName);
  const rotation = faceContentRotation(face?.reservedSide);
  const cellSize = face?.boardCols
    ? face.width / face.boardCols
    : Math.min(button.width, button.height) / 3;
  const size = cellSize * 3;
  const tileSize = cellSize;
  const transitionActive = state.operatorTransitionStartedAt != null;
  const transitionDurationMs = Math.max(1, Number(
    state.operatorTransitionDurationMs ||
    state.animationDurations?.operatorTransition ||
    4000,
  ));
  const transitionDurationS = transitionDurationMs / 1000;
  const transitionElapsedS = Math.max(0, Math.min(transitionDurationS,
    (nowMs() - state.operatorTransitionStartedAt) / 1000));
  const transitionStyle = transitionActive ? {
    animation: `startMineButtonReveal ${transitionDurationS}s ease-out 1 both`,
    animationDelay: `${-transitionElapsedS}s`,
  } : undefined;
  const tiles = Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3);
    const col = index % 3;
    return (
      <g key={index} transform={`translate(${col * tileSize},${row * tileSize})`}>
        <Cell
          cell={{
            // The trigger is a 3×3 cluster of the same cells used by the game.
            // Its centre is the revealed "1" used by the physical button.
            state: index === 4 ? 'revealed' : 'hidden',
            adjacent: index === 4 ? 1 : 0,
            locked: false,
          }}
          palette={palette}
          cellStyle={cellStyle}
        />
      </g>
    );
  });
  return (
    <g transform={`translate(${button.x},${button.y}) rotate(${rotation}) translate(${-size / 2},${-size / 2}) scale(${cellSize / CELL})`}
      pointerEvents="none" style={transitionStyle}>
      {transitionActive && (
        <style>{`
          @keyframes startMineButtonReveal {
            0%, 30% { opacity: 0; }
            58% { opacity: .10; }
            78% { opacity: .52; }
            100% { opacity: 1; }
          }
        `}</style>
      )}
      <g style={{filter: `drop-shadow(0 0 18px ${palette.primary})`}}>
        {tiles}
      </g>
    </g>
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
