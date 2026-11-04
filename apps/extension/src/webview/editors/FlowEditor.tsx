import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  useViewport,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type OnConnectStartParams,
} from '@xyflow/react';
import {
  FlowData,
  FlowDirection,
  MermaidShape,
  toMermaid,
  tryFromMermaid,
} from '../format/mermaid';
import type { EditorProps } from '../BlockEditorApp';
import { CodePane } from '../ui/CodePane';
import { HelpDialog, Hint, IconButton, isTyping, Segmented, Separator, ZoomControls } from '../ui/controls';
import { Icon } from '../ui/icons';
import { UndoStack } from '../ui/undoStack';
import { FlowActions, FlowActionsContext } from './flow/actions';
import { FlowEdgeView, FlowRFEdge } from './flow/FlowEdgeView';
import { FLOW_CSS } from './flow/flowCss';
import { FlowNodeView, FlowRFNode } from './flow/FlowNodeView';
import { tidy } from './flow/layout';
import * as model from './flow/model';
import { Palette, SHAPE_DRAG_TYPE } from './flow/Palette';
import { SHAPE_GEOMETRY } from './flow/shapes';
import { ReadOnlyFallback } from './ReadOnlyFallback';

// The fence stores mermaid flowchart text; the graph is the editing model.
// Conversion happens only at this component's edge (tryFromMermaid / toMermaid),
// and NOTHING is written back until the user actually edits — opening a block
// must never normalize its fence. Node positions are view state only: mermaid
// stores none, so the graph is laid out (Tidy) when it opens.

const NODE_TYPES = { shape: FlowNodeView };
const EDGE_TYPES = { flow: FlowEdgeView };
const FIT = { padding: 0.2, maxZoom: 1 };

const SHORTCUTS = [
  { action: 'Add a step', keys: ['double-click'] },
  { action: 'Rename step', keys: ['Enter'] },
  { action: 'Add next step', keys: ['Tab'] },
  { action: 'Connect', keys: ['drag +'] },
  { action: 'Delete', keys: ['⌫'] },
  { action: 'Duplicate', keys: ['⌘D'] },
  { action: 'Select all', keys: ['⌘A'] },
  { action: 'Multi-select', keys: ['⇧ click', 'drag'] },
  { action: 'Nudge', keys: ['←↑→↓'] },
  { action: 'Undo / redo', keys: ['⌘Z', '⇧⌘Z'] },
  { action: 'Pan', keys: ['Space drag', 'scroll'] },
  { action: 'Zoom', keys: ['⌘ scroll'] },
  { action: 'Zoom to fit', keys: ['⇧1'] },
  { action: 'Deselect', keys: ['Esc'] },
];

interface Editing { id: string; isNew: boolean; }

function toRF(
  data: FlowData,
  prevNodes: FlowRFNode[],
  prevEdges: FlowRFEdge[],
  select?: { nodes?: string[]; edges?: string[] },
): { nodes: FlowRFNode[]; edges: FlowRFEdge[] } {
  const oldNode = new Map(prevNodes.map((n) => [n.id, n]));
  const oldEdge = new Map(prevEdges.map((e) => [e.id, e]));
  return {
    nodes: data.nodes.map((n) => ({
      id: n.id,
      type: 'shape',
      position: { x: n.x, y: n.y },
      data: { label: n.label, shape: n.shape },
      selected: select ? !!select.nodes?.includes(n.id) : oldNode.get(n.id)?.selected ?? false,
      // Keep React Flow's measurement so edges draw at once, before a re-measure.
      measured: oldNode.get(n.id)?.measured,
    })),
    edges: data.edges.map((e) => ({
      id: e.id,
      type: 'flow',
      source: e.source,
      target: e.target,
      label: e.label,
      data: { stroke: e.stroke, arrow: e.arrow },
      selected: select ? !!select.edges?.includes(e.id) : oldEdge.get(e.id)?.selected ?? false,
    })),
  };
}

function toData(nodes: FlowRFNode[], edges: FlowRFEdge[], direction: FlowDirection): FlowData {
  return {
    direction,
    nodes: nodes.map((n) => ({
      id: n.id,
      shape: n.data.shape ?? 'square',
      label: n.data.label ?? '',
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label ? String(e.label) : undefined,
      stroke: e.data?.stroke ?? 'normal',
      arrow: e.data?.arrow ?? 'point',
    })),
  };
}

