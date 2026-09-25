import React, { useEffect, useRef, useState } from 'react';
import { Align, TableData, parseTable, serializeTable } from '../format/tableFormat';
import type { EditorProps } from '../BlockEditorApp';
import { ReadOnlyFallback } from './ReadOnlyFallback';

// Grid editor for GFM pipe tables. Cell keystrokes flow through the debounced
// live sync; structural changes (rows/columns/alignment) flush immediately.
// Tab moves across cells natively (inputs in DOM order); Enter in a body cell
// inserts a row below it.

const BTN: React.CSSProperties = {
  background: 'var(--vscode-button-secondaryBackground, #3a3d41)',
  color: 'var(--vscode-button-secondaryForeground, #ccc)',
  border: '1px solid var(--vscode-panel-border, #555)',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: '0.76em',
  cursor: 'pointer',
};

const GHOST_BTN: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--vscode-foreground)',
  opacity: 0.55,
  cursor: 'pointer',
  fontSize: '0.8em',
  padding: '0 4px',
  lineHeight: 1,
};

const CELL_INPUT: React.CSSProperties = {
  width: '100%',
  minWidth: 60,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: 'var(--vscode-foreground)',
  font: 'inherit',
  padding: '4px 6px',
};

const ALIGN_SYMBOL: Record<string, string> = { left: '⯇', center: '⯐', right: '⯈', none: '·' };
const ALIGN_ORDER: Align[] = [null, 'left', 'center', 'right'];

export function TableEditor({ value, onChange, onGestureEnd }: EditorProps) {
  const lastWritten = useRef(value);
  const initialParse = useRef<TableData | null | undefined>(undefined);
  if (initialParse.current === undefined) {
    initialParse.current = parseTable(value);
  }
  const [fallback, setFallback] = useState(initialParse.current === null);
  const [data, setData] = useState<TableData>(
    () => initialParse.current ?? { header: [''], align: [null], rows: [] },
  );

  // Re-sync only on external changes (file edits, undo), not our own echo.
  useEffect(() => {
    if (value === lastWritten.current) {
      return;
    }
    lastWritten.current = value;
    const parsed = parseTable(value);
    if (!parsed) {
      setFallback(true);
      return;
    }
    setFallback(false);
    setData(parsed);
  }, [value]);

  const commit = (next: TableData, structural = false) => {
    setData(next);
    const text = serializeTable(next);
    if (text !== lastWritten.current) {
      lastWritten.current = text;
      onChange(text);
      if (structural) {
        onGestureEnd();
      }
    }
  };

  const setHeader = (c: number, v: string) =>
    commit({ ...data, header: data.header.map((h, i) => (i === c ? v : h)) });

  const setCell = (r: number, c: number, v: string) =>
    commit({
      ...data,
      rows: data.rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? v : cell)) : row)),
    });

  const addRow = (afterIndex: number = data.rows.length - 1) => {
    const rows = data.rows.slice();
    rows.splice(afterIndex + 1, 0, data.header.map(() => ''));
    commit({ ...data, rows }, true);
  };

  const removeRow = (r: number) =>
    commit({ ...data, rows: data.rows.filter((_, i) => i !== r) }, true);

  const addColumn = () =>
    commit(
      {
        header: [...data.header, ''],
        align: [...data.align, null],
        rows: data.rows.map((row) => [...row, '']),
      },
      true,
    );

  const removeColumn = (c: number) => {
    if (data.header.length <= 1) {
      return;
    }
    commit(
      {
        header: data.header.filter((_, i) => i !== c),
        align: data.align.filter((_, i) => i !== c),
        rows: data.rows.map((row) => row.filter((_, i) => i !== c)),
      },
      true,
    );
  };

  const cycleAlign = (c: number) => {
    const next = ALIGN_ORDER[(ALIGN_ORDER.indexOf(data.align[c]) + 1) % ALIGN_ORDER.length];
    commit({ ...data, align: data.align.map((a, i) => (i === c ? next : a)) }, true);
  };

  if (fallback) {
    return (
      <ReadOnlyFallback
        content={value}
        message="This table couldn't be parsed — edit it as text in the file instead."
      />
    );
  }

  const cellStyle = (c: number): React.CSSProperties => ({
    ...CELL_INPUT,
    textAlign: data.align[c] ?? 'left',
  });
  const td: React.CSSProperties = {
    border: '1px solid var(--vscode-panel-border, #444)',
    padding: 0,
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button style={BTN} onMouseDown={(e) => { e.preventDefault(); addRow(); }}>＋ Row</button>
        <button style={BTN} onMouseDown={(e) => { e.preventDefault(); addColumn(); }}>＋ Column</button>
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          {/* Column controls: alignment cycle + remove. */}
          <tr>
            {data.header.map((_, c) => (
              <th key={c} style={{ padding: '0 0 3px', fontWeight: 'normal' }}>
                <span style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
                  <button
                    style={GHOST_BTN}
                    title={`Alignment: ${data.align[c] ?? 'default'} (click to change)`}
                    onMouseDown={(e) => { e.preventDefault(); cycleAlign(c); }}
                  >
                    {ALIGN_SYMBOL[data.align[c] ?? 'none']}
                  </button>
                  <button
                    style={{ ...GHOST_BTN, color: 'var(--vscode-errorForeground, #f48771)' }}
                    title="Remove column"
                    onMouseDown={(e) => { e.preventDefault(); removeColumn(c); }}
                    disabled={data.header.length <= 1}
                  >
                    ✕
                  </button>
                </span>
              </th>
            ))}
            <th />
          </tr>
          <tr>
            {data.header.map((h, c) => (
              <th key={c} style={{ ...td, background: 'var(--vscode-editorWidget-background, #252526)' }}>
                <input
                  value={h}
                  placeholder="header"
                  onChange={(e) => setHeader(c, e.target.value)}
                  onBlur={onGestureEnd}
                  style={{ ...cellStyle(c), fontWeight: 600 }}
                />
              </th>
            ))}
            <th style={{ width: 24 }} />
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} style={td}>
                  <input
                    value={cell}
                    onChange={(e) => setCell(r, c, e.target.value)}
                    onBlur={onGestureEnd}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addRow(r);
                      }
                    }}
                    style={cellStyle(c)}
                  />
                </td>
              ))}
              <td style={{ width: 24, textAlign: 'center' }}>
                <button
                  style={{ ...GHOST_BTN, color: 'var(--vscode-errorForeground, #f48771)' }}
                  title="Remove row"
                  onMouseDown={(e) => { e.preventDefault(); removeRow(r); }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.rows.length === 0 && (
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
          No rows yet — add one with ＋ Row.
        </p>
      )}
    </div>
  );
}
