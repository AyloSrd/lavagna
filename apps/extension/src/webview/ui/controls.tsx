import React, { useEffect, useRef } from 'react';
import { Icon, IconName } from './icons';

// Small building blocks shared by the block editors. Styling lives in
// UI_CSS (styles.ts); these only wire markup, labels and pressed state.

/**
 * Buttons act on mousedown with preventDefault, like the rest of the webview,
 * so a click never steals focus from an open text field or the canvas.
 */
const press = (fn: () => void) => (e: React.MouseEvent) => {
  if (e.button !== 0) {
    return;
  }
  e.preventDefault();
  fn();
};

export interface IconButtonProps {
  icon: IconName;
  label: string;
  /** Shortcut shown in the tooltip, e.g. "⌘Z". */
  shortcut?: string;
  /** Single key printed in the corner, for tool rails. */
  keyHint?: string;
  pressed?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onPress(): void;
}

export function IconButton({ icon, label, shortcut, keyHint, pressed, disabled, danger, onPress }: IconButtonProps) {
  return (
    <button
      type="button"
      className={danger ? 'lv-icon lv-icon--danger' : 'lv-icon'}
      aria-label={label}
      aria-pressed={pressed}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onMouseDown={press(onPress)}
      // Keyboard activation still goes through click.
      onClick={(e) => { if (e.detail === 0) { onPress(); } }}
    >
      <Icon name={icon} />
      {keyHint && <span className="lv-key">{keyHint}</span>}
    </button>
  );
}

export function Separator({ horizontal }: { horizontal?: boolean }) {
  return <span className={horizontal ? 'lv-sep lv-sep--h' : 'lv-sep'} aria-hidden="true" />;
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  /** Visual content; falls back to the label text. */
  content?: React.ReactNode;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: SegmentOption<T>[];
  value: T | null;
  onChange(next: T): void;
  label: string;
}) {
  return (
    <div className="lv-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-label={o.label}
          title={o.label}
          aria-pressed={o.value === value}
          onMouseDown={press(() => onChange(o.value))}
          onClick={(e) => { if (e.detail === 0) { onChange(o.value); } }}
        >
          {o.content ?? o.label}
        </button>
      ))}
    </div>
  );
}

export function Swatches<T extends string>({
  colors,
  value,
  onChange,
}: {
  colors: { value: T; label: string; css: string }[];
  value: T | null;
  onChange(next: T): void;
}) {
  return (
    <div role="group" aria-label="Colour" style={{ display: 'flex', gap: 6, padding: '0 6px' }}>
      {colors.map((c) => (
        <button
          key={c.value}
          type="button"
          className="lv-swatch"
          style={{ background: c.css }}
          aria-label={c.label}
          title={c.label}
          aria-pressed={c.value === value}
          onMouseDown={press(() => onChange(c.value))}
          onClick={(e) => { if (e.detail === 0) { onChange(c.value); } }}
        />
      ))}
    </div>
  );
}

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  zoom: number;
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
}) {
  return (
    <div className="lv-float lv-zoom">
      <IconButton icon="minus" label="Zoom out" onPress={onZoomOut} />
      <button type="button" className="lv-pct" title="Fit to view (⇧1)" onMouseDown={press(onFit)}>
        {Math.round(zoom * 100)}%
      </button>
      <IconButton icon="plus" label="Zoom in" onPress={onZoomIn} />
    </div>
  );
}

/** Bottom-centre tip; children may contain <kbd>. */
export function Hint({ children }: { children: React.ReactNode }) {
  return <div className="lv-hint" aria-live="polite">{children}</div>;
}

export interface ShortcutRow {
  action: string;
  keys: string[];
}

export function HelpDialog({
  open,
  title,
  rows,
  onClose,
}: {
  open: boolean;
  title: string;
  rows: ShortcutRow[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) {
      return;
    }
    if (open && !d.open) {
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);
  return (
    <dialog ref={ref} className="lv-help" onClose={onClose} onCancel={onClose}>
      <IconButton icon="close" label="Close" onPress={onClose} />
      <h3>{title}</h3>
      <div className="lv-keys">
        {rows.map((r) => (
          <div key={r.action}>
            <span>{r.action}</span>
            <span>{r.keys.map((k, i) => <kbd key={i} style={{ marginLeft: 4 }}>{k}</kbd>)}</span>
          </div>
        ))}
      </div>
    </dialog>
  );
}

/** True when a keyboard event comes from a text field, which owns its keys. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('dialog'));
}
