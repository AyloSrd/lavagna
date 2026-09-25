import * as assert from 'assert';
import { suite, test } from 'vitest';
import {
  EMPTY_FLOW,
  FlowData,
  EDGE_STYLES,
  MermaidShape,
  toMermaid,
  tryFromMermaid,
} from '../../webview/format/mermaid';

const parse = (src: string, prev?: FlowData) => tryFromMermaid(src, prev);
const shapes = (f: FlowData) => f.nodes.map((n) => [n.id, n.shape] as [string, MermaidShape]);
const edgeKeys = (f: FlowData) => f.edges.map((e) => `${e.source}->${e.target}${e.label ? `:${e.label}` : ''}`);

suite('tryFromMermaid — headers and basics', () => {
  test('accepts every flowchart direction and the graph keyword', () => {
    for (const dir of ['TD', 'TB', 'BT', 'RL', 'LR']) {
      const f = parse(`flowchart ${dir}\n  a --> b`);
      assert.ok(f, `direction ${dir} rejected`);
      assert.strictEqual(f.direction, dir);
    }
    assert.ok(parse('graph LR\n  a --> b'));
  });

  test('empty content is an editable empty flow', () => {
    assert.deepStrictEqual(parse(''), { ...EMPTY_FLOW });
    assert.deepStrictEqual(parse('  \n '), { ...EMPTY_FLOW });
  });

  test('skips blank lines and %% comments', () => {
    const f = parse('\n%% note\nflowchart TD\n\n  a --> b\n%% end\n');
    assert.ok(f);
    assert.strictEqual(f.nodes.length, 2);
  });

  test('bare id gets its own id as the label', () => {
    const f = parse('flowchart TD\n  alpha --> beta')!;
    assert.deepStrictEqual(f.nodes.map((n) => n.label), ['alpha', 'beta']);
  });
});

suite('tryFromMermaid — node shapes', () => {
  test('parses all classic shapes, including (( )) circles', () => {
    const src = [
      'flowchart TD',
      '  a["sq"]',
      '  b("round")',
      '  c(["stadium"])',
      '  d[["subroutine"]]',
      '  e[("db")]',
      '  f(("User"))',
      '  g((("dbl")))',
      '  h>"flag"]',
      '  i{"dec"}',
      '  j{{"hex"}}',
      '  k[/"lean"/]',
      '  l[\\"leanalt"\\]',
      '  m[/"trap"\\]',
      '  n[\\"invtrap"/]',
    ].join('\n');
    const f = parse(src);
    assert.ok(f, 'shape sweep rejected');
    assert.deepStrictEqual(shapes(f), [
      ['a', 'square'], ['b', 'round'], ['c', 'stadium'], ['d', 'subroutine'],
      ['e', 'cylinder'], ['f', 'circle'], ['g', 'doublecircle'], ['h', 'odd'],
      ['i', 'diamond'], ['j', 'hexagon'], ['k', 'lean_right'], ['l', 'lean_left'],
      ['m', 'trapezoid'], ['n', 'inv_trapezoid'],
    ]);
  });

  test('unquoted labels work', () => {
    const f = parse('flowchart TD\n  a[Plain text] --> b{Is it ok}')!;
    assert.deepStrictEqual(f.nodes.map((n) => n.label), ['Plain text', 'Is it ok']);
    assert.deepStrictEqual(shapes(f), [['a', 'square'], ['b', 'diamond']]);
  });

  test('quoted labels may contain brackets, parens and pipes', () => {
    const f = parse('flowchart TD\n  a["arr[0] = f(x) | y"] --> b')!;
    assert.strictEqual(f.nodes[0].label, 'arr[0] = f(x) | y');
  });

  test('a shape declared after an edge upgrades the node in place', () => {
    const f = parse('flowchart TD\n  a --> b\n  b{"Decide"}')!;
    assert.deepStrictEqual(shapes(f), [['a', 'square'], ['b', 'diamond']]);
    assert.strictEqual(f.nodes[1].label, 'Decide');
  });
});

