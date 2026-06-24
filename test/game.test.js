import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../server/game.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const venue = JSON.parse(await readFile(resolve(ROOT, 'config/venue-704.json'), 'utf8'));
const topology = JSON.parse(await readFile(resolve(ROOT, 'config/board-topology.json'), 'utf8'));

// chip-cell anchors for the new Floor button layout (server is the source of
// truth; these match game.js's FLOOR_BUTTONS exactly)
const CENTER_CHIP = [22, 64];
const MARK_CHIP   = [16, 64];
const SCAN_CHIP   = [28, 64];
const PAUSE_CHIP  = [22, 110];

function newGame(opts = {}) {
  return new Game(venue, topology, { mineRate: 0.15, seed: 1, ...opts });
}
function newStartedGame(opts = {}) {
  const g = newGame(opts);
  g.handleTouch('Floor', ...CENTER_CHIP);
  return g;
}

test('初始狀態 = idle, gameStartMs=null, phase=idle, currentMode=reveal', () => {
  const g = newGame();
  const s = g.snapshot();
  assert.equal(s.type, 'snapshot');
  assert.ok(s.cells.length > 0);
  assert.equal(s.faces.length, 7);
  assert.equal(s.reservedTopRows, 2);
  assert.equal(s.restartBtnBoardCells, 3);
  assert.equal(s.phase, 'idle');
  assert.equal(s.gameStartMs, null);
  assert.equal(s.bombCellId, null);
  assert.equal(s.redWave, null);
  assert.equal(s.currentMode, 'reveal');
  assert.ok(s.floorButtons.center && s.floorButtons.mark && s.floorButtons.scan && s.floorButtons.pause);
});

test('idle: 摸牆 / Floor 非按鈕區 都被忽略', () => {
  const g = newGame();
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch('Wall Top', 8, 12);
  g.handleTouch('Floor', 10, 50);  // outside any button
  g.handleTouch('Floor', 30, 50);  // outside any button
  assert.equal(g.phase, 'idle');
  assert.equal(events.length, 0);
});

test('idle: 踩 Floor 中央按鈕 → phase=playing, gameStartMs 設定, game-start 事件', () => {
  const g = newGame();
  const events = [];
  g.on(e => events.push(e));
  const before = Date.now();
  g.handleTouch('Floor', ...CENTER_CHIP);
  assert.equal(g.phase, 'playing');
  assert.ok(g.gameStartMs >= before);
  const gs = events.find(e => e.type === 'game-start');
  assert.ok(gs, 'should emit game-start event');
  assert.equal(gs.snapshot.phase, 'playing');
});

test('snapshot 不洩漏雷的位置', () => {
  const g = newGame();
  const s = g.snapshot();
  for (const c of s.cells) assert.equal(c.mine, false);
});

test('摸 Entrance 沒有反應 (playing)', () => {
  const g = newStartedGame();
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch('Entrance', 0, 0);
  assert.equal(events.length, 0);
});

test('摸各面 reserved 區域 → 無 cell-update', () => {
  const g = newStartedGame(); // default mode = reveal
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch('Wall Top', 4, 0);     // reserved top
  g.handleTouch('Wall Button', 4, 36); // reserved bottom
  g.handleTouch('Wall Left', 2, 50);   // reserved left
  g.handleTouch('Wall Right Big', 18, 10); // reserved right
  const updates = events.filter(e => e.type === 'cell-update');
  assert.equal(updates.length, 0);
});

test('default mode = reveal: 摸牆面 game area → 直接 reveal', () => {
  const g = newStartedGame();
  const safe = g.cells.find(c => !c.mine && c.adjacent > 0);
  g.handleTouch(safe.faceName, safe.col * 2, safe.row * 4);
  assert.equal(g.cells[safe.id].revealed, true);
});

test('踩 MARK 按鈕 → currentMode=flag,連續摸格 toggle flag', () => {
  const g = newStartedGame();
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch('Floor', ...MARK_CHIP);
  assert.equal(g.currentMode, 'flag');
  const mc = events.find(e => e.type === 'mode-change');
  assert.ok(mc); assert.equal(mc.mode, 'flag');

  const c1 = g.cells.find(c => !c.mine);
  g.handleTouch(c1.faceName, c1.col * 2, c1.row * 4);
  assert.equal(g.cells[c1.id].flagged, true);

  // 再摸一次 → 取消 flag
  g.handleTouch(c1.faceName, c1.col * 2, c1.row * 4);
  assert.equal(g.cells[c1.id].flagged, false);

  // 還沒切回 reveal → 摸第二格也是 toggle flag
  const c2 = g.cells.find(c => !c.mine && c.id !== c1.id);
  g.handleTouch(c2.faceName, c2.col * 2, c2.row * 4);
  assert.equal(g.cells[c2.id].flagged, true);
});

