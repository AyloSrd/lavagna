import React, { useContext } from 'react';
import {
  EdgeLabelRenderer,
  EdgeToolbar,
  getSmoothStepPath,
  Position,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import { EDGE_STYLES, EdgeArrow, EdgeStroke } from '../../format/mermaid';
import { IconButton, Segmented, Separator } from '../../ui/controls';
import { FlowActionsContext } from './actions';
import { InlineInput } from './InlineInput';
import { DEFAULT_SIZE, edgeOp, type Side } from './model';
import { route, type Rect } from './routing';

// A flowchart link, drawn between the sides of the two nodes that face each
// other (see routing.ts) instead of fixed handles, with its label as a pill.
// When selected it shows a bar with the six mermaid line styles.

export type FlowEdgeData = { stroke: EdgeStroke; arrow: EdgeArrow };
export type FlowRFEdge = Edge<FlowEdgeData, 'flow'>;

const POSITION: Record<Side, Position> = {
  top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left,
};
/** Unit vector pointing into a node through each side. */
const INWARD: Record<Side, [number, number]> = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] };

function rectOf(n: InternalNode): Rect {
  return {
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    w: n.measured.width ?? DEFAULT_SIZE.w,
    h: n.measured.height ?? DEFAULT_SIZE.h,
  };
}

/** Small line icon for one of the six styles. */
export function EdgeStyleIcon({ stroke, arrow }: FlowEdgeData) {
  const width = stroke === 'thick' ? 3 : 1.6;
  return (
    <svg className="lv-svg" width={26} height={14} viewBox="0 0 26 14" aria-hidden="true">
      <path d={arrow === 'point' ? 'M2 7h17' : 'M2 7h22'} strokeWidth={width} strokeDasharray={stroke === 'dotted' ? '3 3' : undefined} />
      {arrow === 'point' && <path d="M18 3l6 4-6 4z" fill="currentColor" strokeWidth={1} />}
    </svg>
  );
}

const STYLE_OPTIONS = EDGE_STYLES.map((s) => ({
  value: s.op,
  label: s.label.replace(/^[^a-z]+/, ''),
  content: <EdgeStyleIcon stroke={s.stroke} arrow={s.arrow} />,
}));

export function FlowEdgeView({ id, source, target, data, label, selected }: EdgeProps<FlowRFEdge>) {
  const a = useContext(FlowActionsContext);
  const src = useInternalNode(source);
  const tgt = useInternalNode(target);
  if (!src || !tgt) {
    return null;
  }
  const { from, to } = route(rectOf(src), rectOf(tgt), a.direction);
  const [path, lx, ly] = getSmoothStepPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition: POSITION[from.side],
    targetX: to.x,
    targetY: to.y,
    targetPosition: POSITION[to.side],
    borderRadius: 10,
    offset: 24,
  });
  const stroke = data?.stroke ?? 'normal';
  const arrow = data?.arrow ?? 'point';
  const text = label ? String(label) : '';
  const editing = a.editingEdgeId === id;
  const [ix, iy] = INWARD[to.side];
  // Arrowhead: tip on the node's border, base 9px back along the way in.
  const head = `M${to.x} ${to.y} L${to.x - ix * 9 - iy * 5} ${to.y - iy * 9 - ix * 5} L${to.x - ix * 9 + iy * 5} ${to.y - iy * 9 + ix * 5} Z`;
  const cls = `lv-flow-edge lv-flow-edge--${stroke}${selected ? ' is-selected' : ''}`;

  return (
    <>
      <path className="react-flow__edge-interaction" d={path} fill="none" strokeOpacity={0} strokeWidth={16} />
      <path className={cls} d={path} fill="none" />
      {arrow === 'point' && <path className={`${cls} lv-flow-head`} d={head} />}
      {(text || editing) && (
        <EdgeLabelRenderer>
          <div
            className={`lv-flow-pill nodrag nopan${selected ? ' is-selected' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
            onDoubleClick={(e) => { e.stopPropagation(); a.startEdgeEdit(id); }}
          >
            {editing ? (
              <InlineInput
                initial={text}
                placeholder="label"
                onCommit={(t) => a.commitEdgeLabel(id, t)}
                onCancel={a.cancelEdgeEdit}
              />
            ) : text}
          </div>
        </EdgeLabelRenderer>
      )}
      <EdgeToolbar edgeId={id} x={lx} y={ly - 16} alignY="bottom" isVisible={selected && !editing}>
        <div className="lv-float lv-flow-bar nodrag nopan">
          <Segmented label="Line style" options={STYLE_OPTIONS} value={edgeOp(stroke, arrow)} onChange={(op) => a.setEdgeOp(id, op)} />
          <Separator />
          <IconButton icon="rename" label={text ? 'Edit label' : 'Add label'} onPress={() => a.startEdgeEdit(id)} />
          <IconButton icon="swap" label="Reverse direction" onPress={() => a.reverseEdge(id)} />
          <IconButton icon="trash" label="Delete link" shortcut="⌫" danger onPress={() => a.removeEdge(id)} />
        </div>
      </EdgeToolbar>
    </>
  );
}
