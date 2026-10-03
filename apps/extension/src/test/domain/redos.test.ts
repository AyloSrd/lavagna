import * as assert from 'assert';
import { suite, test } from 'vitest';
import { imageTarget, parseBlocks } from '../../domain/blocks/parseBlocks';
import { toMermaid } from '../../webview/format/mermaid';
import { parseSequence } from '../../webview/format/sequence';

// Regression tests for catastrophic regex backtracking.
//
// Every one of these inputs used to take seconds (some tens of seconds) in the
// extension host or the webview; they now take about a millisecond. The
// threshold is two orders of magnitude above that and three below the old cost,
// so it is not machine-sensitive. The "same results" tables were produced by
// running the ORIGINAL implementations, not by hand.

const BUDGET_MS = 100;

function within<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  assert.ok(ms < BUDGET_MS, `${label} took ${ms.toFixed(0)} ms (budget ${BUDGET_MS} ms)`);
  return result;
}

const N = 100_000;

// The pre-fix pattern, kept only to prove the hand-written matcher agrees with
// it. Never run on long input — that is the bug.
const ORIGINAL_IMAGE_LINE = /^ {0,3}!\[[^\]]*\]\([ \t]*([^)\s]*)(?:[ \t]+"[^"]*")?[ \t]*\)[ \t]*$/;
const originalTarget = (line: string): string | null => ORIGINAL_IMAGE_LINE.exec(line)?.[1] ?? null;

const IMAGE_LINES: [string, string | null][] = [
  ["![alt](img.png)", "img.png"],
  ["![alt](img.png \"A title\")", "img.png"],
  ["![alt](img.png)  ", "img.png"],
  ["![alt](  img.png  )", "img.png"],
  ["![alt](\timg.png\t\"t\"\t)", "img.png"],
  [" ![alt](img.png)", "img.png"],
  ["  ![alt](img.png)", "img.png"],
  ["   ![alt](img.png)", "img.png"],
  ["    ![alt](img.png)", null],
  ["\t![alt](img.png)", null],
  ["![canvas]()", ""],
  ["![canvas]( )", ""],
  ["![]()", ""],
  ["![](a.png)", "a.png"],
  ["![a b c](docs/shots/a b.png)", null],
  ["![alt](a/b/c.png)", "a/b/c.png"],
  ["![alt](https://example.com/x.png)", "https://example.com/x.png"],
  ["![alt](data:image/png;base64,AAAA)", "data:image/png;base64,AAAA"],
  ["![alt](x.png \"a b\")", "x.png"],
  ["![alt]( \"a b\")", ""],
  ["![alt](\"a b\")", null],
  ["![alt](x\"y\")", "x\"y\""],
  ["![alt](x.png) trailing", null],
  ["![alt](x.png", null],
  ["![alt]x.png)", null],
  ["!alt](x.png)", null],
  ["![a]]](x.png)", null],
  ["![a](x.png)(y.png)", null],
  ["![a](x(y).png)", null],
  ["![a](x.png \"t\") ", "x.png"],
  ["![a](x.png \"t\" )", "x.png"],
  ["![a](x.png \"\")", "x.png"],
  ["![a](x.png \"t)", null],
  ["![a](x.png\"t\")", "x.png\"t\""],
  ["![a](x.png  \"t\")", "x.png"],
  ["![a](x.png\u00a0)", null],
  ["![a](\u00a0x.png)", null],
];

function* allStrings(alphabet: string[], maxLength: number): Generator<string> {
  let layer = [''];
  yield '';
  for (let length = 1; length <= maxLength; length++) {
    const next: string[] = [];
    for (const prefix of layer) {
      for (const ch of alphabet) {
        next.push(prefix + ch);
        yield prefix + ch;
      }
    }
    layer = next;
  }
}

