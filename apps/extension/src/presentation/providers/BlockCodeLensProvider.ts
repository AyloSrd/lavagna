import * as vscode from 'vscode';
import { parseBlocks } from '../../domain/blocks/parseBlocks';
import { BlockRef } from '../../domain/blocks/types';
import { KIND_LABEL, isEditableBlock } from '../selectors';

/** "Edit <kind> · Lavagna" above the opening fence of each visually editable block. */
export class BlockCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    return parseBlocks(doc.getText())
      .filter(isEditableBlock)
      .map((b) => {
        const ref: BlockRef = { kind: b.kind, indexOfKind: b.indexOfKind };
        return new vscode.CodeLens(new vscode.Range(b.startLine, 0, b.startLine, 0), {
          title: `Edit ${KIND_LABEL[b.kind]} · Lavagna`,
          command: 'lavagna.editBlock',
          arguments: [doc.uri, ref],
        });
      });
  }
}