/** Measured size, or an estimate from the label before React Flow has measured. */
function sizeOfNode(n: FlowRFNode | undefined): model.Size {
  if (!n) {
    return model.DEFAULT_SIZE;
  }
  if (n.measured?.width && n.measured.height) {
    return { w: n.measured.width, h: n.measured.height };
  }
  const geo = SHAPE_GEOMETRY[n.data.shape] ?? SHAPE_GEOMETRY.square;
  return { w: Math.max(120, n.data.label.length * 7.5 + geo.padX * 2), h: geo.minHeight };
}

export function FlowEditor(props: EditorProps) {
  return (
    <ReactFlowProvider>
      <FlowWorkspace {...props} />
    </ReactFlowProvider>
  );
}

function FlowWorkspace({ value, onChange, onGestureEnd }: EditorProps) {
  const rf = useReactFlow<FlowRFNode, FlowRFEdge>();
  const { zoom } = useViewport();
  const nodesInitialized = useNodesInitialized();

  const lastWritten = useRef(value);
  const touched = useRef(false); // no write-back before the first real user edit
  /** Lay out with measured sizes once React Flow has measured the nodes. */
  const needsLayout = useRef(true);

  // Parsed exactly once for initial state; later value changes go through the
  // re-hydrate effect below.
  const initialParse = useRef<FlowData | null | undefined>(undefined);
  if (initialParse.current === undefined) {
    initialParse.current = tryFromMermaid(value);
  }
  const [fallback, setFallback] = useState(initialParse.current === null);
  const [direction, setDirection] = useState<FlowDirection>(() => initialParse.current?.direction ?? 'TD');
  const [nodes, setNodes] = useState<FlowRFNode[]>(() => {
    const parsed = initialParse.current;
    if (!parsed) {
      return [];
    }
    const estimate = toRF(parsed, [], []).nodes;
    return toRF(tidy(parsed, (id) => sizeOfNode(estimate.find((n) => n.id === id))), [], []).nodes;
  });
  const [edges, setEdges] = useState<FlowRFEdge[]>(() =>
    initialParse.current ? toRF(initialParse.current, [], []).edges : [],
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(() => window.innerWidth > 900);
  const [showHelp, setShowHelp] = useState(false);
  const [dropping, setDropping] = useState(false);

  const undo = useRef(new UndoStack<FlowData>());
  const [, setHistoryTick] = useState(0);

  // Latest state for the stable callbacks below.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const directionRef = useRef(direction);
  directionRef.current = direction;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const data = useCallback(() => toData(nodesRef.current, edgesRef.current, directionRef.current), []);
  const sizeOf = useCallback((id: string) => sizeOfNode(nodesRef.current.find((n) => n.id === id)), []);
  /** The graph as last recorded in history (JSON), to spot what a gesture changed. */
  const committed = useRef(JSON.stringify(data()));

  const markTouched = () => { touched.current = true; };

  /** Replace the graph with `next`; `select` replaces the selection too. */
  const apply = useCallback((next: FlowData, select?: { nodes?: string[]; edges?: string[] }) => {
    touched.current = true;
    const out = toRF(next, nodesRef.current, edgesRef.current, select);
    nodesRef.current = out.nodes;
    edgesRef.current = out.edges;
    directionRef.current = next.direction;
    setNodes(out.nodes);
    setEdges(out.edges);
    setDirection(next.direction);
  }, []);

  const fitSoon = useCallback(() => {
    requestAnimationFrame(() => { void rf.fitView({ ...FIT, duration: 200 }); });
  }, [rf]);

  /** Pan (never zoom) so a node just added is on screen. */
  const reveal = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const n = rf.getInternalNode(id);
      const stage = document.querySelector('.lv-flow .react-flow')?.getBoundingClientRect();
      if (!n || !stage) {
        return;
      }
      const { w, h } = sizeOfNode(n);
      const p = n.internals.positionAbsolute;
      const tl = rf.flowToScreenPosition(p);
      const br = rf.flowToScreenPosition({ x: p.x + w, y: p.y + h });
      const m = 40;
      if (tl.x < stage.left + m || tl.y < stage.top + m || br.x > stage.right - m || br.y > stage.bottom - m) {
        void rf.setCenter(p.x + w / 2, p.y + h / 2, { zoom: rf.getZoom(), duration: 200 });
      }
    });
  }, [rf]);

  // Re-hydrate only on external change (file edit, undo in the text editor),
  // never on our own echo.
  useEffect(() => {
    if (value === lastWritten.current) {
      return;
    }
    lastWritten.current = value;
    touched.current = false; // fresh content — back to look-don't-touch
    const prev = data();
    const parsed = tryFromMermaid(value, prev);
    if (!parsed) {
      setFallback(true);
      return;
    }
    setFallback(false);
    setEditing(null);
    setEditingEdgeId(null);
    undo.current.clear();
    const known = new Set(prev.nodes.map((n) => n.id));
    needsLayout.current = parsed.nodes.some((n) => !known.has(n.id));
    const out = toRF(parsed, nodesRef.current, edgesRef.current);
    setNodes(out.nodes);
    setEdges(out.edges);
    setDirection(parsed.direction);
    committed.current = JSON.stringify(parsed);
  }, [value, data]);

  // First measurement (and new nodes from outside): lay out with real sizes.
  // Positions are not in the fence, so this never writes.
  useEffect(() => {
    if (!nodesInitialized || !needsLayout.current) {
      return;
    }
    needsLayout.current = false;
    const laid = toRF(tidy(data(), sizeOf), nodesRef.current, edgesRef.current);
    nodesRef.current = laid.nodes;
    setNodes(laid.nodes);
    fitSoon();
  }, [nodesInitialized, data, sizeOf, fitSoon]);

  // Commit graph → mermaid text, but only after a real user gesture.
  useEffect(() => {
    if (!touched.current || fallback) {
      return;
    }
    const mermaid = toMermaid(toData(nodes, edges, direction));
    if (mermaid !== lastWritten.current) {
      lastWritten.current = mermaid;
      onChange(mermaid);
    }
  }, [nodes, edges, direction, fallback, onChange]);

  // History: once a gesture settles (no drag, no label being typed), record
  // the state it started from and flush the write.
  useEffect(() => {
    if (editing || editingEdgeId || nodes.some((n) => n.dragging)) {
      return;
    }
    const snap = JSON.stringify(toData(nodes, edges, direction));
    if (snap === committed.current) {
      return;
    }
    if (touched.current) {
      undo.current.record(JSON.parse(committed.current) as FlowData);
      setHistoryTick((t) => t + 1);
      onGestureEnd();
    }
    committed.current = snap;
  }, [nodes, edges, direction, editing, editingEdgeId, onGestureEnd]);

  const restore = useCallback((target: FlowData | null) => {
    if (!target) {
      return;
    }
    setEditing(null);
    setEditingEdgeId(null);
    committed.current = JSON.stringify(target);
    apply(target, { nodes: [], edges: [] });
    setHistoryTick((t) => t + 1);
  }, [apply]);
  const doUndo = useCallback(() => restore(undo.current.undo(data())), [restore, data]);
  const doRedo = useCallback(() => restore(undo.current.redo(data())), [restore, data]);

  // ---- editing actions ------------------------------------------------------

  /** Add a node and open its label right away. */
  const addAt = useCallback((at: { x: number; y: number }, shape: MermaidShape = 'square') => {
    const r = model.addNode(data(), at, shape);
    apply(r.data, { nodes: [r.id] });
    setEditing({ id: r.id, isNew: true });
    reveal(r.id);
  }, [data, apply, reveal]);

  const addNext = useCallback((id: string, side?: model.Side) => {
    const d = data();
    const at = model.placeBeside(d, id, side ?? model.forwardSide(d.direction), sizeOf);
    const r = model.addConnected(d, id, at);
    apply(r.data, { nodes: [r.id] });
    setEditing({ id: r.id, isNew: true });
    reveal(r.id);
  }, [data, apply, sizeOf, reveal]);

  const sole = useMemo(() => {
    const selNodes = nodes.filter((n) => n.selected);
    const selEdges = edges.filter((e) => e.selected);
    return {
      node: selNodes.length === 1 && !selEdges.length ? selNodes[0].id : null,
      nodes: selNodes.map((n) => n.id),
      edges: selEdges.map((e) => e.id),
    };
  }, [nodes, edges]);

  const actions: FlowActions = useMemo(() => ({
    direction,
    editingId: editing?.id ?? null,
    editingEdgeId,
    soleNodeId: sole.node,
    startEdit: (id) => {
      setEditingEdgeId(null);
      setEditing({ id, isNew: false });
    },
    commitLabel: (id, label, next) => {
      const was = editingRef.current;
      setEditing(null);
      const d = data();
      const node = d.nodes.find((n) => n.id === id);
      if (!node) {
        return;
      }
      const text = label.trim() || (was?.isNew ? 'New step' : node.label);
      apply(model.updateNode(d, id, { label: text }), { nodes: [id] });
      if (next) {
        addNext(id);
      }
    },
    cancelEdit: (id) => {
      const was = editingRef.current;
      setEditing(null);
      if (was?.isNew && was.id === id) {
        apply(model.remove(data(), [id]), { nodes: [] });
      }
    },
    addNext,
    setShape: (id, shape) => apply(model.updateNode(data(), id, { shape }), { nodes: [id] }),
    duplicate: (id) => {
      const r = model.duplicate(data(), [id]);
      apply(r.data, { nodes: r.ids });
    },
    removeNode: (id) => apply(model.remove(data(), [id]), { nodes: [] }),
    startEdgeEdit: (id) => {
      setEditing(null);
      setEditingEdgeId(id);
      setEdges((es) => es.map((e) => ({ ...e, selected: e.id === id })));
    },
    commitEdgeLabel: (id, label) => {
      setEditingEdgeId(null);
      apply(model.updateEdge(data(), id, { label: label.trim() || undefined }), { edges: [id] });
    },
    cancelEdgeEdit: () => setEditingEdgeId(null),
    setEdgeOp: (id, op) => apply(model.setEdgeOp(data(), id, op), { edges: [id] }),
    reverseEdge: (id) => apply(model.reverseEdge(data(), id), { edges: [id] }),
    removeEdge: (id) => apply(model.remove(data(), [], [id]), { edges: [] }),
  }), [direction, editing, editingEdgeId, sole.node, data, apply, addNext]);

  const relayout = useCallback((dir: FlowDirection) => {
    apply(tidy(data(), sizeOf, dir));
    fitSoon();
  }, [apply, data, sizeOf, fitSoon]);

  // ---- React Flow wiring (stable callbacks: no state churn per render) ------

  const onNodesChange = useCallback((changes: NodeChange<FlowRFNode>[]) => {
    if (changes.some((c) => c.type === 'position' || c.type === 'remove')) {
      markTouched();
    }
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange<FlowRFEdge>[]) => {
    if (changes.some((c) => c.type === 'remove')) {
      markTouched();
    }
    setEdges((es) => applyEdgeChanges(changes, es));
  }, []);
  const onConnect = useCallback((conn: Connection) => {
    apply(model.connect(data(), conn.source, conn.target));
  }, [apply, data]);

  const connectStart = useRef<{ x: number; y: number } | null>(null);
  const onConnectStart = useCallback((e: MouseEvent | TouchEvent, _p: OnConnectStartParams) => {
    connectStart.current = clientPoint(e);
  }, []);
  const onConnectEnd = useCallback((e: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    const start = connectStart.current;
    connectStart.current = null;
    if (state.isValid || !state.fromNode) {
      return; // a valid drop is handled by onConnect
    }
    const fromId = state.fromNode.id;
    const p = clientPoint(e);
    // A click on a "+" (no real drag) adds a step on that side.
    if (start && Math.hypot(p.x - start.x, p.y - start.y) < 6) {
      addNext(fromId, (state.fromHandle?.id ?? undefined) as model.Side | undefined);
      return;
    }
    // Released over a node's body rather than near one of its handles.
    const over = document.elementFromPoint(p.x, p.y)?.closest<HTMLElement>('.react-flow__node');
    const overId = over?.dataset.id;
    if (overId && overId !== fromId) {
      apply(model.connect(data(), fromId, overId));
      return;
    }
    // Released on empty canvas: a new step there, connected.
    const at = rf.screenToFlowPosition(p);
    const size = model.DEFAULT_SIZE;
    const r = model.addConnected(data(), fromId, { x: at.x - size.w / 2, y: at.y - size.h / 2 });
    apply(r.data, { nodes: [r.id] });
    setEditing({ id: r.id, isNew: true });
  }, [addNext, apply, data, rf]);

  const onNodeDoubleClick = useCallback((_e: React.MouseEvent, node: FlowRFNode) => actions.startEdit(node.id), [actions]);
  const onEdgeDoubleClick = useCallback((_e: React.MouseEvent, edge: FlowRFEdge) => actions.startEdgeEdit(edge.id), [actions]);

  const onStageDoubleClick = (e: React.MouseEvent) => {
    if (!(e.target as Element).classList.contains('react-flow__pane')) {
      return;
    }
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addAt({ x: at.x - model.DEFAULT_SIZE.w / 2, y: at.y - model.DEFAULT_SIZE.h / 2 });
  };

  const addFromPalette = (shape: MermaidShape) => {
    const stage = document.querySelector('.lv-flow .react-flow')?.getBoundingClientRect();
    const middle = stage
      ? rf.screenToFlowPosition({ x: stage.left + stage.width / 2, y: stage.top + stage.height / 2 })
      : { x: 0, y: 0 };
    addAt(model.freeSpotNear(data(), middle, sizeOf), shape);
  };

  const onDrop = (e: React.DragEvent) => {
    setDropping(false);
    const shape = e.dataTransfer.getData(SHAPE_DRAG_TYPE) as MermaidShape;
    if (!shape || !SHAPE_GEOMETRY[shape]) {
      return;
    }
    e.preventDefault();
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addAt({ x: at.x - model.DEFAULT_SIZE.w / 2, y: at.y - model.DEFAULT_SIZE.h / 2 }, shape);
  };

  // ---- keyboard ---------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || fallback) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const selected = nodesRef.current.filter((n) => n.selected).map((n) => n.id);
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) { doRedo(); } else { doUndo(); }
      } else if (mod && k === 'y') {
        e.preventDefault();
        doRedo();
      } else if (mod && k === 'd') {
        e.preventDefault();
        if (selected.length) {
          const r = model.duplicate(data(), selected);
          apply(r.data, { nodes: r.ids });
        }
      } else if (mod && k === 'a') {
        e.preventDefault();
        setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
      } else if (e.key === 'Enter' && sole.node) {
        e.preventDefault();
        actions.startEdit(sole.node);
      } else if (e.key === 'Tab' && sole.node) {
        e.preventDefault();
        addNext(sole.node);
      } else if (e.key === 'Escape') {
        setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        setEdges((es) => es.map((x) => (x.selected ? { ...x, selected: false } : x)));
      } else if (k.startsWith('arrow') && selected.length && !mod) {
        e.preventDefault();
        const s = e.shiftKey ? 10 : 1;
        const [dx, dy] = { arrowleft: [-s, 0], arrowright: [s, 0], arrowup: [0, -s], arrowdown: [0, s] }[k] ?? [0, 0];
        const d = data();
        apply({ ...d, nodes: d.nodes.map((n) => (selected.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) });
      } else if (e.key === '?') {
        setShowHelp(true);
      } else if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) {
        fitSoon();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fallback, doUndo, doRedo, data, apply, sole.node, actions, addNext, fitSoon]);

  if (fallback) {
    return (
      <ReadOnlyFallback
        content={value}
        message="This diagram uses features the visual editor can't edit without losing them (subgraphs, styles/classes, click handlers, special arrows, or a non-flowchart type) — edit it as text; the block is left untouched."
      />
    );
  }

  const hint = editing
    ? <><kbd>Enter</kbd> to finish · <kbd>Tab</kbd> adds the next step · <kbd>Esc</kbd> cancels</>
    : sole.node
      ? <><kbd>Enter</kbd> renames · <kbd>Tab</kbd> adds the next step · drag a <b>+</b> to connect · <kbd>⌫</kbd> deletes</>
      : sole.edges.length
        ? <>Pick a line style · double-click to label · <kbd>⌫</kbd> deletes</>
        : nodes.length
          ? <>Double-click to add a step · drag a <b>+</b> to connect · <kbd>Tab</kbd> adds the next step</>
          : <>Double-click anywhere, or pick a shape on the left, to add the first step</>;

  const topDown: FlowDirection = direction === 'TB' ? 'TB' : 'TD';

  return (
    <div className={`lv-editor lv-flow${dropping ? ' is-dropping' : ''}`}>
      <style>{FLOW_CSS}</style>
      <div className="lv-bar">
        <span className="lv-flow-dir-label">Direction</span>
        <Segmented<FlowDirection>
          label="Direction"
          value={direction}
          onChange={(d) => relayout(d)}
          options={[
            { value: topDown, label: 'Top to bottom', content: <Icon name="dirDown" /> },
            { value: 'LR', label: 'Left to right', content: <Icon name="dirRight" /> },
            { value: 'RL', label: 'Right to left', content: <Icon name="dirLeft" /> },
            { value: 'BT', label: 'Bottom to top', content: <Icon name="dirUp" /> },
          ]}
        />
        <button
          type="button"
          className="lv-btn lv-btn--ghost"
          title="Tidy: lay the steps out in this direction"
          onMouseDown={(e) => { e.preventDefault(); relayout(direction); }}
        >
          <Icon name="tidy" /> Tidy
        </button>
        <span className="lv-spacer" />
        <IconButton icon="undo" label="Undo" shortcut="⌘Z" disabled={!undo.current.canUndo} onPress={doUndo} />
        <IconButton icon="redo" label="Redo" shortcut="⇧⌘Z" disabled={!undo.current.canRedo} onPress={doRedo} />
        <Separator />
        <IconButton icon="code" label={showCode ? 'Hide mermaid' : 'Show mermaid'} pressed={showCode} onPress={() => setShowCode((s) => !s)} />
        <IconButton icon="help" label="Keyboard shortcuts" shortcut="?" onPress={() => setShowHelp(true)} />
      </div>
      <div className="lv-body">
        <div
          className="lv-stage"
          onDoubleClick={onStageDoubleClick}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(SHAPE_DRAG_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setDropping(true);
            }
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}
        >
          <FlowActionsContext.Provider value={actions}>
            <ReactFlow<FlowRFNode, FlowRFEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectStart={onConnectStart}
              onConnectEnd={onConnectEnd}
              onNodeDoubleClick={onNodeDoubleClick}
              onEdgeDoubleClick={onEdgeDoubleClick}
              connectionMode={ConnectionMode.Loose}
              connectOnClick={false}
              connectionRadius={28}
              deleteKeyCode={['Delete', 'Backspace']}
              multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
              selectionOnDrag
              panOnDrag={[1]}
              panOnScroll
              zoomOnScroll={false}
              zoomOnDoubleClick={false}
              zoomActivationKeyCode={['Meta', 'Control']}
              disableKeyboardA11y
              nodesFocusable={false}
              edgesFocusable={false}
              elevateEdgesOnSelect
              fitView
              fitViewOptions={FIT}
              minZoom={0.2}
              maxZoom={2.5}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="color-mix(in srgb, var(--vscode-foreground) 20%, transparent)" />
            </ReactFlow>
          </FlowActionsContext.Provider>
          <Palette onAdd={addFromPalette} />
          <ZoomControls
            zoom={zoom}
            onZoomIn={() => { void rf.zoomIn({ duration: 150 }); }}
            onZoomOut={() => { void rf.zoomOut({ duration: 150 }); }}
            onFit={fitSoon}
          />
          <Hint>{hint}</Hint>
        </div>
        {showCode && <CodePane value={value} onClose={() => setShowCode(false)} />}
      </div>
      <HelpDialog open={showHelp} title="Flowchart shortcuts" rows={SHORTCUTS} onClose={() => setShowHelp(false)} />
    </div>
  );
}

function clientPoint(e: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('changedTouches' in e && e.changedTouches.length) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  const m = e as MouseEvent;
  return { x: m.clientX, y: m.clientY };
}
