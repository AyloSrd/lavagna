// Formatting and parsing of file references used in boards. Pure — no vscode.
//
// A reference is a markdown link whose visible text is the path (plus a line
// suffix) and whose target is an openable path (plus a GitHub-style `#L`
// fragment):
//   [src/foo.ts](src/foo.ts)
//   [src/foo.ts:12](src/foo.ts#L12)
//   [src/foo.ts:12-40](src/foo.ts#L12-L40)

/** 1-based, inclusive line range. */
export interface RefLines {
  start: number;
  end: number;
}

const UNSAFE_IN_LINK = /[\u0000-\u001f\u007f[\]`]/g;

function toForwardSlashes(path: string): string {
  return path.split('\\').join('/');
}

function fragment(lines?: RefLines): string {
  // Always anchor the target with a line fragment — even a whole-file ref gets
  // `#L1`. VS Code's built-in markdown link provider competes for the click on
  // fragment-less targets (and resolves them document-relative, wrongly); it
  // leaves `#L…` targets alone, so anchoring lets our link provider own every
  // reference. The visible text stays clean (no `:1` suffix for whole-file).
  if (!lines) {
    return '#L1';
  }
  return lines.start === lines.end ? `#L${lines.start}` : `#L${lines.start}-L${lines.end}`;
}

function suffix(lines?: RefLines): string {
  if (!lines) {
    return '';
  }
  return lines.start === lines.end ? `:${lines.start}` : `:${lines.start}-${lines.end}`;
}

export function formatFileRef(relPath: string, lines?: RefLines): string {
  // A filename may legally contain newlines or brackets (git carries them),
  // which would break out of the markdown link and inject content — an
  // unclosed fence in a board is a data-loss trigger, not just a glitch.
  const path = toForwardSlashes(relPath).replace(UNSAFE_IN_LINK, '_');
  const target = path + fragment(lines);
  // A markdown link target containing spaces or parens must be angle-wrapped.
  const wrappedTarget = /[ ()<>]/.test(target) ? `<${target.replace(/[<>]/g, '_')}>` : target;
  // The `@` is display-only — it marks the text as a filesystem reference
  // (Cursor-style). The target stays clean so the link still resolves.
  return `[@${path}${suffix(lines)}](${wrappedTarget})`;
}

/**
 * Parse the *target* of a reference (the part inside the parentheses) back into
 * its path and optional line range. Returns null if there is no path.
 * `<src/foo bar.ts#L12-L40>` → { path: 'src/foo bar.ts', lines: {12,40} }
 */
export function parseFileRefTarget(target: string): { path: string; lines?: RefLines } | null {
  const unwrapped = target.replace(/^<|>$/g, '');
  const m = /^(.*?)(?:#L(\d+)(?:-L(\d+))?)?$/.exec(unwrapped);
  if (!m || !m[1]) {
    return null;
  }
  const [, path, s, e] = m;
  if (!s) {
    return { path };
  }
  const start = Number(s);
  const end = e ? Number(e) : start;
  // Board content can say `#L` + 400 nines, which becomes Infinity and then a
  // non-finite vscode.Position. Drop the range rather than propagate it.
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    return { path };
  }
  return { path, lines: { start, end } };
}
