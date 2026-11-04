import React, { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_SEQUENCE, SequenceData, SequenceStep, parseSequence, toSequence } from '../format/sequence';
import type { EditorProps } from '../BlockEditorApp';
import { CodePane } from '../ui/CodePane';
import { HelpDialog, Hint, IconButton, Separator, ZoomControls, isTyping } from '../ui/controls';
import { Icon } from '../ui/icons';
import { UndoStack } from '../ui/undoStack';
import { ReadOnlyFallback } from './ReadOnlyFallback';
import { Diagram } from './sequence/Diagram';
import * as edit from './sequence/edits';
import { HintText, SHORTCUTS } from './sequence/help';
import { HoverLayer, SELF_MIN } from './sequence/HoverLayer';
import { InlineEditor } from './sequence/InlineEditor';
import {
  Box, GUTTER, LANE_W, ROWS_TOP, TOP, View,
  fitView, isSelectable, laneAt, laneX, layoutSequence, nearestBoundary, rowAt,
} from './sequence/layout';
import { createMeasure } from './sequence/measure';
import { InsertMenu, ParticipantMenu } from './sequence/Popovers';
import type { Drag, Editing, Hover, Menu, Point } from './sequence/state';
import { StepBar } from './sequence/StepBar';
import { SEQ_CSS } from './sequence/styles';

// Sequence diagrams are edited on the diagram itself: drag between lifelines to
// add a message, click a step for its floating bar, double-click text to edit.
// The fence stays the source of truth — parsed once, re-read only on external
// change, and written back (via toSequence) only after a real user edit.

