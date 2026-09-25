import * as assert from 'assert';
import * as vscode from 'vscode';

/** Give the UI a moment. Only for steps no assertion depends on. */
const settle = () => new Promise((r) => setTimeout(r, 100));

/**
 * Poll until `condition` holds, then return; throw if it never does.
 *
 * QuickPick reconciles `selectedItems` against `items` on its own schedule —
 * quick on a desktop, slow on a cold CI runner under xvfb — so a fixed sleep is
 * either flaky or slow. Failing loudly matters as much as the polling: a helper
 * that gives up quietly turns "the reconciliation never happened" into some
 * unrelated assertion failing seconds later with the wrong message.
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
 * Wait for the reconciliation that follows writing `items` / `selectedItems`.
 *
 * `until()` is the wrong tool for asserting that a selection *survived*:
 * `selectedItems` reads back whatever was last assigned, so the condition is
 * already true before the QuickPick has looked at it and the wait would return
 * on the stale value. What *is* observable is `onDidChangeSelection`, which
 * fires each time the reconciliation changes the selection.
 *
 * One event is not enough to wait for, though. Writing `items` and then
 * `selectedItems` reaches the UI as two steps on a slow host: the first drops
 * the pick (an event with `[]`), the second restores it (an event with the
 * pick). On a fast machine the two coalesce and neither event fires. So this
 * waits until the selection has been *quiet* for `quietMs` — every event
 * restarts the clock — with a hard ceiling so a chattering picker cannot hang
 * the suite. A dropped pick then shows up as the settled state, not as a
 * transient the assertion happened to catch.
 */
function reconciled<T extends vscode.QuickPickItem>(
  qp: vscode.QuickPick<T>,
  quietMs = 150,
  maxMs = 3000,
) {
  return new Promise<void>((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let sub: vscode.Disposable | undefined;
    const done = () => {
      clearTimeout(quiet);
      clearTimeout(ceiling);
      sub?.dispose();
      resolve();
    };
    const ceiling = setTimeout(done, maxMs);
    const restart = () => {
      clearTimeout(quiet);
      quiet = setTimeout(done, quietMs);
    };
    sub = qp.onDidChangeSelection(restart);
    restart();
  });
}

/**
 * The file-reference picker keeps multi-select alive across searches by writing
 * `items` and then restoring `selectedItems`. That rests on QuickPick behaviour
 * the API docs don't spell out, so it's pinned here against a real VS Code — if
 * a release changes it, this fails instead of the picker quietly dropping the
 * user's selection again.
 *
 * Every case has to `show()` first: an unshown QuickPick has no UI layer, so it
 * never reconciles `selectedItems` against `items` and happily reports whatever
 * was last assigned — including separators. Assertions on a hidden one prove
 * nothing about the picker.
 */
suite('QuickPick semantics the file-reference picker depends on', () => {
  async function withShownPick(
    body: (qp: vscode.QuickPick<vscode.QuickPickItem & { relPath?: string }>) => Promise<void>,
  ) {
    const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { relPath?: string }>();
    qp.canSelectMany = true;
    qp.show();
    await settle(); // let the UI layer come up; nothing is asserted about it
    try {
      await body(qp);
    } finally {
      qp.dispose();
      await settle();
    }
  }

  test('a selection does not survive an items reassignment — the bug being fixed', async () => {
    await withShownPick(async (qp) => {
      const a = { label: 'a.ts', relPath: 'a.ts' };
      qp.items = [a, { label: 'b.ts', relPath: 'b.ts' }];
      qp.selectedItems = [a];
      await reconciled(qp);
      assert.deepStrictEqual(
        qp.selectedItems.map((i) => i.label),
        ['a.ts'],
        'precondition: the selection took',
      );

      // What a new query used to do: re-render with a set that excludes the pick.
      qp.items = [{ label: 'c.ts', relPath: 'c.ts' }];
      await until(
        () => qp.selectedItems.length === 0,
        'the QuickPick to drop a selected item that is no longer in `items`',
      );
      assert.deepStrictEqual(qp.selectedItems, [], 'a dropped item cannot stay selected');
    });
  });

  test('carrying the item over and re-selecting it restores the pick', async () => {
    await withShownPick(async (qp) => {
      const pinned = { label: 'a.ts', relPath: 'a.ts' };
      qp.items = [pinned, { label: 'b.ts', relPath: 'b.ts' }];
      qp.selectedItems = [pinned];
      await reconciled(qp);
      assert.deepStrictEqual(
        qp.selectedItems.map((i) => i.label),
        ['a.ts'],
        'precondition: the selection took',
      );

      // Exactly what render() does: keep the picked item in the new set — the
      // same object, identity matters — then re-apply the selection.
      qp.items = [pinned, { label: 'c.ts', relPath: 'c.ts' }];
      qp.selectedItems = [pinned];
      await reconciled(qp);
      assert.deepStrictEqual(
        qp.selectedItems.map((i) => i.label),
        ['a.ts'],
        'the pick should survive the re-render',
      );
    });
  });

  test('selectedItems is readable on demand, so the picker can pull instead of subscribe', async () => {
    await withShownPick(async (qp) => {
      const a = { label: 'a.ts', relPath: 'a.ts' };
      const b = { label: 'b.ts', relPath: 'b.ts' };
      qp.items = [a, b];
      qp.selectedItems = [a, b];
      await reconciled(qp);
      // absorbSelection() reads this at keystroke and accept time.
      assert.deepStrictEqual(
        qp.selectedItems.map((i) => i.relPath),
        ['a.ts', 'b.ts'],
      );
    });
  });

  test('a separator is not selectable, so it never reaches formatFileRef', async () => {
    await withShownPick(async (qp) => {
      const file = { label: 'a.ts', relPath: 'a.ts' };
      qp.items = [{ label: 'Selected', kind: vscode.QuickPickItemKind.Separator }, file];
      // The picker pins with a separator above the chosen rows.
      qp.selectedItems = qp.items;
      // A drop, so the condition is false until the reconciliation runs — no
      // need for the quiet window here.
      await until(
        () => qp.selectedItems.every((i) => i.kind !== vscode.QuickPickItemKind.Separator),
        'the QuickPick to drop the separator from `selectedItems`',
      );
      assert.ok(
        qp.selectedItems.every((i) => i.kind !== vscode.QuickPickItemKind.Separator),
        'a separator came back as selected',
      );
      // Belt and braces: absorbSelection() also filters on `relPath` being set,
      // so a separator cannot enter `picked` even if the above ever changes.
      assert.strictEqual(
        (qp.items[0] as { relPath?: string }).relPath,
        undefined,
        'separators must carry no relPath',
      );
    });
  });
});
