import {
  EDGE_STYLES,
  EdgeArrow,
  EdgeStroke,
  FlowData,
  FlowDirection,
  FlowEdge,
  FlowNode,
  MermaidShape,
} from '../../format/mermaid';

// Graph edits for the flowchart editor, as plain functions over FlowData.
// Positions are top-left corners in flow coordinates; sizes come from the
// caller (React Flow measures the nodes) through `SizeOf`.

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface Size { w: number; h: number; }
export type SizeOf = (id: string) => Size;

/** Size assumed for a node that has not been measured yet. */
export const DEFAULT_SIZE: Size = { w: 140, h: 44 };
const NODE_GAP = 56;

/** Next `<prefix><n>` id not already used. */
export function nextId(prefix: string, used: Set<string>): string {
  let i = 1;
  while (used.has(`${prefix}${i}`)) {
    i++;
  }
  return `${prefix}${i}`;
}

/** The side a "next step" grows from in each direction. */
export function forwardSide(direction: FlowDirection): Side {
  switch (direction) {
    case 'LR': return 'right';
    case 'RL': return 'left';
    case 'BT': return 'top';
    default: return 'bottom';
  }
}

/** The mermaid operator for an edge's stroke and arrow. */
export function edgeOp(stroke: EdgeStroke, arrow: EdgeArrow): string {
  return EDGE_STYLES.find((s) => s.stroke === stroke && s.arrow === arrow)?.op ?? '-->';
}

interface Box { x: number; y: number; w: number; h: number; }

const overlaps = (a: Box, b: Box, pad = 16) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

function boxes(data: FlowData, sizeOf: SizeOf): Box[] {
  return data.nodes.map((n) => ({ x: n.x, y: n.y, ...sizeOf(n.id) }));
}

/**
 * Top-left for a new node beside `fromId` on `side`, slid along the other
 * axis (alternating either way) until it overlaps no existing node.
 */
export function placeBeside(
  data: FlowData,
  fromId: string,
  side: Side,
  sizeOf: SizeOf,
  size: Size = DEFAULT_SIZE,
): { x: number; y: number } {
  const from = data.nodes.find((n) => n.id === fromId);
  if (!from) {
    return { x: 0, y: 0 };
  }
  const f = sizeOf(fromId);
  const cx = from.x + f.w / 2;
  const cy = from.y + f.h / 2;
  const base =
    side === 'bottom' ? { x: cx - size.w / 2, y: from.y + f.h + NODE_GAP }
    : side === 'top' ? { x: cx - size.w / 2, y: from.y - NODE_GAP - size.h }
    : side === 'right' ? { x: from.x + f.w + NODE_GAP, y: cy - size.h / 2 }
    : { x: from.x - NODE_GAP - size.w, y: cy - size.h / 2 };
  const vertical = side === 'top' || side === 'bottom';
  const step = vertical ? size.w + 24 : size.h + 24;
  const taken = boxes(data, sizeOf);
  for (let i = 0; i < 40; i++) {
    // 0, +1, -1, +2, -2, …
    const k = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
    const at = vertical ? { x: base.x + k * step, y: base.y } : { x: base.x, y: base.y + k * step };
    if (!taken.some((b) => overlaps(b, { ...at, ...size }))) {
      return round(at);
    }
  }
  return round(base);
}

/** Top-left for a new node near `center` (flow coordinates) that overlaps nothing. */
export function freeSpotNear(
  data: FlowData,
  center: { x: number; y: number },
  sizeOf: SizeOf,
  size: Size = DEFAULT_SIZE,
): { x: number; y: number } {
  const taken = boxes(data, sizeOf);
  const origin = { x: center.x - size.w / 2, y: center.y - size.h / 2 };
  // Rings of candidate spots around the centre, nearest first.
  for (let ring = 0; ring < 12; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) {
          continue;
        }
        const at = { x: origin.x + dx * (size.w + 32), y: origin.y + dy * (size.h + 32) };
        if (!taken.some((b) => overlaps(b, { ...at, ...size }))) {
          return round(at);
        }
      }
    }
  }
  return round(origin);
}

