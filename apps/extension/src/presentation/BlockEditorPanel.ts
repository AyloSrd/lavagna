import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { MediaPort } from '../application/ports/MediaPort';
import { imageTarget } from '../domain/blocks/parseBlocks';
import { LavagnaBlock } from '../domain/blocks/types';
import { isSafeRelativePath } from '../domain/references/safePath';
import { blankCanvasBytes } from '../infrastructure/media/blankCanvas';
import {
  BlockKind,
  BlockMeta,
  CanvasImageState,
  HostToWebview,
  WebviewToHost,
} from '../shared/messages';
import { BlockSessionTracker } from './BlockSessionTracker';
import { KIND_LABEL } from './selectors';

export interface BlockEditorDeps {
  extensionUri: vscode.Uri;
  media: MediaPort;
  workspaceRoot?: vscode.Uri;
}

/** A flattened canvas is a PNG of a bounded stage; refuse anything absurd. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_CLIPBOARD_CHARS = 100_000;

interface Session {
  token: string;
  document: vscode.TextDocument;
  kind: BlockKind;
  meta: BlockMeta;
  tracker: BlockSessionTracker;
}

/**
 * Singleton side panel hosting the block-editor webview. Reused across blocks:
 * opening another block retargets the same panel with a fresh `block.init` token.
 */
export class BlockEditorPanel {
  static readonly viewType = 'lavagna.blockEditor';
  private static _current: BlockEditorPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _session: Session | undefined;
  private _webviewReady = false;
  /** Tail of the serialized message chain (see onDidReceiveMessage). */
  private _queue: Promise<void> = Promise.resolve();

  static open(deps: BlockEditorDeps, document: vscode.TextDocument, block: LavagnaBlock): void {
    if (!BlockEditorPanel._current) {
      BlockEditorPanel._current = new BlockEditorPanel(deps);
    }
    BlockEditorPanel._current._retarget(document, block);
    BlockEditorPanel._current._panel.reveal(vscode.ViewColumn.Beside);
  }

