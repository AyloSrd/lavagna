import type { FlowDirection } from '../../format/mermaid';
import type { Side } from './model';

// Which sides an edge leaves and enters by. Edges are drawn node-to-node
// rather than handle-to-handle, so they always take the sides facing each
// other: forward edges run along the diagram direction, edges going back
// against it loop round the outside, and edges within a rank go sideways.

export interface Rect { x: number; y: number; w: number; h: number; }
export interface Port { x: number; y: number; side: Side; }

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function port(r: Rect, side: Side): Port {
  switch (side) {
    case 'top': return { x: r.x + r.w / 2, y: r.y, side };
    case 'bottom': return { x: r.x + r.w / 2, y: r.y + r.h, side };
    case 'left': return { x: r.x, y: r.y + r.h / 2, side };
    case 'right': return { x: r.x + r.w, y: r.y + r.h / 2, side };
  }
}

export function route(src: Rect, tgt: Rect, direction: FlowDirection): { from: Port; to: Port } {
  const horizontal = direction === 'LR' || direction === 'RL';
  const sign = direction === 'BT' || direction === 'RL' ? -1 : 1;
  const dx = tgt.x + tgt.w / 2 - (src.x + src.w / 2);
  const dy = tgt.y + tgt.h / 2 - (src.y + src.h / 2);
  // Progress along the direction, and how far apart the two boxes' edges are.
  const along = (horizontal ? dx : dy) * sign;
  const reach = horizontal ? (src.w + tgt.w) / 2 : (src.h + tgt.h) / 2;
  const ahead: Side = horizontal ? (sign > 0 ? 'right' : 'left') : (sign > 0 ? 'bottom' : 'top');

  if (along > reach) {
    return { from: port(src, ahead), to: port(tgt, OPPOSITE[ahead]) };
  }
  if (along < -reach) {
    // Back edge: leave and enter on the same outer side so it loops round.
    const outer: Side = horizontal ? 'bottom' : 'right';
    return { from: port(src, outer), to: port(tgt, outer) };
  }
  const across = horizontal ? dy : dx;
  const side: Side = horizontal ? (across >= 0 ? 'bottom' : 'top') : (across >= 0 ? 'right' : 'left');
  return { from: port(src, side), to: port(tgt, OPPOSITE[side]) };
}
