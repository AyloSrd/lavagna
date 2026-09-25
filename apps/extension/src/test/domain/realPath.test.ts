// The real-path containment behind every skill write and delete, against real
// temp folders and real symlinks. Node only: the helper deliberately imports
// no `vscode`, so the one check that stands between a committed
// `.agents/skills -> ../..` and a recursive delete runs on every `pnpm check`.

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, suite, test } from 'vitest';
import {
  assertRealPathInside,
  ContainmentError,
  isInsideOrEqual,
  isStrictlyInside,
  resolveRealPath,
} from '../../infrastructure/paths/realPath';

let base: string;

beforeEach(() => {
  // realpath: macOS hands out /var/… for /private/var/….
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lavagna-realpath-')));
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function mkdir(...segments: string[]): string {
  const dir = path.join(base, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A directory link at `at` pointing at `target` (relative to the link's folder, like `ln -s`). */
function link(target: string, at: string): void {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  // Junctions need no privilege on Windows but want an absolute target; the
  // type is ignored elsewhere, where the relative target is kept as written.
  const resolvedTarget = process.platform === 'win32' ? path.resolve(path.dirname(at), target) : target;
  fs.symlinkSync(resolvedTarget, at, 'junction');
}

async function refused(target: string, root: string, allowSymlinks: boolean): Promise<void> {
  await assert.rejects(assertRealPathInside(target, root, { allowSymlinks }), ContainmentError);
}

suite('real-path containment — workspace (no symlinks allowed)', () => {
  test('an ordinary destination, existing or not, is accepted', async () => {
    const ws = mkdir('ws');
    await assertRealPathInside(path.join(ws, '.agents/skills/lavagna'), ws, { allowSymlinks: false });
    mkdir('ws', '.claude', 'skills', 'lavagna');
    await assertRealPathInside(path.join(ws, '.claude/skills/lavagna'), ws, { allowSymlinks: false });
  });

  test('a committed .agents/skills -> ../outside is refused', async () => {
    const ws = mkdir('ws');
    const outside = mkdir('outside');
    link('../../outside', path.join(ws, '.agents/skills'));
    const dest = path.join(ws, '.agents/skills/lavagna');

    await refused(dest, ws, false);
    // Even if symlinks were allowed, it resolves outside the workspace.
    await refused(dest, ws, true);
    assert.deepStrictEqual(fs.readdirSync(outside), []);
  });

  test("the audit's .agents/skills -> ../.. is refused", async () => {
    const ws = mkdir('ws');
    link('../..', path.join(ws, '.agents/skills'));
    await refused(path.join(ws, '.agents/skills/lavagna'), ws, false);
    await refused(path.join(ws, '.agents/skills/lavagna'), ws, true);
  });

  test('a symlink that stays inside the workspace is still refused', async () => {
    const ws = mkdir('ws');
    mkdir('ws', 'elsewhere');
    link('elsewhere', path.join(ws, '.claude'));
    await refused(path.join(ws, '.claude/skills/lavagna'), ws, false);
  });

  test('a symlink as the destination itself is refused', async () => {
    const ws = mkdir('ws');
    mkdir('ws', 'mine');
    link('../../mine', path.join(ws, '.claude/skills/lavagna'));
    await refused(path.join(ws, '.claude/skills/lavagna'), ws, false);
  });

  test('a dangling link on the way is refused — writing through it would create its target', async () => {
    const ws = mkdir('ws');
    link('../gone', path.join(ws, '.claude'));
    await refused(path.join(ws, '.claude/skills/lavagna'), ws, false);
    await refused(path.join(ws, '.claude/skills/lavagna'), ws, true);
    assert.strictEqual(fs.existsSync(path.join(base, 'gone')), false);
  });

  test('a workspace opened through a symlink is fine: only what is below the root counts', async () => {
    mkdir('real-ws');
    link('real-ws', path.join(base, 'ws-link'));
    const ws = path.join(base, 'ws-link');
    await assertRealPathInside(path.join(ws, '.claude/skills/lavagna'), ws, { allowSymlinks: false });
  });

  test('the root itself, and anything lexically outside it, is refused', async () => {
    const ws = mkdir('ws');
    await refused(ws, ws, false);
    await refused(path.join(ws, '..', 'ws-sibling', 'x'), ws, false);
    await refused(path.join(base, 'ws-sibling'), ws, true);
  });
});

suite('real-path containment — home (symlinks resolving inside it allowed)', () => {
  test('a home that is itself a symlink compares real path to real path', async () => {
    mkdir('data', 'me');
    link('data/me', path.join(base, 'home-me'));
    const home = path.join(base, 'home-me');
    await assertRealPathInside(path.join(home, '.claude/skills/lavagna'), home, { allowSymlinks: true });
    await assertRealPathInside(path.join(home, '.claude/skills/lavagna'), home, { allowSymlinks: false });
  });

  test('a dotfile-managed ~/.claude linked inside home is accepted', async () => {
    const home = mkdir('home');
    mkdir('home', 'dotfiles', 'claude');
    link('dotfiles/claude', path.join(home, '.claude'));
    await assertRealPathInside(path.join(home, '.claude/skills/lavagna'), home, { allowSymlinks: true });
  });

  test('a ~/.claude linked outside home is refused', async () => {
    const home = mkdir('home');
    mkdir('elsewhere');
    link('../elsewhere', path.join(home, '.claude'));
    await refused(path.join(home, '.claude/skills/lavagna'), home, true);
  });

  test('a link at the destination itself is judged by where the link sits, not where it points', async () => {
    // Deleting a link removes the link: only its folder has to be inside.
    const home = mkdir('home');
    mkdir('outside');
    link('../../../outside', path.join(home, '.claude/skills/lavagna'));
    await assertRealPathInside(path.join(home, '.claude/skills/lavagna'), home, { allowSymlinks: true });
  });
});

suite('real-path resolution', () => {
  test('a path that does not exist resolves through its nearest existing ancestor', async () => {
    const elsewhere = mkdir('elsewhere');
    link('elsewhere', path.join(base, 'link'));
    // Not just the immediate parent: `new/dir` are both missing.
    assert.strictEqual(
      await resolveRealPath(path.join(base, 'link', 'new', 'dir')),
      path.join(elsewhere, 'new', 'dir'),
    );
    assert.strictEqual(await resolveRealPath(path.join(base, 'plain', 'new')), path.join(base, 'plain', 'new'));
  });

  test('a dangling link anywhere on the way throws', async () => {
    link('gone', path.join(base, 'dangling'));
    await assert.rejects(resolveRealPath(path.join(base, 'dangling', 'x', 'y')), ContainmentError);
    await assert.rejects(resolveRealPath(path.join(base, 'dangling')), ContainmentError);
  });

  test('inside checks are segment-wise, not prefix-wise', () => {
    const root = path.join(base, 'ws');
    assert.strictEqual(isStrictlyInside(path.join(base, 'ws', 'a'), root), true);
    assert.strictEqual(isStrictlyInside(root, root), false);
    assert.strictEqual(isStrictlyInside(path.join(base, 'ws-evil', 'a'), root), false);
    assert.strictEqual(isStrictlyInside(path.join(base, 'ws', '..foo'), root), true);
    assert.strictEqual(isInsideOrEqual(root, root), true);
    assert.strictEqual(isInsideOrEqual(base, root), false);
  });
});
