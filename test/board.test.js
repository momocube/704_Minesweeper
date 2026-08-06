import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBoard, sensorToBoardId, isReservedCell,
  RESERVED_TOP_ROWS, FACE_RESERVED_SIDE,
} from '../server/board.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const venue = JSON.parse(await readFile(resolve(ROOT, 'config/venue-704.json'), 'utf8'));
const topology = JSON.parse(await readFile(resolve(ROOT, 'config/board-topology.json'), 'utf8'));

const EXPECTED_GRID = {
  'Wall Left':         [10, 32],
  'Wall Top':          [22, 10],
  'Wall Right Big':    [10, 20],
  'Wall Right little': [10,  4],
  'Wall Button':       [22, 10],
};

function reservedCount(side, depth, cols, rows) {
  switch (side) {
    case 'top': case 'bottom': return cols * depth;
    case 'left': case 'right': return rows * depth;
    default: return 0;
  }
}
const expectedGameCells = Object.entries(EXPECTED_GRID).reduce((sum, [name, [c, r]]) => {
  return sum + c * r - reservedCount(FACE_RESERVED_SIDE[name], RESERVED_TOP_ROWS, c, r);
}, 0);

test(`物理頂 reserved=${RESERVED_TOP_ROWS} 後總遊戲格 = ${expectedGameCells}`, () => {
  const { cells } = buildBoard(venue, topology, { mineRate: 0.15, seed: 1 });
  assert.equal(cells.length, expectedGameCells);
});

test('每面 grid 維度 OK + reserved 在正確的邊 (per-face)', () => {
  const { faceMap } = buildBoard(venue, topology, { mineRate: 0.15, seed: 1 });
  for (const [name, [c, r]] of Object.entries(EXPECTED_GRID)) {
    const fm = faceMap.get(name);
    assert.equal(fm.boardCols, c, `${name} cols`);
    assert.equal(fm.boardRows, r, `${name} rows`);
    assert.equal(fm.reservedSide, FACE_RESERVED_SIDE[name], `${name} reservedSide`);
    // 逐格 check: reserved 的位置 = null,non-reserved 的位置 = number id
    for (let cc = 0; cc < c; cc++) {
      for (let rr = 0; rr < r; rr++) {
        const shouldReserved = isReservedCell(fm.reservedSide, RESERVED_TOP_ROWS, cc, rr, c, r);
        if (shouldReserved) {
          assert.equal(fm.grid[cc][rr], null, `${name}[${cc}][${rr}] should be reserved (null)`);
        } else {
          assert.equal(typeof fm.grid[cc][rr], 'number', `${name}[${cc}][${rr}] should have cell id`);
        }
      }
    }
  }
});

test('鄰居關係對稱', () => {
  const { cells } = buildBoard(venue, topology, { mineRate: 0.15, seed: 1 });
  for (const cell of cells) {
    for (const nid of cell.neighbors) {
      assert.ok(cells[nid].neighbors.includes(cell.id),
        `cell ${cell.id} → ${nid} but ${nid} doesn't link back`);
    }
  }
});

test('鄰居清單沒有重複/null/self', () => {
  const { cells } = buildBoard(venue, topology, { mineRate: 0.15, seed: 1 });
  for (const cell of cells) {
    assert.ok(!cell.neighbors.includes(null), `cell ${cell.id} has null neighbor`);
    const set = new Set(cell.neighbors);
    assert.equal(set.size, cell.neighbors.length, `cell ${cell.id} has duplicate neighbors`);
    assert.ok(!cell.neighbors.includes(cell.id), `cell ${cell.id} links to itself`);
  }
});

test('面內 interior cell 鄰居數 = 8 (Wall Top.grid[5][5])', () => {
  const { cells, faceMap } = buildBoard(venue, topology, { mineRate: 0.15, seed: 1 });
  const fm = faceMap.get('Wall Top');
  const interior = cells[fm.grid[5][5]];
  assert.equal(interior.neighbors.length, 8);
});

