import * as fs from 'fs/promises';
import { assertRealPathInside, ContainmentError } from './realPath';

// What stands at a path we are about to write a file to. Node only — no
// `vscode` import — so the unit tests can run it against real temp folders and
// real symlinks, like realPath.ts.

export type WriteTarget =
  /** Nothing there yet; safe to create. */
  | { kind: 'absent' }
  /** A regular file (not a link) already there. */
  | { kind: 'file'; size: number };

/**
 * Inspect `target` before writing it under `root`, on the local disk. Throws a
 * ContainmentError unless writing there would really land inside `root`:
 *
 * - no component between `root` and `target` — `target` itself included — is a
 *   symlink (a repository can commit `.lavagna -> ../..`, or the file itself as
 *   a link to `.git/config`; a write follows it), and the real path is inside
 *   the real root;
 * - if `target` exists it is a regular file. A directory, a FIFO or a device
 *   is refused rather than written to.
 *
 * Call it before creating the parent folders and again after: the first call
 * stops `mkdir` from following a link, the second proves what is there now.
 * It is still a check followed by a write, not one atomic step — closing that
 * gap needs an attacker already writing to the workspace concurrently.
 */
export async function inspectWriteTarget(target: string, root: string): Promise<WriteTarget> {
  await assertRealPathInside(target, root, { allowSymlinks: false });
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { kind: 'absent' };
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new ContainmentError(`${target} exists and is not a regular file`);
  }
  return { kind: 'file', size: stat.size };
}

/**
 * Create `target` with `bytes`, failing if anything — a file, a directory, a
 * symlink (dangling or not) — is already there: `O_CREAT | O_EXCL`, so the
 * final step cannot be redirected by a link planted after `inspectWriteTarget`.
 * Resolves true when the file was created, false when the name is taken.
 */
export async function createFileExclusive(target: string, bytes: Uint8Array): Promise<boolean> {
  try {
    await fs.writeFile(target, bytes, { flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}
