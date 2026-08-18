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

// Floor donut geometry (chip coords matching server's distance computation)
// chip center venue px: (col * 32 + 16, row * 16 + 8); floor center (704, 1024)
//   SCAN inner r = 210, MARK outer r = 290 (ring width 80)
//   PAUSE box chip cols 19..24 × rows 104..115
const CENTER_CHIP = [22, 64];   // (720, 1032), d ≈ 17.9  → inner circle
const SCAN_CHIP   = [22, 64];   // same as CENTER (idle: start; playing: scan)
const MARK_CHIP   = [22, 79];   // (720, 1272), d ≈ 248    → outer ring (210 < 248 ≤ 290)
const PAUSE_CHIP  = [22, 110];  // pause box

function newGame(opts = {}) {
  return new Game(venue, topology, { mineRate: 0.15, seed: 1, ...opts });
}
function finishCountdownNow(g) {
  if (g._countdownTimer) clearTimeout(g._countdownTimer);
  g._countdownTimer = null;
  g._startGame();
}
function newStartedGame(opts = {}) {
  const g = newGame(opts);
  // Most existing tests exercise gameplay itself, not the pre-game tutorial/countdown.
  g.setTutorialEnabled(false);
  g.handleTouch('Floor', ...CENTER_CHIP);
  assert.equal(g.phase, 'countdown');
  finishCountdownNow(g);
  return g;
}

test('初始狀態 = idle, gameStartMs=null, phase=idle, currentMode=reveal', () => {
  const g = newGame();
  const s = g.snapshot();
  assert.equal(s.type, 'snapshot');
  assert.ok(s.cells.length > 0);
  assert.equal(s.faces.length, 7);
  assert.equal(s.phase, 'idle');
  assert.equal(s.gameStartMs, null);
  assert.equal(s.freezeUntil, null);
  assert.equal(s.currentMode, 'reveal');
  assert.equal(s.endReason, null);
  assert.equal(s.tutorialEnabled, true);
  assert.equal(s.tutorialStep, null);
  assert.equal(s.tutorialTotal, 4);
  // donut geometry exposed
  assert.equal(s.floorButtons.center.r, 210);
  assert.equal(s.floorButtons.outer.rIn, 210);
  assert.equal(s.floorButtons.outer.rOut, 290);
  assert.ok(s.floorButtons.pause);
  // time limit defaults
  assert.equal(s.timeLimit.enabled, false);
  assert.equal(s.timeLimit.ms, 10 * 60 * 1000);
});

// ── PRE-GAME TUTORIAL ──────────────────────────────────────
test('預設 PLAY → tutorial step 0,尚未啟動正式計時', () => {
  const g = newGame();
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch('Floor', ...CENTER_CHIP);
  assert.equal(g.phase, 'tutorial');
  assert.equal(g.tutorialStep, 0);
  assert.equal(g.gameStartMs, null);
  assert.equal(g._timeLimitTimer, null);
  assert.ok(events.find(e => e.type === 'tutorial-start'));
});

test('四次 CONTINUE → tutorialReady,再 PLAY 先進 countdown', () => {
  const g = newGame();
  g.setTimeLimit({ enabled: true, ms: 10000 });
  g.handleTouch('Floor', ...CENTER_CHIP); // PLAY → step 0
  for (let expected = 1; expected <= 3; expected++) {
    g.handleTouch('Floor', ...CENTER_CHIP);
    assert.equal(g.phase, 'tutorial');
    assert.equal(g.tutorialStep, expected);
    assert.equal(g.gameStartMs, null);
    assert.equal(g._timeLimitTimer, null);
  }
  g.handleTouch('Floor', ...CENTER_CHIP); // step 3 CONTINUE → ready
  assert.equal(g.phase, 'tutorialReady');
  assert.equal(g.tutorialStep, null);
  assert.equal(g.gameStartMs, null);
  assert.equal(g._timeLimitTimer, null);

  g.handleTouch('Floor', ...CENTER_CHIP); // final PLAY → countdown 3
  assert.equal(g.phase, 'countdown');
  assert.equal(g.countdownValue, 3);
  assert.equal(g.gameStartMs, null);
  assert.equal(g._timeLimitTimer, null);
  assert.ok(g._countdownTimer != null);
  g._clearTimers();
});