  private constructor(private readonly _deps: BlockEditorDeps) {
    // The workspace stays a resource root: image blocks legitimately reference
    // images anywhere in the repo, and a board need not live in `.lavagna/`.
    // What used to make that dangerous is now closed at both ends — image
    // targets must be relative and traversal-free (`_imageFileUri`), and
    // `script-src` is nonce-based rather than allowing every file under a root.
    const localResourceRoots = [vscode.Uri.joinPath(_deps.extensionUri, 'media')];
    if (_deps.workspaceRoot) {
      localResourceRoots.push(_deps.workspaceRoot);
    }
    this._panel = vscode.window.createWebviewPanel(
      BlockEditorPanel.viewType,
      'Lavagna',
      vscode.ViewColumn.Beside,
      // retainContextWhenHidden: editor state (canvas, flow layout) must survive tab switches.
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots },
    );
    this._panel.webview.html = this._getHtml();
    this._panel.webview.onDidReceiveMessage(
      // Serialized: each handler applies a WorkspaceEdit computed from the
      // document's current text, so two in flight at once would let the second
      // compute its range against pre-edit text and clobber the first.
      (msg: WebviewToHost) => {
        this._queue = this._queue.then(
          () => this._handleMessage(msg),
          // Never let one rejection poison the chain for every later message.
        ).catch((err) => { console.error('[lavagna] message handler failed:', err); });
      },
      undefined,
      this._disposables,
    );
    this._disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (this._session && doc === this._session.document) {
          this._post({ type: 'block.gone', token: this._session.token });
          this._session.tracker.dispose();
          this._session = undefined;
        }
      }),
    );
    this._panel.onDidDispose(() => this._dispose());
  }

  private _retarget(document: vscode.TextDocument, block: LavagnaBlock): void {
    this._session?.tracker.dispose();
    const token = crypto.randomUUID();
    const kind = block.kind as BlockKind;
    const meta: BlockMeta = {
      fileName: path.basename(document.uri.fsPath),
      ordinal: block.indexOfKind + 1,
    };
    const tracker = new BlockSessionTracker(
      document,
      { kind: block.kind, indexOfKind: block.indexOfKind },
      block,
      {
        onExternalUpdate: (content) => void this._postUpdate(token, content),
        onGone: () => this._post({ type: 'block.gone', token }),
      },
    );
    this._session = { token, document, kind, meta, tracker };
    const label = KIND_LABEL[kind] ?? kind;
    this._panel.title = `${label[0].toUpperCase()}${label.slice(1)} #${meta.ordinal} — ${meta.fileName}`;
    if (this._webviewReady) {
      void this._postInit();
    }
  }

  /** block.update always carries the freshly resolved image URI and state. */
  private async _postUpdate(token: string, content: string): Promise<void> {
    const imageState = await this._imageState();
    if (this._session?.token !== token) {
      return; // retargeted meanwhile
    }
    this._post({ type: 'block.update', token, content, imageUri: this._imageUri(), imageState });
  }

  private async _postInit(): Promise<void> {
    const session = this._session;
    if (!session) {
      return;
    }
    const imageState = await this._imageState();
    if (this._session !== session) {
      return; // retargeted while stat-ing the image
    }
    const mediaBaseUri = this._deps.workspaceRoot
      ? this._panel.webview.asWebviewUri(this._deps.workspaceRoot).toString()
      : null;
    this._post({
      type: 'block.init',
      token: session.token,
      kind: session.kind,
      content: session.tracker.currentContent(),
      meta: session.meta,
      mediaBaseUri,
      imageUri: this._imageUri(),
      imageState,
    });
  }

  /**
   * For image blocks: the absolute Uri of the block's image target. Null when
   * the block isn't an image, has no target yet, or points somewhere remote.
   */
  private _imageFileUri(): vscode.Uri | null {
    const session = this._session;
    if (!session || session.kind !== 'image') {
      return null;
    }
    const target = imageTarget(session.tracker.currentContent().trim());
    if (!target || /^(https?:|data:|vscode-)/i.test(target)) {
      return null;
    }
    // Board content is untrusted. Absolute targets, `..` traversal and a
    // leading `//` (which Uri.file turns into an authority — a UNC path, i.e.
    // an outbound SMB connection on Windows) are all refused. Previously a
    // board could stat any absolute path as an existence oracle.
    if (!isSafeRelativePath(target)) {
      return null;
    }
    const abs = vscode.Uri.joinPath(session.document.uri, '..', target);
    return abs.authority ? null : abs;
  }

  /** For image blocks: the block's image target resolved to a webview URI. */
  private _imageUri(): string | null {
    const abs = this._imageFileUri();
    return abs ? this._panel.webview.asWebviewUri(abs).toString() : null;
  }

  /**
   * Whether the canvas editor should open on the drawing surface or on the
   * blank/upload chooser: `![canvas]()` has no image yet, and a link whose
   * file is gone can't be drawn on either.
   */
  private async _imageState(): Promise<CanvasImageState | null> {
    const session = this._session;
    if (!session || session.kind !== 'image') {
      return null;
    }
    if (imageTarget(session.tracker.currentContent().trim()) === '') {
      return 'empty';
    }
    const abs = this._imageFileUri();
    if (!abs) {
      return 'present'; // remote/data image — not drawable, handled by the editor
    }
    try {
      await vscode.workspace.fs.stat(abs);
      return 'present';
    } catch {
      return 'missing';
    }
  }

  /** Workspace-root-relative media path → path relative to the board document. */
  private _relToDoc(fromRoot: string): string | null {
    const session = this._session;
    if (!session || !this._deps.workspaceRoot) {
      return null;
    }
    const abs = vscode.Uri.joinPath(this._deps.workspaceRoot, ...fromRoot.split('/'));
    return path
      .relative(path.dirname(session.document.uri.fsPath), abs.fsPath)
      .split(path.sep)
      .join('/');
  }

  private _post(msg: HostToWebview): void {
    void this._panel.webview.postMessage(msg);
  }

  /**
   * Write `bytes` into `.lavagna/media/` and point the block's image line at
   * it. One WorkspaceEdit, so the swap is undoable like any other edit. Skips
   * the edit when the line wouldn't change (e.g. picking "blank page" twice),
   * then pushes block.update explicitly — our own writes are echo-suppressed.
   * Throws on failure so callers can report it their own way.
   */
  private async _relinkImage(
    session: Session,
    bytes: Uint8Array,
    ext: string,
    alt: string,
  ): Promise<void> {
    if (!this._deps.media.isAvailable || !this._deps.workspaceRoot) {
      throw new Error('Open a folder to save images.');
    }
    const fromRoot = await this._deps.media.save(bytes, ext);
    const relToDoc = this._relToDoc(fromRoot);
    if (relToDoc === null) {
      throw new Error('Could not resolve the image path.');
    }
    // `]` or a newline in alt would break the line out of `![…](…)`, after
    // which the block no longer parses and becomes permanently uneditable.
    const safeAlt = (alt || 'canvas').replace(/[\r\n\]]/g, ' ');
    const line = `![${safeAlt}](${relToDoc})`;

    if (line.trim() !== session.tracker.currentContent().trim()) {
      const result = await session.tracker.apply(line);
      if (result !== 'applied') {
        // 'gone' already told the webview via the tracker's onGone.
        throw new Error('The edit was rejected by the editor.');
      }
    }
    await this._postUpdate(session.token, line);
  }

  private async _handleMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.type) {
      case 'ready': {
        this._webviewReady = true;
        void this._postInit();
        break;
      }
      case 'block.changed':
      case 'block.forceWrite': {
        const session = this._session;
        if (!session || msg.token !== session.token) {
          break; // stale straggler from a previous target
        }
        const result = await session.tracker.apply(msg.content, msg.type === 'block.forceWrite');
        if (result === 'applied') {
          this._post({ type: 'block.ack', token: session.token, rev: msg.rev });
        } else if (result === 'failed') {
          this._post({
            type: 'block.writeFailed',
            token: session.token,
            rev: msg.rev,
            message: 'The edit was rejected by the editor.',
          });
        }
        // 'gone' already posted block.gone via the tracker's onGone.
        break;
      }
      case 'canvas.save': {
        const session = this._session;
        if (!session || msg.token !== session.token) {
          break;
        }
        try {
          const bytes = decodeBase64(msg.dataBase64);
          await this._relinkImage(session, bytes, 'png', msg.alt);
        } catch (err) {
          this._post({
            type: 'block.writeFailed',
            token: session.token,
            rev: 0,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
      case 'canvas.setImage': {
        const session = this._session;
        if (!session || msg.token !== session.token) {
          break;
        }
        const fail = (message?: string) =>
          this._post({ type: 'canvas.setImageResult', requestId: msg.requestId, ok: false, message });
        try {
          let bytes: Uint8Array;
          let ext = 'png';
          if (msg.source === 'dialog') {
            const picked = await vscode.window.showOpenDialog({
              canSelectMany: false,
              openLabel: 'Use as canvas',
              title: 'Choose an image for this canvas',
              filters: { Images: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
            });
            if (!picked?.length) {
              fail(); // plain cancel — no message, so the webview shows no error
              break;
            }
            bytes = await vscode.workspace.fs.readFile(picked[0]);
            ext = path.extname(picked[0].fsPath).slice(1).toLowerCase() || 'png';
          } else {
            bytes = await blankCanvasBytes(this._deps.extensionUri);
          }
          if (this._session !== session) {
            break; // retargeted while the dialog was open
          }
          await this._relinkImage(session, bytes, ext, msg.alt);
          this._post({ type: 'canvas.setImageResult', requestId: msg.requestId, ok: true });
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err));
        }
        break;
      }
      case 'clipboard.write': {
        if (!this._session || msg.token !== this._session.token) {
          break;
        }
        await vscode.env.clipboard.writeText(msg.text.slice(0, MAX_CLIPBOARD_CHARS));
        vscode.window.showInformationMessage(`Lavagna: ${msg.label ?? 'Copied to clipboard'}`);
        break;
      }
    }
  }

  private _dispose(): void {
    this._session?.tracker.dispose();
    this._session = undefined;
    this._disposables.forEach((d) => d.dispose());
    BlockEditorPanel._current = undefined;
  }

  private _getHtml(): string {
    const scriptUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._deps.extensionUri, 'media', 'webview.js'),
    );
    // Nonce rather than a bare source allowlist: `script-src <cspSource>` would
    // make any file under a resource root executable here.
    const nonce = crypto.randomBytes(16).toString('base64');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src ${this._panel.webview.cspSource} data:; form-action 'none'; base-uri 'none';" />
  <title>Lavagna</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { height: 100vh; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/** Decode a base64 payload, refusing absurd sizes before allocating. */
function decodeBase64(dataBase64: string): Uint8Array {
  if (dataBase64.length > MAX_IMAGE_BYTES / 3 * 4) {
    throw new Error('Image is too large to save.');
  }
  const bytes = new Uint8Array(Buffer.from(dataBase64, 'base64'));
  if (bytes.byteLength === 0) {
    throw new Error('Image data was empty or malformed.');
  }
  return bytes;
}
