import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { isInsideOrEqual, resolveRealPath } from './realPath';

// Workspace containment for paths derived from board content. A string check
// alone is not enough: git can commit symlinks, so `docs/notes.md` may point at
// `~/.ssh/id_rsa` while containing no `..` and looking entirely ordinary. Only
// resolving the real path catches that.

/**
 * The real path, with symlinks resolved. A path that doesn't exist yet is
 * resolved through its nearest existing ancestor, so `link/new/file` with
 * `link -> /elsewhere` is `/elsewhere/new/file`. Undefined when that can't be
 * established (a dangling link on the way, an unreadable component): the
 * caller must treat it as not contained.
 */
async function realPathOf(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return await resolveRealPath(uri.fsPath);
  } catch {
    return undefined;
  }
}

/**
 * True when `uri` really lives inside one of `roots` after symlink resolution,
 * and carries no URI authority (a non-empty authority means a UNC/remote target).
 */
export async function isContainedIn(uri: vscode.Uri, roots: readonly vscode.Uri[]): Promise<boolean> {
  if (uri.scheme !== 'file' || uri.authority) {
    return false;
  }
  if (roots.length === 0) {
    return false;
  }
  const real = await realPathOf(uri);
  if (real === undefined) {
    return false;
  }
  for (const root of roots) {
    if (root.scheme !== 'file') {
      continue;
    }
    let rootReal: string;
    try {
      rootReal = await fs.realpath(root.fsPath);
    } catch {
      rootReal = path.resolve(root.fsPath);
    }
    if (isInsideOrEqual(real, rootReal)) {
      return true;
    }
  }
  return false;
}

/** The workspace folders, as containment roots. */
export function workspaceRoots(): vscode.Uri[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri);
}
