import * as fs from 'fs/promises';
import * as path from 'path';
import { isCleanableMediaName } from '../../domain/media/unusedMedia';
import { assertRealPathInside, ContainmentError } from './realPath';

// The one place that decides whether a file may be moved to the trash by
// "Clean unused media". Node only — no `vscode` import — so the unit tests run
// it against real temp folders and symlinks.
//
// The folder is part of the checkout: a repository can commit
// `.lavagna/media -> ~/Pictures`, or `media/a.png -> ~/.ssh/id_rsa`. Listing
// through the first would offer the user's own photos for deletion; trashing
// the second removes only the link, but nothing here should touch either.

export const MEDIA_DIR = ['.lavagna', 'media'];

/**
 * The absolute path of `.lavagna/media/` under `workspaceRoot`, or null when it
 * does not exist. Throws a ContainmentError when it — or `.lavagna` — is a
 * symbolic link or not a real folder.
 */
export async function realMediaDir(workspaceRoot: string): Promise<string | null> {
  const root = path.resolve(workspaceRoot);
  const dir = path.join(root, ...MEDIA_DIR);
  await assertRealPathInside(dir, root, { allowSymlinks: false });
  let stat;
  try {
    stat = await fs.lstat(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    throw new ContainmentError(`${dir} is not a folder`);
  }
  return dir;
}

/**
 * Throws a ContainmentError unless `name` is an image the cleanup may remove: a
 * single file name (no separators, not a dotfile), a regular file — not a link
 * — directly inside a real `.lavagna/media/`. Resolves with its absolute path.
 */
export async function assertMediaFile(name: unknown, workspaceRoot: string): Promise<string> {
  if (typeof name !== 'string' || !isCleanableMediaName(name) || name === '..') {
    throw new ContainmentError(`${String(name)} is not an image name in .lavagna/media`);
  }
  const dir = await realMediaDir(workspaceRoot);
  if (!dir) {
    throw new ContainmentError('.lavagna/media does not exist');
  }
  const target = path.join(dir, name);
  if (path.dirname(target) !== dir) {
    throw new ContainmentError(`${target} is not directly inside ${dir}`);
  }
  await assertRealPathInside(target, path.resolve(workspaceRoot), { allowSymlinks: false });
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    throw new ContainmentError(`${target} does not exist`);
  }
  if (!stat.isFile()) {
    throw new ContainmentError(`${target} is not a regular file`);
  }
  return target;
}
