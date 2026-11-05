import {
  Box,
  hasBox,
  isLine,
  isStroke,
  LineMark,
  Lookup,
  Mark,
  MarkStyle,
  Point,
  strokeWidth,
} from './model';

// Geometry over marks in image coordinates: where arrows meet the shapes they
// are attached to, what a pointer hits, and how a resize maps old to new.
// Every function returns new values and never mutates its input.

/** Gap left between an attached arrow tip and the shape outline. */
export const ATTACH_GAP = 6;

export const center = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Point on `shape`'s outline facing `toward`, pushed out by ATTACH_GAP. */
export function edgePoint(shape: Mark & Box, toward: Point): Point {
  const c = center(shape);
  let dx = toward.x - c.x;
  let dy = toward.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    return c;
  }
  dx /= len;
  dy /= len;
  const hw = Math.max(shape.w / 2, 1);
  const hh = Math.max(shape.h / 2, 1);
  let t = shape.type === 'ellipse'
    ? 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2)
    : Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
  t = Math.min(t + ATTACH_GAP, len);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

const attached = (id: string | undefined, lookup: Lookup): (Mark & Box) | undefined => {
  const m = id ? lookup(id) : undefined;
  return m && hasBox(m) ? m : undefined;
};

/** A line's drawn endpoints: an attached end sits on its shape's outline. */
export function linePoints(m: LineMark, lookup: Lookup): [Point, Point] {
  const [a, b] = m.points;
  if (m.type !== 'arrow') {
    return [a, b];
  }
  const s = attached(m.start, lookup);
  const e = attached(m.end, lookup);
  return [
    s ? edgePoint(s, e ? center(e) : b) : a,
    e ? edgePoint(e, s ? center(s) : a) : b,
  ];
}

function pointsBox(pts: readonly Point[], pad = 0): Box {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) {
    x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y);
  }
  return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
}

export function bounds(m: Mark, lookup: Lookup): Box {
  if (isLine(m)) {
    return pointsBox(linePoints(m, lookup));
  }
  if (isStroke(m)) {
    return pointsBox(m.points, m.type === 'marker' ? strokeWidth(m) / 2 : 0);
  }
  return { x: m.x, y: m.y, w: m.w, h: m.h };
}

