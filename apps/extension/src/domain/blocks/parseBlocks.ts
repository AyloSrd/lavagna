// Single-pass scanner for fenced code blocks, GFM pipe tables, and standalone
// local-image lines. Fence semantics follow CommonMark: open with >=3 backticks
// or tildes indented at most 3 spaces; close with the same character, at least
// the opening length, nothing else on the line. A backtick-fence info string
// may not contain backticks.

import { BlockKind, LavagnaBlock } from './types';

// `(?!…)` pins the fence run to its full length. Without it a line of N
// backticks followed by a `\r` (which `.` won't cross, so the match fails)
// retried the `(.*)` tail from every shorter run length — quadratic. Shorter
// runs could never have matched anyway: their tail would only be longer.
const FENCE_OPEN = /^ {0,3}(`{3,}(?!`)|~{3,}(?!~))(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
// A line that is exactly one markdown image: `![alt](target)` or `![alt](target "title")`.
// The target may be EMPTY — `![canvas]()` is how a canvas with no image yet is
// written, and the editor opens it on the blank/upload chooser.
//
// This used to be one regex, `^ {0,3}!\[[^\]]*\]\([ \t]*([^)\s]*)(?:[ \t]+"[^"]*")?[ \t]*\)[ \t]*$`.
// Its whitespace runs overlap (`[ \t]*` before an empty target, `[ \t]+` in the
// title group, `[ \t]*` before `)`), so a single crafted line —
// `![a](` + 100k spaces + `x"` — cost seconds of backtracking, and every
// consumer re-parses on each keystroke. It is now a hand-written, strictly
// linear matcher that accepts exactly the same lines and returns exactly the
// same capture (the test suite checks that exhaustively against the old regex),
// behind a length cap that no real image line comes near.
const MAX_IMAGE_LINE_LENGTH = 2048;

const isBlank = (ch: string | undefined): boolean => ch === ' ' || ch === '\t';
const NOT_PAREN_OR_SPACE = /[^)\s]*/y; // the target: any run of non-`)`, non-whitespace

/** Index of the first char at or after `from` that is not a space or tab. */
function skipBlanks(s: string, from: number): number {
  let i = from;
  while (isBlank(s[i])) {
    i++;
  }
  return i;
}

/** Whether `s` from `from` is `[ \t]* ) [ \t]* <end>`. */
function closesWithParen(s: string, from: number): boolean {
  const i = skipBlanks(s, from);
  return s[i] === ')' && skipBlanks(s, i + 1) === s.length;
}

/**
 * Whether `s` from `at` (which must hold the opening `"`) is
 * `"title" [ \t]* ) [ \t]* <end>`. The title runs to the next `"`.
 */
function closesWithTitle(s: string, at: number): boolean {
  const close = s.indexOf('"', at + 1);
  return close !== -1 && closesWithParen(s, close + 1);
}

/**
 * The image target of a standalone image line (`''` for `![alt]()`), or null
 * when the line isn't one.
 */
function matchImageLine(line: string): string | null {
  if (line.length > MAX_IMAGE_LINE_LENGTH) {
    return null;
  }
  let i = 0;
  while (i < 3 && line[i] === ' ') {
    i++;
  }
  if (line[i] !== '!' || line[i + 1] !== '[') {
    return null;
  }
  const closeBracket = line.indexOf(']', i + 2); // `[^\]]*` runs to the first `]`
  if (closeBracket === -1 || line[closeBracket + 1] !== '(') {
    return null;
  }
  const start = closeBracket + 2;

  // Preferred reading: all leading blanks are padding, the target is the
  // longest run after them, and an optional ` "title"` may follow it.
  const afterPad = skipBlanks(line, start);
  NOT_PAREN_OR_SPACE.lastIndex = afterPad;
  const targetEnd = afterPad + (NOT_PAREN_OR_SPACE.exec(line)?.[0].length ?? 0);
  // The title needs at least one blank between it and the target, which itself
  // may contain quotes (`![a](x"y")` has the target `x"y"`).
  const titleAt = skipBlanks(line, targetEnd);
  if (
    closesWithParen(line, targetEnd) ||
    (titleAt > targetEnd && line[titleAt] === '"' && closesWithTitle(line, titleAt))
  ) {
    return line.slice(afterPad, targetEnd);
  }

  // Fallback, reachable only when the line starts `( "…`: the target is empty
  // and the blanks belong to the title group, so `]( "a b")` is an image with
  // no target (whereas `]("a b")` is not an image at all).
  if (afterPad > start && line[afterPad] === '"' && closesWithTitle(line, afterPad)) {
    return '';
  }
  return null;
}

