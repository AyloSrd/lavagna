import React from 'react';
import type { SequenceData } from '../../format/sequence';
import { GUTTER, LANE_W, LIFE_TOP, PAD, SequenceLayout, laneAt, laneX, nearestBoundary } from './layout';
import type { Drag, Hover } from './state';

// Affordances drawn over the diagram: the dot on a hovered lifeline, the
// insert line with its "+", the row grip, and the ghost arrow / drop line
// while dragging. Only the "+" and the grip take pointer events.

/** Moving less than this on the start lifeline is a click, not a self-message. */
export const SELF_MIN = 14;

export function HoverLayer({
  data,
  layout,
  hover,
  drag,
}: {
  data: SequenceData;
  layout: SequenceLayout;
  hover: Hover | null;
  drag: Drag | null;
}) {
  const right = layout.width - PAD;
  const idx = (id: string) => data.participants.findIndex((p) => p.id === id);
  let body: React.ReactNode = null;

  if (drag?.mode === 'message') {
    const fx = laneX(idx(drag.from));
    const y = drag.start.y;
    const k = laneAt(data.participants.length, drag.p.x);
    const target = k === null ? null : data.participants[k].id;
    const moved = Math.hypot(drag.p.x - drag.start.x, drag.p.y - drag.start.y);
    const self = target === drag.from && moved >= SELF_MIN;
    const ex = target !== null && target !== drag.from ? laneX(k!) : drag.p.x;
    const dir = Math.sign(ex - fx) || 1;
    body = (
      <>
        <line className="lv-seq-ins lv-seq-faint" x1={GUTTER} y1={nearestBoundary(layout, y).y} x2={right} y2={nearestBoundary(layout, y).y} />
        {target !== null && (target !== drag.from || self) && (
          <rect className="lv-seq-target" x={laneX(k!) - LANE_W / 2 + 12} y={LIFE_TOP} width={LANE_W - 24} height={layout.bottom - LIFE_TOP} rx={6} />
        )}
        {self ? (
          <>
            <path className="lv-seq-ghost-line" d={`M${fx} ${y} H${fx + 42} V${y + 26} H${fx + 4}`} />
            <path className="lv-seq-ghost-tip" d={`M${fx + 4} ${y + 26} l10 -4.5 v9 Z`} />
          </>
        ) : (
          <>
            <line className="lv-seq-ghost-line" x1={fx} y1={y} x2={ex} y2={y} />
            <path className="lv-seq-ghost-tip" d={`M${ex} ${y} l${-dir * 10} -4.5 v9 Z`} />
          </>
        )}
        <circle className="lv-seq-dot" cx={fx} cy={y} r={4.5} />
      </>
    );
  } else if (drag?.mode === 'reorder' && drag.target) {
    body = <line className="lv-seq-ins lv-seq-strong" x1={GUTTER} y1={drag.target.y} x2={right} y2={drag.target.y} />;
  } else if (!drag && hover?.kind === 'dot') {
    body = (
      <>
        <circle className="lv-seq-ring" cx={hover.x} cy={hover.y} r={7} />
        <circle className="lv-seq-dot" cx={hover.x} cy={hover.y} r={4.5} />
      </>
    );
  } else if (!drag && hover?.kind === 'plus') {
    const cx = GUTTER / 2 + 2;
    body = (
      <>
        <line className="lv-seq-ins" x1={GUTTER - 4} y1={hover.y} x2={right} y2={hover.y} />
        <g className="lv-seq-hot lv-seq-plus" data-role="plus" data-idx={hover.idx} data-y={hover.y} aria-label="Insert here">
          <circle cx={cx} cy={hover.y} r={9} />
          <path d={`M${cx} ${hover.y - 4.5}v9M${cx - 4.5} ${hover.y}h9`} />
        </g>
      </>
    );
  } else if (!drag && hover?.kind === 'grip') {
    const x = 12;
    const dots: React.ReactNode[] = [];
    for (const dy of [-5, 0, 5]) {
      for (const dx of [-2.5, 2.5]) {
        dots.push(<circle key={`${dx},${dy}`} cx={x + 7 + dx} cy={hover.y + dy} r={1.3} />);
      }
    }
    body = (
      <g className="lv-seq-hot lv-seq-grip" data-role="grip" data-i={hover.i} aria-label="Move step">
        <rect x={x} y={hover.y - 11} width={14} height={22} rx={3} />
        {dots}
      </g>
    );
  }

  return (
    <svg className="lv-seq-hover" width={layout.width} height={layout.height} aria-hidden={!body}>
      {body}
    </svg>
  );
}