suite('image lines: same results as the original regex', () => {
  test('typical lines (expected values come from the original regex)', () => {
    for (const [line, expected] of IMAGE_LINES) {
      assert.strictEqual(imageTarget(line), expected, JSON.stringify(line));
      assert.strictEqual(originalTarget(line), expected, `reference: ${JSON.stringify(line)}`);
    }
  });

  test('parseBlocks yields an image block exactly for the local ones', () => {
    for (const [line, expected] of IMAGE_LINES) {
      const isBlock = expected !== null && !/^(https?:|data:|vscode-)/i.test(expected);
      const blocks = parseBlocks(line);
      assert.strictEqual(blocks.length, isBlock ? 1 : 0, JSON.stringify(line));
      if (isBlock) {
        assert.strictEqual(blocks[0].kind, 'image');
        assert.strictEqual(blocks[0].content, line);
      }
    }
  });

  test('exhaustive over short targets: whitespace, quotes, parens, NBSP', () => {
    const alphabet = [' ', '\t', '"', ')', '(', 'x', '\u00a0'];
    for (const tail of allStrings(alphabet, 6)) {
      const line = '![a](' + tail;
      assert.strictEqual(imageTarget(line), originalTarget(line), JSON.stringify(line));
    }
  });

  test('exhaustive over indentation, alt text and tails', () => {
    for (const pre of ['', ' ', '   ', '    ', '\t']) {
      for (const alt of ['', 'a', 'a]b', ']', '[', '![']) {
        for (const tail of [']()', '](x)', '](x "t")', ']( x )', ']( "a b")', ']("a b")', '](x"y")', '](a b)', '] (x)', '](x) ', ']((x))']) {
          const line = pre + '![' + alt + tail;
          assert.strictEqual(imageTarget(line), originalTarget(line), JSON.stringify(line));
        }
      }
    }
  });

  test('a table ends at an image line, local or remote', () => {
    for (const image of ['![c](a|b.png)', '![c](https://e.com/a|b.png)']) {
      const blocks = parseBlocks(['| a | b |', '|---|---|', '| 1 | 2 |', image].join('\n'));
      const table = blocks.find((b) => b.kind === 'table');
      assert.strictEqual(table?.endLine, 2, image);
    }
  });

  test('lines longer than the cap are never image lines', () => {
    const long = '![a](' + 'x'.repeat(3000) + ')';
    assert.strictEqual(imageTarget(long), null);
    assert.strictEqual(parseBlocks(long).length, 0);
    assert.strictEqual(imageTarget('![a](' + 'x'.repeat(1000) + ')'), 'x'.repeat(1000));
  });
});

suite('image lines: adversarial input is fast', () => {
  const sp = ' '.repeat(N);
  const adversarial: [string, string][] = [
    ['spaces then quote', '![a](' + sp + 'x"'],
    ['tabs then quote', '![a](' + '\t'.repeat(N) + 'x"'],
    ['mixed blanks', '![a](' + ' \t'.repeat(N / 2) + 'x"'],
    ['unclosed paren', '![a](' + sp],
    ['spaces after target', '![a](x' + sp + '"t'],
    ['many quotes', '![a](x "' + '"'.repeat(N)],
    ['quote, spaces, quote', '![a]( "' + sp + '" x'],
    ['unclosed alt', '![' + 'a'.repeat(N)],
    ['bracket soup', '![' + '[]('.repeat(N / 3)],
    ['trailing junk', '![a](x)' + sp + 'y'],
    ['leading spaces', sp + '![a](x)'],
  ];
  for (const [name, line] of adversarial) {
    test(name, () => {
      within(`imageTarget(${name})`, () => imageTarget(line));
      within(`parseBlocks(${name})`, () => parseBlocks(line));
      // Inside a table, where the table loop tests the next line too.
      within(`table + ${name}`, () => parseBlocks('| a |\n|---|\n' + line));
    });
  }

  test('a document of many long image-ish lines', () => {
    const doc = Array.from({ length: 2000 }, () => '![a](' + ' '.repeat(2000) + 'x"').join('\n');
    within('2000 lines of 2 KB', () => parseBlocks(doc));
  });
});

