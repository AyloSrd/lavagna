import React from 'react';
import { IconButton, Segmented, Separator, Swatches } from '../../ui/controls';
import { COLORS, ColorKey, Fill, FONT_SIZES, MarkStyle, MarkType, styleControls, WIDTHS } from './model';

// Style controls for the selection, or for the next mark while a drawing tool
// is armed. Only controls that apply to what is selected are shown.

const svg = (body: React.ReactNode) => (
  <svg className="lv-svg" viewBox="0 0 24 24" aria-hidden="true">{body}</svg>
);
const lineIcon = (w: number) => svg(<path d="M5 12h14" strokeWidth={w} />);

const COLOR_OPTIONS = (Object.keys(COLORS) as ColorKey[]).map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1), css: COLORS[c] }));

export type StylePatch = { [K in keyof MarkStyle]?: MarkStyle[K] };

export interface StyleBarPlacement {
  docked: boolean;
  /** Screen position of the selection's top-centre (or bottom-centre when `below`). */
  left: number;
  top: number;
  below: boolean;
}

export function StyleBar({
  style,
  types,
  selection,
  placement,
  barRef,
  onChange,
  onDuplicate,
  onDelete,
  onReorder,
}: {
  style: MarkStyle;
  types: MarkType[];
  /** False while a drawing tool is armed with nothing selected. */
  selection: boolean;
  placement: StyleBarPlacement;
  barRef: React.Ref<HTMLDivElement>;
  onChange(patch: StylePatch): void;
  onDuplicate(): void;
  onDelete(): void;
  onReorder(to: 'front' | 'back'): void;
}) {
  const show = styleControls(types);
  // Docked placement is CSS (it moves in the narrow layout); floating follows the selection.
  const position: React.CSSProperties | undefined = placement.docked
    ? undefined
    : {
        top: placement.top,
        left: placement.left,
        transform: placement.below ? 'translate(-50%, 14px)' : 'translate(-50%, calc(-100% - 12px))',
      };
  return (
    <div
      ref={barRef}
      className={placement.docked ? 'lv-float lv-ctx lv-canvas-docked' : 'lv-float lv-ctx'}
      style={position}
      role="toolbar"
      aria-label="Style"
    >
      {show.color && <Swatches colors={COLOR_OPTIONS} value={style.color} onChange={(color) => onChange({ color })} />}
      {show.width && (
        <>
          {show.color && <Separator />}
          <Segmented
            label="Stroke width"
            value={style.width}
            onChange={(width) => onChange({ width })}
            options={WIDTHS.map((w, i) => ({ value: w, label: `Width ${'SML'[i]}`, content: lineIcon([1.4, 2.6, 4.4][i]) }))}
          />
        </>
      )}
      {show.fill && (
        <>
          <Separator />
          <Segmented<Fill>
            label="Fill"
            value={style.fill}
            onChange={(fill) => onChange({ fill })}
            options={[
              { value: 'none', label: 'No fill', content: svg(<rect x="5" y="6" width="14" height="12" rx="2" />) },
              { value: 'tint', label: 'Light fill', content: svg(<rect x="5" y="6" width="14" height="12" rx="2" fill="currentColor" fillOpacity={0.3} />) },
              { value: 'solid', label: 'Solid fill', content: svg(<rect x="5" y="6" width="14" height="12" rx="2" fill="currentColor" />) },
            ]}
          />
        </>
      )}
      {show.lineStyle && (
        <>
          <Separator />
          <Segmented
            label="Line style"
            value={style.dashed ? 'dashed' : 'solid'}
            onChange={(v) => onChange({ dashed: v === 'dashed' })}
            options={[
              { value: 'solid', label: 'Solid line', content: lineIcon(2) },
              { value: 'dashed', label: 'Dashed line', content: svg(<path d="M4 12h4M10.5 12h3M16 12h4" strokeWidth={2} />) },
            ]}
          />
          <Segmented
            label="Stroke look"
            value={style.sketch ? 'sketch' : 'clean'}
            onChange={(v) => onChange({ sketch: v === 'sketch' })}
            options={[
              { value: 'clean', label: 'Clean strokes', content: svg(<path d="M4 15c3-6 6-6 8 0s5 6 8 0" />) },
              {
                value: 'sketch',
                label: 'Hand-drawn strokes',
                content: svg(<><path d="M4 15c2-6 5-7 8-1s6 5 8-1" /><path d="M5 17c3-6 5-5 7-1" strokeWidth={1} /></>),
              },
            ]}
          />
        </>
      )}
      {show.fontSize && (
        <>
          <Separator />
          <Segmented
            label="Text size"
            value={style.fontSize}
            onChange={(fontSize) => onChange({ fontSize })}
            options={FONT_SIZES.map((s, i) => ({ value: s, label: ['Small text', 'Medium text', 'Large text'][i], content: 'SML'[i] }))}
          />
        </>
      )}
      {selection && (
        <>
          {(show.color || show.width || show.fill || show.lineStyle || show.fontSize) && <Separator />}
          <IconButton icon="front" label="Bring to front" shortcut="]" onPress={() => onReorder('front')} />
          <IconButton icon="back" label="Send to back" shortcut="[" onPress={() => onReorder('back')} />
          <IconButton icon="duplicate" label="Duplicate" shortcut="⌘D" onPress={onDuplicate} />
          <IconButton icon="trash" label="Delete" shortcut="⌫" danger onPress={onDelete} />
        </>
      )}
    </div>
  );
}