test('MARK ↔ SCAN 隨時切換', () => {
  const g = newStartedGame();
  assert.equal(g.currentMode, 'reveal');
  g.handleTouch('Floor', ...MARK_CHIP);
  assert.equal(g.currentMode, 'flag');
  g.handleTouch('Floor', ...SCAN_CHIP);
  assert.equal(g.currentMode, 'reveal');
  g.handleTouch('Floor', ...MARK_CHIP);
  assert.equal(g.currentMode, 'flag');
});

test('Floor 非按鈕區 (playing) → 被忽略,沒 mode 切換', () => {
  const g = newStartedGame();
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch('Floor', 5, 5);    // outside any button
  g.handleTouch('Floor', 40, 80);  // outside any button
  assert.equal(g.currentMode, 'reveal');
  assert.equal(events.filter(e => e.type === 'mode-change').length, 0);
});

// helper: 第一次踩非雷格 (跳過 first-click safety)
function gameWithFirstRevealDone() {
  const g = newStartedGame(); // default reveal mode
  const safe = g.cells.find(c => !c.mine);
  g.handleTouch(safe.faceName, safe.col * 2, safe.row * 4);
  return g;
}

test('第一次揭露保護:第一次踩雷格 + 8 鄰居都被搬走', () => {
  const g = newStartedGame();
  const mine = g.cells.find(c => c.mine);
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  assert.equal(g.phase, 'playing', '第一次揭露雷格應該被搬走');
  assert.equal(g.cells[mine.id].mine, false);
  for (const nid of g.cells[mine.id].neighbors) {
    assert.equal(g.cells[nid].mine, false, `鄰居 ${nid} 也不能是雷`);
  }
  assert.equal(g.cells.filter(c => c.mine).length, g.mineCount);
});

test('gameEndMs 在 gameOver 時被設定,reset 後清掉', async () => {
  const g = gameWithFirstRevealDone();
  assert.equal(g.gameEndMs, null);
  const mine = g.cells.find(c => c.mine && !c.revealed);
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  assert.ok(g.gameEndMs != null);
  const frozen = g.gameEndMs;
  await new Promise(r => setTimeout(r, 30));
  assert.equal(g.gameEndMs, frozen);
  g.handleTouch('Floor', ...CENTER_CHIP); // gameOver center → idle
  assert.equal(g.phase, 'idle');
  assert.equal(g.gameEndMs, null);
  assert.equal(g.gameStartMs, null);
});

test('reveal 雷 → gameOver + redWave 涵蓋整個場域', () => {
  const g = gameWithFirstRevealDone();
  const mine = g.cells.find(c => c.mine && !c.revealed);
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  assert.equal(g.gameOver, true);
  assert.equal(g.bombCellId, mine.id);
  assert.ok(Array.isArray(g.redWave));
  assert.equal(g.redWave.length, 1784);
  assert.equal(g.redWave[0].dist, 0);
  assert.equal(g.redWave[0].faceName, mine.faceName);
  assert.equal(g.redWave[0].col, mine.col);
  assert.equal(g.redWave[0].row, mine.row);
  for (let i = 1; i < g.redWave.length; i++) {
    assert.ok(g.redWave[i].dist >= g.redWave[i-1].dist);
  }
  const withCellId = g.redWave.filter(w => w.cellId != null);
  assert.equal(withCellId.length, g.cells.length);
});

test('gameOver 後一般觸控被忽略,只接受 Floor 中央按鈕 → 回到 idle', () => {
  const g = gameWithFirstRevealDone();
  const mine = g.cells.find(c => c.mine && !c.revealed);
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  assert.equal(g.phase, 'gameOver');

  g.handleTouch('Wall Top', 8, 12);
  assert.equal(g.phase, 'gameOver');

  g.handleTouch('Floor', 5, 5);
  assert.equal(g.phase, 'gameOver');

  g.handleTouch('Floor', ...CENTER_CHIP);
  assert.equal(g.phase, 'idle');
  assert.equal(g.gameStartMs, null);
  assert.equal(g.gameEndMs, null);

  g.handleTouch('Floor', ...CENTER_CHIP);
  assert.equal(g.phase, 'playing');
});

test('Center 按鈕邊界: chip cols 19..24 × rows 58..69', () => {
  const g1 = newGame();
  g1.handleTouch('Floor', 18, 64); // col 18 外側
  assert.equal(g1.phase, 'idle');
  g1.handleTouch('Floor', 19, 64); // 邊界內
  assert.equal(g1.phase, 'playing');

  const g2 = newGame();
  g2.handleTouch('Floor', 22, 57); // row 57 外側
  assert.equal(g2.phase, 'idle');
  g2.handleTouch('Floor', 22, 58); // 邊界內
  assert.equal(g2.phase, 'playing');

  const g3 = newGame();
  g3.handleTouch('Floor', 25, 64); // col 25 外側 (max exclusive)
  assert.equal(g3.phase, 'idle');
  g3.handleTouch('Floor', 24, 64); // 邊界內
  assert.equal(g3.phase, 'playing');
});

