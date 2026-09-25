import * as vscode from 'vscode';
import { parseBlocks } from '../../domain/blocks/parseBlocks';
import { formatFileRef } from '../../domain/references/fileRef';
import { CopySourceTracker } from '../../infrastructure/references/CopySourceTracker';
import { log } from '../../infrastructure/logging/log';

// Copy a selection in any file → paste into a board → a reference carrying the
// line range instead of the raw code. The origin comes from the metadata the
// host attaches at copy time when it does, and otherwise from `CopySourceTracker`
// matching the clipboard against recent selections.
//
// One gesture: a plain paste. The host applies the first returned edit, so
// returning one makes the reference the paste inside boards, and returning
// nothing leaves the normal paste alone — which is the whole behaviour.
// `lavagna.pasteAsFileReference` turns it off.
//
// Whether the host consults this provider on a plain paste is the host's call,
// and it can't be checked from here: no provider — on any selector — receives
// `prepareDocumentPaste` from `editor.action.clipboardCopyAction` in the test
// harness, because that command doesn't take the DOM copy path driving the
// host's CopyPasteController. Our own logic is covered by tests that call these
// hooks directly; a report of "it pasted raw text" is about the plumbing in
// between, so check whether the hooks ran at all before changing this file.

const MIME = 'application/vnd.lavagna.fileref+json';

/** Whether a plain paste inside a board becomes a reference. */
function pasteAsReferenceEnabled(): boolean {
  return vscode.workspace.getConfiguration('lavagna').get<boolean>('pasteAsFileReference', true);
}

const KIND = vscode.DocumentDropOrPasteEditKind.Text.append('lavagna', 'fileref');

interface RefMeta {
  path: string;
  start: number;
  end: number;
  /** Source's workspace folder, so a paste across roots can decline (paths are root-relative). */
  folder: string;
}

/**
 * The clipboard is shared: any extension can set our MIME, and a malformed
 * payload would otherwise reach `formatFileRef` as-is. Validate before trusting.
 */
function asRefMeta(raw: unknown): RefMeta | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.path !== 'string' || typeof m.folder !== 'string' || !m.path) {
    return null;
  }
  if (!Number.isSafeInteger(m.start) || !Number.isSafeInteger(m.end)) {
    return null;
  }
  const start = m.start as number;
  const end = m.end as number;
  if (start < 1 || end < start) {
    return null;
  }
  return { path: m.path, start, end, folder: m.folder };
}

/** Exported so tests can drive both hooks without VS Code's clipboard plumbing. */
export class FileRefPasteProvider implements vscode.DocumentPasteEditProvider {
  constructor(private readonly tracker?: CopySourceTracker) {}

  // On copy from any file, stash where it came from.
  prepareDocumentPaste(
    document: vscode.TextDocument,
    ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
  ): void {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    log(`COPY hook fired for ${document.uri.path}`);
    if (document.uri.scheme !== 'file' || !folder) {
      log(`  declined: scheme=${document.uri.scheme} folder=${folder ? 'yes' : 'none'}`);
      return; // untitled / output / external — nothing worth referencing [Q4, edge 1/2]
    }
    if (ranges.length === 0) {
      log('  declined: no ranges');
      return;
    }
    const meta: RefMeta = {
      path: vscode.workspace.asRelativePath(document.uri, false),
      start: ranges[0].start.line + 1, // overall min→max across selections [edge 4]
      end: ranges[ranges.length - 1].end.line + 1,
      folder: folder.uri.toString(),
    };
    log(`  attached metadata: ${meta.path}:${meta.start}-${meta.end}`);
    dataTransfer.set(MIME, new vscode.DataTransferItem(JSON.stringify(meta)));
  }