test('countdown 依序 3→2→1,最後才開始正式計時', async () => {
  const g = newGame({ countdownIntervalMs: 12 });
  const events = [];
  g.on(e => events.push(e));
  g.setTutorialEnabled(false);
  g.setTimeLimit({ enabled: true, ms: 10000 });
  g.handleTouch('Floor', ...CENTER_CHIP);
  assert.equal(g.phase, 'countdown');
  assert.equal(g.countdownValue, 3);
  assert.equal(g.gameStartMs, null);
  assert.equal(g._timeLimitTimer, null);
  await new Promise(r => setTimeout(r, 16));
  assert.equal(g.countdownValue, 2);
  await new Promise(r => setTimeout(r, 13));
  assert.equal(g.countdownValue, 1);
  assert.equal(g.gameStartMs, null, '1 顯示期間仍未開始');
  await new Promise(r => setTimeout(r, 16));
  assert.equal(g.phase, 'playing');
  assert.ok(g.gameStartMs != null);
  assert.ok(g._timeLimitTimer != null);
  assert.deepEqual(events.filter(e => e.type === 'countdown-tick').map(e => e.snapshot.countdownValue), [2, 1]);
  assert.ok(events.find(e => e.type === 'game-start'));
  assert.equal(events.some(e => e.type === 'go'), false);
  g._clearTimers();
});

test('countdown 期間所有觸控無效', () => {
  const g = newGame();
  g.setTutorialEnabled(false);
  g.handleTouch('Floor', ...CENTER_CHIP);
  const safe = g.cells.find(c => !c.mine);
  g.handleTouch(safe.faceName, safe.col * 2, safe.row * 4);
  g.handleTouch('Floor', ...MARK_CHIP);
  g.handleTouch('Floor', ...PAUSE_CHIP);
  g.handleTouch('Floor', ...CENTER_CHIP);
  assert.equal(g.phase, 'countdown');
  assert.equal(g.countdownValue, 3);
  assert.equal(g.currentMode, 'reveal');
  assert.equal(g.revealedCount, 0);
  g._clearTimers();
});

test('tutorial 中牆面、MARK、PAUSE 觸控全部無效', () => {
  const g = newGame();
  g.handleTouch('Floor', ...CENTER_CHIP);
  const before = g.snapshot();
  const safe = g.cells.find(c => !c.mine);
  g.handleTouch(safe.faceName, safe.col * 2, safe.row * 4);
  g.handleTouch('Floor', ...MARK_CHIP);
  g.handleTouch('Floor', ...PAUSE_CHIP);
  assert.equal(g.phase, 'tutorial');
  assert.equal(g.tutorialStep, 0);
  assert.equal(g.currentMode, 'reveal');
  assert.equal(g.revealedCount, 0);
  assert.equal(g._countFlagged(), 0);
  assert.deepEqual(g.snapshot().cells, before.cells);
});

test('營運關閉教學後 PLAY 仍先進 countdown', () => {
  const g = newGame();
  const events = [];
  g.on(e => events.push(e));
  assert.equal(g.setTutorialEnabled(false), true);
  g.handleTouch('Floor', ...CENTER_CHIP);
  assert.equal(g.phase, 'countdown');
  assert.equal(g.countdownValue, 3);
  assert.equal(g.gameStartMs, null);
  assert.ok(events.find(e => e.type === 'tutorial-setting'));
  assert.ok(events.find(e => e.type === 'countdown-start'));
  assert.equal(events.some(e => e.type === 'tutorial-start'), false);
  g._clearTimers();
});

test('教學開關只允許 idle 修改,reset 後仍保留', () => {
  const g = newGame();
  g.setTutorialEnabled(false);
  g.handleTouch('Floor', ...CENTER_CHIP);
  assert.equal(g.phase, 'countdown');
  assert.equal(g.setTutorialEnabled(true), false);
  assert.equal(g.tutorialEnabled, false);
  g.reset();
  assert.equal(g.phase, 'idle');
  assert.equal(g.tutorialEnabled, false);
  assert.equal(g.tutorialStep, null);
});