test('5 面跨面接合都連通 (BFS 從任一格能走到全部 800 格)', () => {
  const { cells } = buildBoard(venue, topology, { mineRate: 0.15, seed: 1 });
  const seen = new Set([cells[0].id]);
  const queue = [cells[0].id];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    for (const nid of cells[id].neighbors) {
      if (!seen.has(nid)) { seen.add(nid); queue.push(nid); }
    }
  }
  assert.equal(seen.size, cells.length, '所有 game cells 應該都在同一連通元件 (HUD reserved 不破壞連通性)');
});

test('Wall Top.col=0,row=2 跨面連到 Wall Left.row=0,col=2 (物理頂同高度)', () => {
  const { cells, faceMap } = buildBoard(venue, topology, { mineRate: 0.15, seed: 1 });
  const wt = faceMap.get('Wall Top');
  const wl = faceMap.get('Wall Left');
  const wtId = wt.grid[0][2]; // first game cell at Wall Top.col=0
  const wlId = wl.grid[2][0]; // first game cell at Wall Left.row=0 (col 0,1 reserved)
  assert.notEqual(wtId, null);
  assert.notEqual(wlId, null);
  assert.ok(cells[wtId].neighbors.includes(wlId),
    'Wall Top 物理頂下兩格 應該連到 Wall Left 物理頂下兩格');
});

test('牆角接合處對角鄰居也要連 (8-connectivity across seam, not 4)', () => {
  const { cells, faceMap } = buildBoard(venue, topology, { mineRate: 0.15, seed: 1 });
  const wt = faceMap.get('Wall Top');
  const wl = faceMap.get('Wall Left');
  // Wall Top.col=0 seam column joins Wall Left.row=0 seam row (edge 1, reverse=false).
  // A mid-seam Wall Top cell should reach the across cell PLUS the two diagonals on Wall Left.
  const wtMid = cells[wt.grid[0][5]]; // rows 2..9 valid → row 5 is interior of the seam
  const across = wl.grid[5][0];       // same height across the corner
  const diagUp = wl.grid[4][0];       // one step up along the corner
  const diagDn = wl.grid[6][0];       // one step down along the corner
  assert.ok(wtMid.neighbors.includes(across), '應連到正對面格');
  assert.ok(wtMid.neighbors.includes(diagUp), '應連到上方對角格');
  assert.ok(wtMid.neighbors.includes(diagDn), '應連到下方對角格');
  // Full 8: 5 in-face (col 1 三格 + col 0 上下兩格) + 3 cross-seam
  assert.equal(wtMid.neighbors.length, 8, '牆角中段格鄰居數應為 8');
});

test('四個牆角接合處的中段格鄰居數都 = 8 (對角有連上)', () => {
  const { cells, faceMap } = buildBoard(venue, topology, { mineRate: 0.15, seed: 1 });
  // Interior (non-end) seam cell on each of the four wall corners must be full 8-connected.
  // The two extreme ends (ceiling side / floor side) legitimately have fewer, because the
  // reserved HUD rows and the non-board Floor eat into their neighbourhood.
  const midCells = [
    ['Wall Top',    0,  5], // ↔ Wall Left top
    ['Wall Top',    21, 5], // ↔ Wall Right Big top
    ['Wall Button', 0,  4], // ↔ Wall Left bottom
    ['Wall Button', 21, 4], // ↔ Wall Right little bottom
  ];
  for (const [name, col, row] of midCells) {
    const fm = faceMap.get(name);
    const id = fm.grid[col][row];
    assert.notEqual(id, null, `${name}[${col}][${row}] should be a game cell`);
    assert.equal(cells[id].neighbors.length, 8,
      `${name} 牆角中段格 [${col}][${row}] 鄰居數 = ${cells[id].neighbors.length}, 應為 8`);
  }
});

