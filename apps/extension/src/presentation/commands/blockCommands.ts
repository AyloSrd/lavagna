import * as vscode from 'vscode';
import { parseBlocks } from '../../domain/blocks/parseBlocks';
import { BlockRef, LavagnaBlock } from '../../domain/blocks/types';
import { log } from '../../infrastructure/logging/log';
import { isInsideWorkspace } from '../../infrastructure/paths/containment';
import { isEditableBlock } from '../selectors';
import { BLOCK_SNIPPETS } from '../blockSnippets';


/**
 * The document a command argument names, or undefined when it must not be
 * opened. The argument is whatever the caller supplied — a `command:` link can
 * pass `file://host/share/x`, which on Windows opens an SMB connection — so a
 * document that is not already open (CodeLens and hover name the active one)
 * is only opened when it really lies inside the workspace.
 */
async function openTrusted(uri: unknown): Promise<vscode.TextDocument | undefined> {
  let target: vscode.Uri | undefined;
  if (uri instanceof vscode.Uri) {
    target = uri;
  } else if (typeof uri === 'string') {
    try {
      target = vscode.Uri.parse(uri, true);
    } catch {
      target = undefined; // not a URI at all
    }
  }
  if (!target) {
    log('editBlock: refused — the document argument is not a URI');
    return undefined;
  }
  const key = target.toString();
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
  if (open) {
    return open; // already loaded: nothing to fetch from disk or the network
  }
  if (!(await isInsideWorkspace(target))) {
    log('editBlock: refused — the document is not inside the workspace');
    return undefined;
  }
  return vscode.workspace.openTextDocument(target);
}

/** Resolves the target block: explicit ref (CodeLens/hover) or the block at the cursor. */
async function resolveBlock(
  uri?: unknown,
  ref?: BlockRef,
): Promise<{ document: vscode.TextDocument; block: LavagnaBlock } | undefined> {
  const document = uri ? await openTrusted(uri) : vscode.window.activeTextEditor?.document;
  if (!document) {
    return undefined;
  }
  const blocks = parseBlocks(document.getText()).filter(isEditableBlock);
  const block = ref
    ? blocks.find((b) => b.kind === ref.kind && b.indexOfKind === ref.indexOfKind)
    : blocks.find((b) => {
        const line = vscode.window.activeTextEditor?.selection.active.line ?? -1;
        return line >= b.startLine && line <= b.endLine;
      });
  return block ? { document, block } : undefined;
}

export function registerBlockCommands(
  openBlockEditor?: (document: vscode.TextDocument, block: LavagnaBlock) => void,
): vscode.Disposable[] {
  // File Reference has its own command (a picker), so only bodied entries
  // become insertBlock.* commands.
  const disposables = BLOCK_SNIPPETS.filter(s => s.body).map(s =>
    vscode.commands.registerCommand(`lavagna.insertBlock.${s.key}`, () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        editor.insertSnippet(new vscode.SnippetString(s.body!));
      }
    }),
  );

  disposables.push(
    vscode.commands.registerCommand(
      'lavagna.editBlock',
      async (uri?: unknown, ref?: BlockRef) => {
        const target = await resolveBlock(uri, ref);
        if (!target) {
          vscode.window.showInformationMessage(
            'Lavagna: place the cursor inside a mermaid, tree, or canvas block.',
          );
          return;
        }
        if (openBlockEditor) {
          openBlockEditor(target.document, target.block);
          return;
        }
        // Interim behavior until the visual side editor ships: select the fence body.
        const editor = await vscode.window.showTextDocument(target.document);
        const { block } = target;
        const end =
          block.contentEndLine >= block.contentStartLine
            ? new vscode.Position(
                block.contentEndLine,
                target.document.lineAt(block.contentEndLine).text.length,
              )
            : new vscode.Position(block.contentStartLine, 0);
        editor.selection = new vscode.Selection(new vscode.Position(block.contentStartLine, 0), end);
        editor.revealRange(new vscode.Range(block.startLine, 0, block.endLine, 0));
      },
    ),
  );

  return disposables;
}
