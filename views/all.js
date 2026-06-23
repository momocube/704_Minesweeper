import { StateClient } from '/client.js';

const NUMBER_COLORS = ['', '#5b8dee', '#5dd97c', '#ff6b6b', '#c277ff', '#ff9d4d', '#4dd0e1', '#f0f0f0', '#888'];
const FLOOR_BTN = 50;
const RED_WAVE_DURATION_MS = 1800;
const RESTART_DELAY_AFTER_WAVE_MS = 400;

const URL_PARAMS = new URLSearchParams(location.search);
const PROJECTOR_MODE = URL_PARAMS.get('projector') === '1';
const electron = (typeof window !== 'undefined' && window.electron704mine) || null;

export function init() {
  const root = document.getElementById('root');
  if (PROJECTOR_MODE) root.classList.add('projector-mode');

  const headerHtml = PROJECTOR_MODE ? '' : `
    <div class="all-header">
      <span class="brand"><b>704 Minesweeper</b> — 全展開檢視</span>
      <span class="stat mines">💣 <b id="mines">—</b></span>
      <span class="stat flags">🚩 <b id="flags">—</b></span>
      <span class="stat">已揭 <b id="revealed">—</b></span>
      <span class="stat" id="lockStat"></span>
      <span class="stat" id="connStat"></span>
      ${electron ? `<button class="broadcast-btn" id="broadcastBtn">📺 投播</button>
      <div class="broadcast-menu" id="broadcastMenu"></div>` : ''}
      <span class="hint">頂部 2 排是 HUD;點牆 = 摸格;點地板 = 觸發模式</span>
    </div>
  `;
  root.innerHTML = `
    <div class="all-root">
      ${headerHtml}
      <div class="all-stage">
        <canvas id="cv"></canvas>
      </div>
    </div>
  `;

  const canvas = document.getElementById('cv');
  const ctx = canvas.getContext('2d');
  const els = PROJECTOR_MODE ? {} : {
    mines: document.getElementById('mines'),
    flags: document.getElementById('flags'),
    revealed: document.getElementById('revealed'),
    lockStat: document.getElementById('lockStat'),
    connStat: document.getElementById('connStat'),
  };

  if (electron && !PROJECTOR_MODE) setupBroadcast();

  let state = null;
  let scale = 1, offsetX = 0, offsetY = 0;
  let ws = null;
  let floorPulse = null;
  let animStart = 0;
  let maxWaveDist = 1;

  function resize() {
    // 高畫質策略:canvas 內部 buffer 永遠是 venue 原生 2688×3840;
    // CSS 顯示尺寸:
    //   - 控制台模式 → fit-to-stage 保留 aspect,黑色 letterbox
    //   - PROJECTOR_MODE → 100vw × 100vh 滿版(可能輕微拉伸,但 OBS / Arena 不會看到黑邊)
    const stage = document.querySelector('.all-stage');
    const cw = state?.canvas.width  ?? 2688;
    const ch = state?.canvas.height ?? 3840;
    if (canvas.width  !== cw) canvas.width  = cw;
    if (canvas.height !== ch) canvas.height = ch;
    if (PROJECTOR_MODE) {
      canvas.style.width  = '100vw';
      canvas.style.height = '100vh';
    } else {
      const stageW = stage.clientWidth;
      const stageH = stage.clientHeight;
      const fit = Math.min(stageW / cw, stageH / ch);
      canvas.style.width  = Math.floor(cw * fit) + 'px';
      canvas.style.height = Math.floor(ch * fit) + 'px';
    }
    scale = 1;
    offsetX = 0;
    offsetY = 0;
  }
  window.addEventListener('resize', resize);

  function canvasPxFromMouse(ev) {
    // map displayed coords → internal buffer (native venue) coords
    const r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) * (canvas.width  / r.width),
      y: (ev.clientY - r.top)  * (canvas.height / r.height),
    };
  }

  function faceAt(px, py) {
    if (!state) return null;
    for (const f of state.faces) {
      if (px >= f.originX && px < f.originX + f.width &&
          py >= f.originY && py < f.originY + f.height) return f;
    }
    return null;
  }

  // Projector window 不接受滑鼠輸入(避免投影視窗 = 玩家輸入,造成雙重觸發)
  if (!PROJECTOR_MODE) {
    canvas.addEventListener('click', (ev) => {
      const { x, y } = canvasPxFromMouse(ev);
      const f = faceAt(x, y);
      if (!f || f.name === 'Entrance') return;
      const relX = x - f.originX, relY = y - f.originY;
      const sensorCol = Math.floor(relX / f.cellPxW);
      const sensorRow = Math.floor(relY / f.cellPxH);
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'inject-touch', face: f.name, sensorCol, sensorRow }));
      }
    });
  } else {
    canvas.style.cursor = 'none';
  }

  // ── Broadcast / projector control (Electron only) ──────────────
  async function setupBroadcast() {
    const btn = document.getElementById('broadcastBtn');
    const menu = document.getElementById('broadcastMenu');
    if (!btn || !menu) return;

    let isOpen = false;
    try { isOpen = await electron.isProjectorOpen(); } catch {}
    syncBtn();

    function syncBtn() {
      btn.textContent = isOpen ? '⏹ 關閉投播' : '📺 投播';
      btn.classList.toggle('on', isOpen);
    }

    electron.onProjectorState((open) => { isOpen = open; syncBtn(); hideMenu(); });

    btn.addEventListener('click', async () => {
      if (isOpen) {
        await electron.closeProjector();
        return;
      }
      try {
        const displays = await electron.listDisplays();
        showMenu(displays);
      } catch (e) { console.error(e); }
    });

    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== btn) hideMenu();
    });

    function showMenu(displays) {
      menu.innerHTML = '';
      // Windowed mode option (for OBS / NDI capture)
      const windowed = mkItem('🪟 視窗模式', 'OBS / NDI 截取用', async () => {
        await electron.openProjector({ windowed: true });
      });
      menu.appendChild(windowed);
      // Auto-second-display shortcut
      if (displays.length >= 2) {
        const auto = mkItem('🖥 自動 → 第二螢幕', '全螢幕投影到非主螢幕', async () => {
          await electron.openProjectorOnSecondary();
        });
        menu.appendChild(auto);
      }
      // Each display
      for (const d of displays) {
        const label = `${d.label}${d.isPrimary ? ' · 主螢幕' : ''}`;
        const size = `${d.bounds.width}×${d.bounds.height}`;
        menu.appendChild(mkItem(label, size, async () => {
          await electron.openProjector({ displayId: d.id, windowed: false });
        }));
      }
      menu.style.display = 'block';
    }
    function hideMenu() { menu.style.display = 'none'; }
    function mkItem(label, meta, onClick) {
      const el = document.createElement('button');
      el.className = 'broadcast-menu-item';
      el.innerHTML = `<span class="lbl">${label}</span><span class="meta">${meta}</span>`;
      el.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        hideMenu();
        try { await onClick(); } catch (e) { console.error(e); }
      });
      return el;
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
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, W, H);

    if (!state) {
      drawText('等待 server…', W/2, H/2, 64, '#666');
      return;
    }

    // 全部在 native venue 2688×3840 coords 上畫(no transform)
    for (const face of state.faces) drawFace(face);
    if (!state.gameOver && state.lockedCellId != null) drawLockedHighlight();
    if (state.gameOver && state.redWave && !state.won) drawRedWave();

    drawFloorOverlay();
  }

  function drawFace(face) {
    ctx.save();
    ctx.translate(face.originX, face.originY);  // venue coords

    if (face.name === 'Entrance') {
      ctx.fillStyle = '#101014';
      ctx.fillRect(0, 0, face.width, face.height);
      drawText('Entrance', face.width/2, face.height/2 - 22, 32, '#444');
      drawText('(不互動)', face.width/2, face.height/2 + 22, 28, '#333');
    } else if (face.isFloor) {
      ctx.fillStyle = '#08080a';
      ctx.fillRect(0, 0, face.width, face.height);
      if (state.phase === 'playing') {
        ctx.fillStyle = 'rgba(58,26,26,0.35)';
        ctx.fillRect(0, 0, face.width / 2, face.height);
        ctx.fillStyle = 'rgba(26,58,32,0.35)';
        ctx.fillRect(face.width / 2, 0, face.width / 2, face.height);
        drawText('Floor', face.width/2, face.height/2 - 60, 80, '#222');
        drawText('左半 = 🚩    右半 = ⛏', face.width/2, face.height/2 + 40, 56, '#1c1c20');
      } else {
        // idle / gameOver — dim, button is drawn as overlay
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(0, 0, face.width, face.height);
      }
    } else if (face.isBoard) {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, face.width, face.height);
      drawBoard(face);
      drawHud(face);
    }

    ctx.strokeStyle = '#1d1d22';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, face.width - 3, face.height - 3);
    drawText(face.name, 10, 4, 22, '#555', '600', 'left', 'top');
    ctx.restore();
  }

  function drawBoard(face) {
    const cellPx = face.width / face.boardCols; // === face.height / face.boardRows === 64
    const myCells = state.cells.filter(c => c.faceName === face.name);
    for (const cell of myCells) {
      drawCell(cell, cell.col * cellPx, cell.row * cellPx, cellPx);
    }
  }

  function drawHud(face) {
    // HUD strip's rect in face-local coords + orientation rotation matching the physical-top edge
    const rect = hudRect(face);
    const rotation = hudRotation(face.reservedSide);

    // 1) fill the strip
    ctx.fillStyle = '#101015';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    // accent line on the inward side of the HUD
    drawHudAccent(rect, face.reservedSide);

    // 2) draw text in a rotated coord where strip is laid horizontally (w_text wide × h_text tall)
    const w_text = rotation === 0 || rotation === 180 ? rect.w : rect.h;
    const h_text = rotation === 0 || rotation === 180 ? rect.h : rect.w;
    ctx.save();
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.translate(-w_text / 2, -h_text / 2);
    drawHudContents(w_text, h_text);
    ctx.restore();
  }

  function hudRect(face) {
    const cellPx = face.width / face.boardCols;
    const d = (face.reservedDepth ?? 2) * cellPx;
    switch (face.reservedSide) {
      case 'top':    return { x: 0,                y: 0,                  w: face.width, h: d            };
      case 'bottom': return { x: 0,                y: face.height - d,    w: face.width, h: d            };
      case 'left':   return { x: 0,                y: 0,                  w: d,          h: face.height  };
      case 'right':  return { x: face.width - d,   y: 0,                  w: d,          h: face.height  };
      default:       return { x: 0, y: 0, w: 0, h: 0 };
    }
  }

  // Rotation (degrees) so HUD text reads "outward" toward physical top.
  // Conceptually: stand inside room facing the wall; text top points at ceiling.
  function hudRotation(side) {
    switch (side) {
      case 'top':    return 0;     // text horizontal, normal orientation
      case 'bottom': return 180;   // flipped
      case 'left':   return 270;   // text rotated 90° CCW (reads bottom-up in 展開圖)
      case 'right':  return 90;    // text rotated 90° CW
      default:       return 0;
    }
  }

  function drawHudAccent(rect, side) {
    ctx.fillStyle = 'rgba(91, 141, 238, 0.12)';
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
      drawText(timerText, cx,            cy, fontSize * 1.15, '#fff', '800');
      drawText(minesText, cx + w * 0.32, cy, fontSize, '#ff8a8a', '700');
    } else {
      drawText(timerText, cx, cy - fontSize * 0.4, fontSize * 1.1, '#fff', '800');
      drawText(`${scoreText}   ${minesText}`, cx, cy + fontSize * 0.65, fontSize * 0.55, '#9aa');
    }
  }

  function drawCell(cell, x, y, s) {
    if (cell.revealed) {
      ctx.fillStyle = cell.mine ? '#ff2020' : '#181820';
      ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = '#0a0a0a';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
      if (cell.mine) {
        drawText('💣', x + s/2, y + s/2, s * 0.6, '#fff');
      } else if (cell.adjacent > 0) {
        drawText(String(cell.adjacent), x + s/2, y + s/2, s * 0.6,
                 NUMBER_COLORS[Math.min(cell.adjacent, 8)] ?? '#fff', '700');
      }
    } else {
      const inset = 2;
      ctx.fillStyle = '#3a3a44';
      ctx.fillRect(x + inset, y + inset, s - inset*2, s - inset*2);
      ctx.strokeStyle = '#5a5a66';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + inset + 0.5, y + inset + 0.5, s - inset*2 - 1, s - inset*2 - 1);
      if (cell.flagged) drawText('🚩', x + s/2, y + s/2, s * 0.6, '#ff4d4d');
    }
  }

  function drawLockedHighlight() {
    const cell = state.cells[state.lockedCellId];
    const face = state.faces.find(f => f.name === cell.faceName);
    if (!face || !face.isBoard) return;
    const cellPx = face.width / face.boardCols;
    const x = face.originX + cell.col * cellPx;
    const y = face.originY + cell.row * cellPx;
    ctx.strokeStyle = '#5b8dee';
    ctx.lineWidth = 5;
    ctx.strokeRect(x + 2.5, y + 2.5, cellPx - 5, cellPx - 5);
  }

  function drawRedWave() {
    if (!state.redWave || !animStart) return;
    const elapsed = performance.now() - animStart;
    const progress = Math.min(1, elapsed / RED_WAVE_DURATION_MS);
    const reachDist = progress * maxWaveDist;
    const CELL_PX = 64;
    for (const w of state.redWave) {
      if (w.dist > reachDist) break;
      const face = state.faces.find(f => f.name === w.faceName);
      if (!face) continue;
      const x = face.originX + w.col * CELL_PX;
      const y = face.originY + w.row * CELL_PX;
      const lead = reachDist - w.dist;
      const fade = Math.min(1, lead / 50);
      ctx.fillStyle = `rgba(255, ${Math.floor(40 * (1 - fade))}, ${Math.floor(40 * (1 - fade))}, ${0.85 * fade})`;
      ctx.fillRect(x, y, CELL_PX, CELL_PX);
    }
  }

  function drawFloorOverlay() {
    if (!state) return;
    const floor = state.faces.find(f => f.isFloor);
    if (!floor) return;
    // venue coords (no JS scale)
    const cxS = floor.originX + floor.width / 2;
    const cyS = floor.originY + floor.height / 2;

    if (state.phase === 'idle') {
      drawCenterButton(cxS, cyS, 'start');
      return;
    }

    if (state.phase === 'gameOver') {
      if (state.won) { drawCenterButton(cxS, cyS, 'restart'); return; }
      if (animStart) {
        const elapsed = performance.now() - animStart;
        const waveDoneMs = RED_WAVE_DURATION_MS + RESTART_DELAY_AFTER_WAVE_MS;
        if (elapsed < waveDoneMs) return;
      }
      drawCenterButton(cxS, cyS, 'restart');
      return;
    }

    // playing — flag/reveal buttons (venue px;原本螢幕 50px,在 native res 換算 ≈ 200 venue px)
    const FLOOR_BTN_V = FLOOR_BTN * 4;
    const gap = 32;
    const flagX = cxS - FLOOR_BTN_V - gap / 2, flagY = cyS - FLOOR_BTN_V / 2;
    const revX  = cxS + gap / 2,               revY  = cyS - FLOOR_BTN_V / 2;

    const now = Date.now();
    const flagOn = floorPulse?.mode === 'flag'   && now < floorPulse.until;
    const revOn  = floorPulse?.mode === 'reveal' && now < floorPulse.until;

    ctx.fillStyle = flagOn ? '#ff5d5d' : '#3a1a1a';
    ctx.fillRect(flagX, flagY, FLOOR_BTN_V, FLOOR_BTN_V);
    ctx.fillStyle = revOn ? '#5dd97c' : '#1a3a20';
    ctx.fillRect(revX, revY, FLOOR_BTN_V, FLOOR_BTN_V);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 6;
    ctx.strokeRect(flagX + 3, flagY + 3, FLOOR_BTN_V - 6, FLOOR_BTN_V - 6);
    ctx.strokeRect(revX  + 3, revY  + 3, FLOOR_BTN_V - 6, FLOOR_BTN_V - 6);
    drawText('🚩', flagX + FLOOR_BTN_V/2, flagY + FLOOR_BTN_V/2, FLOOR_BTN_V * 0.65, '#fff');
    drawText('⛏',  revX  + FLOOR_BTN_V/2, revY  + FLOOR_BTN_V/2, FLOOR_BTN_V * 0.65, '#fff');
  }

  function drawCenterButton(cxS, cyS, kind) {
    // kind: 'start' | 'restart'
    // 物理 3×3 board cells = 75×75 cm = 192 venue px (1 大格 = 25cm = 64px).
    // 現在直接用 venue px 畫,browser CSS 下次 downscale 還是 75×75 cm
    const BTN = (state.restartBtnBoardCells ?? 3) * 64;
    const half = BTN / 2;
    const flashOn = Math.floor(performance.now() / 400) % 2 === 0;

    let color, glow, glyph, label;
    if (kind === 'start') {
      color = flashOn ? '#5dd97c' : '#3a9555';
      glow  = '#5dd97c';
      glyph = '▶'; label = '開始';
    } else {
      color = state.won ? '#5dd97c' : (flashOn ? '#ff5050' : '#cc3030');
      glow  = state.won ? '#5dd97c' : '#ff5050';
      glyph = '↻'; label = '重新';
    }

    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 80;
    ctx.fillStyle = color;
    ctx.fillRect(cxS - half, cyS - half, BTN, BTN);
    ctx.restore();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 6;
    ctx.strokeRect(cxS - half + 3, cyS - half + 3, BTN - 6, BTN - 6);

    drawText(glyph, cxS, cyS - BTN * 0.1,  BTN * 0.45, '#fff', '800');
    drawText(label, cxS, cyS + BTN * 0.28, BTN * 0.16, '#fff', '700');
  }

  function drawText(text, cx, cy, size, color, weight = '600', align = 'center', baseline = 'middle') {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px "Microsoft JhengHei", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(text, cx, cy);
  }

  function updateHeader() {
    if (!state || PROJECTOR_MODE) return;
    els.mines.textContent = String(state.mineCount - state.flaggedCount);
    els.flags.textContent = String(state.flaggedCount);
    const totalBoard = state.cells.length;
    els.revealed.textContent = `${state.revealedCount} / ${totalBoard - state.mineCount}`;
    if (state.phase === 'idle') {
      els.lockStat.innerHTML = '<b style="color:#5dd97c">▶ 踩地板中央開始</b>';
    } else if (state.phase === 'gameOver') {
      els.lockStat.innerHTML = state.won ? '<b style="color:#5dd97c">🎉 過關</b>' : '<b style="color:#ff4040">💥 BOOM</b>';
    } else if (state.lockedCellId != null) {
      const c = state.cells[state.lockedCellId];
      els.lockStat.innerHTML = `已鎖定 <b>${c.faceName}(${c.col},${c.row})</b>`;
    } else {
      els.lockStat.innerHTML = '<span style="color:#666">摸牆面選格</span>';
    }
  }

  function onGameOver(snapshot) {
    state = snapshot;
    animStart = performance.now();
    maxWaveDist = state.redWave?.length ? (state.redWave[state.redWave.length - 1].dist || 1) : 1;
    updateHeader();
  }

  const client = new StateClient({
    onSnapshot: (snap) => {
      state = snap;
      if (state.gameOver && state.redWave) {
        animStart = performance.now();
        maxWaveDist = state.redWave[state.redWave.length - 1]?.dist || 1;
      } else {
        animStart = 0;
        maxWaveDist = 0;
      }
      updateHeader();
      resize();
    },
    onLock: () => { updateHeader(); },
    onUnlock: () => { updateHeader(); },
    onCellUpdate: () => { updateHeader(); },
    onModeFeedback: ({ mode, accepted }) => {
      if (!accepted) return;
      floorPulse = { mode, until: Date.now() + 300 };
    },
    onGameOver: ({ snapshot }) => onGameOver(snapshot),
    onReset: ({ snapshot }) => {
      state = snapshot;
      animStart = 0;
      maxWaveDist = 0;
      updateHeader();
    },
    onGameStart: ({ snapshot }) => {
      state = snapshot;
      animStart = 0;
      maxWaveDist = 0;
      updateHeader();
    },
  });
  setInterval(() => {
    ws = client._ws;
    if (PROJECTOR_MODE || !els.connStat) return;
    els.connStat.innerHTML = (ws && ws.readyState === ws.OPEN)
      ? '<b style="color:#5dd97c">●</b> server'
      : '<b style="color:#888">○</b> 連線中…';
  }, 500);

  // Continuous render loop (timer ticks + animations need it)
  function loop() {
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  resize();
}