test('跨面配對的物理高度對齊 (reverse 旗標設反會被抓出來)', () => {
  const { cells, faceMap } = buildBoard(venue, topology, { mineRate: 0.15, seed: 1 });
  // "depth" = distance from the wall's PHYSICAL ceiling. The reserved side is always
  // the ceiling side, so depth runs ceiling → floor on every face.
  const depthOf = (cell) => {
    const fm = faceMap.get(cell.faceName);
    switch (FACE_RESERVED_SIDE[cell.faceName]) {
      case 'top':    return cell.row;
      case 'bottom': return fm.boardRows - 1 - cell.row;
      case 'left':   return cell.col;
      case 'right':  return fm.boardCols - 1 - cell.col;
      default:       throw new Error(`no reserved side for ${cell.faceName}`);
    }
  };
  // Two cells joined across a corner must sit at the same height (orthogonal) or one
  // step apart (diagonal). A flipped `reverse` mirrors the seam — neighbour COUNTS
  // still look right, but cells get wired to the wrong partner. This catches that.
  let pairs = 0;
  for (const cell of cells) {
    for (const nid of cell.neighbors) {
      const n = cells[nid];
      if (n.faceName === cell.faceName) continue;
      pairs++;
      const d = Math.abs(depthOf(cell) - depthOf(n));
      assert.ok(d <= 1,
        `接錯格: ${cell.faceName}[${cell.col},${cell.row}](h=${depthOf(cell)}) <-> ` +
        `${n.faceName}[${n.col},${n.row}](h=${depthOf(n)}) Δ=${d}`);
    }
  }
  // 5 seams × 8 cells, each linking to up to 3 across (ends clamp to 2)
  // = 5 × 22 unique pairs × 2 directions = 220
  assert.equal(pairs, 220, '跨面配對總數');
});

test('sensorToBoardId: 落在 reserved 位置 → null (Wall Top top, Wall Left left, Wall Button bottom)', () => {
  const { faceMap } = buildBoard(venue, topology, { mineRate: 0.15, seed: 1 });
  // Wall Top reserved = top rows (0,1), sensor rows 0..7
  assert.equal(sensorToBoardId('Wall Top', 4, 0, faceMap), null);
  assert.equal(sensorToBoardId('Wall Top', 4, 7, faceMap), null);
  assert.notEqual(sensorToBoardId('Wall Top', 4, 8, faceMap), null);

  // Wall Left reserved = left cols (0,1), sensor cols 0..3
  assert.equal(sensorToBoardId('Wall Left', 0, 50, faceMap), null);
  assert.equal(sensorToBoardId('Wall Left', 3, 50, faceMap), null);
  assert.notEqual(sensorToBoardId('Wall Left', 4, 50, faceMap), null);

  // Wall Button reserved = bottom rows (8,9), sensor rows 32..39 (8..9 board rows × 4 chips)
  assert.equal(sensorToBoardId('Wall Button', 10, 32, faceMap), null);
  assert.equal(sensorToBoardId('Wall Button', 10, 39, faceMap), null);
  assert.notEqual(sensorToBoardId('Wall Button', 10, 31, faceMap), null);

  // Wall Right Big reserved = right cols (8,9), sensor cols 16..19
  assert.equal(sensorToBoardId('Wall Right Big', 16, 10, faceMap), null);
  assert.equal(sensorToBoardId('Wall Right Big', 19, 10, faceMap), null);
  assert.notEqual(sensorToBoardId('Wall Right Big', 15, 10, faceMap), null);
});

test('地雷數 = mineRate × total(四捨五入)', () => {
  const { cells, mineCount } = buildBoard(venue, topology, { mineRate: 0.15, seed: 1 });
  assert.equal(mineCount, Math.round(expectedGameCells * 0.15));
  const actualMines = cells.filter(c => c.mine).length;
  assert.equal(actualMines, mineCount);
});

test('adjacent 數字 = 鄰居中雷數', () => {
  const { cells } = buildBoard(venue, topology, { mineRate: 0.15, seed: 1 });
  for (const cell of cells) {
    const actual = cell.neighbors.filter(nid => cells[nid].mine).length;
    assert.equal(cell.adjacent, actual, `cell ${cell.id} adjacent mismatch`);
  }
});

test('seed 一致 → 板局一致', () => {
  const a = buildBoard(venue, topology, { mineRate: 0.15, seed: 42 });
  const b = buildBoard(venue, topology, { mineRate: 0.15, seed: 42 });
  for (let i = 0; i < a.cells.length; i++) {
    assert.equal(a.cells[i].mine, b.cells[i].mine, `cell ${i} mismatch`);
  }
});
