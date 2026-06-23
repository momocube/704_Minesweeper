// 704 venue uses 直 (vertical) chip orientation everywhere:
//   chip pixel = 32 wide × 16 tall (canvas px)
//   big cell = 8 chips arranged 2 cols × 4 rows = 64 × 64 canvas px (square)
// per NangangProjection/Assets/_Script/Core/SensorFaceConfig.cs and VenuePresetConfig.cs (Size64)
export const SENSOR_PER_CELL_X = 2;
export const SENSOR_PER_CELL_Y = 4;

// 牆面「物理頂端」N 排不放格子(身高按不到),保留給 HUD 顯示計時器+分數
export const RESERVED_TOP_ROWS = 2;

// 每面在 704 展開圖的「物理頂」對應到 board 座標的哪一邊
// (展開圖往四方展開,每面的 outward edge 就是該面的物理頂)
export const FACE_RESERVED_SIDE = {
  'Wall Top':          'top',     // 展開圖 row 0 = 物理頂
  'Wall Button':       'bottom',  // 展開圖 row max = 物理頂(往下展開)
  'Wall Left':         'left',    // 展開圖 col 0 = 物理頂(往左展開)
  'Wall Right Big':    'right',   // 展開圖 col max = 物理頂(往右展開)
  'Wall Right little': 'right',
};

export function isReservedCell(reservedSide, depth, c, r, cols, rows) {
  switch (reservedSide) {
    case 'top':    return r < depth;
    case 'bottom': return r >= rows - depth;
    case 'left':   return c < depth;
    case 'right':  return c >= cols - depth;
    default:       return false;
  }
}

export function chipPx(face) {
  const ori = face.orientation;
  const isVertical = ori === 'vertical' || ori === '直' || ori === 1;
  return isVertical ? { cellW: 32, cellH: 16 } : { cellW: 16, cellH: 32 };
}

export function faceCanvasSize(face) {
  const { cellW, cellH } = chipPx(face);
  return { width: face.colCount * cellW, height: face.rowCount * cellH };
}

export const BOARD_FACE_NAMES = [
  'Wall Left', 'Wall Top', 'Wall Right Big', 'Wall Right little', 'Wall Button'
];

export const FLOOR_FACE_NAME = 'Floor';
export const ENTRANCE_FACE_NAME = 'Entrance';

export function buildBoard(venue, topology, options = {}) {
  const { mineRate = 0.15, seed = null } = options;

  const faceMap = new Map();
  const cells = [];
  let nextId = 0;

  for (const faceName of BOARD_FACE_NAMES) {
    const f = venue.faces.find(x => x.name === faceName);
    if (!f) throw new Error(`Missing face in venue: ${faceName}`);
    const boardCols = Math.floor(f.colCount / SENSOR_PER_CELL_X);
    const boardRows = Math.floor(f.rowCount / SENSOR_PER_CELL_Y);
    const reservedSide = FACE_RESERVED_SIDE[faceName] ?? 'top';
    const grid = Array.from({ length: boardCols }, () => new Array(boardRows).fill(null));
    for (let c = 0; c < boardCols; c++) {
      for (let r = 0; r < boardRows; r++) {
        if (isReservedCell(reservedSide, RESERVED_TOP_ROWS, c, r, boardCols, boardRows)) continue;
        const id = nextId++;
        grid[c][r] = id;
        cells.push({
          id, faceName, col: c, row: r,
          mine: false, revealed: false, flagged: false,
          adjacent: 0, neighbors: []
        });
      }
    }
    faceMap.set(faceName, {
      face: f, boardCols, boardRows, grid,
      reservedSide, reservedDepth: RESERVED_TOP_ROWS,
    });
  }

  for (const cell of cells) {
    const fm = faceMap.get(cell.faceName);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const nc = cell.col + dc, nr = cell.row + dr;
        if (nc < 0 || nc >= fm.boardCols || nr < 0 || nr >= fm.boardRows) continue;
        const nid = fm.grid[nc][nr];
        if (nid == null) continue;
        cell.neighbors.push(nid);
      }
    }
  }

  for (const edge of topology.edges ?? []) {
    addCrossFaceNeighbors(faceMap, cells, edge);
  }

  const rng = seed != null ? mulberry32(seed) : Math.random;
  const total = cells.length;
  const mineCount = Math.round(total * mineRate);
  const ids = cells.map(c => c.id);
  shuffle(ids, rng);
  for (let i = 0; i < mineCount; i++) cells[ids[i]].mine = true;

  for (const cell of cells) {
    cell.adjacent = cell.neighbors.reduce((s, nid) => s + (cells[nid].mine ? 1 : 0), 0);
  }

  return { cells, faceMap, mineCount, total };
}

export function sensorToBoardId(faceName, sensorCol, sensorRow, faceMap) {
  const fm = faceMap.get(faceName);
  if (!fm) return null;
  const c = Math.floor(sensorCol / SENSOR_PER_CELL_X);
  const r = Math.floor(sensorRow / SENSOR_PER_CELL_Y);
  if (c < 0 || c >= fm.boardCols || r < 0 || r >= fm.boardRows) return null;
  return fm.grid[c][r]; // null if reserved row
}

function edgeIndices(faceMeta, edge) {
  const { boardCols, boardRows, grid } = faceMeta;
  let ids;
  switch (edge) {
    case 'top':    ids = Array.from({ length: boardCols }, (_, c) => grid[c][0]); break;
    case 'bottom': ids = Array.from({ length: boardCols }, (_, c) => grid[c][boardRows - 1]); break;
    case 'left':   ids = Array.from({ length: boardRows }, (_, r) => grid[0][r]); break;
    case 'right':  ids = Array.from({ length: boardRows }, (_, r) => grid[boardCols - 1][r]); break;
    default: throw new Error(`Unknown edge: ${edge}`);
  }
  // reserved cells leave null in grid; cross-face edges skip them
  return ids.filter(id => id != null);
}

function addCrossFaceNeighbors(faceMap, cells, edgeSpec) {
  const fmA = faceMap.get(edgeSpec.a.face);
  const fmB = faceMap.get(edgeSpec.b.face);
  if (!fmA || !fmB) {
    throw new Error(`Edge references unknown face: ${edgeSpec.a.face} / ${edgeSpec.b.face}`);
  }
  const aIds = edgeIndices(fmA, edgeSpec.a.edge);
  let bIds = edgeIndices(fmB, edgeSpec.b.edge);
  if (edgeSpec.reverse) bIds = bIds.slice().reverse();

  const Na = aIds.length, Nb = bIds.length;
  if (Na === 0 || Nb === 0) return; // one side entirely reserved → no cross-face connection
  for (let i = 0; i < Na; i++) {
    const jLo = Math.floor(i * Nb / Na);
    const jHi = Math.min(Nb - 1, Math.max(jLo, Math.floor((i + 1) * Nb / Na) - 1));
    for (let j = jLo; j <= jHi; j++) {
      const aid = aIds[i], bid = bIds[j];
      if (!cells[aid].neighbors.includes(bid)) cells[aid].neighbors.push(bid);
      if (!cells[bid].neighbors.includes(aid)) cells[bid].neighbors.push(aid);
    }
  }
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
