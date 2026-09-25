import * as assert from 'assert';
import { suite, test } from 'vitest';
import { fuzzyFilter, partitionPicks } from '../../domain/references/fuzzy';

const FILES = [
  'src/webview/editors/CanvasEditor.tsx',
  'src/webview/editors/TableEditor.tsx',
  'src/domain/references/fuzzy.ts',
  'src/domain/references/fileRef.ts',
  'README.md',
  'package.json',
];

suite('fuzzyFilter', () => {
  test('empty query returns the first N unchanged', () => {
    assert.deepStrictEqual(fuzzyFilter(FILES, '', 3), FILES.slice(0, 3));
    assert.deepStrictEqual(fuzzyFilter(FILES, '   ', 2), FILES.slice(0, 2));
  });

  test('matches as a subsequence, case-insensitive', () => {
    const r = fuzzyFilter(FILES, 'canv', 10);
    assert.ok(r.includes('src/webview/editors/CanvasEditor.tsx'));
    assert.ok(!r.includes('README.md'));
  });

  test('drops non-matches entirely', () => {
    assert.deepStrictEqual(fuzzyFilter(FILES, 'zzzzz', 10), []);
  });

  test('ranks a basename hit above an incidental scatter', () => {
    const r = fuzzyFilter(FILES, 'fuzzy', 10);
    assert.strictEqual(r[0], 'src/domain/references/fuzzy.ts');
  });

  test('respects the limit', () => {
    assert.strictEqual(fuzzyFilter(FILES, 's', 2).length, 2);
  });

  test('consecutive/boundary matches beat scattered ones', () => {
    // "ref" hits the "references" segment start in both, then fileRef/fuzzy;
    // both match — the point is only matching paths come back, ranked.
    const r = fuzzyFilter(FILES, 'ref', 10);
    assert.ok(r.every((p) => p.includes('references')));
  });
});

suite('partitionPicks — keeping a selection alive across searches', () => {
  const paths = ['src/app.ts', 'src/util/date.ts', 'docs/readme.md', 'test/app.test.ts'];

  test('with nothing picked it is just the ranked list', () => {
    const { pinned, rest } = partitionPicks(paths, 'app', new Set(), 10);
    assert.deepStrictEqual(pinned, []);
    assert.ok(rest.includes('src/app.ts'));
  });

  test('a pick survives a query it does not match', () => {
    // The bug: search "app", pick src/app.ts, then search "date" — the pick
    // used to vanish because it no longer matched.
    const { pinned, rest } = partitionPicks(paths, 'date', new Set(['src/app.ts']), 10);
    assert.deepStrictEqual(pinned, ['src/app.ts'], 'pick should be pinned regardless of the query');
    assert.ok(rest.includes('src/util/date.ts'), 'the new query still ranks');
  });

  test('a picked path never appears twice, even when it matches the query', () => {
    const { pinned, rest } = partitionPicks(paths, 'app', new Set(['src/app.ts']), 10);
    assert.deepStrictEqual(pinned, ['src/app.ts']);
    assert.ok(!rest.includes('src/app.ts'), 'two rows would mean two checkboxes for one file');
  });

  test('pinned order is the order picked, not alphabetical or ranked', () => {
    const picked = new Set(['test/app.test.ts', 'docs/readme.md', 'src/app.ts']);
    assert.deepStrictEqual(partitionPicks(paths, '', picked, 10).pinned, [
      'test/app.test.ts',
      'docs/readme.md',
      'src/app.ts',
    ]);
  });

  test('the limit caps the ranked half only — picks are never truncated', () => {
    const many = Array.from({ length: 50 }, (_, i) => `src/f${i}.ts`);
    const picked = new Set(many.slice(0, 5));
    const { pinned, rest } = partitionPicks(many, 'f', picked, 3);
    assert.strictEqual(pinned.length, 5, 'a pick must not be dropped by the cap');
    assert.strictEqual(rest.length, 3);
  });

  test('a picked path that is gone from the workspace is still reported', () => {
    // render() maps through itemByPath and filters misses, so a stale entry
    // degrades to "not shown" rather than throwing.
    const { pinned } = partitionPicks(paths, '', new Set(['deleted/gone.ts']), 10);
    assert.deepStrictEqual(pinned, ['deleted/gone.ts']);
  });
});