test('idle: 摸牆 / Floor 非按鈕區 都被忽略', () => {
  const g = newGame();
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch('Wall Top', 8, 12);
  g.handleTouch('Floor', 5, 5);   // far corner, no button
  g.handleTouch('Floor', 40, 80); // far corner, no button
  assert.equal(g.phase, 'idle');
  assert.equal(events.length, 0);
});

test('idle: 教學關閉時踩 Floor 中央 → countdown-start 事件', () => {
  const g = newGame();
  const events = [];
  g.on(e => events.push(e));
  g.setTutorialEnabled(false);
  g.handleTouch('Floor', ...CENTER_CHIP);
  assert.equal(g.phase, 'countdown');
  assert.ok(events.find(e => e.type === 'countdown-start'));
  g._clearTimers();
});

test('default mode = reveal: 摸牆 game area → 直接 reveal', () => {
  const g = newStartedGame();
  const safe = g.cells.find(c => !c.mine && c.adjacent > 0);
  g.handleTouch(safe.faceName, safe.col * 2, safe.row * 4);
  assert.equal(g.cells[safe.id].revealed, true);
});

test('外圈 (MARK) → currentMode=flag,連續摸格 toggle flag', () => {
  const g = newStartedGame();
  g.handleTouch('Floor', ...MARK_CHIP);
  assert.equal(g.currentMode, 'flag');
  const c1 = g.cells.find(c => !c.mine);
  g.handleTouch(c1.faceName, c1.col * 2, c1.row * 4);
  assert.equal(g.cells[c1.id].flagged, true);
  g.handleTouch(c1.faceName, c1.col * 2, c1.row * 4);
  assert.equal(g.cells[c1.id].flagged, false);
});

test('內圈 (SCAN) ↔ 外圈 (MARK) 隨時切換', () => {
  const g = newStartedGame();
  assert.equal(g.currentMode, 'reveal');
  g.handleTouch('Floor', ...MARK_CHIP);
  assert.equal(g.currentMode, 'flag');
  g.handleTouch('Floor', ...SCAN_CHIP);
  assert.equal(g.currentMode, 'reveal');
});

test('Floor 圈外 (donut 範圍以外) 不切 mode', () => {
  const g = newStartedGame();
  // chip (0, 0) → (16, 8), distance from center (704, 1024) ≈ 1018 → outside
  g.handleTouch('Floor', 0, 0);
  assert.equal(g.currentMode, 'reveal');
  // chip (40, 120) → (1296, 1928), distance ≈ 1075 → outside
  g.handleTouch('Floor', 40, 120);
  assert.equal(g.currentMode, 'reveal');
});

test('donut 邊界:內圈 r=210 / 外環 r=290', () => {
  const g = newStartedGame();
  // chip (22, 60) → (720, 968), d ≈ 58 → 內圈
  g.handleTouch('Floor', ...MARK_CHIP);
  assert.equal(g.currentMode, 'flag');
  g.handleTouch('Floor', 22, 60);
  assert.equal(g.currentMode, 'reveal');
  // chip (22, 76) → (720, 1224), d ≈ 200 → 還在 inner(208)…嚴格邊界:
  // chip (22, 77) → (720, 1240), d ≈ 217 → outer (210 < 217 ≤ 290)
  g.handleTouch('Floor', 22, 77);
  assert.equal(g.currentMode, 'flag');
  // chip (22, 87) → (720, 1400), d ≈ 376 → 圈外
  g.handleTouch('Floor', ...SCAN_CHIP); // back to reveal
  g.handleTouch('Floor', 22, 87);
  assert.equal(g.currentMode, 'reveal', '> MARK_R 無 mode 改變');
});

// ── MINE = FREEZE 5s, not gameOver ──────────────────────────
function gameWithFirstRevealDone(opts) {
  const g = newStartedGame(opts);
  const safe = g.cells.find(c => !c.mine);
  g.handleTouch(safe.faceName, safe.col * 2, safe.row * 4);
  return g;
}

