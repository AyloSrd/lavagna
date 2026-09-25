import * as vscode from 'vscode';
import { parseBlocks } from '../../domain/blocks/parseBlocks';
import { BLOCK_SNIPPETS } from '../blockSnippets';

// Notion-style `/` menu. Implemented as a CompletionItemProvider rather than a
// custom widget, which gives filter-as-you-type, arrow keys, Enter to accept,
// and dismissal on Esc or blur natively — none of that needs writing, and it
// matches how the editor behaves everywhere else.

/**
 * The menu opens on a `/` that starts a word — i.e. at the start of the line or
 * directly after whitespace — anywhere in the line. Requiring whitespace (rather
 * than allowing any position) is what keeps it from firing inside `src/foo`,
 * `https://…`, `12/25`, or "and/or", where the `/` follows a non-space.
 */
function slashRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | null {
  const before = document.lineAt(position.line).text.slice(0, position.character);
  const m = /(?:^|\s)\/([A-Za-z]*)$/.exec(before);
  if (!m) {
    return null;
  }
  // m[0] may include the preceding whitespace character; the range must cover
  // only the `/` and what has been typed after it.
  const slashOffset = before.length - (m[1].length + 1);
  return new vscode.Range(new vscode.Position(position.line, slashOffset), position);
}

/** Inside a fenced block, `/` is content — never a menu. */
function insideFence(document: vscode.TextDocument, line: number): boolean {
  return parseBlocks(document.getText()).some(
    (b) => b.language !== null && line > b.startLine && line <= b.endLine,
  );
}

export class SlashMenuProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const range = slashRange(document, position);
    if (!range || insideFence(document, position.line)) {
      return undefined;
    }

    return BLOCK_SNIPPETS.map((snippet, i) => {
      const item = new vscode.CompletionItem(
        { label: `/${snippet.label}`, description: 'Lavagna' },
        snippet.body ? vscode.CompletionItemKind.Snippet : vscode.CompletionItemKind.Reference,
      );
      item.detail = snippet.detail;
      // Replacing `range` swallows the typed `/` along with any filter text.
      item.range = range;
      // Filtering matches against the typed text, which includes the slash.
      item.filterText = `/${snippet.label}`;
      item.sortText = String(i).padStart(2, '0'); // keep the authored order
      if (snippet.body) {
        item.insertText = new vscode.SnippetString(snippet.body);
      } else {
        item.insertText = '';
        item.command = { command: snippet.command!, title: snippet.label };
      }
      return item;
    });
  }
}
