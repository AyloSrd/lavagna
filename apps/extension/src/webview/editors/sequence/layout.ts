import type { SequenceData, SequenceStep } from '../../format/sequence';

// Geometry of the rendered sequence diagram, in diagram units (the SVG's own
// coordinates, before zoom). Pure: text widths come from an injected `measure`
// so the same layout drives the SVG, the hit-testing and the tests.

/** Left gutter that holds the row grips and the insert "+". */
export const GUTTER = 40;
export const PAD = 20;
export const LANE_W = 170;
export const TOP = 14;
export const LIFE_TOP = TOP + 50;
export const ROWS_TOP = TOP + 70;
export const HEAD_W = LANE_W - 36;

export type Measure = (text: string, size?: number, weight?: number) => number;

export const laneX = (i: number) => GUTTER + PAD + LANE_W / 2 + i * LANE_W;

const CONTINUATIONS = new Set(['else', 'and', 'option']);

/** `else` / `and` / `option` divide the frame they sit in rather than opening one. */
export const isContinuation = (s: SequenceStep) => s.type === 'block' && CONTINUATIONS.has(s.keyword);

/** Steps the user can select, edit and move: everything with a row of its own but `end`. */
export const isSelectable = (s: SequenceStep | undefined) =>
  !!s && (s.type === 'message' || s.type === 'note' || s.type === 'block');

export function rowHeight(s: SequenceStep): number {
  switch (s.type) {
    case 'message': return s.from === s.to ? 62 : 46;
    case 'note': return 44;
    case 'block': return isContinuation(s) ? 30 : 36;
    case 'end': return 16;
    default: return 0; // activate / deactivate only draw a bar
  }
}

export interface Row { y: number; h: number; cy: number }
export interface Box { x: number; y: number; w: number; h: number }

/** Where the floating bar sits and where the inline text field opens for a step. */
export interface Anchor {
  cx: number;
  top: number;
  bottom: number;
  edit: Box;
  align: 'left' | 'center';
}

export interface MessageGeom {
  i: number;
  x1: number;
  x2: number;
  /** Shaft height; for a self-message, the top of the loop. */
  y: number;
  self: boolean;
  textX: number;
  textY: number;
  textHit: Box;
}

export interface NoteGeom { i: number; box: Box }

export interface FrameGeom {
  i: number;
  keyword: string;
  label: string;
  box: Box;
  /** Width of the keyword tab in the top-left corner. */
  tabW: number;
  hit: Box;
}

export interface DividerGeom { i: number; x1: number; x2: number; y: number; text: string; hit: Box }

export interface BarGeom { actor: string; x: number; y0: number; y1: number }

export interface SequenceLayout {
  rows: Row[];
  /** Bottom of the last row. */
  last: number;
  /** Where lifelines end. */
  bottom: number;
  width: number;
  height: number;
  messages: MessageGeom[];
  notes: NoteGeom[];
  frames: FrameGeom[];
  dividers: DividerGeom[];
  bars: BarGeom[];
  anchors: (Anchor | null)[];
}

