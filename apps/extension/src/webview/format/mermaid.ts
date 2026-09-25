// The flow block's data model and its conversion to/from a Mermaid `flowchart`.
// The mermaid text in the fence is the source of truth; the graph is the
// editing model. The reader is a real tokenizer for the flowchart line grammar
// — chains (`a --> b --> c`), `&` fan-outs, every classic node shape, dotted/
// thick/open edges, both label syntaxes — so existing and hand-written
// diagrams open in the editor instead of falling back to read-only.
//
// Everything parsed is preserved on write-back: each node keeps its ORIGINAL
// shape and each edge its stroke/arrow. INVARIANT: whatever toMermaid emits
// must re-parse identically (labels are always written quoted; quoted labels
// accept every character except `"`, which is escaped as &quot;).
//
// What still (deliberately) returns null → read-only fallback: subgraphs,
// classDef/class/style/linkStyle, click handlers, `:::` class annotations,
// bidirectional/cross/circle arrows, and non-flowchart diagram types. Those
// can't round-trip through this model without silent loss.

export type MermaidShape =
  | 'square' | 'round' | 'stadium' | 'subroutine' | 'cylinder'
  | 'circle' | 'doublecircle' | 'odd' | 'diamond' | 'hexagon'
  | 'lean_right' | 'lean_left' | 'trapezoid' | 'inv_trapezoid';

export type EdgeStroke = 'normal' | 'dotted' | 'thick';
export type EdgeArrow = 'point' | 'open';

export type FlowDirection = 'TD' | 'TB' | 'LR' | 'RL' | 'BT';

export interface FlowNode { id: string; shape: MermaidShape; label: string; x: number; y: number; }
export interface FlowEdge {
  id: string; source: string; target: string; label?: string;
  stroke: EdgeStroke; arrow: EdgeArrow;
}
export interface FlowData { direction: FlowDirection; nodes: FlowNode[]; edges: FlowEdge[]; }

export const EMPTY_FLOW: FlowData = { direction: 'TD', nodes: [], edges: [] };

export const DIRECTION_LABELS: Record<FlowDirection, string> = {
  TD: '↓ Top-down',
  TB: '↓ Top-bottom',
  LR: '→ Left-right',
  RL: '← Right-left',
  BT: '↑ Bottom-top',
};

/** The six stroke/arrow combinations, keyed by the mermaid operator itself. */
export const EDGE_STYLES: { op: string; label: string; stroke: EdgeStroke; arrow: EdgeArrow }[] = [
  { op: '-->', label: '──▶  arrow', stroke: 'normal', arrow: 'point' },
  { op: '---', label: '───   line', stroke: 'normal', arrow: 'open' },
  { op: '-.->', label: '─ ─▶  dotted arrow', stroke: 'dotted', arrow: 'point' },
  { op: '-.-', label: '─ ─   dotted line', stroke: 'dotted', arrow: 'open' },
  { op: '==>', label: '━━▶  thick arrow', stroke: 'thick', arrow: 'point' },
  { op: '===', label: '━━━   thick line', stroke: 'thick', arrow: 'open' },
];

