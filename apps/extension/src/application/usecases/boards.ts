import {
  Board,
  BOARD_SUFFIX,
  boardFileName,
  boardTemplate,
  isBoardFileName,
  slugify,
  uniqueSlug,
} from '../../domain/boards/board';
import { BoardRepositoryPort } from '../ports/BoardRepositoryPort';

/** Creates a board with a collision-free slug. `.lavagna/` is created lazily by the repo. */
export async function createBoard(repo: BoardRepositoryPort, name: string): Promise<Board> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Board name must not be empty.');
  }
  const existingSlugs = (await repo.existingFileNames())
    .filter(isBoardFileName)
    .map((fileName) => fileName.slice(0, -BOARD_SUFFIX.length));
  const slug = uniqueSlug(slugify(trimmed), existingSlugs);
  return repo.create(boardFileName(slug), boardTemplate(trimmed));
}

export function listBoards(repo: BoardRepositoryPort): Promise<Board[]> {
  return repo.list();
}

export function deleteBoard(repo: BoardRepositoryPort, board: Board): Promise<void> {
  return repo.delete(board.fsPath);
}
