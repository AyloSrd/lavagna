import React, { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CanvasImageSource, CanvasImageState, CanvasInsertSource } from '../../shared/messages';
import { insertCanvasImage, saveCanvas, setCanvasImage } from '../hostBridge';
import type { EditorProps } from '../BlockEditorApp';
import { HelpDialog, Hint, IconButton, isTyping, ZoomControls } from '../ui/controls';
import { UndoStack } from '../ui/undoStack';
import { CanvasChooser } from './CanvasChooser';
import { ReadOnlyFallback } from './ReadOnlyFallback';
import { TextOverlay } from './TextOverlay';
import { CanvasStage, HANDLE_GRAB, SELECTION_PAD } from './canvas/CanvasStage';
import { flatten, labelInk, measureText } from './canvas/draw';
import {
  boxFrom,
  bounds,
  center,
  contains,
  detachArrows,
  dist,
  duplicateMarks,
  extendDraft,
  Handle,
  handlePoints,
  isDegenerate,
  linePoints,
  mapMarks,
  moveEndpoint,
  placeImage,
  removeMarks,
  reorder,
  resizeBox,
  restyle,
  topHit,
  translate,
  unionBounds,
} from './canvas/geometry';
import {
  Box,
  COLORS,
  DEFAULT_STYLE,
  isAttachable,
  isLine,
  isShape,
  isStroke,
  lookupIn,
  Mark,
  MarkStyle,
  newMarkId,
  newSeed,
  Point,
  TEXT_LINE_HEIGHT,
  Tool,
} from './canvas/model';
import { ReplaceImageMenu, SaveBar } from './canvas/SaveBar';
import { registerImage } from './canvas/images';
import { HELP_ROWS, HINTS, TOOL_KEYS } from './canvas/shortcuts';
import { StyleBar, StylePatch } from './canvas/StyleBar';
import { ToolRail } from './canvas/ToolRail';
import { fitView, toImage, toScreen, View, zoomAround } from './canvas/viewport';

// Draw-on-image canvas. The block is a markdown image line; its PNG is the
// locked background and marks are drawn on top as LOCAL state only — they stay
// selectable, movable and restylable until "Save into image", which flattens
// background + marks into a NEW PNG in .lavagna/media/ and swaps the link
// (host-side). After the save round-trips, the new image arrives via
// block.update and the marks are cleared — they're baked into it now.

// A 20000x20000 solid PNG compresses to tens of KB but demands ~1.6 GB of
// canvas backing store, and its flattened data URL would be hundreds of MB.
const MAX_IMAGE_EDGE = 8192;
const MAX_IMAGE_PIXELS = 40_000_000;

/** Largest picture the page reads for insertion; the host refuses more anyway. */
const MAX_INSERT_BYTES = 32 * 1024 * 1024;

const tooLarge = (w: number, h: number) => w > MAX_IMAGE_EDGE || h > MAX_IMAGE_EDGE || w * h > MAX_IMAGE_PIXELS;

/** The bytes of a pasted or dropped file, base64 — what the host checks. */
function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Below this stage width the rail moves to the bottom (see CSS). */
const NARROW = 700;

type Drag =
  | { mode: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { mode: 'move'; last: Point; moved: boolean; before: Mark[] }
  | { mode: 'marquee'; start: Point; base: string[] }
  | { mode: 'resize'; handle: Handle; from: Box; orig: Mark[]; before: Mark[] }
  | { mode: 'endpoint'; id: string; index: 0 | 1; before: Mark[] }
  | { mode: 'draw'; id: string; start: Point; before: Mark[] }
  | { mode: 'erase' };

interface Editing {
  id: string;
  kind: 'text' | 'label';
  /** Marks as they were before the edit — what undo goes back to. */
  before: Mark[];
}

const HANDLE_CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};

