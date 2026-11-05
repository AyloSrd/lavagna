import * as assert from 'assert';
import { suite, test } from 'vitest';
import { route } from '../../webview/editors/flow/routing';

const box = (x: number, y: number) => ({ x, y, w: 100, h: 40 });
const sides = (r: ReturnType<typeof route>) => `${r.from.side}>${r.to.side}`;

suite('flow edge routing', () => {
  test('forward edges run along the direction', () => {
    assert.strictEqual(sides(route(box(0, 0), box(0, 120), 'TD')), 'bottom>top');
    assert.strictEqual(sides(route(box(0, 120), box(0, 0), 'BT')), 'top>bottom');
    assert.strictEqual(sides(route(box(0, 0), box(200, 0), 'LR')), 'right>left');
    assert.strictEqual(sides(route(box(200, 0), box(0, 0), 'RL')), 'left>right');
  });

  test('back edges loop round the outer side', () => {
    assert.strictEqual(sides(route(box(0, 240), box(0, 0), 'TD')), 'right>right');
    assert.strictEqual(sides(route(box(300, 0), box(0, 0), 'LR')), 'bottom>bottom');
  });

  test('edges within a rank go sideways', () => {
    assert.strictEqual(sides(route(box(0, 0), box(200, 10), 'TD')), 'right>left');
    assert.strictEqual(sides(route(box(200, 0), box(0, 0), 'TD')), 'left>right');
    assert.strictEqual(sides(route(box(0, 0), box(10, 100), 'LR')), 'bottom>top');
  });

  test('ports sit on the middle of each side', () => {
    const r = route(box(0, 0), box(0, 120), 'TD');
    assert.deepStrictEqual([r.from.x, r.from.y, r.to.x, r.to.y], [50, 40, 50, 120]);
  });
});
