import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ARROW_LABELS,
  ArrowKind,
  MessageStep,
  NoteStep,
  Participant,
  SequenceData,
  SequenceStep,
  parseSequence,
  toSequence,
} from '../format/sequence';
import type { EditorProps } from '../BlockEditorApp';
import { ReadOnlyFallback } from './ReadOnlyFallback';

// Sequence diagrams have no node/edge model, so this is a different editor from
// the flowchart one: a rendered diagram (lifelines + arrows) above an editable
// step list. The fence stays the source of truth; nothing is written until the
// user actually changes something.

const LANE_W = 150;
const HEAD_H = 44;
const ROW_H = 42;
const PAD = 20;

const BTN: React.CSSProperties = {
  background: 'var(--vscode-button-secondaryBackground, #3a3d41)',
  color: 'var(--vscode-button-secondaryForeground, #ccc)',
  border: '1px solid var(--vscode-panel-border, #555)',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: '0.76em',
  cursor: 'pointer',
};

const FIELD: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 3,
  color: 'var(--vscode-foreground)',
  font: 'inherit',
  fontSize: 12,
  padding: '2px 4px',
};

const STROKE = 'var(--vscode-foreground)';
const MUTED = 'var(--vscode-descriptionForeground, #999)';

const DOTTED: Record<ArrowKind, boolean> = {
  solid: false, solidArrow: false, solidCross: false, solidOpen: false,
  dotted: true, dottedArrow: true, dottedCross: true, dottedOpen: true,
};

/** Steps that occupy a row in the rendered diagram. */
function isDrawn(step: SequenceStep): step is MessageStep | NoteStep {
  return step.type === 'message' || step.type === 'note';
}