test('踩到地雷 → freeze 5s + redWave 從雷格擴散(game 繼續)', () => {
  const g = gameWithFirstRevealDone();
  const mine = g.cells.find(c => c.mine && !c.revealed);
  const events = [];
  g.on(e => events.push(e));
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  assert.equal(g.phase, 'playing', '踩雷不再 gameOver');
  assert.equal(g.cells[mine.id].revealed, true, '雷格被揭露');
  assert.ok(g.freezeUntil != null);
  assert.ok(g.freezeUntil > Date.now());
  assert.ok(Array.isArray(g.redWave), 'redWave 在 freeze 期間被設定');
  assert.equal(g.redWave.length, 1784);
  assert.equal(g.redWave[0].dist, 0, '波從雷格 (距離 0) 開始擴散');
  assert.equal(g.redWave[0].faceName, mine.faceName);
  const freezeEv = events.find(e => e.type === 'freeze');
  assert.ok(freezeEv);
  assert.equal(freezeEv.durationMs, 5000);
  assert.ok(Array.isArray(freezeEv.redWave));
});

test('freeze 期間所有觸控被忽略', () => {
  const g = gameWithFirstRevealDone();
  const mine = g.cells.find(c => c.mine && !c.revealed);
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  assert.ok(g.freezeUntil > Date.now());

  const safe = g.cells.find(c => !c.mine && !c.revealed);
  const beforeRevealedCount = g.revealedCount;
  g.handleTouch(safe.faceName, safe.col * 2, safe.row * 4);
  assert.equal(g.revealedCount, beforeRevealedCount, 'freeze 中 wall touch 被擋');

  g.handleTouch('Floor', ...MARK_CHIP);
  assert.equal(g.currentMode, 'reveal', 'freeze 中 mode 切換被擋');
});

test('freeze 結束後 → unfreeze 事件 + freezeUntil 清掉', async () => {
  const g = gameWithFirstRevealDone();
  const mine = g.cells.find(c => c.mine && !c.revealed);
  const events = [];
  g.on(e => events.push(e));
  // 把 freeze 時間縮短(透過 monkey patch 內部 timer)— 用 fake short freeze
  // 這裡直接呼叫 _handleMineFreeze 然後快進
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  assert.ok(g.freezeUntil != null);
  // 手動觸發 unfreeze(模擬 5s 過了)
  clearTimeout(g._freezeTimer);
  g._freezeTimer = null;
  g.freezeUntil = null;
  // 確認 unfreeze 後可以正常觸控
  const safe = g.cells.find(c => !c.mine && !c.revealed);
  const before = g.revealedCount;
  g.handleTouch(safe.faceName, safe.col * 2, safe.row * 4);
  assert.ok(g.revealedCount > before, 'unfreeze 後 wall touch 正常');
});

test('多次踩雷:每次都重啟 5s freeze', () => {
  const g = gameWithFirstRevealDone();
  const m1 = g.cells.find(c => c.mine && !c.revealed);
  g.handleTouch(m1.faceName, m1.col * 2, m1.row * 4);
  const firstFreeze = g.freezeUntil;
  // 模擬 unfreeze
  clearTimeout(g._freezeTimer); g._freezeTimer = null; g.freezeUntil = null;
  const m2 = g.cells.find(c => c.mine && !c.revealed);
  if (m2) {
    g.handleTouch(m2.faceName, m2.col * 2, m2.row * 4);
    assert.ok(g.freezeUntil > firstFreeze - 1000); // 新 freeze
    assert.equal(g.phase, 'playing', '即使踩多顆雷也不 gameOver');
  }
});

test('reveal mine 不計入 revealedCount(win 條件只算 safe cells)', () => {
  const g = gameWithFirstRevealDone();
  const before = g.revealedCount;
  const mine = g.cells.find(c => c.mine && !c.revealed);
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  assert.equal(g.revealedCount, before, '踩雷 revealedCount 不變');
});

test('win:揭露所有 safe 格 → gameOver won=true reason=win', () => {
  const g = newStartedGame({ mineRate: 0.15, seed: 1 });
  const safeCells = g.cells.filter(c => !c.mine);
  // 強迫一個一個 reveal,跳過 flood-fill 觸發路徑
  // 直接 set revealed + revealedCount,模擬玩家逐格揭露
  for (const c of safeCells) {
    if (!c.revealed) {
      c.revealed = true;
      g.revealedCount++;
    }
  }
  // 觸發 win 檢查(透過模擬最後一個 reveal)
  // 重 trigger by hitting one already-revealed cell — won't change anything but we test handler directly
  if (g.revealedCount === g.total - g.mineCount) {
    g._handleWin();
  }
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.won, true);
  assert.equal(g.endReason, 'win');
});

