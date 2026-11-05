import React, { useContext } from 'react';
import { Handle, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import type { MermaidShape } from '../../format/mermaid';
import { FlowActionsContext } from './actions';
import { InlineInput } from './InlineInput';
import type { Side } from './model';
import { NodeBar } from './NodeBar';
import { SHAPE_GEOMETRY, ShapeOutline } from './shapes';

// A flowchart step: its mermaid shape behind the label, four "+" handles on
// hover (drag to connect, click to add a step on that side), and the node bar
// when it is the only thing selected.

export type FlowNodeData = { label: string; shape: MermaidShape };
export type FlowRFNode = Node<FlowNodeData, 'shape'>;

const SIDES: { side: Side; position: Position }[] = [
  { side: 'top', position: Position.Top },
  { side: 'right', position: Position.Right },
  { side: 'bottom', position: Position.Bottom },
  { side: 'left', position: Position.Left },
];

export function FlowNodeView({ id, data, selected }: NodeProps<FlowRFNode>) {
  const a = useContext(FlowActionsContext);
  const geo = SHAPE_GEOMETRY[data.shape] ?? SHAPE_GEOMETRY.square;
  const editing = a.editingId === id;

  return (
    <div
      className={`lv-flow-node${selected ? ' is-selected' : ''}${editing ? ' is-editing' : ''}`}
      style={{ minHeight: geo.minHeight }}
    >
      <ShapeOutline shape={data.shape} />
      {SIDES.map(({ side, position }) => (
        // Every handle is a source; ConnectionMode.Loose lets any of them end a connection too.
        <Handle
          key={side}
          id={side}
          type="source"
          position={position}
          className={`lv-flow-plus lv-flow-plus--${side}`}
          title="Drag to connect · click to add a step here"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg>
        </Handle>
      ))}
      <div className="lv-flow-label" style={{ padding: `6px ${geo.padX}px` }}>
        {editing ? (
          <InlineInput
            initial={data.label}
            placeholder="New step"
            onCommit={(text, how) => a.commitLabel(id, text, how === 'tab')}
            onCancel={() => a.cancelEdit(id)}
          />
        ) : (
          data.label || <span className="lv-flow-placeholder">Untitled</span>
        )}
      </div>
      <NodeToolbar isVisible={a.soleNodeId === id && !editing} position={Position.Top} offset={12}>
        <NodeBar id={id} shape={data.shape} />
      </NodeToolbar>
    </div>
  );
}
