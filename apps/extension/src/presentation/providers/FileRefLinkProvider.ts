import * as vscode from 'vscode';
import { parseFileRefTarget, RefLines } from '../../domain/references/fileRef';
import { isSafeRelativePath } from '../../domain/references/safePath';
import { isContainedIn, workspaceRoots } from '../../infrastructure/paths/containment';

// We claim every local-path markdown link and route the click through
// `openFileRef`, for two reasons:
//   1. The built-in markdown resolver treats a link target as relative to the
//      DOCUMENT's folder, but our references are workspace-root-relative — so a
//      board in `.lavagna/` linking `.lavagna/x.md` would resolve to
//      `.lavagna/.lavagna/x.md`. openFileRef resolves root-relative instead.
//   2. Native link-following only jumps to `#L` lines for .md targets; we make
//      it jump for code files too.
// Remote/scheme links and bare `#anchor`s are left to the built-in handling.

// The target inside a markdown link: `(<...>)` or `(...)`.
// `(` and `<`/`>` are excluded from the character classes on purpose. With `(`
// inside the class every `](` in the document started a match that ran to the
// next `)` (or EOF) and then backtracked one character at a time — quadratic.
// A 195 KB board of `](` blocked the extension host for ~11 s per pass, on
// every keystroke. Excluding `(` makes each match start O(1).
const LINK_TARGET = /\]\((<[^<>)]*>|[^()\s]*)\)/g;
/** Skip pathological documents outright rather than scanning them per keystroke. */
const MAX_SCAN_BYTES = 1_000_000;

/** A local file path, not `http:`/`mailto:`/… and not a bare in-doc anchor. */
function isLocalPath(path: string): boolean {
  return path.length > 0 && !/^[a-z][a-z0-9+.-]*:/i.test(path) && !path.startsWith('#');
}

export class FileRefLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(
    document: vscode.TextDocument,
    token?: vscode.CancellationToken,
  ): vscode.DocumentLink[] {
    const text = document.getText();
    if (text.length > MAX_SCAN_BYTES) {
      return [];
    }
    const links: vscode.DocumentLink[] = [];
    for (const m of text.matchAll(LINK_TARGET)) {
      if (token?.isCancellationRequested) {
        return links;
      }
      const raw = m[1];
      const parsed = parseFileRefTarget(raw);
      if (!parsed || !isLocalPath(parsed.path)) {
        continue;
      }
      // Range of the target text (m[1]) within the document.
      const targetStart = m.index + m[0].indexOf(raw);
      const range = new vscode.Range(
        document.positionAt(targetStart),
        document.positionAt(targetStart + raw.length),
      );
      // Pass the owning document so resolution can't key off whatever editor
      // happens to be active when the link is clicked.
      const args = encodeURIComponent(
        JSON.stringify([parsed.path, parsed.lines, document.uri.toString()]),
      );
      const link = new vscode.DocumentLink(range, vscode.Uri.parse(`command:lavagna.openFileRef?${args}`));
      link.tooltip = parsed.lines
        ? `Lavagna: open ${parsed.path} at line ${parsed.lines.start}`
        : `Lavagna: open ${parsed.path}`;
      links.push(link);
    }
    return links;
  }
}

/** `lavagna.openFileRef` — resolve the path and reveal the line range. */
export function registerOpenFileRef(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'lavagna.openFileRef',
    async (relPath: string, lines?: RefLines, fromDoc?: string) => {
      if (typeof relPath !== 'string' || !isSafeRelativePath(relPath)) {
        vscode.window.showWarningMessage(
          `Lavagna: refusing to open "${relPath}" — references must stay inside the workspace.`,
        );
        return;
      }
      const target = await resolve(relPath, fromDoc);
      if (!target) {
        vscode.window.showWarningMessage(`Lavagna: could not find ${relPath} in the workspace.`);
        return;
      }
      const doc = await vscode.workspace.openTextDocument(target);
      const editor = await vscode.window.showTextDocument(doc);
      if (lines) {
        // Reference lines are 1-based; editor positions are 0-based.
        const start = new vscode.Position(Math.max(0, lines.start - 1), 0);
        const endLine = Math.max(0, lines.end - 1);
        const end = new vscode.Position(endLine, doc.lineAt(Math.min(endLine, doc.lineCount - 1)).text.length);
        editor.selection = new vscode.Selection(start, end);
        editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
      }
    },
  );
}

/**
 * Resolve against the board's own folder, then each workspace root — and only
 * return a candidate that really lives inside the workspace once symlinks are
 * resolved. A committed symlink is otherwise indistinguishable from a genuine
 * reference.
 */
async function resolve(relPath: string, fromDoc?: string): Promise<vscode.Uri | undefined> {
  const candidates: vscode.Uri[] = [];
  const owner = fromDoc ? safeParse(fromDoc) : vscode.window.activeTextEditor?.document.uri;
  if (owner) {
    candidates.push(vscode.Uri.joinPath(owner, '..', relPath));
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    candidates.push(vscode.Uri.joinPath(folder.uri, relPath));
  }
  const roots = workspaceRoots();
  for (const uri of candidates) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.Directory) {
        continue; // a directory is not openable as a document
      }
      if (!(await isContainedIn(uri, roots))) {
        continue; // outside the workspace after symlink resolution
      }
      return uri;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function safeParse(value: string): vscode.Uri | undefined {
  try {
    return vscode.Uri.parse(value, true);
  } catch {
    return undefined;
  }
}
