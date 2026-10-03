// Magic-byte sniffing for canvas images: the format comes from the bytes, never
// from a file name, and SVG (script-capable markup) is never accepted.

import * as assert from 'assert';
import { suite, test } from 'vitest';
import { MAX_IMAGE_BYTES, sniffImageType } from '../../domain/media/imageType';

function bytes(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    out.push(...(typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : part));
  }
  return new Uint8Array(out);
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A BMP file header (14 bytes) followed by a DIB header of the given size. */
function bmp(dibSize: number): Uint8Array {
  return bytes('BM', [0, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0], [dibSize & 0xff, (dibSize >> 8) & 0xff, 0, 0], [0, 0, 0, 0]);
}

suite('sniffImageType', () => {
  test('recognises PNG, JPEG, GIF (both versions), WebP and BMP', () => {
    assert.strictEqual(sniffImageType(bytes(PNG, [0, 0, 0, 13])), 'png');
    assert.strictEqual(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF')), 'jpg');
    assert.strictEqual(sniffImageType(bytes('GIF87a', [1, 0])), 'gif');
    assert.strictEqual(sniffImageType(bytes('GIF89a', [1, 0])), 'gif');
    assert.strictEqual(sniffImageType(bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 ')), 'webp');
    assert.strictEqual(sniffImageType(bmp(40)), 'bmp');
    assert.strictEqual(sniffImageType(bmp(124)), 'bmp');
  });

  test('refuses SVG, with or without an XML prolog', () => {
    assert.strictEqual(sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
    assert.strictEqual(sniffImageType(bytes('<?xml version="1.0"?><svg onload="x()"></svg>')), null);
  });

  test('refuses other formats and text, even ones that start like an image', () => {
    assert.strictEqual(sniffImageType(bytes('%PDF-1.7')), null);
    assert.strictEqual(sniffImageType(bytes('MZ', [0x90, 0])), null);
    assert.strictEqual(sniffImageType(bytes('<html><script>alert(1)</script>')), null);
    assert.strictEqual(sniffImageType(bytes('GIF90a')), null);
    // RIFF but not WebP (a WAV, say).
    assert.strictEqual(sniffImageType(bytes('RIFF', [0x24, 0, 0, 0], 'WAVEfmt ')), null);
    // "BM" alone is two bytes of text, not a bitmap.
    assert.strictEqual(sniffImageType(bytes('BM', [...'itmap of the plan, see below'].map((c) => c.charCodeAt(0)))), null);
    assert.strictEqual(sniffImageType(bmp(7)), null);
  });

  test('refuses empty and truncated input without throwing', () => {
    assert.strictEqual(sniffImageType(new Uint8Array()), null);
    assert.strictEqual(sniffImageType(bytes([0x89, 0x50])), null);
    assert.strictEqual(sniffImageType(bytes([0xff, 0xd8])), null);
    assert.strictEqual(sniffImageType(bytes('RIFF', [0, 0, 0, 0], 'WEB')), null);
    assert.strictEqual(sniffImageType(bytes('BM')), null);
  });

  test('the size cap is 32 MB', () => {
    assert.strictEqual(MAX_IMAGE_BYTES, 32 * 1024 * 1024);
  });
});