export function layoutSequence(data: SequenceData, measure: Measure): SequenceLayout {
  const { participants, steps } = data;
  const lane = new Map(participants.map((p, k) => [p.id, k]));
  const xOf = (id: string) => {
    const k = lane.get(id);
    return k === undefined ? null : laneX(k);
  };

  const rows: Row[] = [];
  let y = ROWS_TOP;
  for (const s of steps) {
    const h = rowHeight(s);
    rows.push({ y, h, cy: y + h / 2 });
    y += h;
  }
  const last = y;
  const bottom = last + 26;
  const anchors: (Anchor | null)[] = steps.map(() => null);
  const allX1 = laneX(0) - LANE_W / 2 + 14;
  const allX2 = laneX(Math.max(0, participants.length - 1)) + LANE_W / 2 - 14;

  // Frames: match each opening block to its `end`, collecting the dividers in between.
  const frames: FrameGeom[] = [];
  const dividers: DividerGeom[] = [];
  const open: { i: number; dividers: number[]; depth: number }[] = [];
  const closed: { i: number; dividers: number[]; depth: number; end: number | null }[] = [];
  const strays: number[] = [];
  steps.forEach((s, i) => {
    if (s.type === 'block') {
      if (!isContinuation(s)) {
        open.push({ i, dividers: [], depth: open.length });
      } else if (open.length) {
        open[open.length - 1].dividers.push(i);
      } else {
        strays.push(i);
      }
    } else if (s.type === 'end' && open.length) {
      closed.push({ ...open.pop()!, end: i });
    }
  });
  while (open.length) {
    closed.push({ ...open.pop()!, end: null });
  }

  const divider = (i: number, x1: number, x2: number) => {
    const s = steps[i];
    if (s.type !== 'block') {
      return;
    }
    const dy = rows[i].y + 8;
    const text = s.label ? `[${s.label}]` : `[${s.keyword}]`;
    const tw = measure(text, 11.5);
    dividers.push({ i, x1, x2, y: dy, text, hit: { x: x1, y: dy, w: tw + 20, h: 20 } });
    anchors[i] = {
      cx: x1 + 8 + tw / 2, top: dy, bottom: dy + 20,
      edit: { x: x1 + 4, y: dy + 1, w: Math.max(180, tw + 40), h: 24 }, align: 'left',
    };
  };

  for (const f of closed) {
    const s = steps[f.i];
    if (s.type !== 'block') {
      continue;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = f.i + 1; j < (f.end ?? steps.length); j++) {
      const t = steps[j];
      const ids = t.type === 'message' ? [t.from, t.to] : t.type === 'note' ? t.actors : [];
      for (const id of ids) {
        const x = xOf(id);
        if (x === null) {
          continue;
        }
        lo = Math.min(lo, x - LANE_W / 2 + 14);
        hi = Math.max(hi, x + LANE_W / 2 - 14);
        if (t.type === 'message' && t.from === t.to) {
          hi = Math.max(hi, x + 160);
        }
      }
    }
    if (lo === Infinity) {
      lo = allX1;
      hi = allX2;
    }
    const x1 = lo + f.depth * 8;
    const x2 = hi - f.depth * 8;
    const y1 = rows[f.i].y + 6;
    const y2 = f.end !== null ? rows[f.end].y + 8 : bottom - 6;
    const tabW = measure(s.keyword, 11, 700) + 16;
    const labelW = s.label ? measure(`[${s.label}]`, 11.5) : 0;
    frames.push({
      i: f.i, keyword: s.keyword, label: s.label, tabW,
      box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
      hit: { x: x1, y: y1, w: tabW + labelW + 16, h: 20 },
    });
    anchors[f.i] = {
      cx: x1 + (tabW + labelW) / 2 + 8, top: y1, bottom: y1 + 20,
      edit: { x: x1 + tabW + 4, y: y1 - 2, w: Math.max(160, labelW + 40), h: 24 }, align: 'left',
    };
    f.dividers.forEach((d) => divider(d, x1, x2));
  }
  strays.forEach((i) => divider(i, allX1, allX2));

  // Messages and notes.
  const messages: MessageGeom[] = [];
  const notes: NoteGeom[] = [];
  steps.forEach((s, i) => {
    const r = rows[i];
    if (s.type === 'message') {
      const x1 = xOf(s.from);
      const x2 = xOf(s.to);
      if (x1 === null || x2 === null) {
        return;
      }
      const tw = measure(s.text);
      if (s.from === s.to) {
        const y0 = r.y + 14;
        messages.push({
          i, x1, x2, y: y0, self: true, textX: x1 + 52, textY: y0 + 17,
          textHit: { x: x1 + 44, y: y0, w: tw + 16, h: 24 },
        });
        anchors[i] = {
          cx: x1 + 52 + Math.min(tw, 160) / 2, top: y0 - 4, bottom: y0 + 30,
          edit: { x: x1 + 46, y: y0 + 4, w: Math.max(160, tw + 40), h: 24 }, align: 'left',
        };
      } else {
        const ly = r.y + r.h - 14;
        const mid = (x1 + x2) / 2;
        const ew = Math.max(150, tw + 40);
        messages.push({
          i, x1, x2, y: ly, self: false, textX: mid, textY: ly - 8,
          textHit: { x: mid - tw / 2 - 6, y: ly - 22, w: tw + 12, h: 18 },
        });
        anchors[i] = {
          cx: mid, top: ly - 24, bottom: ly + 8,
          edit: { x: mid - ew / 2, y: ly - 26, w: ew, h: 24 }, align: 'center',
        };
      }
    } else if (s.type === 'note') {
      const xs = s.actors.map(xOf).filter((x): x is number => x !== null);
      if (!xs.length) {
        return;
      }
      const tw = measure(s.text);
      const top = r.y + 8;
      const h = r.h - 14;
      let x: number;
      let w: number;
      if (s.placement === 'over' && xs.length > 1) {
        x = Math.min(...xs) - 60;
        w = Math.max(...xs) - Math.min(...xs) + 120;
      } else {
        w = Math.max(120, tw + 28);
        x = s.placement === 'over' ? xs[0] - w / 2 : s.placement === 'left of' ? xs[0] - 16 - w : xs[0] + 16;
      }
      notes.push({ i, box: { x, y: top, w, h } });
      const ew = Math.max(w, tw + 40);
      anchors[i] = {
        cx: x + w / 2, top, bottom: top + h,
        edit: { x: x + w / 2 - ew / 2, y: top + h / 2 - 12, w: ew, h: 24 }, align: 'center',
      };
    }
  });

  // Activation bars: explicit activate/deactivate rows and `+`/`-` arrow suffixes.
  const bars: BarGeom[] = [];
  const stacks = new Map<string, number[]>();
  const start = (actor: string, at: number) => {
    stacks.set(actor, [...(stacks.get(actor) ?? []), at]);
  };
  const stop = (actor: string, at: number) => {
    const st = stacks.get(actor);
    const x = xOf(actor);
    if (!st?.length || x === null) {
      return;
    }
    const y0 = st.pop()!;
    bars.push({ actor, x: x - 5 + st.length * 4, y0, y1: Math.max(y0 + 8, at) });
  };
  steps.forEach((s, i) => {
    if (s.type === 'activate') {
      start(s.actor, rows[i].y);
    } else if (s.type === 'deactivate') {
      stop(s.actor, rows[i].y);
    } else if (s.type === 'message' && s.activate) {
      const at = rows[i].y + rows[i].h - 14;
      if (s.activate === 'start') {
        start(s.to, at);
      } else {
        stop(s.from, at);
      }
    }
  });
  for (const [actor, st] of stacks) {
    const x = xOf(actor);
    if (x === null) {
      continue;
    }
    st.forEach((y0, d) => bars.push({ actor, x: x - 5 + d * 4, y0, y1: Math.max(y0 + 8, bottom - 8) }));
  }

  return {
    rows, last, bottom,
    width: laneX(participants.length) + 64 + PAD,
    height: last + 44,
    messages, notes, frames, dividers, bars, anchors,
  };
}