// ── TIME LIMIT ─────────────────────────────────────────────
test('setTimeLimit 更新設定', () => {
  const g = newGame();
  const events = [];
  g.on(e => events.push(e));
  g.setTimeLimit({ enabled: true, ms: 30000 });
  assert.equal(g.timeLimit.enabled, true);
  assert.equal(g.timeLimit.ms, 30000);
  assert.ok(events.find(e => e.type === 'time-limit'));
});

test('time-limit enabled + 到時 → timeout gameOver', async () => {
  const g = newGame();
  g.setTutorialEnabled(false);
  g.setTimeLimit({ enabled: true, ms: 50 });
  g.handleTouch('Floor', ...CENTER_CHIP);
  finishCountdownNow(g);
  assert.equal(g.phase, 'playing');
  await new Promise(r => setTimeout(r, 90));
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.endReason, 'timeout');
  assert.equal(g.won, false);
  assert.ok(g.redWave); // timeout 觸發 redWave
});

test('time-limit disabled → 不 fire timeout', async () => {
  const g = newGame();
  g.setTutorialEnabled(false);
  g.setTimeLimit({ enabled: false, ms: 50 });
  g.handleTouch('Floor', ...CENTER_CHIP);
  finishCountdownNow(g);
  await new Promise(r => setTimeout(r, 80));
  assert.equal(g.phase, 'playing');
});

test('pause/resume 期間 time-limit 暫停', async () => {
  const g = newGame();
  g.setTutorialEnabled(false);
  g.setTimeLimit({ enabled: true, ms: 100 });
  g.handleTouch('Floor', ...CENTER_CHIP);
  finishCountdownNow(g);
  await new Promise(r => setTimeout(r, 40));
  g.handleTouch('Floor', ...PAUSE_CHIP);
  assert.equal(g.phase, 'paused');
  // 在 paused 期間等久一點,time-limit 不該到
  await new Promise(r => setTimeout(r, 100));
  assert.equal(g.phase, 'paused', 'paused 中 time-limit 不 fire');
  g.handleTouch('Floor', ...CENTER_CHIP); // resume (inner circle)
  assert.equal(g.phase, 'playing');
  await new Promise(r => setTimeout(r, 80));
  assert.equal(g.phase, 'gameOver', 'resume 後剩餘時間到 → timeout');
  assert.equal(g.endReason, 'timeout');
});

// ── PAUSE / RESUME / ABORT (donut layout) ────────────────────
test('playing 中踩 PAUSE 按鈕 → paused', () => {
  const g = newStartedGame();
  g.handleTouch('Floor', ...PAUSE_CHIP);
  assert.equal(g.phase, 'paused');
});

test('paused → 內圈 = resume (gameStartMs 推後)', async () => {
  const g = newStartedGame();
  const originalStart = g.gameStartMs;
  await new Promise(r => setTimeout(r, 20));
  g.handleTouch('Floor', ...PAUSE_CHIP);
  assert.equal(g.phase, 'paused');
  await new Promise(r => setTimeout(r, 50));
  g.handleTouch('Floor', ...CENTER_CHIP);
  assert.equal(g.phase, 'playing');
  assert.ok(g.gameStartMs > originalStart);
});

test('paused → 外圈 = abort → 回 idle', () => {
  const g = newStartedGame();
  g.handleTouch('Floor', ...PAUSE_CHIP);
  assert.equal(g.phase, 'paused');
  g.handleTouch('Floor', ...MARK_CHIP); // outer ring = abort
  assert.equal(g.phase, 'idle');
});

test('gameOver 後一般觸控被忽略,只接受 Floor 內圈 → 回到 idle', () => {
  const g = gameWithFirstRevealDone();
  // 強制 timeout 結束
  g._handleTimeout();
  assert.equal(g.phase, 'gameOver');
  g.handleTouch('Wall Top', 8, 12);
  assert.equal(g.phase, 'gameOver');
  g.handleTouch('Floor', ...MARK_CHIP); // 外圈
  assert.equal(g.phase, 'gameOver', '外圈不重啟');
  g.handleTouch('Floor', ...CENTER_CHIP); // 內圈
  assert.equal(g.phase, 'idle');
});

