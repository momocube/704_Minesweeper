import { WebSocket } from 'ws';

export class TouchClient {
  constructor(url, handlers = {}) {
    this.url = url;
    this.h = handlers;
    this.touches = new Map();
    this.hello = null;
    this._lastMsg = 0;
    this._wasOpen = false;
    this._connect();
    this._watchdog = setInterval(() => {
      if (this._lastMsg && Date.now() - this._lastMsg > 3500) {
        try { this._ws.close(); } catch {}
      }
    }, 1000);
  }

  _connect() {
    this._ws = new WebSocket(this.url);

    this._ws.on('message', (data) => {
      this._lastMsg = Date.now();
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      if (msg.type) {
        if (msg.type === 'hello') {
          this.hello = msg;
          this.h.onHello?.(msg);
        }
        return;
      }

      for (const e of (msg.events ?? [])) {
        if (e.phase === 'up') {
          this.touches.delete(e.id);
          this.h.onUp?.(e.id);
        } else {
          this.touches.set(e.id, e);
          if (e.phase === 'down') this.h.onDown?.(e);
          else this.h.onMove?.(e);
        }
      }

      if (Array.isArray(msg.alive)) {
        const alive = new Set(msg.alive);
        for (const id of [...this.touches.keys()]) {
          if (!alive.has(id)) {
            this.touches.delete(id);
            this.h.onUp?.(id);
          }
        }
      }
    });

    this._ws.on('close', () => {
      for (const id of [...this.touches.keys()]) {
        this.touches.delete(id);
        this.h.onUp?.(id);
      }
      if (this._wasOpen) {
        this._wasOpen = false;
        this.h.onDisconnect?.();
      }
      setTimeout(() => this._connect(), 2000);
    });

    this._ws.on('error', () => { try { this._ws.close(); } catch {} });

    this._ws.on('open', () => { this._wasOpen = true; this.h.onConnect?.(); });
  }
}
