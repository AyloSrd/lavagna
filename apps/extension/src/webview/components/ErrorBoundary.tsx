import React from 'react';

interface State {
  error: Error | null;
}

/** Keeps an editor crash from taking down the whole panel. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('[lavagna] block editor crashed:', error);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            margin: 16,
            padding: 12,
            borderRadius: 6,
            border: '1px solid var(--vscode-inputValidation-errorBorder, #f48771)',
            color: 'var(--vscode-errorForeground, #f48771)',
            fontSize: 13,
          }}
        >
          This block editor crashed: {this.state.error.message}. Your document is untouched —
          edit the block as text instead.
        </div>
      );
    }
    return this.props.children;
  }
}
