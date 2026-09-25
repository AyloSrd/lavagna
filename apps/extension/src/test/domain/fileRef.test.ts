import * as assert from 'assert';
import { suite, test } from 'vitest';
import { formatFileRef, parseFileRefTarget } from '../../domain/references/fileRef';

suite('fileRef', () => {
  test('whole-file ref: @-prefixed text, target anchored with #L1', () => {
    // #L1 so our link provider owns the click (built-in md provider competes on
    // fragment-less targets). `@` marks it as a filesystem reference; no ":1".
    assert.strictEqual(formatFileRef('src/foo.ts'), '[@src/foo.ts](src/foo.ts#L1)');
  });

  test('formats a single line and a range', () => {
    assert.strictEqual(formatFileRef('src/foo.ts', { start: 12, end: 12 }), '[@src/foo.ts:12](src/foo.ts#L12)');
    assert.strictEqual(
      formatFileRef('src/foo.ts', { start: 12, end: 40 }),
      '[@src/foo.ts:12-40](src/foo.ts#L12-L40)',
    );
  });

  test('forces forward slashes', () => {
    assert.strictEqual(formatFileRef('src\\a\\b.ts'), '[@src/a/b.ts](src/a/b.ts#L1)');
  });

  test('angle-wraps a target with spaces or parens; the @ prefix is text-only', () => {
    assert.strictEqual(
      formatFileRef('src/my file.ts', { start: 3, end: 3 }),
      '[@src/my file.ts:3](<src/my file.ts#L3>)',
    );
    assert.strictEqual(formatFileRef('src/a(b).ts'), '[@src/a(b).ts](<src/a(b).ts#L1>)');
  });

  test('parse: path only', () => {
    assert.deepStrictEqual(parseFileRefTarget('src/foo.ts'), { path: 'src/foo.ts' });
  });

  test('parse: single line and range', () => {
    assert.deepStrictEqual(parseFileRefTarget('src/foo.ts#L12'), {
      path: 'src/foo.ts',
      lines: { start: 12, end: 12 },
    });
    assert.deepStrictEqual(parseFileRefTarget('src/foo.ts#L12-L40'), {
      path: 'src/foo.ts',
      lines: { start: 12, end: 40 },
    });
  });

  test('parse: unwraps angle brackets', () => {
    assert.deepStrictEqual(parseFileRefTarget('<src/my file.ts#L3>'), {
      path: 'src/my file.ts',
      lines: { start: 3, end: 3 },
    });
  });

  test('parse: rejects an empty path', () => {
    assert.strictEqual(parseFileRefTarget('#L3'), null);
    assert.strictEqual(parseFileRefTarget(''), null);
  });

  test('format → parse round-trip preserves path and lines', () => {
    const link = formatFileRef('src/a b.ts', { start: 5, end: 9 });
    const target = /\]\((.*)\)$/.exec(link)![1];
    assert.deepStrictEqual(parseFileRefTarget(target), {
      path: 'src/a b.ts',
      lines: { start: 5, end: 9 },
    });
  });
});
