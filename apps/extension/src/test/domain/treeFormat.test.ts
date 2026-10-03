import * as assert from 'assert';
import { suite, test } from 'vitest';
import {
  MAX_TREE_BYTES,
  MAX_TREE_LINES,
  connectorPrefix,
  connectorPrefixes,
  depthOf,
  fromAscii,
  isTreeTooLarge,
  toAscii,
} from '../../webview/format/treeFormat';

// [data, toAscii(data), fromAscii(toAscii(data))] — captured from the
// implementation that scanned forward once per level per line, before
// `toAscii` became a single backward pass.
const TREES: [string, string, string][] = [
  ['root', 'root', 'root'],
  ['root\n  a\n  b', 'root\n├─a\n└─b', 'root\n  a\n  b'],
  [
    'root\n  a\n    a1\n    a2\n  b\n    b1\n      b11\n  c',
    'root\n├─a\n│ ├─a1\n│ └─a2\n├─b\n│ └─b1\n│   └─b11\n└─c',
    'root\n  a\n    a1\n    a2\n  b\n    b1\n      b11\n  c',
  ],
  [
    'src\n  domain\n    blocks\n      parseBlocks.ts\n    references\n  webview\n    format\n  extension.ts\nREADME.md',
    'src\n├─domain\n│ ├─blocks\n│ │ └─parseBlocks.ts\n│ └─references\n├─webview\n│ └─format\n└─extension.ts\nREADME.md',
    'src\n  domain\n    blocks\n      parseBlocks.ts\n    references\n  webview\n    format\n  extension.ts\nREADME.md',
  ],
  ['a\n\n  b\n', 'a\n\n└─b\n', 'a\n\n  b\n'],
  ['a\n    skip\n  b', 'a\n│ └─skip\n└─b', 'a\n    skip\n  b'],
  ['a\n\tb\n\t\tc\n\td', 'a\n├─b\n│ └─c\n└─d', 'a\n  b\n    c\n  d'],
  ['x  \n  y  ', 'x  \n└─y  ', 'x  \n  y  '],
];

suite('treeFormat: toAscii', () => {
  test('normal trees render and round-trip exactly as before', () => {
    for (const [data, ascii, roundTrip] of TREES) {
      assert.strictEqual(toAscii(data), ascii, JSON.stringify(data));
      assert.strictEqual(fromAscii(ascii), roundTrip, JSON.stringify(data));
    }
  });

  test('connectorPrefixes agrees with the per-line connectorPrefix on random trees', () => {
    let seed = 12345;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 3000; round++) {
      const length = 1 + rand(20);
      const maxDepth = 1 + rand(7);
      // Includes depth jumps of more than one level, which hand-edited text can have.
      const depths = Array.from({ length }, () => rand(maxDepth + 1));
      assert.deepStrictEqual(
        connectorPrefixes(depths),
        depths.map((_, i) => connectorPrefix(depths, i)),
        JSON.stringify(depths),
      );
    }
  });

  test('a large deep tree formats in reasonable time (it was O(depth x lines))', () => {
    // ~1 MB: 30k lines, indentation cycling through 60 levels. The old scan took ~2.7 s.
    const data = Array.from({ length: 30_000 }, (_, i) => ' '.repeat(2 * (i % 60)) + 'x').join('\n');
    const start = performance.now();
    const ascii = toAscii(data);
    const ms = performance.now() - start;
    assert.strictEqual(ascii.split('\n').length, 30_000);
    assert.ok(ms < 500, `toAscii took ${ms.toFixed(0)} ms`);
    // And it still decodes to the same tree.
    assert.strictEqual(fromAscii(ascii), data);
  });

  test('a staircase (every line one level deeper) is linear in the output size', () => {
    const data = Array.from({ length: 1500 }, (_, i) => ' '.repeat(2 * i) + 'x').join('\n');
    const start = performance.now();
    toAscii(data);
    assert.ok(performance.now() - start < 500);
  });

  test('depthOf is unchanged: two spaces or one tab per level', () => {
    assert.strictEqual(depthOf('x'), 0);
    assert.strictEqual(depthOf('    x'), 2);
    assert.strictEqual(depthOf('\t\tx'), 2);
    assert.strictEqual(depthOf(' x'), 0);
  });
});

suite('treeFormat: size cap', () => {
  test('ordinary trees are editable', () => {
    for (const [data, ascii] of TREES) {
      assert.strictEqual(isTreeTooLarge(data), false);
      assert.strictEqual(isTreeTooLarge(ascii), false);
    }
    assert.strictEqual(isTreeTooLarge(''), false);
  });

  test('over the byte limit is too large', () => {
    assert.strictEqual(isTreeTooLarge('x'.repeat(MAX_TREE_BYTES)), false);
    assert.strictEqual(isTreeTooLarge('x'.repeat(MAX_TREE_BYTES + 1)), true);
  });

  test('over the line limit is too large, even when the bytes are few', () => {
    assert.strictEqual(isTreeTooLarge(Array(MAX_TREE_LINES).fill('x').join('\n')), false);
    assert.strictEqual(isTreeTooLarge(Array(MAX_TREE_LINES + 1).fill('x').join('\n')), true);
    assert.strictEqual(isTreeTooLarge('\n'.repeat(MAX_TREE_BYTES)), true);
  });
});
