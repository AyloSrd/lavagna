// Message protocol between the extension host and the block-editor webview.
// Both sides import from this file only — never from each other's layers.
//
// Lifecycle: the webview posts `ready`; the host answers with `block.init`
// carrying a fresh `token` for the editing session. The same panel is reused
// for other blocks by sending a new `block.init` (new token); block.* messages
// carrying a stale token are dropped by both sides.

export type BlockKind = 'mermaid' | 'tree' | 'table' | 'image';

/**
 * State of an image block's target, used to decide whether the canvas editor
 * opens on the drawing surface or on the blank/upload chooser.
 *  - `empty`   — no target yet, i.e. `![canvas]()`
 *  - `missing` — the linked file is not on disk
 *  - `present` — a real image
 */
export type CanvasImageState = 'empty' | 'missing' | 'present';

/** Where the bytes for a new canvas image come from. */
export type CanvasImageSource = 'dialog' | 'blank';

export interface BlockMeta {
  /** Board file name for the panel/editor header, e.g. "ideas.lavagna.md". */
  fileName: string;
  /** 1-based ordinal of this block among same-kind blocks ("Tree #2"). */
  ordinal: number;
}

export interface BlockInitMessage {
  type: 'block.init';
  token: string;
  kind: BlockKind;
  /** Current block text (fence body, or the whole table/image line). */
  content: string;
  meta: BlockMeta;
  mediaBaseUri: string | null;
  /** For image blocks: the block's image resolved to a webview-loadable URI. */
  imageUri: string | null;
  /** For image blocks only; null otherwise. */
  imageState: CanvasImageState | null;
}

export type HostToWebview =
  | BlockInitMessage
  // The block changed in the TextDocument and the change was NOT our own write-back.
  | {
      type: 'block.update';
      token: string;
      content: string;
      imageUri: string | null;
      imageState: CanvasImageState | null;
    }
  // The host applied our block.changed revision `rev` to the document.
  | { type: 'block.ack'; token: string; rev: number }
  // Our write failed (e.g. edit rejected) — webview shows a banner, keeps its state.
  | { type: 'block.writeFailed'; token: string; rev: number; message: string }
  // The fence was deleted or can no longer be located.
  | { type: 'block.gone'; token: string }
  // Outcome of canvas.setImage. `ok: false` with no message means the user
  // cancelled the file dialog — normal flow, not an error.
  | { type: 'canvas.setImageResult'; requestId: string; ok: boolean; message?: string };

export type WebviewToHost =
  | { type: 'ready' }
  // Debounced live write-back. `rev` increments per message within a token's session.
  | { type: 'block.changed'; token: string; rev: number; content: string }
  // Conflict resolution "Keep mine" — overwrite the fence regardless of its current content.
  | { type: 'block.forceWrite'; token: string; rev: number; content: string }
  // Image canvas "Save": flatten the drawing to a new PNG in .lavagna/media/ and
  // replace the image line's link. The host answers with block.update carrying
  // the new line + imageUri (or block.writeFailed).
  | { type: 'canvas.save'; token: string; dataBase64: string; alt: string }
  // Set (or replace) the canvas image. `dialog` makes the host open a native
  // file picker; `blank` uses the bundled blank-canvas seed. Both end in the
  // same save → relink, and the host answers with block.update plus
  // canvas.setImageResult.
  | {
      type: 'canvas.setImage';
      token: string;
      requestId: string;
      alt: string;
      source: CanvasImageSource;
    }
  // `token` so the host can drop stragglers, like every other webview message.
  | { type: 'clipboard.write'; token: string; text: string; label?: string };
