import * as assert from 'assert';
import { suite, test } from 'vitest';
import {
  arrowHead,
  polygonPaths,
  seededRandom,
  segmentPaths,
  sketchEllipsePaths,
  smoothPath,
} from '../../webview/editors/canvas/sketch';
import { fitView, toImage, toScreen, zoomAround } from '../../webview/editors/canvas/viewport';

const a = { x: 0, y: 0 };
const b = { x: 100, y: 0 };

suite('sketch paths', () => {
  test('the same seed always draws the same wobble', () => {
    assert.deepStrictEqual(segmentPaths(a, b, 1.2, seededRandom(42)), segmentPaths(a, b, 1.2, seededRandom(42)));
    assert.notDeepStrictEqual(segmentPaths(a, b, 1.2, seededRandom(42)), segmentPaths(a, b, 1.2, seededRandom(43)));
  });

  test('a clean segment is one exact line', () => {
    assert.deepStrictEqual(segmentPaths(a, b, 0, seededRandom(1)), [[{ op: 'move', p: a }, { op: 'line', p: b }]]);
  });

  test('hand-drawn strokes use two passes, dashed ones one', () => {
    assert.strictEqual(segmentPaths(a, b, 1.2, seededRandom(1)).length, 2);
    assert.strictEqual(segmentPaths(a, b, 1.2, seededRandom(1), 1).length, 1);
    assert.strictEqual(polygonPaths([a, b, { x: 100, y: 50 }, { x: 0, y: 50 }], 1.2, seededRandom(1), 1).length, 4);
    assert.strictEqual(sketchEllipsePaths(a, 50, 30, 1.2, seededRandom(1)).length, 2);
  });

  test('a clean polygon is closed', () => {
    const [path] = polygonPaths([a, b, { x: 50, y: 50 }], 0, seededRandom(1));
    assert.deepStrictEqual(path[path.length - 1], { op: 'line', p: a });
  });

  test('a single pen point still draws a dot', () => {
    const p = smoothPath([a]);
    assert.strictEqual(p.length, 2);
    assert.deepStrictEqual(smoothPath([]), []);
  });

  test('arrowhead barbs sit behind the tip, either side of the shaft', () => {
    const [l, r] = arrowHead(a, b, 2);
    assert.ok(l.x < 100 && r.x < 100);
    assert.ok(Math.sign(l.y) === -Math.sign(r.y));
  });
});

suite('viewport', () => {
  test('fit centres the image and never enlarges past 150%', () => {
    const v = fitView(100, 100, 1000, 1000, false);
    assert.strictEqual(v.z, 1.5);
    assert.strictEqual(v.x, (1000 - 150) / 2);
  });

  test('fit shrinks a large image into the stage', () => {
    const v = fitView(4000, 1000, 1000, 800, false);
    assert.ok(v.z < 1 && 4000 * v.z <= 1000);
  });

  test('zoomAround keeps the point under the cursor fixed', () => {
    const v = { x: 30, y: 40, z: 1 };
    const before = toImage(v, 200, 100);
    const after = zoomAround(v, 200, 100, 2.5);
    const back = toScreen(after, before.x, before.y);
    assert.ok(Math.abs(back.x - 200) < 1e-9 && Math.abs(back.y - 100) < 1e-9);
  });

  test('zoom is clamped', () => {
    assert.strictEqual(zoomAround({ x: 0, y: 0, z: 1 }, 0, 0, 100).z, 6);
    assert.strictEqual(zoomAround({ x: 0, y: 0, z: 1 }, 0, 0, 0.001).z, 0.1);
  });
});
