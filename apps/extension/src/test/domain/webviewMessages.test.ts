// What the block-editor webview posts is validated before any handler sees it:
// wrong types and oversized strings are dropped, never coerced.

import * as assert from 'assert';
import { suite, test } from 'vitest';
import {
  MAX_ALT_CHARS,
  MAX_BLOCK_CONTENT_CHARS,
  MAX_CLIPBOARD_CHARS,
  MAX_IMAGE_BASE64_CHARS,
  MAX_LABEL_CHARS,
  parseWebviewMessage,
} from '../../presentation/webviewMessages';

function ok(raw: unknown) {
  const parsed = parseWebviewMessage(raw);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.reason);
  return parsed.msg;
}

function rejected(raw: unknown): void {
  assert.strictEqual(parseWebviewMessage(raw).ok, false, JSON.stringify(raw)?.slice(0, 80));
}

suite('parseWebviewMessage', () => {
  test('well-formed messages of every type pass', () => {
    assert.deepStrictEqual(ok({ type: 'ready' }), { type: 'ready' });
    assert.deepStrictEqual(ok({ type: 'block.changed', token: 't', rev: 3, content: 'x' }), {
      type: 'block.changed', token: 't', rev: 3, content: 'x',
    });
    assert.deepStrictEqual(ok({ type: 'block.forceWrite', token: 't', rev: 0, content: '' }), {
      type: 'block.forceWrite', token: 't', rev: 0, content: '',
    });
    assert.deepStrictEqual(ok({ type: 'canvas.save', token: 't', dataBase64: 'AAAA', alt: 'a' }), {
      type: 'canvas.save', token: 't', dataBase64: 'AAAA', alt: 'a',
    });
    assert.deepStrictEqual(ok({ type: 'canvas.setImage', token: 't', requestId: 'r', alt: '', source: 'blank' }), {
      type: 'canvas.setImage', token: 't', requestId: 'r', alt: '', source: 'blank',
    });
    assert.deepStrictEqual(ok({ type: 'clipboard.write', token: 't', text: 'hi', label: 'L' }), {
      type: 'clipboard.write', token: 't', text: 'hi', label: 'L',
    });
    assert.deepStrictEqual(ok({ type: 'clipboard.write', token: 't', text: 'hi' }), {
      type: 'clipboard.write', token: 't', text: 'hi', label: undefined,
    });
  });

  test('extra fields are dropped from the parsed message', () => {
    const msg = ok({ type: 'block.changed', token: 't', rev: 1, content: 'x', evil: { a: 1 } });
    assert.deepStrictEqual(Object.keys(msg).sort(), ['content', 'rev', 'token', 'type']);
  });

  test('non-objects, unknown and missing types are refused', () => {
    for (const raw of [undefined, null, 'ready', 7, [], [{ type: 'ready' }], {}, { type: 5 }, { type: 'shell.exec' }, { type: 'toString' }]) {
      rejected(raw);
    }
  });

  test('wrong field types are refused, not coerced', () => {
    rejected({ type: 'block.changed', token: 1, rev: 1, content: 'x' });
    rejected({ type: 'block.changed', token: 't', rev: '1', content: 'x' });
    rejected({ type: 'block.changed', token: 't', rev: 1.5, content: 'x' });
    rejected({ type: 'block.changed', token: 't', rev: -1, content: 'x' });
    rejected({ type: 'block.changed', token: 't', rev: NaN, content: 'x' });
    rejected({ type: 'block.changed', token: 't', rev: 1, content: { toString: 'x' } });
    rejected({ type: 'block.forceWrite', token: 't', rev: 1 });
    rejected({ type: 'canvas.save', token: 't', dataBase64: [1, 2], alt: '' });
    rejected({ type: 'canvas.save', token: 't', dataBase64: 'AA', alt: 5 });
    rejected({ type: 'canvas.save', token: 't', dataBase64: 'AA' });
    rejected({ type: 'canvas.setImage', token: 't', requestId: 'r', alt: '', source: 'url' });
    rejected({ type: 'canvas.setImage', token: 't', requestId: 3, alt: '', source: 'blank' });
    rejected({ type: 'clipboard.write', token: 't', text: 5 });
    rejected({ type: 'clipboard.write', token: 't', text: 'x', label: 5 });
    rejected({ type: 'clipboard.write', text: 'x' });
  });

  test('oversized strings are refused at the caps', () => {
    const content = (n: number) => ({ type: 'block.changed', token: 't', rev: 1, content: 'x'.repeat(n) });
    ok(content(MAX_BLOCK_CONTENT_CHARS));
    rejected(content(MAX_BLOCK_CONTENT_CHARS + 1));

    const save = (data: number, alt: number) => ({
      type: 'canvas.save', token: 't', dataBase64: 'A'.repeat(data), alt: 'a'.repeat(alt),
    });
    ok(save(MAX_IMAGE_BASE64_CHARS, MAX_ALT_CHARS));
    rejected(save(MAX_IMAGE_BASE64_CHARS + 1, 0));

    rejected({ type: 'canvas.setImage', token: 't'.repeat(1000), requestId: 'r', alt: '', source: 'dialog' });
    rejected({ type: 'canvas.setImage', token: 't', requestId: 'r'.repeat(1000), alt: '', source: 'dialog' });
  });

  test('over-long alt and label are cut to the cap, not dropped', () => {
    // A dropped canvas.setImage would leave the webview's "Choose image" busy forever.
    const set = ok({ type: 'canvas.setImage', token: 't', requestId: 'r', alt: 'a'.repeat(MAX_ALT_CHARS + 5), source: 'dialog' });
    assert.strictEqual(set.type === 'canvas.setImage' && set.alt, 'a'.repeat(MAX_ALT_CHARS));
    const save = ok({ type: 'canvas.save', token: 't', dataBase64: 'AAAA', alt: 'a'.repeat(MAX_ALT_CHARS + 5) });
    assert.strictEqual(save.type === 'canvas.save' && save.alt.length, MAX_ALT_CHARS);
    const clip = ok({ type: 'clipboard.write', token: 't', text: 'x', label: 'l'.repeat(MAX_LABEL_CHARS + 5) });
    assert.strictEqual(clip.type === 'clipboard.write' && clip.label?.length, MAX_LABEL_CHARS);
  });

  test('clipboard text over the cap is cut, not refused', () => {
    const msg = ok({ type: 'clipboard.write', token: 't', text: 'x'.repeat(MAX_CLIPBOARD_CHARS + 50) });
    assert.strictEqual(msg.type === 'clipboard.write' && msg.text.length, MAX_CLIPBOARD_CHARS);
  });

  test('the image cap admits a 32 MB image and no more than a padded base64 of it', () => {
    assert.strictEqual(MAX_IMAGE_BASE64_CHARS, Math.ceil((32 * 1024 * 1024) / 3) * 4);
  });
});
