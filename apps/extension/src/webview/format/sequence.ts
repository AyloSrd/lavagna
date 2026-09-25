// Mermaid `sequenceDiagram` ↔ an editable model. Pure — no vscode, no DOM.
//
// The fence is the source of truth. Everything parsed is preserved on
// write-back: participant aliases, the exact arrow kind, activation suffixes,
// note placement, and block nesting. Anything this model cannot re-emit
// faithfully returns null so the caller can fall back to read-only rather than
// silently reformatting the user's diagram.

export type ArrowKind =
  | 'solid'        // ->
  | 'dotted'       // -->
  | 'solidArrow'   // ->>
  | 'dottedArrow'  // -->>
  | 'solidCross'   // -x
  | 'dottedCross'  // --x
  | 'solidOpen'    // -)
  | 'dottedOpen';  // --)

export interface Participant {
  /** Identifier used in messages. */
  id: string;
  /** Display name (the `as` alias), or the id when there is none. */
  label: string;
  /** `actor` renders as a stick figure in mermaid; `participant` as a box. */
  actor: boolean;
}

export interface MessageStep {
  type: 'message';
  from: string;
  to: string;
  arrow: ArrowKind;
  text: string;
  /** `+`/`-` activation suffix on the arrow, if any. */
  activate?: 'start' | 'end';
}

export interface NoteStep {
  type: 'note';
  placement: 'over' | 'left of' | 'right of';
  /** One participant, or two for `over A,B`. */
  actors: string[];
  text: string;
}

/** `loop` / `alt` / `else` / `opt` / `par` / `and` / `critical` / `option` / `break` / `end`. */
export interface BlockStep {
  type: 'block';
  keyword: 'loop' | 'alt' | 'else' | 'opt' | 'par' | 'and' | 'critical' | 'option' | 'break';
  label: string;
}

export interface EndStep {
  type: 'end';
}

export interface ActivationStep {
  type: 'activate' | 'deactivate';
  actor: string;
}

export type SequenceStep = MessageStep | NoteStep | BlockStep | EndStep | ActivationStep;

export interface SequenceData {
  title?: string;
  autonumber: boolean;
  participants: Participant[];
  steps: SequenceStep[];
}

export const EMPTY_SEQUENCE: SequenceData = { autonumber: false, participants: [], steps: [] };

/** Longest-first: `-->>` must win over `-->`, and `--x` over `-x`. */
const ARROWS: { token: string; kind: ArrowKind }[] = [
  { token: '-->>', kind: 'dottedArrow' },
  { token: '--x', kind: 'dottedCross' },
  { token: '--)', kind: 'dottedOpen' },
  { token: '-->', kind: 'dotted' },
  { token: '->>', kind: 'solidArrow' },
  { token: '-x', kind: 'solidCross' },
  { token: '-)', kind: 'solidOpen' },
  { token: '->', kind: 'solid' },
];

export const ARROW_LABELS: Record<ArrowKind, string> = {
  solidArrow: '──▶  solid arrow',
  dottedArrow: '─ ─▶  dotted arrow (reply)',
  solid: '───   solid line',
  dotted: '─ ─   dotted line',
  solidOpen: '──▷  solid async',
  dottedOpen: '─ ─▷  dotted async',
  solidCross: '──✕  solid cross',
  dottedCross: '─ ─✕  dotted cross',
};

export const ARROW_TOKENS: Record<ArrowKind, string> = {
  solid: '->',
  dotted: '-->',
  solidArrow: '->>',
  dottedArrow: '-->>',
  solidCross: '-x',
  dottedCross: '--x',
  solidOpen: '-)',
  dottedOpen: '--)',
};

const BLOCK_KEYWORDS = ['loop', 'alt', 'else', 'opt', 'par', 'and', 'critical', 'option', 'break'] as const;

// Statements that exist in mermaid sequence diagrams but this model cannot
// round-trip; a fence containing one opens read-only instead.
const UNSUPPORTED = /^(box\b|end box\b|link\b|links\b|properties\b|create\b|destroy\b|rect\b|style\b|classDef\b|accTitle\b|accDescr\b)/i;

const ID = '[A-Za-z0-9_]+';
const PARTICIPANT_RE = new RegExp(`^(participant|actor)\\s+(${ID})(?:\\s+as\\s+(.+))?$`, 'i');
const NOTE_RE = new RegExp(`^note\\s+(over|left of|right of)\\s+([A-Za-z0-9_,\\s]+?)\\s*:\\s*(.*)$`, 'i');
const ACTIVATION_RE = new RegExp(`^(activate|deactivate)\\s+(${ID})$`, 'i');
const MAX_FENCE_BYTES = 100_000;
const MAX_STEPS = 2000;

/** Split `A->>+B: text` into its parts. Null when the line isn't a message. */
function parseMessage(line: string): MessageStep | null {
  for (const { token, kind } of ARROWS) {
    const at = line.indexOf(token);
    if (at <= 0) {
      continue;
    }
    const from = line.slice(0, at).trim();
    let rest = line.slice(at + token.length);
    // Guard against matching the `-` of `-->` when scanning for `->`: the
    // remainder must not begin with another arrow character.
    if (/^[->x)]/.test(rest) && ARROWS.some((a) => line.startsWith(a.token, at) && a.token.length > token.length)) {
      continue;
    }
    let activate: MessageStep['activate'] | undefined;
    if (rest.startsWith('+')) {
      activate = 'start';
      rest = rest.slice(1);
    } else if (rest.startsWith('-')) {
      activate = 'end';
      rest = rest.slice(1);
    }
    const colon = rest.indexOf(':');
    if (colon < 0) {
      return null; // a message must carry text
    }
    const to = rest.slice(0, colon).trim();
    const text = rest.slice(colon + 1).trim();
    if (!new RegExp(`^${ID}$`).test(from) || !new RegExp(`^${ID}$`).test(to)) {
      return null;
    }
    return { type: 'message', from, to, arrow: kind, text, activate };
  }
  return null;
}

