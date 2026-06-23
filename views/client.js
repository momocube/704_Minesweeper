export class StateClient {
  constructor(handlers = {}) {
    this.h = handlers;
    this.state = null;
    this._connect();
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
    if (msg.type === 'snapshot') {
      this.state = msg;
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
      case 'mode-feedback':
        this.h.onModeFeedback?.(msg);
        break;
      case 'game-start':
        this.state = msg.snapshot;
        this.h.onGameStart?.(msg);
        break;
      case 'game-over':
        this.state = msg.snapshot;
        this.h.onGameOver?.(msg);
        break;
      case 'reset':
        this.state = msg.snapshot;
        this.h.onReset?.(msg);
        break;
    }
  }
}
