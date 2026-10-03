// Conversion between the tree's two text forms:
//  - "data"  : the source of truth, plain text indented 2 spaces per level
//              (what the <textarea> edits).
//  - "ascii" : the same tree rendered with box-drawing connectors, used both in
//              the editor's display layer and in the exported / serialized
//              markdown so parent/child structure is visible when pasted out.
//
// Each indent level is exactly INDENT_UNIT columns, and every connector segment
// is also INDENT_UNIT chars wide — so plain indentation and connector prefixes
// both decode to the same depth, and the two forms round-trip cleanly.

export const INDENT_UNIT = 2;

/** Leading-whitespace depth of a raw (space-indented) line; a tab counts as one level. */
export function depthOf(line: string): number {
  let spaces = 0;
  for (const ch of line) {
    if (ch === ' ') { spaces += 1; }
    else if (ch === '\t') { spaces += INDENT_UNIT; }
    else { break; }
  }
  return Math.floor(spaces / INDENT_UNIT);
}

/** Text of a line with its leading indentation stripped. */
export function nameOf(line: string): string {
  return line.replace(/^\s+/, '');
}

/** Is there another line at exactly `level` after `i`, before dedenting past it? */
export function hasFollowingSiblingAtLevel(depths: number[], i: number, level: number): boolean {
  for (let j = i + 1; j < depths.length; j++) {
    if (depths[j] < level) { return false; }
    if (depths[j] === level) { return true; }
  }
  return false;
}

/**
 * Connector prefix for line `i` — INDENT_UNIT chars per level (e.g. "│ └─").
 * Each call scans forward once per level, so this is O(depth × lines) when
 * called for every line; use `connectorPrefixes` for a whole tree.
 */
export function connectorPrefix(depths: number[], i: number): string {
  const depth = depths[i];
  let prefix = '';
  for (let level = 1; level <= depth; level++) {
    const continues = hasFollowingSiblingAtLevel(depths, i, level);
    if (level === depth) {
      prefix += continues ? '├─' : '└─';
    } else {
      prefix += continues ? '│ ' : '  ';
    }
  }
  return prefix;
}

/**
 * `connectorPrefix(depths, i)` for every line, in one backward pass.
 *
 * `open[level]` answers "is there a later line at exactly `level` before the
 * indentation drops below it?" for the line about to be visited. A line at
 * depth d is a later sibling at level d for everything above it, and a
 * dedent past every deeper level — so after visiting it, `open[d]` is true and
 * levels above d are false. Clearing those lazily (`top` is the highest level
 * with a meaningful entry) keeps the work proportional to the prefix lengths
 * produced, i.e. to the size of the output.
 */
export function connectorPrefixes(depths: number[]): string[] {
  const prefixes = new Array<string>(depths.length);
  const open: boolean[] = [];
  let top = 0;
  for (let i = depths.length - 1; i >= 0; i--) {
    const depth = depths[i];
    while (top < depth) {
      top += 1;
      open[top] = false;
    }
    let prefix = '';
    for (let level = 1; level <= depth; level++) {
      if (level === depth) {
        prefix += open[level] ? '├─' : '└─';
      } else {
        prefix += open[level] ? '│ ' : '  ';
      }
    }
    prefixes[i] = prefix;
    top = depth;
    open[depth] = true;
  }
  return prefixes;
}

/** Render space-indented `data` into connector form (for export / serialization). */
export function toAscii(data: string): string {
  const lines = data.split('\n');
  const prefixes = connectorPrefixes(lines.map(depthOf));
  return lines.map((line, i) => prefixes[i] + nameOf(line)).join('\n');
}

// The visual editor refuses trees past these limits and shows the read-only
// fallback instead, like the table, flowchart and sequence editors do for
// theirs. The byte cap matches theirs; the line cap bounds the number of rows
// (one <input> each) the editor would mount.
export const MAX_TREE_BYTES = 100_000;
export const MAX_TREE_LINES = 2000;

/** Too big to edit visually — the caller falls back to read-only. */
export function isTreeTooLarge(text: string): boolean {
  if (text.length > MAX_TREE_BYTES) {
    return true;
  }
  let lines = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    lines += 1;
    if (lines > MAX_TREE_LINES) {
      return true;
    }
  }
  return false;
}

const SEGMENT = /^[│├└─ ]{2}$/;

/** Decode connector form (or plain indentation) back to space-indented `data`. */
export function fromAscii(text: string): string {
  return text
    .split('\n')
    .map(line => {
      let i = 0;
      let depth = 0;
      while (i + INDENT_UNIT <= line.length && SEGMENT.test(line.slice(i, i + INDENT_UNIT))) {
        depth += 1;
        i += INDENT_UNIT;
      }
      const name = line.slice(i).replace(/^[│├└─]+\s*/, '');
      return ' '.repeat(depth * INDENT_UNIT) + name;
    })
    .join('\n');
}