export function parseSequence(text: string): SequenceData | null {
  if (!text.trim()) {
    return { ...EMPTY_SEQUENCE, participants: [], steps: [] };
  }
  if (text.length > MAX_FENCE_BYTES) {
    return null;
  }

  const data: SequenceData = { autonumber: false, participants: [], steps: [] };
  const declared = new Set<string>();
  let sawHeader = false;

  const ensureParticipant = (id: string) => {
    if (!declared.has(id)) {
      declared.add(id);
      data.participants.push({ id, label: id, actor: false });
    }
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) {
      continue;
    }
    if (!sawHeader) {
      if (/^sequenceDiagram$/i.test(line)) {
        sawHeader = true;
        continue;
      }
      return null; // first meaningful line must be the header
    }
    if (UNSUPPORTED.test(line)) {
      return null;
    }
    if (data.steps.length > MAX_STEPS) {
      return null;
    }

    if (/^autonumber$/i.test(line)) {
      data.autonumber = true;
      continue;
    }
    const title = /^title\s*:?\s*(.+)$/i.exec(line);
    if (title && !line.includes('->')) {
      data.title = title[1].trim();
      continue;
    }

    const p = PARTICIPANT_RE.exec(line);
    if (p) {
      const [, keyword, id, alias] = p;
      const existing = data.participants.find((x) => x.id === id);
      if (existing) {
        existing.actor = keyword.toLowerCase() === 'actor';
        if (alias) {
          existing.label = alias.trim();
        }
      } else {
        declared.add(id);
        data.participants.push({
          id,
          label: alias ? alias.trim() : id,
          actor: keyword.toLowerCase() === 'actor',
        });
      }
      continue;
    }

    const note = NOTE_RE.exec(line);
    if (note) {
      const actors = note[2]
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      if (actors.length === 0 || actors.some((a) => !new RegExp(`^${ID}$`).test(a))) {
        return null;
      }
      actors.forEach(ensureParticipant);
      data.steps.push({
        type: 'note',
        placement: note[1].toLowerCase() as NoteStep['placement'],
        actors,
        text: note[3].trim(),
      });
      continue;
    }

    const act = ACTIVATION_RE.exec(line);
    if (act) {
      ensureParticipant(act[2]);
      data.steps.push({ type: act[1].toLowerCase() as 'activate' | 'deactivate', actor: act[2] });
      continue;
    }

    if (/^end$/i.test(line)) {
      data.steps.push({ type: 'end' });
      continue;
    }
    const block = new RegExp(`^(${BLOCK_KEYWORDS.join('|')})\\b\\s*(.*)$`, 'i').exec(line);
    if (block) {
      data.steps.push({
        type: 'block',
        keyword: block[1].toLowerCase() as BlockStep['keyword'],
        label: block[2].trim(),
      });
      continue;
    }

    const msg = parseMessage(line);
    if (msg) {
      ensureParticipant(msg.from);
      ensureParticipant(msg.to);
      data.steps.push(msg);
      continue;
    }

    return null; // unrecognised line — refuse rather than drop it
  }

  return sawHeader ? data : null;
}

export function toSequence(data: SequenceData): string {
  const lines = ['sequenceDiagram'];
  if (data.autonumber) {
    lines.push('  autonumber');
  }
  if (data.title) {
    lines.push(`  title ${data.title}`);
  }
  for (const p of data.participants) {
    const keyword = p.actor ? 'actor' : 'participant';
    lines.push(p.label && p.label !== p.id ? `  ${keyword} ${p.id} as ${p.label}` : `  ${keyword} ${p.id}`);
  }
  let depth = 0;
  for (const step of data.steps) {
    if (step.type === 'end') {
      depth = Math.max(0, depth - 1);
    }
    const pad = '  '.repeat(depth + 1);
    switch (step.type) {
      case 'message': {
        const suffix = step.activate === 'start' ? '+' : step.activate === 'end' ? '-' : '';
        lines.push(`${pad}${step.from}${ARROW_TOKENS[step.arrow]}${suffix}${step.to}: ${step.text}`);
        break;
      }
      case 'note':
        lines.push(`${pad}Note ${step.placement} ${step.actors.join(',')}: ${step.text}`);
        break;
      case 'block':
        lines.push(`${pad}${step.keyword}${step.label ? ` ${step.label}` : ''}`);
        // `else`/`and`/`option` continue the current block rather than nesting.
        if (!['else', 'and', 'option'].includes(step.keyword)) {
          depth++;
        }
        break;
      case 'end':
        lines.push(`${pad}end`);
        break;
      case 'activate':
      case 'deactivate':
        lines.push(`${pad}${step.type} ${step.actor}`);
        break;
    }
  }
  return lines.join('\n');
}

/** Which mermaid diagram a fence holds, so the editor can dispatch on it. */
export type MermaidDiagramKind = 'flowchart' | 'sequence' | 'unknown';

export function mermaidKindOf(text: string): MermaidDiagramKind {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) {
      continue;
    }
    if (/^(flowchart|graph)\b/i.test(line)) {
      return 'flowchart';
    }
    if (/^sequenceDiagram\b/i.test(line)) {
      return 'sequence';
    }
    return 'unknown';
  }
  return 'flowchart'; // an empty fence starts as a flowchart
}
