import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  INDENT_UNIT,
  connectorPrefix,
  depthOf,
  fromAscii,
  nameOf,
  toAscii,
} from '../format/treeFormat';
import type { EditorProps } from '../BlockEditorApp';

// One editable field per line: a non-editable connector prefix beside a plain
// <input> that holds only the node name. Connectors and the caret's text live
// in separate boxes in normal flow, so there is nothing to align — no
// transparent-overlay drift, whatever width the box-drawing glyphs render at.
//
// The fence stores the connector (├─/└─) form; the model here is the plain
// space-indented form. Conversion happens at this component's edge only.

const LINE_HEIGHT = 22; // px
const FONT_SIZE = 13; // px

const indent = (depth: number) => ' '.repeat(depth * INDENT_UNIT);

/** Index just past the last descendant of line `i`. */
function subtreeEnd(depths: number[], i: number): number {
  let j = i + 1;
  while (j < depths.length && depths[j] > depths[i]) { j++; }
  return j;
}

const BTN: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--vscode-foreground)',
  opacity: 0.7,
  cursor: 'pointer',
  fontSize: '0.85em',
  padding: '0 3px',
  lineHeight: 1,
};

const MONO: React.CSSProperties = {
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  fontSize: FONT_SIZE,
  lineHeight: `${LINE_HEIGHT}px`,
  whiteSpace: 'pre',
};

