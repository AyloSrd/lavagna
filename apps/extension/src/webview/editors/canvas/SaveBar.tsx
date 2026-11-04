import React from 'react';

// Unsaved-marks counter with Discard and Save. Save is the only thing that
// writes: it bakes the marks into a new PNG, after which they are pixels.

export function SaveBar({
  count,
  saving,
  editingText,
  onDiscard,
  onSave,
}: {
  count: number;
  saving: boolean;
  /** An open text box must be finished first, or it would be lost. */
  editingText: boolean;
  onDiscard(): void;
  onSave(): void;
}) {
  const canSave = count > 0 && !saving && !editingText;
  return (
    <div className="lv-float lv-canvas-savebar">
      <span className="lv-canvas-count">
        {count > 0 && <span className="lv-canvas-dot" aria-hidden="true" />}
        <span className="lv-canvas-count-text">
          {count ? `${count} unsaved mark${count === 1 ? '' : 's'}` : 'No unsaved marks'}
        </span>
      </span>
      <button
        type="button"
        className="lv-btn lv-btn--ghost"
        disabled={!count || saving}
        title="Remove every unsaved mark (undo brings them back)"
        onMouseDown={(e) => { e.preventDefault(); onDiscard(); }}
      >
        Discard
      </button>
      <button
        type="button"
        className="lv-btn lv-btn--primary"
        disabled={!canSave}
        title={
          editingText
            ? 'Finish the text first (Enter, or click away)'
            : 'Bake the marks into a new PNG in .lavagna/media/ and update the link (⌘S)'
        }
        onMouseDown={(e) => { e.preventDefault(); onSave(); }}
      >
        {saving ? 'Saving…' : 'Save into image'}
      </button>
    </div>
  );
}

export function ReplaceImageMenu({
  unsaved,
  busy,
  onChoose,
}: {
  unsaved: number;
  busy: boolean;
  onChoose(source: 'dialog' | 'blank'): void;
}) {
  return (
    <div className="lv-float lv-pop lv-menu lv-canvas-replace" role="menu" aria-label="Replace the image">
      <button type="button" role="menuitem" disabled={busy} onMouseDown={(e) => { e.preventDefault(); onChoose('dialog'); }}>
        Choose an image file…
      </button>
      <button type="button" role="menuitem" disabled={busy} onMouseDown={(e) => { e.preventDefault(); onChoose('blank'); }}>
        Start from a blank page
      </button>
      {unsaved > 0 && (
        <p className="lv-canvas-warn">
          {unsaved} unsaved mark{unsaved === 1 ? ' is' : 's are'} dropped when the image changes.
        </p>
      )}
    </div>
  );
}