export function CanvasEditor({
  value,
  imageUri,
  imageState,
}: EditorProps & { imageUri: string | null; imageState: CanvasImageState | null }) {
  const [background, setBackground] = useState<HTMLImageElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [settingImage, setSettingImage] = useState(false);
  const [inserting, setInserting] = useState(false);
  /** A short message in place of the hint, e.g. why an image was refused. */
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [selIds, setSelIds] = useState<string[]>([]);
  const [tool, setToolState] = useState<Tool>('pen');
  const [style, setStyle] = useState<MarkStyle>(DEFAULT_STYLE);
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [attachId, setAttachId] = useState<string | null>(null);
  const [erasing, setErasing] = useState<ReadonlySet<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [cursor, setCursor] = useState('default');
  /** Measured width of the style bar, to keep it inside the stage. */
  const [barWidth, setBarWidth] = useState(0);
  // Undo lives in a ref; this tick re-renders the undo/redo buttons.
  const [, setHistoryTick] = useState(0);

  const history = useRef(new UndoStack<Mark[]>());
  const viewTouched = useRef(false);
  const drag = useRef<Drag | null>(null);
  const stageBox = useRef<HTMLDivElement | null>(null);
  const surface = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  // Inserting awaits the host; by then `marks` in this render is stale.
  const marksRef = useRef<Mark[]>([]);
  marksRef.current = marks;
  const insertingRef = useRef(false);

  const alt = value.match(/^ {0,3}!\[([^\]]*)\]/)?.[1] ?? 'canvas';
  const lookup = useMemo(() => lookupIn(marks), [marks]);
  const selSet = useMemo(() => new Set(selIds), [selIds]);
  const selected = useMemo(() => marks.filter((m) => selSet.has(m.id)), [marks, selSet]);
  const slop = HANDLE_GRAB / view.z;

  // (Re)load the background whenever the image link changes — including after
  // our own Save, whose marks are then baked in and must be cleared.
  useEffect(() => {
    if (!imageUri) {
      setBackground(null);
      // No URI with an empty/missing target is the chooser's job, not an error.
      setLoadFailed(imageState === 'present');
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) {
        return;
      }
      if (
        img.naturalWidth > MAX_IMAGE_EDGE ||
        img.naturalHeight > MAX_IMAGE_EDGE ||
        img.naturalWidth * img.naturalHeight > MAX_IMAGE_PIXELS
      ) {
        setBackground(null);
        setLoadFailed(true);
        setSaving(false);
        return;
      }
      setBackground(img);
      setLoadFailed(false);
      setMarks([]);
      setSelIds([]);
      setEditing(null);
      setSaving(false);
      history.current.clear();
      setHistoryTick((t) => t + 1);
      viewTouched.current = false;
    };
    img.onerror = () => {
      if (!cancelled) {
        setBackground(null);
        setLoadFailed(true);
        setSaving(false);
      }
    };
    img.src = imageUri;
    return () => {
      cancelled = true;
    };
  }, [imageUri, imageState]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // Track the stage's size; the Konva stage is sized to it.
  useEffect(() => {
    const el = stageBox.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [background]);

  // Keep the whole image in view until the user pans or zooms themselves.
  useEffect(() => {
    if (background && size.w > 50 && size.h > 50 && !viewTouched.current) {
      setView(fitView(background.naturalWidth, background.naturalHeight, size.w, size.h, size.w < NARROW));
    }
  }, [background, size]);

  // The bar's width depends on which controls apply; measure it before paint.
  useLayoutEffect(() => {
    const w = barRef.current?.offsetWidth ?? 0;
    if (w && w !== barWidth) {
      setBarWidth(w);
    }
  });

  // --- history ---------------------------------------------------------------
  const record = (before: Mark[]) => {
    history.current.record(before);
    setHistoryTick((t) => t + 1);
  };
  /** Replace the marks as one undoable step. */
  const change = (next: Mark[]) => {
    record(marks);
    setMarks(next);
  };
  const undo = () => {
    const prev = history.current.undo(marks);
    if (prev) {
      setMarks(prev);
      setSelIds((ids) => ids.filter((id) => prev.some((m) => m.id === id)));
      setHistoryTick((t) => t + 1);
    }
  };
  const redo = () => {
    const next = history.current.redo(marks);
    if (next) {
      setMarks(next);
      setSelIds((ids) => ids.filter((id) => next.some((m) => m.id === id)));
      setHistoryTick((t) => t + 1);
    }
  };

  // --- image ------------------------------------------------------------------
  /** Set the canvas image; the result arrives as a block.update from the host. */
  const chooseImage = async (source: CanvasImageSource) => {
    if (settingImage || saving) {
      return;
    }
    setReplaceOpen(false);
    setSettingImage(true);
    const res = await setCanvasImage(source, alt);
    setSettingImage(false);
    if (!res.ok && res.message) {
      console.error('[lavagna] set canvas image failed:', res.message);
    }
  };

  /**
   * Place a picture on top of the image, shrunk to fit inside it, centred on
   * `at` (image coordinates) or on the canvas. It is a mark like any other —
   * selectable, movable, resizable — until Save bakes it in.
   */
  const insertImage = async (source: CanvasInsertSource, at?: Point) => {
    // A ref, not the `inserting` state: two pastes in one tick both see the
    // state as it was rendered.
    if (!background || insertingRef.current || saving || editing) {
      return;
    }
    insertingRef.current = true;
    setReplaceOpen(false);
    setInserting(true);
    try {
      const res = await insertCanvasImage(source);
      if (!res.ok || !res.dataUri) {
        if (res.message) {
          setNotice(res.message);
        }
        return;
      }
      const { asset, image } = await registerImage(res.dataUri);
      if (tooLarge(image.naturalWidth, image.naturalHeight)) {
        setNotice(`That image is too large to add (the limit is ${MAX_IMAGE_EDGE} pixels a side).`);
        return;
      }
      const box = placeImage(
        { w: image.naturalWidth, h: image.naturalHeight },
        { w: background.naturalWidth, h: background.naturalHeight },
        at,
      );
      const m: Mark = { ...style, id: newMarkId(), seed: newSeed(), type: 'image', asset, ...box };
      const before = marksRef.current;
      record(before);
      setMarks([...before, m]);
      setTool('select', true);
      setSelIds([m.id]);
    } catch {
      setNotice('That image could not be read.');
    } finally {
      insertingRef.current = false;
      setInserting(false);
    }
  };

  /** A pasted or dropped file: read here, checked by the host, then placed. */
  const insertFile = async (file: File, at?: Point) => {
    if (file.size > MAX_INSERT_BYTES) {
      setNotice('That image is too large to add (the limit is 32 MB).');
      return;
    }
    try {
      await insertImage({ kind: 'data', dataBase64: await fileBase64(file) }, at);
    } catch {
      setNotice('That image could not be read.');
    }
  };

  const imageFile = (files: FileList | null | undefined): File | undefined =>
    files ? Array.from(files).find((f) => f.type.startsWith('image/')) : undefined;

  const save = () => {
    // While a text box is open its text isn't in the marks yet, so flattening
    // now would silently drop it. Commit first (Enter, or click away).
    if (saving || editing || marks.length === 0 || !background) {
      return;
    }
    const base64 = flatten(background, marks, lookup);
    if (!base64) {
      // Tainted or too large: forwarding garbage gave a confusing host error.
      console.error('[lavagna] could not export the canvas (tainted or too large)');
      return;
    }
    setSaving(true);
    setSelIds([]);
    saveCanvas(base64, alt);
    // `saving` clears when the flattened image arrives via block.update
    // (or a writeFailed banner shows up).
  };

  // --- selection edits ----------------------------------------------------
  const deleteSelected = () => {
    if (selIds.length) {
      change(removeMarks(marks, selSet));
      setSelIds([]);
    }
  };
  const duplicateSelected = () => {
    if (!selected.length) {
      return;
    }
    const copies = duplicateMarks(selected, marks, 16, newMarkId, newSeed);
    change([...marks, ...copies]);
    setSelIds(copies.map((c) => c.id));
  };
  const nudge = (dx: number, dy: number) => {
    const moved = detachArrows(marks, (id) => !selSet.has(id), (m) => selSet.has(m.id));
    change(moved.map((m) => (selSet.has(m.id) ? translate(m, dx, dy) : m)));
  };
  const reorderSelected = (to: 'front' | 'back') => {
    if (selIds.length) {
      change(reorder(marks, selSet, to));
    }
  };
  const applyStyle = (patch: StylePatch) => {
    setStyle((s) => ({ ...s, ...patch }));
    if (selected.length) {
      change(marks.map((m) => (selSet.has(m.id) ? restyle(m, patch, measureText) : m)));
    }
  };

  const setTool = (t: Tool, keepSelection = false) => {
    setToolState(t);
    setReplaceOpen(false);
    if (t !== 'select' && !keepSelection) {
      setSelIds([]);
    }
  };

  // --- text -------------------------------------------------------------------
  const startEditing = (m: Mark, before: Mark[] = marks) => {
    setSelIds([m.id]);
    setEditing({ id: m.id, kind: m.type === 'text' ? 'text' : 'label', before });
  };
  const newText = (p: Point) => {
    const fontSize = style.fontSize;
    const m: Mark = {
      ...style, id: newMarkId(), seed: newSeed(), type: 'text', text: '',
      x: p.x, y: p.y - (fontSize * TEXT_LINE_HEIGHT) / 2, ...measureText('', fontSize),
    };
    setMarks([...marks, m]);
    startEditing(m, marks);
  };
  const commitText = (raw: string) => {
    if (!editing) {
      return;
    }
    const text = raw.replace(/\s+$/, '');
    const { id, kind, before } = editing;
    setEditing(null);
    let next: Mark[];
    if (kind === 'text') {
      // Empty text is not worth keeping — drop the mark instead.
      next = text
        ? marks.map((m) => (m.id === id && m.type === 'text' ? { ...m, text, ...measureText(text, m.fontSize) } : m))
        : removeMarks(marks, new Set([id]));
    } else {
      next = marks.map((m) => (m.id === id && isShape(m) ? { ...m, label: text } : m));
    }
    setMarks(next);
    if (JSON.stringify(next) !== JSON.stringify(before)) {
      record(before);
    }
    if (!next.some((m) => m.id === id)) {
      setSelIds([]);
    }
    if (tool === 'text') {
      setTool('select', true);
    }
  };
  const cancelText = () => {
    if (!editing) {
      return;
    }
    // Escape puts things back as they were — a brand-new text disappears.
    setMarks(editing.before);
    setSelIds((ids) => ids.filter((id) => editing.before.some((m) => m.id === id)));
    setEditing(null);
  };

  // --- pointer --------------------------------------------------------------
  const pointAt = (e: { clientX: number; clientY: number }): { screen: Point; image: Point } => {
    const r = stageBox.current!.getBoundingClientRect();
    const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
    return { screen, image: toImage(view, screen.x, screen.y) };
  };

  /** A resize handle or line endpoint of the current selection under `p`. */
  const controlAt = (p: Point): { handle: Handle } | { endpoint: 0 | 1 } | null => {
    if (!selected.length || tool !== 'select') {
      return null;
    }
    const only = selected.length === 1 ? selected[0] : null;
    if (only && isLine(only)) {
      const [a, b] = linePoints(only, lookup);
      const r = 10 / view.z;
      return dist(p, a) <= r ? { endpoint: 0 } : dist(p, b) <= r ? { endpoint: 1 } : null;
    }
    const handles = handlePoints(unionBounds(selected, lookup), SELECTION_PAD / view.z);
    for (const [k, q] of Object.entries(handles) as [Handle, Point][]) {
      if (Math.abs(p.x - q.x) <= slop && Math.abs(p.y - q.y) <= slop) {
        return { handle: k };
      }
    }
    return null;
  };

  const attachTargetAt = (p: Point, exclude: (string | undefined)[]) =>
    topHit(marks, p, slop, (m) => isAttachable(m) && !exclude.includes(m.id))?.id ?? null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // An open text box commits on this same mousedown; act on the next one.
    if (editing || !background) {
      return;
    }
    setReplaceOpen(false);
    e.currentTarget.setPointerCapture(e.pointerId);
    const { screen, image: p } = pointAt(e);
    if (e.button === 1 || spaceDown || tool === 'hand') {
      drag.current = { mode: 'pan', sx: screen.x, sy: screen.y, vx: view.x, vy: view.y };
      setCursor('grabbing');
      return;
    }
    if (e.button !== 0) {
      return;
    }

    if (tool === 'select') {
      const control = controlAt(p);
      if (control && 'endpoint' in control) {
        drag.current = { mode: 'endpoint', id: selected[0].id, index: control.endpoint, before: marks };
        return;
      }
      if (control) {
        drag.current = { mode: 'resize', handle: control.handle, from: unionBounds(selected, lookup), orig: selected, before: marks };
        return;
      }
      const hit = topHit(marks, p, slop);
      if (hit) {
        if (e.shiftKey) {
          setSelIds(selSet.has(hit.id) ? selIds.filter((id) => id !== hit.id) : [...selIds, hit.id]);
        } else if (!selSet.has(hit.id)) {
          setSelIds([hit.id]);
        }
        drag.current = { mode: 'move', last: p, moved: false, before: marks };
      } else {
        const base = e.shiftKey ? selIds : [];
        setSelIds(base);
        drag.current = { mode: 'marquee', start: p, base };
        setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
      }
      return;
    }
    if (tool === 'eraser') {
      drag.current = { mode: 'erase' };
      const hit = topHit(marks, p, slop);
      setErasing(new Set(hit ? [hit.id] : []));
      return;
    }
    if (tool === 'text') {
      newText(p);
      return;
    }

    const base = { ...style, id: newMarkId(), seed: newSeed() };
    let m: Mark;
    if (tool === 'rect' || tool === 'ellipse') {
      m = { ...base, type: tool, x: p.x, y: p.y, w: 0, h: 0, label: '' };
    } else if (tool === 'line' || tool === 'arrow') {
      const start = tool === 'arrow' ? attachTargetAt(p, []) : null;
      m = { ...base, type: tool, points: [p, p], ...(start ? { start } : {}) };
    } else {
      m = { ...base, type: tool, points: [p] };
    }
    setMarks([...marks, m]);
    setSelIds([]);
    drag.current = { mode: 'draw', id: m.id, start: p, before: marks };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!background) {
      return;
    }
    const { screen, image: p } = pointAt(e);
    const d = drag.current;
    if (!d) {
      if (spaceDown || tool === 'hand') {
        setCursor('grab');
      } else if (tool !== 'select') {
        setCursor(tool === 'text' ? 'text' : 'crosshair');
      } else {
        const control = controlAt(p);
        setCursor(control ? ('handle' in control ? HANDLE_CURSOR[control.handle] : 'pointer') : topHit(marks, p, slop) ? 'move' : 'default');
      }
      return;
    }
    switch (d.mode) {
      case 'pan':
        viewTouched.current = true;
        setView((v) => ({ ...v, x: d.vx + screen.x - d.sx, y: d.vy + screen.y - d.sy }));
        break;
      case 'move': {
        const dx = p.x - d.last.x;
        const dy = p.y - d.last.y;
        if (!d.moved) {
          if (Math.hypot(dx, dy) * view.z < 3) {
            return;
          }
          d.moved = true;
          setDragging(true);
        }
        d.last = p;
        // An arrow moved without its shape lets go of it; unselected arrows
        // attached to moving shapes simply follow.
        setMarks((prev) =>
          detachArrows(prev, (id) => !selSet.has(id), (m) => selSet.has(m.id))
            .map((m) => (selSet.has(m.id) ? translate(m, dx, dy) : m)),
        );
        break;
      }
      case 'marquee': {
        const box = boxFrom(d.start, p);
        setMarquee(box);
        const inside = marks.filter((m) => contains(box, bounds(m, lookup))).map((m) => m.id);
        setSelIds([...new Set([...d.base, ...inside])]);
        break;
      }
      case 'resize': {
        // Text always keeps its proportions; a lone image keeps them unless
        // Shift frees it; everything else is free unless Shift locks it.
        const only = d.orig.length === 1 ? d.orig[0].type : null;
        const keepRatio = only === 'text' || (only === 'image' ? !e.shiftKey : e.shiftKey);
        const mapped = new Map(
          mapMarks(d.orig, d.from, resizeBox(d.from, d.handle, p, keepRatio), measureText).map((m) => [m.id, m]),
        );
        setDragging(true);
        setMarks((prev) => prev.map((m) => mapped.get(m.id) ?? m));
        break;
      }
      case 'endpoint': {
        const line = marks.find((m) => m.id === d.id);
        if (!line || !isLine(line)) {
          return;
        }
        setDragging(true);
        setMarks((prev) => prev.map((m) => (m.id === d.id && isLine(m) ? moveEndpoint(m, d.index, p) : m)));
        if (line.type === 'arrow') {
          setAttachId(attachTargetAt(p, [line.id, d.index === 0 ? line.end : line.start]));
        }
        break;
      }
      case 'draw': {
        setMarks((prev) => prev.map((m) => (m.id === d.id ? extendDraft(m, d.start, p, e.shiftKey, view.z) : m)));
        const draft = marks.find((m) => m.id === d.id);
        if (draft?.type === 'arrow') {
          setAttachId(attachTargetAt(p, [draft.start]));
        }
        break;
      }
      case 'erase': {
        const hit = topHit(marks, p, slop);
        if (hit && !erasing.has(hit.id)) {
          setErasing(new Set([...erasing, hit.id]));
        }
        break;
      }
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    setMarquee(null);
    setAttachId(null);
    if (!d) {
      return;
    }
    switch (d.mode) {
      case 'pan':
        setCursor(spaceDown || tool === 'hand' ? 'grab' : 'default');
        break;
      case 'move':
        if (d.moved) {
          record(d.before);
        }
        break;
      case 'resize':
        record(d.before);
        break;
      case 'endpoint': {
        if (attachId) {
          setMarks((prev) => prev.map((m) => (m.id === d.id && isLine(m) ? { ...m, [d.index === 0 ? 'start' : 'end']: attachId } : m)));
        }
        record(d.before);
        break;
      }
      case 'draw': {
        const draft = marks.find((m) => m.id === d.id);
        if (!draft || isDegenerate(draft, view.z)) {
          setMarks(d.before);
          return;
        }
        if (draft.type === 'arrow' && attachId && attachId !== draft.start) {
          setMarks((prev) => prev.map((m) => (m.id === d.id && m.type === 'arrow' ? { ...m, end: attachId } : m)));
        }
        record(d.before);
        // Shapes and arrows come back selected so their style can be tweaked
        // at once; pen and highlighter stay armed for the next stroke.
        if (!isStroke(draft)) {
          setSelIds([draft.id]);
          setTool('select', true);
        }
        break;
      }
      case 'erase':
        if (erasing.size) {
          change(removeMarks(marks, erasing));
          setSelIds((ids) => ids.filter((id) => !erasing.has(id)));
        }
        setErasing(new Set());
        break;
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== 'select' || editing || !background) {
      return;
    }
    const { image: p } = pointAt(e);
    const hit = topHit(marks, p, slop);
    if (hit && (hit.type === 'text' || isShape(hit))) {
      startEditing(hit);
    } else if (!hit) {
      newText(p);
    }
  };

  // Wheel must be non-passive to stop the page scrolling, so it's attached by hand.
  const onWheel = useEffectEvent((e: WheelEvent) => {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : 1;
    viewTouched.current = true;
    if (e.ctrlKey || e.metaKey) {
      const { screen } = pointAt(e);
      setView((v) => zoomAround(v, screen.x, screen.y, v.z * Math.exp(-e.deltaY * k * 0.01)));
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX * k, y: v.y - e.deltaY * k }));
    }
  });
  useEffect(() => {
    const el = surface.current;
    if (!el) {
      return;
    }
    const handler = (e: WheelEvent) => onWheel(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [background]);

  const zoomBy = (factor: number) => {
    viewTouched.current = true;
    setView((v) => zoomAround(v, size.w / 2, size.h / 2, v.z * factor));
  };
  const fit = () => {
    viewTouched.current = false;
    if (background) {
      setView(fitView(background.naturalWidth, background.naturalHeight, size.w, size.h, size.w < NARROW));
    }
  };

  // --- keyboard ---------------------------------------------------------------
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (!background || editing || isTyping(e)) {
      return;
    }
    const key = e.key.toLowerCase();
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === ' ') {
      e.preventDefault();
      setSpaceDown(true);
      setCursor('grab');
      return;
    }
    if (mod) {
      const actions: Record<string, () => void> = {
        z: () => (e.shiftKey ? redo() : undo()),
        y: redo,
        s: save,
        d: duplicateSelected,
        a: () => { setTool('select', true); setSelIds(marks.map((m) => m.id)); },
      };
      if (actions[key]) {
        e.preventDefault();
        actions[key]();
      }
      return;
    }
    if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      deleteSelected();
    } else if (key === 'escape') {
      setReplaceOpen(false);
      setSelIds([]);
      setTool('select');
    } else if (key === 'enter') {
      const only = selected.length === 1 ? selected[0] : null;
      if (only && (only.type === 'text' || isShape(only))) {
        e.preventDefault();
        startEditing(only);
      }
    } else if (key.startsWith('arrow') && selected.length) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      const [dx, dy] = ({ arrowleft: [-s, 0], arrowright: [s, 0], arrowup: [0, -s], arrowdown: [0, s] } as Record<string, number[]>)[key];
      nudge(dx, dy);
    } else if ((e.key === ']' || e.key === '[') && selected.length) {
      e.preventDefault();
      reorderSelected(e.key === ']' ? 'front' : 'back');
    } else if (key === 'i') {
      void insertImage({ kind: 'dialog' });
    } else if (e.key === '?') {
      setHelpOpen(true);
    } else if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) {
      fit();
    } else if (TOOL_KEYS[key]) {
      setTool(TOOL_KEYS[key]);
    }
  });
  const onKeyUp = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === ' ') {
      setSpaceDown(false);
      setCursor(tool === 'hand' ? 'grab' : 'default');
    }
  });
  // ⌘V with an image on the clipboard places it; text fields keep their paste.
  const onPaste = useEffectEvent((e: ClipboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (!background || editing || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) {
      return;
    }
    const file = imageFile(e.clipboardData?.files);
    if (file) {
      e.preventDefault();
      void insertFile(file);
    }
  });
  useEffect(() => {
    const paste = (e: ClipboardEvent) => onPaste(e);
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, []);

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

  // --- render -----------------------------------------------------------------
  // No image yet (or the link is broken): start blank, or choose a file.
  if (imageState === 'empty' || imageState === 'missing') {
    return (
      <CanvasChooser
        busy={settingImage}
        missing={imageState === 'missing'}
        onBlank={() => void chooseImage('blank')}
        onPick={() => void chooseImage('dialog')}
      />
    );
  }
  if (loadFailed) {
    return (
      <ReadOnlyFallback
        content={value}
        message="This image can't be loaded (unsupported or remote target) — fix the link in the file."
      />
    );
  }
  if (!background) {
    return <p style={{ padding: 16, fontSize: 12, opacity: 0.7 }}>Loading image…</p>;
  }

  const drawingTool = tool !== 'select' && tool !== 'hand' && tool !== 'eraser';
  const showStyleBar = !dragging && !editing && !saving && (selected.length > 0 ? tool === 'select' : drawingTool);
  const styleSource: MarkStyle = selected[0] ?? style;
  const selBox = selected.length ? unionBounds(selected, lookup) : null;
  const barHalf = barWidth / 2;
  const top = selBox ? toScreen(view, selBox.x + selBox.w / 2, selBox.y) : { x: 0, y: 0 };
  const below = !!selBox && top.y < 70;
  const anchor = selBox && below ? toScreen(view, selBox.x + selBox.w / 2, selBox.y + selBox.h) : top;

  const editingMark = editing ? marks.find((m) => m.id === editing.id) : undefined;
  const editorAt = editingMark
    ? editing!.kind === 'text'
      ? { ...toScreen(view, (editingMark as Box).x, (editingMark as Box).y), align: 'left' as const }
      : { ...toScreen(view, center(editingMark as Box).x, center(editingMark as Box).y), align: 'center' as const }
    : null;

  return (
    <div className="lv-canvas">
      <style>{CANVAS_CSS}</style>
      <div className="lv-canvas-stage lv-grid" ref={stageBox}>
        <div
          ref={surface}
          className="lv-canvas-surface"
          style={{ cursor: spaceDown && !drag.current ? 'grab' : cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            const file = imageFile(e.dataTransfer.files);
            if (file) {
              e.preventDefault();
              void insertFile(file, pointAt(e).image);
            }
          }}
        >
          {size.w > 0 && (
            <CanvasStage
              width={size.w}
              height={size.h}
              view={view}
              image={background}
              marks={marks}
              lookup={lookup}
              selected={selected}
              hideTextOf={editing?.id ?? null}
              fading={erasing}
              marquee={marquee}
              attachTarget={attachId ? lookup(attachId) ?? null : null}
              showHandles={!editing && !saving && (tool === 'select' || dragging)}
            />
          )}
        </div>

        <ToolRail
          tool={tool}
          onTool={(t) => setTool(t)}
          onInsertImage={() => void insertImage({ kind: 'dialog' })}
          inserting={inserting || saving}
          replaceOpen={replaceOpen}
          onReplaceImage={() => setReplaceOpen((o) => !o)}
        />
        {replaceOpen && <ReplaceImageMenu unsaved={marks.length} busy={settingImage || saving} onChoose={(s) => void chooseImage(s)} />}

        {showStyleBar && (
          <StyleBar
            style={styleSource}
            types={selected.length ? selected.map((m) => m.type) : [tool as Mark['type']]}
            selection={selected.length > 0}
            placement={{
              docked: !selBox,
              left: Math.max(barHalf + 8, Math.min(size.w - barHalf - 8, anchor.x)),
              top: anchor.y,
              below,
            }}
            barRef={barRef}
            onChange={applyStyle}
            onDuplicate={duplicateSelected}
            onDelete={deleteSelected}
            onReorder={reorderSelected}
          />
        )}

        <div className="lv-float lv-canvas-history">
          <IconButton icon="undo" label="Undo" shortcut="⌘Z" disabled={!history.current.canUndo} onPress={undo} />
          <IconButton icon="redo" label="Redo" shortcut="⇧⌘Z" disabled={!history.current.canRedo} onPress={redo} />
          <IconButton icon="help" label="Keyboard shortcuts" shortcut="?" onPress={() => setHelpOpen(true)} />
        </div>

        <ZoomControls zoom={view.z} onZoomIn={() => zoomBy(1.2)} onZoomOut={() => zoomBy(1 / 1.2)} onFit={fit} />
        <Hint>{notice ?? (inserting ? 'Adding the image…' : HINTS[tool === 'select' && selected.length ? 'selected' : tool])}</Hint>
        <SaveBar
          count={marks.length}
          saving={saving}
          editingText={!!editing}
          onDiscard={() => { change([]); setSelIds([]); }}
          onSave={save}
        />

        {editing && editingMark && editorAt && (
          <TextOverlay
            key={editing.id}
            x={editorAt.x}
            y={editorAt.y}
            align={editorAt.align}
            fontSize={editingMark.fontSize * view.z}
            color={editing.kind === 'label' ? labelInk(editingMark) : COLORS[editingMark.color]}
            initialText={editingMark.type === 'text' ? editingMark.text : isShape(editingMark) ? editingMark.label : ''}
            onCommit={commitText}
            onCancel={cancelText}
          />
        )}
      </div>
      <HelpDialog open={helpOpen} title="Canvas shortcuts" rows={HELP_ROWS} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

const CANVAS_CSS = `
.lv-canvas { position: relative; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.lv-canvas-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; }
.lv-canvas-surface { position: absolute; inset: 0; touch-action: none; }
.lv-canvas-rail {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%); z-index: 10;
  display: flex; flex-direction: column; gap: 2px; padding: 4px;
}
.lv-canvas-rail .lv-icon { width: 32px; height: 32px; }
.lv-canvas-replace { left: 58px; top: 50%; transform: translateY(-50%); }
.lv-canvas-replace button:disabled { opacity: 0.5; cursor: default; }
.lv-canvas-warn { margin: 4px 8px; max-width: 220px; font-size: 11.5px; color: var(--vscode-descriptionForeground); }
.lv-canvas-docked { top: 12px; left: 50%; transform: translateX(-50%); }
.lv-canvas-history { position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; gap: 2px; padding: 2px; }
.lv-canvas-savebar { position: absolute; right: 12px; bottom: 12px; z-index: 10; display: flex; align-items: center; gap: 6px; padding: 4px 4px 4px 12px; }
.lv-canvas-count { display: flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; color: var(--vscode-descriptionForeground); }
.lv-canvas-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-editorWarning-foreground, #cca700); }
@media (max-width: ${NARROW}px) {
  .lv-canvas-rail { top: auto; bottom: 8px; left: 8px; right: 8px; transform: none; flex-direction: row; overflow-x: auto; }
  .lv-canvas-rail .lv-sep--h { width: 1px; height: auto; margin: 4px 3px; }
  .lv-canvas-replace { left: 8px; top: auto; bottom: 56px; transform: none; }
  .lv-canvas-history { top: 8px; left: 8px; right: auto; }
  .lv-canvas-savebar { top: 8px; right: 8px; bottom: auto; }
  .lv-canvas-count-text { display: none; }
  .lv-canvas-docked { top: 52px; }
  .lv-canvas .lv-zoom { display: none; }
}
`;