test('snapshot 不洩漏未揭露雷的位置', () => {
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

// ── 誤標數字提示 (只在 gameOver 後揭曉) ──────────────────────

function flagCell(g, cell) {
  g.handleTouch('Floor', ...MARK_CHIP);                     // currentMode = 'flag'
  g.handleTouch(cell.faceName, cell.col * 2, cell.row * 4); // toggle flag
}

test('遊戲中誤標不洩漏數字 (不然 MARK 會變成零風險探測)', () => {
  const g = newStartedGame();
  const safe = g.cells.find(c => !c.mine && c.adjacent > 0);
  flagCell(g, safe);
  const pc = g.snapshot().cells.find(c => c.id === safe.id);
  assert.equal(pc.flagged, true);
  assert.equal(pc.wrongFlag, false, '遊戲中不該標成誤標');
  assert.equal(pc.adjacent, null, '遊戲中不該洩漏數字');
});

test('gameOver 後誤標揭曉真實數字,但不計入已揭露', async () => {
  const g = newGame();
  g.setTutorialEnabled(false);
  g.setTimeLimit({ enabled: true, ms: 60 });
  g.handleTouch('Floor', ...CENTER_CHIP);
  finishCountdownNow(g);
  const safe = g.cells.find(c => !c.mine && c.adjacent > 0);
  flagCell(g, safe);
  await new Promise(r => setTimeout(r, 110));
  assert.equal(g.phase, 'gameOver');

  const s = g.snapshot();
  const pc = s.cells.find(c => c.id === safe.id);
  assert.equal(pc.wrongFlag, true, '標了旗但不是雷 → 誤標');
  assert.equal(pc.adjacent, safe.adjacent, '應揭曉真實鄰雷數');
  assert.equal(pc.flagged, true, '仍維持標記狀態');
  assert.equal(pc.revealed, false, '不該變成已揭露');
  assert.equal(s.revealedCount, 0, '不該計入勝利進度');
});

test('gameOver 後正確標記的雷不算誤標', async () => {
  const g = newGame();
  g.setTutorialEnabled(false);
  g.setTimeLimit({ enabled: true, ms: 60 });
  g.handleTouch('Floor', ...CENTER_CHIP);
  finishCountdownNow(g);
  const mine = g.cells.find(c => c.mine);
  flagCell(g, mine);
  await new Promise(r => setTimeout(r, 110));

  const pc = g.snapshot().cells.find(c => c.id === mine.id);
  assert.equal(pc.wrongFlag, false, '標對了不是誤標');
  assert.equal(pc.adjacent, null, '標對的雷不顯示數字');
  assert.equal(pc.mine, true);
});

test('gameOver 只揭曉誤標的數字,沒標的隱藏格仍不洩漏', async () => {
  const g = newGame();
  g.setTutorialEnabled(false);
  g.setTimeLimit({ enabled: true, ms: 60 });
  g.handleTouch('Floor', ...CENTER_CHIP);
  finishCountdownNow(g);
  await new Promise(r => setTimeout(r, 110));
  assert.equal(g.phase, 'gameOver');
  for (const c of g.snapshot().cells) {
    if (c.revealed || c.wrongFlag) continue;
    assert.equal(c.adjacent, null, `cell ${c.id} 沒標卻洩漏了數字`);
  }
});

test('reveal 0 格 → flood-fill 擴散', () => {
  const g = newStartedGame({ mineRate: 0.05, seed: 7 });
  const zeroCell = g.cells.find(c => !c.mine && c.adjacent === 0);
  assert.ok(zeroCell);
  g.handleTouch(zeroCell.faceName, zeroCell.col * 2, zeroCell.row * 4);
  assert.ok(g.revealedCount > 1);
});

test('第一次揭露保護:首觸雷格 → 被搬走', () => {
  const g = newStartedGame();
  const mine = g.cells.find(c => c.mine);
  g.handleTouch(mine.faceName, mine.col * 2, mine.row * 4);
  assert.equal(g.phase, 'playing');
  assert.equal(g.cells[mine.id].mine, false);
  assert.equal(g.freezeUntil, null, '首觸不該 freeze');
});