const KIND_BY_LANGUAGE: Record<string, BlockKind> = {
  mermaid: 'mermaid',
  tree: 'tree',
};

/**
 * Extract the image target from a standalone image line — null if the line
 * isn't one, `''` if it is an image line with no target yet.
 */
export function imageTarget(line: string): string | null {
  return matchImageLine(line);
}

/** Local images are drawable; remote/data URIs are not. */
function isLocalTarget(target: string): boolean {
  return !/^(https?:|data:|vscode-)/i.test(target);
}

function isClosingFence(line: string, fenceChar: string, minLength: number): boolean {
  const m = line.match(FENCE_CLOSE);
  return m !== null && m[1][0] === fenceChar && m[1].length >= minLength;
}

/** Delimiter row of a GFM table: cells of -/: separated by pipes, at least one dash. */
function isDelimiterRow(line: string): boolean {
  const t = line.trim();
  return t.includes('-') && t.includes('|') && /^\|?[ \t:|-]+\|?$/.test(t);
}

export function parseBlocks(text: string): LavagnaBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: LavagnaBlock[] = [];
  const countByKind: Partial<Record<BlockKind, number>> = {};

  const push = (block: Omit<LavagnaBlock, 'indexOfKind'>) => {
    const n = countByKind[block.kind] ?? 0;
    countByKind[block.kind] = n + 1;
    blocks.push({ ...block, indexOfKind: n });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const open = line.match(FENCE_OPEN);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      const fenceChar = open[1][0];
      const fenceLength = open[1].length;
      const info = open[2].trim();
      const language = info ? info.split(/\s+/)[0].toLowerCase() : null;

      let close = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (isClosingFence(lines[j], fenceChar, fenceLength)) {
          close = j;
          break;
        }
      }
      const closed = close !== -1;
      const endLine = closed ? close : lines.length - 1;
      const contentStartLine = i + 1;
      const contentEndLine = closed ? close - 1 : lines.length - 1;
      const content =
        contentEndLine >= contentStartLine
          ? lines.slice(contentStartLine, contentEndLine + 1).join('\n')
          : '';

      push({
        kind: (language && KIND_BY_LANGUAGE[language]) || 'code',
        language,
        startLine: i,
        endLine,
        contentStartLine,
        contentEndLine,
        content,
        closed,
      });
      i = endLine + 1;
      continue;
    }

    const imageSrc = matchImageLine(line);
    if (imageSrc !== null && isLocalTarget(imageSrc)) {
      push({
        kind: 'image',
        language: null,
        startLine: i,
        endLine: i,
        contentStartLine: i,
        contentEndLine: i,
        content: line,
        closed: true,
      });
      i++;
      continue;
    }

    if (
      line.includes('|') &&
      !isDelimiterRow(line) &&
      i + 1 < lines.length &&
      isDelimiterRow(lines[i + 1])
    ) {
      let end = i + 1;
      while (end + 1 < lines.length) {
        const next = lines[end + 1];
        // A table ends at any block-level construct, as in GFM. Without this a
        // fence opener or image line that happens to contain a `|` was absorbed
        // as a table row — and the next table edit then deleted it.
        if (
          next.trim() === '' ||
          !next.includes('|') ||
          FENCE_OPEN.test(next) ||
          matchImageLine(next) !== null
        ) {
          break;
        }
        end++;
      }
      push({
        kind: 'table',
        language: null,
        startLine: i,
        endLine: end,
        contentStartLine: i,
        contentEndLine: end,
        content: lines.slice(i, end + 1).join('\n'),
        closed: true,
      });
      i = end + 1;
      continue;
    }

    i++;
  }

  return blocks;
}
