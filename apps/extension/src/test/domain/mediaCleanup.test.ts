import * as assert from 'assert';
import { suite, test } from 'vitest';
import { BoardRepositoryPort } from '../../application/ports/BoardRepositoryPort';
import { MediaPort } from '../../application/ports/MediaPort';
import { findUnusedMediaFiles, trashUnusedMedia } from '../../application/usecases/media';
import { Board } from '../../domain/boards/board';

function fakeMedia(files: string[], failing: string[] = []): MediaPort & { trashed: string[] } {
  const trashed: string[] = [];
  return {
    isAvailable: true,
    trashed,
    save: async () => '',
    listFiles: async () => files.filter((f) => !trashed.includes(f)),
    trash: async (name) => {
      if (failing.includes(name)) {
        throw new Error('locked');
      }
      trashed.push(name);
    },
  };
}

function fakeBoards(texts: Record<string, string>, unreadable: string[] = []): BoardRepositoryPort & { texts: Record<string, string> } {
  const repo = {
    isAvailable: true,
    texts,
    list: async (): Promise<Board[]> => repo.listAll(),
    listAll: async (): Promise<Board[]> => Object.keys(repo.texts).map((slug) => ({ name: slug, slug, fsPath: `/ws/.lavagna/${slug}.lavagna.md` })),
    create: async () => { throw new Error('unused'); },
    delete: async () => {},
    existingFileNames: async () => [],
    readText: async (board: Board) => {
      if (unreadable.includes(board.slug)) {
        throw new Error('EACCES');
      }
      return repo.texts[board.slug];
    },
  };
  return repo;
}

suite('findUnusedMediaFiles', () => {
  test('lists images no board mentions, skipping non-images and dotfiles', async () => {
    const media = fakeMedia(['a.png', 'b.png', '.gitkeep', 'notes.txt']);
    const boards = fakeBoards({ one: '![c](media/a.png)' });
    assert.deepStrictEqual(await findUnusedMediaFiles(media, boards), ['b.png']);
  });

  test('a board that cannot be read fails the check instead of calling its images unused', async () => {
    const media = fakeMedia(['a.png']);
    const boards = fakeBoards({ one: '', two: '![c](media/a.png)' }, ['two']);
    await assert.rejects(findUnusedMediaFiles(media, boards), /EACCES/);
  });
});

suite('trashUnusedMedia', () => {
  test('trashes the confirmed names that are still unused', async () => {
    const media = fakeMedia(['a.png', 'b.png', 'c.png']);
    const boards = fakeBoards({ one: '![c](media/a.png)' });
    const result = await trashUnusedMedia(media, boards, ['b.png', 'c.png']);
    assert.deepStrictEqual(result, { trashed: ['b.png', 'c.png'], failed: [] });
    assert.deepStrictEqual(media.trashed, ['b.png', 'c.png']);
  });

  test('keeps an image a board started using after the prompt was shown', async () => {
    const media = fakeMedia(['b.png', 'c.png']);
    const boards = fakeBoards({ one: '' });
    const confirmed = await findUnusedMediaFiles(media, boards);
    boards.texts.one = '![c](media/c.png)';
    const result = await trashUnusedMedia(media, boards, confirmed);
    assert.deepStrictEqual(result.trashed, ['b.png']);
    assert.deepStrictEqual(media.trashed, ['b.png']);
  });

  test('never trashes a name that was not confirmed', async () => {
    const media = fakeMedia(['a.png', 'b.png']);
    const result = await trashUnusedMedia(media, fakeBoards({}), ['a.png']);
    assert.deepStrictEqual(media.trashed, ['a.png']);
    assert.deepStrictEqual(result.trashed, ['a.png']);
  });

  test('a failure on one file is reported and the others still go', async () => {
    const media = fakeMedia(['a.png', 'b.png'], ['a.png']);
    const result = await trashUnusedMedia(media, fakeBoards({}), ['a.png', 'b.png']);
    assert.deepStrictEqual(result, { trashed: ['b.png'], failed: [{ name: 'a.png', reason: 'locked' }] });
  });
});
