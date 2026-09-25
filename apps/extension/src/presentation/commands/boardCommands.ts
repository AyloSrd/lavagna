import * as vscode from 'vscode';
import { Board } from '../../domain/boards/board';
import { BoardRepositoryPort } from '../../application/ports/BoardRepositoryPort';
import { createBoard, deleteBoard } from '../../application/usecases/boards';
import { BoardsTreeProvider } from '../providers/BoardsTreeProvider';

export function registerBoardCommands(
  repo: BoardRepositoryPort,
  tree: BoardsTreeProvider,
  /** Runs after a board is created and opened; failures are the callee's to report. */
  onBoardCreated?: (board: Board) => void,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('lavagna.newBoard', async () => {
      if (!repo.isAvailable) {
        vscode.window.showErrorMessage('Lavagna: open a folder to create boards.');
        return;
      }
      const name = await vscode.window.showInputBox({
        prompt: 'Board name',
        placeHolder: 'e.g. Release ideas',
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim() ? undefined : 'Enter a name'),
      });
      if (!name) {
        return;
      }
      const board = await createBoard(repo, name);
      tree.refresh();
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(board.fsPath));
      await vscode.window.showTextDocument(doc);
      onBoardCreated?.(board);
    }),

    vscode.commands.registerCommand('lavagna.deleteBoard', async (board?: Board) => {
      if (!board) {
        return; // only invokable from the tree item context
      }
      const pick = await vscode.window.showWarningMessage(
        `Delete "${board.name}"? The file is moved to the trash.`,
        { modal: true },
        'Delete',
      );
      if (pick !== 'Delete') {
        return;
      }
      await deleteBoard(repo, board);
      tree.refresh();
    }),

    // Open a board as text, explicitly. The tree used to fire the built-in
    // `vscode.open`, which resolves editor associations — so a board whose name
    // matches a registered custom editor (Cursor claims `mcp*`, for one) opened
    // in that editor, or silently not at all. A board is always a markdown file;
    // `showTextDocument` bypasses associations and always lands in the text
    // editor. `lavagna.newBoard` already opens this way, so this just makes the
    // tree agree with it.
    vscode.commands.registerCommand('lavagna.openBoard', async (uri: vscode.Uri) => {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand('lavagna.refreshBoards', () => tree.refresh()),
  ];
}
