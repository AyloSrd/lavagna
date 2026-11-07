import type { ShortcutRow } from '../../ui/controls';
import type { Tool } from './model';

// Keyboard map, help rows and bottom hints for the canvas.

/** Single-key tool shortcuts (lower-case `KeyboardEvent.key`). */
export const TOOL_KEYS: Record<string, Tool> = {
  v: 'select', h: 'hand', p: 'pen', m: 'marker', r: 'rect', o: 'ellipse', a: 'arrow', l: 'line', t: 'text', e: 'eraser',
};

export const HELP_ROWS: ShortcutRow[] = [
  { action: 'Select', keys: ['V'] },
  { action: 'Pan', keys: ['H', 'Space'] },
  { action: 'Pen', keys: ['P'] },
  { action: 'Highlighter', keys: ['M'] },
  { action: 'Rectangle', keys: ['R'] },
  { action: 'Ellipse', keys: ['O'] },
  { action: 'Arrow', keys: ['A'] },
  { action: 'Line', keys: ['L'] },
  { action: 'Text', keys: ['T'] },
  { action: 'Eraser', keys: ['E'] },
  { action: 'Insert an image', keys: ['I', '⌘V', 'drop'] },
  { action: 'Edit text / label', keys: ['Enter'] },
  { action: 'Delete', keys: ['⌫'] },
  { action: 'Copy / cut / paste', keys: ['⌘C', '⌘X', '⌘V'] },
  { action: 'Duplicate', keys: ['⌘D'] },
  { action: 'Bring to front / send to back', keys: [']', '['] },
  { action: 'Select all', keys: ['⌘A'] },
  { action: 'Box-select (even over a picture)', keys: ['drag', '⌥ drag'] },
  { action: 'Undo / redo', keys: ['⌘Z', '⇧⌘Z'] },
  { action: 'Nudge', keys: ['←↑→↓', '⇧'] },
  { action: 'Square / straight · free image ratio', keys: ['⇧ drag'] },
  { action: 'Zoom', keys: ['⌘ scroll'] },
  { action: 'Fit the image', keys: ['⇧1'] },
  { action: 'Save into image', keys: ['⌘S'] },
];

/** Hint per tool; `selected` is shown when the select tool has a selection. */
export const HINTS: Record<Tool | 'selected', string> = {
  select: 'Click a mark to select · drag for a box (⌥ over a picture) · double-click to write',
  selected: 'Drag inside the box to move · handles resize · ⌘C ⌘V · ] [ reorder · ⌫ deletes',
  hand: 'Drag to move around the image',
  pen: 'Draw freely · pick a colour above first',
  marker: 'Highlight · hold ⇧ for a straight stroke',
  rect: 'Drag to frame something · ⇧ for a square',
  ellipse: 'Drag to circle something · ⇧ for a circle',
  arrow: 'Drag to point at something · start or end on a shape to attach',
  line: 'Drag · ⇧ snaps to 15°',
  text: 'Click where the text goes',
  eraser: 'Drag over marks to erase them',
};
