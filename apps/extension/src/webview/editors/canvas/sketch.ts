import type { Point } from './model';

// Path recipes for the canvas strokes, as plain commands: the renderer replays
// them on a 2D context, the tests inspect them. "Hand-drawn" strokes wobble by
// a seeded random amount, so a mark looks the same on every redraw and in the
// saved PNG.

export type PathCommand =
  | { op: 'move'; p: Point }
  | { op: 'line'; p: Point }
  | { op: 'quad'; c: Point; p: Point };

/** One sub-path; a stroke may be drawn as several overlapping passes. */
export type Path = PathCommand[];

/** Deterministic PRNG (mulberry32) in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wobble amount for hand-drawn strokes; 0 draws them clean. */
export const SKETCH_ROUGHNESS = 1.2;

/**
 * A straight segment. Clean: one exact line. Hand-drawn: `passes` slightly
 * bowed, jittered curves (one pass for dashed strokes, where two would blur
 * the dash pattern).
 */
export function segmentPaths(a: Point, b: Point, rough: number, rand: () => number, passes = 2): Path[] {
  if (!rough) {
    return [[{ op: 'move', p: a }, { op: 'line', p: b }]];
  }
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const amp = rough * Math.min(2, 0.5 + len / 140);
  const paths: Path[] = [];
  for (let k = 0; k < passes; k++) {
    const o = () => (rand() - 0.5) * 2 * amp;
    const bow = (rand() - 0.5) * len * 0.02 * rough;
    paths.push([
      { op: 'move', p: { x: a.x + o(), y: a.y + o() } },
      {
        op: 'quad',
        c: { x: (a.x + b.x) / 2 + nx * bow, y: (a.y + b.y) / 2 + ny * bow },
        p: { x: b.x + o(), y: b.y + o() },
      },
    ]);
  }
  return paths;
}

/** Closed polygon outline, one segment at a time when hand-drawn. */
export function polygonPaths(pts: readonly Point[], rough: number, rand: () => number, passes = 2): Path[] {
  if (!rough) {
    return [[{ op: 'move', p: pts[0] }, ...pts.slice(1).map((p): PathCommand => ({ op: 'line', p })), { op: 'line', p: pts[0] }]];
  }
  return pts.flatMap((p, i) => segmentPaths(p, pts[(i + 1) % pts.length], rough, rand, passes));
}

/** A smooth curve through `pts` (midpoint quadratics), as one path. */
export function smoothPath(pts: readonly Point[]): Path {
  if (pts.length === 0) {
    return [];
  }
  if (pts.length < 3) {
    const last = pts[pts.length - 1];
    // A single click still leaves a dot: a tiny segment with round caps.
    return [{ op: 'move', p: pts[0] }, { op: 'line', p: { x: last.x + 0.01, y: last.y } }];
  }
  const path: Path = [{ op: 'move', p: pts[0] }];
  for (let i = 1; i < pts.length - 1; i++) {
    path.push({ op: 'quad', c: pts[i], p: { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 } });
  }
  path.push({ op: 'line', p: pts[pts.length - 1] });
  return path;
}

/**
 * Hand-drawn ellipse outline: a slightly overshooting loop with a little
 * radius jitter. Clean ellipses are drawn natively by the renderer instead.
 */
export function sketchEllipsePaths(c: Point, rx: number, ry: number, rough: number, rand: () => number, passes = 2): Path[] {
  const paths: Path[] = [];
  for (let k = 0; k < passes; k++) {
    const n = Math.max(10, Math.round((rx + ry) / 12));
    const a0 = rand() * Math.PI * 2;
    const span = Math.PI * 2 * (1.04 + 0.05 * rand());
    const pts: Point[] = [];
    for (let i = 0; i <= n; i++) {
      const t = a0 + (span * i) / n;
      const j = 1 + (rand() - 0.5) * 0.05 * rough;
      pts.push({ x: c.x + Math.cos(t) * rx * j, y: c.y + Math.sin(t) * ry * j });
    }
    paths.push(smoothPath(pts));
  }
  return paths;
}

/** The two barbs of an arrowhead at `tip`, pointing along from→tip. */
export function arrowHead(from: Point, tip: Point, strokeW: number): [Point, Point] {
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  const len = Math.min(10 + strokeW * 3, Math.hypot(tip.x - from.x, tip.y - from.y) * 0.45);
  const barb = (s: number): Point => ({
    x: tip.x + Math.cos(ang + Math.PI + s * 0.45) * len,
    y: tip.y + Math.sin(ang + Math.PI + s * 0.45) * len,
  });
  return [barb(-1), barb(1)];
}
