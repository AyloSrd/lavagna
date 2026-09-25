import React from 'react';

// Empty state for a canvas with no image yet: two halves, start blank on the
// left, upload a file on the right.
//
// No drag-and-drop: VS Code's webview host intercepts file drops and opens the
// dropped file in an editor tab, so the webview never receives the event.

export interface CanvasChooserProps {
  busy: boolean;
  /** True when the link points at a file that no longer exists. */
  missing: boolean;
  onBlank(): void;
  onPick(): void;
}

const HALF: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 14,
  padding: 24,
  border: 'none',
  background: 'transparent',
  color: 'var(--vscode-foreground)',
  font: 'inherit',
  cursor: 'pointer',
};

const CAPTION: React.CSSProperties = { fontSize: 13, opacity: 0.85 };

function PageIcon() {
  // Sheet of paper with a folded corner.
  return (
    <svg width="72" height="96" viewBox="0 0 72 96" aria-hidden>
      <path
        d="M4 4 h44 l20 20 v68 H4 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M48 4 v20 h20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

function PlusBox() {
  return (
    <svg width="120" height="84" viewBox="0 0 120 84" aria-hidden>
      <rect x="2" y="2" width="116" height="80" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M60 24 v36 M42 42 h36" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function CanvasChooser({ busy, missing, onBlank, onPick }: CanvasChooserProps) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {missing && (
        <p
          style={{
            margin: 0,
            padding: '6px 12px',
            fontSize: 12,
            background: 'var(--vscode-inputValidation-warningBackground, rgba(204,167,0,0.18))',
            borderBottom: '1px solid var(--vscode-inputValidation-warningBorder, #cca700)',
          }}
        >
          The linked image is missing — choose a replacement, or start blank.
        </p>
      )}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'stretch',
          opacity: busy ? 0.55 : 1,
          pointerEvents: busy ? 'none' : 'auto',
        }}
      >
        <button style={HALF} onClick={onBlank} title="Draw on a blank white page">
          <PageIcon />
          <span style={CAPTION}>Start blank</span>
        </button>

        <div style={{ width: 1, background: 'var(--vscode-panel-border, #555)', margin: '24px 0' }} />

        <button style={HALF} onClick={onPick} title="Choose an image file to draw on">
          <PlusBox />
          <span style={CAPTION}>{busy ? 'Choosing…' : 'Choose an image'}</span>
        </button>
      </div>
    </div>
  );
}
