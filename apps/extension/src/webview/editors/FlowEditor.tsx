import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ReactFlow, Background, Controls, Handle, Position, MarkerType,
  applyNodeChanges, applyEdgeChanges,
  type Node as RFNode, type Edge as RFEdge, type Connection,
  type NodeChange, type EdgeChange, type NodeProps,
} from '@xyflow/react';
import {
  DIRECTION_LABELS,
  EDGE_STYLES,
  EdgeArrow,
  EdgeStroke,
  FlowData,
  FlowDirection,
  MermaidShape,
  SHAPE_LABELS,
  toMermaid,
  tryFromMermaid,
} from '../format/mermaid';
import type { EditorProps } from '../BlockEditorApp';
import { ReadOnlyFallback } from './ReadOnlyFallback';

// The fence stores mermaid flowchart text; the graph is the editing model.
// Conversion happens only at this component's edge (tryFromMermaid / toMermaid),
// and NOTHING is written back until the user actually edits — opening a block
// must never normalize its fence.

/** Label-edit callback shared with the custom node components (keeps node `data` pure). */
const LabelCtx = createContext<(id: string, v: string) => void>(() => {});

const BTN: React.CSSProperties = {
  background: 'var(--vscode-button-secondaryBackground, #3a3d41)',
  color: 'var(--vscode-button-secondaryForeground, #ccc)',
  border: '1px solid var(--vscode-panel-border, #555)',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: '0.76em',
  cursor: 'pointer',
};

const LABEL_INPUT: React.CSSProperties = {
  background: 'transparent', border: 'none', outline: 'none',
  textAlign: 'center', color: 'var(--vscode-foreground)', font: 'inherit', width: '100%',
};

function LabelField({ id, data }: NodeProps) {
  const onLabel = useContext(LabelCtx);
  return (
    <input
      className="nodrag"
      value={(data as { label: string }).label}
      placeholder="…"
      onChange={e => onLabel(id, e.target.value)}
      onMouseDown={e => e.stopPropagation()}
      style={LABEL_INPUT}
    />
  );
}

// Each mermaid shape draws its own outline as inline SVG stretched over the
// node box (`preserveAspectRatio: none` + non-scaling-stroke, so the geometry
// follows the label's width while the stroke stays 1px). One node component
// reads `data.shape` — collapsing 14 shapes onto 3 visuals meant e.g. picking
// Hexagon on a Diamond changed nothing on screen.
interface ShapeGeometry {
  /** SVG in a 0 0 100 100 viewBox. */
  render: React.ReactNode;
  /** Extra horizontal room so text clears slanted/pointed edges. */
  padX: number;
  minHeight: number;
}

const STROKE = 'var(--vscode-focusBorder, #007acc)';
const FILL = 'var(--vscode-editorWidget-background, #252526)';

