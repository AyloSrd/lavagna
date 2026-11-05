// Transient UI state of the sequence editor — what the pointer is doing,
// what is being edited, which popover is open. Never written to the fence.

export interface Point { x: number; y: number }

export type Drag =
  | { mode: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean; clickDeselects: boolean }
  /** Dragging a new message out of participant `from`'s lifeline. */
  | { mode: 'message'; from: string; start: Point; p: Point }
  | { mode: 'head'; id: string; x0: number; dx: number; moved: boolean }
  /** Moving step `i` by its grip; `target` is the boundary it would drop on. */
  | { mode: 'reorder'; i: number; target: { y: number; idx: number } | null };

export type Hover =
  | { kind: 'dot'; x: number; y: number }
  | { kind: 'plus'; y: number; idx: number }
  | { kind: 'grip'; i: number; y: number };

export type Editing =
  | { kind: 'step'; i: number }
  /** `isNew`: the participant was just added, so its id follows the first name it gets. */
  | { kind: 'head'; id: string; isNew: boolean };

export type Menu =
  | { kind: 'insert'; idx: number; y: number }
  | { kind: 'participant'; id: string; confirm: boolean; error: string };
