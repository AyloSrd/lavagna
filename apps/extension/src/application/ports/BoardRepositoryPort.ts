import { Board } from '../../domain/boards/board';

export interface BoardRepositoryPort {
  /** False when there is no workspace folder to host `.lavagna/`. */
  readonly isAvailable: boolean;
  /** Boards currently in `.lavagna/`; empty when the folder doesn't exist yet. */
  list(): Promise<Board[]>;
  /** Writes a new board file, creating `.lavagna/` lazily. */
  create(fileName: string, content: string): Promise<Board>;
  delete(fsPath: string): Promise<void>;
  existingFileNames(): Promise<string[]>;
}
