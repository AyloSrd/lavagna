import * as assert from 'assert';
import { suite, test } from 'vitest';
import {
  bounds,
  detachArrows,
  duplicateMarks,
  edgePoint,
  extendDraft,
  hitTest,
  isDegenerate,
  linePoints,
  mapMarks,
  moveEndpoint,
  removeMarks,
  resizeBox,
  restyle,
  snapAngle,
  topHit,
  translate,
} from '../../webview/editors/canvas/geometry';
import {
  DEFAULT_STYLE,
  LineMark,
  lookupIn,
  Mark,
  ShapeMark,
  StrokeMark,
  styleControls,
  TextMark,
} from '../../webview/editors/canvas/model';

const rect = (id: string, x: number, y: number, w: number, h: number, extra: Partial<ShapeMark> = {}): ShapeMark =>
  ({ ...DEFAULT_STYLE, id, seed: 1, type: 'rect', label: '', x, y, w, h, ...extra });
const ellipse = (id: string, x: number, y: number, w: number, h: number): ShapeMark =>
  ({ ...rect(id, x, y, w, h), type: 'ellipse' });
const arrow = (id: string, a: [number, number], b: [number, number], extra: Partial<LineMark> = {}): LineMark =>
  ({ ...DEFAULT_STYLE, id, seed: 1, type: 'arrow', points: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }], ...extra });
const text = (id: string, x: number, y: number, t: string): TextMark =>
  ({ ...DEFAULT_STYLE, id, seed: 1, type: 'text', text: t, x, y, w: 50, h: 24 });
const pen = (id: string, pts: [number, number][], type: 'pen' | 'marker' = 'pen'): StrokeMark =>
  ({ ...DEFAULT_STYLE, id, seed: 1, type, points: pts.map(([x, y]) => ({ x, y })) });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

suite('edgePoint', () => {
  test('meets a rectangle on the side facing the target, plus the gap', () => {
    const p = edgePoint(rect('r', 0, 0, 100, 50), { x: 300, y: 25 });
    near(p.x, 106);
    near(p.y, 25);
  });

  test('meets an ellipse on its outline', () => {
    const p = edgePoint(ellipse('e', 0, 0, 100, 50), { x: 50, y: 300 });
    near(p.x, 50);
    near(p.y, 56);
  });

  test('never overshoots a target inside the gap', () => {
    const p = edgePoint(rect('r', 0, 0, 100, 50), { x: 102, y: 25 });
    near(p.x, 102);
  });
});

suite('attached arrows', () => {
  test('an attached end follows its shape', () => {
    const r = rect('r', 200, 0, 100, 100);
    const a = arrow('a', [0, 50], [999, 999], { end: 'r' });
    const [, end] = linePoints(a, lookupIn([r, a]));
    near(end.x, 194);
    near(end.y, 50);
    const moved = translate(r, 0, 100) as ShapeMark;
    const [, end2] = linePoints(a, lookupIn([moved, a]));
    assert.ok(end2.y > 50, 'the attached end moved down with the shape');
  });

  test('a missing target falls back to the stored point', () => {
    const a = arrow('a', [0, 0], [10, 10], { end: 'gone' });
    assert.deepStrictEqual(linePoints(a, lookupIn([a]))[1], { x: 10, y: 10 });
  });

  test('deleting a shape freezes the arrow where it was drawn', () => {
    const r = rect('r', 200, 0, 100, 100);
    const a = arrow('a', [0, 50], [999, 999], { end: 'r' });
    const [left] = removeMarks([r, a], new Set(['r'])) as LineMark[];
    assert.strictEqual(left.end, undefined);
    near(left.points[1].x, 194);
  });

  test('detachArrows only touches the arrows it is asked to', () => {
    const r = rect('r', 200, 0, 100, 100);
    const a = arrow('a', [0, 50], [0, 0], { end: 'r' });
    const b = arrow('b', [0, 80], [0, 0], { end: 'r' });
    const out = detachArrows([r, a, b], () => true, (m) => m.id === 'a') as Mark[];
    assert.strictEqual((out[1] as LineMark).end, undefined);
    assert.strictEqual((out[2] as LineMark).end, 'r');
  });

  test('moving an endpoint lets go of its shape', () => {
    const a = moveEndpoint(arrow('a', [0, 0], [1, 1], { start: 's', end: 'e' }), 0, { x: 5, y: 5 });
    assert.strictEqual(a.start, undefined);
    assert.strictEqual(a.end, 'e');
    assert.deepStrictEqual(a.points[0], { x: 5, y: 5 });
  });
});

