import React from 'react';
import type { ArrowKind, NoteStep, Participant, SequenceStep } from '../../format/sequence';
import { IconButton, Segmented, Separator } from '../../ui/controls';
import { ARROW_ORDER, ARROW_STYLES, arrowTitle } from './arrows';
import { isContinuation } from './layout';

// The floating bar above the selected step: arrow kind and direction for a
// message, placement and anchors for a note, label and unwrap for a frame.

function ArrowIcon({ kind }: { kind: ArrowKind }) {
  const { dotted, end } = ARROW_STYLES[kind];
  return (
    <svg viewBox="0 0 26 14" aria-hidden="true">
      <path d={`M2 7h${end === 'none' ? 22 : 19}`} strokeDasharray={dotted ? '3.5 2.5' : undefined} />
      {end === 'arrow' && <path d="M23 7 17 3.5v7Z" fill="currentColor" />}
      {end === 'open' && <path d="M17.5 3 23 7l-5.5 4" />}
      {end === 'cross' && <path d="M18 3.5l5 7M23 3.5l-5 7" />}
    </svg>
  );
}

const PLACEMENTS: { value: NoteStep['placement']; label: string }[] = [
  { value: 'left of', label: 'Left of' },
  { value: 'over', label: 'Over' },
  { value: 'right of', label: 'Right of' },
];

export interface StepBarProps {
  step: SequenceStep;
  participants: Participant[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onStep(next: SequenceStep): void;
  onMove(delta: -1 | 1): void;
  onEdit(): void;
  onDelete(): void;
}

export function StepBar({ step, participants, canMoveUp, canMoveDown, onStep, onMove, onEdit, onDelete }: StepBarProps) {
  const move = (
    <>
      <Separator />
      <IconButton icon="up" label="Move up" shortcut="Alt+↑" disabled={!canMoveUp} onPress={() => onMove(-1)} />
      <IconButton icon="down" label="Move down" shortcut="Alt+↓" disabled={!canMoveDown} onPress={() => onMove(1)} />
    </>
  );
  const editDelete = (deleteLabel = 'Delete') => (
    <>
      <Separator />
      <IconButton icon="rename" label="Edit text" shortcut="Enter" onPress={onEdit} />
      <IconButton icon="trash" label={deleteLabel} shortcut="⌫" danger onPress={onDelete} />
    </>
  );

  if (step.type === 'message') {
    return (
      <>
        {ARROW_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            className="lv-icon lv-seq-arrow"
            aria-label={ARROW_STYLES[k].label}
            title={arrowTitle(k)}
            aria-pressed={step.arrow === k}
            onMouseDown={(e) => { e.preventDefault(); onStep({ ...step, arrow: k }); }}
          >
            <ArrowIcon kind={k} />
          </button>
        ))}
        <Separator />
        <IconButton icon="swap" label="Swap direction" onPress={() => onStep({ ...step, from: step.to, to: step.from })} />
        {move}
        {editDelete()}
      </>
    );
  }

  if (step.type === 'note') {
    const options = (none: boolean) => (
      <>
        {none && <option value="">—</option>}
        {participants.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </>
    );
    return (
      <>
        <Segmented
          label="Note placement"
          options={PLACEMENTS}
          value={step.placement}
          onChange={(placement) =>
            onStep({ ...step, placement, actors: placement === 'over' ? step.actors : step.actors.slice(0, 1) })}
        />
        <select
          className="lv-seq-select"
          aria-label="Note anchor"
          value={step.actors[0]}
          onChange={(e) => onStep({ ...step, actors: [e.target.value, ...step.actors.slice(1).filter((a) => a !== e.target.value)] })}
        >
          {options(false)}
        </select>
        {step.placement === 'over' && (
          <>
            <span className="lv-seq-label">to</span>
            <select
              className="lv-seq-select"
              aria-label="Note spans to"
              value={step.actors[1] ?? ''}
              onChange={(e) =>
                onStep({ ...step, actors: e.target.value && e.target.value !== step.actors[0] ? [step.actors[0], e.target.value] : [step.actors[0]] })}
            >
              {options(true)}
            </select>
          </>
        )}
        {move}
        {editDelete()}
      </>
    );
  }

  if (step.type === 'block') {
    const divider = isContinuation(step);
    return (
      <>
        <span className="lv-seq-label">{divider ? `${step.keyword} branch` : `${step.keyword} frame`}</span>
        {editDelete(divider ? 'Remove this divider' : 'Remove the frame, keep its steps')}
      </>
    );
  }
  return null;
}