/** Pointer-downs on these belong to the floating UI, not the diagram. */
const FLOATING_UI = '.lv-ctx, .lv-pop, .lv-zoom, .lv-seq-edit';
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
/** Code pane starts open when the panel is at least this wide. */
const WIDE = 900;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function SequenceEditor({ value, onChange, onGestureEnd }: EditorProps) {
  const lastWritten = useRef(value);
  const initial = useRef<SequenceData | null | undefined>(undefined);
  if (initial.current === undefined) {
    initial.current = parseSequence(value);
  }
  const [invalid, setInvalid] = useState(initial.current === null);
  const [data, setData] = useState<SequenceData>(() => initial.current ?? EMPTY_SEQUENCE);
  const dataRef = useRef(data);
  dataRef.current = data;

  const [sel, setSel] = useState<number | null>(null);
  const [editing, setEditingState] = useState<Editing | null>(null);
  const editingRef = useRef<Editing | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [view, setView] = useState<View>({ x: 8, y: 8, z: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const viewTouched = useRef(false);
  const [space, setSpace] = useState(false);
  const [codeOpen, setCodeOpen] = useState(() => window.innerWidth >= WIDE);
  const [help, setHelp] = useState(false);
  const history = useRef(new UndoStack<SequenceData>());
  const lastDown = useRef<{ key: string; t: number } | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const measure = useMemo(createMeasure, []);
  const layout = useMemo(() => layoutSequence(data, measure), [data, measure]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const setEditing = (e: Editing | null) => {
    editingRef.current = e;
    setEditingState(e);
  };

  // Re-read only on external change (file edit, VS Code undo), never on our own echo.
  useEffect(() => {
    if (value === lastWritten.current) {
      return;
    }
    lastWritten.current = value;
    const parsed = parseSequence(value);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setData(parsed);
    dataRef.current = parsed;
    history.current.clear();
    editingRef.current = null;
    setEditingState(null);
    setMenu(null);
    setSel(null);
  }, [value]);

  // Fit to the panel width on open and on resize, until the user pans or zooms.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const refit = () => {
      if (!viewTouched.current && el.clientWidth > 50) {
        setView(fitView(el.clientWidth, el.clientHeight, layoutRef.current, false));
      }
    };
    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [invalid]);

  // A new participant widens the diagram; keep it in view while the view is still automatic.
  useEffect(() => {
    const el = stageRef.current;
    if (el && !viewTouched.current && el.clientWidth > 50) {
      setView(fitView(el.clientWidth, el.clientHeight, layoutRef.current, false));
    }
  }, [layout.width]);

  // ---------------------------------------------------------------- writing

  /** Show `next` and write it to the fence (no undo record). */
  const write = (next: SequenceData) => {
    setData(next);
    dataRef.current = next;
    const text = toSequence(next);
    if (text !== lastWritten.current) {
      lastWritten.current = text;
      onChange(text);
      onGestureEnd();
    }
  };

  /** A user edit: undoable, written at once. A change that serializes the same is not an edit. */
  const commit = (next: SequenceData) => {
    const prev = dataRef.current;
    if (toSequence(next) === toSequence(prev)) {
      setData(next);
      dataRef.current = next;
      return;
    }
    history.current.record(prev);
    write(next);
  };

  const undo = () => {
    finishEdit();
    const prev = history.current.undo(dataRef.current);
    if (prev) {
      setMenu(null);
      setSel((s) => (s !== null && s < prev.steps.length ? s : null));
      write(prev);
    }
  };
  const redo = () => {
    finishEdit();
    const next = history.current.redo(dataRef.current);
    if (next) {
      setMenu(null);
      setSel((s) => (s !== null && s < next.steps.length ? s : null));
      write(next);
    }
  };

  // ---------------------------------------------------------------- text editing

  const startEdit = (i: number) => {
    if (!isSelectable(dataRef.current.steps[i])) {
      return;
    }
    setMenu(null);
    setSel(i);
    setEditing({ kind: 'step', i });
  };

  const commitEdit = (raw: string) => {
    const e = editingRef.current;
    if (!e) {
      return;
    }
    setEditing(null);
    const v = raw.trim();
    const cur = dataRef.current;
    if (e.kind === 'step') {
      const s = cur.steps[e.i];
      let next: SequenceStep | undefined;
      if (s?.type === 'message' || s?.type === 'note') {
        next = v ? { ...s, text: v } : s;
      } else if (s?.type === 'block') {
        next = { ...s, label: v };
      }
      if (next && next !== s) {
        commit(edit.setStep(cur, e.i, next));
      }
      return;
    }
    const p = cur.participants.find((x) => x.id === e.id);
    if (!p) {
      return;
    }
    let next = v && v !== p.label ? edit.setParticipant(cur, e.id, { label: v }) : cur;
    if (e.isNew) {
      // A brand-new participant takes its id from the first name it gets; same
      // undo step as adding it.
      next = edit.renameId(next, e.id, edit.idFromLabel(next, v || p.label, e.id));
      write(next);
    } else if (next !== cur) {
      commit(next);
    }
  };

  const cancelEdit = () => setEditing(null);

  /** Commit an open field before acting on a click elsewhere (an unmounted field never blurs). */
  const finishEdit = () => {
    if (editingRef.current && inputRef.current) {
      commitEdit(inputRef.current.value);
    }
  };

  // ---------------------------------------------------------------- edits

  const indexOf = (id: string) => dataRef.current.participants.findIndex((p) => p.id === id);

  const addParticipant = () => {
    const r = edit.addParticipant(dataRef.current);
    commit(r.data);
    setSel(null);
    setEditing({ kind: 'head', id: r.id, isNew: true });
  };

  const insert = (idx: number, kind: edit.InsertKind) => {
    const r = edit.insertTemplate(dataRef.current, idx, kind);
    setMenu(null);
    commit(r.data);
    startEdit(r.index);
  };

  const moveSelected = (delta: -1 | 1) => {
    const s = sel === null ? undefined : dataRef.current.steps[sel];
    if (sel === null || (s?.type !== 'message' && s?.type !== 'note')) {
      return;
    }
    const r = edit.moveStep(dataRef.current, sel, delta);
    if (r) {
      commit(r.data);
      setSel(r.index);
    }
  };

  const deleteSelected = () => {
    if (sel === null) {
      return;
    }
    commit(edit.deleteStep(dataRef.current, sel));
    setSel(null);
  };

  // ---------------------------------------------------------------- view

  const zoomAt = (sx: number, sy: number, z: number) => {
    viewTouched.current = true;
    setView((v) => {
      const nz = clamp(z, MIN_ZOOM, MAX_ZOOM);
      const wx = (sx - v.x) / v.z;
      const wy = (sy - v.y) / v.z;
      return { z: nz, x: sx - wx * nz, y: sy - wy * nz };
    });
  };
  const zoomBy = (f: number) => {
    const el = stageRef.current;
    if (el) {
      zoomAt(el.clientWidth / 2, el.clientHeight / 2, viewRef.current.z * f);
    }
  };
  const fitWhole = () => {
    const el = stageRef.current;
    if (el) {
      viewTouched.current = true;
      setView(fitView(el.clientWidth, el.clientHeight, layoutRef.current, true));
    }
  };

  const onWheel = useEffectEvent((ev: WheelEvent) => {
    if ((ev.target as Element).closest('.lv-ctx, .lv-pop')) {
      return;
    }
    ev.preventDefault();
    const k = ev.deltaMode === 1 ? 16 : 1;
    if (ev.ctrlKey || ev.metaKey) {
      const r = stageRef.current!.getBoundingClientRect();
      zoomAt(ev.clientX - r.left, ev.clientY - r.top, viewRef.current.z * Math.exp(-ev.deltaY * k * 0.01));
    } else {
      viewTouched.current = true;
      setView((v) => ({ ...v, x: v.x - ev.deltaX * k, y: v.y - ev.deltaY * k }));
    }
    setMenu(null);
  });
  // Native listener: React's onWheel is passive and can't stop the panel scrolling.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const handler = (ev: WheelEvent) => onWheel(ev);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [invalid]);

  // ---------------------------------------------------------------- pointer

  const toWorld = (ev: { clientX: number; clientY: number }): Point => {
    const r = stageRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (ev.clientX - r.left - v.x) / v.z, y: (ev.clientY - r.top - v.y) / v.z };
  };

  const startPan = (ev: React.PointerEvent, clickDeselects: boolean) => {
    const v = viewRef.current;
    setDrag({ mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: v.x, vy: v.y, moved: false, clickDeselects });
    ev.currentTarget.setPointerCapture(ev.pointerId);
  };

  const onPointerDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    const target = ev.target as Element;
    if (target.closest(FLOATING_UI)) {
      return;
    }
    finishEdit();
    const p = toWorld(ev);
    const t = target.closest<HTMLElement | SVGElement>('[data-role]');
    const role = t?.dataset.role ?? null;
    const key = role ? `${role}:${t!.dataset.i ?? t!.dataset.id ?? ''}` : 'bg';
    // Detected by hand: selecting re-renders the step, so the browser's own
    // dblclick doesn't always see two clicks on the same node.
    const now = performance.now();
    const dbl = role !== null && lastDown.current?.key === key && now - lastDown.current.t < 400;
    lastDown.current = { key, t: now };
    if (role !== 'headmenu') {
      setMenu(null);
    }
    if (ev.button === 1 || space) {
      startPan(ev, false);
      return;
    }
    if (ev.button !== 0) {
      return;
    }
    const capture = () => ev.currentTarget.setPointerCapture(ev.pointerId);
    const id = t?.dataset.id ?? '';
    switch (role) {
      case 'step': {
        const i = Number(t!.dataset.i);
        if (dbl) {
          startEdit(i);
        } else {
          setSel(i);
        }
        return;
      }
      case 'head':
        if (dbl) {
          setEditing({ kind: 'head', id, isNew: false });
          return;
        }
        setDrag({ mode: 'head', id, x0: p.x, dx: 0, moved: false });
        capture();
        return;
      case 'headmenu':
        setSel(null);
        setHover(null);
        setMenu((m) => (m?.kind === 'participant' && m.id === id ? null : { kind: 'participant', id, confirm: false, error: '' }));
        return;
      case 'ghosthead':
        addParticipant();
        return;
      case 'lane': {
        setSel(null);
        const start = { x: p.x, y: Math.max(ROWS_TOP - 8, p.y) };
        setDrag({ mode: 'message', from: id, start, p });
        capture();
        return;
      }
      case 'plus':
        setHover(null);
        setMenu({ kind: 'insert', idx: Number(t!.dataset.idx), y: Number(t!.dataset.y) });
        return;
      case 'grip': {
        const i = Number(t!.dataset.i);
        setSel(i);
        setDrag({ mode: 'reorder', i, target: null });
        capture();
        return;
      }
      default:
        startPan(ev, true);
    }
  };

  const updateHover = (p: Point, target: Element) => {
    const r = target.closest<HTMLElement | SVGElement>('[data-role]');
    const role = r?.dataset.role;
    if (role === 'plus' || role === 'grip') {
      return;
    }
    const lay = layoutRef.current;
    let h: Hover | null = null;
    if (role === 'lane') {
      h = { kind: 'dot', x: laneX(indexOf(r!.dataset.id ?? '')), y: Math.round(Math.max(ROWS_TOP - 8, p.y)) };
    } else if (
      role !== 'head' && role !== 'headmenu' && role !== 'ghosthead' &&
      p.y >= ROWS_TOP - 12 && p.x >= 0 && p.x <= lay.width && p.y <= lay.last + 12
    ) {
      const b = nearestBoundary(lay, p.y);
      if (b.d < 8) {
        h = { kind: 'plus', y: b.y, idx: b.idx };
      } else {
        const i = rowAt(lay, p.y);
        const s = i === null ? undefined : dataRef.current.steps[i];
        if (i !== null && (s?.type === 'message' || s?.type === 'note')) {
          h = { kind: 'grip', i, y: lay.rows[i].cy };
        }
      }
    }
    setHover((old) => (JSON.stringify(old) === JSON.stringify(h) ? old : h));
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) {
      const target = ev.target as Element;
      if (!target.closest(FLOATING_UI)) {
        updateHover(toWorld(ev), target);
      }
      return;
    }
    const p = toWorld(ev);
    switch (d.mode) {
      case 'pan': {
        const dx = ev.clientX - d.sx;
        const dy = ev.clientY - d.sy;
        if (!d.moved && Math.hypot(dx, dy) < 4) {
          return;
        }
        viewTouched.current = true;
        setDrag({ ...d, moved: true });
        setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        return;
      }
      case 'message':
        setDrag({ ...d, p });
        return;
      case 'head': {
        const dx = p.x - d.x0;
        setDrag({ ...d, dx, moved: d.moved || Math.abs(dx) > 4 });
        return;
      }
      case 'reorder':
        setDrag({ ...d, target: nearestBoundary(layoutRef.current, p.y) });
        return;
    }
  };

  const endDrag = (cancelled: boolean) => {
    const d = dragRef.current;
    if (!d) {
      return;
    }
    setDrag(null);
    if (cancelled) {
      return;
    }
    const cur = dataRef.current;
    switch (d.mode) {
      case 'pan':
        if (!d.moved && d.clickDeselects) {
          setSel(null);
        }
        return;
      case 'message': {
        const k = laneAt(cur.participants.length, d.p.x);
        if (k === null) {
          return;
        }
        const to = cur.participants[k].id;
        if (to === d.from && Math.hypot(d.p.x - d.start.x, d.p.y - d.start.y) < SELF_MIN) {
          return;
        }
        const idx = nearestBoundary(layoutRef.current, d.start.y).idx;
        commit(edit.insertSteps(cur, idx, [
          { type: 'message', from: d.from, to, arrow: 'solidArrow', text: to === d.from ? 'think' : 'message' },
        ]));
        startEdit(idx);
        return;
      }
      case 'head': {
        if (!d.moved) {
          return;
        }
        const k = indexOf(d.id);
        commit(edit.moveParticipant(cur, k, Math.round((laneX(k) + d.dx - laneX(0)) / LANE_W)));
        return;
      }
      case 'reorder': {
        const r = d.target ? edit.moveStepTo(cur, d.i, d.target.idx) : null;
        if (r) {
          commit(r.data);
          setSel(r.index);
        }
        return;
      }
    }
  };

  // ---------------------------------------------------------------- keyboard

  const onKeyDown = useEffectEvent((ev: KeyboardEvent) => {
    if (invalid || help || isTyping(ev)) {
      return;
    }
    const mod = ev.metaKey || ev.ctrlKey;
    const key = ev.key;
    if (key === ' ') {
      ev.preventDefault();
      setSpace(true);
      return;
    }
    if (mod && key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }
    if (mod && key.toLowerCase() === 'y') {
      ev.preventDefault();
      redo();
      return;
    }
    if (mod) {
      return;
    }
    const steps = dataRef.current.steps;
    if (key === '?') {
      setHelp(true);
    } else if (key === '!' || (ev.shiftKey && ev.code === 'Digit1')) {
      fitWhole();
    } else if (key === 'Escape') {
      if (dragRef.current) {
        setDrag(null);
      } else if (menu) {
        setMenu(null);
      } else {
        setSel(null);
      }
    } else if ((key === 'Delete' || key === 'Backspace') && sel !== null) {
      ev.preventDefault();
      deleteSelected();
    } else if (key === 'Enter' && sel !== null) {
      ev.preventDefault();
      startEdit(sel);
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      ev.preventDefault();
      const d = key === 'ArrowUp' ? -1 : 1;
      if (ev.altKey) {
        moveSelected(d);
        return;
      }
      let i = sel ?? (d > 0 ? -1 : steps.length);
      do {
        i += d;
      } while (i >= 0 && i < steps.length && !isSelectable(steps[i]));
      if (i >= 0 && i < steps.length) {
        setSel(i);
      }
    }
  });
  const onKeyUp = useEffectEvent((ev: KeyboardEvent) => {
    if (ev.key === ' ') {
      setSpace(false);
    }
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => onKeyDown(e);
    const up = (e: KeyboardEvent) => onKeyUp(e);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ---------------------------------------------------------------- floating UI placement

  const selStep = sel === null ? undefined : data.steps[sel];
  const anchor = sel === null ? null : layout.anchors[sel] ?? null;
  const showBar = !!anchor && isSelectable(selStep) && !editing && !menu && (!drag || drag.mode === 'pan');

  // Centre the bar over the selection, inside the stage; below it when there is no room above.
  useLayoutEffect(() => {
    const el = barRef.current;
    const st = stageRef.current;
    if (!el || !st || !anchor) {
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const sw = st.clientWidth;
    let top = view.y + anchor.top * view.z;
    let transform = 'translate(-50%, calc(-100% - 10px))';
    if (top - h - 12 < 4) {
      top = view.y + anchor.bottom * view.z + 10;
      transform = 'translate(-50%, 0)';
    }
    el.style.left = `${clamp(view.x + anchor.cx * view.z, w / 2 + 8, Math.max(w / 2 + 8, sw - w / 2 - 8))}px`;
    el.style.top = `${top}px`;
    el.style.transform = transform;
  });

  // Keep popovers inside the stage.
  useLayoutEffect(() => {
    const el = popRef.current;
    const st = stageRef.current;
    if (!el || !st || !menu) {
      return;
    }
    const x = menu.kind === 'insert'
      ? view.x + (GUTTER + 2) * view.z
      : view.x + (laneX(Math.max(0, indexOf(menu.id))) - 95) * view.z;
    const y = menu.kind === 'insert' ? view.y + menu.y * view.z + 10 : view.y + (TOP + 56) * view.z;
    el.style.left = `${clamp(x, 8, Math.max(8, st.clientWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${clamp(y, 8, Math.max(8, st.clientHeight - el.offsetHeight - 8))}px`;
  });

  if (invalid) {
    return (
      <ReadOnlyFallback
        content={value}
        message="This sequence diagram uses features the visual editor can't edit without losing them (boxes, create/destroy, links, styling) — edit it as text; the block is left untouched."
      />
    );
  }

  // Where the inline field opens, in diagram units.
  let editBox: { box: Box; align: 'left' | 'center'; initial: string } | null = null;
  if (editing?.kind === 'step') {
    const s = data.steps[editing.i];
    const a = layout.anchors[editing.i];
    if (a && s && (s.type === 'message' || s.type === 'note' || s.type === 'block')) {
      editBox = { box: a.edit, align: a.align, initial: s.type === 'block' ? s.label : s.text };
    }
  } else if (editing?.kind === 'head') {
    const k = indexOf(editing.id);
    const p = data.participants[k];
    if (p) {
      const w = LANE_W - 30;
      editBox = { box: { x: laneX(k) - w / 2, y: p.actor ? TOP + 30 : TOP + 6, w, h: 24 }, align: 'center', initial: p.label };
    }
  }

  const menuParticipant = menu?.kind === 'participant' ? data.participants.find((p) => p.id === menu.id) : undefined;
  const cursor = drag?.mode === 'pan' && drag.moved ? 'grabbing' : space ? 'grab' : undefined;

  return (
    <div className="lv-editor">
      <style>{SEQ_CSS}</style>
      <div className="lv-bar" role="toolbar" aria-label="Sequence diagram">
        <button
          type="button"
          className="lv-btn lv-btn--ghost lv-seq-toggle"
          aria-pressed={data.autonumber}
          title="Number the messages"
          onMouseDown={(e) => { e.preventDefault(); commit({ ...dataRef.current, autonumber: !dataRef.current.autonumber }); }}
        >
          <Icon name="numbered" />Autonumber
        </button>
        <button type="button" className="lv-btn lv-btn--ghost" onMouseDown={(e) => { e.preventDefault(); addParticipant(); }}>
          <Icon name="participant" /><span className="lv-seq-wide">Participant</span>
        </button>
        <button
          type="button"
          className="lv-btn lv-btn--ghost"
          title="Add a message at the end"
          onMouseDown={(e) => { e.preventDefault(); insert(dataRef.current.steps.length, 'message'); }}
        >
          <Icon name="plus" /><span className="lv-seq-wide">Message</span>
        </button>
        <span className="lv-spacer" />
        <IconButton icon="undo" label="Undo" shortcut="⌘Z" disabled={!history.current.canUndo} onPress={undo} />
        <IconButton icon="redo" label="Redo" shortcut="⇧⌘Z" disabled={!history.current.canRedo} onPress={redo} />
        <Separator />
        <IconButton icon="code" label="Mermaid source" pressed={codeOpen} onPress={() => setCodeOpen((o) => !o)} />
        <IconButton icon="help" label="Keyboard shortcuts" shortcut="?" onPress={() => setHelp(true)} />
      </div>

      <div className="lv-body">
        <div
          ref={stageRef}
          className={`lv-stage lv-grid lv-seq-stage${space ? ' lv-seq-space' : ''}`}
          style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${20 * view.z}px ${20 * view.z}px`, cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => endDrag(false)}
          onPointerCancel={() => endDrag(true)}
          onPointerLeave={() => { if (!dragRef.current) { setHover(null); } }}
        >
          <div
            className="lv-seq-world"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, width: layout.width, height: layout.height }}
          >
            <Diagram
              data={data}
              layout={layout}
              measure={measure}
              selected={sel}
              headDrag={drag?.mode === 'head' && drag.moved ? { id: drag.id, dx: drag.dx } : null}
              menuFor={menu?.kind === 'participant' ? menu.id : null}
            />
            <HoverLayer data={data} layout={layout} hover={editing || menu ? null : hover} drag={drag} />
            {editBox && (
              <InlineEditor
                key={editing?.kind === 'step' ? `s${editing.i}` : `h${editing?.id}`}
                box={editBox.box}
                align={editBox.align}
                initial={editBox.initial}
                inputRef={inputRef}
                onCommit={commitEdit}
                onCancel={cancelEdit}
              />
            )}
          </div>

          {showBar && selStep && (
            <div ref={barRef} className="lv-float lv-ctx lv-seq-ctx" role="toolbar" aria-label="Selected step">
              <StepBar
                step={selStep}
                participants={data.participants}
                canMoveUp={sel! > 0}
                canMoveDown={sel! < data.steps.length - 1}
                onStep={(next) => commit(edit.setStep(dataRef.current, sel!, next))}
                onMove={moveSelected}
                onEdit={() => startEdit(sel!)}
                onDelete={deleteSelected}
              />
            </div>
          )}

          {menu && (
            <div ref={popRef} className="lv-float lv-pop lv-seq-pop" role="dialog">
              {menu.kind === 'insert' ? (
                <InsertMenu onPick={(kind) => insert(menu.idx, kind)} />
              ) : menuParticipant ? (
                <ParticipantMenu
                  participant={menuParticipant}
                  index={indexOf(menu.id)}
                  count={data.participants.length}
                  refs={edit.countRefs(data, menu.id)}
                  confirm={menu.confirm}
                  error={menu.error}
                  onKind={(actor) => commit(edit.setParticipant(dataRef.current, menu.id, { actor }))}
                  onRename={() => { setMenu(null); setEditing({ kind: 'head', id: menu.id, isNew: false }); }}
                  onApplyId={(raw) => {
                    const r = edit.checkId(dataRef.current, raw, menu.id);
                    if ('error' in r) {
                      setMenu({ ...menu, error: r.error });
                      return;
                    }
                    commit(edit.renameId(dataRef.current, menu.id, r.id));
                    setMenu({ kind: 'participant', id: r.id, confirm: false, error: '' });
                  }}
                  onMove={(delta) => {
                    const k = indexOf(menu.id);
                    commit(edit.moveParticipant(dataRef.current, k, k + delta));
                  }}
                  onAskDelete={() => setMenu({ ...menu, confirm: true })}
                  onCancelDelete={() => setMenu({ ...menu, confirm: false })}
                  onDelete={() => {
                    commit(edit.removeParticipant(dataRef.current, menu.id));
                    setMenu(null);
                    setSel(null);
                  }}
                />
              ) : null}
            </div>
          )}

          <ZoomControls zoom={view.z} onZoomIn={() => zoomBy(1.2)} onZoomOut={() => zoomBy(1 / 1.2)} onFit={fitWhole} />
          <Hint>
            <HintText
              editing={editing}
              drag={drag}
              hover={hover}
              selected={sel !== null}
              empty={data.participants.length === 0}
            />
          </Hint>
        </div>
        {codeOpen && <CodePane value={value} onClose={() => setCodeOpen(false)} />}
      </div>

      <HelpDialog open={help} title="Sequence diagram shortcuts" rows={SHORTCUTS} onClose={() => setHelp(false)} />
    </div>
  );
}
