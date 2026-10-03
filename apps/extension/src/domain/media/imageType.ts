// Which image formats a canvas may hold, decided from the bytes themselves.
// Pure — no vscode. A file name is a claim, not a fact: the "Choose image"
// picker filters by extension, but a user can switch it to "All files", and
// the extension we would write under `.lavagna/media/` must not come from a
// name someone else chose. SVG is deliberately absent — it is script-capable
// markup, not pixels.

/** Largest image we will read or write. A flattened canvas is a PNG of a bounded stage. */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

export type ImageType = 'png' | 'jpg' | 'gif' | 'webp' | 'bmp';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
const BMP_DIB_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  return startsWith(bytes, [...text].map((c) => c.charCodeAt(0)), offset);
}

/**
 * The format of `bytes` by its magic number, or null when it is none of PNG,
 * JPEG, GIF, WebP or BMP. BMP's signature is only two bytes (`BM`), so its DIB
 * header size is checked as well — otherwise any text starting with "BM" passes.
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, PNG)) {
    return 'png';
  }
  if (startsWith(bytes, JPEG)) {
    return 'jpg';
  }
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) {
    return 'gif';
  }
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
    return 'webp';
  }
  if (ascii(bytes, 0, 'BM') && bytes.length >= 18) {
    const dibSize = bytes[14] | (bytes[15] << 8) | (bytes[16] << 16) | (bytes[17] << 24);
    if (BMP_DIB_HEADER_SIZES.has(dibSize)) {
      return 'bmp';
    }
  }
  return null;
}
