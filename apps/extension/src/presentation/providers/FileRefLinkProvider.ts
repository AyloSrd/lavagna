import * as vscode from 'vscode';
import { parseFileRefTarget, RefLines } from '../../domain/references/fileRef';
import { isSafeRelativePath } from '../../domain/references/safePath';
import { log } from '../../infrastructure/logging/log';
import { isInsideWorkspace } from '../../infrastructure/paths/containment';

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

/** A `#L` range from a command argument: command URIs are as untrusted as the board they sit in. */
function isRefLines(value: unknown): value is RefLines {
  const v = value as Partial<RefLines> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isSafeInteger(v.start) &&
    Number.isSafeInteger(v.end) &&
    (v.start as number) >= 1 &&
    (v.end as number) >= (v.start as number)
  );
}

/**
 * `lavagna.openFileRef` — resolve the path and reveal the line range.
 *
 * Every argument is untrusted: a `command:` link can be invoked from any
 * markdown the user opens, with whatever arguments it was written with.
 */
export function registerOpenFileRef(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'lavagna.openFileRef',
    async (relPath: unknown, lines?: unknown, fromDoc?: unknown) => {
      if (typeof relPath !== 'string' || !isSafeRelativePath(relPath)) {
        vscode.window.showWarningMessage(
          `Lavagna: refusing to open "${String(relPath).slice(0, 200)}" — references must stay inside the workspace.`,
        );
        return;
      }
      if (fromDoc !== undefined && typeof fromDoc !== 'string') {
        log('openFileRef: refused, the owning document argument is not a string');
        return;
      }
      const target = await resolve(relPath, fromDoc);
      if (!target) {
        vscode.window.showWarningMessage(`Lavagna: could not find ${relPath} in the workspace.`);
        return;
      }
      const doc = await vscode.workspace.openTextDocument(target);
      const editor = await vscode.window.showTextDocument(doc);
      if (isRefLines(lines)) {
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
 * touch the filesystem for a candidate that has first been shown to live inside
 * the workspace: lexically, then (for a local folder) with symlinks resolved. A
 * committed symlink is otherwise indistinguishable from a genuine reference,
 * and a candidate on another host or drive must not even be `stat`ed — on
 * Windows that is an outbound SMB connection.
 */
async function resolve(relPath: string, fromDoc?: string): Promise<vscode.Uri | undefined> {
  const candidates: vscode.Uri[] = [];
  const owner = fromDoc !== undefined ? safeParseOwner(fromDoc) : activeDocumentUri();
  if (fromDoc !== undefined && !owner) {
    log('openFileRef: owning document is not a document of an open workspace folder — ignored');
  }
  if (owner) {
    candidates.push(vscode.Uri.joinPath(owner, '..', relPath));
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    candidates.push(vscode.Uri.joinPath(folder.uri, relPath));
  }
  for (const uri of candidates) {
    if (!(await isInsideWorkspace(uri))) {
      continue; // outside the workspace, lexically or after symlink resolution
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.Directory) {
        continue; // a directory is not openable as a document
      }
      return uri;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

/**
 * The URI a document link named as its owner, only if it can be one of ours: it
 * must carry the scheme and authority of an open workspace folder (an empty
 * authority for `file:`, so `file://host/share/…` never qualifies). Anything
 * else is dropped before it can be joined with a path and handed to the
 * filesystem.
 */
function safeParseOwner(value: string): vscode.Uri | undefined {
  let uri: vscode.Uri;
  try {
    uri = vscode.Uri.parse(value, true);
  } catch {
    return undefined;
  }
  return isOwnerUri(uri) ? uri : undefined;
}

function activeDocumentUri(): vscode.Uri | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  return uri && isOwnerUri(uri) ? uri : undefined;
}

function isOwnerUri(uri: vscode.Uri): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some(
    (folder) => folder.uri.scheme === uri.scheme && folder.uri.authority === uri.authority,
  );
}
