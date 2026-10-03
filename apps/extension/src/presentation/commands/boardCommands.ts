import * as path from 'path';
import * as vscode from 'vscode';
import { Board, isBoardFileName } from '../../domain/boards/board';
import { BoardRepositoryPort } from '../../application/ports/BoardRepositoryPort';
import { createBoard, deleteBoard } from '../../application/usecases/boards';
import { log } from '../../infrastructure/logging/log';
import { assertBoardFile } from '../../infrastructure/paths/boardPath';
import { isInsideWorkspace } from '../../infrastructure/paths/containment';
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
      // The argument is whatever the caller of the command passed, not
      // necessarily a tree item: `fsPath` is not trusted until it is shown to be
      // a real board file of this workspace.
      const root = vscode.workspace.workspaceFolders?.[0]?.uri; // the one boards are stored in
      const refuse = (reason: string) => {
        log(`deleteBoard: refused — ${reason}`);
        vscode.window.showErrorMessage(
          'Lavagna: refusing to delete — only a board file directly inside .lavagna/ of the workspace, and not a symbolic link, can be deleted.',
        );
      };
      if (!root || root.scheme !== 'file') {
        refuse('boards are only deleted from a local workspace folder');
        return;
      }
      let relative: string;
      try {
        relative = await assertBoardFile(board.fsPath, root.fsPath);
      } catch (error) {
        // Unreadable is as unverified as unsafe: either way, nothing is deleted.
        refuse(error instanceof Error ? error.message : String(error));
        return;
      }
      const pick = await vscode.window.showWarningMessage(
        `Delete "${board.name}" (${relative})? The file is moved to the trash.`,
        { modal: true },
        'Delete',
      );
      if (pick !== 'Delete') {
        return;
      }
      await deleteBoard(repo, { ...board, fsPath: path.join(root.fsPath, ...relative.split('/')) });
      tree.refresh();
    }),

    // Open a board as text, explicitly. The tree used to fire the built-in
    // `vscode.open`, which resolves editor associations — so a board whose name
    // matches a registered custom editor (Cursor claims `mcp*`, for one) opened
    // in that editor, or silently not at all. A board is always a markdown file;
    // `showTextDocument` bypasses associations and always lands in the text
    // editor. `lavagna.newBoard` already opens this way, so this just makes the
    // tree agree with it.
    //
    // The argument is whatever the caller supplied (a `command:` link can pass
    // `file://host/share/x`, which on Windows opens an SMB connection), so it
    // is checked — a `*.lavagna.md` really inside the workspace — before any
    // filesystem access.
    vscode.commands.registerCommand('lavagna.openBoard', async (uri?: unknown) => {
      if (
        !(uri instanceof vscode.Uri) ||
        !isBoardFileName(path.posix.basename(uri.path)) ||
        !(await isInsideWorkspace(uri))
      ) {
        log('openBoard: refused — not a board file inside the workspace');
        return;
      }
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand('lavagna.refreshBoards', () => tree.refresh()),
  ];
}
