import { StateClient } from '/client.js';

const RED_WAVE_DURATION_MS = 1800;
const RESTART_DELAY_AFTER_WAVE_MS = 400;

export function init() {
  const root = document.getElementById('root');
  root.style.display = 'flex';
  root.style.alignItems = 'center';
  root.style.justifyContent = 'center';
  root.style.background = '#000';
  const canvas = document.createElement('canvas');
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let state = null;
  let face = null;
  let floorPulse = null;
  let animStart = 0;
  let maxWaveDist = 0;

  function resize() {
    // 高畫質:canvas internal buffer = Floor face native size (1408×2048);
    // CSS 顯示尺寸 = fit-to-viewport,保留 aspect,letterbox 由 #root flex 處理
    const cw = face?.width  ?? 1408;
    const ch = face?.height ?? 2048;
    if (canvas.width  !== cw) canvas.width  = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const fit = Math.min(window.innerWidth / cw, window.innerHeight / ch);
    canvas.style.width  = Math.floor(cw * fit) + 'px';
    canvas.style.height = Math.floor(ch * fit) + 'px';
    canvas.style.display = 'block';
  }
  window.addEventListener('resize', resize);

  function indexFace() {
    if (!state) return;
    face = state.faces.find(f => f.isFloor);
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, W, H);
    if (!state || !face) return;

    if (state.phase === 'idle') {
      drawCenterButtonFullscreen(W, H, 'start');
      return;
    }

    if (state.phase === 'gameOver') {
      drawGameOverFloor(W, H);
      return;
    }

    // playing — left half flag, right half reveal
    const halfW = W / 2;
    const now = Date.now();
    const flagOn = floorPulse?.mode === 'flag'   && now < floorPulse.until;
    const revOn  = floorPulse?.mode === 'reveal' && now < floorPulse.until;

    ctx.fillStyle = flagOn ? '#5a2020' : '#2a1010';
    ctx.fillRect(0, 0, halfW, H);
    ctx.fillStyle = revOn ? '#205a30' : '#102a18';
    ctx.fillRect(halfW, 0, halfW, H);

    drawText('🚩', halfW * 0.5, H * 0.42, Math.min(W * 0.18, H * 0.4), flagOn ? '#fff' : '#ff5a5a');
    drawText('旗 子', halfW * 0.5, H * 0.72, Math.min(W * 0.06, H * 0.1), '#fff', '700');

    drawText('⛏', halfW * 1.5, H * 0.42, Math.min(W * 0.18, H * 0.4), revOn ? '#fff' : '#5dd97c');
    drawText('揭 露', halfW * 1.5, H * 0.72, Math.min(W * 0.06, H * 0.1), '#fff', '700');

    // small status strip top
    const totalSafe = state.cells.length - state.mineCount;
    const elapsed = (state.gameEndMs ?? Date.now()) - (state.gameStartMs ?? Date.now());
    const status = `⏱ ${fmtTime(elapsed)}    📊 ${state.revealedCount}/${totalSafe}    💣 ${state.mineCount - state.flaggedCount}`;
    drawText(status, W / 2, H * 0.06, Math.min(W * 0.025, 24), '#888', '600');

    if (state.lockedCellId != null) {
      const c = state.cells[state.lockedCellId];
      drawText(`已鎖定 ${c.faceName}(${c.col},${c.row})`, W / 2, H * 0.95, Math.min(W * 0.025, 22), '#aaa');
    } else {
      drawText('摸牆面選格,再踩這裡', W / 2, H * 0.95, Math.min(W * 0.025, 22), '#555');
    }
  }

  function drawGameOverFloor(W, H) {
    const showButton = (() => {
      if (state.won) return true;
      if (!animStart) return false;
      const elapsed = performance.now() - animStart;
      return elapsed > (RED_WAVE_DURATION_MS + RESTART_DELAY_AFTER_WAVE_MS);
    })();

    if (state.won) {
      ctx.fillStyle = '#0a3a18';
      ctx.fillRect(0, 0, W, H);
    } else {
      const elapsed = animStart ? performance.now() - animStart : 0;
      const progress = Math.min(1, elapsed / RED_WAVE_DURATION_MS);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(180, 0, 0, ${0.5 * progress})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (showButton) {
      drawCenterButtonFullscreen(W, H, 'restart');
    } else {
      drawText(state.won ? '🎉 過關' : '💥 BOOM',
               W / 2, H / 2,
               Math.min(W * 0.1, H * 0.15),
               state.won ? '#5dd97c' : '#ff4040', '800');
    }
  }

  function drawCenterButtonFullscreen(W, H, kind) {
    // background tint
    if (kind === 'start') {
      ctx.fillStyle = '#08120a';
      ctx.fillRect(0, 0, W, H);
    }
    const btnCanvas = (state.restartBtnBoardCells ?? 3) * 64;
    const btnSize = (btnCanvas / face.width) * W;
    const bx = W / 2 - btnSize / 2;
    const by = H / 2 - btnSize / 2;
    const flashOn = Math.floor(performance.now() / 400) % 2 === 0;
    let color, glyph, label;
    if (kind === 'start') {
      color = flashOn ? '#5dd97c' : '#3a9555';
      glyph = '▶'; label = '開始遊戲';
    } else {
      color = state.won ? '#5dd97c' : (flashOn ? '#ff5050' : '#cc3030');
      glyph = '↻'; label = '重新開始';
    }
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, btnSize, btnSize);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.strokeRect(bx + 2, by + 2, btnSize - 4, btnSize - 4);
    drawText(glyph, W / 2, H / 2 - btnSize * 0.1, btnSize * 0.45, '#fff', '800');
    drawText(label, W / 2, H / 2 + btnSize * 0.28, btnSize * 0.13, '#fff', '700');
  }

  function drawText(text, cx, cy, size, color, weight = '600', align = 'center', baseline = 'middle') {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px "Microsoft JhengHei", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(text, cx, cy);
  }

  new StateClient({
    onSnapshot: (snap) => {
      state = snap;
      indexFace();
      animStart = (state.gameOver && state.redWave) ? performance.now() : 0;
      maxWaveDist = state.redWave?.length ? state.redWave[state.redWave.length - 1].dist : 0;
    },
    onModeFeedback: ({ mode, accepted }) => {
      if (!accepted) return;
      floorPulse = { mode, until: Date.now() + 300 };
    },
    onGameOver: ({ snapshot }) => {
      state = snapshot;
      indexFace();
      animStart = performance.now();
      maxWaveDist = state.redWave?.length ? state.redWave[state.redWave.length - 1].dist : 0;
    },
    onReset: ({ snapshot }) => {
      state = snapshot;
      indexFace();
      animStart = 0;
      maxWaveDist = 0;
    },
    onGameStart: ({ snapshot }) => {
      state = snapshot;
      indexFace();
      animStart = 0;
      maxWaveDist = 0;
    },
  });

  resize();
  function loop() { draw(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
}
