import { FlowData, FlowDirection } from '../../format/mermaid';
import type { SizeOf } from './model';

// "Tidy": a small layered layout. Edges that close a cycle are set aside,
// every node is ranked by its longest path from a source, each rank is ordered
// by the average position of its parents, and ranks are stacked along the
// diagram direction with each rank centred on the same axis.

const RANK_GAP = 64;
const NODE_GAP = 40;

/** Edges that point back into the depth-first path (the ones closing cycles). */
function backEdges(data: FlowData): Set<string> {
  const out = new Map<string, { id: string; target: string }[]>();
  for (const n of data.nodes) {
    out.set(n.id, []);
  }
  for (const e of data.edges) {
    out.get(e.source)?.push({ id: e.id, target: e.target });
  }
  const indeg = new Map(data.nodes.map((n) => [n.id, 0]));
  for (const e of data.edges) {
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  // Start from sources so the "natural" flow wins, then sweep the rest.
  const roots = [
    ...data.nodes.filter((n) => indeg.get(n.id) === 0),
    ...data.nodes.filter((n) => indeg.get(n.id) !== 0),
  ].map((n) => n.id);

  const state = new Map<string, 'open' | 'done'>();
  const back = new Set<string>();
  for (const root of roots) {
    if (state.has(root)) {
      continue;
    }
    // Iterative DFS: a stack of [node, next child index].
    const stack: [string, number][] = [[root, 0]];
    state.set(root, 'open');
    while (stack.length) {
      const top = stack[stack.length - 1];
      const kids = out.get(top[0]) ?? [];
      if (top[1] >= kids.length) {
        state.set(top[0], 'done');
        stack.pop();
        continue;
      }
      const { id, target } = kids[top[1]++];
      const s = state.get(target);
      if (s === 'open') {
        back.add(id);
      } else if (!s) {
        state.set(target, 'open');
        stack.push([target, 0]);
      }
    }
  }
  return back;
}

/** Longest-path rank of every node over the acyclic edges. */
export function ranks(data: FlowData): Map<string, number> {
  const back = backEdges(data);
  const forward = data.edges.filter((e) => !back.has(e.id) && e.source !== e.target);
  const indeg = new Map(data.nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>(data.nodes.map((n) => [n.id, []]));
  for (const e of forward) {
    if (indeg.has(e.target) && out.has(e.source)) {
      indeg.set(e.target, indeg.get(e.target)! + 1);
      out.get(e.source)!.push(e.target);
    }
  }
  const rank = new Map(data.nodes.map((n) => [n.id, 0]));
  const queue = data.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const t of out.get(id)!) {
      rank.set(t, Math.max(rank.get(t)!, rank.get(id)! + 1));
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) {
        queue.push(t);
      }
    }
  }
  return rank;
}

export function tidy(data: FlowData, sizeOf: SizeOf, direction: FlowDirection = data.direction): FlowData {
  if (!data.nodes.length) {
    return { ...data, direction };
  }
  const rank = ranks(data);
  const layers: string[][] = [];
  for (const n of data.nodes) {
    const r = rank.get(n.id) ?? 0;
    layers[r] = [...(layers[r] ?? []), n.id];
  }

  // Order each layer by the mean index of its parents in the layer above.
  const parents = new Map<string, string[]>();
  for (const e of data.edges) {
    if ((rank.get(e.source) ?? 0) < (rank.get(e.target) ?? 0)) {
      parents.set(e.target, [...(parents.get(e.target) ?? []), e.source]);
    }
  }
  const index = new Map<string, number>();
  layers.forEach((layer, r) => {
    if (r > 0) {
      const mean = (id: string) => {
        const ps = (parents.get(id) ?? []).map((p) => index.get(p)).filter((v): v is number => v !== undefined);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Infinity;
      };
      const original = new Map(layer.map((id, i) => [id, i]));
      layer.sort((a, b) => mean(a) - mean(b) || original.get(a)! - original.get(b)!);
    }
    layer.forEach((id, i) => index.set(id, i));
  });

  const horizontal = direction === 'LR' || direction === 'RL';
  const reversed = direction === 'BT' || direction === 'RL';
  const main = (id: string) => (horizontal ? sizeOf(id).w : sizeOf(id).h);
  const cross = (id: string) => (horizontal ? sizeOf(id).h : sizeOf(id).w);

  const pos = new Map<string, { x: number; y: number }>();
  let offset = 0;
  for (const layer of layers) {
    if (!layer) {
      continue;
    }
    const thickness = Math.max(...layer.map(main));
    const span = layer.reduce((sum, id) => sum + cross(id), 0) + NODE_GAP * (layer.length - 1);
    let c = -span / 2;
    for (const id of layer) {
      // Centre every node on its rank's axis, whatever its own thickness.
      const m = offset + (thickness - main(id)) / 2;
      const along = reversed ? -m - main(id) : m;
      pos.set(id, horizontal ? { x: along, y: c } : { x: c, y: along });
      c += cross(id) + NODE_GAP;
    }
    offset += thickness + RANK_GAP;
  }
  return {
    ...data,
    direction,
    nodes: data.nodes.map((n) => {
      const p = pos.get(n.id)!;
      return { ...n, x: Math.round(p.x), y: Math.round(p.y) };
    }),
  };
}
