import React, { useEffect, useEffectEvent } from 'react';
import type { Box } from './layout';

// A text field floated over the diagram, in diagram units (it lives inside the
// zoomed layer, so it scales with the view). Enter or blur commits, Escape
// cancels. The editor also reads `inputRef` to commit before acting on a
// click elsewhere, since an unmounted field never fires blur.

export function InlineEditor({
  box,
  align,
  initial,
  inputRef,
  onCommit,
  onCancel,
}: {
  box: Box;
  align: 'left' | 'center';
  initial: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onCommit(value: string): void;
  onCancel(): void;
}) {
  const commit = useEffectEvent((v: string) => onCommit(v));

  // Mount-only: focus and select, so typing replaces the placeholder text.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    const timer = setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
    const onBlur = () => commit(input.value);
    input.addEventListener('blur', onBlur);
    return () => {
      clearTimeout(timer);
      input.removeEventListener('blur', onBlur);
    };
  }, [inputRef]);

  return (
    <input
      ref={inputRef}
      className={align === 'left' ? 'lv-seq-edit lv-seq-left' : 'lv-seq-edit'}
      style={{ left: box.x, top: box.y, width: box.w }}
      defaultValue={initial}
      spellCheck={false}
      aria-label="Text"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}
