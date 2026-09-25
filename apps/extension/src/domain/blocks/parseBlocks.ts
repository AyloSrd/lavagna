// Single-pass scanner for fenced code blocks, GFM pipe tables, and standalone
// local-image lines. Fence semantics follow CommonMark: open with >=3 backticks
// or tildes indented at most 3 spaces; close with the same character, at least
// the opening length, nothing else on the line. A backtick-fence info string
// may not contain backticks.

import { BlockKind, LavagnaBlock } from './types';

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
// A line that is exactly one markdown image: `![alt](target)` or `![alt](target "title")`.
// The target may be EMPTY — `![canvas]()` is how a canvas with no image yet is
// written, and the editor opens it on the blank/upload chooser.
// `[ \t]*` rather than `\s*`: three adjacent unbounded whitespace runs before a
// `\)` that can fail is quadratic to backtrack, and a single crafted line was
// enough to stall every consumer (they re-parse on each keystroke).
const IMAGE_LINE = /^ {0,3}!\[[^\]]*\]\([ \t]*([^)\s]*)(?:[ \t]+"[^"]*")?[ \t]*\)[ \t]*$/;

const KIND_BY_LANGUAGE: Record<string, BlockKind> = {
  mermaid: 'mermaid',
  tree: 'tree',
};

/**
 * Extract the image target from a standalone image line — null if the line
 * isn't one, `''` if it is an image line with no target yet.
 */
export function imageTarget(line: string): string | null {
  return line.match(IMAGE_LINE)?.[1] ?? null;
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

    const image = line.match(IMAGE_LINE);
    if (image && isLocalTarget(image[1])) {
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
          IMAGE_LINE.test(next)
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
