import type { BlockStep, SequenceData, SequenceStep } from '../../format/sequence';
import { isContinuation } from './layout';

// Edits on the sequence model. Pure and immutable: each returns a new
// SequenceData (plus, where the caller needs it, the index of the step to
// select next) and never touches the input.

/** Does `step` mention participant `id`? Such steps go when the participant does. */
export function refsTo(step: SequenceStep, id: string): boolean {
  switch (step.type) {
    case 'message': return step.from === id || step.to === id;
    case 'note': return step.actors.includes(id);
    case 'activate':
    case 'deactivate': return step.actor === id;
    default: return false;
  }
}

export const countRefs = (data: SequenceData, id: string) => data.steps.filter((s) => refsTo(s, id)).length;

export function setStep(data: SequenceData, i: number, step: SequenceStep): SequenceData {
  return { ...data, steps: data.steps.map((s, j) => (j === i ? step : s)) };
}

export function insertSteps(data: SequenceData, idx: number, steps: SequenceStep[]): SequenceData {
  const next = data.steps.slice();
  next.splice(idx, 0, ...steps);
  return { ...data, steps: next };
}

const isActivation = (s: SequenceStep) => s.type === 'activate' || s.type === 'deactivate';

/**
 * Move step `i` one visible row up or down. Activation markers have no row of
 * their own, so the step passes over them too — otherwise the move would look
 * like nothing happened. Null when there is no visible row to pass.
 */
export function moveStep(data: SequenceData, i: number, delta: -1 | 1): { data: SequenceData; index: number } | null {
  if (i < 0 || i >= data.steps.length) {
    return null;
  }
  let j = i + delta;
  while (j >= 0 && j < data.steps.length && isActivation(data.steps[j])) {
    j += delta;
  }
  if (j < 0 || j >= data.steps.length) {
    return null;
  }
  const next = data.steps.slice();
  const [s] = next.splice(i, 1);
  next.splice(j, 0, s);
  return { data: { ...data, steps: next }, index: j };
}

/** Move step `i` to boundary `to` (a step index, or steps.length for the end). Null when it stays put. */
export function moveStepTo(data: SequenceData, i: number, to: number): { data: SequenceData; index: number } | null {
  if (to === i || to === i + 1 || i < 0 || i >= data.steps.length) {
    return null;
  }
  const next = data.steps.slice();
  const [s] = next.splice(i, 1);
  const at = to > i ? to - 1 : to;
  next.splice(at, 0, s);
  return { data: { ...data, steps: next }, index: at };
}

/**
 * Delete step `i`. Deleting a frame's opening block removes the frame — the
 * block, its dividers and its `end` — and keeps the steps inside it.
 */
export function deleteStep(data: SequenceData, i: number): SequenceData {
  const s = data.steps[i];
  if (!s) {
    return data;
  }
  const drop = new Set([i]);
  if (s.type === 'block' && !isContinuation(s)) {
    let depth = 0;
    for (let j = i + 1; j < data.steps.length; j++) {
      const t = data.steps[j];
      if (t.type === 'block' && !isContinuation(t)) {
        depth++;
      } else if (t.type === 'block' && depth === 0) {
        drop.add(j);
      } else if (t.type === 'end') {
        if (depth === 0) {
          drop.add(j);
          break;
        }
        depth--;
      }
    }
  }
  return { ...data, steps: data.steps.filter((_, j) => !drop.has(j)) };
}

export type InsertKind = 'message' | 'note' | 'loop' | 'alt' | 'opt';

/**
 * Insert a ready-made step (or frame) at boundary `idx`. An empty diagram gets
 * two participants first so a message has somewhere to go. `index` is the
 * step whose text should open for editing.
 */
