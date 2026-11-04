// Tokenizer for the read-only mermaid preview pane. It only has to colour the
// subset the visual editors write (flowchart and sequenceDiagram), and never
// throws: anything it does not recognise comes back as plain text, so the
// joined tokens always reproduce the input line exactly.

export type TokenKind = 'keyword' | 'arrow' | 'string' | 'comment' | 'plain';

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set([
  'flowchart', 'graph', 'direction', 'subgraph', 'end',
  'TD', 'TB', 'BT', 'LR', 'RL',
  'sequenceDiagram', 'participant', 'actor', 'as', 'autonumber',
  'Note', 'note', 'over', 'left', 'right', 'of',
  'loop', 'alt', 'else', 'opt', 'par', 'and', 'critical', 'break', 'rect',
  'activate', 'deactivate',
]);

// Longest operators first, so `-->>` is not read as `-->` + `>`.
const ARROW = /-->>|->>|--\)|-\)|--x|-x|-\.->|-\.-|-->|---|==>|===|->|--/y;
const COMMENT = /%%.*/y;
const QUOTED = /"[^"]*"?/y;
const PIPED = /\|[^|]*\|?/y;
const WORD = /[A-Za-z_]\w*/y;
const SPACE = /\s+/y;

function matchAt(re: RegExp, line: string, pos: number): string | null {
  re.lastIndex = pos;
  const m = re.exec(line);
  return m ? m[0] : null;
}

export function highlightLine(line: string): Token[] {
  const out: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind === 'plain') {
      last.text += text;
    } else {
      out.push({ kind, text });
    }
  };
  let pos = 0;
  while (pos < line.length) {
    let m: string | null;
    if ((m = matchAt(COMMENT, line, pos))) {
      push('comment', m);
    } else if ((m = matchAt(QUOTED, line, pos)) || (m = matchAt(PIPED, line, pos))) {
      push('string', m);
    } else if ((m = matchAt(ARROW, line, pos))) {
      push('arrow', m);
    } else if ((m = matchAt(WORD, line, pos))) {
      push(KEYWORDS.has(m) ? 'keyword' : 'plain', m);
    } else if ((m = matchAt(SPACE, line, pos))) {
      push('plain', m);
    } else {
      m = line[pos];
      push('plain', m);
    }
    pos += m.length;
  }
  return out;
}

/**
 * Indexes of the lines in `next` that differ from `prev` — a line counts as
 * changed when the same index held different text, or did not exist.
 */
export function changedLines(prev: string, next: string): number[] {
  const a = prev.split('\n');
  const b = next.split('\n');
  const changed: number[] = [];
  b.forEach((line, i) => {
    if (a[i] !== line) {
      changed.push(i);
    }
  });
  return changed;
}
