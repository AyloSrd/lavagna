import * as vscode from 'vscode';
import { parseBlocks } from '../../domain/blocks/parseBlocks';
import { KIND_LABEL, isEditableBlock } from '../selectors';

/** Command-link hover anywhere inside an editable block — for users who disable CodeLens. */
export class BlockHoverProvider implements vscode.HoverProvider {
  provideHover(doc: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const block = parseBlocks(doc.getText()).find(
      (b) =>
        isEditableBlock(b) &&
        position.line >= b.startLine &&
        position.line <= b.endLine,
    );
    if (!block) {
      return undefined;
    }
    // Uri travels as a string: command-link arguments are JSON, not live objects.
    const args = encodeURIComponent(
      JSON.stringify([doc.uri.toString(), { kind: block.kind, indexOfKind: block.indexOfKind }]),
    );
    const md = new vscode.MarkdownString(
      `[$(edit) Edit ${KIND_LABEL[block.kind]} visually](command:lavagna.editBlock?${args})`,
      true,
    );
    md.isTrusted = { enabledCommands: ['lavagna.editBlock'] };
    return new vscode.Hover(
      md,
      new vscode.Range(block.startLine, 0, block.endLine, doc.lineAt(block.endLine).text.length),
    );
  }
}
