import * as vscode from 'vscode';
import { parseBlocks } from '../../domain/blocks/parseBlocks';
import { formatFileRef } from '../../domain/references/fileRef';
import { CopySourceTracker } from '../../infrastructure/references/CopySourceTracker';
import { log } from '../../infrastructure/logging/log';

/**
 * `lavagna.paste` — bound to Cmd+V inside boards.
 *
 * The paste API is the proper way to do this and it doesn't work everywhere:
 * Cursor registers a `DocumentPasteEditProvider` and then never calls it — not
 * `prepareDocumentPaste` on copy, not `provideDocumentPasteEdits` on paste
 * (confirmed from its own log, and its bundle has the machinery, so it simply
 * isn't reached). An extension cannot make a host consult a provider, so the
 * keystroke is taken directly instead.
 *
 * Scoped hard: the keybinding's `when` limits it to a focused editor on a
 * `*.lavagna.md` file, and anything this can't turn into a reference is handed
 * to the normal paste. Overriding Cmd+V is intrusive enough that it must never
 * be the reason a paste goes missing.
 */
export function registerBoardPaste(tracker: CopySourceTracker): vscode.Disposable {
  return vscode.commands.registerCommand('lavagna.paste', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return fallback();
    }
    const clipboard = await vscode.env.clipboard.readText();
    log(`Cmd+V in ${editor.document.uri.path} (${clipboard.length} chars on the clipboard)`);
    if (!clipboard) {
      return fallback(); // image or other non-text payload — not ours
    }
    if (isInsideFence(editor)) {
      log('  plain paste: cursor is inside a fenced block');
      return fallback();
    }
    if (!enabled()) {
      log('  plain paste: lavagna.pasteAsFileReference is off');
      return fallback();
    }
    const source = await tracker.resolve(clipboard);
    if (!source) {
      log('  plain paste: no tracked selection matched the clipboard');
      return fallback();
    }
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.toString();
    if (folder !== source.folder) {
      log(`  plain paste: folder mismatch — board=${folder} source=${source.folder}`);
      return fallback();
    }
    const text = formatFileRef(source.path, { start: source.start, end: source.end });
    log(`  inserting reference: ${text}`);
    // `$` and `}` are snippet syntax; a path containing either must not be read
    // as a tabstop.
    await editor.insertSnippet(
      new vscode.SnippetString(text.replace(/\$/g, '\\$').replace(/\}/g, '\\}')),
    );
  });
}

function fallback(): Thenable<unknown> {
  return vscode.commands.executeCommand('editor.action.clipboardPasteAction');
}

/**
 * `lavagna.pasteText` — the escape hatch from the reference default.
 *
 * `Cmd+V` inserts a reference when it can; this pastes the clipboard verbatim,
 * no matter what the tracker holds. Offered in the editor's right-click menu
 * rather than bound to a key: it's the occasional case, and a chord would just
 * be a worse version of the default everyone already knows.
 */
export function registerBoardPasteText(): vscode.Disposable {
  return vscode.commands.registerCommand('lavagna.pasteText', () => fallback());
}

function enabled(): boolean {
  return vscode.workspace.getConfiguration('lavagna').get<boolean>('pasteAsFileReference', true);
}

/** Reuses the block parser rather than guessing at fence boundaries. */
function isInsideFence(editor: vscode.TextEditor): boolean {
  const line = editor.selection.active.line;
  return parseBlocks(editor.document.getText()).some(
    (b) =>
      (b.kind === 'code' || b.kind === 'mermaid' || b.kind === 'tree') &&
      line > b.startLine &&
      line <= b.endLine,
  );
}