suite('hit testing', () => {
  test('shapes hit anywhere inside, lines near the stroke', () => {
    const marks: Mark[] = [rect('r', 0, 0, 100, 100), arrow('a', [200, 0], [300, 0])];
    const look = lookupIn(marks);
    assert.ok(hitTest(marks[0], { x: 50, y: 50 }, 4, look));
    assert.ok(hitTest(marks[1], { x: 250, y: 5 }, 4, look));
    assert.ok(!hitTest(marks[1], { x: 250, y: 30 }, 4, look));
  });

  test('ellipse corners are outside', () => {
    const e = ellipse('e', 0, 0, 100, 100);
    assert.ok(!hitTest(e, { x: 2, y: 2 }, 1, lookupIn([e])));
  });

  test('topHit returns the topmost accepted mark', () => {
    const marks: Mark[] = [rect('below', 0, 0, 100, 100), rect('above', 0, 0, 100, 100)];
    assert.strictEqual(topHit(marks, { x: 50, y: 50 }, 2)?.id, 'above');
    assert.strictEqual(topHit(marks, { x: 50, y: 50 }, 2, (m) => m.id === 'below')?.id, 'below');
    assert.strictEqual(topHit(marks, { x: 500, y: 500 }, 2), undefined);
  });

  test('a highlighter grows its bounds by half its stroke', () => {
    const m = pen('m', [[0, 0], [100, 0]], 'marker');
    const b = bounds(m, lookupIn([m]));
    near(b.y, -DEFAULT_STYLE.width * 2);
  });
});

suite('resizing', () => {
  const from = { x: 0, y: 0, w: 100, h: 50 };

  test('dragging a corner moves only that corner', () => {
    assert.deepStrictEqual(resizeBox(from, 'se', { x: 150, y: 80 }, false), { x1: 0, y1: 0, x2: 150, y2: 80 });
    assert.deepStrictEqual(resizeBox(from, 'w', { x: -20, y: 999 }, false), { x1: -20, y1: 0, x2: 100, y2: 50 });
  });

  test('keepRatio scales uniformly from the opposite corner', () => {
    const r = resizeBox(from, 'se', { x: 200, y: 60 }, true);
    assert.deepStrictEqual(r, { x1: 0, y1: 0, x2: 200, y2: 100 });
  });

  test('keepRatio follows the axis that moved further, so a sideways drag can shrink', () => {
    assert.deepStrictEqual(resizeBox(from, 'se', { x: 50, y: 50 }, true), { x1: 0, y1: 0, x2: 50, y2: 25 });
    assert.deepStrictEqual(resizeBox(from, 'nw', { x: 0, y: 40 }, true), { x1: 80, y1: 40, x2: 100, y2: 50 });
  });

  test('mapMarks scales boxes and points, and text by its height', () => {
    const marks: Mark[] = [rect('r', 0, 0, 100, 50), pen('p', [[0, 0], [100, 50]]), text('t', 0, 0, 'hi')];
    const out = mapMarks(marks, from, { x1: 0, y1: 0, x2: 200, y2: 100 }, (_t, fs) => ({ w: fs, h: fs }));
    assert.deepStrictEqual([(out[0] as ShapeMark).w, (out[0] as ShapeMark).h], [200, 100]);
    assert.deepStrictEqual((out[1] as StrokeMark).points[1], { x: 200, y: 100 });
    assert.strictEqual((out[2] as TextMark).fontSize, DEFAULT_STYLE.fontSize * 2);
    assert.strictEqual((out[2] as TextMark).w, DEFAULT_STYLE.fontSize * 2);
  });

  test('a box dragged past its other side comes out normalised', () => {
    const [r] = mapMarks([rect('r', 0, 0, 100, 50)], from, { x1: 0, y1: 0, x2: -100, y2: 50 }, () => ({ w: 0, h: 0 })) as ShapeMark[];
    assert.deepStrictEqual([r.x, r.w], [-100, 100]);
  });
});

