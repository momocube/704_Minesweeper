// ── Sensor calibration / lock UI ─────────────────────────
// Mirrors 704_GenerativeArt's sensor-lock feature:
//   • Pill button (top-left) shows count + filtering badge
//   • LockOverlay: SVG layer drawn over the venue when lockMode is ON,
//     with chip-grid lines per face, hot cells (yellow→orange→red), and
//     locked cells (solid red w/ thick border). Clicks toggle cells.
//   • LockControlCard: stats + Clear + Done
// Hidden on projector mode (calibration is operator-only).

function LockPill({ lockState, onToggle }) {
  if (!lockState) return null;
  const count = lockState.lockedCells?.length ?? 0;
  const filtered = lockState.filteredCount ?? 0;
  const on = !!lockState.lockMode;
  return (
    <button className={`lock-pill ${on ? 'active' : ''} ${filtered > 0 ? 'filtering' : ''}`}
            onClick={onToggle}
            title="感應器校正 — 開啟後場地放空,自動把任何回報的格子加入黑名單。Done 退出後黑名單外的事件繼續打進遊戲。">
      <span className="lock-icon">🔒</span>
      <span className="lock-label">LOCK · {count}</span>
      {filtered > 0 && <span className="lock-filter">⊘{filtered}</span>}
    </button>
  );
}

function LockOverlay({ faces, lockState, onToggleCell }) {
  if (!lockState?.lockMode) return null;
  const locked = new Set(lockState.lockedCells || []);
  const hot = lockState.hotCounts || {};

  // Hot cells (heat) painted under the locked ones so locked always wins
  const hotRects = [];
  const lockRects = [];
  for (const face of faces) {
    if (face.name === 'Entrance') continue; // not part of the sensor grid we filter
    const { originX, originY, colCount, rowCount, cellPxW, cellPxH } = face;
    for (let c = 0; c < colCount; c++) {
      for (let r = 0; r < rowCount; r++) {
        const key = `${face.name}:${c}:${r}`;
        const x = originX + c * cellPxW;
        const y = originY + r * cellPxH;
        if (locked.has(key)) {
          lockRects.push(
            <rect key={key} x={x} y={y} width={cellPxW} height={cellPxH}
              fill="rgba(220,40,40,0.78)" stroke="rgba(0,0,0,0.85)" strokeWidth={2}
              style={{cursor: 'pointer'}}
              onClick={(e) => { e.stopPropagation(); onToggleCell(face.name, c, r); }}/>
          );
        } else {
          const n = hot[key] || 0;
          if (n > 0) {
            const fill = n >= 6 ? 'rgba(255,90,90,0.72)'
                       : n >= 3 ? 'rgba(255,160,60,0.66)'
                       :          'rgba(255,225,80,0.56)';
            hotRects.push(
              <rect key={key} x={x} y={y} width={cellPxW} height={cellPxH}
                fill={fill} stroke="rgba(0,0,0,0.55)" strokeWidth={1}
                style={{cursor: 'pointer'}}
                onClick={(e) => { e.stopPropagation(); onToggleCell(face.name, c, r); }}/>
            );
          }
        }
      }
    }
  }

  return (
    <g pointerEvents="auto">
      {/* dim wash */}
      <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H}
        fill="rgba(2,4,12,0.55)" pointerEvents="none"/>

      {/* per-face chip gridlines (cheap: one <path> per face) */}
      {faces.filter(f => f.name !== 'Entrance').map(face => (
        <FaceGridLines key={face.name} face={face}/>
      ))}

      {/* Click capture per face (chip-resolution hit-test). Behind the heat
          rects so hot/locked rects keep their hand cursor + toggle action. */}
      {faces.filter(f => f.name !== 'Entrance').map(face => (
        <FaceClickCatcher key={face.name} face={face} onPick={onToggleCell}/>
      ))}

      {hotRects}
      {lockRects}
    </g>
  );
}

function FaceGridLines({ face }) {
  const { originX, originY, colCount, rowCount, cellPxW, cellPxH, width, height } = face;
  // Build a single d-string for all gridlines on this face.
  let d = '';
  for (let c = 0; c <= colCount; c++) {
    const x = originX + c * cellPxW;
    d += `M${x} ${originY}L${x} ${originY + height}`;
  }
  for (let r = 0; r <= rowCount; r++) {
    const y = originY + r * cellPxH;
    d += `M${originX} ${y}L${originX + width} ${y}`;
  }
  return (
    <>
      <rect x={originX} y={originY} width={width} height={height}
        fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={6}
        pointerEvents="none"/>
      <path d={d} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={1.2}
        pointerEvents="none"/>
    </>
  );
}

function FaceClickCatcher({ face, onPick }) {
  const { originX, originY, width, height, cellPxW, cellPxH } = face;
  // One large transparent rect; convert click → chip cell with math.
  const onClick = (e) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const col = Math.floor((loc.x - originX) / cellPxW);
    const row = Math.floor((loc.y - originY) / cellPxH);
    if (col < 0 || row < 0 || col >= face.colCount || row >= face.rowCount) return;
    onPick(face.name, col, row);
  };
  return (
    <rect x={originX} y={originY} width={width} height={height}
      fill="rgba(0,0,0,0.001)" onClick={onClick}
      style={{cursor: 'crosshair'}}/>
  );
}

function LockControlCard({ lockState, onClear, onClose }) {
  if (!lockState?.lockMode) return null;
  const lockedN = lockState.lockedCells?.length ?? 0;
  const hotN = Object.keys(lockState.hotCounts || {}).filter(k => !lockState.lockedCells.includes(k)).length;
  return (
    <div className="lock-card">
      <div className="lc-title">SENSOR LOCK · CALIBRATION</div>
      <div className="lc-sub">場地放空 — 任何回報的格子會自動加入黑名單。<br/>誤鎖的格子點一下解鎖。Done 退出後黑名單外的事件繼續打進遊戲。</div>
      <div className="lc-stats">
        <div><span className="lc-n lc-n-locked">{lockedN}</span> locked</div>
        <div><span className="lc-n lc-n-hot">{hotN}</span> hot</div>
      </div>
      <div className="lc-actions">
        <button onClick={onClear} disabled={!lockedN}>Clear</button>
        <button className="primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

Object.assign(window, { LockPill, LockOverlay, LockControlCard });
