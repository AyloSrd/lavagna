import * as assert from 'assert';
import { suite, test } from 'vitest';
import {
  CopySource,
  MAX_TRACKED,
  findCopySource,
  remember,
  sameText,
} from '../../domain/references/copySource';

const src = (over: Partial<CopySource> = {}): CopySource => ({
  path: 'src/a.ts',
  folder: 'file:///w',
  start: 1,
  end: 2,
  text: 'const a = 1;',
  ...over,
});

suite('sameText — matching a clipboard against a remembered selection', () => {
  test('identical text matches', () => {
    assert.ok(sameText('const a = 1;', 'const a = 1;'));
  });

  test('CRLF and LF are the same text', () => {
    assert.ok(sameText('a\r\nb', 'a\nb'));
  });

  test('one trailing newline is ignored — a whole-line copy adds it', () => {
    assert.ok(sameText('a\nb', 'a\nb\n'));
    assert.ok(sameText('a\nb\n', 'a\nb'));
  });

  test('nothing else is forgiven: leading space, inner space, case, truncation', () => {
    assert.strictEqual(sameText('a', ' a'), false);
    assert.strictEqual(sameText('a b', 'a  b'), false);
    assert.strictEqual(sameText('A', 'a'), false);
    assert.strictEqual(sameText('const a = 1;', 'const a = 1'), false);
    assert.strictEqual(sameText('a\nb', 'a\nb\n\n'), false, 'only one newline is dropped');
  });
});

suite('findCopySource — which file the clipboard came from', () => {
  test('finds the entry holding exactly this text', () => {
    const entries = [src({ path: 'b.ts', text: 'other' }), src()];
    assert.strictEqual(findCopySource(entries, 'const a = 1;')?.path, 'src/a.ts');
  });

  test('returns null when nothing holds it — no closest match', () => {
    assert.strictEqual(findCopySource([src()], 'const a = 2;'), null);
  });

  test('an empty or whitespace clipboard never matches', () => {
    const entries = [src({ text: '   ' })];
    assert.strictEqual(findCopySource(entries, ''), null);
    assert.strictEqual(findCopySource(entries, '   '), null);
    assert.strictEqual(findCopySource(entries, '\n\t'), null);
  });

  test('with the same text in two places the most recent wins', () => {
    // Ordered most-recent-first, so a duplicated snippet resolves to where the
    // user actually was rather than to whichever file was seen first.
    const entries = [src({ path: 'new.ts' }), src({ path: 'old.ts' })];
    assert.strictEqual(findCopySource(entries, 'const a = 1;')?.path, 'new.ts');
  });

  test('an empty history matches nothing', () => {
    assert.strictEqual(findCopySource([], 'anything'), null);
  });
});

suite('remember — the recent-selection list', () => {
  test('newest first', () => {
    const list = remember(remember([], src({ path: 'a.ts' })), src({ path: 'b.ts' }));
    assert.deepStrictEqual(list.map((e) => e.path), ['b.ts', 'a.ts']);
  });

  test('re-selecting the same range moves it up instead of duplicating', () => {
    const first = src({ path: 'a.ts', text: 'v1' });
    const again = src({ path: 'a.ts', text: 'v2' });
    const list = remember(remember([], first), again);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].text, 'v2', 'the fresher text must win');
  });

  test('different ranges in one file are kept apart', () => {
    const list = remember(
      remember([], src({ start: 1, end: 2 })),
      src({ start: 9, end: 9 }),
    );
    assert.strictEqual(list.length, 2);
  });

  test('the list is capped, dropping the oldest', () => {
    let list: CopySource[] = [];
    for (let i = 0; i < MAX_TRACKED + 10; i++) {
      list = remember(list, src({ start: i, end: i, text: `t${i}` }));
    }
    assert.strictEqual(list.length, MAX_TRACKED);
    assert.strictEqual(list[0].text, `t${MAX_TRACKED + 9}`, 'newest kept');
    assert.ok(!list.some((e) => e.text === 't0'), 'oldest dropped');
  });
});
