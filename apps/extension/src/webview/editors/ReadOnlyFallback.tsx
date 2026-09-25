import React from 'react';

/**
 * Shown when a block can't be safely edited visually (e.g. mermaid syntax
 * beyond our flowchart subset, or a newer canvas format). Never writes back —
 * the fence stays byte-identical.
 */
export function ReadOnlyFallback({ content, message }: { content: string; message: string }) {
  return (
    <div style={{ padding: 16 }}>
      <p style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>{message}</p>
      <pre
        style={{
          padding: 12,
          borderRadius: 6,
          border: '1px solid var(--vscode-panel-border, #444)',
          background: 'var(--vscode-textCodeBlock-background, #1e1e1e)',
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
          fontSize: 13,
          lineHeight: 1.5,
          overflow: 'auto',
          whiteSpace: 'pre',
        }}
      >
        {content}
      </pre>
    </div>
  );
}