export function SequenceEditor({ value, onChange, onGestureEnd }: EditorProps) {
  const lastWritten = useRef(value);
  const touched = useRef(false);

  const initial = useRef<SequenceData | null | undefined>(undefined);
  if (initial.current === undefined) {
    initial.current = parseSequence(value);
  }
  const [invalid, setInvalid] = useState(initial.current === null);
  const [data, setData] = useState<SequenceData>(
    () => initial.current ?? { autonumber: false, participants: [], steps: [] },
  );
  const [selected, setSelected] = useState<number | null>(null);

  // Re-read only on external change, never on our own echo.
  useEffect(() => {
    if (value === lastWritten.current) {
      return;
    }
    lastWritten.current = value;
    touched.current = false;
    const parsed = parseSequence(value);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setData(parsed);
  }, [value]);

  const commit = (next: SequenceData, flush = false) => {
    touched.current = true;
    setData(next);
    const text = toSequence(next);
    if (text !== lastWritten.current) {
      lastWritten.current = text;
      onChange(text);
      if (flush) {
        onGestureEnd();
      }
    }
  };

  const ids = data.participants.map((p) => p.id);
  const laneX = useMemo(() => {
    const map = new Map<string, number>();
    data.participants.forEach((p, i) => map.set(p.id, PAD + LANE_W / 2 + i * LANE_W));
    return map;
  }, [data.participants]);

  const drawn = data.steps.filter(isDrawn);
  const width = Math.max(PAD * 2 + Math.max(1, data.participants.length) * LANE_W, 320);
  const height = HEAD_H + PAD + Math.max(1, drawn.length) * ROW_H + PAD;

  if (invalid) {
    return (
      <ReadOnlyFallback
        content={value}
        message="This sequence diagram uses features the visual editor can't edit without losing them (boxes, create/destroy, links, styling) — edit it as text; the block is left untouched."
      />
    );
  }

  // --- mutations -----------------------------------------------------------
  const setParticipant = (i: number, patch: Partial<Participant>) =>
    commit({ ...data, participants: data.participants.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  const addParticipant = () => {
    let n = data.participants.length + 1;
    while (ids.includes(`P${n}`)) { n++; }
    commit({ ...data, participants: [...data.participants, { id: `P${n}`, label: `P${n}`, actor: false }] }, true);
  };

  const removeParticipant = (id: string) =>
    commit(
      {
        ...data,
        participants: data.participants.filter((p) => p.id !== id),
        // Drop steps that referenced it, or they'd re-create it on next parse.
        steps: data.steps.filter((s) =>
          s.type === 'message' ? s.from !== id && s.to !== id
          : s.type === 'note' ? !s.actors.includes(id)
          : s.type === 'activate' || s.type === 'deactivate' ? s.actor !== id
          : true,
        ),
      },
      true,
    );

  const moveParticipant = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= data.participants.length) { return; }
    const next = data.participants.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit({ ...data, participants: next }, true);
  };

  const setStep = (i: number, patch: Partial<MessageStep> & Partial<NoteStep>) =>
    commit({
      ...data,
      steps: data.steps.map((s, j) => (j === i ? ({ ...s, ...patch } as SequenceStep) : s)),
    });

  const addMessage = () => {
    const from = ids[0] ?? 'A';
    const to = ids[1] ?? from;
    commit({
      ...data,
      participants: data.participants.length
        ? data.participants
        : [{ id: 'A', label: 'A', actor: false }, { id: 'B', label: 'B', actor: false }],
      steps: [...data.steps, { type: 'message', from, to: ids[1] ? to : (ids[0] ?? 'B'), arrow: 'solidArrow', text: 'message' }],
    }, true);
  };

  const addNote = () => {
    const actor = ids[0] ?? 'A';
    commit({ ...data, steps: [...data.steps, { type: 'note', placement: 'over', actors: [actor], text: 'note' }] }, true);
  };

  const removeStep = (i: number) => {
    commit({ ...data, steps: data.steps.filter((_, j) => j !== i) }, true);
    setSelected(null);
  };

  const moveStep = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= data.steps.length) { return; }
    const next = data.steps.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit({ ...data, steps: next }, true);
    setSelected(j);
  };

  // --- render --------------------------------------------------------------
  let drawnIndex = -1;

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <button style={BTN} onMouseDown={(e) => { e.preventDefault(); addParticipant(); }}>＋ Participant</button>
        <button style={BTN} onMouseDown={(e) => { e.preventDefault(); addMessage(); }}>＋ Message</button>
        <button style={BTN} onMouseDown={(e) => { e.preventDefault(); addNote(); }}>＋ Note</button>
        <label style={{ fontSize: '0.76em', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
          <input
            type="checkbox"
            checked={data.autonumber}
            onChange={(e) => commit({ ...data, autonumber: e.target.checked }, true)}
          />
          autonumber
        </label>
      </div>

      {/* Rendered diagram */}
      <div style={{ overflow: 'auto', border: '1px solid var(--vscode-panel-border, #444)', borderRadius: 6 }}>
        <svg width={width} height={height} style={{ display: 'block', minWidth: '100%' }}>
          {/* Lifelines + heads */}
          {data.participants.map((p) => {
            const x = laneX.get(p.id)!;
            return (
              <g key={p.id}>
                <line x1={x} y1={HEAD_H} x2={x} y2={height - PAD} stroke={MUTED} strokeWidth={1} strokeDasharray="4 4" />
                <rect
                  x={x - LANE_W / 2 + 8}
                  y={8}
                  width={LANE_W - 16}
                  height={HEAD_H - 16}
                  rx={p.actor ? 14 : 3}
                  fill="var(--vscode-editorWidget-background, #252526)"
                  stroke="var(--vscode-focusBorder, #007acc)"
                  strokeWidth={1}
                />
                <text
                  x={x}
                  y={HEAD_H / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={STROKE}
                  fontSize={11}
                  fontFamily="var(--vscode-font-family)"
                >
                  {p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label}
                </text>
              </g>
            );
          })}

          {/* Messages and notes, in order */}
          {data.steps.map((step, i) => {
            if (!isDrawn(step)) {
              return null;
            }
            drawnIndex++;
            const y = HEAD_H + PAD + drawnIndex * ROW_H + ROW_H / 2;
            const isSel = selected === i;

            if (step.type === 'note') {
              const xs = step.actors.map((a) => laneX.get(a)).filter((v): v is number => v !== undefined);
              if (xs.length === 0) { return null; }
              const left = Math.min(...xs) - (step.placement === 'right of' ? -30 : 60);
              const w = xs.length > 1 ? Math.max(...xs) - Math.min(...xs) + 120 : 120;
              return (
                <g key={i} onClick={() => setSelected(i)} style={{ cursor: 'pointer' }}>
                  <rect
                    x={left} y={y - 13} width={w} height={26} rx={2}
                    fill="var(--vscode-inputValidation-warningBackground, rgba(204,167,0,0.18))"
                    stroke={isSel ? 'var(--vscode-focusBorder,#007acc)' : MUTED}
                    strokeWidth={isSel ? 2 : 1}
                  />
                  <text x={left + w / 2} y={y + 1} textAnchor="middle" dominantBaseline="middle" fill={STROKE} fontSize={10}>
                    {step.text.length > 34 ? `${step.text.slice(0, 33)}…` : step.text}
                  </text>
                </g>
              );
            }

            const x1 = laneX.get(step.from);
            const x2 = laneX.get(step.to);
            if (x1 === undefined || x2 === undefined) { return null; }
            const dash = DOTTED[step.arrow] ? '5 4' : undefined;
            const sw = isSel ? 2 : 1.2;
            const stroke = isSel ? 'var(--vscode-focusBorder,#007acc)' : STROKE;

            // A self-message loops out and back.
            if (step.from === step.to) {
              const d = `M ${x1} ${y - 10} H ${x1 + 46} V ${y + 10} H ${x1 + 6}`;
              return (
                <g key={i} onClick={() => setSelected(i)} style={{ cursor: 'pointer' }}>
                  <path d={d} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={dash} markerEnd="url(#seq-arrow)" />
                  <text x={x1 + 54} y={y} dominantBaseline="middle" fill={STROKE} fontSize={10}>
                    {step.text.length > 30 ? `${step.text.slice(0, 29)}…` : step.text}
                  </text>
                </g>
              );
            }

            const mid = (x1 + x2) / 2;
            return (
              <g key={i} onClick={() => setSelected(i)} style={{ cursor: 'pointer' }}>
                <line x1={x1} y1={y} x2={x2} y2={y} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} markerEnd="url(#seq-arrow)" />
                <text x={mid} y={y - 6} textAnchor="middle" fill={STROKE} fontSize={10}>
                  {step.text.length > 34 ? `${step.text.slice(0, 33)}…` : step.text}
                </text>
              </g>
            );
          })}

          <defs>
            <marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={STROKE} />
            </marker>
          </defs>
        </svg>
      </div>

      {/* Participants */}
      <div>
        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>Participants</div>
        {data.participants.map((p, i) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
            <input
              value={p.id}
              onChange={(e) => {
                const id = e.target.value.replace(/[^A-Za-z0-9_]/g, '');
                if (!id || (ids.includes(id) && id !== p.id)) { return; }
                const old = p.id;
                commit({
                  ...data,
                  participants: data.participants.map((x, j) => (j === i ? { ...x, id } : x)),
                  steps: data.steps.map((s) =>
                    s.type === 'message' ? { ...s, from: s.from === old ? id : s.from, to: s.to === old ? id : s.to }
                    : s.type === 'note' ? { ...s, actors: s.actors.map((a) => (a === old ? id : a)) }
                    : s.type === 'activate' || s.type === 'deactivate' ? { ...s, actor: s.actor === old ? id : s.actor }
                    : s,
                  ),
                });
              }}
              onBlur={onGestureEnd}
              title="Identifier used in messages"
              style={{ ...FIELD, width: 70, fontFamily: 'var(--vscode-editor-font-family, monospace)' }}
            />
            <input
              value={p.label}
              onChange={(e) => setParticipant(i, { label: e.target.value })}
              onBlur={onGestureEnd}
              placeholder="display name"
              style={{ ...FIELD, flex: 1, minWidth: 80 }}
            />
            <label style={{ fontSize: '0.72em', display: 'flex', alignItems: 'center', gap: 3 }}>
              <input type="checkbox" checked={p.actor} onChange={(e) => setParticipant(i, { actor: e.target.checked })} />
              actor
            </label>
            <button style={BTN} title="Move left" onMouseDown={(e) => { e.preventDefault(); moveParticipant(i, -1); }}>↑</button>
            <button style={BTN} title="Move right" onMouseDown={(e) => { e.preventDefault(); moveParticipant(i, 1); }}>↓</button>
            <button
              style={{ ...BTN, color: 'var(--vscode-errorForeground, #f48771)' }}
              title="Remove participant and its steps"
              onMouseDown={(e) => { e.preventDefault(); removeParticipant(p.id); }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Steps */}
      <div>
        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>Steps</div>
        {data.steps.length === 0 && (
          <p style={{ fontSize: 12, opacity: 0.7 }}>No steps yet — add a message.</p>
        )}
        {data.steps.map((step, i) => (
          <div
            key={i}
            onMouseDown={() => setSelected(i)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3, padding: '2px 4px', borderRadius: 3,
              background: selected === i ? 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.08))' : 'transparent',
            }}
          >
            <span style={{ width: 18, textAlign: 'right', fontSize: 10, opacity: 0.5 }}>{i + 1}</span>

            {step.type === 'message' && (
              <>
                <select value={step.from} onChange={(e) => setStep(i, { from: e.target.value })} style={{ ...BTN, cursor: 'pointer' }}>
                  {ids.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
                <select value={step.arrow} onChange={(e) => setStep(i, { arrow: e.target.value as ArrowKind })} title="Arrow style" style={{ ...BTN, cursor: 'pointer' }}>
                  {(Object.keys(ARROW_LABELS) as ArrowKind[]).map((k) => (
                    <option key={k} value={k}>{ARROW_LABELS[k]}</option>
                  ))}
                </select>
                <select value={step.to} onChange={(e) => setStep(i, { to: e.target.value })} style={{ ...BTN, cursor: 'pointer' }}>
                  {ids.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
                <input
                  value={step.text}
                  onChange={(e) => setStep(i, { text: e.target.value })}
                  onBlur={onGestureEnd}
                  placeholder="message"
                  style={{ ...FIELD, flex: 1, minWidth: 100, border: '1px solid var(--vscode-panel-border,#444)' }}
                />
              </>
            )}

            {step.type === 'note' && (
              <>
                <span style={{ fontSize: 11, opacity: 0.7 }}>Note</span>
                <select value={step.placement} onChange={(e) => setStep(i, { placement: e.target.value as NoteStep['placement'] })} style={{ ...BTN, cursor: 'pointer' }}>
                  <option value="over">over</option>
                  <option value="left of">left of</option>
                  <option value="right of">right of</option>
                </select>
                <select
                  value={step.actors[0]}
                  onChange={(e) => setStep(i, { actors: [e.target.value, ...step.actors.slice(1)] })}
                  style={{ ...BTN, cursor: 'pointer' }}
                >
                  {ids.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
                <input
                  value={step.text}
                  onChange={(e) => setStep(i, { text: e.target.value })}
                  onBlur={onGestureEnd}
                  placeholder="note"
                  style={{ ...FIELD, flex: 1, minWidth: 100, border: '1px solid var(--vscode-panel-border,#444)' }}
                />
              </>
            )}

            {(step.type === 'block' || step.type === 'end') && (
              <span style={{ fontSize: 11, fontFamily: 'var(--vscode-editor-font-family, monospace)', opacity: 0.8, flex: 1 }}>
                {step.type === 'end' ? 'end' : `${step.keyword} ${step.label}`.trim()}
              </span>
            )}

            {(step.type === 'activate' || step.type === 'deactivate') && (
              <span style={{ fontSize: 11, fontFamily: 'var(--vscode-editor-font-family, monospace)', opacity: 0.8, flex: 1 }}>
                {step.type} {step.actor}
              </span>
            )}

            <button style={BTN} title="Move up" onMouseDown={(e) => { e.preventDefault(); moveStep(i, -1); }}>↑</button>
            <button style={BTN} title="Move down" onMouseDown={(e) => { e.preventDefault(); moveStep(i, 1); }}>↓</button>
            <button
              style={{ ...BTN, color: 'var(--vscode-errorForeground, #f48771)' }}
              title="Remove step"
              onMouseDown={(e) => { e.preventDefault(); removeStep(i); }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
