import React from 'react';
import { MermaidShape, SHAPE_LABELS } from '../../format/mermaid';
import { SHAPE_ORDER, ShapeThumb } from './shapes';

// The 14 mermaid shapes as thumbnails: click to add one near the middle of
// the view, or drag one onto the canvas to drop it exactly there.

/** dataTransfer type carrying the dragged shape. */
export const SHAPE_DRAG_TYPE = 'application/x-lavagna-shape';

export function Palette({ onAdd }: { onAdd(shape: MermaidShape): void }) {
  return (
    <div className="lv-float lv-flow-palette" role="toolbar" aria-label="Shapes">
      <span className="lv-flow-palette-title">Shapes</span>
      {SHAPE_ORDER.map((shape) => (
        <button
          key={shape}
          type="button"
          className="lv-flow-pal-item"
          draggable
          title={`${SHAPE_LABELS[shape]} — click to add, or drag onto the canvas`}
          aria-label={`Add ${SHAPE_LABELS[shape]}`}
          onClick={() => onAdd(shape)}
          onDragStart={(e) => {
            e.dataTransfer.setData(SHAPE_DRAG_TYPE, shape);
            e.dataTransfer.effectAllowed = 'copy';
          }}
        >
          <ShapeThumb shape={shape} />
        </button>
      ))}
    </div>
  );
}
