import React from 'react';
import type { MermaidShape } from '../../format/mermaid';

// Each mermaid shape as SVG in a 0 0 100 100 viewBox, stretched over the node
// box (`preserveAspectRatio: none` + non-scaling-stroke), so the geometry
// follows the label's width while the stroke keeps its weight. Colours come
// from CSS (`.lv-flow-shape`), so selection and theme apply to every shape.
// Parts marked `data-line` are inner strokes with no fill.

interface ShapeGeometry {
  render: React.ReactNode;
  /** Extra horizontal room so text clears slanted/pointed edges. */
  padX: number;
  minHeight: number;
}

const ns = { vectorEffect: 'non-scaling-stroke' } as const;
const poly = (points: string) => <polygon points={points} {...ns} />;

export const SHAPE_GEOMETRY: Record<MermaidShape, ShapeGeometry> = {
  square: { render: <rect x={0} y={0} width={100} height={100} rx={3} {...ns} />, padX: 14, minHeight: 40 },
  round: { render: <rect x={0} y={0} width={100} height={100} rx={14} {...ns} />, padX: 16, minHeight: 40 },
  stadium: { render: <rect x={0} y={0} width={100} height={100} rx={50} {...ns} />, padX: 22, minHeight: 40 },
  subroutine: {
    render: (
      <>
        <rect x={0} y={0} width={100} height={100} {...ns} />
        <path data-line d="M8 0 V100 M92 0 V100" {...ns} />
      </>
    ),
    padX: 22, minHeight: 40,
  },
  cylinder: {
    render: (
      <>
        <path d="M0 12 A50 12 0 0 1 100 12 V88 A50 12 0 0 1 0 88 Z" {...ns} />
        <path data-line d="M0 12 A50 12 0 0 0 100 12" {...ns} />
      </>
    ),
    padX: 16, minHeight: 52,
  },
  // Circle/double-circle stretch with the label, so wide text reads as an oval.
  circle: { render: <ellipse cx={50} cy={50} rx={49.5} ry={49.5} {...ns} />, padX: 24, minHeight: 56 },
  doublecircle: {
    render: (
      <>
        <ellipse cx={50} cy={50} rx={49.5} ry={49.5} {...ns} />
        <ellipse data-line cx={50} cy={50} rx={42} ry={42} {...ns} />
      </>
    ),
    padX: 28, minHeight: 60,
  },
  odd: { render: poly('0,0 90,0 100,50 90,100 0,100'), padX: 18, minHeight: 40 },
  diamond: { render: poly('50,0 100,50 50,100 0,50'), padX: 30, minHeight: 64 },
  hexagon: { render: poly('20,0 80,0 100,50 80,100 20,100 0,50'), padX: 26, minHeight: 48 },
  lean_right: { render: poly('18,0 100,0 82,100 0,100'), padX: 22, minHeight: 40 },
  lean_left: { render: poly('0,0 82,0 100,100 18,100'), padX: 22, minHeight: 40 },
  trapezoid: { render: poly('18,0 82,0 100,100 0,100'), padX: 24, minHeight: 42 },
  inv_trapezoid: { render: poly('0,0 100,0 82,100 18,100'), padX: 24, minHeight: 42 },
};

/** Palette order: the everyday shapes first. */
export const SHAPE_ORDER: MermaidShape[] = [
  'square', 'round', 'stadium', 'subroutine', 'cylinder', 'circle', 'doublecircle',
  'diamond', 'hexagon', 'odd', 'lean_right', 'lean_left', 'trapezoid', 'inv_trapezoid',
];

/** The outline drawn behind a node's label. */
export function ShapeOutline({ shape }: { shape: MermaidShape }) {
  const geo = SHAPE_GEOMETRY[shape] ?? SHAPE_GEOMETRY.square;
  return (
    <svg className="lv-flow-shape" width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {geo.render}
    </svg>
  );
}

/** A small, fixed-aspect drawing of a shape for the palette and pickers. */
export function ShapeThumb({ shape }: { shape: MermaidShape }) {
  const geo = SHAPE_GEOMETRY[shape] ?? SHAPE_GEOMETRY.square;
  const round = shape === 'circle' || shape === 'doublecircle' || shape === 'diamond';
  return (
    <svg
      className="lv-flow-thumb"
      width={round ? 16 : 22}
      height={round ? 16 : 14}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {geo.render}
    </svg>
  );
}
