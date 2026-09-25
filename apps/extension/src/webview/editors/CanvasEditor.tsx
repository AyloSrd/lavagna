import React, { useEffect, useRef, useState } from 'react';
import {
  Stage,
  Layer,
  Rect,
  Ellipse,
  Line,
  Arrow,
  Text as KonvaText,
  Image as KonvaImage,
  Transformer,
} from 'react-konva';
import type Konva from 'konva';
import type { CanvasImageSource, CanvasImageState } from '../../shared/messages';
import { saveCanvas, setCanvasImage } from '../hostBridge';
import type { EditorProps } from '../BlockEditorApp';
import { CanvasChooser } from './CanvasChooser';
import { ReadOnlyFallback } from './ReadOnlyFallback';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TextOverlay } from './TextOverlay';

// Draw-on-image canvas. The block is a markdown image line; its PNG is the
// locked background layer and strokes are drawn on top as LOCAL state only.
// Nothing touches the document until "Save", which flattens background +
// strokes into a NEW PNG in .lavagna/media/ and swaps the link (host-side).
// After the save round-trips, the new image arrives via block.update and the
// strokes are cleared — they're baked into the background now.

const COLORS = ['#1e1e1e', '#e02424', '#2563eb', '#16a34a', '#f59e0b'];

type Tool = 'select' | 'pen' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text';

interface Base { id: string; stroke: string; strokeWidth: number; x: number; y: number; }
type Shape =
  | (Base & { type: 'rect'; width: number; height: number; fill?: string })
  | (Base & { type: 'ellipse'; radiusX: number; radiusY: number; fill?: string })
  | (Base & { type: 'line' | 'arrow' | 'pen'; points: number[] })
  // `stroke` carries the colour, as for every other shape; Konva Text paints it as `fill`.
  | (Base & { type: 'text'; text: string; fontSize: number });

const TOOLS: { key: Tool; label: string }[] = [
  { key: 'select', label: '▲ Select' },
  { key: 'pen', label: '✏ Pen' },
  { key: 'rect', label: '▭ Rect' },
  { key: 'ellipse', label: '◯ Ellipse' },
  { key: 'line', label: '╱ Line' },
  { key: 'arrow', label: '↗ Arrow' },
  { key: 'text', label: 'T Text' },
];

const FONT_SIZES = [12, 16, 20, 28, 40, 56];

const BTN: React.CSSProperties = {
  background: 'var(--vscode-button-secondaryBackground, #3a3d41)',
  color: 'var(--vscode-button-secondaryForeground, #ccc)',
  border: '1px solid var(--vscode-panel-border, #555)',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: '0.76em',
  cursor: 'pointer',
};

let seq = 0;
const nextId = () => `s${++seq}`;

// A 20000x20000 solid PNG compresses to tens of KB but demands ~1.6 GB of
// canvas backing store, and its flattened data URL would be hundreds of MB.
const MAX_IMAGE_EDGE = 8192;
const MAX_IMAGE_PIXELS = 40_000_000;

