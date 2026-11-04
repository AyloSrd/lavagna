import React from 'react';
import type { SequenceData } from '../../format/sequence';
import { ARROW_STYLES, ArrowEnd } from './arrows';
import { HEAD_W, LANE_W, LIFE_TOP, Measure, SequenceLayout, TOP, fitText, laneX } from './layout';

// The diagram as SVG. Purely presentational: every interactive part carries a
// `data-role` (plus `data-i` for steps, `data-id` for participants) and the
// editor dispatches pointer events on those attributes.

/** Arrow tip at (x, y) pointing in `dir` (+1 right, -1 left). */
export function Tip({ x, y, dir, end }: { x: number; y: number; dir: number; end: ArrowEnd }) {
  const d = dir;
  if (end === 'arrow') {
    return <path className="lv-seq-tip" d={`M${x} ${y} L${x - d * 10} ${y - 4.5} L${x - d * 10} ${y + 4.5} Z`} />;
  }
  if (end === 'open') {
    return <path className="lv-seq-tip lv-seq-open-tip" d={`M${x - d * 10} ${y - 5} L${x} ${y} L${x - d * 10} ${y + 5}`} />;
  }
  if (end === 'cross') {
    return (
      <path
        className="lv-seq-tip lv-seq-open-tip"
        d={`M${x - d * 9} ${y - 4.5} L${x - d} ${y + 4.5} M${x - d} ${y - 4.5} L${x - d * 9} ${y + 4.5}`}
      />
    );
  }
  return null;
}

export interface HeadDrag { id: string; dx: number }