suite('drawing', () => {
  test('Shift squares a box and snaps a line to 15°', () => {
    const r = extendDraft(rect('r', 10, 10, 0, 0), { x: 10, y: 10 }, { x: 60, y: 30 }, true, 1) as ShapeMark;
    assert.deepStrictEqual([r.w, r.h], [50, 50]);
    const s = snapAngle({ x: 0, y: 0 }, { x: 100, y: 3 });
    near(s.y, 0);
  });

  test('a Shift highlighter stroke stays horizontal', () => {
    const m = extendDraft(pen('m', [[0, 10]], 'marker'), { x: 0, y: 10 }, { x: 80, y: 40 }, true, 1) as StrokeMark;
    assert.deepStrictEqual(m.points, [{ x: 0, y: 10 }, { x: 80, y: 10 }]);
  });

  test('the pen skips points closer than a pixel and a half on screen', () => {
    const m = pen('p', [[0, 0]]);
    assert.strictEqual(extendDraft(m, { x: 0, y: 0 }, { x: 1, y: 0 }, false, 1), m);
    assert.strictEqual((extendDraft(m, { x: 0, y: 0 }, { x: 1, y: 0 }, false, 2) as StrokeMark).points.length, 2);
  });

  test('a click without a drag is degenerate, a stroke never is', () => {
    assert.ok(isDegenerate(rect('r', 0, 0, 2, 40), 1));
    assert.ok(!isDegenerate(rect('r', 0, 0, 2, 40), 2));
    assert.ok(isDegenerate(arrow('a', [0, 0], [3, 0]), 1));
    assert.ok(!isDegenerate(pen('p', [[0, 0]]), 1));
  });
});

suite('editing', () => {
  test('duplicates get new ids, keep attachments inside the copy, freeze the rest', () => {
    const r = rect('r', 200, 0, 100, 100);
    const s = rect('s', 0, 0, 10, 10);
    const a = arrow('a', [0, 50], [0, 0], { start: 's', end: 'r' });
    let n = 0;
    const copies = duplicateMarks([a, r], [r, s, a], 10, () => `c${++n}`, () => 7);
    const [ca, cr] = copies as [LineMark, ShapeMark];
    assert.strictEqual(cr.id, 'c2');
    assert.strictEqual(cr.x, 210);
    assert.strictEqual(ca.end, 'c2');
    assert.strictEqual(ca.start, undefined);
    assert.strictEqual(ca.seed, 7);
  });

  test('restyle re-measures text only when its size changes', () => {
    const t = text('t', 0, 0, 'hi');
    const measure = () => ({ w: 1, h: 2 });
    assert.strictEqual((restyle(t, { color: 'blue' }, measure) as TextMark).w, 50);
    assert.deepStrictEqual([(restyle(t, { fontSize: 36 }, measure) as TextMark).w, (restyle(t, { fontSize: 36 }, measure) as TextMark).h], [1, 2]);
  });

  test('style controls follow what is selected', () => {
    assert.deepStrictEqual(styleControls(['text']), { color: true, width: false, fill: false, lineStyle: false, fontSize: true });
    assert.deepStrictEqual(styleControls(['pen']), { color: true, width: true, fill: false, lineStyle: false, fontSize: false });
    assert.deepStrictEqual(styleControls(['rect', 'arrow']), { color: true, width: true, fill: true, lineStyle: true, fontSize: true });
    assert.deepStrictEqual(styleControls(['image']), { color: false, width: false, fill: false, lineStyle: false, fontSize: false });
    assert.strictEqual(styleControls(['image', 'pen']).color, true);
  });
});