suite('tryFromMermaid — edges', () => {
  test('chains produce one edge per hop', () => {
    const f = parse('flowchart TD\n  a --> b --> c')!;
    assert.deepStrictEqual(edgeKeys(f), ['a->b', 'b->c']);
    assert.strictEqual(f.nodes.length, 3);
  });

  test('& fans out on both sides', () => {
    const f = parse('flowchart TD\n  a & b --> c & d')!;
    assert.deepStrictEqual(edgeKeys(f), ['a->c', 'a->d', 'b->c', 'b->d']);
  });

  test('pipe labels, quoted and bare', () => {
    const f = parse('flowchart TD\n  a -->|yes| b\n  b -->|"no | maybe"| c')!;
    assert.deepStrictEqual(edgeKeys(f), ['a->b:yes', 'b->c:no | maybe']);
  });

  test('inline labels on normal, dotted and thick edges', () => {
    const f = parse('flowchart TD\n  a -- yes --> b\n  b -. later .-> c\n  c == bold ==> d')!;
    assert.deepStrictEqual(f.edges.map((e) => [e.stroke, e.arrow, e.label]), [
      ['normal', 'point', 'yes'],
      ['dotted', 'point', 'later'],
      ['thick', 'point', 'bold'],
    ]);
  });

  test('open (arrowless) links of each stroke', () => {
    const f = parse('flowchart TD\n  a --- b\n  b -.- c\n  c === d')!;
    assert.deepStrictEqual(f.edges.map((e) => [e.stroke, e.arrow]), [
      ['normal', 'open'],
      ['dotted', 'open'],
      ['thick', 'open'],
    ]);
  });

  test('longer dash runs are still normal arrows', () => {
    const f = parse('flowchart TD\n  a ----> b')!;
    assert.deepStrictEqual(f.edges.map((e) => [e.stroke, e.arrow]), [['normal', 'point']]);
  });

  test('inline shapes on both ends of an edge', () => {
    const f = parse('flowchart TD\n  a(("User")) --> b[["API"]]')!;
    assert.deepStrictEqual(shapes(f), [['a', 'circle'], ['b', 'subroutine']]);
  });

  test('self-loops and duplicates are preserved (they are valid mermaid)', () => {
    const f = parse('flowchart TD\n  a --> a\n  a --> b\n  a --> b')!;
    assert.strictEqual(f.edges.length, 3);
  });
});

suite('tryFromMermaid — rejected (read-only fallback)', () => {
  const rejected: [string, string][] = [
    ['sequence diagram', 'sequenceDiagram\n  A->>B: hi'],
    ['pie chart', 'pie\n  "a": 1'],
    ['class diagram', 'classDiagram\n  A <|-- B'],
    ['subgraph', 'flowchart TD\n  subgraph one\n  a --> b\n  end'],
    ['classDef', 'flowchart TD\n  a --> b\n  classDef red fill:#f00'],
    ['class statement', 'flowchart TD\n  a --> b\n  class a red'],
    ['style', 'flowchart TD\n  a["x"]\n  style a fill:#f9f'],
    ['linkStyle', 'flowchart TD\n  a --> b\n  linkStyle 0 stroke:#f00'],
    ['click handler', 'flowchart TD\n  a --> b\n  click a callback'],
    [':::class shorthand', 'flowchart TD\n  a:::red --> b'],
    ['content before the header', 'a --> b\nflowchart TD'],
    ['no header at all', 'a --> b'],
    ['garbage line', 'flowchart TD\n  a --> b\n  ???'],
  ];
  for (const [name, src] of rejected) {
    test(`rejects ${name}`, () => {
      assert.strictEqual(parse(src), null, `${name} should have been rejected`);
    });
  }
});