export function Diagram({
  data,
  layout,
  measure,
  selected,
  headDrag,
  menuFor,
}: {
  data: SequenceData;
  layout: SequenceLayout;
  measure: Measure;
  selected: number | null;
  headDrag: HeadDrag | null;
  /** Participant whose ⋯ menu is open, so its button stays visible. */
  menuFor: string | null;
}) {
  const { steps, participants } = data;
  const cls = (i: number) => (selected === i ? 'lv-seq-step lv-seq-sel' : 'lv-seq-step');

  // Autonumber counts messages only, in order.
  const numbers = new Map<number, number>();
  steps.forEach((s, i) => {
    if (s.type === 'message') {
      numbers.set(i, numbers.size + 1);
    }
  });

  return (
    <svg width={layout.width} height={layout.height} role="img" aria-label="Sequence diagram">
      {layout.frames.map((f) => (
        <rect key={`f${f.i}`} className="lv-seq-frame" x={f.box.x} y={f.box.y} width={f.box.w} height={f.box.h} rx={3} />
      ))}
      {layout.dividers.map((d) => (
        <line key={`d${d.i}`} className="lv-seq-divider" x1={d.x1} y1={d.y} x2={d.x2} y2={d.y} />
      ))}

      {participants.map((p, k) => (
        <line key={`l${p.id}`} className="lv-seq-lifeline" x1={laneX(k)} y1={LIFE_TOP} x2={laneX(k)} y2={layout.bottom} />
      ))}
      {participants.map((p, k) => (
        <rect
          key={`h${p.id}`}
          className="lv-seq-lane"
          data-role="lane"
          data-id={p.id}
          x={laneX(k) - 14}
          y={LIFE_TOP}
          width={28}
          height={layout.bottom - LIFE_TOP}
        />
      ))}

      {layout.bars.map((b, n) => (
        <rect key={`b${n}`} className="lv-seq-bar" x={b.x} y={b.y0} width={10} height={b.y1 - b.y0} rx={1.5} />
      ))}

      {layout.messages.map((m) => {
        const s = steps[m.i];
        if (s.type !== 'message') {
          return null;
        }
        const style = ARROW_STYLES[s.arrow];
        const dash = style.dotted ? '6 4' : undefined;
        const n = numbers.get(m.i);
        const num = data.autonumber && n !== undefined && (
          <g className="lv-seq-num">
            <circle cx={m.x1} cy={m.y} r={8} />
            <text x={m.x1} y={m.y + 3.5}>{n}</text>
          </g>
        );
        if (m.self) {
          const path = `M${m.x1} ${m.y} H${m.x1 + 42} V${m.y + 26} H${m.x1 + 4}`;
          return (
            <g key={`m${m.i}`} className={cls(m.i)} data-role="step" data-i={m.i}>
              <path className="lv-seq-msg-hit" d={path} />
              <rect className="lv-seq-text-hit" x={m.textHit.x} y={m.textHit.y} width={m.textHit.w} height={m.textHit.h} />
              <path className="lv-seq-msg-line" d={path} strokeDasharray={dash} />
              <Tip x={m.x1 + 4} y={m.y + 26} dir={-1} end={style.end} />
              <text x={m.textX} y={m.textY}>{s.text}</text>
              {num}
            </g>
          );
        }
        const dir = Math.sign(m.x2 - m.x1);
        return (
          <g key={`m${m.i}`} className={cls(m.i)} data-role="step" data-i={m.i}>
            <line className="lv-seq-msg-hit" x1={m.x1} y1={m.y} x2={m.x2} y2={m.y} />
            <rect className="lv-seq-text-hit" x={m.textHit.x} y={m.textHit.y} width={m.textHit.w} height={m.textHit.h} />
            <line className="lv-seq-msg-line" x1={m.x1} y1={m.y} x2={m.x2 - dir} y2={m.y} strokeDasharray={dash} />
            <Tip x={m.x2 - dir} y={m.y} dir={dir} end={style.end} />
            <text className="lv-seq-center" x={m.textX} y={m.textY}>{s.text}</text>
            {num}
          </g>
        );
      })}

      {layout.notes.map((nt) => {
        const s = steps[nt.i];
        if (s.type !== 'note') {
          return null;
        }
        const { x, y, w, h } = nt.box;
        return (
          <g key={`n${nt.i}`} className={cls(nt.i)} data-role="step" data-i={nt.i}>
            <rect className="lv-seq-note" x={x} y={y} width={w} height={h} rx={3} />
            <text className="lv-seq-center" x={x + w / 2} y={y + h / 2 + 4}>{s.text}</text>
          </g>
        );
      })}

      {layout.frames.map((f) => {
        const { x, y } = f.box;
        const t = f.tabW;
        return (
          <g key={`t${f.i}`} className={cls(f.i)} data-role="step" data-i={f.i}>
            <rect className="lv-seq-text-hit" x={f.hit.x} y={f.hit.y} width={f.hit.w} height={f.hit.h} />
            <polygon className="lv-seq-tab" points={`${x},${y} ${x + t},${y} ${x + t},${y + 13} ${x + t - 6},${y + 19} ${x},${y + 19}`} />
            <text className="lv-seq-kw" x={x + 7} y={y + 13.5}>{f.keyword}</text>
            {f.label && <text className="lv-seq-frame-label" x={x + t + 8} y={y + 14}>[{f.label}]</text>}
          </g>
        );
      })}
      {layout.dividers.map((d) => (
        <g key={`dl${d.i}`} className={cls(d.i)} data-role="step" data-i={d.i}>
          <rect className="lv-seq-text-hit" x={d.hit.x} y={d.hit.y} width={d.hit.w} height={d.hit.h} />
          <text className="lv-seq-frame-label" x={d.x1 + 8} y={d.y + 14}>{d.text}</text>
        </g>
      ))}

      {participants.map((p, k) => {
        const dragging = headDrag?.id === p.id;
        const x = laneX(k) + (headDrag && dragging ? headDrag.dx : 0);
        const label = fitText(p.label, LANE_W - 50, measure);
        const mx = p.actor ? x + 30 : x + HEAD_W / 2 - 14;
        const my = TOP + (p.actor ? 6 : 8);
        return (
          <g key={`p${p.id}`} className={dragging ? 'lv-seq-head lv-seq-dragging' : 'lv-seq-head'} data-role="head" data-id={p.id}>
            {p.actor ? (
              <>
                <rect className="lv-seq-head-hit" x={x - HEAD_W / 2} y={TOP - 4} width={HEAD_W} height={54} />
                <g className="lv-seq-actor">
                  <circle cx={x} cy={TOP + 6} r={5.5} />
                  <path d={`M${x} ${TOP + 12}v12M${x - 9} ${TOP + 16}h18M${x} ${TOP + 24}l-7 8M${x} ${TOP + 24}l7 8`} />
                </g>
                <text className="lv-seq-head-label" x={x} y={TOP + 46}>{label}</text>
              </>
            ) : (
              <>
                <rect className="lv-seq-head-box" x={x - HEAD_W / 2} y={TOP} width={HEAD_W} height={36} rx={4} />
                <text className="lv-seq-head-label" x={x} y={TOP + 22}>{label}</text>
              </>
            )}
            <g
              className={menuFor === p.id ? 'lv-seq-menu-btn lv-seq-open' : 'lv-seq-menu-btn'}
              data-role="headmenu"
              data-id={p.id}
              aria-label={`${p.label} options`}
            >
              <rect x={mx - 9} y={my - 1} width={20} height={20} rx={4} />
              <circle cx={mx - 4} cy={my + 9} r={1.3} />
              <circle cx={mx + 1} cy={my + 9} r={1.3} />
              <circle cx={mx + 6} cy={my + 9} r={1.3} />
            </g>
          </g>
        );
      })}
      <g className="lv-seq-ghost" data-role="ghosthead">
        <rect x={laneX(participants.length) - 58} y={TOP} width={116} height={36} rx={4} />
        <text x={laneX(participants.length)} y={TOP + 22}>+ Participant</text>
      </g>
    </svg>
  );
}
