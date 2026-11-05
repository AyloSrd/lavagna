import React from 'react';
import { IconButton, Separator } from '../../ui/controls';
import type { IconName } from '../../ui/icons';
import type { Tool } from './model';

// The vertical tool rail on the left of the canvas (a bottom row when narrow).

export const TOOLS: { tool: Tool; label: string; key: string; icon: IconName }[] = [
  { tool: 'select', label: 'Select', key: 'V', icon: 'select' },
  { tool: 'hand', label: 'Pan', key: 'H', icon: 'hand' },
  { tool: 'pen', label: 'Pen', key: 'P', icon: 'pen' },
  { tool: 'marker', label: 'Highlighter', key: 'M', icon: 'marker' },
  { tool: 'rect', label: 'Rectangle', key: 'R', icon: 'rect' },
  { tool: 'ellipse', label: 'Ellipse', key: 'O', icon: 'ellipse' },
  { tool: 'arrow', label: 'Arrow', key: 'A', icon: 'arrow' },
  { tool: 'line', label: 'Line', key: 'L', icon: 'line' },
  { tool: 'text', label: 'Text', key: 'T', icon: 'text' },
  { tool: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser' },
];

/** Groups get a separator before them. */
const GROUP_STARTS = new Set<Tool>(['pen', 'rect', 'eraser']);

export function ToolRail({
  tool,
  onTool,
  onInsertImage,
  inserting,
  onReplaceImage,
  replaceOpen,
}: {
  tool: Tool;
  onTool(t: Tool): void;
  /** Place a picture on top of the canvas; not a tool, it acts at once. */
  onInsertImage(): void;
  inserting: boolean;
  onReplaceImage(): void;
  replaceOpen: boolean;
}) {
  return (
    <div className="lv-float lv-canvas-rail" role="toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <React.Fragment key={t.tool}>
          {GROUP_STARTS.has(t.tool) && <Separator horizontal />}
          <IconButton
            icon={t.icon}
            label={t.label}
            shortcut={t.key}
            keyHint={t.key}
            pressed={tool === t.tool}
            onPress={() => onTool(t.tool)}
          />
        </React.Fragment>
      ))}
      <Separator horizontal />
      <IconButton icon="imageAdd" label="Insert an image" shortcut="I" keyHint="I" disabled={inserting} onPress={onInsertImage} />
      <IconButton icon="image" label="Replace the image" pressed={replaceOpen} onPress={onReplaceImage} />
    </div>
  );
}
