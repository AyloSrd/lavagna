// Marks drawn on top of a canvas image. They live only in the editor until
// Save flattens them into a new PNG, so this is plain data with no React,
// Konva or DOM in it — the editor renders it, the tests exercise it.

export interface Point { x: number; y: number; }
export interface Box { x: number; y: number; w: number; h: number; }

/**
 * Mark colours are fixed, not theme colours: they end up as pixels in the
 * PNG, which has to look the same in every theme and outside VS Code.
 */
export const COLORS = {
  red: '#e03131',
  orange: '#f59f00',
  green: '#2f9e44',
  blue: '#1971c2',
  black: '#1e1e1e',
  white: '#ffffff',
} as const;
export type ColorKey = keyof typeof COLORS;

export type Fill = 'none' | 'tint' | 'solid';

/** Text metrics shared by the renderer and the text overlay — keep them identical. */
export const TEXT_FONT_FAMILY = 'Arial, sans-serif';
export const TEXT_LINE_HEIGHT = 1.2;

/** Stroke widths for S / M / L. The highlighter draws 4× wider. */
export const WIDTHS = [2, 4, 8] as const;
/** Text sizes for S / M / L, for text marks and shape labels. */
export const FONT_SIZES = [16, 24, 36] as const;

export interface MarkStyle {
  color: ColorKey;
  width: number;
  fill: Fill;
  dashed: boolean;
  /** Hand-drawn strokes instead of clean ones. */
  sketch: boolean;
  fontSize: number;
}

export const DEFAULT_STYLE: MarkStyle = {
  color: 'red', width: 4, fill: 'none', dashed: false, sketch: false, fontSize: 24,
};

interface MarkBase extends MarkStyle {
  id: string;
  /** Fixes the hand-drawn wobble, so a mark looks the same on every redraw. */
  seed: number;
}

export interface ShapeMark extends MarkBase, Box { type: 'rect' | 'ellipse'; label: string; }
export interface TextMark extends MarkBase, Box { type: 'text'; text: string; }
export interface LineMark extends MarkBase {
  type: 'line' | 'arrow';
  points: [Point, Point];
  /** Ids of the marks an arrow end is attached to; that end follows the mark. */
  start?: string;
  end?: string;
}
export interface StrokeMark extends MarkBase { type: 'pen' | 'marker'; points: Point[]; }

export type Mark = ShapeMark | TextMark | LineMark | StrokeMark;
export type MarkType = Mark['type'];

export type Tool = 'select' | 'hand' | 'eraser' | MarkType;

export const isShape = (m: Mark): m is ShapeMark => m.type === 'rect' || m.type === 'ellipse';
export const isLine = (m: Mark): m is LineMark => m.type === 'line' || m.type === 'arrow';
export const isStroke = (m: Mark): m is StrokeMark => m.type === 'pen' || m.type === 'marker';
export const hasBox = (m: Mark): m is ShapeMark | TextMark => isShape(m) || m.type === 'text';
/** What an arrow end may attach to. */
export const isAttachable = hasBox;

/** Width the stroke is actually drawn at. */
export const strokeWidth = (m: Mark): number => (m.type === 'marker' ? m.width * 4 : m.width);

export type Lookup = (id: string) => Mark | undefined;
export const lookupIn = (marks: readonly Mark[]): Lookup => {
  const map = new Map(marks.map((m) => [m.id, m]));
  return (id) => map.get(id);
};

let counter = 0;
export function newMarkId(): string {
  counter += 1;
  return `m${counter}-${Math.random().toString(36).slice(2, 6)}`;
}
export const newSeed = (): number => Math.floor(Math.random() * 2 ** 31);

/** Which style controls apply to a selection or an armed tool. */
export function styleControls(types: readonly MarkType[]) {
  const any = (f: (t: MarkType) => boolean) => types.some(f);
  return {
    width: any((t) => t !== 'text'),
    fill: any((t) => t === 'rect' || t === 'ellipse'),
    lineStyle: any((t) => t === 'rect' || t === 'ellipse' || t === 'line' || t === 'arrow'),
    fontSize: any((t) => t === 'text' || t === 'rect' || t === 'ellipse'),
  };
}
