import {
  buildBoard, sensorToBoardId, faceCanvasSize, chipPx,
  BOARD_FACE_NAMES, FLOOR_FACE_NAME, ENTRANCE_FACE_NAME,
  SENSOR_PER_CELL_X, SENSOR_PER_CELL_Y, RESERVED_TOP_ROWS,
} from './board.js';

const LOCK_TIMEOUT_MS = 5000;
// 3 board cells × 3 board cells centered on Floor
const RESTART_BTN_BOARD_CELLS = 3;
// PAUSE button: 3 board cells centered horizontally, near bottom of Floor (chip rows 104..115)
const PAUSE_BTN_CHIP_ROW_MIN = 104;
const PAUSE_BTN_CHIP_ROW_MAX = 116; // exclusive (12 chip rows = 3 board rows)

export class Game {
  constructor(venue, topology, options = {}) {
    this.venue = venue;
    this.topology = topology;
    this.options = options;
    this.listeners = new Set();
    this._reset();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(msg) { for (const fn of this.listeners) fn(msg); }

  _reset() {
    const built = buildBoard(this.venue, this.topology, this.options);
    this.cells = built.cells;
    this.faceMap = built.faceMap;
    this.mineCount = built.mineCount;
    this.total = built.total;
    this.lockedCellId = null;
    this._lockTimer = null;
    this.phase = 'idle'; // 'idle' | 'playing' | 'paused' | 'gameOver'
    this.gameOver = false; // back-compat alias; mirrors phase === 'gameOver'
    this.won = false;
    this.revealedCount = 0;
    this.gameStartMs = null;
    this.gameEndMs = null;
    this.pausedAt = null;
    this.bombCellId = null;
    this.redWave = null;
  }

  _startGame() {
    this.phase = 'playing';
    this.gameOver = false;
    this.gameStartMs = Date.now();
    this.gameEndMs = null;
    this.pausedAt = null;
  }

  _pauseGame() {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.pausedAt = Date.now();
    this._clearLocked();
  }

  _resumeGame() {
    if (this.phase !== 'paused') return;
    // 把 gameStartMs 往後推 = 不算暫停的時間
    const pausedDuration = Date.now() - this.pausedAt;
    this.gameStartMs += pausedDuration;
    this.pausedAt = null;
    this.phase = 'playing';
  }

  snapshot() {
    const allFaceNames = [...BOARD_FACE_NAMES, FLOOR_FACE_NAME, ENTRANCE_FACE_NAME];
    return {
      type: 'snapshot',
      canvas: this.venue.canvas,
      sensorPerCell: { x: SENSOR_PER_CELL_X, y: SENSOR_PER_CELL_Y },
      reservedTopRows: RESERVED_TOP_ROWS,
      restartBtnBoardCells: RESTART_BTN_BOARD_CELLS,
      phase: this.phase,
      faces: allFaceNames.map(name => {
        const f = this.venue.faces.find(x => x.name === name);
        if (!f) return null;
        const { width, height } = faceCanvasSize(f);
        const { cellW, cellH } = chipPx(f);
        const fm = this.faceMap.get(name);
        return {
          name,
          originX: f.originX, originY: f.originY,
          width, height,
          cellPxW: cellW, cellPxH: cellH,
          colCount: f.colCount, rowCount: f.rowCount,
          boardCols: fm?.boardCols ?? 0,
          boardRows: fm?.boardRows ?? 0,
          isBoard: !!fm,
          isFloor: name === FLOOR_FACE_NAME,
          reservedSide: fm?.reservedSide ?? null,
          reservedDepth: fm?.reservedDepth ?? 0,
        };
      }).filter(Boolean),
      cells: this.cells.map(c => this._publicCell(c)),
      lockedCellId: this.lockedCellId,
      mineCount: this.mineCount,
      flaggedCount: this._countFlagged(),
      revealedCount: this.revealedCount,
      gameOver: this.gameOver,
      won: this.won,
      gameStartMs: this.gameStartMs,
      gameEndMs: this.gameEndMs,
      pausedAt: this.pausedAt,
      pauseBtnRows: { min: PAUSE_BTN_CHIP_ROW_MIN, max: PAUSE_BTN_CHIP_ROW_MAX },
      bombCellId: this.bombCellId,
      redWave: this.redWave,
    };
  }

  _publicCell(c) {
    return {
      id: c.id,
      faceName: c.faceName,
      col: c.col,
      row: c.row,
      revealed: c.revealed,
      flagged: c.flagged,
      adjacent: c.revealed ? c.adjacent : null,
      mine: (this.gameOver && c.mine) ? true : false,
    };
  }

  _countFlagged() {
    let n = 0;
    for (const c of this.cells) if (c.flagged) n++;
    return n;
  }

  handleTouch(faceName, sensorCol, sensorRow) {
    if (faceName === ENTRANCE_FACE_NAME) return;

    // idle: only Floor center button → start game
    if (this.phase === 'idle') {
      if (faceName === FLOOR_FACE_NAME && this._isCenterButton(sensorCol, sensorRow)) {
        this._startGame();
        this._emit({ type: 'game-start', snapshot: this.snapshot() });
      }
      return;
    }

    // gameOver: only Floor center button → reset to IDLE (不再 auto-start;玩家要主動再按開始)
    if (this.phase === 'gameOver') {
      if (faceName === FLOOR_FACE_NAME && this._isCenterButton(sensorCol, sensorRow)) {
        this._reset();
        this._emit({ type: 'reset', snapshot: this.snapshot() });
      }
      return;
    }

    // paused: 左半 = resume / 右半 = abort (回 idle);其他面 / 其他位置忽略
    if (this.phase === 'paused') {
      if (faceName === FLOOR_FACE_NAME) {
        const floorMeta = this.venue.faces.find(f => f.name === FLOOR_FACE_NAME);
        const isLeft = sensorCol < floorMeta.colCount / 2;
        if (isLeft) {
          this._resumeGame();
          this._emit({ type: 'resume', snapshot: this.snapshot() });
        } else {
          this._reset();
          this._emit({ type: 'reset', snapshot: this.snapshot() });
        }
      }
      return;
    }

    // playing phase
    if (faceName === FLOOR_FACE_NAME) {
      // 優先檢查 PAUSE 按鈕(底部中央 3 board cells × 3)
      if (this._isPauseButton(sensorCol, sensorRow)) {
        this._pauseGame();
        this._emit({ type: 'pause', snapshot: this.snapshot() });
        return;
      }
      const floorMeta = this.venue.faces.find(f => f.name === FLOOR_FACE_NAME);
      const isLeft = sensorCol < floorMeta.colCount / 2;
      this._applyMode(isLeft ? 'flag' : 'reveal');
      return;
    }

    if (BOARD_FACE_NAMES.includes(faceName)) {
      const cellId = sensorToBoardId(faceName, sensorCol, sensorRow, this.faceMap);
      if (cellId == null) return; // reserved row or out of bounds
      this._setLocked(cellId);
    }
  }

  _isPauseButton(sensorCol, sensorRow) {
    const floorMeta = this.venue.faces.find(f => f.name === FLOOR_FACE_NAME);
    if (!floorMeta) return false;
    const cxChip = Math.floor(floorMeta.colCount / 2);
    const halfW = (RESTART_BTN_BOARD_CELLS * SENSOR_PER_CELL_X) / 2; // = 3
    return sensorCol >= cxChip - halfW && sensorCol < cxChip + halfW &&
           sensorRow >= PAUSE_BTN_CHIP_ROW_MIN && sensorRow < PAUSE_BTN_CHIP_ROW_MAX;
  }

  _isCenterButton(sensorCol, sensorRow) {
    const floorMeta = this.venue.faces.find(f => f.name === FLOOR_FACE_NAME);
    if (!floorMeta) return false;
    const cxChip = Math.floor(floorMeta.colCount / 2);
    const cyChip = Math.floor(floorMeta.rowCount / 2);
    const halfW = (RESTART_BTN_BOARD_CELLS * SENSOR_PER_CELL_X) / 2;
    const halfH = (RESTART_BTN_BOARD_CELLS * SENSOR_PER_CELL_Y) / 2;
    return sensorCol >= cxChip - halfW && sensorCol < cxChip + halfW &&
           sensorRow >= cyChip - halfH && sensorRow < cyChip + halfH;
  }

  _setLocked(cellId) {
    if (this.cells[cellId].revealed) {
      this._clearLocked();
      return;
    }
    this.lockedCellId = cellId;
    if (this._lockTimer) clearTimeout(this._lockTimer);
    this._lockTimer = setTimeout(() => this._clearLocked(), LOCK_TIMEOUT_MS);
    this._emit({ type: 'lock', cellId, lockTimeoutMs: LOCK_TIMEOUT_MS });
  }

  _clearLocked() {
    if (this._lockTimer) { clearTimeout(this._lockTimer); this._lockTimer = null; }
    if (this.lockedCellId == null) return;
    this.lockedCellId = null;
    this._emit({ type: 'unlock' });
  }

  _applyMode(mode) {
    const id = this.lockedCellId;
    if (id == null) {
      this._emit({ type: 'mode-feedback', mode, accepted: false });
      return;
    }
    const cell = this.cells[id];
    this._emit({ type: 'mode-feedback', mode, accepted: true, cellId: id });

    if (mode === 'flag') {
      if (cell.revealed) { this._clearLocked(); return; }
      cell.flagged = !cell.flagged;
      this._emit({ type: 'cell-update', cells: [this._publicCell(cell)], flaggedCount: this._countFlagged() });
      this._clearLocked();
    } else if (mode === 'reveal') {
      if (cell.revealed || cell.flagged) { this._clearLocked(); return; }
      // 第一次揭露保護:確保第一次踩的格 + 8 鄰居都不是地雷(經典踩地雷規則)
      if (this.revealedCount === 0) this._ensureFirstRevealSafe(cell);
      if (cell.mine) {
        this._handleMineHit(cell);
        return;
      }
      const updated = this._floodReveal(cell);
      this._emit({ type: 'cell-update', cells: updated.map(c => this._publicCell(c)), revealedCount: this.revealedCount });
      this._clearLocked();
      if (this.revealedCount === this.total - this.mineCount) this._handleWin();
    }
  }

  _ensureFirstRevealSafe(targetCell) {
    // 把 target + 鄰居中的雷搬到安全區外(剩下非雷格中隨機選)
    const safeIds = new Set([targetCell.id, ...targetCell.neighbors]);
    const minesToMove = [...safeIds].filter(id => this.cells[id].mine);
    if (minesToMove.length === 0) return;
    const candidates = this.cells.filter(c => !c.mine && !safeIds.has(c.id)).map(c => c.id);
    if (candidates.length < minesToMove.length) return; // 安全格不夠搬,放棄
    for (const mineId of minesToMove) {
      const idx = Math.floor(Math.random() * candidates.length);
      const swapId = candidates.splice(idx, 1)[0];
      this.cells[mineId].mine = false;
      this.cells[swapId].mine = true;
    }
    // 重算所有 adjacent
    for (const c of this.cells) {
      c.adjacent = c.neighbors.filter(nid => this.cells[nid].mine).length;
    }
  }

  _floodReveal(startCell) {
    const updated = [];
    const queue = [startCell];
    const seen = new Set([startCell.id]);
    while (queue.length) {
      const c = queue.shift();
      if (c.revealed || c.flagged) continue;
      c.revealed = true;
      this.revealedCount++;
      updated.push(c);
      if (c.adjacent === 0) {
        for (const nid of c.neighbors) {
          if (!seen.has(nid)) {
            const n = this.cells[nid];
            if (!n.mine && !n.revealed && !n.flagged) { queue.push(n); seen.add(nid); }
          }
        }
      }
    }
    return updated;
  }

  _handleMineHit(cell) {
    this.phase = 'gameOver';
    this.gameOver = true;
    this.won = false;
    this.gameEndMs = Date.now();
    cell.revealed = true;
    this.bombCellId = cell.id;
    this._clearLocked();

    // 紅波依「畫布空間距離」擴散,涵蓋全部面區域(包括 HUD reserved / Floor / Entrance,
    // 不只 game cells —— 不然 HUD 留白看起來像紅波沒蓋完)
    const CELL_PX = 64;
    const bombFace = this.venue.faces.find(f => f.name === cell.faceName);
    const bx = bombFace.originX + (cell.col + 0.5) * CELL_PX;
    const by = bombFace.originY + (cell.row + 0.5) * CELL_PX;

    const wave = [];
    for (const face of this.venue.faces) {
      const facCols = Math.floor(face.colCount / SENSOR_PER_CELL_X);
      const facRows = Math.floor(face.rowCount / SENSOR_PER_CELL_Y);
      const fm = this.faceMap.get(face.name); // null for Floor/Entrance
      for (let c = 0; c < facCols; c++) {
        for (let r = 0; r < facRows; r++) {
          const cx = face.originX + (c + 0.5) * CELL_PX;
          const cy = face.originY + (r + 0.5) * CELL_PX;
          wave.push({
            faceName: face.name,
            col: c, row: r,
            dist: Math.hypot(cx - bx, cy - by),
            cellId: fm?.grid?.[c]?.[r] ?? null, // null for reserved / non-board faces
          });
        }
      }
    }
    wave.sort((a, b) => a.dist - b.dist);
    this.redWave = wave;
    this._emit({
      type: 'game-over', won: false,
      hitCellId: cell.id, redWave: wave,
      snapshot: this.snapshot(),
    });
    // no auto-reset; wait for Floor restart-button press
  }

  _handleWin() {
    this.phase = 'gameOver';
    this.gameOver = true;
    this.won = true;
    this.gameEndMs = Date.now();
    this._emit({ type: 'game-over', won: true, snapshot: this.snapshot() });
    // no auto-reset; wait for Floor restart-button press
  }

  reset() {
    this._reset();
    this._emit({ type: 'reset', snapshot: this.snapshot() });
  }
}
