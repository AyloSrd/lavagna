import * as assert from 'assert';
import { suite, test } from 'vitest';
import {
  bounds,
  duplicateMarks,
  hitTest,
  linePoints,
  mapMarks,
  placeImage,
  reorder,
  resizeBox,
  translate,
} from '../../webview/editors/canvas/geometry';
import { DEFAULT_STYLE, hasBox, ImageMark, isAttachable, LineMark, lookupIn, Mark } from '../../webview/editors/canvas/model';

const canvas = { w: 800, h: 600 };

function image(over: Partial<ImageMark> = {}): ImageMark {
  return { ...DEFAULT_STYLE, id: 'img', seed: 1, type: 'image', asset: 'a1', x: 100, y: 100, w: 200, h: 100, ...over };
}

const noMeasure = () => ({ w: 0, h: 0 });

suite('placeImage', () => {
  test('a picture larger than the canvas shrinks to fit inside it, proportions kept', () => {
    const box = placeImage({ w: 1600, h: 800 }, canvas);
    assert.deepStrictEqual(box, { x: 0, y: 100, w: 800, h: 400 });
  });

  test('the tighter side decides: a tall picture fits the height', () => {
    const box = placeImage({ w: 600, h: 1200 }, canvas);
    assert.deepStrictEqual(box, { x: 250, y: 0, w: 300, h: 600 });
  });

  test('a smaller picture keeps its own size, centred', () => {
    assert.deepStrictEqual(placeImage({ w: 200, h: 100 }, canvas), { x: 300, y: 250, w: 200, h: 100 });
  });

  test('centred on a drop point, but never past an edge', () => {
    assert.deepStrictEqual(placeImage({ w: 200, h: 100 }, canvas, { x: 400, y: 300 }), { x: 300, y: 250, w: 200, h: 100 });
    assert.deepStrictEqual(placeImage({ w: 200, h: 100 }, canvas, { x: 10, y: 590 }), { x: 0, y: 500, w: 200, h: 100 });
    assert.deepStrictEqual(placeImage({ w: 200, h: 100 }, canvas, { x: 790, y: -50 }), { x: 600, y: 0, w: 200, h: 100 });
  });

  test('a picture exactly the canvas size fills it', () => {
    assert.deepStrictEqual(placeImage({ w: 800, h: 600 }, canvas), { x: 0, y: 0, w: 800, h: 600 });
  });

  test('a zero-sized picture does not divide by zero', () => {
    const box = placeImage({ w: 0, h: 0 }, canvas);
    assert.ok(Number.isFinite(box.x) && Number.isFinite(box.y));
  });
});

suite('image marks behave like boxes', () => {
  test('they have a box, are hit anywhere inside, and arrows attach to them', () => {
    const m = image();
    assert.ok(hasBox(m) && isAttachable(m));
    const lookup = lookupIn([m]);
    assert.deepStrictEqual(bounds(m, lookup), { x: 100, y: 100, w: 200, h: 100 });
    assert.strictEqual(hitTest(m, { x: 200, y: 150 }, 0, lookup), true);
    assert.strictEqual(hitTest(m, { x: 50, y: 50 }, 0, lookup), false);
  });

  test('an arrow attached to an image ends on its outline', () => {
    const m = image();
    const arrow: LineMark = { ...DEFAULT_STYLE, id: 'a', seed: 2, type: 'arrow', points: [{ x: 600, y: 150 }, { x: 0, y: 0 }], end: 'img' };
    const [, end] = linePoints(arrow, lookupIn([m, arrow]));
    assert.ok(end.x > 300 && end.x < 310 && Math.abs(end.y - 150) < 1);
  });

  test('move, resize and duplicate keep the asset', () => {
    const m = image();
    const moved = translate(m, 10, 20) as ImageMark;
    assert.deepStrictEqual([moved.x, moved.y, moved.asset], [110, 120, 'a1']);
    const from = { x: 100, y: 100, w: 200, h: 100 };
    const [resized] = mapMarks([m], from, resizeBox(from, 'se', { x: 500, y: 150 }, true), noMeasure) as ImageMark[];
    assert.deepStrictEqual([resized.w, resized.h, resized.asset], [400, 200, 'a1']);
    const [copy] = duplicateMarks([m], [m], 16, () => 'copy', () => 3) as ImageMark[];
    assert.deepStrictEqual([copy.id, copy.asset, copy.x], ['copy', 'a1', 116]);
  });
});

suite('reorder', () => {
  const ids = (marks: Mark[]) => marks.map((m) => m.id);
  const stack = ['a', 'b', 'c', 'd'].map((id) => image({ id }));

  test('front moves the selection to the top, keeping its own order', () => {
    assert.deepStrictEqual(ids(reorder(stack, new Set(['a', 'c']), 'front')), ['b', 'd', 'a', 'c']);
  });

  test('back moves it to the bottom', () => {
    assert.deepStrictEqual(ids(reorder(stack, new Set(['d', 'b']), 'back')), ['b', 'd', 'a', 'c']);
  });

  test('nothing selected changes nothing, and the input is not mutated', () => {
    assert.deepStrictEqual(ids(reorder(stack, new Set(), 'front')), ['a', 'b', 'c', 'd']);
    assert.deepStrictEqual(ids(stack), ['a', 'b', 'c', 'd']);
  });
});
