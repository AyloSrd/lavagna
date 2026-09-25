import * as assert from 'assert';
import { suite, test } from 'vitest';
import { computeBlockEdit } from '../../domain/blocks/computeBlockEdit';
import { parseBlocks } from '../../domain/blocks/parseBlocks';
import { formatFileRef, parseFileRefTarget } from '../../domain/references/fileRef';
import { isSafeRelativePath } from '../../domain/references/safePath';
import { parseTable } from '../../webview/format/tableFormat';
import { tryFromMermaid } from '../../webview/format/mermaid';

const F = '```';

// Regression tests for the security/data-integrity review. Board files are
// untrusted input (git pull, teammates, AI output) — and the two worst bugs
// needed no attacker at all, just a malformed fence.

suite('data loss: unclosed fences', () => {
  test('an unclosed fence is parsed but never editable', () => {
    const text = [F + 'tree', 'root', '  a', '', '## Notes', 'secret plan'].join('\n');
    const block = parseBlocks(text)[0];
    assert.strictEqual(block.closed, false);
    // It used to "own" every line to EOF, so one keystroke deleted the tail.
    assert.strictEqual(computeBlockEdit(text, { kind: 'tree', indexOfKind: 0 }, 'root'), null);
  });

  test('a closed fence of the same shape is still editable', () => {
    const text = [F + 'tree', 'root', F, '', '## Notes'].join('\n');
    const edit = computeBlockEdit(text, { kind: 'tree', indexOfKind: 0 }, 'root\n  b');
    assert.deepStrictEqual(edit, { startLine: 1, endLineExclusive: 2, newText: 'root\n  b\n' });
  });

  test('the degenerate EOF fence no longer yields an out-of-bounds range', () => {
    // '# Board\n\n```tree' — used to produce startLine 3 in a 3-line document,
    // which validateRange then clamped into the middle of the fence line.
    assert.strictEqual(
      computeBlockEdit('# Board\n\n' + F + 'tree', { kind: 'tree', indexOfKind: 0 }, 'x'),
      null,
    );
  });
});

suite('data loss: table run must stop at block-level constructs', () => {
  test('a fence opener containing a pipe is not swallowed as a row', () => {
    const text = ['| a | b |', '|---|---|', F + 'js | x', 'const secret = 1;', F, '', 'PROSE'].join('\n');
    const kinds = parseBlocks(text).map((b) => `${b.kind}[${b.startLine}-${b.endLine}]`);
    assert.deepStrictEqual(kinds, ['table[0-1]', 'code[2-4]']);
    // The table edit must not reach the fence line.
    const edit = computeBlockEdit(text, { kind: 'table', indexOfKind: 0 }, '| a | b |\n|---|---|');
    assert.strictEqual(edit!.endLineExclusive, 2);
  });

  test('an image line containing a pipe survives an adjacent table', () => {
    const text = ['| a |', '|---|', '![canvas](media/a|b.png)'].join('\n');
    const kinds = parseBlocks(text).map((b) => b.kind);
    assert.deepStrictEqual(kinds, ['table', 'image']);
  });

  test('ordinary rows are still collected', () => {
    const text = ['| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |', '', 'after'].join('\n');
    const table = parseBlocks(text)[0];
    assert.strictEqual(table.endLine, 3);
  });
});

suite('DoS: parsers refuse pathological input instead of hanging', () => {
  test('an oversized mermaid fence is refused', () => {
    const src = 'flowchart TD\n' + Array.from({ length: 25000 }, (_, i) => `b${i} -- l --> b${i + 1}`).join(' ');
    const started = Date.now();
    assert.strictEqual(tryFromMermaid(src), null);
    assert.ok(Date.now() - started < 1000, 'should refuse quickly, not grind');
  });

  test('an & fan-out cross product is refused', () => {
    const g =
      'flowchart TD\n' +
      Array.from({ length: 1500 }, (_, i) => `p${i}`).join(' & ') +
      ' --> ' +
      Array.from({ length: 1500 }, (_, i) => `q${i}`).join(' & ');
    const started = Date.now();
    assert.strictEqual(tryFromMermaid(g), null);
    assert.ok(Date.now() - started < 1000);
  });

  test('a table wider than the cell cap is refused', () => {
    const cols = 20000;
    const text = [
      '| ' + Array.from({ length: cols }, (_, i) => `c${i}`).join(' | ') + ' |',
      '|' + '---|'.repeat(cols),
      '| x |',
    ].join('\n');
    const started = Date.now();
    assert.strictEqual(parseTable(text), null);
    assert.ok(Date.now() - started < 1000);
  });

  test('ordinary diagrams and tables still parse', () => {
    assert.ok(tryFromMermaid('flowchart TD\n  a --> b'));
    assert.ok(parseTable('| a | b |\n|---|---|\n| 1 | 2 |'));
  });
});

suite('path safety: board content cannot name arbitrary locations', () => {
  const unsafe = [
    '../../../../etc/passwd',
    '..',
    'a/../../b',
    '/etc/passwd',
    '\\\\server\\share\\x',
    '//attacker.example/s/a.png',
    'C:\\Windows\\system32',
    'a\u0000b',
  ];
  for (const target of unsafe) {
    test(`rejects ${JSON.stringify(target)}`, () => {
      assert.strictEqual(isSafeRelativePath(target), false);
    });
  }

  const safe = ['media/a.png', 'src/foo.ts', 'a/b/c.md', 'weird name.png'];
  for (const target of safe) {
    test(`allows ${JSON.stringify(target)}`, () => {
      assert.strictEqual(isSafeRelativePath(target), true);
    });
  }
});

suite('reference formatting cannot inject markdown', () => {
  test('a filename containing a newline and a fence cannot break out', () => {
    const hostile = 'src/a\n\n' + F + 'mermaid\nX\n' + F + '\n.ts';
    const link = formatFileRef(hostile);
    assert.ok(!link.includes('\n'), 'no newline may survive into the link');
    assert.ok(!link.includes(F), 'no fence may survive into the link');
  });

  test('brackets in a filename cannot break the link text', () => {
    const link = formatFileRef('src/a]b[c.ts');
    assert.strictEqual(link.split('](').length, 2, 'exactly one link separator');
  });

  test('absurd line numbers are dropped rather than propagated', () => {
    assert.strictEqual(parseFileRefTarget('a.ts#L' + '9'.repeat(400))!.lines, undefined);
    assert.strictEqual(parseFileRefTarget('a.ts#L0')!.lines, undefined);
    assert.strictEqual(parseFileRefTarget('a.ts#L5-L2')!.lines, undefined);
    assert.deepStrictEqual(parseFileRefTarget('a.ts#L2-L5')!.lines, { start: 2, end: 5 });
  });
});
