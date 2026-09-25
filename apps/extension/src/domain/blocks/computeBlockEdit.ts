// Turns "replace this block's content" into a line-range edit against the
// document as it is NOW. Callers must pass the current text right before
// applying — never a stale parse.

import { BlockRef } from './types';
import { parseBlocks } from './parseBlocks';

export interface BlockEdit {
  /** Half-open line range [startLine, endLineExclusive) to replace. */
  startLine: number;
  endLineExclusive: number;
  /** Replacement text; '\n'-terminated per line, '' to delete the range. */
  newText: string;
}

/**
 * Re-parses `currentText`, relocates `ref` by (kind, indexOfKind), and returns
 * the content-line replacement — or null if the block no longer exists.
 * For fenced blocks only the fence body is replaced; for tables and images the
 * whole block.
 * For a fence left unclosed at EOF the range may extend one line past the end;
 * hosts should validate the range against the document.
 */
export function computeBlockEdit(
  currentText: string,
  ref: BlockRef,
  newContent: string,
): BlockEdit | null {
  const block = parseBlocks(currentText).find(
    (b) => b.kind === ref.kind && b.indexOfKind === ref.indexOfKind,
  );
  if (!block) {
    return null;
  }
  // An unclosed fence "contains" everything to end-of-file, so writing to it
  // would replace the whole remainder of the document — silent data loss, and
  // the deleted text is usually below the viewport. Refuse instead. (This also
  // removes the degenerate past-the-end range that `validateRange` used to
  // clamp into the middle of the fence line.)
  if (!block.closed) {
    return null;
  }

  const body = newContent.replace(/\r?\n$/, '');
  const newText = body.length > 0 ? body + '\n' : '';

  if (block.kind === 'table' || block.kind === 'image') {
    return { startLine: block.startLine, endLineExclusive: block.endLine + 1, newText };
  }

  const startLine = block.contentStartLine;
  const endLineExclusive = Math.max(block.contentEndLine + 1, startLine);
  return { startLine, endLineExclusive, newText };
}
