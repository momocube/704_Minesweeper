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

function newGame(opts = {}) {
  return new Game(venue, topology, { mineRate: 0.15, seed: 1, ...opts });
}

// 開新遊戲並按下中央開始按鈕進到 playing phase
function newStartedGame(opts = {}) {
  const g = newGame(opts);
  g.handleTouch('Floor', 22, 64); // chip center → start button area
  return g;
}

test('初始狀態 = idle, gameStartMs=null, phase=idle', () => {
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
});

test('idle: 摸牆 / Floor 半邊 都被忽略', () => {
  const g = newGame();
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch('Wall Top', 8, 12);
  g.handleTouch('Floor', 10, 50);
  g.handleTouch('Floor', 30, 50);
  assert.equal(g.phase, 'idle');
  assert.equal(g.lockedCellId, null);
  assert.equal(events.length, 0);
});

test('idle: 踩 Floor 中央按鈕 → phase=playing, gameStartMs 設定, game-start 事件', () => {
  const g = newGame();
  const events = [];
  g.on(e => events.push(e));
  const before = Date.now();
  g.handleTouch('Floor', 22, 64); // center button
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
  assert.equal(g.lockedCellId, null);
});

test('摸到各面 reserved 區域 → 無 lock event (Top/Bottom/Left/Right 4 個方向都檢查)', () => {
  const g = newStartedGame();
  // Wall Top: reserved top rows (sensor row 0..7)
  g.handleTouch('Wall Top', 4, 0);
  assert.equal(g.lockedCellId, null);
  // Wall Button: reserved bottom rows (sensor row 32..39)
  g.handleTouch('Wall Button', 4, 36);
  assert.equal(g.lockedCellId, null);
  // Wall Left: reserved left cols (sensor col 0..3)
  g.handleTouch('Wall Left', 2, 50);
  assert.equal(g.lockedCellId, null);
  // Wall Right Big: reserved right cols (sensor col 16..19)
  g.handleTouch('Wall Right Big', 18, 10);
  assert.equal(g.lockedCellId, null);
});

test('摸牆面 game area → 鎖定該格 (playing)', () => {
  const g = newStartedGame();
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch('Wall Top', 8, 12); // sensor (8,12) → board (4, 3) — game area
  assert.notEqual(g.lockedCellId, null);
  assert.equal(events[0].type, 'lock');
});

test('Floor 左半 → flag mode', () => {
  const g = newStartedGame();
  const target = g.cells.find(c => !c.mine);
  g.handleTouch(target.faceName, target.col * 2, target.row * 4);
  g.handleTouch('Floor', 10, 50);
  assert.equal(g.cells[target.id].flagged, true);
  assert.equal(g.lockedCellId, null);
});

test('Floor 右半 → reveal mode', () => {
  const g = newStartedGame();
  const target = g.cells.find(c => !c.mine);
  g.handleTouch(target.faceName, target.col * 2, target.row * 4);
  g.handleTouch('Floor', 30, 50);
  assert.equal(g.cells[target.id].revealed, true);
});

// helper: 第一次踩非雷格 (跳過 first-click safety),回傳的 game 進入「revealedCount > 0」狀態
function gameWithFirstRevealDone() {
  const g = newStartedGame();
  const safe = g.cells.find(c => !c.mine);
  g.handleTouch(safe.faceName, safe.col * 2, safe.row * 4);
  g.handleTouch('Floor', 30, 50);
  return g;
}

test('第一次揭露保護:第一次踩格 + 8 鄰居都不會是地雷 (即使本來是)', () => {
  const g = newStartedGame();
  // 強制踩一個本來是地雷的格
  const mine = g.cells.find(c => c.mine);
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  g.handleTouch('Floor', 30, 50);
  assert.equal(g.phase, 'playing', '第一次揭露雷格應該被搬走,沒 gameOver');
  assert.equal(g.cells[mine.id].mine, false, '原本的雷格已不是雷');
  for (const nid of g.cells[mine.id].neighbors) {
    assert.equal(g.cells[nid].mine, false, `鄰居 ${nid} 也不能是雷`);
  }
  // 總雷數沒變
  assert.equal(g.cells.filter(c => c.mine).length, g.mineCount);
});

