import React from 'react';
import type { ShortcutRow } from '../../ui/controls';
import type { Drag, Editing, Hover } from './state';

// The shortcut list for the help dialog and the context tip at the bottom.

export const SHORTCUTS: ShortcutRow[] = [
  { action: 'Add a message', keys: ['drag lifeline → lifeline'] },
  { action: 'Insert between rows', keys: ['hover', '+'] },
  { action: 'Edit text', keys: ['Enter', 'double-click'] },
  { action: 'Select previous / next', keys: ['↑', '↓'] },
  { action: 'Move step', keys: ['Alt ↑', 'Alt ↓'] },
  { action: 'Delete step', keys: ['⌫'] },
  { action: 'Deselect / cancel', keys: ['Esc'] },
  { action: 'Undo / redo', keys: ['⌘Z', '⇧⌘Z'] },
  { action: 'Pan', keys: ['Space drag', 'scroll'] },
  { action: 'Zoom', keys: ['⌘ scroll'] },
  { action: 'Fit diagram', keys: ['⇧1'] },
  { action: 'Shortcuts', keys: ['?'] },
];

export function HintText({
  editing,
  drag,
  hover,
  selected,
  empty,
}: {
  editing: Editing | null;
  drag: Drag | null;
  hover: Hover | null;
  selected: boolean;
  empty: boolean;
}) {
  if (editing) {
    return <><kbd>Enter</kbd> saves · <kbd>Esc</kbd> cancels</>;
  }
  if (drag?.mode === 'message') {
    return <>Release on another lifeline — or back on this one for a self-message</>;
  }
  if (drag?.mode === 'head') {
    return <>Drop to reorder participants</>;
  }
  if (drag?.mode === 'reorder') {
    return <>Drop between rows to move the step</>;
  }
  if (hover?.kind === 'plus') {
    return <>Click <kbd>+</kbd> to insert a message, note or frame here</>;
  }
  if (hover?.kind === 'dot') {
    return <>Drag to another lifeline to add a message</>;
  }
  if (hover?.kind === 'grip') {
    return <>Drag the grip to move this step</>;
  }
  if (selected) {
    return <><kbd>Enter</kbd> edits · <kbd>Alt ↑↓</kbd> moves · <kbd>⌫</kbd> deletes · <kbd>Esc</kbd> deselects</>;
  }
  if (empty) {
    return <>Add participants with <kbd>+ Participant</kbd>, then drag between their lifelines</>;
  }
  return <>Drag between lifelines to add a message · double-click any text to edit</>;
}