test('MARK / SCAN 按鈕邊界 (cols 13..18 / 25..30, rows 58..69)', () => {
  const g = newStartedGame();
  g.handleTouch('Floor', 12, 64); // MARK col 12 外
  assert.equal(g.currentMode, 'reveal');
  g.handleTouch('Floor', 13, 64); // MARK col 13 內
  assert.equal(g.currentMode, 'flag');
  g.handleTouch('Floor', 31, 64); // SCAN col 31 外
  assert.equal(g.currentMode, 'flag');
  g.handleTouch('Floor', 30, 64); // SCAN col 30 內
  assert.equal(g.currentMode, 'reveal');
});

test('flag 已揭露格 → no-op', () => {
  const g = gameWithFirstRevealDone();
  const revealed = g.cells.find(c => c.revealed);
  g.handleTouch('Floor', ...MARK_CHIP);
  g.handleTouch(revealed.faceName, revealed.col * 2, revealed.row * 4);
  assert.equal(g.cells[revealed.id].flagged, false);
});

test('reveal 已 flag 格 → no-op', () => {
  const g = newStartedGame();
  g.handleTouch('Floor', ...MARK_CHIP);
  const safe = g.cells.find(c => !c.mine);
  g.handleTouch(safe.faceName, safe.col * 2, safe.row * 4);
  assert.equal(g.cells[safe.id].flagged, true);
  g.handleTouch('Floor', ...SCAN_CHIP);
  g.handleTouch(safe.faceName, safe.col * 2, safe.row * 4);
  assert.equal(g.cells[safe.id].revealed, false);
});

test('reveal 0 格 → flood-fill 擴散', () => {
  const g = newStartedGame({ mineRate: 0.05, seed: 7 });
  const zeroCell = g.cells.find(c => !c.mine && c.adjacent === 0);
  assert.ok(zeroCell);
  g.handleTouch(zeroCell.faceName, zeroCell.col * 2, zeroCell.row * 4);
  assert.ok(g.revealedCount > 1);
});

// ── PAUSE / RESUME / ABORT ─────────────────────────────
test('playing 中踩 PAUSE 按鈕 → 進入 paused phase', () => {
  const g = newStartedGame();
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch('Floor', ...PAUSE_CHIP);
  assert.equal(g.phase, 'paused');
  assert.ok(g.pausedAt != null);
  assert.equal(events.find(e => e.type === 'pause')?.snapshot.phase, 'paused');
});

test('PAUSE 按鈕邊界 chip cols 19..24 × rows 104..115', () => {
  const g = newStartedGame();
  g.handleTouch('Floor', 18, 110); // col 18 外
  assert.equal(g.phase, 'playing');
  g.handleTouch('Floor', 22, 103); // row 103 外
  assert.equal(g.phase, 'playing');
  g.handleTouch('Floor', 19, 104); // 邊界內
  assert.equal(g.phase, 'paused');
});

test('paused → MARK slot = resume → 回到 playing, gameStartMs 推後扣除暫停時間', async () => {
  const g = newStartedGame();
  const originalStart = g.gameStartMs;
  await new Promise(r => setTimeout(r, 20));
  g.handleTouch('Floor', ...PAUSE_CHIP);
  assert.equal(g.phase, 'paused');
  await new Promise(r => setTimeout(r, 50));
  g.handleTouch('Floor', ...MARK_CHIP);
  assert.equal(g.phase, 'playing');
  assert.equal(g.pausedAt, null);
  assert.ok(g.gameStartMs > originalStart);
});

test('paused → SCAN slot = abort → 回到 idle', () => {
  const g = newStartedGame();
  g.handleTouch('Floor', ...PAUSE_CHIP);
  assert.equal(g.phase, 'paused');
  g.handleTouch('Floor', ...SCAN_CHIP);
  assert.equal(g.phase, 'idle');
  assert.equal(g.gameStartMs, null);
  assert.equal(g.pausedAt, null);
});

test('paused 時牆面 / 中央按鈕 / Floor 非按鈕區 / Entrance 都被忽略', () => {
  const g = newStartedGame();
  g.handleTouch('Floor', ...PAUSE_CHIP);
  assert.equal(g.phase, 'paused');
  g.handleTouch('Wall Top', 8, 12);
  assert.equal(g.phase, 'paused');
  g.handleTouch('Floor', ...CENTER_CHIP); // center button inert during paused
  assert.equal(g.phase, 'paused');
  g.handleTouch('Floor', 5, 5);
  assert.equal(g.phase, 'paused');
  g.handleTouch('Entrance', 0, 0);
  assert.equal(g.phase, 'paused');
});
