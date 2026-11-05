// "Clean unused media" moves files to the trash: the folder and each file must
// be shown to be real, inside the workspace, before anything is touched.

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, suite, test } from 'vitest';
import { assertMediaFile, realMediaDir } from '../../infrastructure/paths/mediaPath';
import { ContainmentError } from '../../infrastructure/paths/realPath';

let base: string;
let ws: string;
let outside: string;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lavagna-mediapath-')));
  ws = path.join(base, 'ws');
  outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(ws, '.lavagna'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'photo.png'), 'x');
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function mediaFile(name: string): string {
  const file = path.join(ws, '.lavagna', 'media', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
  return file;
}

suite('realMediaDir', () => {
  test('null when .lavagna/media does not exist', async () => {
    assert.strictEqual(await realMediaDir(ws), null);
  });

  test('the folder when it is real', async () => {
    mediaFile('a.png');
    assert.strictEqual(await realMediaDir(ws), path.join(ws, '.lavagna', 'media'));
  });

  test('a symlinked media folder is refused', async () => {
    fs.symlinkSync(outside, path.join(ws, '.lavagna', 'media'));
    await assert.rejects(realMediaDir(ws), ContainmentError);
  });

  test('a symlinked .lavagna is refused', async () => {
    fs.rmSync(path.join(ws, '.lavagna'), { recursive: true });
    fs.mkdirSync(path.join(outside, 'media'));
    fs.symlinkSync(outside, path.join(ws, '.lavagna'));
    await assert.rejects(realMediaDir(ws), ContainmentError);
  });

  test('a file named media is refused', async () => {
    fs.writeFileSync(path.join(ws, '.lavagna', 'media'), 'x');
    await assert.rejects(realMediaDir(ws), ContainmentError);
  });
});

suite('assertMediaFile', () => {
  test('an image directly in .lavagna/media is accepted', async () => {
    const file = mediaFile('a.png');
    assert.strictEqual(await assertMediaFile('a.png', ws), file);
  });

  test('names that are not a single image file name are refused', async () => {
    mediaFile('a.png');
    for (const name of [undefined, 42, '', '..', '../a.png', 'sub/a.png', '.gitkeep', 'notes.md', '\0.png']) {
      await assert.rejects(assertMediaFile(name, ws), ContainmentError, JSON.stringify(name));
    }
  });

  test('a symlink in the media folder is refused, even to an image', async () => {
    mediaFile('a.png');
    fs.symlinkSync(path.join(outside, 'photo.png'), path.join(ws, '.lavagna', 'media', 'link.png'));
    await assert.rejects(assertMediaFile('link.png', ws), ContainmentError);
  });

  test('a folder named like an image is refused', async () => {
    fs.mkdirSync(path.join(ws, '.lavagna', 'media', 'dir.png'), { recursive: true });
    await assert.rejects(assertMediaFile('dir.png', ws), ContainmentError);
  });

  test('a missing file is refused', async () => {
    mediaFile('a.png');
    await assert.rejects(assertMediaFile('b.png', ws), ContainmentError);
  });
});
