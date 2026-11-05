import * as assert from 'assert';
import { suite, test } from 'vitest';
import { UndoStack } from '../../webview/ui/undoStack';

suite('UndoStack', () => {
  test('undo returns the recorded state and redo brings the current one back', () => {
    const s = new UndoStack<string>();
    s.record('a');
    assert.ok(s.canUndo);
    assert.strictEqual(s.undo('b'), 'a');
    assert.ok(s.canRedo);
    assert.strictEqual(s.redo('a'), 'b');
    assert.strictEqual(s.undo('b'), 'a');
  });

  test('a new record clears redo', () => {
    const s = new UndoStack<number>();
    s.record(1);
    s.undo(2);
    s.record(1);
    assert.strictEqual(s.canRedo, false);
  });

  test('empty stacks return null', () => {
    const s = new UndoStack<number>();
    assert.strictEqual(s.undo(1), null);
    assert.strictEqual(s.redo(1), null);
  });

  test('keeps at most 200 steps', () => {
    const s = new UndoStack<number>();
    for (let i = 0; i < 250; i++) {
      s.record(i);
    }
    let n = 0;
    while (s.undo(-1) !== null) {
      n++;
    }
    assert.strictEqual(n, 200);
  });

  test('clear forgets both directions', () => {
    const s = new UndoStack<number>();
    s.record(1);
    s.undo(2);
    s.clear();
    assert.strictEqual(s.canUndo || s.canRedo, false);
  });
});
