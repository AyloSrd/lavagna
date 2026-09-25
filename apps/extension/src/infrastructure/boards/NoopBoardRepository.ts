import { Board } from '../../domain/boards/board';
import { BoardRepositoryPort } from '../../application/ports/BoardRepositoryPort';

/** Used when no workspace folder is open — boards need a folder to live in. */
export class NoopBoardRepository implements BoardRepositoryPort {
  readonly isAvailable = false;

  async list(): Promise<Board[]> {
    return [];
  }

  async create(): Promise<Board> {
    throw new Error('Open a folder to create Lavagna boards.');
  }

  async delete(): Promise<void> {
    // nothing to delete
  }

  async existingFileNames(): Promise<string[]> {
    return [];
  }
}
