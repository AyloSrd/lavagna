import { findUnusedMedia, isCleanableMediaName } from '../../domain/media/unusedMedia';
import { BoardRepositoryPort } from '../ports/BoardRepositoryPort';
import { MediaPort } from '../ports/MediaPort';

/**
 * Images in `.lavagna/media/` that no board in `.lavagna/` mentions. A board
 * that can't be read or listed fails the whole check — its links are unknown,
 * so no image can be called unused.
 */
export async function findUnusedMediaFiles(
  media: MediaPort,
  boards: BoardRepositoryPort,
): Promise<string[]> {
  const names = (await media.listFiles()).filter(isCleanableMediaName);
  if (names.length === 0) {
    return [];
  }
  const texts = await Promise.all((await boards.listAll()).map((board) => boards.readText(board)));
  return findUnusedMedia(names, texts);
}

export interface MediaCleanup {
  trashed: string[];
  failed: { name: string; reason: string }[];
}

/**
 * Move `confirmed` to the trash — but only the names that are still unused
 * now, since a board may have changed while the user was reading the prompt.
 */
export async function trashUnusedMedia(
  media: MediaPort,
  boards: BoardRepositoryPort,
  confirmed: readonly string[],
): Promise<MediaCleanup> {
  const stillUnused = new Set(await findUnusedMediaFiles(media, boards));
  const result: MediaCleanup = { trashed: [], failed: [] };
  for (const name of confirmed) {
    if (!stillUnused.has(name)) {
      continue;
    }
    try {
      await media.trash(name);
      result.trashed.push(name);
    } catch (error) {
      result.failed.push({ name, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