suite('tryFromMermaid — positions', () => {
  test('keeps positions for surviving ids', () => {
    const prev = parse('flowchart TD\n  a["A"] --> b["B"]')!;
    prev.nodes[0].x = 999;
    prev.nodes[0].y = 111;
    const next = parse('flowchart TD\n  a["A renamed"] --> b["B"]', prev)!;
    const a = next.nodes.find((n) => n.id === 'a')!;
    assert.strictEqual(a.x, 999);
    assert.strictEqual(a.y, 111);
    assert.strictEqual(a.label, 'A renamed');
  });

  test('fresh nodes get a layered layout, not a flat grid', () => {
    const f = parse('flowchart TD\n  a --> b\n  b --> c\n  a --> d')!;
    const by = new Map(f.nodes.map((n) => [n.id, n]));
    assert.ok(by.get('b')!.y > by.get('a')!.y);
    assert.ok(by.get('c')!.y > by.get('b')!.y);
    assert.strictEqual(by.get('b')!.y, by.get('d')!.y);
    assert.notStrictEqual(by.get('b')!.x, by.get('d')!.x);
  });

  test('LR lays out horizontally', () => {
    const f = parse('flowchart LR\n  a --> b')!;
    const by = new Map(f.nodes.map((n) => [n.id, n]));
    assert.ok(by.get('b')!.x > by.get('a')!.x);
    assert.strictEqual(by.get('a')!.y, by.get('b')!.y);
  });

  test('cycles lay out without hanging', () => {
    const f = parse('flowchart TD\n  a --> b\n  b --> c\n  c --> a')!;
    assert.strictEqual(f.nodes.length, 3);
    assert.ok(f.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  });
});

suite('EDGE_STYLES (the edge-style dropdown)', () => {
  test('every offered operator parses back to the stroke/arrow it claims', () => {
    for (const s of EDGE_STYLES) {
      const f = tryFromMermaid(`flowchart TD\n  a ${s.op} b`);
      assert.ok(f, `${s.op} was rejected by the parser`);
      assert.deepStrictEqual(
        [f.edges[0].stroke, f.edges[0].arrow],
        [s.stroke, s.arrow],
        `${s.op} parsed as the wrong style`,
      );
    }
  });

  test('every offered style survives a write→read cycle', () => {
    for (const s of EDGE_STYLES) {
      const flow: FlowData = {
        direction: 'TD',
        nodes: [
          { id: 'a', shape: 'square', label: 'a', x: 0, y: 0 },
          { id: 'b', shape: 'square', label: 'b', x: 0, y: 0 },
        ],
        edges: [{ id: 'e1', source: 'a', target: 'b', stroke: s.stroke, arrow: s.arrow }],
      };
      const back = tryFromMermaid(toMermaid(flow), flow);
      assert.ok(back, `${s.op} round-trip rejected`);
      assert.deepStrictEqual([back.edges[0].stroke, back.edges[0].arrow], [s.stroke, s.arrow]);
    }
  });

  test('the six styles are distinct', () => {
    const keys = EDGE_STYLES.map((s) => `${s.stroke}/${s.arrow}`);
    assert.strictEqual(new Set(keys).size, EDGE_STYLES.length);
  });
});

suite('round-trip invariant: everything toMermaid writes, tryFromMermaid reads', () => {
  test('all shapes survive a write→read cycle', () => {
    const src = [
      'flowchart LR',
      '  a(("User"))', '  b[["API"]]', '  c[("DB")]', '  d{{"Check"}}',
      '  e[/"In"/]', '  f>"Flag"]', '  g((("Done")))',
      '  a --> b -.-> c', '  b == hot ==> d', '  d --- e', '  e -->|"go"| f --> g',
    ].join('\n');
    const first = parse(src);
    assert.ok(first, 'source rejected');
    const written = toMermaid(first);
    const second = parse(written, first);
    assert.ok(second, `strict gate rejected our own output:\n${written}`);
    assert.deepStrictEqual(shapes(second), shapes(first));
    assert.deepStrictEqual(edgeKeys(second), edgeKeys(first));
    assert.deepStrictEqual(
      second.edges.map((e) => [e.stroke, e.arrow]),
      first.edges.map((e) => [e.stroke, e.arrow]),
    );
  });

  test('a second write is byte-stable (no normalization creep)', () => {
    const once = toMermaid(parse('flowchart LR\n  a["Start"] --> b{"Choice?"}\n  b -->|"yes"| c(["Done"])')!);
    const twice = toMermaid(parse(once)!);
    assert.strictEqual(twice, once);
  });

  test('awkward label characters survive', () => {
    const flow: FlowData = {
      direction: 'TD',
      nodes: [
        { id: 'a', shape: 'square', label: 'array[0] = f(x)', x: 10, y: 10 },
        { id: 'b', shape: 'diamond', label: 'a | b {maybe?}', x: 20, y: 20 },
        { id: 'c', shape: 'stadium', label: 'say "done")', x: 30, y: 30 },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b', label: 'weird | ] label', stroke: 'normal', arrow: 'point' }],
    };
    const back = parse(toMermaid(flow), flow);
    assert.ok(back, 'own output rejected');
    assert.deepStrictEqual(back.nodes.map((n) => n.label), flow.nodes.map((n) => n.label));
    assert.strictEqual(back.edges[0].label, 'weird | ] label');
    assert.strictEqual(back.nodes[0].x, 10);
  });

  test('chains and & fan-outs round-trip as explicit edges', () => {
    const first = parse('flowchart TD\n  a & b --> c --> d')!;
    const second = parse(toMermaid(first), first)!;
    assert.deepStrictEqual(edgeKeys(second), edgeKeys(first));
  });
});