/** Row boundaries a new or moved step can go to: `idx` is the step index it would take. */
export function boundaries(layout: SequenceLayout): { y: number; idx: number }[] {
  const out: { y: number; idx: number }[] = [];
  layout.rows.forEach((r, i) => {
    if (r.h > 0) {
      out.push({ y: r.y, idx: i });
    }
  });
  out.push({ y: layout.last, idx: layout.rows.length });
  return out;
}

export function nearestBoundary(layout: SequenceLayout, y: number): { y: number; idx: number; d: number } {
  let best = { y: layout.last, idx: layout.rows.length, d: Infinity };
  for (const b of boundaries(layout)) {
    const d = Math.abs(b.y - y);
    if (d < best.d) {
      best = { ...b, d };
    }
  }
  return best;
}

/** Index of the step whose row contains `y`, or null between/outside rows. */
export function rowAt(layout: SequenceLayout, y: number): number | null {
  const i = layout.rows.findIndex((r) => r.h > 0 && y >= r.y && y < r.y + r.h);
  return i < 0 ? null : i;
}

/** Index of the participant whose lifeline is near `x`, or null. */
export function laneAt(count: number, x: number): number | null {
  let best: { k: number; d: number } | null = null;
  for (let k = 0; k < count; k++) {
    const d = Math.abs(laneX(k) - x);
    if (d < LANE_W * 0.45 && (!best || d < best.d)) {
      best = { k, d };
    }
  }
  return best ? best.k : null;
}

/** Truncate with an ellipsis so `text` fits in `max` units. */
export function fitText(text: string, max: number, measure: Measure, size = 12, weight = 500): string {
  if (measure(text, size, weight) <= max) {
    return text;
  }
  let s = text;
  while (s.length > 1 && measure(`${s}…`, size, weight) > max) {
    s = s.slice(0, -1);
  }
  return `${s}…`;
}

export interface View { x: number; y: number; z: number }

/**
 * Initial view: full width when it fits (never below 65%, then scroll), or the
 * whole diagram when `whole` is asked for (the Fit button).
 */
export function fitView(stageW: number, stageH: number, layout: SequenceLayout, whole: boolean): View {
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const z = whole
    ? clamp(Math.min((stageW - 32) / layout.width, (stageH - 70) / layout.height), 0.3, 1)
    : clamp((stageW - 24) / layout.width, 0.65, 1);
  return {
    z,
    x: layout.width * z < stageW ? (stageW - layout.width * z) / 2 : 8,
    y: whole && layout.height * z < stageH ? Math.max(8, (stageH - 40 - layout.height * z) / 2) : 8,
  };
}
