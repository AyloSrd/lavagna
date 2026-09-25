import * as vscode from 'vscode';
import { Board } from '../../domain/boards/board';
import { BoardRepositoryPort } from '../../application/ports/BoardRepositoryPort';
import { listBoards } from '../../application/usecases/boards';

/** Flat list of all boards in `.lavagna/`, shown in the Lavagna activity-bar view. */
export class BoardsTreeProvider implements vscode.TreeDataProvider<Board> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly _repo: BoardRepositoryPort) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(board: Board): vscode.TreeItem {
    const uri = vscode.Uri.file(board.fsPath);
    const item = new vscode.TreeItem(board.name, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = uri;
    item.contextValue = 'lavagnaBoard';
    item.tooltip = board.fsPath;
    // Our own command, not `vscode.open`: the latter honours editor
    // associations and a board named to match a custom editor (e.g. Cursor's
    // `mcp`) would open there instead of as text. See lavagna.openBoard.
    item.command = { command: 'lavagna.openBoard', title: 'Open Board', arguments: [uri] };
    return item;
  }

  getChildren(element?: Board): Promise<Board[]> {
    return element ? Promise.resolve([]) : listBoards(this._repo);
  }
}