const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });

const usedNodeIds = (data: FlowData) => new Set(data.nodes.map((n) => n.id));
const usedEdgeIds = (data: FlowData) => new Set(data.edges.map((e) => e.id));

export function addNode(
  data: FlowData,
  at: { x: number; y: number },
  shape: MermaidShape = 'square',
  label = '',
): { data: FlowData; id: string } {
  const id = nextId('n', usedNodeIds(data));
  return { data: { ...data, nodes: [...data.nodes, { id, shape, label, ...round(at) }] }, id };
}

/** Connect two nodes with a plain arrow. Self-loops and exact duplicates are ignored. */
export function connect(data: FlowData, source: string, target: string): FlowData {
  if (source === target || data.edges.some((e) => e.source === source && e.target === target)) {
    return data;
  }
  const id = nextId('e', usedEdgeIds(data));
  return { ...data, edges: [...data.edges, { id, source, target, stroke: 'normal', arrow: 'point' }] };
}

/** A new node at `at`, already connected from `fromId`. */
export function addConnected(
  data: FlowData,
  fromId: string,
  at: { x: number; y: number },
  shape: MermaidShape = 'square',
): { data: FlowData; id: string } {
  const added = addNode(data, at, shape);
  return { data: connect(added.data, fromId, added.id), id: added.id };
}

/** Remove nodes (and every edge touching them) and edges. */
export function remove(data: FlowData, nodeIds: Iterable<string>, edgeIds: Iterable<string> = []): FlowData {
  const deadNodes = new Set(nodeIds);
  const deadEdges = new Set(edgeIds);
  return {
    ...data,
    nodes: data.nodes.filter((n) => !deadNodes.has(n.id)),
    edges: data.edges.filter((e) => !deadEdges.has(e.id) && !deadNodes.has(e.source) && !deadNodes.has(e.target)),
  };
}

/** Copies of `ids` (offset a little) plus copies of the edges between them. */
export function duplicate(data: FlowData, ids: string[], offset = 24): { data: FlowData; ids: string[] } {
  const usedN = usedNodeIds(data);
  const usedE = usedEdgeIds(data);
  const map = new Map<string, string>();
  const nodes: FlowNode[] = [];
  for (const n of data.nodes) {
    if (!ids.includes(n.id)) {
      continue;
    }
    const id = nextId('n', usedN);
    usedN.add(id);
    map.set(n.id, id);
    nodes.push({ ...n, id, x: n.x + offset, y: n.y + offset });
  }
  const edges: FlowEdge[] = [];
  for (const e of data.edges) {
    const s = map.get(e.source);
    const t = map.get(e.target);
    if (s && t) {
      const id = nextId('e', usedE);
      usedE.add(id);
      edges.push({ ...e, id, source: s, target: t });
    }
  }
  return { data: { ...data, nodes: [...data.nodes, ...nodes], edges: [...data.edges, ...edges] }, ids: nodes.map((n) => n.id) };
}

export function updateNode(data: FlowData, id: string, patch: Partial<Omit<FlowNode, 'id'>>): FlowData {
  return { ...data, nodes: data.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

export function updateEdge(data: FlowData, id: string, patch: Partial<Omit<FlowEdge, 'id'>>): FlowData {
  return { ...data, edges: data.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

export function reverseEdge(data: FlowData, id: string): FlowData {
  return { ...data, edges: data.edges.map((e) => (e.id === id ? { ...e, source: e.target, target: e.source } : e)) };
}

/** Restyle an edge from its mermaid operator; unknown operators change nothing. */
export function setEdgeOp(data: FlowData, id: string, op: string): FlowData {
  const style = EDGE_STYLES.find((s) => s.op === op);
  return style ? updateEdge(data, id, { stroke: style.stroke, arrow: style.arrow }) : data;
}
