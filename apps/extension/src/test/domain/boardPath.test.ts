// `lavagna.deleteBoard` takes its argument from whoever invokes the command:
// the path must be shown to be a board file of this workspace before anything
// is moved to the trash.

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, suite, test } from 'vitest';
import { assertBoardFile } from '../../infrastructure/paths/boardPath';
import { ContainmentError } from '../../infrastructure/paths/realPath';

let base: string;
let ws: string;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lavagna-boardpath-')));
  ws = path.join(base, 'ws');
  fs.mkdirSync(path.join(ws, '.lavagna'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function board(...segments: string[]): string {
  const file = path.join(ws, ...segments);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Board\n');
  return file;
}

suite('assertBoardFile', () => {
  test('a board directly inside .lavagna/ is accepted, and its relative path returned', async () => {
    const file = board('.lavagna', 'ideas.lavagna.md');
    assert.strictEqual(await assertBoardFile(file, ws), '.lavagna/ideas.lavagna.md');
  });

  test('anything that is not a path string is refused', async () => {
    for (const value of [undefined, null, 42, {}, ['x'], '', '\0']) {
      await assert.rejects(assertBoardFile(value, ws), ContainmentError);
    }
  });

  test('a file outside .lavagna/ is refused, whatever its name', async () => {
    await assert.rejects(assertBoardFile(board('notes.lavagna.md'), ws), ContainmentError);
    await assert.rejects(assertBoardFile(board('docs', 'notes.lavagna.md'), ws), ContainmentError);
    await assert.rejects(assertBoardFile(board('.lavagna', 'sub', 'x.lavagna.md'), ws), ContainmentError);
    await assert.rejects(assertBoardFile(path.join(base, 'other.lavagna.md'), ws), ContainmentError);
    await assert.rejects(assertBoardFile(path.join(ws, '..', 'ws2', '.lavagna', 'x.lavagna.md'), ws), ContainmentError);
  });

  test('a file in .lavagna/ that is not named like a board is refused', async () => {
    await assert.rejects(assertBoardFile(board('.lavagna', 'config.json'), ws), ContainmentError);
    await assert.rejects(assertBoardFile(board('.lavagna', 'notes.md'), ws), ContainmentError);
    await assert.rejects(assertBoardFile(board('.lavagna', '.lavagna.md'), ws), ContainmentError);
  });

  test('a traversal that lands back on a board is normalised, one that leaves is refused', async () => {
    const file = board('.lavagna', 'a.lavagna.md');
    assert.strictEqual(await assertBoardFile(path.join(ws, '.lavagna', '..', '.lavagna', 'a.lavagna.md'), ws), '.lavagna/a.lavagna.md');
    await assert.rejects(assertBoardFile(path.join(path.dirname(file), '..', '..', 'x.lavagna.md'), ws), ContainmentError);
  });

  test('a board that is a symlink is refused, and what it points at survives', async () => {
    const victim = path.join(base, 'precious.txt');
    fs.writeFileSync(victim, 'keep');
    const file = path.join(ws, '.lavagna', 'evil.lavagna.md');
    fs.symlinkSync(victim, file);
    await assert.rejects(assertBoardFile(file, ws), ContainmentError);
    assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'keep');
  });

  test('.lavagna itself a symlink is refused', async () => {
    fs.rmSync(path.join(ws, '.lavagna'), { recursive: true });
    const outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'x.lavagna.md'), '#\n');
    fs.symlinkSync(outside, path.join(ws, '.lavagna'), 'junction');
    await assert.rejects(assertBoardFile(path.join(ws, '.lavagna', 'x.lavagna.md'), ws), ContainmentError);
  });

  test('a missing file and a folder named like a board are refused', async () => {
    await assert.rejects(assertBoardFile(path.join(ws, '.lavagna', 'gone.lavagna.md'), ws), ContainmentError);
    fs.mkdirSync(path.join(ws, '.lavagna', 'dir.lavagna.md'));
    await assert.rejects(assertBoardFile(path.join(ws, '.lavagna', 'dir.lavagna.md'), ws), ContainmentError);
  });
});
