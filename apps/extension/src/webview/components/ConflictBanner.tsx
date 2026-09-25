import React from 'react';

const BANNER_BUTTON: React.CSSProperties = {
  background: 'var(--vscode-button-background, #0e639c)',
  color: 'var(--vscode-button-foreground, #fff)',
  border: 'none',
  borderRadius: 3,
  padding: '3px 10px',
  cursor: 'pointer',
  fontSize: 12,
};

export function ConflictBanner({
  failure,
  hasFileVersion,
  onLoadFile,
  onKeepMine,
}: {
  failure: string | null;
  hasFileVersion: boolean;
  onLoadFile: () => void;
  onKeepMine: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        fontSize: 12,
        background: 'var(--vscode-inputValidation-warningBackground, rgba(204,167,0,0.18))',
        borderBottom: '1px solid var(--vscode-inputValidation-warningBorder, #cca700)',
      }}
    >
      <span style={{ flex: 1 }}>
        {failure ? `Writing to the file failed: ${failure}` : 'This block changed in the file.'}
      </span>
      {hasFileVersion && (
        <button style={BANNER_BUTTON} onClick={onLoadFile}>
          Load file version
        </button>
      )}
      <button style={BANNER_BUTTON} onClick={onKeepMine}>
        {failure ? 'Retry' : 'Keep mine'}
      </button>
    </div>
  );
}
