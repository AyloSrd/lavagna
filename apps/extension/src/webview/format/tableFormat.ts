// GFM pipe-table ↔ structured data. The block content for a table is the WHOLE
// table (header, delimiter, rows) — there are no fences. Cells are single-line;
// pipes inside cells are escaped as \|.

export type Align = 'left' | 'center' | 'right' | null;

export interface TableData {
  header: string[];
  /** Per-column alignment from the delimiter row (null = unspecified). */
  align: Align[];
  rows: string[][];
}

/** Split one table line into cells, honoring \| escapes and outer pipes. */
function splitRow(line: string): string[] {
  let inner = line.trim();
  if (inner.startsWith('|')) { inner = inner.slice(1); }
  if (inner.endsWith('|') && !inner.endsWith('\\|')) { inner = inner.slice(0, -1); }
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') {
      current += '|';
      i++;
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

const DELIMITER_CELL = /^:?-+:?$/;

// Rows are padded to the header width, so cost is rows x cols from an input of
// rows + cols: 20k columns x 2k rows is an 88 KB board that expands to 40M
// cells and one <input> each. Past these limits the caller shows the read-only
// fallback instead.
const MAX_COLUMNS = 200;
const MAX_ROWS = 2000;

function parseAlign(cell: string): Align {
  const starts = cell.startsWith(':');
  const ends = cell.endsWith(':');
  if (starts && ends) { return 'center'; }
  if (ends) { return 'right'; }
  if (starts) { return 'left'; }
  return null;
}

/** Normalize a row to exactly `width` cells (GFM pads missing, drops extras). */
function normalizeRow(cells: string[], width: number): string[] {
  return Array.from({ length: width }, (_, i) => cells[i] ?? '');
}

export function parseTable(text: string): TableData | null {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return null;
  }
  const delimiterCells = splitRow(lines[1]);
  if (delimiterCells.length === 0 || !delimiterCells.every((c) => DELIMITER_CELL.test(c))) {
    return null;
  }
  const header = splitRow(lines[0]);
  const width = header.length;
  if (width > MAX_COLUMNS || lines.length - 2 > MAX_ROWS) {
    return null; // too large to edit as a grid
  }
  return {
    header,
    align: normalizeRow(delimiterCells, width).map((c) => (c ? parseAlign(c) : null)),
    rows: lines.slice(2).map((line) => normalizeRow(splitRow(line), width)),
  };
}

function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function delimiterFor(align: Align): string {
  switch (align) {
    case 'left': return ':---';
    case 'center': return ':---:';
    case 'right': return '---:';
    default: return '---';
  }
}

export function serializeTable(data: TableData): string {
  const row = (cells: string[]) => `| ${cells.map(escapeCell).join(' | ')} |`;
  return [
    row(data.header),
    `| ${data.align.map(delimiterFor).join(' | ')} |`,
    ...data.rows.map(row),
  ].join('\n');
}