  // On paste into a board, offer the reference.
  async provideDocumentPasteEdits(
    document: vscode.TextDocument,
    ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
  ): Promise<vscode.DocumentPasteEdit[] | undefined> {
    log(`PASTE hook fired for ${document.uri.path}`);
    if (!/\.lavagna\.md$/.test(document.uri.path)) {
      log('  declined: not a .lavagna.md file');
      return undefined; // dest guard — keep our edit out of every other document
    }
    if (!pasteAsReferenceEnabled()) {
      log('  declined: lavagna.pasteAsFileReference is off');
      return undefined; // always paste raw text
    }
    if (isInsideFence(document, ranges[0]?.start)) {
      log('  declined: cursor is inside a fenced block');
      return undefined; // paste raw inside code fences [edge 6]
    }
    const meta = await this.resolveSource(dataTransfer);
    if (!meta) {
      log('  declined: no source resolved (no metadata, and no tracked selection matched)');
      return undefined;
    }
    // "In scope of the current folder": the reference is root-relative, so a
    // copy from a different workspace root wouldn't resolve from this board.
    const destFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!destFolder || destFolder.uri.toString() !== meta.folder) {
      log(`  declined: folder mismatch — board=${destFolder?.uri.toString()} source=${meta.folder}`);
      return undefined;
    }
    const edit = new vscode.DocumentPasteEdit(
      formatFileRef(meta.path, { start: meta.start, end: meta.end }),
      'Insert as Lavagna file reference',
      KIND,
    );
    log(`  RETURNING reference: ${edit.insertText}`);
    // Deliberately no `yieldTo`: yielding would push this below the plain-text
    // edit, which is exactly what stopped it being the default paste.
    return [edit];
  }

  /**
   * Where the paste came from: the metadata the host attached during the copy
   * if it's there, otherwise the tracker's own record matched on clipboard text.
   *
   * The fallback exists because the metadata is frequently absent — the host
   * only attaches it when the copy goes through its copy-paste controller.
   * Without the fallback the feature depends on plumbing we can't see or test.
   */
  private async resolveSource(dataTransfer: vscode.DataTransfer): Promise<RefMeta | null> {
    const item = dataTransfer.get(MIME);
    if (item) {
      try {
        const meta = asRefMeta(JSON.parse(await item.asString()));
        if (meta) {
          log(`  source from host metadata: ${meta.path}:${meta.start}-${meta.end}`);
          return meta;
        }
        log('  host metadata present but malformed');
      } catch {
        /* fall through to the tracker */
      }
    }
    log(`  no host metadata; mimes on the clipboard: [${[...dataTransfer].map(([m]) => m).join(' ')}]`);
    const text = await dataTransfer.get('text/plain')?.asString();
    if (!text || !this.tracker) {
      log(`  cannot fall back: text=${!!text} tracker=${!!this.tracker}`);
      return null;
    }
    const source = await this.tracker.resolve(text);
    return source
      ? { path: source.path, start: source.start, end: source.end, folder: source.folder }
      : null;
  }
}

/** True when `position` falls inside a fenced code block. */
function isInsideFence(document: vscode.TextDocument, position?: vscode.Position): boolean {
  if (!position) {
    return false;
  }
  return parseBlocks(document.getText()).some(
    (b) =>
      (b.kind === 'code' || b.kind === 'mermaid' || b.kind === 'tree') &&
      position.line > b.startLine &&
      position.line <= b.endLine,
  );
}

/**
 * Registered only when the host exposes the finalized paste API, so older bases
 * (some Cursor builds) simply don't get Feature B rather than erroring.
 */
export function registerFileRefPaste(tracker: CopySourceTracker): vscode.Disposable | undefined {
  if (typeof vscode.languages.registerDocumentPasteEditProvider !== 'function') {
    return undefined;
  }
  return vscode.languages.registerDocumentPasteEditProvider(
    { pattern: '**/*' }, // copy side: any file; paste side is guarded above
    new FileRefPasteProvider(tracker),
    {
      providedPasteEditKinds: [KIND],
      copyMimeTypes: [MIME],
      // `text/plain` as well as our own MIME: without it the host skips this
      // provider entirely whenever the copy attached no metadata, which is
      // exactly the case the tracker fallback exists to handle.
      pasteMimeTypes: [MIME, 'text/plain'],
    },
  );
}
