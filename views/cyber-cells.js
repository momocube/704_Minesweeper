// ── Cell rendering ───────────────────────────────────────

function CellBracket({ cell, palette }) {
  const s = CELL;
  const inset = 4;
  const corner = 14;
  const sw = 2.5;

  const { state, adjacent, locked } = cell;
  const numberColor = NUMBER_COLORS(palette)[Math.min(adjacent, 8)] || "#fff";

  return (
    <g>
      <rect x={inset} y={inset} width={s - inset*2} height={s - inset*2}
        fill={state === "revealed" ? "rgba(0,0,0,0.85)" : "rgba(8,14,22,0.85)"}
        stroke={state === "revealed" ? "rgba(40,80,100,0.5)" : "rgba(40,80,100,0.7)"}
        strokeWidth={1}
      />

      {state === "hidden" && (
        <>
          <line x1={s/2} y1={inset+2} x2={s/2} y2={s-inset-2} stroke="rgba(0,255,229,0.05)" strokeWidth={0.5}/>
          <line x1={inset+2} y1={s/2} x2={s-inset-2} y2={s/2} stroke="rgba(0,255,229,0.05)" strokeWidth={0.5}/>
        </>
      )}

      {state === "hidden" && [
        <polyline key="tl" points={`${inset},${inset+corner} ${inset},${inset} ${inset+corner},${inset}`}
          fill="none" stroke={palette.primary} strokeWidth={sw} opacity={0.7}/>,
        <polyline key="tr" points={`${s-inset-corner},${inset} ${s-inset},${inset} ${s-inset},${inset+corner}`}
          fill="none" stroke={palette.primary} strokeWidth={sw} opacity={0.7}/>,
        <polyline key="bl" points={`${inset},${s-inset-corner} ${inset},${s-inset} ${inset+corner},${s-inset}`}
          fill="none" stroke={palette.primary} strokeWidth={sw} opacity={0.7}/>,
        <polyline key="br" points={`${s-inset-corner},${s-inset} ${s-inset},${s-inset} ${s-inset},${s-inset-corner}`}
          fill="none" stroke={palette.primary} strokeWidth={sw} opacity={0.7}/>,
      ]}

      {locked && (
        <g style={{filter: `drop-shadow(0 0 6px ${palette.secondary})`}}>
          <polyline points={`${inset-1},${inset+corner+6} ${inset-1},${inset-1} ${inset+corner+6},${inset-1}`}
            fill="none" stroke={palette.secondary} strokeWidth={5}/>
          <polyline points={`${s-inset-corner-6+1},${inset-1} ${s-inset+1},${inset-1} ${s-inset+1},${inset+corner+6}`}
            fill="none" stroke={palette.secondary} strokeWidth={5}/>
          <polyline points={`${inset-1},${s-inset-corner-6+1} ${inset-1},${s-inset+1} ${inset+corner+6},${s-inset+1}`}
            fill="none" stroke={palette.secondary} strokeWidth={5}/>
          <polyline points={`${s-inset-corner-6+1},${s-inset+1} ${s-inset+1},${s-inset+1} ${s-inset+1},${s-inset-corner-6+1}`}
            fill="none" stroke={palette.secondary} strokeWidth={5}/>
          <circle cx={s/2} cy={s/2} r={6} fill="none" stroke={palette.secondary} strokeWidth={2} className="pulse-fast"/>
          <circle cx={s/2} cy={s/2} r={2} fill={palette.secondary}/>
        </g>
      )}

      {state === "flagged" && (
        <g style={{filter: `drop-shadow(0 0 4px ${palette.secondary})`}}>
          <polygon points={`${s/2},${inset+10} ${s-inset-8},${s-inset-10} ${inset+8},${s-inset-10}`}
            fill="none" stroke={palette.secondary} strokeWidth={3} strokeLinejoin="round"/>
          <line x1={s/2} y1={inset+18} x2={s/2} y2={s-inset-18} stroke={palette.secondary} strokeWidth={3}/>
          <circle cx={s/2} cy={s-inset-13} r={2} fill={palette.secondary}/>
        </g>
      )}

      {/* 誤標 — 只在 gameOver 後出現:淡化的旗子(你標過)+ 真實數字(其實是這個) */}
      {state === "wrongFlag" && (
        <g>
          <rect x={inset} y={inset} width={s - inset*2} height={s - inset*2}
            fill={palette.danger} opacity={0.13}/>
          <rect x={inset} y={inset} width={s - inset*2} height={s - inset*2}
            fill="none" stroke={palette.danger} strokeWidth={1.5} opacity={0.7}/>
          <g opacity={0.22}>
            <polygon points={`${s/2},${inset+10} ${s-inset-8},${s-inset-10} ${inset+8},${s-inset-10}`}
              fill="none" stroke={palette.danger} strokeWidth={3} strokeLinejoin="round"/>
            <line x1={s/2} y1={inset+18} x2={s/2} y2={s-inset-18} stroke={palette.danger} strokeWidth={3}/>
          </g>
          {adjacent > 0 ? (
            <text x={s/2} y={s/2 + 2} className="cell-number" fontSize={38}
              fill={palette.danger}
              style={{filter: `drop-shadow(0 0 5px ${palette.danger})`}}>
              {adjacent}
            </text>
          ) : (
            <circle cx={s/2} cy={s/2} r={2.5} fill={palette.danger} opacity={0.8}/>
          )}
        </g>
      )}

      {state === "revealed" && adjacent > 0 && (
        <text x={s/2} y={s/2 + 2} className="cell-number" fontSize={38}
          fill={numberColor}
          style={{filter: `drop-shadow(0 0 4px ${numberColor})`}}>
          {adjacent}
        </text>
      )}

      {state === "revealed" && adjacent === 0 && (
        <circle cx={s/2} cy={s/2} r={1.5} fill="rgba(80,120,140,0.4)"/>
      )}

      {state === "mine" && (
        <g style={{filter: `drop-shadow(0 0 8px ${palette.danger})`}}>
          <circle cx={s/2} cy={s/2} r={14} fill="none" stroke={palette.danger} strokeWidth={2.5} className="pulse-fast"/>
          <circle cx={s/2} cy={s/2} r={6} fill={palette.danger}/>
          <line x1={s/2} y1={inset} x2={s/2} y2={s-inset} stroke={palette.danger} strokeWidth={1} opacity={0.6}/>
          <line x1={inset} y1={s/2} x2={s-inset} y2={s/2} stroke={palette.danger} strokeWidth={1} opacity={0.6}/>
        </g>
      )}
    </g>
  );
}

