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
// MARK_R          outer ring outer radius
const FLOOR_CHIP_W = 32;    // chip width  in venue px (Floor orientation)
const FLOOR_CHIP_H = 16;    // chip height in venue px
const FLOOR_W      = 1408;  // Floor face width   in venue px
const FLOOR_H      = 2048;  // Floor face height  in venue px
const FLOOR_CX     = FLOOR_W / 2;  // 704
const FLOOR_CY     = FLOOR_H / 2;  // 1024
const SCAN_R       = 210;   // inner SCAN circle (also CENTER start/reset, paused RESUME)
const MARK_R       = 290;   // outer MARK ring — ring width 80

// Pause button — separate square box, moved closer to the donut while keeping
// a clear gap below the MARK ring.
const PAUSE_COL_MIN = 19, PAUSE_COL_MAX = 25;
const PAUSE_ROW_MIN = 84, PAUSE_ROW_MAX = 96;

// Mine freeze: how long input is blocked after stepping on a mine.
const MINE_FREEZE_MS = 5000;
const START_COUNTDOWN_SECONDS = 3;
const INTRO_DURATION_MS = 10000;
const OPERATOR_TRANSITION_MS = 4000;
const TUTORIAL_TRANSITION_MS = 6000;
const RED_WAVE_DURATION_MS = 1800;
const ENDING_SETTLE_MS = 400;
const WIN_ENDING_DURATION_MS = 6200;
const TIMEOUT_ENDING_DURATION_MS = 6200;

// 3 board cells × 3 board cells — legacy snapshot field for older views.
const RESTART_BTN_BOARD_CELLS = 3;

