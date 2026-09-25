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

/** Connector prefix for line `i` — INDENT_UNIT chars per level (e.g. "│ └─"). */
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

/** Render space-indented `data` into connector form (for export / serialization). */
export function toAscii(data: string): string {
  const lines = data.split('\n');
  const depths = lines.map(depthOf);
  return lines.map((line, i) => connectorPrefix(depths, i) + nameOf(line)).join('\n');
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