test('gameEndMs 在 gameOver 時被設定,reset 後清掉', async () => {
  const g = gameWithFirstRevealDone();
  assert.equal(g.gameEndMs, null);
  const mine = g.cells.find(c => c.mine && !c.revealed);
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  g.handleTouch('Floor', 30, 50);
  assert.ok(g.gameEndMs != null);
  const frozen = g.gameEndMs;
  await new Promise(r => setTimeout(r, 30));
  assert.equal(g.gameEndMs, frozen);
  g.handleTouch('Floor', 22, 64);
  // 改了:gameOver 中央按鈕現在回到 idle (不是 auto-start)
  assert.equal(g.phase, 'idle');
  assert.equal(g.gameEndMs, null);
  assert.equal(g.gameStartMs, null);
});

test('reveal 雷 → gameOver + redWave 涵蓋整個場域 (含 HUD/Floor/Entrance)', () => {
  const g = gameWithFirstRevealDone();
  const mine = g.cells.find(c => c.mine && !c.revealed);
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  g.handleTouch('Floor', 30, 50);
  assert.equal(g.gameOver, true);
  assert.equal(g.bombCellId, mine.id);
  assert.ok(Array.isArray(g.redWave));
  // 計算預期 wave 長度:5 牆面 grid + Floor + Entrance,以 sensor/2 × sensor/4 為網格
  // Wall Left 10×32 + Wall Top 22×10 + Wall Right Big 10×20 + Wall Right little 10×4 + Wall Button 22×10
  // + Floor 22×32 + Entrance 10×8 = 320+220+200+40+220+704+80 = 1784
  assert.equal(g.redWave.length, 1784, 'redWave 應涵蓋所有面的整個 grid');
  // 第一個是炸彈格本身 (dist = 0)
  assert.equal(g.redWave[0].dist, 0);
  assert.equal(g.redWave[0].faceName, mine.faceName);
  assert.equal(g.redWave[0].col, mine.col);
  assert.equal(g.redWave[0].row, mine.row);
  // 排序遞增
  for (let i = 1; i < g.redWave.length; i++) {
    assert.ok(g.redWave[i].dist >= g.redWave[i-1].dist);
  }
  // game cells 都有 cellId,reserved/Floor/Entrance 是 null
  const withCellId = g.redWave.filter(w => w.cellId != null);
  assert.equal(withCellId.length, g.cells.length, 'game cells 都應該有 cellId');
});

test('gameOver 後一般觸控被忽略,只接受 Floor 中央按鈕 (現在 → 回到 idle,不 auto-start)', async () => {
  const g = gameWithFirstRevealDone();
  const mine = g.cells.find(c => c.mine && !c.revealed);
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  g.handleTouch('Floor', 30, 50);
  assert.equal(g.phase, 'gameOver');

  g.handleTouch('Wall Top', 8, 12);
  assert.equal(g.phase, 'gameOver', 'wall touch should not reset');

  g.handleTouch('Floor', 5, 5);
  assert.equal(g.phase, 'gameOver', 'Floor non-center touch should not reset');

  g.handleTouch('Floor', 22, 64); // center → 回到 idle
  assert.equal(g.phase, 'idle', 'gameOver center button → idle (not playing)');
  assert.equal(g.gameStartMs, null, 'gameStartMs cleared');
  assert.equal(g.gameEndMs, null, 'gameEndMs cleared');

  // 玩家必須再按 start
  g.handleTouch('Floor', 22, 64);
  assert.equal(g.phase, 'playing', 'idle center button → playing');
});

test('Restart 按鈕邊界: chips 19..24 × 58..69 (回 idle,不 auto-start)', () => {
  const g = gameWithFirstRevealDone();
  const mine = g.cells.find(c => c.mine && !c.revealed);
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  g.handleTouch('Floor', 30, 50);
  g.handleTouch('Floor', 18, 64);
  assert.equal(g.phase, 'gameOver');
  g.handleTouch('Floor', 19, 64);
  assert.equal(g.phase, 'idle');
});

