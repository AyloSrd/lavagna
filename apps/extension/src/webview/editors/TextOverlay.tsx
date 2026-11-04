import React, { useEffect, useEffectEvent, useRef } from 'react';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from './canvas/model';

// A canvas has no text input, so editing a text mark (or a shape's label)
// means floating a real <textarea> over the stage at the mark's position. The
// canvas skips drawing that text while this is open, so only this box is
// visible — small metric differences show up as a slight shift on commit, not
// as permanently misaligned text.
//
// Font metrics MUST match the canvas renderer or the text jumps when
// committed: same family, same (zoomed) size, same unitless line-height, no
// padding, no border, `pre` so neither side ever wraps.

export interface TextOverlayProps {
  /** Position inside the stage's box, in screen pixels (already zoomed). */
  x: number;
  y: number;
  /** Font size in screen pixels (the mark's size times the zoom). */
  fontSize: number;
  color: string;
  initialText: string;
  /** `center`: x/y is the middle of the text, as for a shape's label. */
  align?: 'left' | 'center';
  onCommit(text: string): void;
  onCancel(): void;
}

/** Grow to fit the content in both directions (no wrapping, no scrollbars). */
function autoSize(ta: HTMLTextAreaElement): void {
  ta.style.width = '0px';
  ta.style.width = `${ta.scrollWidth + 2}px`;
  ta.style.height = '0px';
  ta.style.height = `${ta.scrollHeight}px`;
}

export function TextOverlay({
  x,
  y,
  fontSize,
  color,
  initialText,
  align = 'left',
  onCommit,
  onCancel,
}: TextOverlayProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // The parent re-renders on every tool, colour, zoom and hover change. As
  // Effect Events these callbacks stay fresh without being dependencies, so the
  // setup effect below never re-runs and can't disturb what is being typed.
  const commit = useEffectEvent((text: string) => onCommit(text));
  const cancel = useEffectEvent(() => onCancel());

  // Mount-only: focus, sizing, and listeners. All styling lives in the JSX
  // `style` prop, and the value is uncontrolled via defaultValue, so a
  // re-render can never clobber in-progress input.
  useEffect(() => {
    const ta = ref.current;
    if (!ta) {
      return;
    }
    autoSize(ta);
    ta.focus();
    // Existing text opens selected, so typing replaces it.
    ta.select();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit(ta.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    const onInput = () => autoSize(ta);
    const onOutside = (e: MouseEvent) => {
      if (e.target !== ta) {
        commit(ta.value);
      }
    };

    ta.addEventListener('keydown', onKeyDown);
    ta.addEventListener('input', onInput);
    // Deferred a tick so the click that opened this editor doesn't close it.
    const timer = setTimeout(() => document.addEventListener('mousedown', onOutside), 0);

    return () => {
      clearTimeout(timer);
      ta.removeEventListener('keydown', onKeyDown);
      ta.removeEventListener('input', onInput);
      document.removeEventListener('mousedown', onOutside);
    };
  }, []);

  // A zoom change resizes the font; refit the box to it.
  useEffect(() => {
    if (ref.current) {
      autoSize(ref.current);
    }
  }, [fontSize]);

  return (
    <textarea
      ref={ref}
      defaultValue={initialText}
      spellCheck={false}
      wrap="off"
      aria-label="Text"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        zIndex: 15,
        transform: align === 'center' ? 'translate(-50%, -50%)' : undefined,
        textAlign: align,
        margin: 0,
        padding: 0,
        border: 'none',
        outline: '1px dashed var(--vscode-focusBorder, #007acc)',
        background: 'transparent',
        resize: 'none',
        overflow: 'hidden',
        whiteSpace: 'pre',
        minWidth: 8,
        color,
        fontSize,
        fontFamily: TEXT_FONT_FAMILY,
        lineHeight: TEXT_LINE_HEIGHT,
      }}
    />
  );
}
