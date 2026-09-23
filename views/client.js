export class StateClient {
  constructor(handlers = {}) {
    this.h = handlers;
    this.state = null;
    this.clockOffsetMs = 0;
    this._connect();
  }

  now() {
    return Date.now() + this.clockOffsetMs;
  }

  _syncClock(serverNowMs, receivedAt = Date.now()) {
    const serverNow = Number(serverNowMs);
    if (Number.isFinite(serverNow)) {
      this.clockOffsetMs = serverNow - receivedAt;
    }
  }

  _setSnapshot(snapshot, receivedAt = Date.now()) {
    this._syncClock(snapshot?.serverNowMs, receivedAt);
    this.state = snapshot;
  }

  _connect() {
    const url = `ws://${location.host}/ws`;
    this._ws = new WebSocket(url);
    this._ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._onMessage(msg);
    };
    this._ws.onclose = () => { setTimeout(() => this._connect(), 1500); };
    this._ws.onerror = () => { try { this._ws.close(); } catch {} };
  }

  _onMessage(msg) {
    const receivedAt = Date.now();
    this._syncClock(msg.serverNowMs, receivedAt);
    if (msg.type === 'snapshot') {
      this._setSnapshot(msg, receivedAt);
      this.h.onSnapshot?.(msg);
      return;
    }
    if (!this.state) return;

    switch (msg.type) {
      case 'lock':
        this.state.lockedCellId = msg.cellId;
        this.h.onLock?.(msg);
        break;
      case 'unlock':
        this.state.lockedCellId = null;
        this.h.onUnlock?.();
        break;
      case 'cell-update':
        for (const c of msg.cells) {
          this.state.cells[c.id] = c;
        }
        if (msg.flaggedCount != null) this.state.flaggedCount = msg.flaggedCount;
        if (msg.revealedCount != null) this.state.revealedCount = msg.revealedCount;
        this.h.onCellUpdate?.(msg.cells);
        break;
      case 'mode-change':
        this.state.currentMode = msg.mode;
        this.h.onModeChange?.(msg);
        break;
      case 'freeze':
        for (const c of msg.cells || []) this.state.cells[c.id] = c;
        this.state.freezeUntil = msg.freezeUntil;
        this.state.bombCellId = msg.bombCellId;
        this.state.redWave = msg.redWave || null;
        this.state.redWaveStartedAt = msg.redWaveStartedAt ?? Date.now();
        this.h.onFreeze?.(msg);
        break;
      case 'unfreeze':
        this.state.freezeUntil = null;
        this.state.redWave = null;
        this.state.redWaveStartedAt = null;
        this.state.bombCellId = null;
        this.h.onUnfreeze?.(msg);
        break;
      case 'time-limit':
        this.state.timeLimit = msg.timeLimit;
        this.h.onTimeLimit?.(msg);
        break;
      case 'mode-feedback':
        this.h.onModeFeedback?.(msg);
        break;
      case 'tutorial-start':
      case 'tutorial-step':
      case 'tutorial-ready':
      case 'tutorial-setting':
      case 'countdown-start':
      case 'countdown-tick':
      case 'armed':
      case 'intro-start':
      case 'intro-complete':
      case 'ending-start':
        this._setSnapshot(msg.snapshot, receivedAt);
        if (msg.type === 'intro-start' || msg.type === 'intro-complete') {
          this.h.onIntro?.(msg);
        } else if (msg.type === 'armed') {
          this.h.onArmed?.(msg);
        } else if (msg.type === 'ending-start') {
          this.h.onEndingStart?.(msg);
        } else {
          this.h.onTutorial?.(msg);
        }
        break;
      case 'pause':
      case 'resume':
        this._setSnapshot(msg.snapshot, receivedAt);
        if (msg.type === 'pause') this.h.onPause?.(msg);
        else this.h.onResume?.(msg);
        break;
      case 'game-start':
        this._setSnapshot(msg.snapshot, receivedAt);
        this.h.onGameStart?.(msg);
        break;
      case 'game-over':
        this._setSnapshot(msg.snapshot, receivedAt);
        this.h.onGameOver?.(msg);
        break;
      case 'reset':
        this._setSnapshot(msg.snapshot, receivedAt);
        this.h.onReset?.(msg);
        break;
    }
  }
}
