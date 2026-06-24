import {
  buildBoard, sensorToBoardId, faceCanvasSize, chipPx,
  BOARD_FACE_NAMES, FLOOR_FACE_NAME, ENTRANCE_FACE_NAME,
  SENSOR_PER_CELL_X, SENSOR_PER_CELL_Y, RESERVED_TOP_ROWS,
} from './board.js';

// ── Floor button geometry (venue px) ───────────────────────
// Donut layout — inner circle = SCAN (reveal) / outer ring = MARK (flag) /
// pause stays as its own square box below center. Circles are computed
// against chip-center venue px so a player approaching the floor from
// any of the four walls hits the ring first (MARK), inner circle if they
// step right to the middle (SCAN).
//
// SCAN_R          inner circle radius (also used for CENTER start/reset
//                 button and paused RESUME slot)
// MARK_R          outer ring outer radius (paused ABORT slot uses the
//                 same ring)
const FLOOR_CHIP_W = 32;    // chip width  in venue px (Floor orientation)
const FLOOR_CHIP_H = 16;    // chip height in venue px
const FLOOR_W      = 1408;  // Floor face width   in venue px
const FLOOR_H      = 2048;  // Floor face height  in venue px
const FLOOR_CX     = FLOOR_W / 2;  // 704
const FLOOR_CY     = FLOOR_H / 2;  // 1024
const SCAN_R       = 130;   // inner SCAN circle (also CENTER start/reset, paused RESUME)
const MARK_R       = 320;   // outer MARK ring  (also paused ABORT)

// Pause button — separate square box, well clear of the donut
const PAUSE_COL_MIN = 19, PAUSE_COL_MAX = 25;
const PAUSE_ROW_MIN = 104, PAUSE_ROW_MAX = 116;

// Mine freeze: how long input is blocked after stepping on a mine.
const MINE_FREEZE_MS = 5000;

// 3 board cells × 3 board cells — legacy snapshot field for older views.
const RESTART_BTN_BOARD_CELLS = 3;

function chipCenterPx(sensorCol, sensorRow) {
  return [sensorCol * FLOOR_CHIP_W + FLOOR_CHIP_W / 2,
          sensorRow * FLOOR_CHIP_H + FLOOR_CHIP_H / 2];
}

function distFromFloorCenter(sensorCol, sensorRow) {
  const [x, y] = chipCenterPx(sensorCol, sensorRow);
  return Math.hypot(x - FLOOR_CX, y - FLOOR_CY);
}

function inPauseBox(col, row) {
  return col >= PAUSE_COL_MIN && col < PAUSE_COL_MAX &&
         row >= PAUSE_ROW_MIN && row < PAUSE_ROW_MAX;
}

const FLOOR_BUTTONS = {
  // inner circle — START / RESET (idle, gameOver), SCAN (playing), RESUME (paused)
  center: { x: FLOOR_CX, y: FLOOR_CY, r: SCAN_R },
  // outer ring — MARK (playing), ABORT (paused)
  outer:  { x: FLOOR_CX, y: FLOOR_CY, rIn: SCAN_R, rOut: MARK_R },
  // pause — square box, playing only
  pause:  { colMin: PAUSE_COL_MIN, colMax: PAUSE_COL_MAX, rowMin: PAUSE_ROW_MIN, rowMax: PAUSE_ROW_MAX },
};

export class Game {
  constructor(venue, topology, options = {}) {
    this.venue = venue;
    this.topology = topology;
    this.options = options;
    this.listeners = new Set();
    // Time-limit setting persists across game resets (operator configures once
    // and re-uses for multiple plays). Default: disabled.
    this.timeLimit = { enabled: false, ms: 10 * 60 * 1000 };
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
    this.phase = 'idle';        // 'idle' | 'playing' | 'paused' | 'gameOver'
    this.gameOver = false;
    this.won = false;
    this.endReason = null;      // 'win' | 'timeout' | null
    this.revealedCount = 0;
    this.gameStartMs = null;
    this.gameEndMs = null;
    this.pausedAt = null;
    this.bombCellId = null;     // last mine stepped on (for UI highlight)
    this.redWave = null;
    this.freezeUntil = null;    // timestamp; input is blocked when Date.now() < freezeUntil
    this.currentMode = 'reveal';
    this._timeLimitTimer = null;
    this._timeLimitRemaining = null;
    this._freezeTimer = null;
  }

  _clearTimers() {
    if (this._timeLimitTimer) { clearTimeout(this._timeLimitTimer); this._timeLimitTimer = null; }
    if (this._freezeTimer)    { clearTimeout(this._freezeTimer);    this._freezeTimer = null; }
  }

  setTimeLimit({ enabled, ms }) {
    const e = !!enabled;
    const m = Math.max(1, Math.floor(Number(ms) || 0));
    this.timeLimit = { enabled: e, ms: m };
    this._emit({ type: 'time-limit', timeLimit: this.timeLimit });
  }

