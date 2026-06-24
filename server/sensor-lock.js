// Sensor cell lock (calibration mode).
//
// Same model as 704_GenerativeArt: maintain a blacklist of misfiring sensor
// chips so they can't trigger game events. Operator opens lock mode (room
// empty), every chip that fires gets auto-added to the locked set, then
// closes lock mode. While the lock set is populated, those chips' events are
// silently dropped (counted) before they ever reach Game.handleTouch.
//
// Persisted to a stable user-data path so portable exe re-launches keep
// the calibration from the venue.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const LOCK_HOT_WINDOW_MS = 10_000;
const LOCK_RECENT_CAP    = 4096;
const FILTERED_DECAY_MS  = 5000;

export function defaultLockPath() {
  return join(homedir(), '.704-minesweeper', 'sensor-lock.json');
}

export function lockKey(faceName, sensorCol, sensorRow) {
  return `${faceName}:${sensorCol}:${sensorRow}`;
}

export class SensorLock {
  constructor(persistPath = defaultLockPath()) {
    this.persistPath = persistPath;
    this.lockedCells = new Set();
    this.recentEvents = [];
    this.lockMode = false;
    this.filteredCount = 0;
    this._filteredFadeTimer = null;
    this.startMs = Date.now();
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(msg) { for (const fn of this.listeners) fn(msg); }

  async load() {
    try {
      const raw = await readFile(this.persistPath, 'utf8');
      const obj = JSON.parse(raw);
      if (Array.isArray(obj.lockedCells)) {
        this.lockedCells = new Set(obj.lockedCells.filter(s => typeof s === 'string'));
      }
    } catch { /* fresh start ok */ }
  }

  async _persist() {
    try {
      await mkdir(dirname(this.persistPath), { recursive: true });
      await writeFile(this.persistPath, JSON.stringify({
        lockedCells: [...this.lockedCells],
      }, null, 2));
    } catch (e) {
      console.error('[sensor-lock] persist failed:', e.message);
    }
  }

  isLocked(key) { return this.lockedCells.has(key); }

  recordEvent(key) {
    const t = Date.now() - this.startMs;
    this.recentEvents.push({ key, t });
    if (this.recentEvents.length > LOCK_RECENT_CAP) this.recentEvents.shift();
  }

  pruneRecent() {
    const t = Date.now() - this.startMs;
    while (this.recentEvents.length && t - this.recentEvents[0].t > LOCK_HOT_WINDOW_MS) {
      this.recentEvents.shift();
    }
  }

  hotCounts() {
    this.pruneRecent();
    const m = {};
    for (const ev of this.recentEvents) m[ev.key] = (m[ev.key] || 0) + 1;
    return m;
  }

  add(key) {
    if (this.lockedCells.has(key)) return false;
    this.lockedCells.add(key);
    this._persist();
    this._emitUpdate();
    return true;
  }

  remove(key) {
    if (!this.lockedCells.has(key)) return false;
    this.lockedCells.delete(key);
    this._persist();
    this._emitUpdate();
    return true;
  }

  toggle(key) {
    if (this.lockedCells.has(key)) this.remove(key);
    else this.add(key);
  }

  clear() {
    if (!this.lockedCells.size) return;
    this.lockedCells.clear();
    this._persist();
    this._emitUpdate();
  }

  setLockMode(on) {
    const v = !!on;
    if (this.lockMode === v) return;
    this.lockMode = v;
    if (this.lockMode) {
      // Seed: anything that fired in the last 10s is suspect — pre-lock it
      // so the operator doesn't have to wait another window for stuck chips
      // that just misfired.
      this.pruneRecent();
      let added = false;
      for (const ev of this.recentEvents) {
        if (!this.lockedCells.has(ev.key)) {
          this.lockedCells.add(ev.key);
          added = true;
        }
      }
      if (added) this._persist();
    }
    this._emitUpdate();
  }

  noteFiltered() {
    this.filteredCount++;
    if (this._filteredFadeTimer) clearTimeout(this._filteredFadeTimer);
    this._filteredFadeTimer = setTimeout(() => {
      this.filteredCount = 0;
      this._emitStats();
    }, FILTERED_DECAY_MS);
    this._emitStats();
  }

  _emitUpdate() {
    this._emit({ type: 'lock-update', snapshot: this.getSnapshot() });
  }
  _emitStats() {
    this._emit({ type: 'lock-stats', filteredCount: this.filteredCount });
  }

  getSnapshot() {
    return {
      type: 'lock-snapshot',
      lockedCells: [...this.lockedCells],
      lockMode: this.lockMode,
      filteredCount: this.filteredCount,
      hotCounts: this.hotCounts(),
    };
  }
}
