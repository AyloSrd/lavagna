// Recovering where a clipboard payload came from, without the host's help.
//
// The paste API's `prepareDocumentPaste` is the precise way to carry a copy's
// origin, but it only fires if the host routes the copy through its own
// copy-paste controller — which can't be relied on (it doesn't happen for
// `editor.action.clipboardCopyAction` at all, and reportedly not for a plain
// paste in some builds). So the origin is recovered instead: recent selections
// are remembered, and the clipboard text is matched against them.
//
// The clipboard text is what makes this a lookup rather than a guess. A match
// requires the remembered text to equal the clipboard byte for byte, and the
// caller re-reads the file to confirm the range still holds that text before
// using it. No fuzzy matching, no "closest" answer — either it's the same text
// or there's no source.

/** A selection that was on screen recently, and might be what's on the clipboard. */
export interface CopySource {
  /** Workspace-root-relative, forward slashes. */
  path: string;
  /** The source's workspace folder, as a URI string. */
  folder: string;
  /** 1-based, inclusive. */
  start: number;
  end: number;
  /** Exactly the selected text, as it was when selected. */
  text: string;
}

/** Longest selection worth remembering; past this it's not a code reference. */
export const MAX_TRACKED_TEXT = 100_000;
/** How many selections to keep. Small: only the recent past can be on the clipboard. */
export const MAX_TRACKED = 30;

/**
 * Normalize for comparison only — never for insertion. Line endings differ
 * between what a document holds and what the clipboard returns, and copying a
 * whole line contributes a trailing newline the selection itself didn't have.
 */
function comparable(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

/** Whether a remembered selection holds the same text as the clipboard. */
export function sameText(a: string, b: string): boolean {
  return comparable(a) === comparable(b);
}

/**
 * The most recently remembered selection whose text is exactly the clipboard's.
 *
 * `entries` must be most-recent-first: with the same text selected in two
 * places, the latest is the one the user copied. Empty or whitespace-only
 * clipboards never match — every file would tie.
 */
export function findCopySource(
  entries: readonly CopySource[],
  clipboard: string,
): CopySource | null {
  if (!clipboard.trim()) {
    return null;
  }
  return entries.find((entry) => sameText(entry.text, clipboard)) ?? null;
}

/**
 * Push `entry` onto a most-recent-first list, dropping any previous record of
 * the same range and trimming to `MAX_TRACKED`.
 */
export function remember(
  entries: readonly CopySource[],
  entry: CopySource,
): CopySource[] {
  const same = (o: CopySource) =>
    o.path === entry.path && o.start === entry.start && o.end === entry.end;
  return [entry, ...entries.filter((o) => !same(o))].slice(0, MAX_TRACKED);
}