export function unionBounds(marks: readonly Mark[], lookup: Lookup): Box {
  const boxes = marks.map((m) => bounds(m, lookup));
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const contains = (outer: Box, inner: Box): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

export function boxFrom(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/**
 * Whether `p` hits `m`. `slop` is extra tolerance in image pixels (callers pass
 * a few screen pixels divided by the zoom). Shapes hit anywhere inside, not
 * just on the outline — easier to grab.
 */
export function hitTest(m: Mark, p: Point, slop: number, lookup: Lookup): boolean {
  const tol = slop + strokeWidth(m) / 2;
  if (isLine(m)) {
    const [a, b] = linePoints(m, lookup);
    return distToSegment(p, a, b) <= tol;
  }
  if (isStroke(m)) {
    if (m.points.length === 1) {
      return dist(p, m.points[0]) <= tol;
    }
    return m.points.some((q, i) => i > 0 && distToSegment(p, m.points[i - 1], q) <= tol);
  }
  const hw = m.w / 2 + tol;
  const hh = m.h / 2 + tol;
  const dx = Math.abs(p.x - (m.x + m.w / 2));
  const dy = Math.abs(p.y - (m.y + m.h / 2));
  return m.type === 'ellipse' ? (dx / hw) ** 2 + (dy / hh) ** 2 <= 1 : dx <= hw && dy <= hh;
}

/** Topmost mark under `p` that passes `accept`. */
export function topHit(
  marks: readonly Mark[],
  p: Point,
  slop: number,
  accept: (m: Mark) => boolean = () => true,
): Mark | undefined {
  const lookup = (id: string) => marks.find((m) => m.id === id);
  for (let i = marks.length - 1; i >= 0; i--) {
    if (accept(marks[i]) && hitTest(marks[i], p, slop, lookup)) {
      return marks[i];
    }
  }
  return undefined;
}

export function translate(m: Mark, dx: number, dy: number): Mark {
  if (isLine(m)) {
    return { ...m, points: [{ x: m.points[0].x + dx, y: m.points[0].y + dy }, { x: m.points[1].x + dx, y: m.points[1].y + dy }] };
  }
  if (isStroke(m)) {
    return { ...m, points: m.points.map((q) => ({ x: q.x + dx, y: q.y + dy })) };
  }
  return { ...m, x: m.x + dx, y: m.y + dy };
}

/**
 * Detach arrow ends whose target `gone(id)` says is going away (deleted, or
 * left behind by a move), for the arrows `only` accepts. The end freezes
 * where it is drawn now.
 */
export function detachArrows(
  marks: readonly Mark[],
  gone: (id: string) => boolean,
  only: (m: Mark) => boolean = () => true,
): Mark[] {
  const lookup = (id: string) => marks.find((m) => m.id === id);
  return marks.map((m) => {
    if (m.type !== 'arrow' || !only(m) || !((m.start && gone(m.start)) || (m.end && gone(m.end)))) {
      return m;
    }
    const [a, b] = linePoints(m, lookup);
    const next: LineMark = { ...m, points: [m.start && gone(m.start) ? a : m.points[0], m.end && gone(m.end) ? b : m.points[1]] };
    if (m.start && gone(m.start)) { delete next.start; }
    if (m.end && gone(m.end)) { delete next.end; }
    return next;
  });
}

/** Remove marks; arrows attached to them keep their current position. */
export function removeMarks(marks: readonly Mark[], ids: ReadonlySet<string>): Mark[] {
  return detachArrows(marks, (id) => ids.has(id)).filter((m) => !ids.has(m.id));
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Resize handle positions around `b`, `pad` outside it. */
export function handlePoints(b: Box, pad: number): Record<Handle, Point> {
  const x1 = b.x - pad, y1 = b.y - pad, x2 = b.x + b.w + pad, y2 = b.y + b.h + pad;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return {
    nw: { x: x1, y: y1 }, n: { x: mx, y: y1 }, ne: { x: x2, y: y1 }, e: { x: x2, y: my },
    se: { x: x2, y: y2 }, s: { x: mx, y: y2 }, sw: { x: x1, y: y2 }, w: { x: x1, y: my },
  };
}

/**
 * The box after dragging `handle` of `from` to `p`. With `keepRatio`, corners
 * scale uniformly and edges scale around the opposite edge's centre.
 * The result may have a negative width/height (dragged past the other side).
 */
export function resizeBox(from: Box, handle: Handle, p: Point, keepRatio: boolean): { x1: number; y1: number; x2: number; y2: number } {
  const ax2 = from.x + from.w;
  const ay2 = from.y + from.h;
  let x1 = from.x, y1 = from.y, x2 = ax2, y2 = ay2;
  if (handle.includes('w')) { x1 = p.x; }
  if (handle.includes('e')) { x2 = p.x; }
  if (handle.includes('n')) { y1 = p.y; }
  if (handle.includes('s')) { y2 = p.y; }
  if (keepRatio) {
    const sx = Math.abs((x2 - x1) / (from.w || 1));
    const sy = Math.abs((y2 - y1) / (from.h || 1));
    const s = handle.length === 2 ? Math.max(sx, sy) : handle === 'e' || handle === 'w' ? sx : sy;
    const nw = from.w * s;
    const nh = from.h * s;
    if (handle.includes('w')) { x1 = ax2 - nw; } else if (handle.includes('e')) { x2 = from.x + nw; } else { const c = from.x + from.w / 2; x1 = c - nw / 2; x2 = c + nw / 2; }
    if (handle.includes('n')) { y1 = ay2 - nh; } else if (handle.includes('s')) { y2 = from.y + nh; } else { const c = from.y + from.h / 2; y1 = c - nh / 2; y2 = c + nh / 2; }
  }
  return { x1, y1, x2, y2 };
}

/**
 * Map `orig` marks from box `from` onto the rectangle `to` (corners as
 * resizeBox returns them). Text scales its font with the height; `measure`
 * re-derives a text mark's box from its new font size.
 */
export function mapMarks(
  orig: readonly Mark[],
  from: Box,
  to: { x1: number; y1: number; x2: number; y2: number },
  measure: (text: string, fontSize: number) => { w: number; h: number },
): Mark[] {
  const kx = (to.x2 - to.x1) / (from.w || 1);
  const ky = (to.y2 - to.y1) / (from.h || 1);
  const fx = (v: number) => to.x1 + (v - from.x) * kx;
  const fy = (v: number) => to.y1 + (v - from.y) * ky;
  return orig.map((o): Mark => {
    if (isLine(o)) {
      return { ...o, points: [{ x: fx(o.points[0].x), y: fy(o.points[0].y) }, { x: fx(o.points[1].x), y: fy(o.points[1].y) }] };
    }
    if (isStroke(o)) {
      return { ...o, points: o.points.map((q) => ({ x: fx(q.x), y: fy(q.y) })) };
    }
    const ax = fx(o.x), bx = fx(o.x + o.w), ay = fy(o.y), by = fy(o.y + o.h);
    if (o.type === 'text') {
      const fontSize = Math.max(8, o.fontSize * Math.abs(ky));
      return { ...o, x: Math.min(ax, bx), y: Math.min(ay, by), fontSize, ...measure(o.text, fontSize) };
    }
    return { ...o, x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  });
}

/** Snap the vector a→b to the nearest 15°. */
export function snapAngle(a: Point, b: Point): Point {
  const step = Math.PI / 12;
  const len = dist(a, b);
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / step) * step;
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

/** Box dragged from `start` to `p`; square with `square`. */
export function dragBox(start: Point, p: Point, square: boolean): Box {
  let w = p.x - start.x;
  let h = p.y - start.y;
  if (square) {
    const m = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * m;
    h = Math.sign(h || 1) * m;
  }
  return boxFrom(start, { x: start.x + w, y: start.y + h });
}

/**
 * Copies of `marks` moved by (d, d) with fresh ids. Arrow ends attached
 * inside the copied set point at the copies; ends attached outside it freeze.
 */
export function duplicateMarks(
  marks: readonly Mark[],
  all: readonly Mark[],
  d: number,
  newId: () => string,
  newSeed: () => number,
): Mark[] {
  const lookup = (id: string) => all.find((m) => m.id === id);
  const ids = new Map(marks.map((m) => [m.id, newId()]));
  return marks.map((o) => {
    let c: Mark = { ...o, id: ids.get(o.id)!, seed: newSeed() };
    if (c.type === 'arrow' && o.type === 'arrow') {
      const [a, b] = linePoints(o, lookup);
      const line: LineMark = { ...c, points: [...c.points] };
      if (o.start) { if (ids.has(o.start)) { line.start = ids.get(o.start); } else { line.points[0] = a; delete line.start; } }
      if (o.end) { if (ids.has(o.end)) { line.end = ids.get(o.end); } else { line.points[1] = b; delete line.end; } }
      c = line;
    }
    return translate(c, d, d);
  });
}

/** Pointer distance (screen pixels) between two recorded pen points. */
const PEN_STEP = 1.5;

/**
 * The mark being drawn, stretched to pointer `p`. `start` is where the drag
 * began; `constrain` (Shift) squares boxes, snaps lines to 15° and keeps the
 * highlighter horizontal.
 */
export function extendDraft(m: Mark, start: Point, p: Point, constrain: boolean, zoom: number): Mark {
  if (isLine(m)) {
    return { ...m, points: [m.points[0], constrain ? snapAngle(start, p) : p] };
  }
  if (isStroke(m)) {
    if (constrain && m.type === 'marker') {
      return { ...m, points: [m.points[0], { x: p.x, y: m.points[0].y }] };
    }
    const last = m.points[m.points.length - 1];
    return dist(last, p) * zoom > PEN_STEP ? { ...m, points: [...m.points, p] } : m;
  }
  if (m.type === 'text') {
    return m;
  }
  return { ...m, ...dragBox(start, p, constrain) };
}

/** A click without a real drag leaves nothing worth keeping. */
export function isDegenerate(m: Mark, zoom: number): boolean {
  if (isLine(m)) {
    return dist(m.points[0], m.points[1]) * zoom <= 4;
  }
  if (isStroke(m) || m.type === 'text') {
    return false;
  }
  return m.w * zoom <= 3 || m.h * zoom <= 3;
}

/** Move one end of a line; that end lets go of whatever it was attached to. */
export function moveEndpoint(m: LineMark, index: 0 | 1, p: Point): LineMark {
  const next: LineMark = { ...m, points: index === 0 ? [p, m.points[1]] : [m.points[0], p] };
  if (index === 0) { delete next.start; } else { delete next.end; }
  return next;
}

/** Apply a style change to a mark; text is re-measured when its size changes. */
export function restyle(
  m: Mark,
  patch: Partial<MarkStyle>,
  measure: (text: string, fontSize: number) => { w: number; h: number },
): Mark {
  const next = { ...m, ...patch } as Mark;
  if (next.type === 'text' && patch.fontSize !== undefined) {
    return { ...next, ...measure(next.text, next.fontSize) };
  }
  return next;
}