export function insertTemplate(data: SequenceData, idx: number, kind: InsertKind): { data: SequenceData; index: number } {
  const base = data.participants.length
    ? data
    : { ...data, participants: [{ id: 'A', label: 'A', actor: false }, { id: 'B', label: 'B', actor: false }] };
  const a = base.participants[0].id;
  const b = (base.participants[1] ?? base.participants[0]).id;
  const block = (keyword: BlockStep['keyword'], label: string): BlockStep => ({ type: 'block', keyword, label });
  const steps: SequenceStep[] =
    kind === 'message' ? [{ type: 'message', from: a, to: b, arrow: 'solidArrow', text: 'message' }]
    : kind === 'note' ? [{ type: 'note', placement: 'over', actors: [a], text: 'note' }]
    : kind === 'alt' ? [block('alt', 'condition'), block('else', 'otherwise'), { type: 'end' }]
    : [block(kind, kind === 'loop' ? 'every minute' : 'condition'), { type: 'end' }];
  return { data: insertSteps(base, idx, steps), index: idx };
}

/** Characters mermaid accepts in a participant id; everything else is dropped. */
export const sanitizeId = (raw: string) => raw.replace(/[^A-Za-z0-9_]/g, '');

/** `base`, or `base2`, `base3`… — the first one no other participant uses. */
export function uniqueId(data: SequenceData, base: string, except?: string): string {
  const clean = sanitizeId(base) || 'P';
  const taken = new Set(data.participants.map((p) => p.id).filter((id) => id !== except));
  if (!taken.has(clean)) {
    return clean;
  }
  let n = 2;
  while (taken.has(`${clean}${n}`)) {
    n++;
  }
  return `${clean}${n}`;
}

/** An id built from a display name: its first two words, e.g. "Claude Code" → `ClaudeCode`. */
export function idFromLabel(data: SequenceData, label: string, except?: string): string {
  const words = label.match(/[A-Za-z0-9_]+/g) ?? [];
  return uniqueId(data, words.slice(0, 2).join('') || 'P', except);
}

/** Validate a typed id: the cleaned id, or why it can't be used. */
export function checkId(data: SequenceData, raw: string, current: string): { id: string } | { error: string } {
  const id = sanitizeId(raw.trim());
  if (!id) {
    return { error: 'Use letters, digits and _.' };
  }
  if (id !== current && data.participants.some((p) => p.id === id)) {
    return { error: `“${id}” is already used.` };
  }
  return { id };
}

/** Rename a participant id everywhere it is referenced. */
export function renameId(data: SequenceData, from: string, to: string): SequenceData {
  if (from === to) {
    return data;
  }
  const swap = (id: string) => (id === from ? to : id);
  return {
    ...data,
    participants: data.participants.map((p) => (p.id === from ? { ...p, id: to } : p)),
    steps: data.steps.map((s): SequenceStep => {
      switch (s.type) {
        case 'message': return { ...s, from: swap(s.from), to: swap(s.to) };
        case 'note': return { ...s, actors: s.actors.map(swap) };
        case 'activate':
        case 'deactivate': return { ...s, actor: swap(s.actor) };
        default: return s;
      }
    }),
  };
}

export function setParticipant(data: SequenceData, id: string, patch: { label?: string; actor?: boolean }): SequenceData {
  return { ...data, participants: data.participants.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

/** Add a participant at the end; returns its id so its name can open for editing. */
export function addParticipant(data: SequenceData): { data: SequenceData; id: string } {
  const id = uniqueId(data, `P${data.participants.length + 1}`);
  return { data: { ...data, participants: [...data.participants, { id, label: 'New participant', actor: false }] }, id };
}

/** Remove a participant and every step that references it (or they'd re-create it on the next parse). */
export function removeParticipant(data: SequenceData, id: string): SequenceData {
  return {
    ...data,
    participants: data.participants.filter((p) => p.id !== id),
    steps: data.steps.filter((s) => !refsTo(s, id)),
  };
}

/** Move the participant at `from` to position `to` (clamped). */
export function moveParticipant(data: SequenceData, from: number, to: number): SequenceData {
  const n = data.participants.length;
  const target = Math.min(n - 1, Math.max(0, to));
  if (from < 0 || from >= n || target === from) {
    return data;
  }
  const next = data.participants.slice();
  const [p] = next.splice(from, 1);
  next.splice(target, 0, p);
  return { ...data, participants: next };
}
