import * as fs from 'fs/promises';
import * as path from 'path';
import { isBoardFileName } from '../../domain/boards/board';
import { assertRealPathInside, ContainmentError } from './realPath';

// The one place that decides whether a path handed to a delete command is
// really a board of this workspace. Node only — no `vscode` import — so the
// unit tests run it against real temp folders and symlinks.

const BOARDS_DIR = '.lavagna';

/**
 * Throws a ContainmentError unless `fsPath` is a board file the user could have
 * made with "New board": a regular file named `*.lavagna.md`, directly inside
 * `<workspaceRoot>/.lavagna/`, with no symlink anywhere on the way down from the
 * workspace root (a link there would make the delete — or the trash move —
 * land wherever it points). The command argument it checks is whatever the
 * caller of `lavagna.deleteBoard` supplied, not something the tree vouched for.
 *
 * Resolves with the path relative to the workspace root, `/`-separated, for
 * showing the user what is about to be deleted.
 */
export async function assertBoardFile(fsPath: unknown, workspaceRoot: string): Promise<string> {
  if (typeof fsPath !== 'string' || fsPath.length === 0 || fsPath.includes('\0')) {
    throw new ContainmentError('the board has no usable file path');
  }
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(fsPath);
  const relative = path.relative(root, target);
  const segments = relative.split(path.sep);
  if (
    path.isAbsolute(relative) ||
    segments.length !== 2 ||
    segments[0] !== BOARDS_DIR ||
    !isBoardFileName(segments[1])
  ) {
    throw new ContainmentError(`${target} is not a board file directly inside ${path.join(root, BOARDS_DIR)}`);
  }
  await assertRealPathInside(target, root, { allowSymlinks: false });
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    throw new ContainmentError(`${target} does not exist`);
  }
  if (!stat.isFile()) {
    throw new ContainmentError(`${target} is not a regular file`);
  }
  return segments.join('/');
}
