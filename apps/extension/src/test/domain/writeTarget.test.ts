// The check in front of every media write, against real temp folders and real
// symlinks: a repository can commit `.lavagna/media/<hash>.png` — or
// `.lavagna`, or `media` — as a link to `.git/config`, and the file name is the
// hash of bytes anyone can compute (the bundled blank page).

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, suite, test } from 'vitest';
import { ContainmentError } from '../../infrastructure/paths/realPath';
import { createFileExclusive, inspectWriteTarget } from '../../infrastructure/paths/writeTarget';

let base: string;
let ws: string;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lavagna-writetarget-')));
  ws = path.join(base, 'ws');
  fs.mkdirSync(ws);
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const NAME = '0123456789abcdef.png';

function mediaFile(): string {
  return path.join(ws, '.lavagna', 'media', NAME);
}

/** `ln -s target at`, creating the folder of `at`. Junction on Windows, which needs no privilege. */
function link(target: string, at: string): void {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.symlinkSync(target, at, 'junction');
}

suite('inspectWriteTarget — media files under the workspace', () => {
  test('nothing there yet: absent, even when .lavagna does not exist', async () => {
    assert.deepStrictEqual(await inspectWriteTarget(mediaFile(), ws), { kind: 'absent' });
    fs.mkdirSync(path.join(ws, '.lavagna', 'media'), { recursive: true });
    assert.deepStrictEqual(await inspectWriteTarget(mediaFile(), ws), { kind: 'absent' });
  });

  test('a regular file already there is reported with its size', async () => {
    fs.mkdirSync(path.dirname(mediaFile()), { recursive: true });
    fs.writeFileSync(mediaFile(), 'abcd');
    assert.deepStrictEqual(await inspectWriteTarget(mediaFile(), ws), { kind: 'file', size: 4 });
  });

  test('the file itself a link to .git/config is refused, and the target untouched', async () => {
    const config = path.join(ws, '.git', 'config');
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(config, '[core]\n');
    fs.mkdirSync(path.dirname(mediaFile()), { recursive: true });
    link(config, mediaFile());
    await assert.rejects(inspectWriteTarget(mediaFile(), ws), ContainmentError);
    assert.strictEqual(fs.readFileSync(config, 'utf8'), '[core]\n');
  });

  test('the file a link to a file outside the workspace is refused', async () => {
    const outside = path.join(base, 'bashrc');
    fs.writeFileSync(outside, 'export A=1\n');
    fs.mkdirSync(path.dirname(mediaFile()), { recursive: true });
    link(outside, mediaFile());
    await assert.rejects(inspectWriteTarget(mediaFile(), ws), ContainmentError);
  });

  test('the file a dangling link is refused (a write would create its target)', async () => {
    fs.mkdirSync(path.dirname(mediaFile()), { recursive: true });
    link(path.join(base, 'does-not-exist'), mediaFile());
    await assert.rejects(inspectWriteTarget(mediaFile(), ws), ContainmentError);
    assert.strictEqual(fs.existsSync(path.join(base, 'does-not-exist')), false);
  });

  test('.lavagna/media a link out of the workspace is refused', async () => {
    const outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
    link(outside, path.join(ws, '.lavagna', 'media'));
    await assert.rejects(inspectWriteTarget(mediaFile(), ws), ContainmentError);
    assert.deepStrictEqual(fs.readdirSync(outside), []);
  });

  test('.lavagna itself a link out of the workspace is refused', async () => {
    const outside = path.join(base, 'outside');
    fs.mkdirSync(path.join(outside, 'media'), { recursive: true });
    link(outside, path.join(ws, '.lavagna'));
    await assert.rejects(inspectWriteTarget(mediaFile(), ws), ContainmentError);
  });

  test('a link that stays inside the workspace is still refused', async () => {
    fs.mkdirSync(path.join(ws, 'elsewhere', 'media'), { recursive: true });
    link(path.join(ws, 'elsewhere'), path.join(ws, '.lavagna'));
    await assert.rejects(inspectWriteTarget(mediaFile(), ws), ContainmentError);
  });

  test('a link in the position of a missing folder is caught before mkdir runs', async () => {
    // Before createDirectory: `.lavagna` is a dangling link, so mkdir would create its target.
    link(path.join(base, 'nowhere'), path.join(ws, '.lavagna'));
    await assert.rejects(inspectWriteTarget(mediaFile(), ws), ContainmentError);
  });

  test('a directory or other non-file in the file position is refused', async () => {
    fs.mkdirSync(mediaFile(), { recursive: true });
    await assert.rejects(inspectWriteTarget(mediaFile(), ws), ContainmentError);
  });

  test('a path outside the workspace is refused outright', async () => {
    await assert.rejects(inspectWriteTarget(path.join(base, 'x.png'), ws), ContainmentError);
    await assert.rejects(inspectWriteTarget(ws, ws), ContainmentError);
  });

  test('a workspace root that is itself under a link is fine', async () => {
    const real = path.join(base, 'real');
    fs.mkdirSync(real);
    const viaLink = path.join(base, 'alias');
    link(real, viaLink);
    const target = path.join(viaLink, '.lavagna', 'media', NAME);
    assert.deepStrictEqual(await inspectWriteTarget(target, viaLink), { kind: 'absent' });
  });
});

suite('createFileExclusive — the final write', () => {
  test('creates a new file and reports it', async () => {
    fs.mkdirSync(path.dirname(mediaFile()), { recursive: true });
    assert.strictEqual(await createFileExclusive(mediaFile(), new Uint8Array([1, 2, 3])), true);
    assert.deepStrictEqual([...fs.readFileSync(mediaFile())], [1, 2, 3]);
  });

  test('an existing file is left alone', async () => {
    fs.mkdirSync(path.dirname(mediaFile()), { recursive: true });
    fs.writeFileSync(mediaFile(), 'old');
    assert.strictEqual(await createFileExclusive(mediaFile(), new Uint8Array([1])), false);
    assert.strictEqual(fs.readFileSync(mediaFile(), 'utf8'), 'old');
  });

  test('a link planted at the name is refused, live or dangling, and its target untouched', async () => {
    fs.mkdirSync(path.dirname(mediaFile()), { recursive: true });
    const config = path.join(ws, 'config');
    fs.writeFileSync(config, '[core]\n');
    link(config, mediaFile());
    assert.strictEqual(await createFileExclusive(mediaFile(), new Uint8Array([1])), false);
    assert.strictEqual(fs.readFileSync(config, 'utf8'), '[core]\n');

    fs.rmSync(mediaFile());
    link(path.join(base, 'nowhere'), mediaFile());
    assert.strictEqual(await createFileExclusive(mediaFile(), new Uint8Array([1])), false);
    assert.strictEqual(fs.existsSync(path.join(base, 'nowhere')), false);
  });

  test('other failures are not swallowed', async () => {
    await assert.rejects(createFileExclusive(path.join(ws, 'missing-dir', 'x'), new Uint8Array([1])));
  });
});
