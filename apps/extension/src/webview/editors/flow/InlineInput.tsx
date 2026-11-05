import React, { useEffect, useRef, useState } from 'react';

// One-line label editor used inside nodes and edge pills. The draft stays
// local until it is committed, so typing never writes to the file key by key.

export type CommitHow = 'enter' | 'tab' | 'blur';

export function InlineInput({
  initial,
  placeholder,
  className,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  className?: string;
  onCommit(text: string, how: CommitHow): void;
  onCancel(): void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  // Enter/Tab/Escape end the edit before the blur that follows; ignore that blur.
  const done = useRef(false);

  // Focus after the current task: React Flow settles its own focus after a
  // selection change, and preventScroll stops the pane scrolling under the view.
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = ref.current;
      if (el) {
        el.focus({ preventScroll: true });
        el.select();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const finish = (how: CommitHow) => {
    if (done.current) {
      return;
    }
    done.current = true;
    onCommit(draft, how);
  };

  return (
    <input
      ref={ref}
      // nodrag/nopan: typing and selecting text must not move the node or the view.
      className={`nodrag nopan lv-flow-input${className ? ` ${className}` : ''}`}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      aria-label="Label"
      style={{ width: `${Math.max(placeholder.length, draft.length) + 2}ch` }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish('blur')}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish('enter');
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finish('tab');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
    />
  );
}
