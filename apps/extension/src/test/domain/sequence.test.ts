import * as assert from 'assert';
import { suite, test } from 'vitest';
import {
  MessageStep,
  NoteStep,
  mermaidKindOf,
  parseSequence,
  toSequence,
} from '../../webview/format/sequence';

const messages = (src: string) =>
  parseSequence(src)!
    .steps.filter((s): s is MessageStep => s.type === 'message')
    .map((s) => `${s.from}${s.arrow}${s.to}:${s.text}`);

suite('mermaidKindOf — dispatch between diagram editors', () => {
  test('recognises flowcharts and sequence diagrams', () => {
    assert.strictEqual(mermaidKindOf('flowchart TD\n a --> b'), 'flowchart');
    assert.strictEqual(mermaidKindOf('graph LR\n a --> b'), 'flowchart');
    assert.strictEqual(mermaidKindOf('sequenceDiagram\n A->>B: x'), 'sequence');
    assert.strictEqual(mermaidKindOf('%% note\n\nsequenceDiagram\n A->>B: x'), 'sequence');
  });

  test('an empty fence starts as a flowchart; other types are unknown', () => {
    assert.strictEqual(mermaidKindOf(''), 'flowchart');
    assert.strictEqual(mermaidKindOf('classDiagram\n A <|-- B'), 'unknown');
    assert.strictEqual(mermaidKindOf('pie\n "a": 1'), 'unknown');
  });
});

suite('parseSequence — a realistic diagram', () => {
  const src = [
    'sequenceDiagram',
    '  participant U as User',
    '  participant F as web/frontend',
    '  participant L as web/library-api',
    '  participant T as search-index',
    '',
    '  U->>F: Click Borrow book',
    '  F->>L: POST create_loan_request',
    '  L->>L: Resolve member_id and copy_id',
    '  L->>T: POST /v1/catalog/holds',
    '  T-->>L: hold_id / index_status',
    '  L-->>F: success or detailed error',
    '  F-->>U: toast; console.error on failure',
  ].join('\n');

  test('participants keep their ids and aliases, slashes included', () => {
    const d = parseSequence(src)!;
    assert.deepStrictEqual(
      d.participants.map((p) => [p.id, p.label]),
      [['U', 'User'], ['F', 'web/frontend'], ['L', 'web/library-api'], ['T', 'search-index']],
    );
  });

  test('solid and dotted arrows are distinguished', () => {
    const d = parseSequence(src)!;
    const kinds = d.steps.filter((s): s is MessageStep => s.type === 'message').map((s) => s.arrow);
    assert.deepStrictEqual(kinds, [
      'solidArrow', 'solidArrow', 'solidArrow', 'solidArrow',
      'dottedArrow', 'dottedArrow', 'dottedArrow',
    ]);
  });

  test('a self-message is preserved', () => {
    const d = parseSequence(src)!;
    assert.ok(d.steps.some((s) => s.type === 'message' && s.from === 'L' && s.to === 'L'));
  });

  test('round-trips and is byte-stable on a second pass', () => {
    const once = toSequence(parseSequence(src)!);
    const twice = toSequence(parseSequence(once)!);
    assert.strictEqual(twice, once);
  });
});

suite('parseSequence — arrow kinds', () => {
  test('all eight arrow tokens parse distinctly', () => {
    const src = [
      'sequenceDiagram',
      '  A->B: solid',
      '  A-->B: dotted',
      '  A->>B: solidArrow',
      '  A-->>B: dottedArrow',
      '  A-xB: solidCross',
      '  A--xB: dottedCross',
      '  A-)B: solidOpen',
      '  A--)B: dottedOpen',
    ].join('\n');
    const d = parseSequence(src)!;
    assert.deepStrictEqual(
      d.steps.filter((s): s is MessageStep => s.type === 'message').map((s) => s.arrow),
      ['solid', 'dotted', 'solidArrow', 'dottedArrow', 'solidCross', 'dottedCross', 'solidOpen', 'dottedOpen'],
    );
  });

  test('every arrow kind survives a write→read cycle', () => {
    const src = [
      'sequenceDiagram',
      '  A->B: a', '  A-->B: b', '  A->>B: c', '  A-->>B: d',
      '  A-xB: e', '  A--xB: f', '  A-)B: g', '  A--)B: h',
    ].join('\n');
    const first = parseSequence(src)!;
    const back = parseSequence(toSequence(first))!;
    assert.deepStrictEqual(
      back.steps.filter((s): s is MessageStep => s.type === 'message').map((s) => s.arrow),
      first.steps.filter((s): s is MessageStep => s.type === 'message').map((s) => s.arrow),
    );
  });
});

