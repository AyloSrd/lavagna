import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { EntryKind, SkillFilesPort } from '../../application/ports/SkillFilesPort';
import { InstalledSkill } from '../../domain/skills/installState';
import { assertSafeRelativePath } from '../../domain/skills/safeSegment';
import { InstallRoots, SkillFile } from '../../domain/skills/types';
import { log } from '../logging/log';
import { assertRealPathInside, ContainmentError, isStrictlyInside } from '../paths/realPath';

const SKILL_MD = 'SKILL.md';

/**
 * A SKILL.md is a page of markdown. Anything past this is not a skill we can
 * read a version out of, and reading it would stall the extension host — the
 * tree probes every agent × scope on each refresh.
 */
const MAX_SKILL_MD_BYTES = 1024 * 1024;

/**
 * Skill directories on the local disk, through `workspace.fs` so both scopes
 * take the same path. Global destinations hang off `os.homedir()`.
 *
 * Nothing here trusts its caller: `writeTree` and `deleteTree` refuse a
 * directory unless it is strictly inside the home folder or the workspace
 * folder — on disk, after resolving symlinks, not just as a string — and every
 * file path in a tree must be a plain relative path. Under the workspace no
 * symlink at all is accepted on the way down (a repository can commit
 * `.agents/skills -> ../..`); under the home folder a link is fine as long as
 * it resolves inside the real home. The domain validates the same things from the other side; this is the
 * assertion that holds even if a future catalogue reaches the port directly.
 */
export class VsCodeSkillFiles implements SkillFilesPort {
  private readonly _roots: InstallRoots;

  constructor(workspaceRoot: vscode.Uri | undefined, home: string = os.homedir()) {
    this._roots = {
      // A container or CI host can report no home at all; global scope is then
      // unavailable rather than resolving to `/`.
      home: home ? home : undefined,
      // A virtual workspace (`vscode-vfs://github/org/repo`) has an `fsPath`
      // that names a local path it has nothing to do with. Project scope is
      // simply not available there — see `capabilities.virtualWorkspaces`.
      workspaceRoot: workspaceRoot?.scheme === 'file' ? workspaceRoot.fsPath : undefined,
    };
  }

  roots(): InstallRoots {
    return this._roots;
  }

  withProjectRoot(root: string | undefined): SkillFilesPort {
    return new VsCodeSkillFiles(
      root === undefined ? undefined : vscode.Uri.file(root),
      this._roots.home ?? '',
    );
  }

  async entryKind(dir: string): Promise<EntryKind> {
    let stat: vscode.FileStat | undefined;
    try {
      stat = await vscode.workspace.fs.stat(vscode.Uri.file(dir));
    } catch (error) {
      // Only "not there" is absent — absent is the one kind written without a
      // question. A probe that failed for any other reason knows nothing.
      if (!isFileNotFound(error)) {
        return 'unreadable';
      }
    }
    // `type` is a bit field: a link to a directory is SymbolicLink|Directory,
    // and a dangling one is SymbolicLink|Unknown. Either way we never install
    // over it — the write would land wherever the link points.
    if (stat !== undefined && (stat.type & vscode.FileType.SymbolicLink) !== 0) {
      return 'symlink';
    }
    // The folder itself is fine; the path to it must be too — the same check
    // writeTree makes, asked up front so the user hears why, not a failure.
    try {
      await this._assertWritable(dir);
    } catch (error) {
      if (error instanceof ContainmentError) {
        return 'unsafe-path';
      }
      return 'unreadable';
    }
    if (stat === undefined) {
      return 'absent';
    }
    return (stat.type & vscode.FileType.Directory) !== 0 ? 'directory' : 'file';
  }

  async readSkillMd(skillDir: string): Promise<InstalledSkill> {
    const uri = vscode.Uri.joinPath(vscode.Uri.file(skillDir), SKILL_MD);
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      return { present: false };
    }
    if (stat.size > MAX_SKILL_MD_BYTES) {
      log(`skills: ${uri.fsPath} is ${stat.size} bytes — not read, state reads as unknown`);
      return { present: true };
    }
    try {
      return { present: true, skillMd: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)) };
    } catch {
      // Something is there but we can't read it — "unknown", never "absent".
      return { present: true };
    }
  }

  async writeTree(dir: string, files: readonly SkillFile[]): Promise<void> {
    await this._assertWritable(dir);
    // Validate the whole tree before deleting anything: a bad file path must
    // not cost the user the folder that was already there.
    for (const file of files) {
      assertSafeRelativePath(file.path, 'skill file path');
    }
    const root = vscode.Uri.file(dir);
    await this.deleteTree(dir);
    await vscode.workspace.fs.createDirectory(root);
    for (const file of files) {
      const segments = file.path.split('/');
      const parent = vscode.Uri.joinPath(root, ...segments.slice(0, -1));
      await vscode.workspace.fs.createDirectory(parent); // no-op when it already exists
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(parent, segments[segments.length - 1]), file.bytes);
    }
  }

  async deleteTree(dir: string): Promise<void> {
    const where = await this._assertWritable(dir);
    const uri = vscode.Uri.file(dir);
    // Project deletes go to the trash: that folder sits in the user's checkout,
    // next to their own files, and a mistake there should be recoverable.
    // Global skill dirs live outside any workspace, where the trash isn't
    // dependable, and the folder is a copy one click re-installs — so they are
    // deleted outright. A host with no trash at all (headless remote, some
    // containers) falls back to the same.
    if (where === 'workspace') {
      try {
        await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
        return;
      } catch (error) {
        if (isFileNotFound(error)) {
          return;
        }
        log(`skills: no trash for ${dir} (${describe(error)}); deleting it permanently`);
      }
    }
    try {
      await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
    } catch (error) {
      // Nothing there (including a link that lost its target) is not an error.
      if (isFileNotFound(error)) {
        return;
      }
      throw error;
    }
  }

  /**
   * `dir` must lie strictly inside one of the roots, and still does once
   * symlinks are resolved (see `assertRealPathInside`). Returns which root, so
   * the delete can pick its trash policy. Throws otherwise — this is the last
   * line between catalogue data, or a symlink a repository committed, and a
   * recursive delete.
   */
  private async _assertWritable(dir: string): Promise<'workspace' | 'home'> {
    const resolved = path.resolve(dir);
    const roots: ReadonlyArray<readonly ['workspace' | 'home', string | undefined]> = [
      ['workspace', this._roots.workspaceRoot],
      ['home', this._roots.home],
    ];
    for (const [kind, root] of roots) {
      if (!root || !isStrictlyInside(resolved, path.resolve(root))) {
        continue;
      }
      try {
        await assertRealPathInside(resolved, root, { allowSymlinks: kind === 'home' });
      } catch (error) {
        if (error instanceof ContainmentError) {
          throw new ContainmentError(`Refusing to modify ${resolved}: ${error.message}.`);
        }
        // Couldn't even look (EACCES on a component, …): refused all the same.
        throw new Error(`Refusing to modify ${resolved}: its path can't be inspected (${describe(error)}).`);
      }
      return kind;
    }
    throw new ContainmentError(
      `Refusing to modify ${resolved}: it is not inside the home folder or the workspace folder.`,
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFileNotFound(error: unknown): boolean {
  if (error instanceof vscode.FileSystemError) {
    return error.code === 'FileNotFound';
  }
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
