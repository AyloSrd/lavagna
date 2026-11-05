import * as assert from 'assert';
import { suite, test } from 'vitest';
import { findUnusedMedia, isCleanableMediaName } from '../../domain/media/unusedMedia';

suite('isCleanableMediaName', () => {
  test('images are cleanable, whatever the case of the extension', () => {
    for (const name of ['ab12.png', 'a.JPG', 'b.jpeg', 'c.gif', 'd.webp', 'e.bmp', 'f.svg']) {
      assert.strictEqual(isCleanableMediaName(name), true, name);
    }
  });

  test('dotfiles, non-images and anything path-like are not', () => {
    for (const name of ['', '.gitkeep', '.hidden.png', 'notes.md', 'png', 'a/b.png', 'a\\b.png', 'a\0.png']) {
      assert.strictEqual(isCleanableMediaName(name), false, JSON.stringify(name));
    }
  });
});

suite('findUnusedMedia', () => {
  const media = ['aaa.png', 'bbb.png', 'ccc.jpg'];

  test('an image linked by a canvas line is used; the rest are not', () => {
    const board = '# Board\n\n![canvas](media/aaa.png)\n';
    assert.deepStrictEqual(findUnusedMedia(media, [board]), ['bbb.png', 'ccc.jpg']);
  });

  test('a mention in any board counts', () => {
    const boards = ['![a](media/aaa.png)', 'text <img src="media/ccc.jpg"> more'];
    assert.deepStrictEqual(findUnusedMedia(media, boards), ['bbb.png']);
  });

  test('inline links, titles, query strings, fragments and other relative paths all count', () => {
    const board = [
      'see ![x](media/aaa.png "title") inline',
      '[open](../.lavagna/media/bbb.png?v=2#top)',
      'src=ccc.jpg',
    ].join('\n');
    assert.deepStrictEqual(findUnusedMedia(media, [board]), []);
  });

  test('matching ignores case', () => {
    assert.deepStrictEqual(findUnusedMedia(['Shot.PNG'], ['![a](media/shot.png)']), []);
  });

  test('a name is not used just because a longer name contains it', () => {
    assert.deepStrictEqual(findUnusedMedia(['a.png'], ['![x](media/aa.png)', '![y](media/a.png.bak)']), ['a.png']);
  });

  test('percent-encoded and spaced names are found', () => {
    const names = ['my shot.png', 'été.png', '(1).png'];
    const board = '![a](media/my%20shot.png)\n![b](media/%C3%A9t%C3%A9.png)\n![c](<media/(1).png>)';
    assert.deepStrictEqual(findUnusedMedia(names, [board]), []);
  });

  test('a stray % does not break decoding', () => {
    assert.deepStrictEqual(findUnusedMedia(['aaa.png'], ['100% done %E0%A4 ![a](media/aaa.png)']), []);
  });

  test('a decomposed file name matches a composed board, and the other way round', () => {
    const nfd = 'Cafe\u0301.png';
    const nfc = 'Caf\u00e9.png';
    assert.deepStrictEqual(findUnusedMedia([nfd], [`![a](media/${nfc})`]), []);
    assert.deepStrictEqual(findUnusedMedia([nfc], [`![a](media/${nfd})`]), []);
  });

  test('markdown backslash escapes in a link are read through', () => {
    const board = '![a](media/my\\_pic.png) and [b](media/x\\(1\\).png)';
    assert.deepStrictEqual(findUnusedMedia(['my_pic.png', 'x(1).png'], [board]), []);
  });

  test('with no boards everything is unused, sorted', () => {
    assert.deepStrictEqual(findUnusedMedia(['b.png', 'a.png'], []), ['a.png', 'b.png']);
  });
});
