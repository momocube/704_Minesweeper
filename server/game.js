import {
  buildBoard, sensorToBoardId, faceCanvasSize, chipPx,
  BOARD_FACE_NAMES, FLOOR_FACE_NAME, ENTRANCE_FACE_NAME,
  SENSOR_PER_CELL_X, SENSOR_PER_CELL_Y, RESERVED_TOP_ROWS,
} from './board.js';

// ── Floor button layout (chip coords) ──────────────────────
// All buttons are 6 chip cols × 12 chip rows = 192×192 venue px.
// The main row band (rows 58..69) is shared between phases: in playing it
// hosts MARK + SCAN, in idle/gameOver it hosts a single CENTER button
// (start / restart), and in paused it hosts RESUME (mark slot) + ABORT
// (scan slot). PAUSE sits in its own band (rows 104..115) so it never
// collides with the main row.
const BTN_ROW_MIN = 58,  BTN_ROW_MAX = 70;     // main row band
const PAUSE_ROW_MIN = 104, PAUSE_ROW_MAX = 116;
const CENTER_COL_MIN = 19, CENTER_COL_MAX = 25; // START / RESET / PAUSE share
const MARK_COL_MIN   = 13, MARK_COL_MAX   = 19; // MARK (playing) / RESUME (paused)
const SCAN_COL_MIN   = 25, SCAN_COL_MAX   = 31; // SCAN (playing) / ABORT (paused)

function inBox(col, row, colMin, colMax, rowMin, rowMax) {
  return col >= colMin && col < colMax && row >= rowMin && row < rowMax;
}

const FLOOR_BUTTONS = {
  center: { colMin: CENTER_COL_MIN, colMax: CENTER_COL_MAX, rowMin: BTN_ROW_MIN,   rowMax: BTN_ROW_MAX },
  mark:   { colMin: MARK_COL_MIN,   colMax: MARK_COL_MAX,   rowMin: BTN_ROW_MIN,   rowMax: BTN_ROW_MAX },
  scan:   { colMin: SCAN_COL_MIN,   colMax: SCAN_COL_MAX,   rowMin: BTN_ROW_MIN,   rowMax: BTN_ROW_MAX },
  pause:  { colMin: CENTER_COL_MIN, colMax: CENTER_COL_MAX, rowMin: PAUSE_ROW_MIN, rowMax: PAUSE_ROW_MAX },
};

// 3 board cells × 3 board cells for views that still want a single legacy size.
const RESTART_BTN_BOARD_CELLS = 3;

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
    this.phase = 'idle';        // 'idle' | 'playing' | 'paused' | 'gameOver'
    this.gameOver = false;      // mirrors phase === 'gameOver'
    this.won = false;
    this.revealedCount = 0;
    this.gameStartMs = null;
    this.gameEndMs = null;
    this.pausedAt = null;
    this.bombCellId = null;
    this.redWave = null;
    // Persistent input mode — replaces the old lock-then-confirm flow.
    // Default to 'reveal' so a freshly started game responds to wall touches
    // immediately (first-click safety still protects the first reveal).
    this.currentMode = 'reveal';
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
  }

  _resumeGame() {
    if (this.phase !== 'paused') return;
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
      // legacy field kept null for views/wall.js / views/floor.js / views/all.js
      // which still reference it; new view ignores it
      lockedCellId: null,
      mineCount: this.mineCount,
      flaggedCount: this._countFlagged(),
      revealedCount: this.revealedCount,
      gameOver: this.gameOver,
      won: this.won,
      gameStartMs: this.gameStartMs,
      gameEndMs: this.gameEndMs,
      pausedAt: this.pausedAt,
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

    // idle: only Floor CENTER → start game
    if (this.phase === 'idle') {
      if (faceName === FLOOR_FACE_NAME && this._inBtn('center', sensorCol, sensorRow)) {
        this._startGame();
        this._emit({ type: 'game-start', snapshot: this.snapshot() });
      }
      return;
    }

    // gameOver: only Floor CENTER → reset to idle (玩家要再按一次開始才開新局)
    if (this.phase === 'gameOver') {
      if (faceName === FLOOR_FACE_NAME && this._inBtn('center', sensorCol, sensorRow)) {
        this._reset();
        this._emit({ type: 'reset', snapshot: this.snapshot() });
      }
      return;
    }

    // paused: MARK slot = resume / SCAN slot = abort
    if (this.phase === 'paused') {
      if (faceName !== FLOOR_FACE_NAME) return;
      if (this._inBtn('mark', sensorCol, sensorRow)) {
        this._resumeGame();
        this._emit({ type: 'resume', snapshot: this.snapshot() });
      } else if (this._inBtn('scan', sensorCol, sensorRow)) {
        this._reset();
        this._emit({ type: 'reset', snapshot: this.snapshot() });
      }
      return;
    }

    // playing
    if (faceName === FLOOR_FACE_NAME) {
      // PAUSE sits in its own row band, check first
      if (this._inBtn('pause', sensorCol, sensorRow)) {
        this._pauseGame();
        this._emit({ type: 'pause', snapshot: this.snapshot() });
        return;
      }
      if (this._inBtn('mark', sensorCol, sensorRow)) {
        this._setMode('flag');
        return;
      }
      if (this._inBtn('scan', sensorCol, sensorRow)) {
        this._setMode('reveal');
        return;
      }
      // Outside button areas — ignore (floor is otherwise inert during play)
      return;
    }

    if (BOARD_FACE_NAMES.includes(faceName)) {
      const cellId = sensorToBoardId(faceName, sensorCol, sensorRow, this.faceMap);
      if (cellId == null) return; // reserved row or out of bounds
      this._applyModeToCell(cellId);
    }
  }

  _inBtn(name, col, row) {
    const b = FLOOR_BUTTONS[name];
    return inBox(col, row, b.colMin, b.colMax, b.rowMin, b.rowMax);
  }

  _setMode(mode) {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    // Small delta — view just needs to flip the highlighted button. Avoid
    // resending the full snapshot for what is a 1-field change.
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
        this._handleMineHit(cell);
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

  _handleMineHit(cell) {
    this.phase = 'gameOver';
    this.gameOver = true;
    this.won = false;
    this.gameEndMs = Date.now();
    cell.revealed = true;
    this.bombCellId = cell.id;

    const CELL_PX = 64;
    const bombFace = this.venue.faces.find(f => f.name === cell.faceName);
    const bx = bombFace.originX + (cell.col + 0.5) * CELL_PX;
    const by = bombFace.originY + (cell.row + 0.5) * CELL_PX;

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
      type: 'game-over', won: false,
      hitCellId: cell.id, redWave: wave,
      snapshot: this.snapshot(),
    });
  }

  _handleWin() {
    this.phase = 'gameOver';
    this.gameOver = true;
    this.won = true;
    this.gameEndMs = Date.now();
    this._emit({ type: 'game-over', won: true, snapshot: this.snapshot() });
  }

  reset() {
    this._reset();
    this._emit({ type: 'reset', snapshot: this.snapshot() });
  }
}