export function TreeEditor({ value, onChange, onGestureEnd }: EditorProps) {
  const [text, setText] = useState<string>(() => fromAscii(value));
  const [hovered, setHovered] = useState<number | null>(null);
  const [errorLines, setErrorLines] = useState<Set<number>>(() => new Set());
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const pendingFocus = useRef<{ line: number; caret: number } | null>(null);
  const lastWritten = useRef(value);

  // Re-sync only on external changes (file edits, undo), not the echo of our own writes.
  useEffect(() => {
    if (value !== lastWritten.current) {
      lastWritten.current = value;
      setText(fromAscii(value));
    }
  }, [value]);

  // Structural edits (Enter, Tab, merge, hover buttons) reposition the caret in
  // a possibly-different input, once the new rows have rendered.
  useLayoutEffect(() => {
    const pf = pendingFocus.current;
    if (!pf) {
      return;
    }
    pendingFocus.current = null;
    const el = inputs.current[pf.line];
    if (el) {
      el.focus();
      const caret = Math.min(pf.caret, el.value.length);
      el.setSelectionRange(caret, caret);
    }
  });

  const lines = text.split('\n');
  const depths = lines.map(depthOf);

  const commit = (nextLines: string[], focus?: { line: number; caret: number }) => {
    if (focus) {
      pendingFocus.current = focus;
    }
    const next = nextLines.join('\n');
    setText(next);
    const fenceForm = toAscii(next);
    lastWritten.current = fenceForm;
    onChange(fenceForm);
  };

  const setName = (i: number, name: string) => {
    if (errorLines.size) {
      setErrorLines(new Set());
    }
    const next = lines.slice();
    next[i] = indent(depths[i]) + name; // controlled input keeps its own caret
    commit(next);
  };

  const focusRow = (line: number, caret: number) => {
    const el = inputs.current[line];
    if (el) {
      el.focus();
      const c = Math.min(caret, el.value.length);
      el.setSelectionRange(c, c);
    }
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const caret = input.selectionStart ?? input.value.length;
    const name = input.value;

    if (e.key === 'Enter') {
      e.preventDefault();
      const depth = depths[i];
      const next = lines.slice();
      next[i] = indent(depth) + name.slice(0, caret);
      next.splice(i + 1, 0, indent(depth) + name.slice(caret)); // text after caret → new node
      commit(next, { line: i + 1, caret: 0 });
      onGestureEnd();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const maxDepth = i > 0 ? depths[i - 1] + 1 : 0;
      const depth = e.shiftKey ? Math.max(0, depths[i] - 1) : Math.min(maxDepth, depths[i] + 1);
      if (depth === depths[i]) {
        return;
      }
      const next = lines.slice();
      next[i] = indent(depth) + name;
      commit(next, { line: i, caret }); // caret is within the name, unaffected by indent
      onGestureEnd();
      return;
    }

    if (e.key === 'Backspace' && caret === 0 && input.selectionEnd === 0 && i > 0) {
      e.preventDefault();
      const prevName = nameOf(lines[i - 1]);
      const next = lines.slice();
      next[i - 1] = indent(depths[i - 1]) + prevName + name; // merge into previous
      next.splice(i, 1);
      commit(next, { line: i - 1, caret: prevName.length });
      onGestureEnd();
      return;
    }

    if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault();
      focusRow(i - 1, caret);
      return;
    }
    if (e.key === 'ArrowDown' && i < lines.length - 1) {
      e.preventDefault();
      focusRow(i + 1, caret);
    }
  };

  const addChild = (i: number) => {
    const next = lines.slice();
    next.splice(i + 1, 0, indent(depths[i] + 1));
    commit(next, { line: i + 1, caret: 0 });
    onGestureEnd();
  };
  const addSibling = (i: number) => {
    const end = subtreeEnd(depths, i);
    const next = lines.slice();
    next.splice(end, 0, indent(depths[i]));
    commit(next, { line: end, caret: 0 });
    onGestureEnd();
  };
  const remove = (i: number) => {
    const end = subtreeEnd(depths, i);
    const next = lines.slice();
    next.splice(i, end - i);
    if (next.length === 0) {
      next.push('root');
    }
    commit(next, { line: Math.max(0, i - 1), caret: 0 });
    onGestureEnd();
  };

  // Normalize indentation; a line may go at most one level deeper than the line
  // above. Lines that break that rule are clamped AND flagged (red).
  const format = () => {
    const out: string[] = [];
    const errs = new Set<number>();
    let prevDepth = -1;
    for (const raw of lines) {
      const name = nameOf(raw).replace(/\s+$/, '');
      if (name === '') { continue; } // drop blank lines
      let depth = depthOf(raw);
      const max = prevDepth + 1;
      if (depth > max) { errs.add(out.length); depth = max; }
      if (depth < 0) { depth = 0; }
      out.push(indent(depth) + name);
      prevDepth = depth;
    }
    setErrorLines(errs);
    commit(out.length ? out : ['root']);
    onGestureEnd();
  };

  return (
    <div style={{ padding: 12 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, padding: '4px 6px', borderBottom: '1px solid var(--vscode-panel-border, #333)' }}>
        <button style={{ ...BTN, opacity: 0.85 }} title="Normalize indentation" onMouseDown={e => { e.preventDefault(); format(); }}>
          ⚟ Format
        </button>
      </div>

      <div style={{ padding: '8px 0' }} onMouseLeave={() => setHovered(null)}>
        {lines.map((line, i) => (
          <div
            key={i}
            onMouseEnter={() => setHovered(i)}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              height: LINE_HEIGHT,
              padding: '0 10px',
              background: errorLines.has(i)
                ? 'var(--vscode-inputValidation-errorBackground, rgba(255,80,80,0.18))'
                : hovered === i
                  ? 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.1))'
                  : 'transparent',
            }}
          >
            <span style={{ ...MONO, opacity: 0.35, flex: 'none' }}>{connectorPrefix(depths, i)}</span>
            <input
              ref={el => { inputs.current[i] = el; }}
              value={nameOf(line)}
              onChange={e => setName(i, e.target.value)}
              onKeyDown={e => onKeyDown(i, e)}
              onBlur={onGestureEnd}
              spellCheck={false}
              style={{
                ...MONO,
                flex: 1,
                minWidth: 0,
                marginRight: 84, // room for the hover buttons
                padding: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--vscode-foreground)',
                caretColor: 'var(--vscode-foreground)',
              }}
            />

            {hovered === i && (
              <div style={{ position: 'absolute', right: 6, top: 0, height: LINE_HEIGHT, display: 'flex', alignItems: 'center', gap: 2, zIndex: 3 }}>
                <button style={BTN} title="Add child" onMouseDown={e => { e.preventDefault(); addChild(i); }}>＋⤵</button>
                <button style={BTN} title="Add sibling" onMouseDown={e => { e.preventDefault(); addSibling(i); }}>＋</button>
                <button style={{ ...BTN, color: 'var(--vscode-errorForeground, #f48771)' }} title="Remove" onMouseDown={e => { e.preventDefault(); remove(i); }}>✕</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
