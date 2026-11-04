import * as assert from 'assert';
import { suite, test } from 'vitest';
import { FlowData } from '../../webview/format/mermaid';
import {
  addConnected,
  addNode,
  connect,
  DEFAULT_SIZE,
  duplicate,
  edgeOp,
  forwardSide,
  freeSpotNear,
  nextId,
  placeBeside,
  remove,
  reverseEdge,
  setEdgeOp,
} from '../../webview/editors/flow/model';

const sizeOf = () => DEFAULT_SIZE;
const flow = (): FlowData => ({
  direction: 'TD',
  nodes: [
    { id: 'n1', shape: 'square', label: 'A', x: 0, y: 0 },
    { id: 'n2', shape: 'diamond', label: 'B', x: 0, y: 120 },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2', stroke: 'normal', arrow: 'point' }],
});

const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < DEFAULT_SIZE.w && Math.abs(a.y - b.y) < DEFAULT_SIZE.h;

suite('flow model', () => {
  test('nextId fills the first free number', () => {
    assert.strictEqual(nextId('n', new Set(['n1', 'n3'])), 'n2');
    assert.strictEqual(nextId('e', new Set()), 'e1');
  });

  test('forwardSide follows the diagram direction', () => {
    assert.deepStrictEqual(
      (['TD', 'TB', 'BT', 'LR', 'RL'] as const).map(forwardSide),
      ['bottom', 'bottom', 'top', 'right', 'left'],
    );
  });

  test('edgeOp and setEdgeOp agree with the mermaid operators', () => {
    assert.strictEqual(edgeOp('dotted', 'point'), '-.->');
    assert.strictEqual(edgeOp('thick', 'open'), '===');
    const f = setEdgeOp(flow(), 'e1', '-.-');
    assert.deepStrictEqual([f.edges[0].stroke, f.edges[0].arrow], ['dotted', 'open']);
    assert.deepStrictEqual(setEdgeOp(flow(), 'e1', '<->'), flow());
  });

  test('addConnected adds a node and an arrow to it', () => {
    const { data, id } = addConnected(flow(), 'n2', { x: 0, y: 240 });
    assert.strictEqual(id, 'n3');
    assert.deepStrictEqual(data.edges.map((e) => `${e.source}>${e.target}`), ['n1>n2', 'n2>n3']);
    assert.strictEqual(data.nodes[2].label, '');
  });

  test('connect ignores self-loops and duplicates', () => {
    assert.strictEqual(connect(flow(), 'n1', 'n1').edges.length, 1);
    assert.strictEqual(connect(flow(), 'n1', 'n2').edges.length, 1);
    assert.strictEqual(connect(flow(), 'n2', 'n1').edges.length, 2);
  });

  test('remove drops the edges that touch removed nodes', () => {
    const f = remove(flow(), ['n2']);
    assert.deepStrictEqual(f.nodes.map((n) => n.id), ['n1']);
    assert.strictEqual(f.edges.length, 0);
  });

  test('duplicate copies the nodes and the edges between them only', () => {
    const { data, ids } = duplicate(flow(), ['n1', 'n2']);
    assert.deepStrictEqual(ids, ['n3', 'n4']);
    assert.strictEqual(data.edges.length, 2);
    assert.deepStrictEqual([data.edges[1].source, data.edges[1].target], ['n3', 'n4']);
    assert.strictEqual(duplicate(flow(), ['n1']).data.edges.length, 1);
  });

  test('reverseEdge swaps the ends', () => {
    const e = reverseEdge(flow(), 'e1').edges[0];
    assert.deepStrictEqual([e.source, e.target], ['n2', 'n1']);
  });

  test('placeBeside puts the node on the requested side without overlapping', () => {
    const f = flow();
    const below = placeBeside(f, 'n1', 'bottom', sizeOf);
    assert.ok(below.y > 0);
    for (const n of f.nodes) {
      assert.ok(!overlap(below, n), `overlaps ${n.id}`);
    }
    const right = placeBeside(f, 'n1', 'right', sizeOf);
    assert.ok(right.x >= DEFAULT_SIZE.w);
    assert.ok(placeBeside(f, 'n1', 'left', sizeOf).x < 0);
    assert.ok(placeBeside(f, 'n1', 'top', sizeOf).y < 0);
  });

  test('freeSpotNear avoids existing nodes', () => {
    const f = flow();
    const at = freeSpotNear(f, { x: DEFAULT_SIZE.w / 2, y: DEFAULT_SIZE.h / 2 }, sizeOf);
    for (const n of f.nodes) {
      assert.ok(!overlap(at, n));
    }
    assert.deepStrictEqual(addNode(f, at).data.nodes[2], { id: 'n3', shape: 'square', label: '', ...at });
  });
});
