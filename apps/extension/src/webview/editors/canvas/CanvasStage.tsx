import React, { useMemo } from 'react';
import { Circle, Ellipse, Group, Image as KonvaImage, Layer, Rect, Shape, Stage } from 'react-konva';
import { drawMark } from './draw';
import { bounds, handlePoints, linePoints, unionBounds } from './geometry';
import { Box, hasBox, isLine, Lookup, Mark } from './model';
import type { View } from './viewport';

// Konva scene: the image as a locked background, the marks clipped to it,
// and the selection chrome on top. Pure rendering — pointer handling lives in
// CanvasEditor, which owns the state this draws.

/** Selection chrome size in screen pixels. */
const HANDLE = 8;
const PAD = 6;

export function CanvasStage({
  width,
  height,
  view,
  image,
  marks,
  lookup,
  selected,
  hideTextOf,
  fading,
  marquee,
  attachTarget,
  showHandles,
}: {
  width: number;
  height: number;
  view: View;
  image: HTMLImageElement;
  marks: readonly Mark[];
  lookup: Lookup;
  selected: readonly Mark[];
  /** Mark whose text is open in the overlay. */
  hideTextOf: string | null;
  fading: ReadonlySet<string>;
  marquee: Box | null;
  /** Shape an arrow end will attach to on release. */
  attachTarget: Mark | null;
  /** False while dragging or typing, so the chrome doesn't flicker. */
  showHandles: boolean;
}) {
  // Selection chrome follows the VS Code theme; it is never part of the PNG.
  const accent = useMemo(
    () => getComputedStyle(document.body).getPropertyValue('--vscode-focusBorder').trim() || '#007acc',
    [],
  );
  const z = view.z;
  const s = 1 / z;
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;

  return (
    <Stage width={width} height={height} x={view.x} y={view.y} scaleX={z} scaleY={z} listening={false}>
      <Layer listening={false}>
        <Rect x={0} y={0} width={iw} height={ih} fill="#ffffff" shadowColor="black" shadowOpacity={0.35} shadowBlur={24 * s} shadowOffsetY={4 * s} />
        <KonvaImage image={image} x={0} y={0} width={iw} height={ih} />
        {/* Marks outside the image would not be saved, so they are not shown either. */}
        <Group clipX={0} clipY={0} clipWidth={iw} clipHeight={ih}>
          {marks.map((m) => (
            <Shape
              key={m.id}
              sceneFunc={(ctx) => drawMark(ctx._context, m, lookup, { fading: fading.has(m.id), hideText: m.id === hideTextOf })}
            />
          ))}
        </Group>
      </Layer>
      <Layer listening={false}>
        {attachTarget && hasBox(attachTarget) && (
          attachTarget.type === 'ellipse' ? (
            <Ellipse
              x={attachTarget.x + attachTarget.w / 2}
              y={attachTarget.y + attachTarget.h / 2}
              radiusX={attachTarget.w / 2 + 5 * s}
              radiusY={attachTarget.h / 2 + 5 * s}
              stroke={accent}
              strokeWidth={5 * s}
              opacity={0.45}
            />
          ) : (
            <Rect
              x={attachTarget.x - 5 * s}
              y={attachTarget.y - 5 * s}
              width={attachTarget.w + 10 * s}
              height={attachTarget.h + 10 * s}
              cornerRadius={4 * s}
              stroke={accent}
              strokeWidth={5 * s}
              opacity={0.45}
            />
          )
        )}
        {showHandles && selected.length > 0 && <SelectionChrome selected={selected} lookup={lookup} accent={accent} z={z} />}
        {marquee && (
          <Rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} stroke={accent} strokeWidth={s} fill={accent} opacity={0.6} fillEnabled={false} />
        )}
        {marquee && <Rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill={accent} opacity={0.08} />}
      </Layer>
    </Stage>
  );
}

function SelectionChrome({ selected, lookup, accent, z }: { selected: readonly Mark[]; lookup: Lookup; accent: string; z: number }) {
  const s = 1 / z;
  const only = selected.length === 1 ? selected[0] : null;
  if (only && isLine(only)) {
    return (
      <>
        {linePoints(only, lookup).map((p, i) => (
          <Circle key={i} x={p.x} y={p.y} radius={5 * s} fill="#ffffff" stroke={accent} strokeWidth={1.5 * s} />
        ))}
      </>
    );
  }
  const box = unionBounds(selected, lookup);
  const pad = PAD * s;
  return (
    <>
      {selected.length > 1 &&
        selected.map((m) => {
          const b = bounds(m, lookup);
          return (
            <Rect key={m.id} x={b.x - 3 * s} y={b.y - 3 * s} width={b.w + 6 * s} height={b.h + 6 * s} stroke={accent} strokeWidth={s} dash={[4 * s, 3 * s]} opacity={0.7} />
          );
        })}
      <Rect x={box.x - pad} y={box.y - pad} width={box.w + pad * 2} height={box.h + pad * 2} stroke={accent} strokeWidth={s} />
      {Object.entries(handlePoints(box, pad)).map(([k, p]) => (
        <Rect
          key={k}
          x={p.x - (HANDLE * s) / 2}
          y={p.y - (HANDLE * s) / 2}
          width={HANDLE * s}
          height={HANDLE * s}
          cornerRadius={2 * s}
          fill="#ffffff"
          stroke={accent}
          strokeWidth={s}
        />
      ))}
    </>
  );
}

/** Screen-pixel tolerance for grabbing handles, converted by the editor. */
export const HANDLE_GRAB = 7;
export const SELECTION_PAD = PAD;
