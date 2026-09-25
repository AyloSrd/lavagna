import * as vscode from 'vscode';
import {
  CopySource,
  MAX_TRACKED_TEXT,
  findCopySource,
  remember,
  sameText,
} from '../../domain/references/copySource';
import { log } from '../logging/log';

/**
 * Remembers recent selections so a paste can name the file it came from even
 * when the host never called `prepareDocumentPaste`.
 *
 * Selections are the only signal available: there's no API for "the user
 * copied". Recording every non-empty one is cheap, and a lookup only succeeds
 * on an exact text match, so extra entries cost nothing but a few keys.
 */
export class CopySourceTracker {
  private entries: CopySource[] = [];

  register(): vscode.Disposable {
    return vscode.window.onDidChangeTextEditorSelection((e) => this.record(e));
  }

  private record(e: vscode.TextEditorSelectionChangeEvent): void {
    const doc = e.textEditor.document;
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    // Same scope rule as the paste provider: a reference is workspace-relative,
    // so a source outside the workspace can't be described by one.
    if (doc.uri.scheme !== 'file' || !folder) {
      return;
    }
    const selections = e.selections.filter((s) => !s.isEmpty);
    if (selections.length === 0) {
      return;
    }
    const first = selections[0];
    const last = selections[selections.length - 1];
    const span = new vscode.Range(first.start, last.end);
    const text = doc.getText(span);
    if (!text.trim() || text.length > MAX_TRACKED_TEXT) {
      return;
    }
    this.entries = remember(this.entries, {
      path: vscode.workspace.asRelativePath(doc.uri, false),
      folder: folder.uri.toString(),
      start: span.start.line + 1,
      end: span.end.line + 1,
      text,
    });
  }

  /**
   * The source of `clipboard`, or null.
   *
   * A text match alone isn't trusted: the file is re-read and the range checked
   * to still hold that text, so an edit (or a delete) since the copy produces no
   * source rather than a reference pointing at the wrong lines.
   */
  async resolve(clipboard: string): Promise<CopySource | null> {
    const candidate = findCopySource(this.entries, clipboard);
    log(`  tracker: ${this.entries.length} selection(s) remembered, clipboard ${clipboard.length} chars -> ${candidate ? 'MATCH ' + candidate.path : 'no match'}`);
    if (!candidate) {
      return null;
    }
    const folderUri = vscode.Uri.parse(candidate.folder);
    const uri = vscode.Uri.joinPath(folderUri, candidate.path);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const endLine = candidate.end - 1;
      if (endLine >= doc.lineCount) {
        return null;
      }
      const current = doc.getText(
        new vscode.Range(
          new vscode.Position(candidate.start - 1, 0),
          new vscode.Position(endLine, doc.lineAt(endLine).text.length),
        ),
      );
      // The remembered selection may have started mid-line, so the re-read is
      // line-wide and only has to *contain* the text.
      const ok = sameText(current, clipboard) || current.includes(clipboard.replace(/\r\n/g, '\n'));
      if (!ok) {
        log('  tracker: file no longer holds that text at those lines');
      }
      return ok ? candidate : null;
    } catch {
      log('  tracker: source file unreadable');
      return null; // moved, deleted, unreadable
    }
  }
}