// The original venue flow uses a physical mine-shaped trigger on Wall Left.
// Keep its position in board-cell units so every view can render and hit-test
// the same button without inventing a separate coordinate system.
const WALL_LEFT_MINE_BUTTON = {
  faceName: 'Wall Left',
  col: 4,
  row: 15,
  cols: 3,
  rows: 3,
};

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
  // inner circle — PLAY/RESET (ready, gameOver), SCAN (playing), RESUME (paused)
  center: { x: FLOOR_CX, y: FLOOR_CY, r: SCAN_R },
  // outer ring — MARK (playing)
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
    this._idleEchoSeq = 0;
    // Operator settings persist across game resets (configure once, reuse for rounds).
    this.timeLimit = { enabled: false, ms: 10 * 60 * 1000 };
    // Tutorial is enabled by default. When enabled, PLAY enters a four-step tutorial;
    // only the second PLAY after the tutorial starts the actual game clock.
    this.tutorialEnabled = true;
    this._reset();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(msg) {
    const withClock = msg.serverNowMs == null
      ? { ...msg, serverNowMs: Date.now() }
      : msg;
    for (const fn of this.listeners) fn(withClock);
  }

  _reset() {
    const built = buildBoard(this.venue, this.topology, this.options);
    this.cells = built.cells;
    this.faceMap = built.faceMap;
    this.mineCount = built.mineCount;
    this.total = built.total;
    const wallLeft = this.venue.faces.find(f => f.name === 'Wall Left');
    const floor = this.venue.faces.find(f => f.name === FLOOR_FACE_NAME);
    const wallLeftSize = wallLeft ? faceCanvasSize(wallLeft) : this.venue.canvas;
    const floorSize = floor ? faceCanvasSize(floor) : this.venue.canvas;
    this.startButton = wallLeft ? this._buildStartButton(wallLeft, wallLeftSize) : null;
    this.animationOrigins = {
      intro: this.startButton ? {
        faceName: this.startButton.faceName,
        x: this.startButton.x,
        y: this.startButton.y,
      } : {
        faceName: null,
        x: this.venue.canvas.width / 2,
        y: this.venue.canvas.height / 2,
      },
      timeout: floor ? {
        faceName: floor.name,
        x: floor.originX + floorSize.width / 2,
        y: floor.originY + floorSize.height / 2,
      } : {
        faceName: null,
        x: this.venue.canvas.width / 2,
        y: this.venue.canvas.height / 2,
      },
    };
    this.phase = 'idle';        // 'idle' | 'armed' | 'intro' | 'ready' | 'tutorial' | 'tutorialReady' | 'countdown' | 'playing' | 'paused' | 'gameOver'
    this.tutorialStep = null;   // 0..3 only while phase === 'tutorial'
    this.countdownValue = null; // 3..1 only while phase === 'countdown'
    this.introStartedAt = null;
    this.introDurationMs = Math.max(1, Number(this.options.introDurationMs) || INTRO_DURATION_MS);
    this.operatorTransitionStartedAt = null;
    this.operatorTransitionDurationMs = Math.max(
      1, Number(this.options.operatorTransitionDurationMs) || OPERATOR_TRANSITION_MS,
    );
    this.tutorialTransitionStartedAt = null;
    this.tutorialTransitionDurationMs = Math.max(
      1, Number(this.options.tutorialTransitionDurationMs) || TUTORIAL_TRANSITION_MS,
    );
    this.gameOver = false;
    this.won = false;
    this.endReason = null;      // 'win' | 'timeout' | 'operator' | null
    this.revealedCount = 0;
    this.lastRevealCellId = null;
    this.gameStartMs = null;
    this.gameEndMs = null;
    this.endingStartedAt = null;
    this.endActionAt = null;
    this.endStage = null;       // 'win-ending' | 'timeout-wave' | 'timeout-ending' | 'operator-ending' | null
    this.pausedAt = null;
    this.bombCellId = null;     // last mine stepped on (for UI highlight)
    this.redWave = null;
    this.redWaveStartedAt = null;
    this.freezeUntil = null;    // timestamp; input is blocked when Date.now() < freezeUntil
    this.currentMode = 'reveal';
    this._timeLimitTimer = null;
    this._timeLimitRemaining = null;
    this._freezeTimer = null;
    this._countdownTimer = null;
    this._introTimer = null;
    this._operatorTransitionTimer = null;
    this._tutorialTransitionTimer = null;
  }

  _buildStartButton(face, size) {
    const boardCols = Math.max(1, Math.floor(face.colCount / SENSOR_PER_CELL_X));
    const boardRows = Math.max(1, Math.floor(face.rowCount / SENSOR_PER_CELL_Y));
    const cols = Math.min(WALL_LEFT_MINE_BUTTON.cols, boardCols);
    const rows = Math.min(WALL_LEFT_MINE_BUTTON.rows, boardRows);
    const col = Math.min(WALL_LEFT_MINE_BUTTON.col, boardCols - cols);
    const row = Math.min(WALL_LEFT_MINE_BUTTON.row, boardRows - rows);
    const cellW = size.width / boardCols;
    const cellH = size.height / boardRows;
    return {
      faceName: face.name,
      boardCol: col,
      boardRow: row,
      boardCols: cols,
      boardRows: rows,
      x: face.originX + (col + cols / 2) * cellW,
      y: face.originY + (row + rows / 2) * cellH,
      width: cols * cellW,
      height: rows * cellH,
      sensorColMin: col * SENSOR_PER_CELL_X,
      sensorColMax: (col + cols) * SENSOR_PER_CELL_X,
      sensorRowMin: row * SENSOR_PER_CELL_Y,
      sensorRowMax: (row + rows) * SENSOR_PER_CELL_Y,
    };
  }

  _clearTimers() {
    if (this._timeLimitTimer) { clearTimeout(this._timeLimitTimer); this._timeLimitTimer = null; }
    if (this._freezeTimer)    { clearTimeout(this._freezeTimer);    this._freezeTimer = null; }
    if (this._countdownTimer) { clearTimeout(this._countdownTimer); this._countdownTimer = null; }
    if (this._introTimer)     { clearTimeout(this._introTimer);     this._introTimer = null; }
    if (this._operatorTransitionTimer) {
      clearTimeout(this._operatorTransitionTimer);
      this._operatorTransitionTimer = null;
    }
    if (this._tutorialTransitionTimer) {
      clearTimeout(this._tutorialTransitionTimer);
      this._tutorialTransitionTimer = null;
    }
  }

  setTimeLimit({ enabled, ms }) {
    const e = !!enabled;
    const numericMs = Number(ms);
    const m = Number.isFinite(numericMs)
      ? Math.max(1, Math.floor(numericMs))
      : 1;
    this.timeLimit = { enabled: e, ms: m };
    this._emit({ type: 'time-limit', timeLimit: this.timeLimit });
  }

  setTutorialEnabled(enabled) {
    if (this.phase !== 'idle') return false;
    this.tutorialEnabled = !!enabled;
    this._emit({
      type: 'tutorial-setting',
      tutorialEnabled: this.tutorialEnabled,
      snapshot: this.snapshot(),
    });
    return true;
  }

  // The operator arms the venue first. The player must then press the physical
  // Wall Left mine button before the presentation intro is allowed to start.
  startFromOperator() {
    if (this.phase !== 'idle') return false;
    this._clearTimers();
    this.phase = 'armed';
    this.operatorTransitionStartedAt = Date.now();
    const startedAt = this.operatorTransitionStartedAt;
    this._operatorTransitionTimer = setTimeout(() => {
      if (this.phase !== 'armed' || this.operatorTransitionStartedAt !== startedAt) return;
      this._operatorTransitionTimer = null;
      this.operatorTransitionStartedAt = null;
      this._emit({ type: 'operator-transition-complete', snapshot: this.snapshot() });
    }, this.operatorTransitionDurationMs);
    this._emit({ type: 'armed', snapshot: this.snapshot() });
    return true;
  }

  // Test/operator helper for deterministic input assertions without waiting
  // for the short post-start gradient transition.
  _completeOperatorTransition() {
    if (this.phase !== 'armed' || this.operatorTransitionStartedAt == null) return false;
    if (this._operatorTransitionTimer) {
      clearTimeout(this._operatorTransitionTimer);
      this._operatorTransitionTimer = null;
    }
    this.operatorTransitionStartedAt = null;
    return true;
  }

  _startIntro() {
    this._clearTimers();
    this.phase = 'intro';
    this.introStartedAt = Date.now();
    this.gameStartMs = null;
    this.gameEndMs = null;
    this.operatorTransitionStartedAt = null;
    this.tutorialTransitionStartedAt = null;
    this.endingStartedAt = null;
    this.endActionAt = null;
    this.endStage = null;
    this.tutorialStep = null;
    this.countdownValue = null;
    const introStartedAt = this.introStartedAt;
    this._introTimer = setTimeout(() => {
      if (this.phase !== 'intro' || this.introStartedAt !== introStartedAt) return;
      this._introTimer = null;
      this.phase = 'ready';
      this.introStartedAt = null;
      this._emit({ type: 'intro-complete', snapshot: this.snapshot() });
    }, this.introDurationMs);
  }

  // Test/operator helper for deterministic transitions without waiting for the
  // ten-second presentation animation.
  _completeIntro() {
    if (this.phase !== 'intro') return false;
    if (this._introTimer) {
      clearTimeout(this._introTimer);
      this._introTimer = null;
    }
    this.phase = 'ready';
    this.introStartedAt = null;
    this.endingStartedAt = null;
    this.endActionAt = null;
    this.endStage = null;
    this._emit({ type: 'intro-complete', snapshot: this.snapshot() });
    return true;
  }

  _startTutorial() {
    this.phase = 'tutorial';
    this.tutorialStep = 0;
    this.gameStartMs = null;
    this.gameEndMs = null;
    this.tutorialTransitionStartedAt = Date.now();
    const startedAt = this.tutorialTransitionStartedAt;
    this._tutorialTransitionTimer = setTimeout(() => {
      if (this.phase !== 'tutorial' || this.tutorialTransitionStartedAt !== startedAt) return;
      this._tutorialTransitionTimer = null;
      this.tutorialTransitionStartedAt = null;
      this._emit({ type: 'tutorial-transition-complete', snapshot: this.snapshot() });
    }, this.tutorialTransitionDurationMs);
  }

  // Test/operator helper for deterministic tutorial assertions without waiting
  // for the visual transition to finish.
  _completeTutorialTransition() {
    if (this.phase !== 'tutorial' || this.tutorialTransitionStartedAt == null) return false;
    if (this._tutorialTransitionTimer) {
      clearTimeout(this._tutorialTransitionTimer);
      this._tutorialTransitionTimer = null;
    }
    this.tutorialTransitionStartedAt = null;
    return true;
  }

  _advanceTutorial() {
    if (this.phase !== 'tutorial') return;
    if (this.tutorialStep < 3) {
      this.tutorialStep++;
      this._emit({ type: 'tutorial-step', snapshot: this.snapshot() });
    } else {
      this.phase = 'tutorialReady';
      this.tutorialStep = null;
      this._emit({ type: 'tutorial-ready', snapshot: this.snapshot() });
    }
  }

  _startCountdown() {
    this._clearTimers();
    this.phase = 'countdown';
    this.tutorialStep = null;
    this.countdownValue = START_COUNTDOWN_SECONDS;
    this.gameStartMs = null;
    this.gameEndMs = null;
    this.endingStartedAt = null;
    this.endActionAt = null;
    this.endStage = null;
    this._emit({ type: 'countdown-start', snapshot: this.snapshot() });

    const intervalMs = Math.max(1, Number(this.options.countdownIntervalMs) || 1000);
    const tick = () => {
      if (this.phase !== 'countdown') return;
      if (this.countdownValue > 1) {
        this.countdownValue--;
        this._emit({ type: 'countdown-tick', snapshot: this.snapshot() });
        this._countdownTimer = setTimeout(tick, intervalMs);
      } else {
        // Keep 1 visible for its full interval, then enter the real game. There is
        // deliberately no GO frame.
        this._countdownTimer = null;
        this._startGame();
        this._emit({ type: 'game-start', snapshot: this.snapshot() });
      }
    };
    this._countdownTimer = setTimeout(tick, intervalMs);
  }

  _startGame() {
    this.phase = 'playing';
    this.countdownValue = null;
    this.tutorialStep = null;
    this.gameOver = false;
    this.won = false;
    this.endReason = null;
    this.gameStartMs = Date.now();
    this.gameEndMs = null;
    this.endingStartedAt = null;
    this.endActionAt = null;
    this.endStage = null;
    this.pausedAt = null;
    this.freezeUntil = null;
    this._timeLimitRemaining = null;
    if (this.timeLimit.enabled) {
      this._timeLimitTimer = setTimeout(() => this._handleTimeout(), this.timeLimit.ms);
    }
  }

  _pauseGame() {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.pausedAt = Date.now();
  }

  _resumeGame() {
    if (this.phase !== 'paused') return;
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
      tutorialEnabled: this.tutorialEnabled,
      tutorialStep: this.tutorialStep,
      tutorialTotal: 4,
      countdownValue: this.countdownValue,
      introStartedAt: this.introStartedAt,
      introDurationMs: this.introDurationMs,
      operatorTransitionStartedAt: this.operatorTransitionStartedAt,
      operatorTransitionDurationMs: this.operatorTransitionDurationMs,
      tutorialTransitionStartedAt: this.tutorialTransitionStartedAt,
      tutorialTransitionDurationMs: this.tutorialTransitionDurationMs,
      currentMode: this.currentMode,
      floorButtons: FLOOR_BUTTONS,
      startButton: this.startButton,
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
      endingStartedAt: this.endingStartedAt,
      endActionAt: this.endActionAt,
      endStage: this.endStage,
      animationOrigins: this.animationOrigins,
      serverNowMs: Date.now(),
      lastRevealCellId: this.lastRevealCellId,
      pausedAt: this.pausedAt,
      freezeUntil: this.freezeUntil,
      freezeDurationMs: MINE_FREEZE_MS,
      redWaveStartedAt: this.redWaveStartedAt,
      animationDurations: {
        intro: this.introDurationMs,
        operatorTransition: this.operatorTransitionDurationMs,
        tutorialTransition: this.tutorialTransitionDurationMs,
        redWave: RED_WAVE_DURATION_MS,
        endingSettle: ENDING_SETTLE_MS,
        winEnding: WIN_ENDING_DURATION_MS,
        timeoutEnding: TIMEOUT_ENDING_DURATION_MS,
      },
      timeLimit: this.timeLimit,
      pauseBtnRows: { min: PAUSE_ROW_MIN, max: PAUSE_ROW_MAX }, // legacy
      bombCellId: this.bombCellId,
      redWave: this.redWave,
    };
  }

  _publicCell(c) {
    // 標記錯誤 = 玩家插了旗但底下不是雷。只在 gameOver 後才揭曉(遊戲中揭曉會讓
    // MARK 變成零風險探測,SCAN 就沒人用了)。該格維持 flagged、不計入 revealedCount,
    // 純粹是復盤用的數字提示。
    const wrongFlag = this.gameOver && c.flagged && !c.mine;
    return {
      id: c.id,
      faceName: c.faceName,
      col: c.col,
      row: c.row,
      revealed: c.revealed,
      flagged: c.flagged,
      adjacent: (c.revealed || wrongFlag) ? c.adjacent : null,
      wrongFlag,
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

  _inStartButton(faceName, sensorCol, sensorRow) {
    const b = this.startButton;
    return !!b &&
      faceName === b.faceName &&
      sensorCol >= b.sensorColMin && sensorCol < b.sensorColMax &&
      sensorRow >= b.sensorRowMin && sensorRow < b.sensorRowMax;
  }

  _emitIdleEcho(faceName, sensorCol, sensorRow, clientEchoId = null) {
    const face = this.venue.faces.find(f => f.name === faceName);
    if (!face) return;

    const col = Math.floor(Number(sensorCol) / SENSOR_PER_CELL_X);
    const row = Math.floor(Number(sensorRow) / SENSOR_PER_CELL_Y);
    const cols = Math.max(1, Math.floor(face.colCount / SENSOR_PER_CELL_X));
    const rows = Math.max(1, Math.floor(face.rowCount / SENSOR_PER_CELL_Y));
    if (!Number.isFinite(col) || !Number.isFinite(row) ||
        col < 0 || col >= cols || row < 0 || row >= rows) return;

    const size = faceCanvasSize(face);
    const event = {
      type: 'idle-echo',
      id: ++this._idleEchoSeq,
      faceName,
      cellCol: col,
      cellRow: row,
      x: face.originX + (col + 0.5) * (size.width / cols),
      y: face.originY + (row + 0.5) * (size.height / rows),
      colorIndex: Math.floor(Math.random() * 8),
      durationMs: 1000,
    };
    if (clientEchoId != null && String(clientEchoId)) {
      event.clientEchoId = String(clientEchoId);
    }
    this._emit(event);
  }

  handleTouch(faceName, sensorCol, sensorRow, options = {}) {
    if (faceName === ENTRANCE_FACE_NAME) return;

    // Mine-freeze: block all inputs while frozen
    if (this.freezeUntil != null && Date.now() < this.freezeUntil) return;

    // Idle is gameplay-inert, but the external standby map can acknowledge
    // visitors with a short cell echo.
    if (this.phase === 'idle') {
      this._emitIdleEcho(faceName, sensorCol, sensorRow, options?.clientEchoId);
      return;
    }

    // Backend start arms the physical mine trigger; only that button can
    // launch the presentation intro.
    if (this.phase === 'armed') {
      if (this.operatorTransitionStartedAt != null &&
          Date.now() - this.operatorTransitionStartedAt < this.operatorTransitionDurationMs) {
        return;
      }
      if (this._inStartButton(faceName, sensorCol, sensorRow)) {
        this._startIntro();
        this._emit({ type: 'intro-start', snapshot: this.snapshot() });
      }
      return;
    }

    // The ten-second intro is presentation-only and input-locked.
    if (this.phase === 'intro') return;

    // After the operator-triggered intro, restore the original floor PLAY gate.
    if (this.phase === 'ready') {
      if (faceName === FLOOR_FACE_NAME && this._inCenterCircle(sensorCol, sensorRow)) {
        if (this.tutorialEnabled) {
          this._startTutorial();
          this._emit({ type: 'tutorial-start', snapshot: this.snapshot() });
        } else {
          this._startCountdown();
        }
      }
      return;
    }

    // tutorial: only the center CONTINUE button is active. Walls, MARK ring and
    // PAUSE are deliberately inert so the tutorial cannot mutate the real board.
    if (this.phase === 'tutorial') {
      if (this.tutorialTransitionStartedAt != null &&
          Date.now() - this.tutorialTransitionStartedAt < this.tutorialTransitionDurationMs) {
        return;
      }
      if (faceName === FLOOR_FACE_NAME && this._inCenterCircle(sensorCol, sensorRow)) {
        this._advanceTutorial();
      }
      return;
    }

    // tutorial complete: center PLAY starts the synchronized 3-2-1 countdown.
    if (this.phase === 'tutorialReady') {
      if (faceName === FLOOR_FACE_NAME && this._inCenterCircle(sensorCol, sensorRow)) {
        this._startCountdown();
      }
      return;
    }

    // Countdown is completely input-locked. Server owns the timer so reconnecting
    // clients all see the same value and cannot restart/skip it with another touch.
    if (this.phase === 'countdown') return;

    // gameOver: the center action is server-gated so every view shares the
    // same animation window. Timeout first becomes CONTINUE, then starts the
    // ending sequence; win goes straight to the final RETURN window.
    if (this.phase === 'gameOver') {
      if (faceName === FLOOR_FACE_NAME && this._inCenterCircle(sensorCol, sensorRow)) {
        if (this.endActionAt == null || Date.now() < this.endActionAt) return;
        if (this.endReason === 'timeout' && this.endStage === 'timeout-wave') {
          this._startTimeoutEnding();
          this._emit({ type: 'ending-start', snapshot: this.snapshot() });
          return;
        }
        this._clearTimers();
        this._reset();
        this._emit({ type: 'reset', snapshot: this.snapshot() });
      }
      return;
    }

    // paused: only the inner RESUME action remains. There is intentionally no
    // outer-ring abort path; elapsed time and the time-limit timer continue.
    if (this.phase === 'paused') {
      if (faceName !== FLOOR_FACE_NAME) return;
      if (this._inCenterCircle(sensorCol, sensorRow)) {
        this._resumeGame();
        this._emit({ type: 'resume', snapshot: this.snapshot() });
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
      this.lastRevealCellId = cell.id;
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

  // Mine = freeze 5s, no game over. Trigger the same breach/redWave visual
  // as the original mine-hit animation so the consequence reads dramatically;
  // game continues after freeze clears.
  _handleMineFreeze(cell) {
    cell.revealed = true;
    this.bombCellId = cell.id;
    const startedAt = Date.now();
    this.freezeUntil = startedAt + MINE_FREEZE_MS;
    this.redWave = this._buildRedWave(cell.faceName, cell.col, cell.row);
    this.redWaveStartedAt = startedAt;
    if (this._freezeTimer) clearTimeout(this._freezeTimer);
    this._freezeTimer = setTimeout(() => {
      this._freezeTimer = null;
      this.freezeUntil = null;
      this.redWave = null;
      this.redWaveStartedAt = null;
      this.bombCellId = null;
      this._emit({ type: 'unfreeze' });
    }, MINE_FREEZE_MS);
    this._emit({
      type: 'freeze',
      freezeUntil: this.freezeUntil,
      durationMs: MINE_FREEZE_MS,
      cells: [this._publicCell(cell)],
      bombCellId: cell.id,
      redWave: this.redWave,
      redWaveStartedAt: this.redWaveStartedAt,
    });
  }

  // Build a redWave centered on a specific board cell. Used by mine freeze.
  _buildRedWave(originFaceName, originCol, originRow) {
    const originFace = this.venue.faces.find(f => f.name === originFaceName);
    if (!originFace) return [];
    const originSize = faceCanvasSize(originFace);
    const originCols = Math.max(1, Math.floor(originFace.colCount / SENSOR_PER_CELL_X));
    const originRows = Math.max(1, Math.floor(originFace.rowCount / SENSOR_PER_CELL_Y));
    const bx = originFace.originX + (originCol + 0.5) * (originSize.width / originCols);
    const by = originFace.originY + (originRow + 0.5) * (originSize.height / originRows);
    return this._buildRedWaveAt(bx, by);
  }

  _buildRedWaveAt(originX, originY) {
    const wave = [];
    for (const face of this.venue.faces) {
      const facCols = Math.floor(face.colCount / SENSOR_PER_CELL_X);
      const facRows = Math.floor(face.rowCount / SENSOR_PER_CELL_Y);
      const fm = this.faceMap.get(face.name);
      const size = faceCanvasSize(face);
      const cellW = size.width / Math.max(1, facCols);
      const cellH = size.height / Math.max(1, facRows);
      for (let c = 0; c < facCols; c++) {
        for (let r = 0; r < facRows; r++) {
          const cx = face.originX + (c + 0.5) * cellW;
          const cy = face.originY + (r + 0.5) * cellH;
          wave.push({ faceName: face.name, col: c, row: r,
            dist: Math.hypot(cx - originX, cy - originY),
            cellId: fm?.grid?.[c]?.[r] ?? null });
        }
      }
    }
    wave.sort((a, b) => a.dist - b.dist);
    return wave;
  }

  _handleWin() {
    this._clearTimers();
    this.phase = 'gameOver';
    this.gameOver = true;
    this.won = true;
    this.endReason = 'win';
    this.gameEndMs = Date.now();
    this.endingStartedAt = this.gameEndMs;
    this.endStage = 'win-ending';
    this.endActionAt = this.gameEndMs + WIN_ENDING_DURATION_MS;
    this._emit({ type: 'game-over', won: true, reason: 'win', snapshot: this.snapshot() });
  }

  _handleTimeout() {
    if (this.phase !== 'playing' && this.phase !== 'paused') return;
    this._clearTimers();
    this.phase = 'gameOver';
    this.gameOver = true;
    this.won = false;
    this.endReason = 'timeout';
    this.gameEndMs = Date.now();
    this.endingStartedAt = null;
    this.endStage = 'timeout-wave';
    this.endActionAt = this.gameEndMs + RED_WAVE_DURATION_MS + ENDING_SETTLE_MS;
    this.pausedAt = null;
    this.freezeUntil = null;
    this.bombCellId = null;
    // Wave radiates from the visual floor center, not a sensor coordinate.
    this.redWave = this._buildRedWaveAt(
      this.animationOrigins.timeout.x,
      this.animationOrigins.timeout.y,
    );
    this.redWaveStartedAt = this.gameEndMs;
    this._emit({
      type: 'game-over', won: false, reason: 'timeout',
      redWave: this.redWave,
      snapshot: this.snapshot(),
    });
  }

  _startTimeoutEnding() {
    this.redWave = null;
    this.redWaveStartedAt = null;
    this.endingStartedAt = Date.now();
    this.endStage = 'timeout-ending';
    this.endActionAt = this.endingStartedAt + TIMEOUT_ENDING_DURATION_MS;
  }

  endFromOperator() {
    if (this.phase === 'idle') return false;
    this._clearTimers();
    // Keep the round snapshot visible so every display can show the final
    // score instead of losing the board by resetting straight to idle.
    this.phase = 'gameOver';
    this.gameOver = true;
    this.won = false;
    this.endReason = 'operator';
    this.gameEndMs ??= Date.now();
    this.endingStartedAt = this.gameEndMs;
    this.endStage = 'operator-ending';
    this.endActionAt = this.gameEndMs;
    this.introStartedAt = null;
    this.operatorTransitionStartedAt = null;
    this.tutorialTransitionStartedAt = null;
    this.tutorialStep = null;
    this.countdownValue = null;
    this.pausedAt = null;
    this.freezeUntil = null;
    this.bombCellId = null;
    this.redWave = null;
    this.redWaveStartedAt = null;
    this._emit({
      type: 'game-over',
      won: false,
      reason: 'operator',
      snapshot: this.snapshot(),
    });
    return true;
  }

  reset() {
    this._clearTimers();
    this._reset();
    this._emit({ type: 'reset', snapshot: this.snapshot() });
  }
}
