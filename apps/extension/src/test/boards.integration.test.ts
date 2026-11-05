import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { VsCodeBoardRepository } from '../infrastructure/boards/VsCodeBoardRepository';
import { createBoard } from '../application/usecases/boards';
import { findUnusedMediaFiles } from '../application/usecases/media';
import { VsCodeMediaRepository } from '../infrastructure/media/VsCodeMediaRepository';
import { BoardsTreeProvider } from '../presentation/providers/BoardsTreeProvider';

suite('VsCodeBoardRepository (integration)', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lavagna-test-'));
  const root = vscode.Uri.file(tmpRoot);

  test('list returns [] before .lavagna exists and nothing is created', async () => {
    const repo = new VsCodeBoardRepository(root);
    assert.deepStrictEqual(await repo.list(), []);
    assert.deepStrictEqual(await repo.existingFileNames(), []);
    assert.strictEqual(fs.existsSync(path.join(tmpRoot, '.lavagna')), false);
  });

  test('createBoard lazily creates .lavagna and writes the template', async () => {
    const repo = new VsCodeBoardRepository(root);
    const board = await createBoard(repo, 'Release Ideas');
    assert.strictEqual(board.slug, 'release-ideas');
    assert.strictEqual(board.name, 'Release Ideas');
    const filePath = path.join(tmpRoot, '.lavagna', 'release-ideas.lavagna.md');
    assert.strictEqual(fs.readFileSync(filePath, 'utf8'), '# Release Ideas\n\n');
  });

  test('slug collisions get -2 suffix; list sees both boards', async () => {
    const repo = new VsCodeBoardRepository(root);
    const second = await createBoard(repo, 'Release  Ideas!');
    assert.strictEqual(second.slug, 'release-ideas-2');
    const names = (await repo.list()).map((b) => b.name);
    assert.deepStrictEqual(names, ['Release Ideas', 'Release Ideas 2']);
  });

  test('non-board files in .lavagna are ignored by list', async () => {
    fs.writeFileSync(path.join(tmpRoot, '.lavagna', 'notes.md'), 'x');
    fs.mkdirSync(path.join(tmpRoot, '.lavagna', 'media'), { recursive: true });
    const repo = new VsCodeBoardRepository(root);
    const slugs = (await repo.list()).map((b) => b.slug);
    assert.deepStrictEqual(slugs, ['release-ideas', 'release-ideas-2']);
  });
});

suite('BoardsTreeProvider — opening a board', () => {
  // Regression: the tree used to fire the built-in `vscode.open`, which resolves
  // editor associations, so a board named to match a custom editor (Cursor's
  // `mcp`) opened there — or not at all — instead of as text. It must use our
  // own `lavagna.openBoard`, which forces the text editor.
  const board = { name: 'Mcp', slug: 'mcp', fsPath: '/ws/.lavagna/mcp.lavagna.md' };
  const item = new BoardsTreeProvider({} as never).getTreeItem(board);

  test('opens through lavagna.openBoard, never the association-honouring vscode.open', () => {
    assert.strictEqual(item.command?.command, 'lavagna.openBoard');
    assert.notStrictEqual(item.command?.command, 'vscode.open');
  });

  test('passes the board file URI as the argument', () => {
    const arg = item.command?.arguments?.[0] as vscode.Uri;
    assert.ok(arg, 'no URI argument');
    assert.strictEqual(arg.fsPath, board.fsPath);
  });
});

suite('Clean unused media (integration)', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lavagna-media-test-'));
  const root = vscode.Uri.file(tmpRoot);
  const mediaDir = path.join(tmpRoot, '.lavagna', 'media');

  test('listFiles returns [] before .lavagna/media exists', async () => {
    assert.deepStrictEqual(await new VsCodeMediaRepository(root).listFiles(), []);
  });

  test('listFiles skips folders and symlinks', async () => {
    fs.mkdirSync(path.join(mediaDir, 'sub.png'), { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'a.png'), 'x');
    fs.symlinkSync(path.join(mediaDir, 'a.png'), path.join(mediaDir, 'link.png'));
    assert.deepStrictEqual((await new VsCodeMediaRepository(root).listFiles()).sort(), ['a.png']);
  });

  test('an open board with an unsaved link keeps its image', async () => {
    fs.writeFileSync(path.join(mediaDir, 'fresh.png'), 'x');
    const boardPath = path.join(tmpRoot, '.lavagna', 'notes.lavagna.md');
    fs.writeFileSync(boardPath, '# Notes\n');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(boardPath));
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(1, 0), '![canvas](media/fresh.png)\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(doc.isDirty);
    const unused = await findUnusedMediaFiles(new VsCodeMediaRepository(root), new VsCodeBoardRepository(root));
    assert.deepStrictEqual(unused, ['a.png']);
  });
});

suite('VsCodeBoardRepository.listAll (integration)', () => {
  test('[] when .lavagna does not exist', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lavagna-listall-'));
    assert.deepStrictEqual(await new VsCodeBoardRepository(vscode.Uri.file(tmp)).listAll(), []);
  });

  test('a symlinked board fails the listing instead of being skipped', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lavagna-listall-'));
    fs.mkdirSync(path.join(tmp, '.lavagna'));
    fs.writeFileSync(path.join(tmp, 'elsewhere.md'), '![a](media/a.png)');
    fs.symlinkSync(path.join(tmp, 'elsewhere.md'), path.join(tmp, '.lavagna', 'linked.lavagna.md'));
    await assert.rejects(new VsCodeBoardRepository(vscode.Uri.file(tmp)).listAll(), /symbolic link/);
  });
});
