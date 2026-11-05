import React, { useRef } from 'react';
import type { Participant } from '../../format/sequence';
import { Icon } from '../../ui/icons';
import { Segmented } from '../../ui/controls';
import type { InsertKind } from './edits';

// The two popovers: "Insert here" (from the + between rows) and a
// participant's ⋯ menu. Buttons act on mousedown so the stage keeps focus.

const press = (fn: () => void) => (e: React.MouseEvent) => {
  if (e.button === 0) {
    e.preventDefault();
    fn();
  }
};

/** Icons only this menu uses. */
const INSERT_ICONS: Record<InsertKind, string> = {
  message: '<path d="M3 12h17M15 7l5 5-5 5"/>',
  note: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 12h8M8 16h5"/>',
  loop: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  alt: '<path d="M6 4v6a4 4 0 0 0 4 4h8M6 20v-6M15 11l3 3-3 3"/>',
  opt: '<rect x="4" y="5" width="16" height="14" rx="2" stroke-dasharray="3 2.5"/><path d="M9 12h6"/>',
};

const INSERT_ITEMS: { kind: InsertKind; label: string; sub: string }[] = [
  { kind: 'message', label: 'Message', sub: 'A → B' },
  { kind: 'note', label: 'Note', sub: 'over / beside' },
  { kind: 'loop', label: 'Loop', sub: 'repeat' },
  { kind: 'alt', label: 'Alt', sub: 'if / else' },
  { kind: 'opt', label: 'Opt', sub: 'optional' },
];

export function InsertMenu({ onPick }: { onPick(kind: InsertKind): void }) {
  return (
    <>
      <div className="lv-seq-pop-title">Insert here</div>
      <div className="lv-menu" role="menu">
        {INSERT_ITEMS.map((it) => (
          <button key={it.kind} type="button" role="menuitem" onMouseDown={press(() => onPick(it.kind))}>
            <svg className="lv-svg" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: INSERT_ICONS[it.kind] }} />
            {it.label}
            <span className="lv-seq-sub">{it.sub}</span>
          </button>
        ))}
      </div>
    </>
  );
}

export interface ParticipantMenuProps {
  participant: Participant;
  index: number;
  count: number;
  /** Steps that would go with it on delete. */
  refs: number;
  confirm: boolean;
  error: string;
  onKind(actor: boolean): void;
  onRename(): void;
  onApplyId(raw: string): void;
  onMove(delta: -1 | 1): void;
  onAskDelete(): void;
  onCancelDelete(): void;
  onDelete(): void;
}

export function ParticipantMenu(props: ParticipantMenuProps) {
  const { participant: p, index, count, refs, confirm, error } = props;
  const idRef = useRef<HTMLInputElement | null>(null);

  if (confirm) {
    return (
      <>
        <div className="lv-seq-confirm">
          Delete <b>{p.label}</b>
          {refs > 0 && <> and the <b>{refs}</b> step{refs === 1 ? '' : 's'} that use it</>}?
        </div>
        <div className="lv-seq-row lv-seq-end">
          <button type="button" className="lv-btn" onMouseDown={press(props.onCancelDelete)}>Cancel</button>
          <button type="button" className="lv-btn lv-seq-danger-btn" onMouseDown={press(props.onDelete)}>Delete</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="lv-seq-pop-title"><b>{p.label}</b><span className="lv-seq-mono">{p.id}</span></div>
      <div className="lv-seq-row">
        <Segmented
          label="Kind"
          value={p.actor ? 'actor' : 'participant'}
          onChange={(v) => props.onKind(v === 'actor')}
          options={[
            { value: 'participant', label: 'Participant', content: <><Icon name="participant" />Participant</> },
            { value: 'actor', label: 'Actor', content: <><Icon name="actor" />Actor</> },
          ]}
        />
      </div>
      <div className="lv-menu">
        <button type="button" onMouseDown={press(props.onRename)}>
          <Icon name="rename" />Rename<span className="lv-seq-sub">dbl-click</span>
        </button>
      </div>
      <div className="lv-seq-row">
        <label htmlFor="lv-seq-id">id</label>
        <input
          key={p.id}
          ref={idRef}
          id="lv-seq-id"
          className="lv-seq-mono"
          defaultValue={p.id}
          spellCheck={false}
          aria-label="Participant id"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              props.onApplyId(e.currentTarget.value);
            }
          }}
        />
        <button type="button" className="lv-btn" onMouseDown={press(() => props.onApplyId(idRef.current?.value ?? p.id))}>
          Apply
        </button>
      </div>
      {error && <div className="lv-seq-err" role="alert">{error}</div>}
      <div className="lv-menu">
        <button type="button" disabled={index === 0} onMouseDown={press(() => props.onMove(-1))}>
          <Icon name="dirLeft" />Move left
        </button>
        <button type="button" disabled={index === count - 1} onMouseDown={press(() => props.onMove(1))}>
          <Icon name="dirRight" />Move right
        </button>
        <button type="button" className="lv-seq-danger" onMouseDown={press(props.onAskDelete)}>
          <Icon name="trash" />Delete…
        </button>
      </div>
    </>
  );
}