  _startGame() {
    this.phase = 'playing';
    this.gameOver = false;
    this.won = false;
    this.endReason = null;
    this.gameStartMs = Date.now();
    this.gameEndMs = null;
    this.pausedAt = null;
    this.freezeUntil = null;
    this._timeLimitRemaining = null;
    if (this.timeLimit.enabled) {
      this._timeLimitTimer = setTimeout(() => this._handleTimeout(), this.timeLimit.ms);
    }
  }

  _pauseGame() {
    if (this.phase !== 'playing') return;
    // freeze during pause clears (operator chose to pause anyway)
    if (this._freezeTimer) { clearTimeout(this._freezeTimer); this._freezeTimer = null; }
    this.freezeUntil = null;
    this.phase = 'paused';
    this.pausedAt = Date.now();
    // Stash remaining time so resume can re-arm
    if (this._timeLimitTimer) {
      const elapsed = this.pausedAt - this.gameStartMs;
      this._timeLimitRemaining = Math.max(0, this.timeLimit.ms - elapsed);
      clearTimeout(this._timeLimitTimer);
      this._timeLimitTimer = null;
    }
  }

  _resumeGame() {
    if (this.phase !== 'paused') return;
    const pausedDuration = Date.now() - this.pausedAt;
    this.gameStartMs += pausedDuration;
    this.pausedAt = null;
    this.phase = 'playing';
    if (this.timeLimit.enabled && this._timeLimitRemaining != null) {
      this._timeLimitTimer = setTimeout(() => this._handleTimeout(), this._timeLimitRemaining);
      this._timeLimitRemaining = null;
    }
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
      currentMode: this.currentMode,
      floorButtons: FLOOR_BUTTONS,
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
      lockedCellId: null, // legacy field
      mineCount: this.mineCount,
      flaggedCount: this._countFlagged(),
      revealedCount: this.revealedCount,
      gameOver: this.gameOver,
      won: this.won,
      endReason: this.endReason,
      gameStartMs: this.gameStartMs,
      gameEndMs: this.gameEndMs,
      pausedAt: this.pausedAt,
      freezeUntil: this.freezeUntil,
      freezeDurationMs: MINE_FREEZE_MS,
      timeLimit: this.timeLimit,
      pauseBtnRows: { min: PAUSE_ROW_MIN, max: PAUSE_ROW_MAX }, // legacy
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
      // reveal mine identity on revealed mines OR when gameOver
      mine: ((c.revealed || this.gameOver) && c.mine) ? true : false,
    };
  }

  _countFlagged() {
    let n = 0;
    for (const c of this.cells) if (c.flagged) n++;
    return n;
  }

  // ── Floor hit-test helpers ─────────────────────────────────
  _inCenterCircle(col, row) {
    return col >= 0 && row >= 0 && distFromFloorCenter(col, row) <= SCAN_R;
  }
  _inOuterRing(col, row) {
    if (col < 0 || row < 0) return false;
    const d = distFromFloorCenter(col, row);
    return d > SCAN_R && d <= MARK_R;
  }

  handleTouch(faceName, sensorCol, sensorRow) {
    if (faceName === ENTRANCE_FACE_NAME) return;

    // Mine-freeze: block all inputs while frozen
    if (this.freezeUntil != null && Date.now() < this.freezeUntil) return;

    // idle: inner circle → start
    if (this.phase === 'idle') {
      if (faceName === FLOOR_FACE_NAME && this._inCenterCircle(sensorCol, sensorRow)) {
        this._startGame();
        this._emit({ type: 'game-start', snapshot: this.snapshot() });
      }
      return;
    }

    // gameOver: inner circle → reset to idle
    if (this.phase === 'gameOver') {
      if (faceName === FLOOR_FACE_NAME && this._inCenterCircle(sensorCol, sensorRow)) {
        this._clearTimers();
        this._reset();
        this._emit({ type: 'reset', snapshot: this.snapshot() });
      }
      return;
    }

    // paused: inner → resume / outer ring → abort
    if (this.phase === 'paused') {
      if (faceName !== FLOOR_FACE_NAME) return;
      if (this._inCenterCircle(sensorCol, sensorRow)) {
        this._resumeGame();
        this._emit({ type: 'resume', snapshot: this.snapshot() });
      } else if (this._inOuterRing(sensorCol, sensorRow)) {
        this._clearTimers();
        this._reset();
        this._emit({ type: 'reset', snapshot: this.snapshot() });
      }
      return;
    }

    // playing
    if (faceName === FLOOR_FACE_NAME) {
      if (inPauseBox(sensorCol, sensorRow)) {
        this._pauseGame();
        this._emit({ type: 'pause', snapshot: this.snapshot() });
        return;
      }
      if (this._inCenterCircle(sensorCol, sensorRow)) {
        this._setMode('reveal');
        return;
      }
      if (this._inOuterRing(sensorCol, sensorRow)) {
        this._setMode('flag');
        return;
      }
      return; // inert space
    }

    if (BOARD_FACE_NAMES.includes(faceName)) {
      const cellId = sensorToBoardId(faceName, sensorCol, sensorRow, this.faceMap);
      if (cellId == null) return;
      this._applyModeToCell(cellId);
    }
  }

  _setMode(mode) {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    this._emit({ type: 'mode-change', mode });
  }

  _applyModeToCell(cellId) {
    const cell = this.cells[cellId];
    const mode = this.currentMode;
    if (mode === 'flag') {
      if (cell.revealed) return;
      cell.flagged = !cell.flagged;
      this._emit({ type: 'cell-update', cells: [this._publicCell(cell)], flaggedCount: this._countFlagged() });
    } else if (mode === 'reveal') {
      if (cell.revealed || cell.flagged) return;
      if (this.revealedCount === 0) this._ensureFirstRevealSafe(cell);
      if (cell.mine) {
        this._handleMineFreeze(cell);
        return;
      }
      const updated = this._floodReveal(cell);
      this._emit({ type: 'cell-update', cells: updated.map(c => this._publicCell(c)), revealedCount: this.revealedCount });
      if (this.revealedCount === this.total - this.mineCount) this._handleWin();
    }
  }

  _ensureFirstRevealSafe(targetCell) {
    const safeIds = new Set([targetCell.id, ...targetCell.neighbors]);
    const minesToMove = [...safeIds].filter(id => this.cells[id].mine);
    if (minesToMove.length === 0) return;
    const candidates = this.cells.filter(c => !c.mine && !safeIds.has(c.id)).map(c => c.id);
    if (candidates.length < minesToMove.length) return;
    for (const mineId of minesToMove) {
      const idx = Math.floor(Math.random() * candidates.length);
      const swapId = candidates.splice(idx, 1)[0];
      this.cells[mineId].mine = false;
      this.cells[swapId].mine = true;
    }
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

  // Mine = freeze 5s, no game over. Game continues until win or timeout.
  _handleMineFreeze(cell) {
    cell.revealed = true;
    this.bombCellId = cell.id;
    this.freezeUntil = Date.now() + MINE_FREEZE_MS;
    if (this._freezeTimer) clearTimeout(this._freezeTimer);
    // After freeze: clear `freezeUntil` so the next input gates check passes;
    // emit so view can dismiss the freeze overlay even though we already know
    // the timestamp.
    this._freezeTimer = setTimeout(() => {
      this._freezeTimer = null;
      this.freezeUntil = null;
      this._emit({ type: 'unfreeze' });
    }, MINE_FREEZE_MS);
    this._emit({
      type: 'freeze',
      freezeUntil: this.freezeUntil,
      durationMs: MINE_FREEZE_MS,
      cells: [this._publicCell(cell)],
      bombCellId: cell.id,
    });
  }

  _handleWin() {
    this._clearTimers();
    this.phase = 'gameOver';
    this.gameOver = true;
    this.won = true;
    this.endReason = 'win';
    this.gameEndMs = Date.now();
    this._emit({ type: 'game-over', won: true, reason: 'win', snapshot: this.snapshot() });
  }

  _handleTimeout() {
    if (this.phase !== 'playing') return;
    this._clearTimers();
    this.phase = 'gameOver';
    this.gameOver = true;
    this.won = false;
    this.endReason = 'timeout';
    this.gameEndMs = Date.now();
    this.freezeUntil = null;

    // Build redWave from floor center outward so the wave radiates from the
    // ground up — symbolises "time itself" running out, not a specific mine.
    const CELL_PX = 64;
    const bx = this.venue.faces.find(f => f.name === FLOOR_FACE_NAME).originX + FLOOR_CX;
    const by = this.venue.faces.find(f => f.name === FLOOR_FACE_NAME).originY + FLOOR_CY;
    const wave = [];
    for (const face of this.venue.faces) {
      const facCols = Math.floor(face.colCount / SENSOR_PER_CELL_X);
      const facRows = Math.floor(face.rowCount / SENSOR_PER_CELL_Y);
      const fm = this.faceMap.get(face.name);
      for (let c = 0; c < facCols; c++) {
        for (let r = 0; r < facRows; r++) {
          const cx = face.originX + (c + 0.5) * CELL_PX;
          const cy = face.originY + (r + 0.5) * CELL_PX;
          wave.push({
            faceName: face.name,
            col: c, row: r,
            dist: Math.hypot(cx - bx, cy - by),
            cellId: fm?.grid?.[c]?.[r] ?? null,
          });
        }
      }
    }
    wave.sort((a, b) => a.dist - b.dist);
    this.redWave = wave;
    this._emit({
      type: 'game-over', won: false, reason: 'timeout',
      redWave: wave,
      snapshot: this.snapshot(),
    });
  }

  reset() {
    this._clearTimers();
    this._reset();
    this._emit({ type: 'reset', snapshot: this.snapshot() });
  }
}
