import * as vscode from 'vscode';
import { formatFileRef } from '../../domain/references/fileRef';
import { partitionPicks } from '../../domain/references/fuzzy';

const EXCLUDE = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.lavagna/media/**}';
/** Max items handed to the QuickPick at once — keeps its native filter/render instant. */
const LIMIT = 500;

interface FilePick extends vscode.QuickPickItem {
  relPath: string;
}
/** Separators carry no path, which is how `relPath` narrowing tells them apart. */
interface Separator extends vscode.QuickPickItem {
  kind: vscode.QuickPickItemKind.Separator;
  relPath?: undefined;
}
type Entry = FilePick | Separator;

const sep = (label: string): Separator => ({
  label,
  kind: vscode.QuickPickItemKind.Separator,
});

/**
 * `lavagna.insertFileRef` — fuzzy-pick one or more workspace files and insert a
 * reference at the cursor. `findFiles` is workspace-scoped, so externals never
 * appear; paths are workspace-root-relative.
 *
 * We filter with our own matcher and hand the QuickPick only the top `LIMIT`
 * matches. Handing it the whole workspace makes its built-in filter re-score
 * everything on every keystroke — the jank the user hit.
 *
 * Multi-select across searches is the fiddly part. Reusing the item objects
 * isn't enough: assigning `items` resets the selection, and the QuickPick
 * filters by label on top of our ranking, so a pick that didn't match the new
 * query was hidden and silently dropped. Three things fix it — `picked` is the
 * source of truth, picked items are pinned to the top of every render, and
 * `alwaysShow` stops the native filter hiding anything we ranked in.
 */
export function registerInsertFileRef(): vscode.Disposable {
  return vscode.commands.registerCommand('lavagna.insertFileRef', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const qp = vscode.window.createQuickPick<Entry>();
    qp.canSelectMany = true;
    qp.placeholder = 'Insert file reference… (selections are kept as you search)';
    qp.busy = true;
    // We rank; stop the QuickPick from re-filtering our already-ranked subset.
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;
    qp.show();

    const itemByPath = new Map<string, FilePick>();
    let allPaths: string[] = [];
    /** Chosen paths in the order chosen — the source of truth for the selection. */
    const picked = new Set<string>();

    /**
     * Fold the QuickPick's live selection into `picked`, then reconcile: a row
     * that's on screen but unchecked has been deselected.
     *
     * Deliberately pull-based. Subscribing to `onDidChangeSelection` would mean
     * telling the user's clicks apart from the echo of our own `items` /
     * `selectedItems` writes, and the only lever for that is event timing the
     * API doesn't promise. Reading at the two moments the user drives — a
     * keystroke, or accept — needs no such guess.
     */
    const absorbSelection = () => {
      const checked = new Set(
        qp.selectedItems.map((i) => i.relPath).filter((p): p is string => !!p),
      );
      for (const item of qp.items) {
        if (item.relPath && !checked.has(item.relPath)) {
          picked.delete(item.relPath);
        }
      }
      for (const path of checked) {
        picked.add(path);
      }
    };

    const render = (query: string) => {
      const split = partitionPicks(allPaths, query, picked, LIMIT);
      const pinned = split.pinned.map((p) => itemByPath.get(p)!).filter(Boolean);
      const rest = split.rest.map((p) => itemByPath.get(p)!);

      qp.items = pinned.length ? [sep('Selected'), ...pinned, sep('Files'), ...rest] : rest;
      // Assigning `items` clears the selection — restoring it here is what makes
      // a pick survive typing a new query.
      qp.selectedItems = pinned;
    };

    qp.onDidChangeValue((query) => {
      absorbSelection();
      render(query);
    });

    qp.onDidAccept(() => {
      absorbSelection();
      // Read from `picked`, not `selectedItems`: it holds every pick in the
      // order chosen, including ones made under an earlier query.
      const picks = [...picked].map((p) => itemByPath.get(p)!).filter(Boolean);
      qp.hide();
      if (picks.length) {
        // insertSnippet treats `$` and `}` specially — escape them out of paths.
        const text = picks
          .map((p) => formatFileRef(p.relPath))
          .join('\n')
          .replace(/\$/g, '\\$')
          .replace(/\}/g, '\\}');
        void editor.insertSnippet(new vscode.SnippetString(text));
      }
    });
    qp.onDidHide(() => qp.dispose());

    try {
      const uris = await vscode.workspace.findFiles('**/*', EXCLUDE);
      allPaths = uris.map((u) => vscode.workspace.asRelativePath(u, false)).sort();
      for (const p of allPaths) {
        // `alwaysShow` keeps the native label filter from hiding anything we
        // ranked in — including a pinned pick that doesn't match the query.
        itemByPath.set(p, { label: p, relPath: p, alwaysShow: true });
      }
      render(qp.value);
    } finally {
      qp.busy = false;
    }
  });
}
