import * as vscode from 'vscode';
import {
  Board,
  BOARD_SUFFIX,
  boardNameFromFileName,
  isBoardFileName,
} from '../../domain/boards/board';
import { BoardRepositoryPort } from '../../application/ports/BoardRepositoryPort';
import { log } from '../logging/log';
import { ContainmentError } from '../paths/realPath';
import { createFileExclusive, inspectWriteTarget } from '../paths/writeTarget';

const BOARDS_DIR = '.lavagna';

/** Stores boards as `<slug>.lavagna.md` files in `.lavagna/` at the workspace root. */
export class VsCodeBoardRepository implements BoardRepositoryPort {
  readonly isAvailable = true;

  constructor(private readonly _workspaceRoot: vscode.Uri) {}

  private get _dir(): vscode.Uri {
    return vscode.Uri.joinPath(this._workspaceRoot, BOARDS_DIR);
  }

  async list(): Promise<Board[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(this._dir);
    } catch {
      return []; // `.lavagna/` doesn't exist yet — created lazily on first board.
    }
    const boards = await Promise.all(
      entries
        .filter(([name, type]) => type === vscode.FileType.File && isBoardFileName(name))
        .map(async ([name]) => {
          let modifiedAt: number | undefined;
          try {
            modifiedAt = (await vscode.workspace.fs.stat(this._fileUri(name))).mtime;
          } catch {
            // stat is best-effort; the board is still listed.
          }
          return this._toBoard(name, modifiedAt);
        }),
    );
    return boards.sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(fileName: string, content: string): Promise<Board> {
    const bytes = new TextEncoder().encode(content);
    if (this._workspaceRoot.scheme === 'file') {
      await this._createLocal(fileName, bytes);
    } else {
      await vscode.workspace.fs.createDirectory(this._dir);
      await vscode.workspace.fs.writeFile(this._fileUri(fileName), bytes);
    }
    return this._toBoard(fileName, Date.now());
  }

  /**
   * On the local disk a repository can commit `.lavagna -> ../..` (or the board
   * file itself as a link), and a write follows it. So: no symlink from the
   * workspace root down to the new file, before and after `mkdir`, and the file
   * itself is created exclusively (`wx`) so a link planted in between is refused.
   */
  private async _createLocal(fileName: string, bytes: Uint8Array): Promise<void> {
    const root = this._workspaceRoot.fsPath;
    const target = this._fileUri(fileName).fsPath;
    const refuse = (error: unknown): never => {
      if (error instanceof ContainmentError) {
        log(`boards: ${error.message}`);
        throw new Error(
          'Lavagna: refusing to create the board — .lavagna must be a real folder inside the workspace, with no symbolic links.',
        );
      }
      throw error;
    };
    const taken = () =>
      new Error(`Lavagna: ${BOARDS_DIR}/${fileName} already exists — try another name.`);
    try {
      if ((await inspectWriteTarget(target, root)).kind === 'file') {
        throw taken();
      }
      await vscode.workspace.fs.createDirectory(this._dir);
      if ((await inspectWriteTarget(target, root)).kind === 'file') {
        throw taken();
      }
      if (!(await createFileExclusive(target, bytes))) {
        throw taken();
      }
    } catch (error) {
      refuse(error);
    }
  }

  async delete(fsPath: string): Promise<void> {
    await vscode.workspace.fs.delete(vscode.Uri.file(fsPath), { useTrash: true });
  }

  async existingFileNames(): Promise<string[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(this._dir);
      return entries.map(([name]) => name);
    } catch {
      return [];
    }
  }

  private _fileUri(fileName: string): vscode.Uri {
    return vscode.Uri.joinPath(this._dir, fileName);
  }

  private _toBoard(fileName: string, modifiedAt?: number): Board {
    return {
      name: boardNameFromFileName(fileName),
      slug: fileName.slice(0, -BOARD_SUFFIX.length),
      fsPath: this._fileUri(fileName).fsPath,
      modifiedAt,
    };
  }
}
