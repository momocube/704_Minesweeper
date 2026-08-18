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
      overlay.innerHTML = `<b>${faceName}</b> — 走到地板中央踩 PLAY`;
    } else if (state.phase === 'tutorial' || state.phase === 'tutorialReady' || state.phase === 'countdown') {
      // The canvas is a fully designed standalone tutorial/countdown stage. An HTML overlay
      // would make it look layered again, so keep it completely empty here.
      overlay.className = 'overlay';
      overlay.innerHTML = '';
    } else if (state.phase === 'gameOver') {
      overlay.className = 'overlay ' + (state.won ? 'win' : 'gameover');
      overlay.innerHTML = state.won
        ? '🎉 過關 — 走到地板踩重新開始'
        : state.endReason === 'timeout'
          ? '⏱ TIME OUT — 走到地板返回待機'
          : '遊戲結束 — 走到地板返回待機';
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

    // Tutorial is a standalone stage: do not paint cells/HUD first and cover
    // them later. This early return guarantees a clean canvas with no board bleed.
    if (state.phase === 'tutorial') {
      drawTutorialPage(W, H, state.tutorialStep ?? 0);
      return;
    }
    if (state.phase === 'tutorialReady') {
      drawTutorialReady(W, H);
      return;
    }
    if (state.phase === 'countdown') {
      drawCountdown(W, H, state.countdownValue);
      return;
    }

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
    if (state.phase === 'gameOver' && state.endReason === 'timeout') drawTimeout(cellPx);
  }

  function drawTutorialBackdrop(W, H) {
    const grad = ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*0.72);
    grad.addColorStop(0,'#071521'); grad.addColorStop(0.58,'#040a12'); grad.addColorStop(1,'#02040a');
    ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='rgba(0,255,229,0.10)';ctx.lineWidth=1;
    const step=Math.max(48,Math.min(W,H)*0.12);
    for(let x=0;x<W;x+=step){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=0;y<H;y+=step){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    ctx.strokeStyle='#00ffe5';ctx.lineWidth=Math.max(2,W*.003);ctx.strokeRect(8,8,W-16,H-16);
  }

  function drawTutorialPage(W, H, step) {
    drawTutorialBackdrop(W,H);
    if (faceName === 'Wall Right little') {
      ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
      return;
    }
    const rotation = hudRotation(face.reservedSide);
    const rw = (rotation === 0 || rotation === 180) ? W : H;
    const rh = (rotation === 0 || rotation === 180) ? H : W;
    ctx.save();
    ctx.translate(W/2, H/2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.translate(-rw/2, -rh/2);
    ctx.fillStyle = '#04060a'; ctx.fillRect(0,0,rw,rh);
    ctx.strokeStyle = '#00ffe5'; ctx.lineWidth = Math.max(2,rw*0.003);
    ctx.strokeRect(8,8,rw-16,rh-16);
    const titles = ['雙模式｜SCAN & MARK','格子邏輯｜九宮格','時間與威脅數字','PAUSE 與其他按鈕'];
    drawText(`TUTORIAL ${step+1} / 4`, rw*0.06, rh*0.08, Math.min(rw*.025,26), '#00ffe5','700','left');
    // Header sits above the canonical content band (card top = rh*0.228).
    drawText(titles[step], rw/2, rh*0.17, Math.min(rw*.05,rh*.095), '#e8f9fc','900');
    if (step === 0) {
      drawModeCards(rw, rh);
    } else if (step === 1) {
      const s=Math.min(rw,rh)*.17, ox=rw*.25-s*1.5, oy=rh*.34;
      for(let r=0;r<3;r++)for(let c=0;c<3;c++){
        ctx.fillStyle='#081620';ctx.strokeStyle=(r===1&&c===1)?'#39ff14':'#00ffe5';ctx.lineWidth=(r===1&&c===1)?5:2;
        ctx.fillRect(ox+c*s,oy+r*s,s-4,s-4);ctx.strokeRect(ox+c*s,oy+r*s,s-4,s-4);
      }
      drawText('2',ox+s*1.5,oy+s*1.5,s*.62,'#39ff14','900');
      drawText('揭露中央格',rw*.67,rh*.44,Math.min(rw*.045,48),'#39ff14','800');
      drawText('數字＝周圍 8 格的地雷數',rw*.67,rh*.60,Math.min(rw*.029,31),'#e8f9fc','700');
    } else if (step === 2) {
      drawText('T.UPTIME',rw*.30,rh*.40,Math.min(rw*.025,26),'#8fa8b8','600');
      drawText('01:24',rw*.30,rh*.58,Math.min(rw*.075,82),'#00ffe5','900');
      drawText('THREAT',rw*.70,rh*.40,Math.min(rw*.025,26),'#8fa8b8','600');
      drawText('120',rw*.70,rh*.58,Math.min(rw*.075,82),'#ff1744','900');
      drawText('已進行時間',rw*.30,rh*.73,Math.min(rw*.027,29),'#e8f9fc','700');
      drawText('剩餘地雷估計',rw*.70,rh*.73,Math.min(rw*.027,29),'#e8f9fc','700');
    } else {
      const items=[['Ⅱ','PAUSE','#ffb000'],['▶','RESUME','#39ff14'],['■','ABORT','#ff1744'],['⏏','STANDBY','#00ffe5']];
      items.forEach((it,i)=>{const x=rw*(.14+i*.24);drawText(it[0],x,rh*.45,Math.min(rw*.06,64),it[2],'900');drawText(it[1],x,rh*.64,Math.min(rw*.024,26),it[2],'800');});
    }
    ctx.restore();
  }

  // Canvas mirror of the SVG DUAL MODE page: two full 3×3 grids on one shared
  // 6.4s timeline so every projected face shows the same beat. First half the
  // SCAN grid reveals its centre number, second half the MARK grid toggles a
  // flag on and back off — the two halves never animate at the same time.
  const MODE_CYCLE_MS = 6400;

  function drawModeCards(rw, rh) {
    const t = (performance.now() % MODE_CYCLE_MS) / MODE_CYCLE_MS;
    // Same proportions as the SVG canonical 1408×640 page so a projector face
    // and the React view show an identical composition.
    const cardW = rw * 0.391, cardH = rh * 0.728, cardY = rh * 0.228;
    drawModeCard(rw * 0.273 - cardW / 2, cardY, cardW, cardH, {
      color: '#39ff14', glyph: '◎', title: 'SCAN', zh: '揭露格子',
      caption: '摸中央格 → 揭露數字', sub: 'CENTER CELL REVEAL',
      active: t < 0.46,
      target: t >= 0.06 && t < 0.50,
      show: t >= 0.14 && t < 0.50 ? 'number' : null,
    });
    drawModeCard(rw * 0.727 - cardW / 2, cardY, cardW, cardH, {
      color: '#ff2d8f', glyph: '⚑', title: 'MARK', zh: '插旗／取消旗子',
      caption: '摸中央格 → 插旗／再摸取消', sub: 'TOGGLE CENTER FLAG',
      active: t >= 0.46,
      target: t >= 0.52 && t < 0.96,
      show: t >= 0.60 && t < 0.90 ? 'flag' : null,
    });
  }

  function drawModeCard(x, y, w, h, o) {
    ctx.save();
    ctx.globalAlpha = o.active ? 1 : 0.34;
    ctx.fillStyle = 'rgba(8,14,22,0.94)';
    ctx.strokeStyle = o.color;
    ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);

    // Ratios lifted straight from the measured SVG stack (card h = 466): glyph
    // 0.076 · title 0.194 · zh 0.281 · rule 0.356 · grid 0.386 · caption 0.845 ·
    // sub 0.915. Each is also capped by card width so a narrow face never
    // overflows. On the 640-tall content band this puts the card at y 146..612
    // with the grid at 326..512 and the captions at 528..581 — no collisions.
    const cx = x + w / 2;
    drawText(o.glyph, cx, y + h * 0.076, Math.min(h * 0.090, w * 0.16), o.color, '900');
    drawText(o.title, cx, y + h * 0.194, Math.min(h * 0.077, w * 0.20), o.color, '900');
    drawText(o.zh,    cx, y + h * 0.281, Math.min(h * 0.047, w * 0.13), '#e8f9fc', '700');
    ctx.strokeStyle = o.color;
    ctx.lineWidth = Math.max(1, h * 0.004);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.18, y + h * 0.356);
    ctx.lineTo(x + w * 0.82, y + h * 0.356);
    ctx.stroke();

    // 3×3 grid — centre cell is the only animated target
    const cell = Math.min(h * 0.133, w * 0.22);
    const gx = cx - cell * 1.5, gy = y + h * 0.386;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const center = r === 1 && c === 1;
      const bx = gx + c * cell, by = gy + r * cell;
      ctx.globalAlpha = (o.active ? 1 : 0.34) * (center ? 1 : 0.55);
      ctx.fillStyle = '#07141e';
      ctx.strokeStyle = o.color;
      ctx.lineWidth = center ? Math.max(2, cell * 0.05) : Math.max(1, cell * 0.024);
      ctx.fillRect(bx + 2, by + 2, cell - 6, cell - 6);
      ctx.strokeRect(bx + 2, by + 2, cell - 6, cell - 6);
    }
    ctx.globalAlpha = o.active ? 1 : 0.34;
    const tx = gx + cell, ty = gy + cell;
    if (o.target) {
      ctx.strokeStyle = o.color;
      ctx.lineWidth = Math.max(3, cell * 0.07);
      ctx.strokeRect(tx + 1, ty + 1, cell - 4, cell - 4);
    }
    if (o.show === 'number') {
      drawText('2', tx + cell / 2, ty + cell / 2, cell * 0.6, o.color, '900');
    } else if (o.show === 'flag') {
      ctx.fillStyle = o.color;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = Math.max(2, cell * 0.05);
      ctx.beginPath();
      ctx.moveTo(tx + cell * 0.42, ty + cell * 0.22);
      ctx.lineTo(tx + cell * 0.42, ty + cell * 0.75);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tx + cell * 0.43, ty + cell * 0.24);
      ctx.lineTo(tx + cell * 0.78, ty + cell * 0.36);
      ctx.lineTo(tx + cell * 0.43, ty + cell * 0.49);
      ctx.closePath();
      ctx.fill();
    }
    drawText(o.caption, cx, y + h * 0.845, Math.min(h * 0.050, w * 0.072), '#e8f9fc', '700');
    drawText(o.sub, cx, y + h * 0.915, Math.min(h * 0.038, w * 0.055), o.color, '700');
    ctx.restore();
  }

  function drawTutorialReady(W, H) {
    drawTutorialBackdrop(W,H);
    if (faceName === 'Wall Right little') {
      ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
      return;
    }
    const rotation=hudRotation(face.reservedSide);
    const rw=(rotation===0||rotation===180)?W:H;
    const rh=(rotation===0||rotation===180)?H:W;
    ctx.save();ctx.translate(W/2,H/2);ctx.rotate(rotation*Math.PI/180);ctx.translate(-rw/2,-rh/2);
    ctx.fillStyle='#04060a';ctx.fillRect(0,0,rw,rh);ctx.strokeStyle='#39ff14';ctx.lineWidth=Math.max(3,rw*.003);ctx.strokeRect(8,8,rw-16,rh-16);
    ctx.shadowColor='#39ff14';ctx.shadowBlur=24;
    drawText('READY',rw/2,rh*.36,Math.min(rw*.085,rh*.18),'#39ff14','900');
    ctx.shadowBlur=0;
    ctx.strokeStyle='rgba(57,255,20,.55)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(rw*.32,rh*.45);ctx.lineTo(rw*.68,rh*.45);ctx.stroke();
    drawText('教學完成',rw/2,rh*.58,Math.min(rw*.043,rh*.09),'#e8f9fc','800');
    drawText('如果準備好了，按下 PLAY 開始遊戲',rw/2,rh*.73,Math.min(rw*.034,rh*.075),'#e8f9fc','800');
    drawText('PLAY IS ON THE FLOOR CENTER',rw/2,rh*.86,Math.min(rw*.019,rh*.042),'#00ffe5','700');
    ctx.restore();
  }

  function drawCountdown(W, H, value) {
    ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
    if (faceName === 'Wall Right little') return;
    drawTutorialBackdrop(W,H);
    const rotation=hudRotation(face.reservedSide);
    const rw=(rotation===0||rotation===180)?W:H;
    const rh=(rotation===0||rotation===180)?H:W;
    const color=value===3?'#39ff14':value===2?'#ffb000':'#ff1744';
    ctx.save();ctx.translate(W/2,H/2);ctx.rotate(rotation*Math.PI/180);ctx.translate(-rw/2,-rh/2);
    drawText('GAME STARTING',rw/2,rh*.20,Math.min(rw*.028,rh*.06),'#00ffe5','700');
    ctx.shadowColor=color;ctx.shadowBlur=30;
    drawText(String(value),rw/2,rh*.58,Math.min(rw*.26,rh*.52),color,'900');ctx.shadowBlur=0;
    drawText('準備開始',rw/2,rh*.86,Math.min(rw*.032,rh*.07),'#e8f9fc','700');
    ctx.restore();
  }

  function drawTimeout(cellPx) {
    // 逐面 WallProjector view 不經 cyber SVG；直接在 canvas 中央畫同樣的
    // 粗體紅色 TIME OUT，並以 HUD 的 physical-top 方向旋轉給玩家閱讀。
    const rotation = hudRotation(face.reservedSide);
    const readableW = (rotation === 0 || rotation === 180) ? canvas.width : canvas.height;
    const titleSize = Math.min(120, readableW * 0.13);
    const panelW = readableW * 0.82;
    const panelH = titleSize * 1.65;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.fillStyle = 'rgba(4,6,12,0.90)';
    ctx.strokeStyle = '#ff1744';
    ctx.lineWidth = Math.max(3, cellPx * 0.06);
    ctx.shadowColor = '#ff1744';
    ctx.shadowBlur = Math.max(18, titleSize * 0.2);
    ctx.fillRect(-panelW / 2, -panelH / 2, panelW, panelH);
    ctx.strokeRect(-panelW / 2, -panelH / 2, panelW, panelH);
    drawText('TIME OUT', 0, -titleSize * 0.12, titleSize, '#ff1744', '900');
    ctx.shadowBlur = 0;
    drawText('TIME LIMIT EXCEEDED', 0, titleSize * 0.55,
             Math.max(18, titleSize * 0.24), '#f4d8de', '700');
    ctx.restore();
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
    onTutorial: ({ snapshot }) => {
      state = snapshot;
      animStart = 0;
      indexCells();
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
