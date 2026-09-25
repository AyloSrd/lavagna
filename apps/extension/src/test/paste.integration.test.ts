import * as assert from 'assert';
import * as vscode from 'vscode';
import { FileRefPasteProvider } from '../presentation/providers/FileRefPasteProvider';
import { CopySourceTracker } from '../infrastructure/references/CopySourceTracker';

/** Give the UI a moment. Only for steps no assertion depends on. */
const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll until `condition` holds, then return; throw if it never does.
 *
 * Everything here waits on VS Code doing something on its own schedule, which
 * is fast on a desktop and slow on a cold CI runner under xvfb. Failing loudly
 * matters as much as the polling: a helper that gives up quietly turns "the
 * event never arrived" into some unrelated assertion failing seconds later with
 * the wrong message, which on CI is the difference between a one-line fix and
 * an afternoon.
 */
async function until(condition: () => boolean, what: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  if (!condition()) {
    throw new Error(`timed out after ${timeoutMs}ms waiting for: ${what}`);
  }
}

/**
 * Resolves on the next non-empty selection change in `editor`; rejects if none
 * arrives. `sub` is declared before the timer so neither closure reads a
 * binding that is not initialised yet.
 */
function nextNonEmptySelection(editor: vscode.TextEditor, timeoutMs = 5000) {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sub: vscode.Disposable | undefined;
    const stop = () => {
      clearTimeout(timer);
      sub?.dispose();
    };
    sub = vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor === editor && e.selections.some((s) => !s.isEmpty)) {
        stop();
        resolve();
      }
    });
    timer = setTimeout(() => {
      stop();
      reject(
        new Error(
          `onDidChangeTextEditorSelection never fired a non-empty selection for ` +
            `${editor.document.uri.fsPath} within ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
  });
}

/**
 * Select `range` in `editor` and wait for the selection-change event to land.
 *
 * Collapse first. The tracker records on *change*, and a previous test may have
 * left this very range selected — assigning it again would fire nothing and the
 * tracker would legitimately have no record to find.
 *
 * Then wait for the event itself rather than a fixed delay: on a cold CI runner
 * it can take well over 100ms to arrive, and the tracker only knows about the
 * selection once it has. The listener goes up before the selecting write so the
 * event cannot be missed, and a late-dispatched collapse is ignored because that
 * selection is empty. The tracker's own listener is registered earlier and VS Code dispatches
 * in registration order, so by the time this resolves the tracker has recorded.
 */
async function selectRange(editor: vscode.TextEditor, range: vscode.Range) {
  editor.selection = new vscode.Selection(range.start, range.start);
  const changed = nextNonEmptySelection(editor);
  editor.selection = new vscode.Selection(range.start, range.end);
  await changed;
}

/**
 * Cover for "copy code → paste into a board → get a reference".
 *
 * Both hooks are driven directly rather than through
 * `editor.action.clipboardCopyAction`. That isn't a shortcut — the harness
 * genuinely cannot exercise the real copy: a diagnostic registered four
 * providers, with an all-files glob, an all-languages selector, a typescript
 * language selector and a file-scheme selector, and *none* of them received
 * `prepareDocumentPaste` from that command, because it doesn't go through the
 * DOM copy path that drives VS Code's CopyPasteController. So the clipboard
 * plumbing is out of reach here and only our own logic can be pinned down; a red
 * test asserting otherwise would just be noise. What the plumbing does in a real
 * editor still needs a manual check.
 */
suite('file reference paste (integration)', () => {
  const provider = new FileRefPasteProvider();

  function folder(): vscode.WorkspaceFolder {
    const first = vscode.workspace.workspaceFolders?.[0];
    assert.ok(first, 'no workspace folder — check `workspaceFolder` in .vscode-test.mjs');
    return first;
  }

  const open = (rel: string) =>
    vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder().uri, rel));

  /** Run the copy hook over `lines` of `rel` and hand back the resulting transfer. */
  async function copy(rel: string, startLine: number, endLine: number) {
    const doc = await open(rel);
    const dt = new vscode.DataTransfer();
    const range = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, doc.lineAt(endLine).text.length),
    );
    dt.set('text/plain', new vscode.DataTransferItem(doc.getText(range)));
    provider.prepareDocumentPaste(doc, [range], dt);
    return dt;
  }

  async function pasteEdits(rel: string, dt: vscode.DataTransfer, at = new vscode.Position(1, 0)) {
    const doc = await open(rel);
    return provider.provideDocumentPasteEdits(doc, [new vscode.Range(at, at)], dt);
  }

  test('the extension activates from opening a board, with no view or command touched', async () => {
    const ext = vscode.extensions.getExtension('aylosrd.lavagna');
    assert.ok(ext, 'extension not found by id');
    await vscode.window.showTextDocument(await open('.lavagna/board.lavagna.md'));
    await until(() => ext.isActive, 'the extension to activate from opening a board');
    assert.ok(ext.isActive, 'opening a board did not activate the extension');
  });

  test('the copy hook stashes the path, line range, and source folder', async () => {
    const dt = await copy('sample.ts', 1, 3);
    const item = dt.get('application/vnd.lavagna.fileref+json');
    assert.ok(item, 'no metadata set — the reference paste cannot work without it');
    assert.deepStrictEqual(JSON.parse(await item.asString()), {
      path: 'sample.ts',
      start: 2,
      end: 4,
      folder: folder().uri.toString(),
    });
  });

  test('an automatic paste into a board yields the reference edit', async () => {
    const edits = await pasteEdits('.lavagna/board.lavagna.md', await copy('sample.ts', 1, 3));
    assert.ok(edits && edits.length === 1, 'expected exactly one edit');
    assert.strictEqual(edits[0].insertText, '[@sample.ts:2-4](sample.ts#L2-L4)');
  });

  test('the edit does not yield, so it is not ranked below the plain-text paste', async () => {
    const edits = await pasteEdits('.lavagna/board.lavagna.md', await copy('sample.ts', 1, 3));
    assert.strictEqual(edits![0].yieldTo, undefined);
  });

  test('a plain .md file gets nothing — the reference paste is board-only', async () => {
    const edits = await pasteEdits('notes.md', await copy('sample.ts', 1, 3));
    assert.strictEqual(edits, undefined);
  });

  test('a copy with no metadata is left as a plain paste', async () => {
    const dt = new vscode.DataTransfer();
    dt.set('text/plain', new vscode.DataTransferItem('just some text'));
    assert.strictEqual(await pasteEdits('.lavagna/board.lavagna.md', dt), undefined);
  });

  test('an untitled source sets no metadata, so the paste stays raw', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: 'const outside = 1;\n',
    });
    const dt = new vscode.DataTransfer();
    provider.prepareDocumentPaste(doc, [new vscode.Range(0, 0, 0, 18)], dt);
    assert.strictEqual(dt.get('application/vnd.lavagna.fileref+json'), undefined);
  });

  test('a copy from another workspace root is declined — root-relative paths would not resolve', async () => {
    const dt = await copy('sample.ts', 1, 3);
    // Same shape, different origin folder.
    dt.set(
      'application/vnd.lavagna.fileref+json',
      new vscode.DataTransferItem(
        JSON.stringify({ path: 'sample.ts', start: 2, end: 4, folder: 'file:///elsewhere' }),
      ),
    );
    assert.strictEqual(await pasteEdits('.lavagna/board.lavagna.md', dt), undefined);
  });

  test('malformed metadata is declined rather than formatted', async () => {
    const bad = [
      '{"path":"a.ts","start":0,"end":4,"folder":"F"}', // start below 1
      '{"path":"a.ts","start":9,"end":4,"folder":"F"}', // end before start
      '{"path":"","start":1,"end":1,"folder":"F"}', // empty path
      '{"path":"a.ts","start":"2","end":"4","folder":"F"}', // non-numeric
      'not json at all',
    ];
    for (const raw of bad) {
      const dt = new vscode.DataTransfer();
      dt.set('application/vnd.lavagna.fileref+json', new vscode.DataTransferItem(raw));
      assert.strictEqual(
        await pasteEdits('.lavagna/board.lavagna.md', dt),
        undefined,
        `should have declined: ${raw}`,
      );
    }
  });

  test('pasting inside a fence stays raw', async () => {
    const doc = await open('.lavagna/fenced.lavagna.md');
    const dt = await copy('sample.ts', 1, 3);
    const inside = new vscode.Position(3, 0); // between ``` and ```
    assert.ok(doc.lineAt(2).text.startsWith('```'), 'fixture drifted: expected a fence at line 3');
    const edits = await provider.provideDocumentPasteEdits(doc, [new vscode.Range(inside, inside)], dt);
    assert.strictEqual(edits, undefined);
  });

  test('with the setting off nothing is offered, so paste stays raw', async () => {
    const config = vscode.workspace.getConfiguration('lavagna');
    await config.update('pasteAsFileReference', false, vscode.ConfigurationTarget.Global);
    try {
      const dt = await copy('sample.ts', 1, 3);
      assert.strictEqual(await pasteEdits('.lavagna/board.lavagna.md', dt), undefined);
    } finally {
      await config.update('pasteAsFileReference', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  // ---------------------------------------------------------------------------
  // The tracker: how the source is found when the host attached no metadata,
  // which is the common case. Driven through real editors and real selections,
  // so this covers the recording as well as the lookup.
  // ---------------------------------------------------------------------------

  /**
   * Select a range in `rel` so the tracker records it, and return the text a
   * copy would put on the clipboard.
   */
  async function selectAndCopyText(rel: string, startLine: number, endLine: number) {
    const doc = await open(rel);
    const editor = await vscode.window.showTextDocument(doc);
    const range = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, doc.lineAt(endLine).text.length),
    );
    await selectRange(editor, range);
    return doc.getText(range);
  }

  test('the tracker resolves a selection back to its file and line range', async () => {
    const tracker = new CopySourceTracker();
    const sub = tracker.register();
    try {
      const text = await selectAndCopyText('sample.ts', 1, 3);
      const source = await tracker.resolve(text);
      assert.ok(source, 'no source resolved for a selection just made');
      assert.strictEqual(source.path, 'sample.ts');
      assert.strictEqual(source.start, 2);
      assert.strictEqual(source.end, 4);
    } finally {
      sub.dispose();
    }
  });

  test('the tracker declines text it never saw selected', async () => {
    const tracker = new CopySourceTracker();
    const sub = tracker.register();
    try {
      await selectAndCopyText('sample.ts', 1, 3);
      assert.strictEqual(await tracker.resolve('text from another application'), null);
      assert.strictEqual(await tracker.resolve('   '), null, 'whitespace must not match');
      assert.strictEqual(await tracker.resolve(''), null);
    } finally {
      sub.dispose();
    }
  });

  test('a trailing newline from a whole-line copy still matches', async () => {
    const tracker = new CopySourceTracker();
    const sub = tracker.register();
    try {
      const text = await selectAndCopyText('sample.ts', 1, 3);
      const source = await tracker.resolve(text + '\n');
      assert.ok(source, 'a line copy adds a newline the selection did not have');
      assert.strictEqual(source.start, 2);
    } finally {
      sub.dispose();
    }
  });

  test('the provider falls back to the tracker when the copy attached no metadata', async () => {
    const tracker = new CopySourceTracker();
    const sub = tracker.register();
    try {
      const text = await selectAndCopyText('sample.ts', 1, 3);
      // Exactly what the host hands over when its copy hook never ran.
      const dt = new vscode.DataTransfer();
      dt.set('text/plain', new vscode.DataTransferItem(text));

      const withTracker = new FileRefPasteProvider(tracker);
      const doc = await open('.lavagna/board.lavagna.md');
      const at = new vscode.Position(1, 0);
      const edits = await withTracker.provideDocumentPasteEdits(doc, [new vscode.Range(at, at)], dt);
      assert.ok(edits?.length, 'no edit produced from a metadata-free paste');
      assert.strictEqual(edits[0].insertText, '[@sample.ts:2-4](sample.ts#L2-L4)');
    } finally {
      sub.dispose();
    }
  });

  // ---------------------------------------------------------------------------
  // `lavagna.paste` — the Cmd+V override. This *is* end-to-end testable, because
  // it deliberately avoids the paste API: Cursor registers our provider and then
  // never calls either hook, so the keystroke had to be taken directly.
  // ---------------------------------------------------------------------------

  async function pasteWith(clipboard: string, board = '.lavagna/board.lavagna.md') {
    await vscode.env.clipboard.writeText(clipboard);
    const doc = await open(board);
    const editor = await vscode.window.showTextDocument(doc);
    const end = doc.lineAt(doc.lineCount - 1).range.end;
    editor.selection = new vscode.Selection(end, end);
    const before = doc.getText();
    await vscode.commands.executeCommand('lavagna.paste');
    await until(() => doc.getText() !== before, 'lavagna.paste to insert something into the board');
    return doc.getText();
  }

  // Cleanup only: nothing is asserted about the result, so a moment for the UI
  // is all this needs and there is no condition worth polling for.
  async function undo() {
    await vscode.commands.executeCommand('undo');
    await settle();
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await settle();
  }

  test('Cmd+V inserts a reference for a selection copied from the workspace', async () => {
    const clipboardBefore = await vscode.env.clipboard.readText();
    const copied = await selectAndCopyText('sample.ts', 1, 3);
    try {
      const text = await pasteWith(copied);
      assert.ok(
        text.includes('[@sample.ts:2-4](sample.ts#L2-L4)'),
        `expected a reference to lines 2-4, got:\n${JSON.stringify(text)}`,
      );
      assert.ok(!text.includes('export function add'), 'raw code was pasted instead');
    } finally {
      await undo();
      await vscode.env.clipboard.writeText(clipboardBefore);
    }
  });

  test('Cmd+V pastes normally when nothing matches the clipboard', async () => {
    const clipboardBefore = await vscode.env.clipboard.readText();
    try {
      const text = await pasteWith('text that was never selected anywhere');
      assert.ok(
        text.includes('text that was never selected anywhere'),
        `expected a plain paste, got:\n${JSON.stringify(text)}`,
      );
      assert.ok(!text.includes('#L'), 'a reference was invented for an unknown clipboard');
    } finally {
      await undo();
      await vscode.env.clipboard.writeText(clipboardBefore);
    }
  });
});
