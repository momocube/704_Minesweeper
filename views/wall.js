import { StateClient } from '/client.js';

const FACE_NAMES = {
  'wall-left': 'Wall Left',
  'wall-top': 'Wall Top',
  'wall-right-big': 'Wall Right Big',
  'wall-right-little': 'Wall Right little',
  'wall-button': 'Wall Button',
};

const NUMBER_COLORS = ['', '#5b8dee', '#5dd97c', '#ff6b6b', '#c277ff',
                      '#ff9d4d', '#4dd0e1', '#f0f0f0', '#888'];
const RED_WAVE_DURATION_MS = 1800;

export function init(faceParam) {
  const faceName = FACE_NAMES[faceParam];
  if (!faceName) {
    document.body.textContent = `Unknown face: ${faceParam}`;
    return;
  }

  const root = document.getElementById('root');
  // 讓 canvas 在 root 內置中 + 黑色 letterbox
  root.style.display = 'flex';
  root.style.alignItems = 'center';
  root.style.justifyContent = 'center';
  root.style.background = '#000';
  const canvas = document.createElement('canvas');
  root.appendChild(canvas);
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<b>${faceName}</b> — 等待連線…`;
  root.appendChild(overlay);

  const ctx = canvas.getContext('2d');
  let state = null;
  let face = null;
  let myCells = [];
  let animStart = 0;

  function resize() {
    // 高畫質:canvas internal buffer = face native size (e.g. Wall Top 1408×640);
    // CSS 顯示尺寸 = fit-to-viewport,保留 aspect,黑色 letterbox 由 #root flex 處理
    const cw = face?.width  ?? window.innerWidth;
    const ch = face?.height ?? window.innerHeight;
    if (canvas.width  !== cw) canvas.width  = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const fit = Math.min(window.innerWidth / cw, window.innerHeight / ch);
    canvas.style.width  = Math.floor(cw * fit) + 'px';
    canvas.style.height = Math.floor(ch * fit) + 'px';
    canvas.style.display = 'block';
  }
  window.addEventListener('resize', resize);

  function indexCells() {
    if (!state) return;
    face = state.faces.find(f => f.name === faceName);
    if (!face) return;
    myCells = state.cells.filter(c => c.faceName === faceName);
  }

  function updateOverlay() {
    if (!state) return;
    if (state.phase === 'idle') {
      overlay.className = 'overlay';
      overlay.innerHTML = `<b>${faceName}</b> — 走到地板中央踩 ▶ 開始`;
    } else if (state.phase === 'gameOver') {
      overlay.className = 'overlay ' + (state.won ? 'win' : 'gameover');
      overlay.innerHTML = state.won ? '🎉 過關 — 走到地板踩重新開始' : '💥 BOOM — 走到地板踩重新開始';
    } else {
      overlay.className = 'overlay';
      overlay.innerHTML = `<b>${faceName}</b> · ${face?.boardCols ?? '—'}×${face?.boardRows ?? '—'} · 💣 ${state.mineCount - state.flaggedCount}`;
    }
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function elapsedMs() {
    if (!state || state.gameStartMs == null) return 0;
    const end = state.gameEndMs ?? Date.now();
    return end - state.gameStartMs;
  }

  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (!state || !face) return;

    // canvas buffer 已經是 face native size → 直接畫,無 JS scale
    const cellPx = face.width / face.boardCols; // 64 venue px
    for (const cell of myCells) {
      drawCell(cell, cell.col * cellPx, cell.row * cellPx, cellPx);
    }

    if (!state.gameOver && state.lockedCellId != null) {
      const lc = myCells.find(c => c.id === state.lockedCellId);
      if (lc) {
        ctx.strokeStyle = '#5b8dee';
        ctx.lineWidth = Math.max(4, cellPx * 0.12);
        ctx.strokeRect(lc.col * cellPx + ctx.lineWidth/2, lc.row * cellPx + ctx.lineWidth/2,
                       cellPx - ctx.lineWidth, cellPx - ctx.lineWidth);
      }
    }

    drawHud(cellPx);
    if (state.gameOver && state.redWave && !state.won) drawRedWave(cellPx);
  }

  function drawHud(cellPx) {
    const rect = hudRect(face, cellPx);
    const rotation = hudRotation(face.reservedSide);

    ctx.fillStyle = '#101015';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    drawHudAccent(rect, face.reservedSide);

    const w_text = (rotation === 0 || rotation === 180) ? rect.w : rect.h;
    const h_text = (rotation === 0 || rotation === 180) ? rect.h : rect.w;
    ctx.save();
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.translate(-w_text / 2, -h_text / 2);
    drawHudContents(w_text, h_text);
    ctx.restore();
  }

  function hudRect(face, cellPx) {
    const d = (face.reservedDepth ?? 2) * cellPx;
    switch (face.reservedSide) {
      case 'top':    return { x: 0,              y: 0,                w: face.width, h: d           };
      case 'bottom': return { x: 0,              y: face.height - d,  w: face.width, h: d           };
      case 'left':   return { x: 0,              y: 0,                w: d,          h: face.height };
      case 'right':  return { x: face.width - d, y: 0,                w: d,          h: face.height };
      default:       return { x: 0, y: 0, w: 0, h: 0 };
    }
  }

  function hudRotation(side) {
    switch (side) {
      case 'top':    return 0;
      case 'bottom': return 180;
      case 'left':   return 270;
      case 'right':  return 90;
      default:       return 0;
    }
  }

  function drawHudAccent(rect, side) {
    ctx.fillStyle = 'rgba(91, 141, 238, 0.18)';
    const t = 4;
    switch (side) {
      case 'top':    ctx.fillRect(rect.x, rect.y + rect.h - t, rect.w, t); break;
      case 'bottom': ctx.fillRect(rect.x, rect.y,              rect.w, t); break;
      case 'left':   ctx.fillRect(rect.x + rect.w - t, rect.y, t, rect.h); break;
      case 'right':  ctx.fillRect(rect.x,              rect.y, t, rect.h); break;
    }
  }

  function drawHudContents(w, h) {
    const cx = w / 2, cy = h / 2;
    const fontSize = Math.min(h * 0.45, w * 0.08);
    const timerText = `⏱ ${fmtTime(elapsedMs())}`;
    const totalSafe = state.cells.length - state.mineCount;
    const scoreText = `📊 ${state.revealedCount}/${totalSafe}`;
    const minesText = `💣 ${state.mineCount - state.flaggedCount}`;
    const wide = w > 800;
    if (wide) {
      drawText(scoreText, cx - w * 0.32, cy, fontSize, '#9aa', '700');
      drawText(timerText, cx,            cy, fontSize * 1.2, '#fff', '800');
      drawText(minesText, cx + w * 0.32, cy, fontSize, '#ff8a8a', '700');
    } else {
      drawText(timerText, cx, cy - fontSize * 0.35, fontSize * 1.15, '#fff', '800');
      drawText(`${scoreText}   ${minesText}`, cx, cy + fontSize * 0.7, fontSize * 0.55, '#9aa');
    }
  }

  function drawCell(cell, x, y, s) {
    if (cell.revealed) {
      ctx.fillStyle = cell.mine ? '#ff2020' : '#181820';
      ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = '#0a0a0a';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
      if (cell.mine) drawText('💣', x + s/2, y + s/2, s * 0.65, '#fff');
      else if (cell.adjacent > 0) drawText(String(cell.adjacent), x + s/2, y + s/2,
                                           s * 0.65, NUMBER_COLORS[Math.min(cell.adjacent, 8)] ?? '#fff', '700');
    } else {
      const inset = s * 0.04;
      ctx.fillStyle = '#3a3a44';
      ctx.fillRect(x + inset, y + inset, s - inset*2, s - inset*2);
      ctx.strokeStyle = '#5a5a66';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + inset + 0.5, y + inset + 0.5, s - inset*2 - 1, s - inset*2 - 1);
      if (cell.flagged) drawText('🚩', x + s/2, y + s/2, s * 0.65, '#ff4d4d');
    }
  }

  function drawRedWave(cellPx) {
    if (!animStart) return;
    const maxDist = state.redWave[state.redWave.length - 1]?.dist || 1;
    const elapsed = performance.now() - animStart;
    const reachDist = Math.min(1, elapsed / RED_WAVE_DURATION_MS) * maxDist;
    for (const w of state.redWave) {
      if (w.dist > reachDist) break;
      if (w.faceName !== faceName) continue;
      const lead = reachDist - w.dist;
      const fade = Math.min(1, lead / 50);
      ctx.fillStyle = `rgba(255, ${Math.floor(40 * (1 - fade))}, ${Math.floor(40 * (1 - fade))}, ${0.85 * fade})`;
      ctx.fillRect(w.col * cellPx, w.row * cellPx, cellPx, cellPx);
    }
  }

  function drawText(text, cx, cy, size, color, weight = '600', align = 'center', baseline = 'middle') {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px "Microsoft JhengHei", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(text, cx, cy);
  }

  const client = new StateClient({
    onSnapshot: (snap) => {
      state = snap;
      animStart = (state.gameOver && state.redWave) ? performance.now() : 0;
      indexCells();
      updateOverlay();
      resize();
    },
    onLock: () => { updateOverlay(); },
    onUnlock: () => { updateOverlay(); },
    onCellUpdate: (cells) => {
      for (const c of cells) {
        if (c.faceName !== faceName) continue;
        const idx = myCells.findIndex(x => x.id === c.id);
        if (idx >= 0) myCells[idx] = c;
      }
      updateOverlay();
    },
    onGameOver: ({ snapshot }) => {
      state = snapshot;
      animStart = performance.now();
      indexCells();
      updateOverlay();
    },
    onReset: ({ snapshot }) => {
      state = snapshot;
      animStart = 0;
      indexCells();
      updateOverlay();
    },
    onGameStart: ({ snapshot }) => {
      state = snapshot;
      animStart = 0;
      indexCells();
      updateOverlay();
    },
  });

  resize();
  function loop() {
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