export function CanvasEditor({
  value,
  imageUri,
  imageState,
}: EditorProps & { imageUri: string | null; imageState: CanvasImageState | null }) {
  const [background, setBackground] = useState<HTMLImageElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [settingImage, setSettingImage] = useState(false);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[1]);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [fill, setFill] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fontSize, setFontSize] = useState(20);
  /** Id of the text shape currently being typed into, if any. */
  const [editingId, setEditingId] = useState<string | null>(null);

  const stageRef = useRef<Konva.Stage | null>(null);
  const trRef = useRef<Konva.Transformer | null>(null);
  const drawingId = useRef<string | null>(null);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;

  const alt = value.match(/^ {0,3}!\[([^\]]*)\]/)?.[1] ?? 'canvas';

  // (Re)load the background whenever the image link changes — including after
  // our own Save, whose strokes are then baked in and must be cleared.
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
      setShapes([]);
      setSelectedId(null);
      setSaving(false);
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

  // Attach the resize transformer to the selected rect/ellipse.
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) { return; }
    const sel = shapes.find(s => s.id === selectedId);
    const node = selectedId && (sel?.type === 'rect' || sel?.type === 'ellipse')
      ? stage.findOne<Konva.Node>(`#${selectedId}`)
      : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, shapes, tool]);

  /** Set the canvas image; the result arrives as a block.update from the host. */
  const chooseImage = async (source: CanvasImageSource) => {
    if (settingImage || saving) {
      return;
    }
    setSettingImage(true);
    const res = await setCanvasImage(source, alt);
    setSettingImage(false);
    if (!res.ok && res.message) {
      console.error('[lavagna] set canvas image failed:', res.message);
    }
  };

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

  const width = background.naturalWidth;
  const height = background.naturalHeight;

  const pointer = () => stageRef.current?.getPointerPosition() ?? null;

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === 'select') {
      if (e.target === e.target.getStage() || e.target.name() === 'bg') { setSelectedId(null); }
      return;
    }
    const p = pointer();
    if (!p) { return; }
    if (tool === 'text') {
      // Place an empty text shape and open the editor on it right away; it is
      // discarded if nothing gets typed. No drag phase, so drawingId stays null.
      if (editingId) { return; }
      const id = nextId();
      setShapes(s => [...s, { id, type: 'text', x: p.x, y: p.y, stroke: color, strokeWidth, text: '', fontSize }]);
      setSelectedId(null);
      setEditingId(id);
      return;
    }
    const id = nextId();
    startPt.current = p;
    drawingId.current = id;
    const base = { id, stroke: color, strokeWidth };
    if (tool === 'rect') { setShapes(s => [...s, { ...base, type: 'rect', x: p.x, y: p.y, width: 0, height: 0, fill: fill ? color : undefined }]); }
    else if (tool === 'ellipse') { setShapes(s => [...s, { ...base, type: 'ellipse', x: p.x, y: p.y, radiusX: 0, radiusY: 0, fill: fill ? color : undefined }]); }
    else if (tool === 'pen') { setShapes(s => [...s, { ...base, type: 'pen', x: 0, y: 0, points: [p.x, p.y] }]); }
    else { setShapes(s => [...s, { ...base, type: tool, x: 0, y: 0, points: [p.x, p.y, p.x, p.y] }]); }
  };

  const onMouseMove = () => {
    const id = drawingId.current;
    const start = startPt.current;
    const p = pointer();
    if (!id || !start || !p) { return; }
    setShapes(prev => prev.map(s => {
      if (s.id !== id) { return s; }
      if (s.type === 'rect') { return { ...s, x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) }; }
      if (s.type === 'ellipse') { return { ...s, x: (start.x + p.x) / 2, y: (start.y + p.y) / 2, radiusX: Math.abs(p.x - start.x) / 2, radiusY: Math.abs(p.y - start.y) / 2 }; }
      if (s.type === 'pen') { return { ...s, points: [...s.points, p.x, p.y] }; }
      return { ...s, points: [start.x, start.y, p.x, p.y] };
    }));
  };

  const onMouseUp = () => {
    const id = drawingId.current;
    drawingId.current = null;
    startPt.current = null;
    if (!id) { return; }
    // Drop degenerate (click-without-drag) shapes.
    setShapes(prev => prev.filter(s => {
      if (s.id !== id) { return true; }
      if (s.type === 'rect') { return s.width > 2 && s.height > 2; }
      if (s.type === 'ellipse') { return s.radiusX > 1 && s.radiusY > 1; }
      if (s.type === 'pen') { return s.points.length > 2; }
      // Text is placed on mousedown, never dragged into existence, so it can't
      // be degenerate here — its own commit/cancel handles the empty case.
      if (s.type === 'text') { return true; }
      const [x1, y1, x2, y2] = s.points;
      return Math.hypot(x2 - x1, y2 - y1) > 2;
    }));
  };

  const update = (id: string, patch: Partial<Shape>) =>
    setShapes(prev => prev.map(s => (s.id === id ? ({ ...s, ...patch } as Shape) : s)));

  const commonProps = (s: Shape) => ({
    id: s.id,
    draggable: tool === 'select',
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => { if (tool === 'select') { e.cancelBubble = true; setSelectedId(s.id); } },
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => update(s.id, { x: e.target.x(), y: e.target.y() }),
  });

  const onTransformEnd = (s: Shape) => (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const sx = node.scaleX();
    const sy = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    if (s.type === 'rect') { update(s.id, { x: node.x(), y: node.y(), width: Math.max(2, node.width() * sx), height: Math.max(2, node.height() * sy) }); }
    else if (s.type === 'ellipse') { update(s.id, { x: node.x(), y: node.y(), radiusX: Math.max(1, s.radiusX * sx), radiusY: Math.max(1, s.radiusY * sy) }); }
  };

  const deleteSelected = () => { if (selectedId) { setShapes(s => s.filter(x => x.id !== selectedId)); setSelectedId(null); } };
  const clearStrokes = () => { setShapes([]); setSelectedId(null); setEditingId(null); };

  const editingShape = shapes.find(s => s.id === editingId && s.type === 'text');

  /** Empty text is not worth keeping — drop the shape instead. */
  const commitText = (text: string) => {
    const trimmed = text.replace(/\s+$/, '');
    setShapes(prev =>
      trimmed
        ? prev.map(s => (s.id === editingId && s.type === 'text' ? { ...s, text: trimmed } : s))
        : prev.filter(s => s.id !== editingId),
    );
    setEditingId(null);
  };

  const cancelText = () => {
    // Escape on a brand-new (still empty) text discards it.
    setShapes(prev => prev.filter(s => !(s.id === editingId && s.type === 'text' && !s.text)));
    setEditingId(null);
  };

  const setSelectedFontSize = (size: number) => {
    setFontSize(size);
    if (selectedId) {
      setShapes(prev =>
        prev.map(s => (s.id === selectedId && s.type === 'text' ? { ...s, fontSize: size } : s)),
      );
    }
  };

  const save = () => {
    // While a text box is open its Konva node is hidden, so flattening now
    // would silently drop it. Commit first (Enter, or click away).
    if (saving || editingId || shapesRef.current.length === 0) { return; }
    setSaving(true);
    trRef.current?.nodes([]); // hide resize handles from the export
    const stage = stageRef.current;
    if (!stage) { setSaving(false); return; }
    // pixelRatio 1 keeps the image the SAME size across save cycles — a retina
    // ratio would double the dimensions on every flatten.
    const dataUrl = stage.toDataURL({ pixelRatio: 1, mimeType: 'image/png' });
    // Konva returns '' when the canvas is tainted or too large; forwarding
    // `undefined` produced a confusing Buffer TypeError on the host.
    const PNG_PREFIX = 'data:image/png;base64,';
    if (!dataUrl.startsWith(PNG_PREFIX)) {
      console.error('[lavagna] could not export the canvas (tainted or too large)');
      setSaving(false);
      return;
    }
    saveCanvas(dataUrl.slice(PNG_PREFIX.length), alt);
    // `saving` clears when the flattened image arrives via block.update
    // (or a writeFailed banner shows up).
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 0 8px', flexWrap: 'wrap' }}>
        {TOOLS.map(t => (
          <button key={t.key} style={{ ...BTN, ...(tool === t.key ? { outline: '2px solid var(--vscode-focusBorder, #007acc)' } : {}) }}
            onMouseDown={e => { e.preventDefault(); setTool(t.key); if (t.key !== 'select') { setSelectedId(null); } }}>{t.label}</button>
        ))}
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--vscode-panel-border,#555)', margin: '0 2px' }} />
        {COLORS.map(c => (
          <button key={c} title="Colour" onMouseDown={e => { e.preventDefault(); setColor(c); }}
            style={{ width: 16, height: 16, borderRadius: '50%', background: c, cursor: 'pointer', border: color === c ? '2px solid var(--vscode-focusBorder,#007acc)' : '1px solid rgba(0,0,0,0.3)' }} />
        ))}
        <input type="range" min={1} max={16} value={strokeWidth} onChange={e => setStrokeWidth(Number(e.target.value))} title="Stroke width" style={{ width: 80 }} />
        <label style={{ fontSize: '0.76em', display: 'flex', alignItems: 'center', gap: 3 }}>
          <input type="checkbox" checked={fill} onChange={e => setFill(e.target.checked)} /> fill
        </label>
        {(tool === 'text' || shapes.find(s => s.id === selectedId)?.type === 'text') && (
          <select
            value={fontSize}
            onChange={e => setSelectedFontSize(Number(e.target.value))}
            title="Font size"
            style={{ ...BTN, cursor: 'pointer' }}
          >
            {FONT_SIZES.map(s => (
              <option key={s} value={s}>{s}px</option>
            ))}
          </select>
        )}
        <button style={BTN} onMouseDown={e => { e.preventDefault(); deleteSelected(); }} disabled={!selectedId}>Delete</button>
        <button style={BTN} onMouseDown={e => { e.preventDefault(); clearStrokes(); }} disabled={!shapes.length}>Clear strokes</button>
        <button
          style={BTN}
          disabled={settingImage || saving}
          title="Replace this canvas image with a file from disk"
          onMouseDown={e => {
            e.preventDefault();
            // Strokes were drawn on the OLD bitmap; a new background invalidates them.
            if (shapes.length && !window.confirm(
              `Replace the image? ${shapes.length} unsaved stroke${shapes.length === 1 ? '' : 's'} will be discarded.`)) {
              return;
            }
            void chooseImage('dialog');
          }}
        >
          {settingImage ? 'Choosing…' : '🖼 Replace image'}
        </button>
        <div style={{ flex: 1 }} />
        <button
          style={{
            ...BTN,
            background: 'var(--vscode-button-background, #0e639c)',
            color: 'var(--vscode-button-foreground, #fff)',
            opacity: shapes.length && !saving && !editingId ? 1 : 0.5,
            cursor: shapes.length && !saving && !editingId ? 'pointer' : 'not-allowed',
          }}
          title={
            editingId
              ? 'Finish the text first (Enter, or click away)'
              : 'Flatten the drawing into a new PNG and update the link (paint-over: saved strokes become pixels)'
          }
          onMouseDown={e => { e.preventDefault(); save(); }}
        >
          {saving ? 'Saving…' : '💾 Save'}
        </button>
      </div>
      {shapes.length > 0 && (
        <p style={{ fontSize: 11, opacity: 0.6, margin: '0 0 8px' }}>
          {shapes.length} unsaved mark{shapes.length === 1 ? '' : 's'} — Save flattens them into the image (can't be un-drawn afterwards).
        </p>
      )}
      {/* Positioned wrapper so the text overlay can sit in stage coordinates.
          The stage is unscaled and 1:1 with this box, so shape x/y map directly. */}
      <div style={{ position: 'relative', width, height }}>
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        style={{ cursor: tool === 'select' ? 'default' : 'crosshair', touchAction: 'none' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      >
        <Layer>
          <KonvaImage name="bg" image={background} x={0} y={0} width={width} height={height} listening={tool === 'select'} />
          {shapes.map(s => {
            if (s.type === 'rect') { return <Rect key={s.id} {...commonProps(s)} x={s.x} y={s.y} width={s.width} height={s.height} stroke={s.stroke} strokeWidth={s.strokeWidth} fill={s.fill} onTransformEnd={onTransformEnd(s)} />; }
            if (s.type === 'ellipse') { return <Ellipse key={s.id} {...commonProps(s)} x={s.x} y={s.y} radiusX={s.radiusX} radiusY={s.radiusY} stroke={s.stroke} strokeWidth={s.strokeWidth} fill={s.fill} onTransformEnd={onTransformEnd(s)} />; }
            if (s.type === 'arrow') { return <Arrow key={s.id} {...commonProps(s)} x={s.x} y={s.y} points={s.points} stroke={s.stroke} strokeWidth={s.strokeWidth} fill={s.stroke} hitStrokeWidth={12} />; }
            if (s.type === 'text') {
              return (
                <KonvaText
                  key={s.id}
                  {...commonProps(s)}
                  x={s.x}
                  y={s.y}
                  text={s.text}
                  fontSize={s.fontSize}
                  fontFamily={TEXT_FONT_FAMILY}
                  lineHeight={TEXT_LINE_HEIGHT}
                  fill={s.stroke}
                  // Hidden while the overlay is open, so the text isn't drawn twice.
                  visible={editingId !== s.id}
                  onDblClick={() => setEditingId(s.id)}
                  onDblTap={() => setEditingId(s.id)}
                />
              );
            }
            return <Line key={s.id} {...commonProps(s)} x={s.x} y={s.y} points={s.points} stroke={s.stroke} strokeWidth={s.strokeWidth} lineCap="round" lineJoin="round" hitStrokeWidth={12} />;
          })}
          <Transformer ref={trRef} rotateEnabled={false} ignoreStroke keepRatio={false} />
        </Layer>
      </Stage>
      {editingShape?.type === 'text' && (
        <TextOverlay
          key={editingShape.id}
          x={editingShape.x}
          y={editingShape.y}
          fontSize={editingShape.fontSize}
          color={editingShape.stroke}
          initialText={editingShape.text}
          onCommit={commitText}
          onCancel={cancelText}
        />
      )}
      </div>
    </div>
  );
}