suite('fence openers: adversarial input is fast', () => {
  test('a long fence run followed by a character `.` will not cross', () => {
    for (const tail of ['\r', '\u2028', '\u2029']) {
      for (const fence of ['`', '~']) {
        const line = fence.repeat(N) + tail + 'x';
        const blocks = within('fence run', () => parseBlocks(line));
        assert.strictEqual(blocks.length, 0, 'not a fence: the info string holds a line terminator');
      }
    }
  });

  test('ordinary fences still open', () => {
    assert.strictEqual(parseBlocks('```tree\nx\n```')[0].kind, 'tree');
    assert.strictEqual(parseBlocks('~~~~ mermaid\nx\n~~~~')[0].kind, 'mermaid');
    assert.strictEqual(parseBlocks('`````\nx\n`````')[0].closed, true);
  });
});

const SEQUENCE_LINES: [string, unknown][] = [
  ["Note over A: hello", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "note", "placement": "over", "actors": ["A"], "text": "hello"}]}],
  ["note over A,B: both", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}, {"id": "B", "label": "B", "actor": false}], "steps": [{"type": "note", "placement": "over", "actors": ["A", "B"], "text": "both"}]}],
  ["NOTE  OVER   A , B  :   spaced   ", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}, {"id": "B", "label": "B", "actor": false}], "steps": [{"type": "note", "placement": "over", "actors": ["A", "B"], "text": "spaced"}]}],
  ["Note left of A: left", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "note", "placement": "left of", "actors": ["A"], "text": "left"}]}],
  ["note right of  Bob_1 :x", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}, {"id": "Bob_1", "label": "Bob_1", "actor": false}], "steps": [{"type": "note", "placement": "right of", "actors": ["Bob_1"], "text": "x"}]}],
  ["note over A:", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "note", "placement": "over", "actors": ["A"], "text": ""}]}],
  ["note over A", null],
  ["note over : x", null],
  ["note over A!: x", null],
  ["note over A: x\ry", null],
  ["note over A,: x", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "note", "placement": "over", "actors": ["A"], "text": "x"}]}],
  ["note over ,: x", null],
  ["note over A B: x", null],
  ["note over A :\r x", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "note", "placement": "over", "actors": ["A"], "text": "x"}]}],
  ["title Hello", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [], "title": "Hello"}],
  ["title: Hello", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [], "title": "Hello"}],
  ["Title : Hello World", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [], "title": "Hello World"}],
  ["title", null],
  ["title :", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [], "title": ":"}],
  ["title:", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [], "title": ":"}],
  ["title ::x", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [], "title": ":x"}],
  ["title\r x", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [], "title": "x"}],
  ["titlefoo", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [], "title": "foo"}],
  ["participant A", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": []}],
  ["participant A as Alice", {"autonumber": false, "participants": [{"id": "A", "label": "Alice", "actor": false}], "steps": []}],
  ["actor B  AS   Bob Smith ", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}, {"id": "B", "label": "Bob Smith", "actor": true}], "steps": []}],
  ["participant A as", null],
  ["participant A as x\ry", null],
  ["participant A  as \r x", {"autonumber": false, "participants": [{"id": "A", "label": "x", "actor": false}], "steps": []}],
  ["participant A b", null],
  ["loop every minute", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "block", "keyword": "loop", "label": "every minute"}]}],
  ["loop", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "block", "keyword": "loop", "label": ""}]}],
  ["alt  yes", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "block", "keyword": "alt", "label": "yes"}]}],
  ["else", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "block", "keyword": "else", "label": ""}]}],
  ["opt", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "block", "keyword": "opt", "label": ""}]}],
  ["option", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "block", "keyword": "option", "label": ""}]}],
  ["optional", null],
  ["par  a & b", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "block", "keyword": "par", "label": "a & b"}]}],
  ["and", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "block", "keyword": "and", "label": ""}]}],
  ["critical c", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "block", "keyword": "critical", "label": "c"}]}],
  ["break b", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "block", "keyword": "break", "label": "b"}]}],
  ["loop x\ry", null],
  ["loop \r x", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "block", "keyword": "loop", "label": "x"}]}],
  ["end", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "end"}]}],
  ["activate A", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}], "steps": [{"type": "activate", "actor": "A"}]}],
  ["deactivate B", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}, {"id": "B", "label": "B", "actor": false}], "steps": [{"type": "deactivate", "actor": "B"}]}],
  ["A->>B: hi", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}, {"id": "B", "label": "B", "actor": false}], "steps": [{"type": "message", "from": "A", "to": "B", "arrow": "solidArrow", "text": "hi"}]}],
  ["A-->>B: reply", {"autonumber": false, "participants": [{"id": "A", "label": "A", "actor": false}, {"id": "B", "label": "B", "actor": false}], "steps": [{"type": "message", "from": "A", "to": "B", "arrow": "dottedArrow", "text": "reply"}]}],
];

