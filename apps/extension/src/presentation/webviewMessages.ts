import { MAX_IMAGE_BYTES } from '../domain/media/imageType';
import { WebviewToHost } from '../shared/messages';

// Validation of what the block-editor webview posts. Pure — no `vscode` — so
// the unit tests can feed it hostile shapes. The webview is a browser page
// running our bundle, but it renders board content (Mermaid, markdown, image
// files) and a bug or injection there must not be able to push the host into
// type errors or unbounded allocations: every field is type-checked and every
// string capped before any handler sees it.

/** Longest block body accepted. The same bound the link scanner uses for a whole board. */
export const MAX_BLOCK_CONTENT_CHARS = 1_000_000;
/** Longest clipboard payload kept (anything beyond is cut). */
export const MAX_CLIPBOARD_CHARS = 100_000;
/** Image alt text and the toast label: a line of text, not a document. */
export const MAX_ALT_CHARS = 2_048;
export const MAX_LABEL_CHARS = 2_048;
/** Session tokens and request ids are UUIDs. */
const MAX_ID_CHARS = 128;
/** Base64 of a MAX_IMAGE_BYTES image, plus padding. */
export const MAX_IMAGE_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

export type ParsedMessage = { ok: true; msg: WebviewToHost } | { ok: false; reason: string };

type Obj = Record<string, unknown>;

function bad(reason: string): ParsedMessage {
  return { ok: false, reason };
}

function str(o: Obj, key: string, max: number): string | undefined {
  const v = o[key];
  return typeof v === 'string' && v.length <= max ? v : undefined;
}

/** A string cut to `max` characters; undefined when it is not a string at all. */
function clipped(o: Obj, key: string, max: number): string | undefined {
  const v = o[key];
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

/** Narrow an untrusted `postMessage` payload to a WebviewToHost, or say why not. */
export function parseWebviewMessage(raw: unknown): ParsedMessage {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return bad('not an object');
  }
  const o = raw as Obj;
  switch (o.type) {
    case 'ready':
      return { ok: true, msg: { type: 'ready' } };

    case 'block.changed':
    case 'block.forceWrite': {
      const token = str(o, 'token', MAX_ID_CHARS);
      const content = str(o, 'content', MAX_BLOCK_CONTENT_CHARS);
      const rev = o.rev;
      if (token === undefined || content === undefined || typeof rev !== 'number' || !Number.isSafeInteger(rev) || rev < 0) {
        return bad(`${o.type}: malformed token, rev or content (or content over ${MAX_BLOCK_CONTENT_CHARS} characters)`);
      }
      return { ok: true, msg: { type: o.type, token, rev, content } };
    }

    case 'canvas.save': {
      const token = str(o, 'token', MAX_ID_CHARS);
      const dataBase64 = str(o, 'dataBase64', MAX_IMAGE_BASE64_CHARS);
      // Over-long alt text is cut, not a reason to drop the message: the
      // webview waits on an answer and would never get one.
      const alt = clipped(o, 'alt', MAX_ALT_CHARS);
      if (token === undefined || dataBase64 === undefined || alt === undefined) {
        return bad('canvas.save: malformed token, image data or alt (or the image too long)');
      }
      return { ok: true, msg: { type: 'canvas.save', token, dataBase64, alt } };
    }

    case 'canvas.setImage': {
      const token = str(o, 'token', MAX_ID_CHARS);
      const requestId = str(o, 'requestId', MAX_ID_CHARS);
      const alt = clipped(o, 'alt', MAX_ALT_CHARS); // cut, not dropped: the busy state must clear
      const source = o.source;
      if (token === undefined || requestId === undefined || alt === undefined || (source !== 'dialog' && source !== 'blank')) {
        return bad('canvas.setImage: malformed token, requestId, alt or source');
      }
      return { ok: true, msg: { type: 'canvas.setImage', token, requestId, alt, source } };
    }

    case 'clipboard.write': {
      const token = str(o, 'token', MAX_ID_CHARS);
      // Longer text is cut rather than refused, as it always was.
      const text = typeof o.text === 'string' ? o.text.slice(0, MAX_CLIPBOARD_CHARS) : undefined;
      const label = o.label === undefined ? undefined : clipped(o, 'label', MAX_LABEL_CHARS);
      if (token === undefined || text === undefined || (o.label !== undefined && label === undefined)) {
        return bad('clipboard.write: malformed token, text or label');
      }
      return { ok: true, msg: { type: 'clipboard.write', token, text, label } };
    }

    default:
      return bad(`unknown message type ${typeof o.type === 'string' ? JSON.stringify(o.type.slice(0, 40)) : typeof o.type}`);
  }
}
