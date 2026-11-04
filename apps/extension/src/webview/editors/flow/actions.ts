import { createContext } from 'react';
import type { FlowDirection, MermaidShape } from '../../format/mermaid';
import type { Side } from './model';

// What the custom node and edge components may ask the editor to do. Passed
// through context so node/edge `data` stays plain graph data.

export interface FlowActions {
  direction: FlowDirection;
  /** Node whose label is being typed, if any. */
  editingId: string | null;
  /** Edge whose label is being typed, if any. */
  editingEdgeId: string | null;
  /** The node the floating bar belongs to: set only when exactly one node is selected. */
  soleNodeId: string | null;

  startEdit(id: string): void;
  /** `next`: also add a connected step in the diagram direction (Tab). */
  commitLabel(id: string, label: string, next?: boolean): void;
  cancelEdit(id: string): void;
  addNext(id: string, side?: Side): void;
  setShape(id: string, shape: MermaidShape): void;
  duplicate(id: string): void;
  removeNode(id: string): void;

  startEdgeEdit(id: string): void;
  commitEdgeLabel(id: string, label: string): void;
  cancelEdgeEdit(): void;
  setEdgeOp(id: string, op: string): void;
  reverseEdge(id: string): void;
  removeEdge(id: string): void;
}

const noop = () => {};

export const FlowActionsContext = createContext<FlowActions>({
  direction: 'TD',
  editingId: null,
  editingEdgeId: null,
  soleNodeId: null,
  startEdit: noop,
  commitLabel: noop,
  cancelEdit: noop,
  addNext: noop,
  setShape: noop,
  duplicate: noop,
  removeNode: noop,
  startEdgeEdit: noop,
  commitEdgeLabel: noop,
  cancelEdgeEdit: noop,
  setEdgeOp: noop,
  reverseEdge: noop,
  removeEdge: noop,
});