export const SHAPE_LABELS: Record<MermaidShape, string> = {
  square: 'Rectangle',
  round: 'Rounded',
  stadium: 'Stadium',
  subroutine: 'Subroutine',
  cylinder: 'Database',
  circle: 'Circle',
  doublecircle: 'Double circle',
  odd: 'Flag',
  diamond: 'Diamond',
  hexagon: 'Hexagon',
  lean_right: 'Parallelogram',
  lean_left: 'Parallelogram (alt)',
  trapezoid: 'Trapezoid',
  inv_trapezoid: 'Trapezoid (alt)',
};

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Mermaid disallows raw quotes/newlines inside quoted labels. */
function esc(label: string): string {
  return label.replace(/"/g, '&quot;').replace(/\s*\n\s*/g, ' ').trim();
}

function unesc(label: string): string {
  return label.replace(/&quot;/g, '"').trim();
}

const SHAPE_BRACKETS: Record<MermaidShape, [string, string]> = {
  square: ['[', ']'],
  round: ['(', ')'],
  stadium: ['([', '])'],
  subroutine: ['[[', ']]'],
  cylinder: ['[(', ')]'],
  circle: ['((', '))'],
  doublecircle: ['(((', ')))'],
  odd: ['>', ']'],
  diamond: ['{', '}'],
  hexagon: ['{{', '}}'],
  lean_right: ['[/', '/]'],
  lean_left: ['[\\', '\\]'],
  trapezoid: ['[/', '\\]'],
  inv_trapezoid: ['[\\', '/]'],
};

const EDGE_OPS: Record<EdgeStroke, Record<EdgeArrow, string>> = {
  normal: { point: '-->', open: '---' },
  dotted: { point: '-.->', open: '-.-' },
  thick: { point: '==>', open: '===' },
};

export function toMermaid(data: FlowData): string {
  const lines = [`flowchart ${data.direction}`];
  for (const n of data.nodes) {
    const [open, close] = SHAPE_BRACKETS[n.shape] ?? SHAPE_BRACKETS.square;
    lines.push(`  ${n.id}${open}"${esc(n.label || n.id)}"${close}`);
  }
  for (const e of data.edges) {
    const op = EDGE_OPS[e.stroke]?.[e.arrow] ?? '-->';
    const label = e.label ? `|"${esc(e.label)}"|` : '';
    lines.push(`  ${e.source} ${op}${label} ${e.target}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Parsing — a small tokenizer over one statement line at a time.
// ---------------------------------------------------------------------------

// Openers longest-first; `[/` and `[\` families are disambiguated by which
// closer appears (lean vs trapezoid).
const OPENERS: { open: string; closers: { close: string; shape: MermaidShape }[] }[] = [
  { open: '(((', closers: [{ close: ')))', shape: 'doublecircle' }] },
  { open: '((', closers: [{ close: '))', shape: 'circle' }] },
  { open: '([', closers: [{ close: '])', shape: 'stadium' }] },
  { open: '[(', closers: [{ close: ')]', shape: 'cylinder' }] },
  { open: '[[', closers: [{ close: ']]', shape: 'subroutine' }] },
  { open: '[/', closers: [{ close: '/]', shape: 'lean_right' }, { close: '\\]', shape: 'trapezoid' }] },
  { open: '[\\', closers: [{ close: '\\]', shape: 'lean_left' }, { close: '/]', shape: 'inv_trapezoid' }] },
  { open: '{{', closers: [{ close: '}}', shape: 'hexagon' }] },
  { open: '{', closers: [{ close: '}', shape: 'diamond' }] },
  { open: '(', closers: [{ close: ')', shape: 'round' }] },
  { open: '[', closers: [{ close: ']', shape: 'square' }] },
  { open: '>', closers: [{ close: ']', shape: 'odd' }] },
];

// Statements that exist in mermaid but can't round-trip through this model.
const UNSUPPORTED_STMT = /^(subgraph\b|end\b|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b|accTitle\b|accDescr\b)/;

const ID_RE = /^[A-Za-z0-9_]+/;

// Every token scans forward for its closer / edge terminator, so an
// all-on-one-line fence made that quadratic: 439 KB took ~8.5 s of blocking
// work. Bound the lookahead, and refuse oversized graphs outright.
const MAX_CLOSER_LOOKAHEAD = 512;
const MAX_FENCE_BYTES = 100_000;
const MAX_NODES = 2000;
const MAX_EDGES = 4000;

/**
 * indexOf within a bounded window. It must search a *slice*: plain
 * `indexOf` scans to end-of-string even when the result is then discarded,
 * which is the quadratic cost this is meant to remove.
 */
function boundedIndexOf(haystack: string, needle: string): number {
  const window = haystack.length <= MAX_CLOSER_LOOKAHEAD
    ? haystack
    : haystack.slice(0, MAX_CLOSER_LOOKAHEAD + needle.length);
  return window.indexOf(needle);
}

interface ParsedRef { id: string; shape?: MermaidShape; label?: string; }
interface ParsedEdge { stroke: EdgeStroke; arrow: EdgeArrow; label?: string; }

class LineParser {
  private pos = 0;
  constructor(private readonly s: string) {}

  private ws(): void {
    while (this.pos < this.s.length && (this.s[this.pos] === ' ' || this.s[this.pos] === '\t')) {
      this.pos++;
    }
  }

  atEnd(): boolean {
    this.ws();
    return this.pos >= this.s.length;
  }

  private rest(): string {
    return this.s.slice(this.pos);
  }

  /** id with optional shape+label. Null on anything unexpected. */
  nodeRef(): ParsedRef | null {
    this.ws();
    const idMatch = ID_RE.exec(this.rest());
    if (!idMatch) {
      return null;
    }
    this.pos += idMatch[0].length;
    if (this.rest().startsWith(':::')) {
      return null; // class annotation — not representable
    }

    for (const { open, closers } of OPENERS) {
      if (!this.rest().startsWith(open)) {
        continue;
      }
      this.pos += open.length;
      // Quoted label: everything up to the next `"` (brackets, pipes… all fine).
      const afterOpen = this.rest();
      const qm = /^\s*"([^"]*)"\s*/.exec(afterOpen);
      if (qm) {
        this.pos += qm[0].length;
        for (const { close, shape } of closers) {
          if (this.rest().startsWith(close)) {
            this.pos += close.length;
            return { id: idMatch[0], shape, label: unesc(qm[1]) };
          }
        }
        return null; // quoted label without its closer
      }
      // Unquoted label: earliest family closer wins.
      let best: { at: number; close: string; shape: MermaidShape } | null = null;
      for (const { close, shape } of closers) {
        const at = boundedIndexOf(afterOpen, close);
        if (at >= 0 && (best === null || at < best.at)) {
          best = { at, close, shape };
        }
      }
      if (!best) {
        return null;
      }
      const label = afterOpen.slice(0, best.at).trim();
      if (label.includes('"')) {
        return null; // half-quoted — refuse rather than guess
      }
      this.pos += best.at + best.close.length;
      return { id: idMatch[0], shape: best.shape, label: unesc(label) };
    }
    return { id: idMatch[0] };
  }

  /** `ref (& ref)*` */
  group(): ParsedRef[] | null {
    const refs: ParsedRef[] = [];
    for (;;) {
      const ref = this.nodeRef();
      if (!ref) {
        return null;
      }
      refs.push(ref);
      this.ws();
      if (this.rest().startsWith('&')) {
        this.pos += 1;
        continue;
      }
      return refs;
    }
  }

  /**
   * One edge operator with optional label. Handles plain ops (`-->`, `---`,
   * `-.->`, `-.-`, `==>`, `===`, longer runs), pipe labels (`-->|x|`,
   * `-->|"x"|`), and inline labels (`-- x -->`, `-. x .->`, `== x ==>`).
   */
  edge(): ParsedEdge | null {
    this.ws();
    const r = this.rest();

    // Inline label: 2-char opener followed by whitespace.
    const inline = /^(--|-\.|==)(?=\s)/.exec(r);
    if (inline) {
      const stroke: EdgeStroke = inline[1] === '--' ? 'normal' : inline[1] === '-.' ? 'dotted' : 'thick';
      const terms: { t: string; arrow: EdgeArrow }[] =
        stroke === 'normal'
          ? [{ t: '-->', arrow: 'point' }, { t: '---', arrow: 'open' }]
          : stroke === 'dotted'
            ? [{ t: '.->', arrow: 'point' }, { t: '.-', arrow: 'open' }]
            : [{ t: '==>', arrow: 'point' }, { t: '===', arrow: 'open' }];
      const body = r.slice(inline[1].length);
      let best: { at: number; t: string; arrow: EdgeArrow } | null = null;
      for (const { t, arrow } of terms) {
        const at = boundedIndexOf(body, t);
        if (at >= 0 && (best === null || at < best.at)) {
          best = { at, t, arrow };
        }
      }
      if (!best) {
        return null;
      }
      const label = unesc(body.slice(0, best.at).trim().replace(/^"|"$/g, ''));
      this.pos += inline[1].length + best.at + best.t.length;
      return { stroke, arrow: best.arrow, label: label || undefined };
    }

    let op: { stroke: EdgeStroke; arrow: EdgeArrow } | null = null;
    const plain: { re: RegExp; stroke: EdgeStroke; arrow: EdgeArrow }[] = [
      { re: /^-\.+->/, stroke: 'dotted', arrow: 'point' },
      { re: /^-\.+-/, stroke: 'dotted', arrow: 'open' },
      { re: /^={2,}>/, stroke: 'thick', arrow: 'point' },
      { re: /^={3,}/, stroke: 'thick', arrow: 'open' },
      { re: /^-{2,}>/, stroke: 'normal', arrow: 'point' },
      { re: /^-{3,}/, stroke: 'normal', arrow: 'open' },
    ];
    for (const { re, stroke, arrow } of plain) {
      const m = re.exec(r);
      if (m) {
        this.pos += m[0].length;
        op = { stroke, arrow };
        break;
      }
    }
    if (!op) {
      return null;
    }

    // Optional pipe label; the quoted form may contain pipes.
    const pr = this.rest();
    const quoted = /^\|\s*"([^"]*)"\s*\|/.exec(pr);
    const bare = quoted ? null : /^\|([^|]*)\|/.exec(pr);
    const lm = quoted ?? bare;
    if (lm) {
      this.pos += lm[0].length;
      const label = unesc(lm[1].trim());
      return { ...op, label: label || undefined };
    }
    return { ...op };
  }
}

