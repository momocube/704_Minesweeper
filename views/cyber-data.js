// ── 704 Venue geometry + cyberpunk metadata ────────────────
// 1 board cell = 64 × 64 venue px = 25 × 25 cm physical
const CELL = 64;
const CANVAS_W = 2688;
const CANVAS_H = 3840;

// Cyberpunk callsigns / labels keyed by SERVER face name
const FACE_CALLSIGN = {
  "Wall Top":         "N",
  "Wall Left":        "W",
  "Wall Right Big":   "E_α",
  "Wall Right little":"E_β",
  "Wall Button":      "S",
  "Floor":            "TERMINAL",
  "Entrance":         "GATE",
};

const FACE_LABEL = {
  "Wall Top":         "NORTH SECTOR / 北翼",
  "Wall Left":        "WEST SECTOR / 西翼",
  "Wall Right Big":   "EAST PRIMARY / 東翼 α",
  "Wall Right little":"EAST SECONDARY / 東翼 β",
  "Wall Button":      "SOUTH SECTOR / 南翼",
  "Floor":            "CMD TERMINAL / 控制終端",
  "Entrance":         "GATEWAY / 通道 [INACTIVE]",
};

// Adapt a server face object into a shape with display-friendly aliases.
// cyber-cells / cyber-hud / cyber-effects expect: w, h, x, y, cols, rows, reserved, id
function adaptFace(serverFace) {
  return {
    ...serverFace,
    w: serverFace.width,
    h: serverFace.height,
    x: serverFace.originX,
    y: serverFace.originY,
    cols: serverFace.boardCols,
    rows: serverFace.boardRows,
    reserved: serverFace.reservedSide,
    id: FACE_CALLSIGN[serverFace.name] || "?",
    label: FACE_LABEL[serverFace.name] || "",
  };
}

// Mock faces (for preview when server not connected)
const MOCK_FACES = [
  adaptFace({ name: "Wall Top",       originX: 640,  originY: 0,    width: 1408, height: 640,  boardCols: 22, boardRows: 10, reservedSide: "top",    cellPxW: 32, cellPxH: 16, colCount: 44, rowCount: 40,  isBoard: true,  isFloor: false }),
  adaptFace({ name: "Wall Left",      originX: 0,    originY: 640,  width: 640,  height: 2048, boardCols: 10, boardRows: 32, reservedSide: "left",   cellPxW: 32, cellPxH: 16, colCount: 20, rowCount: 128, isBoard: true,  isFloor: false }),
  adaptFace({ name: "Floor",          originX: 640,  originY: 640,  width: 1408, height: 2048, boardCols: 0,  boardRows: 0,  reservedSide: null,     cellPxW: 32, cellPxH: 16, colCount: 44, rowCount: 128, isBoard: false, isFloor: true  }),
  adaptFace({ name: "Wall Right Big", originX: 2048, originY: 640,  width: 640,  height: 1280, boardCols: 10, boardRows: 20, reservedSide: "right",  cellPxW: 32, cellPxH: 16, colCount: 20, rowCount: 80,  isBoard: true,  isFloor: false }),
  adaptFace({ name: "Entrance",       originX: 2048, originY: 1920, width: 640,  height: 512,  boardCols: 0,  boardRows: 0,  reservedSide: null,     cellPxW: 32, cellPxH: 16, colCount: 20, rowCount: 32,  isBoard: false, isFloor: false }),
  adaptFace({ name: "Wall Right little", originX: 2048, originY: 2432, width: 640,  height: 256, boardCols: 10, boardRows: 4,  reservedSide: "right",  cellPxW: 32, cellPxH: 16, colCount: 20, rowCount: 16,  isBoard: true,  isFloor: false }),
  adaptFace({ name: "Wall Button",    originX: 640,  originY: 2688, width: 1408, height: 640,  boardCols: 22, boardRows: 10, reservedSide: "bottom", cellPxW: 32, cellPxH: 16, colCount: 44, rowCount: 40,  isBoard: true,  isFloor: false }),
];

const BOARD_FACE_NAMES = new Set(["Wall Top","Wall Left","Wall Right Big","Wall Right little","Wall Button"]);

function isReserved(face, c, r) {
  const reserved = face.reservedSide ?? face.reserved;
  if (!reserved) return false;
  const cols = face.boardCols ?? face.cols;
  const rows = face.boardRows ?? face.rows;
  switch (reserved) {
    case "top":    return r < 2;
    case "bottom": return r >= rows - 2;
    case "left":   return c < 2;
    case "right":  return c >= cols - 2;
  }
  return false;
}

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const PALETTES = {
  "cyan-magenta": { primary:"#00FFE5", secondary:"#FF2D8F", accent:"#39FF14", danger:"#FF1744", warn:"#FF6B00", bg0:"#04060A", bg1:"#070B12", label:"CYAN × MAGENTA" },
  "amber-red":    { primary:"#FFB000", secondary:"#FF3D00", accent:"#FFEB00", danger:"#FF1744", warn:"#FF6B00", bg0:"#08050A", bg1:"#100A06", label:"AMBER × RED (BR2049)" },
  "tron-blue":    { primary:"#00CFFF", secondary:"#7FF4FF", accent:"#FFFFFF", danger:"#FF3D7F", warn:"#FFB000", bg0:"#020410", bg1:"#040820", label:"TRON BLUE" },
  "synthwave":    { primary:"#FF2D8F", secondary:"#9B5CFF", accent:"#00FFE5", danger:"#FF1744", warn:"#FFB000", bg0:"#0A0418", bg1:"#150828", label:"SYNTHWAVE" },
};

const NUMBER_COLORS = (p) => [null, p.primary, p.accent, "#FFEB00", p.warn, p.secondary, p.danger, "#FFFFFF", "#FF00A8"];

Object.assign(window, {
  CELL, CANVAS_W, CANVAS_H,
  FACE_CALLSIGN, FACE_LABEL, BOARD_FACE_NAMES,
  adaptFace, MOCK_FACES,
  isReserved, fmtTime,
  PALETTES, NUMBER_COLORS,
});
