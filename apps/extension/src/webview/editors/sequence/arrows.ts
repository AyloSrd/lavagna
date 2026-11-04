import type { ArrowKind } from '../../format/sequence';
import { ARROW_TOKENS } from '../../format/sequence';

// How each of mermaid's eight message arrows is drawn: dashed or solid shaft,
// and what sits at the tip. Order is the order the picker shows them in.

export type ArrowEnd = 'arrow' | 'open' | 'cross' | 'none';

export interface ArrowStyle {
  dotted: boolean;
  end: ArrowEnd;
  label: string;
}

export const ARROW_STYLES: Record<ArrowKind, ArrowStyle> = {
  solidArrow: { dotted: false, end: 'arrow', label: 'Solid arrow' },
  dottedArrow: { dotted: true, end: 'arrow', label: 'Dotted arrow (reply)' },
  solidOpen: { dotted: false, end: 'open', label: 'Solid async' },
  dottedOpen: { dotted: true, end: 'open', label: 'Dotted async' },
  solidCross: { dotted: false, end: 'cross', label: 'Solid cross' },
  dottedCross: { dotted: true, end: 'cross', label: 'Dotted cross' },
  solid: { dotted: false, end: 'none', label: 'Solid line' },
  dotted: { dotted: true, end: 'none', label: 'Dotted line' },
};

export const ARROW_ORDER = Object.keys(ARROW_STYLES) as ArrowKind[];

/** Tooltip text: the name plus the mermaid operator it writes. */
export const arrowTitle = (kind: ArrowKind) => `${ARROW_STYLES[kind].label}  ${ARROW_TOKENS[kind]}`;
