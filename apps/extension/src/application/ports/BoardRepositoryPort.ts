import { Board } from '../../domain/boards/board';

export interface BoardRepositoryPort {
  /** False when there is no workspace folder to host `.lavagna/`. */
  readonly isAvailable: boolean;
  /** Boards currently in `.lavagna/`; empty when the folder doesn't exist yet. */
  list(): Promise<Board[]>;
  /**
   * Every board, for a caller that must not miss one: like `list()`, but throws
   * when `.lavagna/` exists and can't be read, or holds a board file that is
   * not a plain file (a symlink, a folder).
   */
  listAll(): Promise<Board[]>;
  /** Writes a new board file, creating `.lavagna/` lazily. */
  create(fileName: string, content: string): Promise<Board>;
  delete(fsPath: string): Promise<void>;
  /** The board's text — what the editor holds when it is open, unsaved edits included. */
  readText(board: Board): Promise<string>;
  existingFileNames(): Promise<string[]>;
}
