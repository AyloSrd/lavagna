import React, { useEffect, useRef, useState } from 'react';
import { changedLines, highlightLine } from '../format/mermaidHighlight';
import { copyToClipboard } from '../hostBridge';
import { IconButton } from './controls';

// Read-only view of the fence exactly as it is in the file — the editors write
// it, this shows it. Lines that changed since the last render flash briefly so
// a visual edit can be traced to its text.

export function CodePane({ value, onClose }: { value: string; onClose(): void }) {
  const prev = useRef(value);
  // Bumped on every change so the flash animation restarts on the same line.
  const [flash, setFlash] = useState<{ lines: Set<number>; key: number }>({ lines: new Set(), key: 0 });

  useEffect(() => {
    if (prev.current === value) {
      return;
    }
    const lines = new Set(changedLines(prev.current, value));
    prev.current = value;
    setFlash((f) => ({ lines, key: f.key + 1 }));
  }, [value]);

  const lines = value.split('\n');
  return (
    <aside className="lv-code" aria-label="Mermaid source">
      <div className="lv-code-head">
        <span>Mermaid</span>
        <span className="lv-spacer" />
        <IconButton icon="copy" label="Copy mermaid" onPress={() => copyToClipboard(value, 'Mermaid copied')} />
        <IconButton icon="close" label="Hide mermaid" onPress={onClose} />
      </div>
      <pre>
        {lines.map((line, i) => (
          <span
            key={flash.lines.has(i) ? `${i}-${flash.key}` : i}
            className={flash.lines.has(i) ? 'lv-code-line lv-flash' : 'lv-code-line'}
          >
            <span className="lv-code-ln">{i + 1}</span>
            {highlightLine(line).map((t, j) =>
              t.kind === 'plain' ? t.text : <span key={j} className={`lv-tok-${t.kind}`}>{t.text}</span>,
            )}
          </span>
        ))}
      </pre>
      <div className="lv-code-foot">This is the mermaid fence in the file. Every edit rewrites it.</div>
    </aside>
  );
}
