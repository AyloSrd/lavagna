import { linePoints } from './geometry';
import { COLORS, isLine, isShape, isStroke, Lookup, Mark, strokeWidth, TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from './model';
import {
  arrowHead,
  Path,
  polygonPaths,
  seededRandom,
  segmentPaths,
  SKETCH_ROUGHNESS,
  sketchEllipsePaths,
  smoothPath,
} from './sketch';

// Paints one mark on a 2D context. The same function draws the live editor
// (inside a Konva Shape, whose context already carries the zoom) and the
// flattened PNG on Save, so what you see is exactly what gets saved.

export interface DrawOptions {
  /** Faded while the eraser is over it. */
  fading?: boolean;
  /** Text/label currently open in the text overlay — the overlay shows it instead. */
  hideText?: boolean;
}

function trace(ctx: CanvasRenderingContext2D, path: Path): void {
  ctx.beginPath();
  for (const c of path) {
    if (c.op === 'move') {
      ctx.moveTo(c.p.x, c.p.y);
    } else if (c.op === 'line') {
      ctx.lineTo(c.p.x, c.p.y);
    } else {
      ctx.quadraticCurveTo(c.c.x, c.c.y, c.p.x, c.p.y);
    }
  }
}

function strokePaths(ctx: CanvasRenderingContext2D, paths: Path[]): void {
  for (const p of paths) {
    trace(ctx, p);
    ctx.stroke();
  }
}

/** White and orange are light: labels on a solid fill of them read dark. */
export const labelInk = (m: Mark): string =>
  m.fill === 'solid' ? (m.color === 'white' || m.color === 'orange' ? COLORS.black : COLORS.white) : COLORS[m.color];

function drawLines(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fontSize: number, align: CanvasTextAlign): void {
  ctx.setLineDash([]);
  ctx.font = `${fontSize}px ${TEXT_FONT_FAMILY}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = align;
  text.split('\n').forEach((line, i) => ctx.fillText(line, x, y + i * fontSize * TEXT_LINE_HEIGHT));
}

export function drawMark(ctx: CanvasRenderingContext2D, m: Mark, lookup: Lookup, opts: DrawOptions = {}): void {
  const rand = seededRandom(m.seed);
  const rough = m.sketch ? SKETCH_ROUGHNESS : 0;
  const passes = m.dashed ? 1 : 2;
  const color = COLORS[m.color];
  const sw = strokeWidth(m);
  ctx.save();
  ctx.globalAlpha = opts.fading ? 0.25 : 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(m.dashed ? [sw * 3 + 4, sw * 2 + 6] : []);

  if (isShape(m)) {
    const { x, y, w, h } = m;
    const radius = Math.min(6, w / 4, h / 4);
    const outline = () => {
      ctx.beginPath();
      if (m.type === 'rect') {
        ctx.roundRect(x, y, w, h, radius);
      } else {
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 0.5), Math.max(h / 2, 0.5), 0, 0, Math.PI * 2);
      }
    };
    if (m.fill !== 'none') {
      ctx.save();
      ctx.globalAlpha *= m.fill === 'tint' ? 0.18 : 1;
      outline();
      ctx.fill();
      ctx.restore();
    }
    if (!rough) {
      outline();
      ctx.stroke();
    } else if (m.type === 'rect') {
      strokePaths(ctx, polygonPaths([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], rough, rand, passes));
    } else {
      strokePaths(ctx, sketchEllipsePaths({ x: x + w / 2, y: y + h / 2 }, Math.max(w / 2, 0.5), Math.max(h / 2, 0.5), rough, rand, passes));
    }
    if (m.label && !opts.hideText) {
      ctx.fillStyle = labelInk(m);
      const textH = m.label.split('\n').length * m.fontSize * TEXT_LINE_HEIGHT;
      drawLines(ctx, m.label, x + w / 2, y + h / 2 - textH / 2, m.fontSize, 'center');
    }
  } else if (isLine(m)) {
    const [a, b] = linePoints(m, lookup);
    strokePaths(ctx, segmentPaths(a, b, rough, rand, passes));
    if (m.type === 'arrow') {
      const [l, r] = arrowHead(a, b, sw);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(r.x, r.y);
      if (rough) {
        ctx.stroke();
      } else {
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  } else if (isStroke(m)) {
    ctx.setLineDash([]);
    if (m.type === 'marker') {
      // A highlighter tints what is underneath instead of covering it.
      ctx.globalAlpha *= 0.35;
      ctx.lineCap = 'butt';
      ctx.globalCompositeOperation = 'multiply';
    }
    trace(ctx, smoothPath(m.points));
    ctx.stroke();
  } else if (!opts.hideText) {
    drawLines(ctx, m.text, m.x, m.y, m.fontSize, 'left');
  }
  ctx.restore();
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Size of a text mark's box at `fontSize`; never smaller than a caret. */
export function measureText(text: string, fontSize: number): { w: number; h: number } {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const lines = text.split('\n');
  let w = 4;
  if (measureCtx) {
    measureCtx.font = `${fontSize}px ${TEXT_FONT_FAMILY}`;
    for (const l of lines) {
      w = Math.max(w, measureCtx.measureText(l).width);
    }
  }
  return { w, h: lines.length * fontSize * TEXT_LINE_HEIGHT };
}

/**
 * Image + marks at the image's natural size (one image pixel = one output
 * pixel, so repeated saves never grow the PNG). Returns the PNG as base64, or
 * null when the canvas can't be exported (tainted or too large).
 */
export function flatten(image: HTMLImageElement, marks: readonly Mark[], lookup: Lookup): string | null {
  const out = document.createElement('canvas');
  out.width = image.naturalWidth;
  out.height = image.naturalHeight;
  const ctx = out.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.drawImage(image, 0, 0);
  for (const m of marks) {
    drawMark(ctx, m, lookup);
  }
  try {
    const url = out.toDataURL('image/png');
    const prefix = 'data:image/png;base64,';
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  } catch {
    return null;
  }
}
