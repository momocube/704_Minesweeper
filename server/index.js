import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { TouchClient } from './touch-client.js';
import { Game } from './game.js';

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
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === 'inject-touch') {
      game.handleTouch(msg.face, msg.sensorCol, msg.sensorRow);
    }
  });
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

game.on(broadcast);

const touch = new TouchClient(TOUCHSERVICE_URL, {
  onHello: (hello) => {
    console.log(`[TouchService] hello, venue=${hello.venue}, canvas=${hello.canvas.w}x${hello.canvas.h}`);
  },
  onConnect: () => console.log('[TouchService] connected'),
  onDisconnect: () => console.log('[TouchService] disconnected, will reconnect'),
  onDown: (e) => {
    const faceMeta = venue.faces[e.face];
    if (!faceMeta) return;
    game.handleTouch(faceMeta.name, e.cell[0], e.cell[1]);
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
