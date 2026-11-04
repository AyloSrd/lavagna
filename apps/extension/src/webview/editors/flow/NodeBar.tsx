import React, { useContext, useState } from 'react';
import { MermaidShape, SHAPE_LABELS } from '../../format/mermaid';
import { IconButton, Separator } from '../../ui/controls';
import { FlowActionsContext } from './actions';
import { SHAPE_ORDER, ShapeThumb } from './shapes';

// Floating bar above the single selected node: shape, rename, next step,
// duplicate, delete.

export function NodeBar({ id, shape }: { id: string; shape: MermaidShape }) {
  const a = useContext(FlowActionsContext);
  const [picking, setPicking] = useState(false);

  return (
    <div className="lv-float lv-flow-bar nodrag nopan">
      <button
        type="button"
        className="lv-btn lv-btn--ghost lv-flow-shape-btn"
        aria-haspopup="menu"
        aria-expanded={picking}
        title="Change shape"
        onMouseDown={(e) => { e.preventDefault(); setPicking((p) => !p); }}
      >
        <ShapeThumb shape={shape} />
        {SHAPE_LABELS[shape]}
        <svg className="lv-svg" viewBox="0 0 24 24" width={12} height={12} aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
      </button>
      <Separator />
      <IconButton icon="rename" label="Rename" shortcut="Enter" onPress={() => a.startEdit(id)} />
      <IconButton icon="plus" label="Add next step" shortcut="Tab" onPress={() => a.addNext(id)} />
      <IconButton icon="duplicate" label="Duplicate" shortcut="⌘D" onPress={() => a.duplicate(id)} />
      <IconButton icon="trash" label="Delete" shortcut="⌫" danger onPress={() => a.removeNode(id)} />
      {picking && (
        <div className="lv-float lv-pop lv-flow-shape-grid" role="menu" aria-label="Change shape">
          {SHAPE_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              role="menuitemradio"
              aria-checked={s === shape}
              className="lv-flow-pal-item"
              title={SHAPE_LABELS[s]}
              aria-label={SHAPE_LABELS[s]}
              onMouseDown={(e) => {
                e.preventDefault();
                setPicking(false);
                a.setShape(id, s);
              }}
            >
              <ShapeThumb shape={s} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