const poly = (points: string) => (
  <polygon points={points} fill={FILL} stroke={STROKE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
);

const SHAPE_GEOMETRY: Record<MermaidShape, ShapeGeometry> = {
  square: { render: <rect x={0} y={0} width={100} height={100} rx={3} fill={FILL} stroke={STROKE} strokeWidth={1} vectorEffect="non-scaling-stroke" />, padX: 12, minHeight: 40 },
  round: { render: <rect x={0} y={0} width={100} height={100} rx={14} fill={FILL} stroke={STROKE} strokeWidth={1} vectorEffect="non-scaling-stroke" />, padX: 14, minHeight: 40 },
  stadium: { render: <rect x={0} y={0} width={100} height={100} rx={50} fill={FILL} stroke={STROKE} strokeWidth={1} vectorEffect="non-scaling-stroke" />, padX: 20, minHeight: 40 },
  subroutine: {
    render: (
      <>
        <rect x={0} y={0} width={100} height={100} fill={FILL} stroke={STROKE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d="M8 0 V100 M92 0 V100" stroke={STROKE} strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
      </>
    ),
    padX: 20, minHeight: 40,
  },
  cylinder: {
    render: (
      <>
        <path d="M0 12 A50 12 0 0 1 100 12 V88 A50 12 0 0 1 0 88 Z" fill={FILL} stroke={STROKE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d="M0 12 A50 12 0 0 0 100 12" fill="none" stroke={STROKE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </>
    ),
    padX: 14, minHeight: 52,
  },
  // Circle/double-circle stretch with the label, so wide text reads as an oval.
  circle: { render: <ellipse cx={50} cy={50} rx={49.5} ry={49.5} fill={FILL} stroke={STROKE} strokeWidth={1} vectorEffect="non-scaling-stroke" />, padX: 22, minHeight: 56 },
  doublecircle: {
    render: (
      <>
        <ellipse cx={50} cy={50} rx={49.5} ry={49.5} fill={FILL} stroke={STROKE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <ellipse cx={50} cy={50} rx={42} ry={42} fill="none" stroke={STROKE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </>
    ),
    padX: 26, minHeight: 60,
  },
  odd: { render: poly('0,0 90,0 100,50 90,100 0,100'), padX: 16, minHeight: 40 },
  diamond: { render: poly('50,0 100,50 50,100 0,50'), padX: 26, minHeight: 64 },
  hexagon: { render: poly('20,0 80,0 100,50 80,100 20,100 0,50'), padX: 24, minHeight: 48 },
  lean_right: { render: poly('18,0 100,0 82,100 0,100'), padX: 20, minHeight: 40 },
  lean_left: { render: poly('0,0 82,0 100,100 18,100'), padX: 20, minHeight: 40 },
  trapezoid: { render: poly('18,0 82,0 100,100 0,100'), padX: 22, minHeight: 42 },
  inv_trapezoid: { render: poly('0,0 100,0 82,100 18,100'), padX: 22, minHeight: 42 },
};

function ShapeNode(props: NodeProps) {
  const shape = ((props.data as { shape?: MermaidShape }).shape ?? 'square') as MermaidShape;
  const geo = SHAPE_GEOMETRY[shape] ?? SHAPE_GEOMETRY.square;
  return (
    <div
      style={{
        position: 'relative',
        minWidth: 120,
        minHeight: geo.minHeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--vscode-foreground)',
        fontSize: 12,
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        {geo.render}
      </svg>
      <Handle type="target" position={Position.Top} />
      <div style={{ position: 'relative', width: '100%', padding: `6px ${geo.padX}px` }}>
        <LabelField {...props} />
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const NODE_TYPES = { shape: ShapeNode };

// The mermaid shape rides in node/edge `data` so nothing is lost between parse
// and write-back; ShapeNode draws whichever shape it finds there.
function toRF(data: FlowData): { nodes: RFNode[]; edges: RFEdge[] } {
  return {
    nodes: data.nodes.map(n => ({
      id: n.id,
      type: 'shape',
      position: { x: n.x, y: n.y },
      data: { label: n.label, shape: n.shape },
    })),
    edges: data.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      data: { stroke: e.stroke, arrow: e.arrow },
      style: e.stroke === 'dotted' ? { strokeDasharray: '6 4' } : e.stroke === 'thick' ? { strokeWidth: 2.5 } : undefined,
      markerEnd: e.arrow === 'point' ? { type: MarkerType.ArrowClosed } : undefined,
    })),
  };
}

/** Next `<prefix><n>` id not already used. */
function nextId(prefix: string, used: Set<string>): string {
  let i = 1;
  while (used.has(`${prefix}${i}`)) { i++; }
  return `${prefix}${i}`;
}

export function FlowEditor({ value, onChange, onGestureEnd }: EditorProps) {
  const lastWritten = useRef(value);
  const touched = useRef(false); // no write-back before the first real user edit

  // Parsed exactly once for initial state; later value changes go through the
  // re-hydrate effect below.
  const initialParse = useRef<FlowData | null | undefined>(undefined);
  if (initialParse.current === undefined) {
    initialParse.current = tryFromMermaid(value);
  }
  const [fallback, setFallback] = useState(initialParse.current === null);
  const [nodes, setNodes] = useState<RFNode[]>(() =>
    initialParse.current ? toRF(initialParse.current).nodes : [],
  );
  const [edges, setEdges] = useState<RFEdge[]>(() =>
    initialParse.current ? toRF(initialParse.current).edges : [],
  );
  const [direction, setDirection] = useState<FlowDirection>(
    () => initialParse.current?.direction ?? 'TD',
  );
  const [selNodes, setSelNodes] = useState<string[]>([]);
  const [selEdges, setSelEdges] = useState<string[]>([]);
  /** "＋ Node" is armed: the next pane click places the node there. */
  const [armed, setArmed] = useState(false);
  // Only the coordinate helper is needed, so keep the ref narrow rather than
  // wrestling ReactFlowInstance's generics.
  const instance = useRef<{ screenToFlowPosition(p: { x: number; y: number }): { x: number; y: number } } | null>(null);

  // Escape disarms — a mode you can't leave is a trap.
  useEffect(() => {
    if (!armed) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setArmed(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [armed]);

  const currentData = useCallback((): FlowData => ({
    direction,
    nodes: nodes.map(n => {
      const data = n.data as { label?: string; shape?: MermaidShape };
      return {
        id: n.id,
        shape: data.shape ?? 'square',
        label: data.label ?? '',
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
      };
    }),
    edges: edges.map(e => {
      const data = (e.data ?? {}) as { stroke?: EdgeStroke; arrow?: EdgeArrow };
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label ? String(e.label) : undefined,
        stroke: data.stroke ?? 'normal',
        arrow: data.arrow ?? 'point',
      };
    }),
  }), [nodes, edges, direction]);
  const currentDataRef = useRef(currentData);
  currentDataRef.current = currentData;

  const hydrate = useCallback((data: FlowData) => {
    const rf = toRF(data);
    setNodes(rf.nodes);
    setEdges(rf.edges);
    setDirection(data.direction);
  }, []);

  // Re-hydrate only on external change (file edit, undo), never on our own echo.
  useEffect(() => {
    if (value === lastWritten.current) {
      return;
    }
    lastWritten.current = value;
    touched.current = false; // fresh content — back to look-don't-touch
    const parsed = tryFromMermaid(value, currentDataRef.current());
    if (!parsed) {
      setFallback(true);
      return;
    }
    setFallback(false);
    hydrate(parsed);
  }, [value, hydrate]);

  // Commit graph → mermaid text, but only after a real user gesture.
  useEffect(() => {
    if (!touched.current || fallback) {
      return;
    }
    const mermaid = toMermaid(currentDataRef.current());
    if (mermaid !== lastWritten.current) {
      lastWritten.current = mermaid;
      onChange(mermaid);
    }
  }, [nodes, edges, direction, fallback, onChange]);

  const markTouched = () => { touched.current = true; };

  const onLabel = useCallback((id: string, v: string) => {
    markTouched();
    setNodes(ns => ns.map(n => (n.id === id ? { ...n, data: { ...n.data, label: v } } : n)));
  }, []);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (changes.some(c => c.type === 'position' || c.type === 'remove')) { markTouched(); }
    setNodes(ns => applyNodeChanges(changes, ns));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some(c => c.type === 'remove')) { markTouched(); }
    setEdges(es => applyEdgeChanges(changes, es));
  }, []);
  const onConnect = useCallback((conn: Connection) => {
    markTouched();
    setEdges(es => [...es, {
      id: nextId('e', new Set(es.map(e => e.id))),
      source: conn.source,
      target: conn.target,
      data: { stroke: 'normal', arrow: 'point' },
      markerEnd: { type: MarkerType.ArrowClosed },
    }]);
  }, []);

  // New nodes are rectangles and arrive selected, so the Shape control is
  // immediately pointed at them — one button plus one dropdown covers all
  // 14 shapes without a button per shape.
  const addNodeAt = (position: { x: number; y: number }) => {
    markTouched();
    setNodes(ns => [
      ...ns.map(n => (n.selected ? { ...n, selected: false } : n)),
      {
        id: nextId('n', new Set(ns.map(n => n.id))),
        type: 'shape',
        position,
        data: { label: '', shape: 'square' as MermaidShape },
        selected: true,
      },
    ]);
    onGestureEnd();
  };

  /** Click the pane while armed to drop the node exactly there. */
  const onPaneClick = (e: React.MouseEvent) => {
    if (!armed) {
      return;
    }
    setArmed(false);
    const at = instance.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    // Center the node on the cursor rather than hanging it off to the corner.
    addNodeAt(at ? { x: Math.round(at.x - 60), y: Math.round(at.y - 20) } : { x: 60, y: 40 });
  };

  const selectedNode = selNodes.length === 1 ? nodes.find(n => n.id === selNodes[0]) : undefined;
  const setSelectedShape = (shape: MermaidShape) => {
    if (!selectedNode) { return; }
    markTouched();
    setNodes(ns => ns.map(n => (n.id === selectedNode.id
      ? { ...n, data: { ...n.data, shape } }
      : n)));
    onGestureEnd();
  };

  const deleteSelected = () => {
    if (!selNodes.length && !selEdges.length) { return; }
    markTouched();
    const dead = new Set(selNodes);
    setNodes(ns => ns.filter(n => !dead.has(n.id)));
    setEdges(es => es.filter(e => !selEdges.includes(e.id) && !dead.has(e.source) && !dead.has(e.target)));
    setSelNodes([]); setSelEdges([]);
    onGestureEnd();
  };

  const selectedEdge = selEdges.length === 1 ? edges.find(e => e.id === selEdges[0]) : undefined;
  const setEdgeLabel = (v: string) => {
    markTouched();
    setEdges(es => es.map(e => (e.id === selectedEdge?.id ? { ...e, label: v } : e)));
  };

  /** Restyle the selected edge — the visual and `data` must move together. */
  const setEdgeStyle = (op: string) => {
    const style = EDGE_STYLES.find(s => s.op === op);
    if (!selectedEdge || !style) { return; }
    markTouched();
    setEdges(es => es.map(e => (e.id === selectedEdge.id
      ? {
          ...e,
          data: { stroke: style.stroke, arrow: style.arrow },
          style: style.stroke === 'dotted'
            ? { strokeDasharray: '6 4' }
            : style.stroke === 'thick' ? { strokeWidth: 2.5 } : undefined,
          markerEnd: style.arrow === 'point' ? { type: MarkerType.ArrowClosed } : undefined,
        }
      : e)));
    onGestureEnd();
  };

  const selectedEdgeOp = selectedEdge
    ? (() => {
        const d = (selectedEdge.data ?? {}) as { stroke?: EdgeStroke; arrow?: EdgeArrow };
        return EDGE_STYLES.find(s => s.stroke === (d.stroke ?? 'normal') && s.arrow === (d.arrow ?? 'point'))?.op ?? '-->';
      })()
    : '-->';

  if (fallback) {
    return (
      <ReadOnlyFallback
        content={value}
        message="This diagram uses features the visual editor can't edit without losing them (subgraphs, styles/classes, click handlers, special arrows, or a non-flowchart type) — edit it as text; the block is left untouched."
      />
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--vscode-panel-border, #333)', flexWrap: 'wrap' }}>
        <button
          style={{
            ...BTN,
            ...(armed
              ? {
                  outline: '2px solid var(--vscode-focusBorder,#007acc)',
                  background: 'var(--vscode-button-background, #0e639c)',
                  color: 'var(--vscode-button-foreground, #fff)',
                }
              : {}),
          }}
          title={armed ? 'Click the canvas to place the node (Esc to cancel)' : 'Add a node: click here, then click where it goes'}
          onMouseDown={e => { e.preventDefault(); setArmed(a => !a); }}
        >
          {armed ? '◎ Click to place…' : '＋ Node'}
        </button>
        <select
          className="nodrag"
          value={direction}
          onChange={e => { markTouched(); setDirection(e.target.value as FlowDirection); onGestureEnd(); }}
          title="Diagram direction"
          style={{ ...BTN, cursor: 'pointer' }}
        >
          {(Object.keys(DIRECTION_LABELS) as FlowDirection[]).map(d => (
            <option key={d} value={d}>{DIRECTION_LABELS[d]}</option>
          ))}
        </select>

        {/* Contextual: only what the current selection can actually change. */}
        {selectedNode && (
          <select
            className="nodrag"
            value={(selectedNode.data as { shape?: MermaidShape }).shape ?? 'square'}
            onChange={e => setSelectedShape(e.target.value as MermaidShape)}
            title="Shape of the selected node"
            style={{ ...BTN, cursor: 'pointer' }}
          >
            {(Object.keys(SHAPE_LABELS) as MermaidShape[]).map(s => (
              <option key={s} value={s}>{SHAPE_LABELS[s]}</option>
            ))}
          </select>
        )}
        {selectedEdge && (
          <>
            <select
              className="nodrag"
              value={selectedEdgeOp}
              onChange={e => setEdgeStyle(e.target.value)}
              title="Style of the selected edge"
              style={{ ...BTN, cursor: 'pointer' }}
            >
              {EDGE_STYLES.map(s => (
                <option key={s.op} value={s.op}>{s.label}</option>
              ))}
            </select>
            <input className="nodrag" placeholder="edge label" value={selectedEdge.label ? String(selectedEdge.label) : ''} onChange={e => setEdgeLabel(e.target.value)} style={{ ...BTN, cursor: 'text', minWidth: 120 }} />
          </>
        )}
        {(selNodes.length > 0 || selEdges.length > 0) && (
          <button style={BTN} onMouseDown={e => { e.preventDefault(); deleteSelected(); }}>Delete</button>
        )}
      </div>
      <div className={armed ? 'lavagna-armed' : undefined} style={{ flex: 1, minHeight: 0 }}>
        {/* React Flow's pane sets its own `grab` cursor, so override it while armed. */}
        <style>{'.lavagna-armed .react-flow__pane { cursor: crosshair !important; }'}</style>
        <LabelCtx.Provider value={onLabel}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onInit={inst => { instance.current = inst; }}
            onPaneClick={onPaneClick}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onGestureEnd}
            onSelectionChange={({ nodes: n, edges: e }) => { setSelNodes(n.map(x => x.id)); setSelEdges(e.map(x => x.id)); }}
            deleteKeyCode={['Delete', 'Backspace']}
            zoomOnScroll={false}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </LabelCtx.Provider>
      </div>
    </div>
  );
}