function CellHologram({ cell, palette }) {
  const s = CELL;
  const { state, adjacent, locked } = cell;
  const numberColor = NUMBER_COLORS(palette)[Math.min(adjacent, 8)] || "#fff";

  return (
    <g>
      {/* hidden node — holographic data tile */}
      {state === "hidden" && (
        <g>
          {/* base panel: translucent cyan gel */}
          <rect x={3} y={3} width={s-6} height={s-6} rx={6}
            fill={palette.primary} opacity={0.05}/>
          <rect x={3} y={3} width={s-6} height={s-6} rx={6}
            fill="none" stroke={palette.primary} strokeWidth={1} opacity={0.55}/>
          {/* inner sheen line (top-left to bottom-right) */}
          <line x1={6} y1={s-6} x2={s-6} y2={6}
            stroke={palette.primary} strokeWidth={0.6}
            strokeDasharray="2 3" opacity={0.55}/>
          {/* mini corner ticks */}
          <g stroke={palette.primary} strokeWidth={1.2} opacity={0.85}
             style={{filter: `drop-shadow(0 0 2px ${palette.primary})`}}>
            <line x1={6} y1={3} x2={12} y2={3}/>
            <line x1={3} y1={6} x2={3} y2={12}/>
            <line x1={s-12} y1={3} x2={s-6} y2={3}/>
            <line x1={s-3} y1={6} x2={s-3} y2={12}/>
            <line x1={6} y1={s-3} x2={12} y2={s-3}/>
            <line x1={3} y1={s-12} x2={3} y2={s-6}/>
            <line x1={s-12} y1={s-3} x2={s-6} y2={s-3}/>
            <line x1={s-3} y1={s-12} x2={s-3} y2={s-6}/>
          </g>
          {/* tiny core dot */}
          <circle cx={s/2} cy={s/2} r={1.3} fill={palette.primary} opacity={0.6}/>
        </g>
      )}

      {/* revealed empty — almost invisible, just a footprint */}
      {state === "revealed" && adjacent === 0 && (
        <g opacity={0.4}>
          <rect x={3} y={3} width={s-6} height={s-6} rx={6}
            fill="rgba(0,4,8,0.6)"
            stroke="rgba(40,80,100,0.3)" strokeWidth={0.5}/>
          <circle cx={s/2} cy={s/2} r={1} fill="rgba(120,140,160,0.4)"/>
        </g>
      )}

      {/* revealed with number — glowing holographic digit */}
      {state === "revealed" && adjacent > 0 && (
        <g>
          <rect x={3} y={3} width={s-6} height={s-6} rx={6}
            fill="rgba(0,4,8,0.85)"
            stroke={numberColor} strokeWidth={0.5} opacity={0.6}/>
          {/* glow halo */}
          <circle cx={s/2} cy={s/2} r={s*0.35} fill={numberColor} opacity={0.10}/>
          {/* number with chromatic offset */}
          <text x={s/2} y={s/2 + 2} className="cell-number" fontSize={36}
            fill={numberColor}
            style={{filter: `drop-shadow(0 0 5px ${numberColor}) drop-shadow(0 0 12px ${numberColor})`}}>
            {adjacent}
          </text>
        </g>
      )}

      {/* flag — scanning target triangle */}
      {state === "flagged" && (
        <g style={{filter: `drop-shadow(0 0 5px ${palette.secondary}) drop-shadow(0 0 14px ${palette.secondary})`}}>
          <rect x={3} y={3} width={s-6} height={s-6} rx={6}
            fill={palette.secondary} opacity={0.08}/>
          <rect x={3} y={3} width={s-6} height={s-6} rx={6}
            fill="none" stroke={palette.secondary} strokeWidth={1.5} opacity={0.8}/>
          <polygon points={`${s/2},${10} ${s-12},${s-12} ${12},${s-12}`}
            fill="none" stroke={palette.secondary} strokeWidth={3.5}
            strokeLinejoin="round"/>
          <polygon points={`${s/2},${10} ${s-12},${s-12} ${12},${s-12}`}
            fill={palette.secondary} opacity={0.15}/>
          <circle cx={s/2} cy={s/2 + 2} r={2.5} fill={palette.secondary}/>
        </g>
      )}

      {/* 誤標 — 只在 gameOver 後出現:淡化的旗子(你標過)+ 真實數字(其實是這個) */}
      {state === "wrongFlag" && (
        <g style={{filter: `drop-shadow(0 0 6px ${palette.danger})`}}>
          <rect x={3} y={3} width={s-6} height={s-6} rx={6}
            fill={palette.danger} opacity={0.14}/>
          <rect x={3} y={3} width={s-6} height={s-6} rx={6}
            fill="none" stroke={palette.danger} strokeWidth={1.5} opacity={0.75}/>
          {/* ghost 旗子 — 標記過的痕跡,淡到不跟數字搶 */}
          <g opacity={0.2}>
            <polygon points={`${s/2},${10} ${s-12},${s-12} ${12},${s-12}`}
              fill="none" stroke={palette.danger} strokeWidth={3.5} strokeLinejoin="round"/>
          </g>
          {adjacent > 0 ? (
            <>
              <circle cx={s/2} cy={s/2} r={s*0.35} fill={palette.danger} opacity={0.10}/>
              <text x={s/2} y={s/2 + 2} className="cell-number" fontSize={36}
                fill={palette.danger}
                style={{filter: `drop-shadow(0 0 5px ${palette.danger}) drop-shadow(0 0 12px ${palette.danger})`}}>
                {adjacent}
              </text>
            </>
          ) : (
            <circle cx={s/2} cy={s/2} r={2.5} fill={palette.danger} opacity={0.85}/>
          )}
        </g>
      )}

      {/* locked — pulsing rotating brackets + crosshair */}
      {locked && (
        <g style={{filter: `drop-shadow(0 0 8px ${palette.secondary})`}}>
          {/* outer rim */}
          <rect x={1} y={1} width={s-2} height={s-2} rx={6}
            fill="none" stroke={palette.secondary} strokeWidth={2.5}
            className="pulse-fast"/>
          {/* L-shaped corners over rim, slightly inset */}
          <g stroke={palette.secondary} strokeWidth={3} fill="none">
            <polyline points={`${5},${14} ${5},${5} ${14},${5}`}/>
            <polyline points={`${s-14},${5} ${s-5},${5} ${s-5},${14}`}/>
            <polyline points={`${5},${s-14} ${5},${s-5} ${14},${s-5}`}/>
            <polyline points={`${s-14},${s-5} ${s-5},${s-5} ${s-5},${s-14}`}/>
          </g>
          {/* crosshair */}
          <line x1={s/2} y1={12} x2={s/2} y2={22} stroke={palette.secondary} strokeWidth={1.5}/>
          <line x1={s/2} y1={s-22} x2={s/2} y2={s-12} stroke={palette.secondary} strokeWidth={1.5}/>
          <line x1={12} y1={s/2} x2={22} y2={s/2} stroke={palette.secondary} strokeWidth={1.5}/>
          <line x1={s-22} y1={s/2} x2={s-12} y2={s/2} stroke={palette.secondary} strokeWidth={1.5}/>
          <circle cx={s/2} cy={s/2} r={5} fill="none" stroke={palette.secondary} strokeWidth={1.5}/>
          <circle cx={s/2} cy={s/2} r={1.5} fill={palette.secondary}/>
        </g>
      )}

      {/* mine — concentric pulsing rings + diamond core */}
      {state === "mine" && (
        <g style={{filter: `drop-shadow(0 0 10px ${palette.danger}) drop-shadow(0 0 20px ${palette.danger})`}}>
          <rect x={3} y={3} width={s-6} height={s-6} rx={6}
            fill={palette.danger} opacity={0.12}/>
          <rect x={3} y={3} width={s-6} height={s-6} rx={6}
            fill="none" stroke={palette.danger} strokeWidth={1.5} opacity={0.6}/>
          {/* outer ring */}
          <circle cx={s/2} cy={s/2} r={20} fill="none"
            stroke={palette.danger} strokeWidth={1.5} opacity={0.5}
            strokeDasharray="3 4" className="pulse-slow"/>
          {/* inner ring */}
          <circle cx={s/2} cy={s/2} r={13} fill="none"
            stroke={palette.danger} strokeWidth={2} className="pulse-fast"/>
          {/* diamond core */}
          <polygon points={`${s/2},${s/2-7} ${s/2+7},${s/2} ${s/2},${s/2+7} ${s/2-7},${s/2}`}
            fill={palette.danger}/>
          <polygon points={`${s/2},${s/2-4} ${s/2+4},${s/2} ${s/2},${s/2+4} ${s/2-4},${s/2}`}
            fill="#fff" opacity={0.9}/>
        </g>
      )}
    </g>
  );
}

function Cell(props) {
  if (props.cellStyle === "hologram") return <CellHologram {...props}/>;
  return <CellBracket {...props}/>;
}

Object.assign(window, { Cell });
