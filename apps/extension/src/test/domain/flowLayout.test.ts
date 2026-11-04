import * as assert from 'assert';
import { suite, test } from 'vitest';
import { FlowData, FlowEdge } from '../../webview/format/mermaid';
import { ranks, tidy } from '../../webview/editors/flow/layout';

const size = { w: 100, h: 40 };
const sizeOf = () => size;

function graph(edges: [string, string][], direction: FlowData['direction'] = 'TD'): FlowData {
  const ids = [...new Set(edges.flat())];
  return {
    direction,
    nodes: ids.map((id) => ({ id, shape: 'square', label: id, x: 0, y: 0 })),
    edges: edges.map(([source, target], i): FlowEdge => ({ id: `e${i}`, source, target, stroke: 'normal', arrow: 'point' })),
  };
}
const at = (f: FlowData, id: string) => f.nodes.find((n) => n.id === id)!;

suite('flow layout', () => {
  test('ranks follow the longest path from a source', () => {
    const r = ranks(graph([['a', 'b'], ['b', 'c'], ['a', 'c']]));
    assert.deepStrictEqual([r.get('a'), r.get('b'), r.get('c')], [0, 1, 2]);
  });

  test('a back edge does not push its target down', () => {
    const r = ranks(graph([['start', 'read'], ['read', 'ok'], ['ok', 'ask'], ['ask', 'read']]));
    assert.deepStrictEqual(['start', 'read', 'ok', 'ask'].map((id) => r.get(id)), [0, 1, 2, 3]);
  });

  test('top-down stacks ranks downwards and keeps siblings apart', () => {
    const f = tidy(graph([['a', 'b'], ['a', 'c']]), sizeOf);
    assert.ok(at(f, 'b').y > at(f, 'a').y);
    assert.strictEqual(at(f, 'b').y, at(f, 'c').y);
    assert.ok(Math.abs(at(f, 'b').x - at(f, 'c').x) >= size.w);
    // The single parent sits centred over its two children.
    assert.strictEqual(at(f, 'a').x + size.w / 2, (at(f, 'b').x + at(f, 'c').x + size.w) / 2);
  });

  test('every direction lays ranks along its own axis', () => {
    const chain = graph([['a', 'b']]);
    const d = (dir: FlowData['direction']) => {
      const f = tidy(chain, sizeOf, dir);
      return { dx: at(f, 'b').x - at(f, 'a').x, dy: at(f, 'b').y - at(f, 'a').y, dir: f.direction };
    };
    assert.ok(d('TD').dy > 0 && d('TD').dx === 0);
    assert.ok(d('BT').dy < 0 && d('BT').dx === 0);
    assert.ok(d('LR').dx > 0 && d('LR').dy === 0);
    assert.ok(d('RL').dx < 0 && d('RL').dy === 0);
    assert.strictEqual(d('LR').dir, 'LR');
  });

  test('handles empty graphs, self-loops and lone nodes', () => {
    assert.deepStrictEqual(tidy({ direction: 'TD', nodes: [], edges: [] }, sizeOf).nodes, []);
    const f = tidy(graph([['a', 'a']]), sizeOf);
    assert.deepStrictEqual([at(f, 'a').x, at(f, 'a').y], [-size.w / 2, 0]);
  });

  test('keeps labels, shapes and edges untouched', () => {
    const g = graph([['a', 'b']]);
    const f = tidy(g, sizeOf);
    assert.deepStrictEqual(f.edges, g.edges);
    assert.deepStrictEqual(f.nodes.map((n) => [n.id, n.label, n.shape]), g.nodes.map((n) => [n.id, n.label, n.shape]));
  });
});
