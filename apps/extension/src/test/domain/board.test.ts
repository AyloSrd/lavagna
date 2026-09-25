import * as assert from 'assert';
import { suite, test } from 'vitest';
import {
  boardFileName,
  boardNameFromFileName,
  boardTemplate,
  isBoardFileName,
  slugify,
  uniqueSlug,
} from '../../domain/boards/board';

suite('board naming', () => {
  test('slugify lowercases, kebab-cases, strips diacritics', () => {
    assert.strictEqual(slugify('My Board'), 'my-board');
    assert.strictEqual(slugify('Città più bella'), 'citta-piu-bella');
    assert.strictEqual(slugify('  spaced   out  '), 'spaced-out');
    assert.strictEqual(slugify('Design: v2 (final!)'), 'design-v2-final');
  });

  test('slugify falls back to "board" when nothing survives', () => {
    assert.strictEqual(slugify('***'), 'board');
    assert.strictEqual(slugify(''), 'board');
  });

  test('file name round trip', () => {
    assert.strictEqual(boardFileName('my-board'), 'my-board.lavagna.md');
    assert.strictEqual(boardNameFromFileName('my-board.lavagna.md'), 'My Board');
    assert.strictEqual(isBoardFileName('my-board.lavagna.md'), true);
    assert.strictEqual(isBoardFileName('.lavagna.md'), false);
    assert.strictEqual(isBoardFileName('notes.md'), false);
  });

  test('uniqueSlug appends -2, -3 on collisions', () => {
    assert.strictEqual(uniqueSlug('idea', []), 'idea');
    assert.strictEqual(uniqueSlug('idea', ['idea']), 'idea-2');
    assert.strictEqual(uniqueSlug('idea', ['idea', 'idea-2']), 'idea-3');
    assert.strictEqual(uniqueSlug('idea', ['idea-2']), 'idea');
  });

  test('template is a single H1 plus a blank line', () => {
    assert.strictEqual(boardTemplate('My Board'), '# My Board\n\n');
  });
});