suite('sequence parser: same results as before the regex rewrite', () => {
  test('notes, titles, participants and blocks (expected values come from the original)', () => {
    for (const [line, expected] of SEQUENCE_LINES) {
      const doc = 'sequenceDiagram\nparticipant A\n' + line;
      // JSON round trip: the table was captured as JSON, which drops `activate: undefined`.
      assert.deepStrictEqual(JSON.parse(JSON.stringify(parseSequence(doc))), expected, JSON.stringify(line));
    }
  });
});

suite('sequence parser: adversarial input is fast', () => {
  const cases: [string, string][] = [
    ['note + spaces + junk', 'note over A' + ' '.repeat(90_000) + '!'],
    ['note + tabs + junk', 'note over A' + '\t'.repeat(90_000) + '!'],
    ['note + spaces + colon + CR', 'note over A:' + ' '.repeat(90_000) + 'x\ry'],
    ['note + ragged words', 'note over A' + ' a'.repeat(45_000) + '!'],
    ['note + commas', 'note over A' + ', '.repeat(45_000) + '!'],
    ['participant alias + CR', 'participant A as' + ' '.repeat(90_000) + 'x\ry'],
    ['participant gap + CR', 'participant A' + ' '.repeat(45_000) + 'as' + ' '.repeat(45_000) + 'x\ry'],
    ['title + CR', 'title' + ' '.repeat(90_000) + 'x\ry'],
    ['title colon + CR', 'title :' + ' '.repeat(90_000) + 'x\ry'],
    ['block + CR', 'loop' + ' '.repeat(90_000) + 'x\ry'],
    ['block + U+2028', 'alt' + ' '.repeat(90_000) + 'x\u2028y'],
  ];
  for (const [name, line] of cases) {
    test(name, () => {
      within(name, () => parseSequence('sequenceDiagram\n' + line));
    });
  }
});

const ESCAPE_LABELS: [string, string][] = [
  ["plain", "flowchart TD\n  a[\"plain\"]"],
  ["  lead and trail  ", "flowchart TD\n  a[\"lead and trail\"]"],
  ["a   b", "flowchart TD\n  a[\"a   b\"]"],
  ["a \n b", "flowchart TD\n  a[\"a b\"]"],
  ["a\n\n\nb", "flowchart TD\n  a[\"a b\"]"],
  ["a\t\n\tb", "flowchart TD\n  a[\"a b\"]"],
  ["q\"uote", "flowchart TD\n  a[\"q&quot;uote\"]"],
  ["x  \n", "flowchart TD\n  a[\"x\"]"],
  [" \n x", "flowchart TD\n  a[\"x\"]"],
  ["multi\r\nline", "flowchart TD\n  a[\"multi line\"]"],
];

suite('flowchart serializer: label whitespace', () => {
  test('same output as before the rewrite', () => {
    for (const [label, expected] of ESCAPE_LABELS) {
      const out = toMermaid({
        direction: 'TD',
        nodes: [{ id: 'a', shape: 'square', label, x: 0, y: 0 }],
        edges: [],
      });
      assert.strictEqual(out, expected, JSON.stringify(label));
    }
  });

  test('a label that is one long run of spaces is fast', () => {
    const label = 'x' + ' '.repeat(90_000) + 'y';
    const out = within('toMermaid', () =>
      toMermaid({
        direction: 'TD',
        nodes: [{ id: 'a', shape: 'square', label, x: 0, y: 0 }],
        edges: [{ id: 'e1', source: 'a', target: 'a', label, stroke: 'normal', arrow: 'point' }],
      }),
    );
    assert.ok(out.includes(label));
  });
});
