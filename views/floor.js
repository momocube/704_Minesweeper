import { StateClient } from '/client.js';

const RED_WAVE_DURATION_MS = 1800;
const RESTART_DELAY_AFTER_WAVE_MS = 400;
const INTRO_DURATION_MS = 10000;
const IDLE_BG = '#121817';
const IDLE_BAR_LINE = '#D3AF68';
const IDLE_BAR_ACCENT = '#7C2D3A';
const WIN_ENDING_DURATION_MS = 6200;
const ENDING_RESULTS_START_S = 5.55;

function animationDurationMs(state, key, fallback) {
  const value = Number(state?.animationDurations?.[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function endingMaskAlpha(elapsedMs, totalMs) {
  const start = totalMs * 0.38;
  const full = totalMs * 0.50;
  if (elapsedMs <= start) return 0;
  if (elapsedMs >= full) return 0.86;
  return 0.86 * ((elapsedMs - start) / Math.max(1, full - start));
}

export function init() {
  const root = document.getElementById('root');
  root.style.display = 'flex';
  root.style.alignItems = 'center';
  root.style.justifyContent = 'center';
  root.style.background = IDLE_BG;
  const canvas = document.createElement('canvas');
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let state = null;
  let face = null;
  let floorPulse = null;
  let animStart = 0;
  let maxWaveDist = 0;
  let nowMs = () => Date.now();

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
    ctx.fillStyle = IDLE_BG;
    ctx.fillRect(0, 0, W, H);
    if (!state || !face) return;

    if (state.phase === 'intro') {
      drawIntroFloor(W, H);
      return;
    }

    if (state.phase === 'idle') {
      drawIdleStage(W, H);
      return;
    }

    if (state.phase === 'armed') {
      drawArmedStage(W, H);
      return;
    }

    if (state.phase === 'ready') {
      drawCenterButtonFullscreen(W, H, 'play');
      return;
    }

    if (state.phase === 'tutorial') {
      drawCenterButtonFullscreen(W, H, 'continue');
      return;
    }

    if (state.phase === 'tutorialReady') {
      drawCenterButtonFullscreen(W, H, 'playReady');
      return;
    }

    if (state.phase === 'countdown') {
      drawCountdownFloor(W, H, state.countdownValue);
      return;
    }

    if (state.phase === 'paused') {
      drawPausedFloor(W, H);
      return;
    }

    if (state.phase === 'gameOver') {
      drawGameOverFloor(W, H);
      return;
    }

    // playing — left half flag, right half reveal
    const halfW = W / 2;
    const now = nowMs();
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
    const elapsed = (state.gameEndMs ?? nowMs()) - (state.gameStartMs ?? nowMs());
    const status = `⏱ ${fmtTime(elapsed)}    📊 ${state.revealedCount}/${totalSafe}    💣 ${state.mineCount - state.flaggedCount}`;
    drawText(status, W / 2, H * 0.06, Math.min(W * 0.025, 24), '#888', '600');

    if (state.lockedCellId != null) {
      const c = state.cells[state.lockedCellId];
      drawText(`已鎖定 ${c.faceName}(${c.col},${c.row})`, W / 2, H * 0.95, Math.min(W * 0.025, 22), '#aaa');
    } else {
    drawText('摸牆面選格,再踩這裡', W / 2, H * 0.95, Math.min(W * 0.025, 22), '#555');
  }

  function drawIdleStage(W, H) {
    ctx.fillStyle = IDLE_BG;
    ctx.fillRect(0, 0, W, H);
    drawStandbyParticles(W, H);
  }

  function drawArmedStage(W, H) {
    ctx.fillStyle = IDLE_BG;
    ctx.fillRect(0, 0, W, H);
    drawStandbyParticles(W, H);
  }

  function drawStandbyParticles(W, H) {
    const t = nowMs() / 1000;
    for (let i = 0; i < 14; i++) {
      const x = ((i * 47 + 7) % 101) / 100 * W;
      const baseY = ((i * 59 + 23) % 101) / 100 * H;
      const y = baseY + Math.sin(t * (0.28 + (i % 5) * 0.04) + i) * Math.max(10, H * 0.018);
      const radius = Math.max(1.5, Math.min(5, Math.min(W, H) * 0.006));
      ctx.globalAlpha = 0.22 + (Math.sin(t * 0.75 + i * 1.4) + 1) * 0.11;
      ctx.fillStyle = i % 4 === 0 ? IDLE_BAR_ACCENT : IDLE_BAR_LINE;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = Math.max(10, radius * 5);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  }

  function drawGameOverFloor(W, H) {
    if (state.won) {
      drawWinEndingFloor(W, H);
      return;
    }

    const showButton = state.endActionAt != null && nowMs() >= state.endActionAt;

    const waveDurationMs = animationDurationMs(state, 'redWave', RED_WAVE_DURATION_MS);
    const elapsed = Math.max(0, nowMs() -
      (state.redWaveStartedAt ?? state.gameEndMs ?? nowMs()));
    const progress = Math.min(1, elapsed / waveDurationMs);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    if (state.endReason === 'operator') {
      drawOperatorEndingFloor(W, H);
      if (showButton) drawCenterButtonFullscreen(W, H, 'return');
    } else if (state.endReason === 'timeout') {
      if (state.endStage === 'timeout-wave') {
        drawTimeoutFloor(W, H, showButton);
      } else if (state.endStage === 'timeout-ending') {
        drawTimeoutEndingFloor(W, H);
        if (state.endActionAt != null && nowMs() >= state.endActionAt) {
          drawCenterButtonFullscreen(W, H, 'return');
        }
      }
    }
  }

  function drawIntroFloor(W, H) {
    const introDurationMs = animationDurationMs(state, 'intro', INTRO_DURATION_MS);
    const elapsed = Math.max(0, Math.min(introDurationMs,
      nowMs() - (state.introStartedAt ?? nowMs())));
    const p = elapsed / introDurationMs;
    ctx.fillStyle = '#02040a';
    ctx.fillRect(0, 0, W, H);

    const origin = state.animationOrigins?.intro;
    const cx = origin ? origin.x - face.originX : W / 2;
    const cy = origin ? origin.y - face.originY : H / 2;
    [0, 0.12, 0.24].forEach((delay, i) => {
      const ringP = Math.max(0, Math.min(1, (p - delay) / 0.76));
      ctx.globalAlpha = ringP > 0 ? (1 - ringP) * 0.9 : 0;
      ctx.strokeStyle = i === 2 ? '#00ffe5' : '#39ff14';
      ctx.lineWidth = i === 0 ? 10 : 4;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(20, ringP * 3840 * 0.72), 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    const titleAlpha = Math.max(0, Math.min(1, (p - 0.43) / 0.08)) *
      (p > 0.78 ? Math.max(0, 1 - (p - 0.78) / 0.22) : 1);
    ctx.globalAlpha = titleAlpha;
    drawText('CYBERCUBE', cx, cy - 92, Math.min(W * 0.12, 112), '#e8f9fc', '900');
    drawText('MINESWEEPER', cx, cy + 42, Math.min(W * 0.09, 84), '#00ffe5', '900');
    drawText('FIELD INITIALIZING · 704', cx, cy + 150, Math.min(W * 0.025, 25), '#9ab0bc', '700');
    ctx.globalAlpha = 1;

    const playAlpha = Math.max(0, Math.min(1, (p - 0.86) / 0.14));
    if (playAlpha > 0) {
      ctx.globalAlpha = playAlpha;
      drawCenterButtonFullscreen(W, H, 'play');
      ctx.globalAlpha = 1;
    }
  }

  function drawWinEndingFloor(W, H) {
    const endingDurationMs = animationDurationMs(state, 'winEnding', WIN_ENDING_DURATION_MS);
    const elapsedMs = Math.max(0, nowMs() - (state.endingStartedAt ??
      state.gameEndMs ?? nowMs()));
    const elapsed = elapsedMs / 1000;
    ctx.fillStyle = '#0a3a18';
    ctx.fillRect(0, 0, W, H);

    if (elapsed < 2) {
      const p = elapsed / 2;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, 34 + p * Math.max(W, H), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const maskAlpha = endingMaskAlpha(elapsedMs, endingDurationMs);
    if (maskAlpha > 0) {
      ctx.fillStyle = `rgba(2,4,10,${maskAlpha})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawText('YOU WIN', W / 2, H * 0.28 - 72, Math.min(W * 0.12, 122), '#ffd166', '900');
    drawText('ALL SAFE CELLS REVEALED', W / 2, H * 0.28 + 30,
             Math.min(W * 0.03, 30), '#fff2c1', '700');

    if (elapsedMs >= endingDurationMs) {
      drawCenterButtonFullscreen(W, H, 'return');
    } else if (elapsedMs >= ENDING_RESULTS_START_S * 1000) {
      drawText('成績已顯示於左側牆面', W / 2, H * 0.78,
               Math.min(W * 0.04, 42), '#9fb3bf', '700');
    }
  }

  function drawOperatorEndingFloor(W, H) {
    ctx.fillStyle = '#101817';
    ctx.fillRect(0, 0, W, H);
    drawText('GAME ENDED', W / 2, H * 0.28 - 72,
      Math.min(W * 0.13, H * 0.10), '#4DA3FF', '900');
    drawText('OPERATOR STOP', W / 2, H * 0.28 + 30,
      Math.min(W * 0.03, 30), '#DFF5FA', '700');
    drawText('成績已顯示於左側牆面', W / 2, H * 0.70,
      Math.min(W * 0.04, 42), '#B9DCFF', '700');
  }

  function drawPausedFloor(W, H) {
    ctx.fillStyle = 'rgba(2,4,10,0.92)';
    ctx.fillRect(0, 0, W, H);
    drawText('⏸ PAUSED', W / 2, H * 0.23,
      Math.min(W * 0.10, H * 0.08), '#ffb000', '900');
    drawText('TIME CONTINUES', W / 2, H * 0.31,
      Math.min(W * 0.035, 34), '#d9c18a', '700');
    drawCenterButtonFullscreen(W, H, 'resume');
  }

  function drawCountdownFloor(W, H, value) {
    const color=value===3?'#39ff14':value===2?'#ffb000':'#ff1744';
    ctx.fillStyle='#02040a';ctx.fillRect(0,0,W,H);
    drawText(String(value),W/2,H*.48,Math.min(W*.28,H*.24),color,'900');
    drawText('GET READY',W/2,H*.67,Math.min(W*.065,64),color,'800');
  }

  function drawTimeoutFloor(W, H, showButton) {
    const titleSize = Math.min(W * 0.13, H * 0.10);
    const panelW = W * 0.82;
    const panelH = titleSize * 1.75;
    const panelY = H * 0.28;
    ctx.save();
    ctx.fillStyle = 'rgba(4,6,12,0.90)';
    ctx.strokeStyle = '#ff1744';
    ctx.lineWidth = Math.max(4, W * 0.004);
    ctx.shadowColor = '#ff1744';
    ctx.shadowBlur = Math.max(20, titleSize * 0.22);
    ctx.fillRect((W - panelW) / 2, panelY - panelH / 2, panelW, panelH);
    ctx.strokeRect((W - panelW) / 2, panelY - panelH / 2, panelW, panelH);
    drawText('TIME OUT', W / 2, panelY - titleSize * 0.12,
             titleSize, '#ff1744', '900');
    ctx.shadowBlur = 0;
    drawText('TIME LIMIT EXCEEDED', W / 2, panelY + titleSize * 0.58,
             Math.max(24, titleSize * 0.27), '#f4d8de', '700');
    ctx.restore();

    // 波結束後揭露／標記控制融合成 CONTINUE。
    if (showButton) {
      drawCenterButtonFullscreen(W, H, 'continueEnd');
    }
  }

  function drawTimeoutEndingFloor(W, H) {
    const endingDurationMs = animationDurationMs(state, 'timeoutEnding', WIN_ENDING_DURATION_MS);
    const elapsedMs = Math.max(0, nowMs() - (state.endingStartedAt ?? nowMs()));
    ctx.fillStyle = '#101817';
    ctx.fillRect(0, 0, W, H);
    const maskAlpha = endingMaskAlpha(elapsedMs, endingDurationMs);
    if (maskAlpha > 0) {
      ctx.fillStyle = `rgba(2,4,10,${maskAlpha})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawText('TIME OUT', W / 2, H * 0.28 - 72,
      Math.min(W * 0.13, H * 0.10), '#ff1744', '900');
    drawText('SESSION COMPLETE', W / 2, H * 0.28 + 30,
      Math.min(W * 0.03, 30), '#ffd9de', '700');
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
    if (kind === 'play' || kind === 'playReady') {
      color = flashOn ? '#5dd97c' : '#3a9555';
      glyph = '▶'; label = 'PLAY';
    } else if (kind === 'continue' || kind === 'resume') {
      color = flashOn ? '#00ffe5' : '#00a896';
      glyph = kind === 'resume' ? '▶' : '›';
      label = kind === 'resume' ? 'RESUME' : 'CONTINUE';
    } else if (kind === 'continueEnd') {
      color = flashOn ? '#4DA3FF' : '#2469C7';
      glyph = '›'; label = 'CONTINUE';
    } else {
      color = state.won ? '#5dd97c'
        : state.endReason === 'operator' ? '#4DA3FF' : '#00ffe5';
      glyph = '↻'; label = 'RETURN';
    }
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, btnSize, btnSize);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.strokeRect(bx + 2, by + 2, btnSize - 4, btnSize - 4);
    drawText(glyph, W / 2, H / 2 - btnSize * 0.1, btnSize * 0.45, '#fff', '800');
    drawText(label, W / 2, H / 2 + btnSize * 0.28, btnSize * 0.13, '#fff', '700');
    // Sublabel centre must stay inside the button face: 0.42 + half of 0.075 is
    // 0.4575 of btnSize from centre, clear of the 0.5 edge.
    if (kind === 'continue') {
      drawText(`STEP ${(state.tutorialStep ?? 0) + 1} / ${state.tutorialTotal ?? 4}`,
               W / 2, H / 2 + btnSize * 0.42, btnSize * 0.075, '#bffcf5', '700');
    } else if (kind === 'playReady') {
      drawText('開始正式遊戲', W / 2, H / 2 + btnSize * 0.42,
               btnSize * 0.075, '#dfffea', '700');
    } else if (kind === 'continueEnd') {
      drawText('進入結尾動畫', W / 2, H / 2 + btnSize * 0.42,
               btnSize * 0.075, '#B9DCFF', '700');
    } else if (kind === 'resume') {
      drawText('繼續遊戲', W / 2, H / 2 + btnSize * 0.42,
               btnSize * 0.075, '#d9f9df', '700');
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
      indexFace();
      animStart = (state.gameOver && state.redWave) ? performance.now() : 0;
      maxWaveDist = state.redWave?.length ? state.redWave[state.redWave.length - 1].dist : 0;
    },
    onModeFeedback: ({ mode, accepted }) => {
      if (!accepted) return;
      floorPulse = { mode, until: nowMs() + 300 };
    },
    onTutorial: ({ snapshot }) => {
      state = snapshot;
      indexFace();
      animStart = 0;
    },
    onIntro: ({ snapshot }) => {
      state = snapshot;
      indexFace();
      animStart = 0;
    },
    onArmed: ({ snapshot }) => {
      state = snapshot;
      indexFace();
      animStart = 0;
      resize();
    },
    onEndingStart: ({ snapshot }) => {
      state = snapshot;
      indexFace();
      animStart = 0;
    },
    onFreeze: ({ redWave, redWaveStartedAt }) => {
      if (!state) return;
      state.redWave = redWave || null;
      state.redWaveStartedAt = redWaveStartedAt ?? nowMs();
    },
    onUnfreeze: () => {
      if (!state) return;
      state.redWave = null;
      state.redWaveStartedAt = null;
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
    onPause: ({ snapshot }) => {
      state = snapshot;
      indexFace();
    },
    onResume: ({ snapshot }) => {
      state = snapshot;
      indexFace();
    },
  });
  nowMs = () => client.now();

  resize();
  function loop() { draw(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
}
