import * as assert from 'assert';
import { suite, test } from 'vitest';
import { SequenceData, parseSequence } from '../../webview/format/sequence';
import {
  LANE_W, ROWS_TOP, boundaries, fitText, fitView, laneAt, laneX, layoutSequence, nearestBoundary, rowAt,
} from '../../webview/editors/sequence/layout';

// A fixed-width "font": every character is 6 units.
const measure = (text: string) => text.length * 6;
const seq = (src: string): SequenceData => parseSequence(`sequenceDiagram\n${src}`)!;
const lay = (src: string) => layoutSequence(seq(src), measure);

suite('sequence layout — rows', () => {
  test('rows stack from the top; activations take no height', () => {
    const l = lay('A->>B: x\nactivate B\nA->>A: self\nNote over A: n');
    assert.deepStrictEqual(l.rows.map((r) => [r.y, r.h]), [
      [ROWS_TOP, 46], [ROWS_TOP + 46, 0], [ROWS_TOP + 46, 62], [ROWS_TOP + 108, 44],
    ]);
    assert.strictEqual(l.last, ROWS_TOP + 152);
  });

  test('boundaries skip zero-height rows and end after the last step', () => {
    const l = lay('A->>B: x\nactivate B\nA->>B: y');
    assert.deepStrictEqual(boundaries(l).map((b) => b.idx), [0, 2, 3]);
    assert.strictEqual(nearestBoundary(l, ROWS_TOP + 40).idx, 2);
    assert.strictEqual(rowAt(l, ROWS_TOP + 10), 0);
    assert.strictEqual(rowAt(l, 0), null);
  });

  test('laneAt finds the nearest lifeline within reach', () => {
    assert.strictEqual(laneAt(3, laneX(1) + 20), 1);
    assert.strictEqual(laneAt(3, laneX(2) + LANE_W * 0.5), null);
    assert.strictEqual(laneAt(0, laneX(0)), null);
  });
});

suite('sequence layout — frames, notes, bars', () => {
  test('a frame spans its rows and the lanes its steps touch, with dividers inside', () => {
    const l = lay('participant A\nparticipant B\nparticipant C\nalt ok\nB->>C: x\nelse no\nC->>B: y\nend');
    assert.strictEqual(l.frames.length, 1);
    const f = l.frames[0];
    assert.strictEqual(f.keyword, 'alt');
    assert.ok(f.box.x > laneX(0) && f.box.x < laneX(1), 'starts at lane B, not A');
    assert.strictEqual(f.box.y, l.rows[0].y + 6);
    assert.strictEqual(f.box.y + f.box.h, l.rows[4].y + 8);
    assert.deepStrictEqual(l.dividers.map((d) => [d.i, d.text]), [[2, '[no]']]);
  });

  test('nested frames are inset; an unclosed frame runs to the bottom', () => {
    const l = lay('loop a\nopt b\nA->>B: x\nend\nend\nloop open\nA->>B: y');
    const byStart = new Map(l.frames.map((f) => [f.i, f]));
    assert.strictEqual(byStart.get(1)!.box.x - byStart.get(0)!.box.x, 8);
    const open = byStart.get(5)!;
    assert.strictEqual(open.box.y + open.box.h, l.bottom - 6);
  });

  test('every selectable step gets an anchor; activations and ends do not', () => {
    const l = lay('loop a\nA->>B: x\nNote right of B: n\nactivate A\nend');
    assert.deepStrictEqual(l.anchors.map((a) => a !== null), [true, true, true, false, false]);
  });

  test('notes over two participants span both lanes', () => {
    const l = lay('participant A\nparticipant B\nNote over A,B: wide');
    const n = l.notes[0];
    assert.strictEqual(n.box.x, laneX(0) - 60);
    assert.strictEqual(n.box.w, laneX(1) - laneX(0) + 120);
  });

  test('activation bars come from activate rows and from +/- arrows, nested ones offset', () => {
    const l = lay('A->>+B: go\nactivate B\nB-->>A: back\ndeactivate B\nB-->>-A: done');
    assert.strictEqual(l.bars.length, 2);
    const [inner, outer] = l.bars;
    assert.strictEqual(inner.x - outer.x, 4);
    assert.ok(outer.y1 > inner.y1);
  });

  test('an unbalanced deactivate draws nothing and does not throw', () => {
    assert.strictEqual(lay('deactivate A\nA->>B: x').bars.length, 0);
  });
});

suite('sequence layout — helpers', () => {
  test('fitText keeps short text and ellipsizes long text', () => {
    assert.strictEqual(fitText('short', 100, measure), 'short');
    const out = fitText('a much longer label', 60, measure);
    assert.ok(out.endsWith('…') && measure(out) <= 60);
  });

  test('fitView fills the width (65–100%) or shows everything when asked', () => {
    const l = lay('A->>B: x');
    const wide = fitView(2000, 800, l, false);
    assert.strictEqual(wide.z, 1);
    assert.ok(wide.x > 0);
    assert.strictEqual(fitView(100, 800, l, false).z, 0.65);
    const whole = fitView(300, 200, l, true);
    assert.ok(whole.z * l.width <= 300 && whole.z >= 0.3);
  });
});
