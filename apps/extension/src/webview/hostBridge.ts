import type {
  BlockInitMessage,
  CanvasImageSource,
  CanvasImageState,
  HostToWebview,
} from '../shared/messages';
import { postToHost } from './vscodeApi';

// Inbound host→webview channel. The webview posts `ready` on start-up and the
// host replies with `block.init` (possibly again later, to retarget the panel
// to another block). Media saves are request/response pairs keyed by requestId;
// block.* messages are filtered by the current session token.

let mediaBaseUri: string | null = null;
let currentToken: string | null = null;

export interface BlockLifecycleHandler {
  onInit(msg: BlockInitMessage): void;
  onUpdate(content: string, imageUri: string | null, imageState: CanvasImageState | null): void;
  onAck(rev: number): void;
  onWriteFailed(rev: number, message: string): void;
  onGone(): void;
}

export interface SetImageResult {
  ok: boolean;
  /** Absent when the user simply cancelled the file dialog. */
  message?: string;
}

let blockHandler: BlockLifecycleHandler | null = null;


const settingImage = new Map<string, (result: SetImageResult) => void>();

function onMessage(event: MessageEvent<HostToWebview>): void {
  const msg = event.data;
  switch (msg.type) {
    case 'block.init':
      currentToken = msg.token;
      mediaBaseUri = msg.mediaBaseUri;
      blockHandler?.onInit(msg);
      break;
    case 'block.update':
      if (msg.token === currentToken) {
        blockHandler?.onUpdate(msg.content, msg.imageUri, msg.imageState);
      }
      break;
    case 'canvas.setImageResult':
      settingImage.get(msg.requestId)?.({ ok: msg.ok, message: msg.message });
      settingImage.delete(msg.requestId);
      break;
    case 'block.ack':
      if (msg.token === currentToken) { blockHandler?.onAck(msg.rev); }
      break;
    case 'block.writeFailed':
      if (msg.token === currentToken) { blockHandler?.onWriteFailed(msg.rev, msg.message); }
      break;
    case 'block.gone':
      if (msg.token === currentToken) { blockHandler?.onGone(); }
      break;
  }
}

/** Attach the listener and announce readiness. Call once, before rendering. */
export function initHostBridge(handler: BlockLifecycleHandler): void {
  blockHandler = handler;
  window.addEventListener('message', onMessage);
  postToHost({ type: 'ready' });
}


/** Debounced write-back (or force overwrite after a conflict). */
export function postBlockChange(rev: number, content: string, force: boolean): void {
  if (!currentToken) {
    return;
  }
  postToHost({
    type: force ? 'block.forceWrite' : 'block.changed',
    token: currentToken,
    rev,
    content,
  });
}

export function copyToClipboard(text: string, label?: string): void {
  if (!currentToken) {
    return;
  }
  postToHost({ type: 'clipboard.write', token: currentToken, text, label });
}

/**
 * Set or replace the canvas image. `dialog` opens the host's native picker,
 * `blank` uses the bundled blank page. The new image arrives separately as
 * block.update; this resolves with the outcome so the caller can clear its
 * busy state.
 */
export function setCanvasImage(source: CanvasImageSource, alt: string): Promise<SetImageResult> {
  const token = currentToken;
  if (!token) {
    return Promise.resolve({ ok: false, message: 'No block is open.' });
  }
  const requestId = crypto.randomUUID();
  return new Promise<SetImageResult>((resolve) => {
    settingImage.set(requestId, resolve);
    postToHost({ type: 'canvas.setImage', token, requestId, alt, source });
  });
}

/** Image canvas Save: flatten to a new PNG and relink the image line (host-side). */
export function saveCanvas(dataBase64: string, alt: string): void {
  if (!currentToken) {
    return;
  }
  postToHost({ type: 'canvas.save', token: currentToken, dataBase64, alt });
}