suite('parseSequence — notes, blocks, activation', () => {
  test('note placements and multi-actor notes', () => {
    const d = parseSequence(
      'sequenceDiagram\n  A->>B: x\n  Note over A,B: both\n  Note right of B: just B\n  Note left of A: just A',
    )!;
    const notes = d.steps.filter((s): s is NoteStep => s.type === 'note');
    assert.deepStrictEqual(notes.map((n) => [n.placement, n.actors.join(','), n.text]), [
      ['over', 'A,B', 'both'],
      ['right of', 'B', 'just B'],
      ['left of', 'A', 'just A'],
    ]);
  });

  test('loop / alt / else / opt nest and re-indent correctly', () => {
    const src = [
      'sequenceDiagram',
      '  A->>B: start',
      '  loop every minute',
      '    B->>A: poll',
      '  end',
      '  alt ok',
      '    A->>B: yes',
      '  else failed',
      '    A->>B: no',
      '  end',
    ].join('\n');
    const first = parseSequence(src);
    assert.ok(first, 'blocks rejected');
    const written = toSequence(first);
    assert.ok(written.includes('  loop every minute'));
    assert.ok(written.includes('    B->>A: poll'), 'body should indent inside the block');
    assert.strictEqual(toSequence(parseSequence(written)!), written, 'stable');
  });

  test('activation suffixes and statements are preserved', () => {
    const src = 'sequenceDiagram\n  A->>+B: call\n  B-->>-A: reply\n  activate A\n  deactivate A';
    const first = parseSequence(src)!;
    const msgs = first.steps.filter((s): s is MessageStep => s.type === 'message');
    assert.deepStrictEqual(msgs.map((m) => m.activate), ['start', 'end']);
    assert.strictEqual(toSequence(parseSequence(toSequence(first))!), toSequence(first));
  });

  test('autonumber is kept', () => {
    const d = parseSequence('sequenceDiagram\n  autonumber\n  A->>B: x')!;
    assert.strictEqual(d.autonumber, true);
    assert.ok(toSequence(d).includes('autonumber'));
  });

  test('undeclared participants are inferred from messages, in first-use order', () => {
    const d = parseSequence('sequenceDiagram\n  Z->>Y: x\n  Y->>X: y')!;
    assert.deepStrictEqual(d.participants.map((p) => p.id), ['Z', 'Y', 'X']);
  });
});

suite('parseSequence — refused (read-only fallback)', () => {
  const rejected: [string, string][] = [
    ['a flowchart', 'flowchart TD\n  a --> b'],
    ['no header', 'A->>B: x'],
    ['content before the header', 'A->>B: x\nsequenceDiagram'],
    ['box grouping', 'sequenceDiagram\n  box Blue Team\n  participant A\n  end'],
    ['create/destroy', 'sequenceDiagram\n  create participant A\n  A->>B: x'],
    ['links', 'sequenceDiagram\n  A->>B: x\n  link A: Dashboard @ https://x'],
    ['rect colouring', 'sequenceDiagram\n  rect rgb(0,0,255)\n  A->>B: x\n  end'],
    ['a message with no text', 'sequenceDiagram\n  A->>B'],
    ['an unrecognised line', 'sequenceDiagram\n  A->>B: x\n  ???'],
  ];
  for (const [name, src] of rejected) {
    test(`rejects ${name}`, () => {
      assert.strictEqual(parseSequence(src), null, `${name} should be refused`);
    });
  }

  test('an oversized fence is refused quickly', () => {
    const src = 'sequenceDiagram\n' + Array.from({ length: 40000 }, (_, i) => `  A->>B: m${i}`).join('\n');
    const started = Date.now();
    assert.strictEqual(parseSequence(src), null);
    assert.ok(Date.now() - started < 1000);
  });
});

suite('toSequence — output re-parses', () => {
  test('empty content yields an editable empty diagram', () => {
    const d = parseSequence('')!;
    assert.deepStrictEqual(d.participants, []);
    assert.deepStrictEqual(d.steps, []);
  });

  test('labels containing colons and slashes survive', () => {
    const src = 'sequenceDiagram\n  A->>B: POST /a/b: done\n  participant A as svc/one';
    const first = parseSequence(src)!;
    assert.deepStrictEqual(messages(toSequence(first)), messages(src));
  });
});
