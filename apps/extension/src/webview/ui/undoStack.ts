// Snapshot undo/redo for the visual editors. Each editor records the state it
// had *before* a gesture; undo swaps the current state for the last record.
// Plain data in, plain data out — the editor writes the result back to the
// fence the same way as any other edit.

const LIMIT = 200;

export class UndoStack<T> {
  private past: T[] = [];
  private future: T[] = [];

  /** Remember `before` as the state to return to; clears redo. */
  record(before: T): void {
    this.past.push(before);
    if (this.past.length > LIMIT) {
      this.past.shift();
    }
    this.future = [];
  }

  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) {
      return null;
    }
    this.future.push(current);
    return prev;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) {
      return null;
    }
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Forget everything — e.g. after the content was replaced from outside. */
  clear(): void {
    this.past = [];
    this.future = [];
  }
}
