import { duplicateMarks } from './geometry';
import { Mark, newMarkId, newSeed } from './model';

// Copy and paste of marks. The copies stay in the page: an image mark names a
// picture decoded here (images.ts), which means nothing to another program,
// so the system clipboard is left alone. The panel is one page for every
// block, so marks copied on one canvas paste into another.

/** How far each paste lands from the last, in image pixels. */
export const PASTE_STEP = 16;

let clip: { marks: Mark[]; pastes: number } | null = null;

/**
 * Remember `selected` for pasting. Arrow ends attached to marks left behind
 * freeze where they are drawn now, so the copy does not depend on them.
 */
export function copyMarks(selected: readonly Mark[], all: readonly Mark[]): void {
  if (selected.length === 0) {
    return;
  }
  clip = { marks: duplicateMarks(selected, all, 0, newMarkId, newSeed), pastes: 0 };
}

export const hasCopiedMarks = (): boolean => clip !== null;

/**
 * Fresh copies of the copied marks, each paste a step further down and right
 * so repeated pastes don't stack exactly. Null when nothing was copied.
 */
export function pasteMarks(): Mark[] | null {
  if (!clip) {
    return null;
  }
  clip.pastes += 1;
  return duplicateMarks(clip.marks, clip.marks, PASTE_STEP * clip.pastes, newMarkId, newSeed);
}

/** Forget the copied marks (tests). */
export function clearCopiedMarks(): void {
  clip = null;
}