interface Declaration { shape?: MermaidShape; label?: string; }

/**
 * Parse a mermaid flowchart into FlowData. Positions are kept from `prev` for
 * node ids that survive; new nodes get a layered layout (mermaid stores no
 * positions). Returns null — read-only for the caller — on anything this
 * model can't re-emit faithfully. Empty content is an editable empty flow.
 */
export function tryFromMermaid(text: string, prev: FlowData = EMPTY_FLOW): FlowData | null {
  if (!text.trim()) {
    return { ...EMPTY_FLOW };
  }
  if (text.length > MAX_FENCE_BYTES) {
    return null; // too large to edit visually
  }

  let direction: FlowDirection | null = null;
  const decl = new Map<string, Declaration>();
  const order: string[] = [];
  const rawEdges: { source: string; target: string; e: ParsedEdge }[] = [];

  const declare = (ref: ParsedRef) => {
    if (!decl.has(ref.id)) {
      decl.set(ref.id, {});
      order.push(ref.id);
    }
    if (ref.shape !== undefined) {
      const d = decl.get(ref.id)!;
      d.shape = ref.shape; // later declarations win, as in mermaid
      d.label = ref.label;
    }
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) {
      continue;
    }
    if (!direction) {
      const dm = /^(?:flowchart|graph)\s+(TD|TB|BT|RL|LR)\s*$/.exec(line);
      if (!dm) {
        return null; // first meaningful line must be a plain flowchart header
      }
      direction = dm[1] as FlowDirection;
      continue;
    }
    if (UNSUPPORTED_STMT.test(line)) {
      return null;
    }

    const p = new LineParser(line);
    let group = p.group();
    if (!group) {
      return null;
    }
    group.forEach(declare);
    while (!p.atEnd()) {
      const e = p.edge();
      const next = e && p.group();
      if (!e || !next) {
        return null;
      }
      next.forEach(declare);
      for (const s of group) {
        for (const t of next) {
          // `&` groups multiply: 1500 & 1500 is 2.25M edges from 21 KB.
          if (rawEdges.length >= MAX_EDGES || decl.size > MAX_NODES) {
            return null;
          }
          rawEdges.push({ source: s.id, target: t.id, e });
        }
      }
      group = next;
    }
  }
  if (!direction) {
    return null;
  }
  if (decl.size > MAX_NODES || rawEdges.length > MAX_EDGES) {
    return null;
  }

  const posById = new Map(prev.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const fresh = new Set<string>();
  const nodes: FlowNode[] = order.map((id) => {
    const d = decl.get(id)!;
    const kept = posById.get(id);
    if (!kept) {
      fresh.add(id);
    }
    return {
      id,
      shape: d.shape ?? 'square',
      label: d.label !== undefined && d.label !== '' ? d.label : id,
      x: kept?.x ?? 0,
      y: kept?.y ?? 0,
    };
  });
  const edges: FlowEdge[] = rawEdges.map((r, i) => ({
    id: `e${i + 1}`,
    source: r.source,
    target: r.target,
    label: r.e.label,
    stroke: r.e.stroke,
    arrow: r.e.arrow,
  }));

  if (fresh.size) {
    layoutFresh(nodes, edges, direction, fresh);
  }
  return { direction, nodes, edges };
}

