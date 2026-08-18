import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { TouchClient } from './touch-client.js';
import { Game } from './game.js';
import { SensorLock, lockKey } from './sensor-lock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const HTTP_PORT = Number(process.env.PORT ?? 3000);
const TOUCHSERVICE_URL = process.env.TOUCHSERVICE_URL ?? 'ws://127.0.0.1:20111/';

const venue = JSON.parse(await readFile(resolve(ROOT, 'config/venue-704.json'), 'utf8'));
const topology = JSON.parse(await readFile(resolve(ROOT, 'config/board-topology.json'), 'utf8'));

const game = new Game(venue, topology, {
  mineRate: Number(process.env.MINE_RATE ?? 0.15),
  seed: process.env.SEED ? Number(process.env.SEED) : null,
});

// Sensor-cell calibration / blacklist (filter misfiring chips before they
// reach Game). Persisted to ~/.704-minesweeper/sensor-lock.json so a venue
// calibration survives portable-exe re-extraction.
const sensorLock = new SensorLock();
await sensorLock.load();
console.log(`[sensor-lock] loaded ${sensorLock.lockedCells.size} locked cell(s) from ${sensorLock.persistPath}`);

const MIME = {
  html: 'text/html;charset=utf-8',
  js: 'application/javascript;charset=utf-8',
  css: 'text/css;charset=utf-8',
  json: 'application/json;charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
};

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let path = url.pathname;
  if (path === '/' || path === '/index.html') path = '/index.html';
  const filePath = resolve(ROOT, 'views' + path);
  if (!filePath.startsWith(resolve(ROOT, 'views'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const data = await readFile(filePath);
    const ext = filePath.split('.').pop();
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
// WebSocketServer rethrows httpServer errors as its own 'error' event — without a handler
// EADDRINUSE crashes the process before our httpServer retry can kick in.
wss.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') console.error('[WS]', err.message);
});
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify(game.snapshot()));
  ws.send(JSON.stringify(sensorLock.getSnapshot()));
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === 'inject-touch') {
      // Mirror real sensor path so the operator can test calibration with
      // mouse clicks: record event, auto-lock in calibration mode, drop on
      // hit, else hand off to the game.
      handleSensorInput(msg.face, msg.sensorCol, msg.sensorRow);
      return;
    }

    if (msg.type === 'lock-mode-set') {
      sensorLock.setLockMode(!!msg.on);
      return;
    }
    if (msg.type === 'lock-toggle-cell') {
      sensorLock.toggle(lockKey(msg.face, msg.sensorCol, msg.sensorRow));
      return;
    }
    if (msg.type === 'lock-clear') {
      sensorLock.clear();
      return;
    }

    if (msg.type === 'set-time-limit') {
      // Only honored when game is idle — server enforces the gate so a
      // panicked operator clicking the checkbox mid-game doesn't crash
      // an active timer.
      if (game.phase === 'idle') {
        game.setTimeLimit({ enabled: !!msg.enabled, ms: msg.ms });
      }
      return;
    }

    if (msg.type === 'set-tutorial-enabled') {
      // Per-round tutorial setting, default ON. Like time limit, only the idle
      // setup screen can change it so all displays stay on one server-owned flow.
      game.setTutorialEnabled(!!msg.enabled);
      return;
    }
  });
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// Single funnel for both TouchService and inject-touch — filter once, route
// to Game once. Operator-facing UI talks to this through the same path.
function handleSensorInput(faceName, sensorCol, sensorRow) {
  const k = lockKey(faceName, sensorCol, sensorRow);
  sensorLock.recordEvent(k);
  if (sensorLock.lockMode) {
    // Calibration mode: every chip that fires is suspect → blacklist it.
    sensorLock.add(k);
    return;
  }
  if (sensorLock.isLocked(k)) {
    sensorLock.noteFiltered();
    return;
  }
  game.handleTouch(faceName, sensorCol, sensorRow);
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

game.on(broadcast);
sensorLock.on(broadcast);

const touch = new TouchClient(TOUCHSERVICE_URL, {
  onHello: (hello) => {
    console.log(`[TouchService] hello, venue=${hello.venue}, canvas=${hello.canvas.w}x${hello.canvas.h}`);
  },
  onConnect: () => console.log('[TouchService] connected'),
  onDisconnect: () => console.log('[TouchService] disconnected, will reconnect'),
  onDown: (e) => {
    const faceMeta = venue.faces[e.face];
    if (!faceMeta) return;
    handleSensorInput(faceMeta.name, e.cell[0], e.cell[1]);
  },
});

// Retry listen on EADDRINUSE — port may take a moment to release after taskkill /f
let listenRetries = 5;
function tryListen() {
  httpServer.listen(HTTP_PORT, '0.0.0.0');
}
httpServer.on('listening', () => {
  console.log(`[minesweeper] http://localhost:${HTTP_PORT}/`);
  console.log(`[minesweeper] views: ?face=wall-left | wall-top | wall-right-big | wall-right-little | wall-button | floor | all`);
  console.log(`[minesweeper] board: ${game.total} cells, ${game.mineCount} mines`);
});
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && listenRetries > 0) {
    listenRetries--;
    console.log(`[minesweeper] port ${HTTP_PORT} busy, retry in 1s (${listenRetries} left)`);
    setTimeout(tryListen, 1000);
    return;
  }
  console.error(`[minesweeper] FATAL: ${err.message}`);
  console.error('  if port is in use, run start.bat again or change PORT env var');
  process.exit(1);
});
tryListen();

process.on('SIGINT',  () => { console.log('shutting down (SIGINT)');  process.exit(0); });
process.on('SIGTERM', () => { console.log('shutting down (SIGTERM)'); process.exit(0); });
