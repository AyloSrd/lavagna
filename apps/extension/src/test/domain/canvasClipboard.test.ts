import * as assert from 'assert';
import { beforeEach, suite, test } from 'vitest';
import {
  clearCopiedMarks,
  copyMarks,
  hasCopiedMarks,
  PASTE_STEP,
  pasteMarks,
} from '../../webview/editors/canvas/clipboard';
import { pointInBox } from '../../webview/editors/canvas/geometry';
import { DEFAULT_STYLE, ImageMark, LineMark, Mark, ShapeMark } from '../../webview/editors/canvas/model';

const rect = (id: string, x: number, y: number): ShapeMark =>
  ({ ...DEFAULT_STYLE, id, seed: 1, type: 'rect', x, y, w: 50, h: 40, label: '' });
const arrow = (id: string, start?: string, end?: string): LineMark =>
  ({ ...DEFAULT_STYLE, id, seed: 1, type: 'arrow', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }], start, end });

beforeEach(() => clearCopiedMarks());

suite('canvas clipboard', () => {
  test('nothing to paste until something is copied; an empty copy changes nothing', () => {
    assert.strictEqual(hasCopiedMarks(), false);
    assert.strictEqual(pasteMarks(), null);
    copyMarks([], [rect('a', 0, 0)]);
    assert.strictEqual(hasCopiedMarks(), false);
  });

  test('each paste is a fresh set of ids, one step further than the last', () => {
    const a = rect('a', 10, 20);
    copyMarks([a], [a]);
    const first = pasteMarks()! as ShapeMark[];
    const second = pasteMarks()! as ShapeMark[];
    assert.deepStrictEqual([first[0].x, first[0].y], [10 + PASTE_STEP, 20 + PASTE_STEP]);
    assert.deepStrictEqual([second[0].x, second[0].y], [10 + 2 * PASTE_STEP, 20 + 2 * PASTE_STEP]);
    assert.notStrictEqual(first[0].id, 'a');
    assert.notStrictEqual(first[0].id, second[0].id);
  });

  test('a copy is a snapshot: changing the original later does not change what pastes', () => {
    const a = rect('a', 10, 20);
    copyMarks([a], [a]);
    a.x = 999;
    assert.strictEqual((pasteMarks()![0] as ShapeMark).x, 10 + PASTE_STEP);
  });

  test('arrows attached inside the copy follow the copies; ends attached outside freeze', () => {
    const a = rect('a', 0, 0);
    const b = rect('b', 400, 0);
    const inside = arrow('x', 'a', 'b');
    const half = arrow('y', 'a', 'c');
    const c = rect('c', 800, 0);
    copyMarks([a, b, inside, half], [a, b, c, inside, half]);
    const pasted = pasteMarks()!;
    const ids = new Set(pasted.map((m) => m.id));
    const pastedInside = pasted.find((m) => m.type === 'arrow' && m.start && m.end) as LineMark;
    assert.ok(ids.has(pastedInside.start!) && ids.has(pastedInside.end!));
    const pastedHalf = pasted.filter((m): m is LineMark => m.type === 'arrow').find((m) => m !== pastedInside)!;
    assert.ok(ids.has(pastedHalf.start!));
    assert.strictEqual(pastedHalf.end, undefined);
  });

  test('pasted pictures keep their image', () => {
    const img: ImageMark = { ...DEFAULT_STYLE, id: 'i', seed: 1, type: 'image', asset: 'img7', x: 0, y: 0, w: 10, h: 10 };
    copyMarks([img], [img] as Mark[]);
    assert.strictEqual((pasteMarks()![0] as ImageMark).asset, 'img7');
  });
});

suite('pointInBox', () => {
  const box = { x: 10, y: 10, w: 100, h: 50 };
  test('inside, on the edge, and within the padding count; outside does not', () => {
    assert.strictEqual(pointInBox({ x: 60, y: 30 }, box), true);
    assert.strictEqual(pointInBox({ x: 10, y: 60 }, box), true);
    assert.strictEqual(pointInBox({ x: 5, y: 30 }, box), false);
    assert.strictEqual(pointInBox({ x: 5, y: 30 }, box, 6), true);
    assert.strictEqual(pointInBox({ x: 60, y: 67 }, box, 6), false);
  });
});