test('Start 按鈕邊界相同 (idle 期間, chips 18 outside, 19 inside)', () => {
  const g = newGame();
  g.handleTouch('Floor', 18, 64);
  assert.equal(g.phase, 'idle', 'outside center → still idle');
  g.handleTouch('Floor', 19, 64);
  assert.equal(g.phase, 'playing', 'inside center → playing');
});

test('Floor 沒鎖定格時踩按鈕 → mode-feedback accepted=false', () => {
  const g = newStartedGame();
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch('Floor', 10, 50);
  const fb = events.find(e => e.type === 'mode-feedback');
  assert.ok(fb);
  assert.equal(fb.accepted, false);
});

test('reveal 0 格 → flood-fill 擴散', () => {
  const g = newStartedGame({ mineRate: 0.05, seed: 7 });
  const zeroCell = g.cells.find(c => !c.mine && c.adjacent === 0);
  assert.ok(zeroCell);
  g.handleTouch(zeroCell.faceName, zeroCell.col * 2, zeroCell.row * 4);
  g.handleTouch('Floor', 30, 50);
  assert.ok(g.revealedCount > 1);
});

// ── PAUSE / RESUME / ABORT ─────────────────────────────
test('playing 中踩 PAUSE 按鈕(chip 22, 110) → 進入 paused phase + pausedAt 設定', () => {
  const g = newStartedGame();
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch('Floor', 22, 110);
  assert.equal(g.phase, 'paused');
  assert.ok(g.pausedAt != null);
  assert.equal(events.find(e => e.type === 'pause')?.snapshot.phase, 'paused');
});

test('PAUSE 按鈕邊界 chip cols 19..24 × rows 104..115', () => {
  const g = newStartedGame();
  // 邊界外
  g.handleTouch('Floor', 18, 110);
  assert.equal(g.phase, 'playing', 'col 18 外側');
  g.handleTouch('Floor', 22, 103);
  assert.equal(g.phase, 'playing', 'row 103 外側');
  // 邊界內
  g.handleTouch('Floor', 19, 104);
  assert.equal(g.phase, 'paused', 'col 19 row 104 邊界內');
});

test('paused → 左半 = resume → 回到 playing,gameStartMs 推後扣除暫停時間', async () => {
  const g = newStartedGame();
  const originalStart = g.gameStartMs;
  await new Promise(r => setTimeout(r, 20));
  g.handleTouch('Floor', 22, 110); // pause
  assert.equal(g.phase, 'paused');
  const pausedAtBefore = g.pausedAt;
  await new Promise(r => setTimeout(r, 50));
  g.handleTouch('Floor', 10, 50); // 左半 → resume
  assert.equal(g.phase, 'playing');
  assert.equal(g.pausedAt, null);
  // gameStartMs 被推後了 (約 50ms),讓 elapsedMs 不算暫停那 50ms
  assert.ok(g.gameStartMs > originalStart, 'gameStartMs 應該被推後');
});

test('paused → 右半 = abort → 回到 idle', () => {
  const g = newStartedGame();
  g.handleTouch('Floor', 22, 110); // pause
  assert.equal(g.phase, 'paused');
  g.handleTouch('Floor', 30, 50); // 右半 → abort
  assert.equal(g.phase, 'idle');
  assert.equal(g.gameStartMs, null);
  assert.equal(g.pausedAt, null);
});

test('paused 時牆面 / 中央按鈕 / 其他面都被忽略', () => {
  const g = newStartedGame();
  g.handleTouch('Floor', 22, 110); // pause
  assert.equal(g.phase, 'paused');
  g.handleTouch('Wall Top', 8, 12);
  assert.equal(g.phase, 'paused');
  g.handleTouch('Wall Left', 5, 50);
  assert.equal(g.phase, 'paused');
  g.handleTouch('Entrance', 0, 0);
  assert.equal(g.phase, 'paused');
});