/**
 * Layered positions for nodes without a kept position: longest-path depth
 * from the edges, then rows/columns per level. Bounded relaxation so cycles
 * can't loop forever.
 */
function layoutFresh(
  nodes: FlowNode[],
  edges: FlowEdge[],
  direction: FlowDirection,
  fresh: Set<string>,
): void {
  const depth = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  // Clamped: reverse-topological edge order defeats the early break, making the
  // nodes x edges bound reachable (30k edges measured at ~29 s).
  const maxPasses = Math.min(nodes.length, 64);
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const e of edges) {
      const d = (depth.get(e.source) ?? 0) + 1;
      if (d > (depth.get(e.target) ?? 0) && d <= nodes.length) {
        depth.set(e.target, d);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  const horizontal = direction === 'LR' || direction === 'RL';
  const indexInLevel = new Map<number, number>();
  for (const n of nodes) {
    const level = depth.get(n.id) ?? 0;
    const idx = indexInLevel.get(level) ?? 0;
    indexInLevel.set(level, idx + 1);
    if (!fresh.has(n.id)) {
      continue; // kept positions still claim a slot in their level
    }
    if (horizontal) {
      n.x = 60 + level * 230;
      n.y = 40 + idx * 100;
    } else {
      n.x = 60 + idx * 210;
      n.y = 40 + level * 110;
    }
  }
}
