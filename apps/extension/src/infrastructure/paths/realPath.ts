import * as fs from 'fs/promises';
import * as path from 'path';

// Real-path containment on the local disk. Node only — no `vscode` import — so
// the unit tests can exercise it against real temp folders and symlinks.
//
// A string check on the path is not enough: git can commit a symlink, so
// `.agents/skills` may be a link to `../..` while the path looks entirely
// ordinary. Only resolving what is actually on disk catches that.

/** Thrown when a path does not really live where it claims to. */
export class ContainmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContainmentError';
  }
}

/** True when `child` is strictly below `parent` (never equal). Both absolute. */
export function isStrictlyInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** True when `child` is `parent` or below it. Both absolute. */
export function isInsideOrEqual(child: string, parent: string): boolean {
  return path.relative(parent, child) === '' || isStrictlyInside(child, parent);
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * The real path of `p`, with every symlink resolved. For a path that does not
 * exist yet, walks up to the nearest ancestor that does, resolves that, and
 * appends the missing names — so `link/new/dir` with `link -> /elsewhere`
 * resolves to `/elsewhere/new/dir`, not to something that looks contained.
 *
 * Throws a ContainmentError when a component on the way is a symlink whose
 * target is missing (writing through it would create the target, wherever it
 * points), and rethrows any error other than "not there" — a path that can't
 * be inspected is never assumed to be harmless.
 */
export async function resolveRealPath(p: string): Promise<string> {
  let current = path.resolve(p);
  const missing: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return missing.length === 0 ? real : path.join(real, ...missing.reverse());
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
    // realpath says "not there" — but a dangling symlink exists as a link.
    let linkExists = false;
    try {
      await fs.lstat(current);
      linkExists = true;
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
    if (linkExists) {
      throw new ContainmentError(`${current} is a symbolic link whose target does not exist`);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      // Not even the filesystem root resolved — nothing here is trustworthy.
      throw new ContainmentError(`${p} has no existing ancestor`);
    }
    missing.push(path.basename(current));
    current = parent;
  }
}

export interface ContainmentOptions {
  /**
   * Whether an existing symlink between `root` and `target` is acceptable as
   * long as it resolves inside `root`. False for a workspace — any link there
   * came from the repository. True for the home folder, where a dotfile
   * manager linking `~/.claude` into `~/dotfiles` is ordinary.
   */
  allowSymlinks: boolean;
}

/**
 * Throws a ContainmentError unless modifying `target` really stays strictly
 * inside `root` on disk:
 *
 * - lexically, `target` is below `root`;
 * - the real path of `target`'s parent (its nearest existing ancestor, walking
 *   up), plus `target`'s own name, is strictly inside the real path of `root` —
 *   so a symlinked root (a home under `/home -> /data/home`, macOS `/var`) is
 *   compared real path to real path. The parent, not `target` itself: deleting
 *   or replacing a link removes the link, not what it points at;
 * - unless `allowSymlinks`, no existing component below `root`, down to and
 *   including `target`, is a symlink at all.
 */
export async function assertRealPathInside(
  target: string,
  root: string,
  options: ContainmentOptions,
): Promise<void> {
  const lexicalRoot = path.resolve(root);
  const lexicalTarget = path.resolve(target);
  if (!isStrictlyInside(lexicalTarget, lexicalRoot)) {
    throw new ContainmentError(`${lexicalTarget} is not inside ${lexicalRoot}`);
  }

  if (!options.allowSymlinks) {
    let current = lexicalRoot;
    for (const segment of path.relative(lexicalRoot, lexicalTarget).split(path.sep)) {
      current = path.join(current, segment);
      let stat;
      try {
        stat = await fs.lstat(current);
      } catch (error) {
        if (isMissing(error)) {
          break; // nothing below this exists yet, so no link either
        }
        throw error;
      }
      if (stat.isSymbolicLink()) {
        throw new ContainmentError(`${current} is a symbolic link`);
      }
    }
  }

  let rootReal: string;
  try {
    rootReal = await fs.realpath(lexicalRoot);
  } catch {
    throw new ContainmentError(`${lexicalRoot} can't be resolved`);
  }
  const effective = path.join(await resolveRealPath(path.dirname(lexicalTarget)), path.basename(lexicalTarget));
  if (!isStrictlyInside(effective, rootReal)) {
    throw new ContainmentError(`${lexicalTarget} resolves to ${effective}, outside ${rootReal}`);
  }
}
