// Styles specific to the flowchart editor; the shared look is ui/styles.ts.
// Rendered by FlowEditor in a <style> element, like React Flow's own sheet.

export const FLOW_CSS = `
.lv-flow { --lv-flow-line: color-mix(in srgb, var(--vscode-foreground) 55%, transparent); }
.lv-flow .react-flow { background: transparent; }
.lv-flow .react-flow__node-shape { padding: 0; border: 0; background: transparent; }
.lv-flow .react-flow__selection { background: color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent); border: 1px solid var(--vscode-focusBorder); }
.lv-flow .react-flow__nodesselection-rect { background: transparent; border: 1px dashed color-mix(in srgb, var(--vscode-focusBorder) 70%, transparent); }
.lv-flow.is-dropping .react-flow__pane { background: color-mix(in srgb, var(--vscode-focusBorder) 5%, transparent); }

.lv-flow-node {
  position: relative; display: flex; align-items: center; justify-content: center; min-width: 120px;
  color: var(--vscode-foreground); font-size: 12.5px; font-weight: 500;
}
/* A halo that keeps the node hovered while the pointer travels to a "+". */
.lv-flow-node::before { content: ""; position: absolute; inset: -28px; pointer-events: none; }
.lv-flow-node:hover::before { pointer-events: auto; }
.lv-flow-shape { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.lv-flow-shape > * { fill: var(--vscode-editorWidget-background); stroke: color-mix(in srgb, var(--vscode-foreground) 38%, transparent); stroke-width: 1.4; }
.lv-flow-shape > [data-line] { fill: none; }
.lv-flow-node:hover .lv-flow-shape > * { stroke: color-mix(in srgb, var(--vscode-foreground) 65%, transparent); }
.lv-flow-node.is-selected .lv-flow-shape > * { stroke: var(--vscode-focusBorder); stroke-width: 2; }
.lv-flow-label { position: relative; white-space: nowrap; text-align: center; }
.lv-flow-placeholder { opacity: 0.45; }
.lv-flow-input {
  font: inherit; color: inherit; background: transparent; border: 0; outline: none; padding: 0; margin: 0;
  text-align: center; min-width: 4ch; caret-color: var(--vscode-focusBorder);
}

.lv-flow .react-flow__handle.lv-flow-plus {
  display: grid; place-items: center; width: 18px; height: 18px; min-width: 0; min-height: 0; z-index: 2;
  border-radius: 50%; border: 1px solid var(--vscode-focusBorder);
  background: var(--vscode-editor-background); color: var(--vscode-focusBorder);
  opacity: 0; pointer-events: none; cursor: crosshair; transition: opacity 0.12s;
}
.lv-flow .lv-flow-plus svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; pointer-events: none; }
.lv-flow .lv-flow-plus--top { top: -16px; }
.lv-flow .lv-flow-plus--bottom { bottom: -16px; }
.lv-flow .lv-flow-plus--left { left: -16px; }
.lv-flow .lv-flow-plus--right { right: -16px; }
.lv-flow .lv-flow-node:hover .lv-flow-plus, .lv-flow .lv-flow-node.is-selected .lv-flow-plus { opacity: 1; pointer-events: all; }
.lv-flow .lv-flow-node.is-editing .lv-flow-plus, .lv-flow .react-flow.is-connecting .lv-flow-plus { opacity: 0; pointer-events: none; }
.lv-flow .react-flow__handle.lv-flow-plus:hover { background: var(--vscode-focusBorder); color: var(--vscode-button-foreground); }

.lv-flow-edge { fill: none; stroke: var(--lv-flow-line); stroke-width: 1.5; }
.lv-flow-edge--dotted { stroke-dasharray: 5 4; }
.lv-flow-edge--thick { stroke-width: 3; }
.lv-flow-head { fill: var(--lv-flow-line); stroke-width: 1; stroke-dasharray: none; }
.react-flow__edge:hover .lv-flow-edge { stroke: var(--vscode-foreground); }
.react-flow__edge:hover .lv-flow-head { fill: var(--vscode-foreground); }
.lv-flow-edge.is-selected { stroke: var(--vscode-focusBorder); }
.lv-flow-head.is-selected { fill: var(--vscode-focusBorder); }
.lv-flow .react-flow__connection-path { stroke: var(--vscode-focusBorder); stroke-width: 1.5; stroke-dasharray: 4 4; }
.lv-flow-pill {
  position: absolute; pointer-events: all; cursor: pointer; white-space: nowrap;
  padding: 1px 8px; border-radius: 9px; font-size: 11px; color: var(--vscode-foreground);
  background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border, #444);
}
.lv-flow-pill.is-selected { border-color: var(--vscode-focusBorder); }
.lv-flow-pill .lv-flow-input { font-size: 11px; }

.lv-flow-bar { position: relative; display: flex; align-items: center; gap: 2px; padding: 3px; white-space: nowrap; }
.lv-flow-shape-btn { gap: 6px; padding: 0 6px; }
.lv-flow-shape-grid { top: calc(100% + 6px); left: 0; display: grid; grid-template-columns: repeat(7, 30px); gap: 2px; }
.lv-flow-pal-item {
  display: grid; place-items: center; width: 30px; height: 28px; padding: 0; border: 0; border-radius: 5px;
  background: transparent; color: var(--vscode-foreground); cursor: pointer;
}
.lv-flow-pal-item:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31)); }
.lv-flow-pal-item[aria-checked="true"] { box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); }
.lv-flow-palette .lv-flow-pal-item { cursor: grab; }
.lv-flow-thumb * { fill: none; stroke: currentColor; stroke-width: 1.3; }

.lv-flow-palette {
  position: absolute; left: 12px; top: 12px; z-index: 6;
  display: grid; grid-template-columns: repeat(2, 30px); gap: 2px; padding: 6px;
}
.lv-flow-palette-title {
  grid-column: 1 / -1; padding: 0 2px 4px; font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
}
.lv-flow-dir-label { font-size: 11px; color: var(--vscode-descriptionForeground); padding: 0 2px 0 4px; }

@media (max-width: 700px) {
  .lv-flow-palette { top: auto; bottom: 52px; right: 12px; grid-template-columns: none; grid-auto-flow: column; overflow-x: auto; }
  .lv-flow-palette-title, .lv-flow-dir-label { display: none; }
}
`;
