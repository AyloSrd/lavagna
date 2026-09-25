import * as assert from 'assert';
import { suite, test } from 'vitest';
import { computeBlockEdit } from '../../domain/blocks/computeBlockEdit';

const DOC = [
  '# Board',            // 0
  '',                   // 1
  '```tree',            // 2
  'root',               // 3
  '  child',            // 4
  '```',                // 5
  '',                   // 6
  '```tree',            // 7
  'other',              // 8
  '```',                // 9
].join('\n');

suite('computeBlockEdit', () => {
  test('replaces the content lines of the targeted block', () => {
    const edit = computeBlockEdit(DOC, { kind: 'tree', indexOfKind: 1 }, 'a\n  b');
    assert.deepStrictEqual(edit, { startLine: 8, endLineExclusive: 9, newText: 'a\n  b\n' });
  });

  test('relocates the block when lines were inserted above', () => {
    const shifted = 'intro line\n' + DOC;
    const edit = computeBlockEdit(shifted, { kind: 'tree', indexOfKind: 0 }, 'x');
    assert.deepStrictEqual(edit, { startLine: 4, endLineExclusive: 6, newText: 'x\n' });
  });

  test('returns null when the block no longer exists', () => {
    assert.strictEqual(computeBlockEdit(DOC, { kind: 'tree', indexOfKind: 2 }, 'x'), null);
    assert.strictEqual(computeBlockEdit(DOC, { kind: 'mermaid', indexOfKind: 0 }, 'x'), null);
  });

  test('empty fence body becomes an insertion at the closing fence line', () => {
    const doc = '```tree\n```';
    const edit = computeBlockEdit(doc, { kind: 'tree', indexOfKind: 0 }, 'root');
    assert.deepStrictEqual(edit, { startLine: 1, endLineExclusive: 1, newText: 'root\n' });
  });

  test('image lines are replaced whole', () => {
    const doc = ['intro', '![canvas](media/a.png)', 'outro'].join('\n');
    const edit = computeBlockEdit(doc, { kind: 'image', indexOfKind: 0 }, '![canvas](media/b.png)');
    assert.deepStrictEqual(edit, {
      startLine: 1,
      endLineExclusive: 2,
      newText: '![canvas](media/b.png)\n',
    });
  });

  test('empty new content deletes the content lines', () => {
    const edit = computeBlockEdit(DOC, { kind: 'tree', indexOfKind: 0 }, '');
    assert.deepStrictEqual(edit, { startLine: 3, endLineExclusive: 5, newText: '' });
  });

  test('a single trailing newline in newContent is normalized away', () => {
    const edit = computeBlockEdit(DOC, { kind: 'tree', indexOfKind: 0 }, 'a\nb\n');
    assert.strictEqual(edit?.newText, 'a\nb\n');
  });

  test('tables are replaced whole, including header and delimiter', () => {
    const doc = ['| a |', '|---|', '| 1 |', 'after'].join('\n');
    const edit = computeBlockEdit(doc, { kind: 'table', indexOfKind: 0 }, '| x |\n|---|\n| 9 |');
    assert.deepStrictEqual(edit, {
      startLine: 0,
      endLineExclusive: 3,
      newText: '| x |\n|---|\n| 9 |\n',
    });
  });

  test('an unclosed fence is refused rather than swallowing the rest of the file', () => {
    // Was: returned a range covering every line to EOF, so one edit deleted
    // everything after the fence. See test/domain/security.test.ts.
    const doc = '```tree\na';
    assert.strictEqual(computeBlockEdit(doc, { kind: 'tree', indexOfKind: 0 }, 'b'), null);
  });
});
