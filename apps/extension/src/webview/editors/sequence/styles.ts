// Sequence-editor-only styles, rendered as a <style> element by the editor.
// Shared chrome (bars, buttons, code pane) comes from ui/styles.ts.

export const SEQ_CSS = `
.lv-seq-stage { touch-action: none; user-select: none; }
.lv-seq-stage.lv-seq-panning, .lv-seq-stage.lv-seq-space { cursor: grab; }
.lv-seq-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.lv-seq-world > svg { position: absolute; left: 0; top: 0; overflow: visible; }
.lv-seq-hover { pointer-events: none; }
.lv-seq-hover .lv-seq-hot { pointer-events: auto; cursor: pointer; }
.lv-seq-hover .lv-seq-grip { cursor: grab; }

.lv-seq-world text { font-family: var(--vscode-font-family); font-size: 12px; fill: var(--vscode-foreground); }
.lv-seq-lifeline { stroke: var(--vscode-descriptionForeground); stroke-dasharray: 4 4; opacity: 0.75; }
.lv-seq-lane { fill: transparent; cursor: crosshair; }

.lv-seq-head { cursor: grab; }
.lv-seq-head.lv-seq-dragging { cursor: grabbing; opacity: 0.85; }
.lv-seq-head-box { fill: var(--vscode-editorWidget-background); stroke: color-mix(in srgb, var(--vscode-foreground) 40%, transparent); }
.lv-seq-head:hover .lv-seq-head-box, .lv-seq-head.lv-seq-dragging .lv-seq-head-box { stroke: var(--vscode-focusBorder); }
.lv-seq-head-hit { fill: transparent; }
.lv-seq-actor { fill: none; stroke: var(--vscode-foreground); stroke-width: 1.4; stroke-linecap: round; }
.lv-seq-head:hover .lv-seq-actor { stroke: var(--vscode-focusBorder); }
.lv-seq-world .lv-seq-head-label { text-anchor: middle; font-weight: 500; }
.lv-seq-menu-btn { opacity: 0; cursor: pointer; transition: opacity .12s; }
.lv-seq-head:hover .lv-seq-menu-btn, .lv-seq-menu-btn.lv-seq-open { opacity: 1; }
.lv-seq-menu-btn rect { fill: var(--vscode-button-secondaryBackground); stroke: var(--vscode-panel-border); }
.lv-seq-menu-btn circle { fill: var(--vscode-foreground); }
.lv-seq-ghost { cursor: pointer; }
.lv-seq-ghost rect { fill: transparent; stroke: var(--vscode-descriptionForeground); stroke-dasharray: 4 3; }
.lv-seq-world .lv-seq-ghost text { fill: var(--vscode-descriptionForeground); text-anchor: middle; }
.lv-seq-ghost:hover rect { stroke: var(--vscode-focusBorder); fill: color-mix(in srgb, var(--vscode-focusBorder) 8%, transparent); }
.lv-seq-world .lv-seq-ghost:hover text { fill: var(--vscode-foreground); }

.lv-seq-step { cursor: pointer; }
.lv-seq-msg-hit { stroke: transparent; stroke-width: 16; fill: none; }
.lv-seq-text-hit { fill: transparent; }
.lv-seq-msg-line { stroke: var(--vscode-foreground); stroke-width: 1.3; fill: none; }
.lv-seq-tip { fill: var(--vscode-foreground); stroke: var(--vscode-foreground); stroke-width: 1.3; stroke-linejoin: round; stroke-linecap: round; }
.lv-seq-tip.lv-seq-open-tip { fill: none; }
.lv-seq-step:hover .lv-seq-msg-line, .lv-seq-step:hover .lv-seq-tip { stroke: var(--vscode-focusBorder); }
.lv-seq-step:hover .lv-seq-tip:not(.lv-seq-open-tip) { fill: var(--vscode-focusBorder); }
.lv-seq-step.lv-seq-sel .lv-seq-msg-line { stroke: var(--vscode-focusBorder); stroke-width: 2.2; }
.lv-seq-step.lv-seq-sel .lv-seq-tip { stroke: var(--vscode-focusBorder); stroke-width: 2; }
.lv-seq-step.lv-seq-sel .lv-seq-tip:not(.lv-seq-open-tip) { fill: var(--vscode-focusBorder); }
.lv-seq-world .lv-seq-step.lv-seq-sel text { font-weight: 600; }
.lv-seq-world .lv-seq-center { text-anchor: middle; }
.lv-seq-num circle { fill: var(--vscode-foreground); }
.lv-seq-world .lv-seq-num text { fill: var(--vscode-editor-background); font-size: 9.5px; font-weight: 700; text-anchor: middle; }
.lv-seq-note { fill: var(--vscode-inputValidation-warningBackground, rgba(204, 167, 0, 0.18)); stroke: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 70%, transparent); }
.lv-seq-step:hover .lv-seq-note { stroke: var(--vscode-focusBorder); }
.lv-seq-step.lv-seq-sel .lv-seq-note { stroke: var(--vscode-focusBorder); stroke-width: 2; }
.lv-seq-frame { fill: none; stroke: color-mix(in srgb, var(--vscode-foreground) 40%, transparent); pointer-events: none; }
.lv-seq-tab { fill: var(--vscode-editorWidget-background); stroke: color-mix(in srgb, var(--vscode-foreground) 40%, transparent); }
.lv-seq-world .lv-seq-kw { font-weight: 700; font-size: 11px; }
.lv-seq-world .lv-seq-frame-label { fill: var(--vscode-descriptionForeground); font-size: 11.5px; font-style: italic; }
.lv-seq-divider { stroke: color-mix(in srgb, var(--vscode-foreground) 40%, transparent); stroke-dasharray: 5 4; pointer-events: none; }
.lv-seq-step:hover .lv-seq-tab, .lv-seq-step.lv-seq-sel .lv-seq-tab { stroke: var(--vscode-focusBorder); }
.lv-seq-world .lv-seq-step.lv-seq-sel .lv-seq-frame-label { fill: var(--vscode-foreground); }
.lv-seq-bar { fill: var(--vscode-editorWidget-background); stroke: color-mix(in srgb, var(--vscode-foreground) 55%, transparent); pointer-events: none; }

.lv-seq-dot { fill: var(--vscode-focusBorder); }
.lv-seq-ring { fill: none; stroke: var(--vscode-focusBorder); stroke-opacity: .35; stroke-width: 6; }
.lv-seq-ghost-line { stroke: var(--vscode-focusBorder); stroke-width: 1.8; stroke-dasharray: 6 4; fill: none; }
.lv-seq-ghost-tip { fill: var(--vscode-focusBorder); }
.lv-seq-target { fill: color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent); stroke: color-mix(in srgb, var(--vscode-focusBorder) 40%, transparent); stroke-dasharray: 3 3; }
.lv-seq-ins { stroke: var(--vscode-focusBorder); stroke-width: 1.4; }
.lv-seq-ins.lv-seq-faint { stroke-opacity: .45; stroke-dasharray: 3 3; }
.lv-seq-ins.lv-seq-strong { stroke-width: 2.5; }
.lv-seq-plus circle { fill: var(--vscode-button-background); }
.lv-seq-plus path { stroke: var(--vscode-button-foreground); stroke-width: 1.8; stroke-linecap: round; }
.lv-seq-plus:hover circle { fill: var(--vscode-button-hoverBackground); }
.lv-seq-grip rect { fill: var(--vscode-button-secondaryBackground); stroke: var(--vscode-panel-border); }
.lv-seq-grip circle { fill: var(--vscode-descriptionForeground); }

.lv-seq-edit {
  position: absolute; z-index: 3; height: 24px; padding: 0 6px; text-align: center; font: inherit; font-size: 12px;
  border: 1px solid var(--vscode-focusBorder); border-radius: 4px; outline: none;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground, var(--vscode-foreground));
  box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
}
.lv-seq-edit.lv-seq-left { text-align: left; }

.lv-seq-ctx { flex-wrap: wrap; justify-content: center; }
.lv-seq-arrow svg { width: 22px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.lv-seq-label { font-size: 11px; color: var(--vscode-descriptionForeground); padding: 0 6px; }
.lv-seq-select {
  height: 24px; padding: 0 4px; border-radius: 4px; font: inherit; font-size: 12px;
  border: 1px solid var(--vscode-input-border, #3c3c3c); background: var(--vscode-input-background); color: var(--vscode-foreground);
}

.lv-seq-pop-title { display: flex; gap: 6px; align-items: baseline; padding: 2px 8px 6px; font-size: 11px; color: var(--vscode-descriptionForeground); }
.lv-seq-pop-title b { color: var(--vscode-foreground); font-size: 12px; }
.lv-seq-mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; }
.lv-seq-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; }
.lv-seq-row.lv-seq-end { justify-content: flex-end; }
.lv-seq-row label { width: 16px; font-size: 11px; color: var(--vscode-descriptionForeground); }
.lv-seq-row input {
  width: 110px; height: 24px; padding: 0 6px; border-radius: 4px; outline: none;
  border: 1px solid var(--vscode-input-border, #3c3c3c); background: var(--vscode-input-background); color: var(--vscode-foreground);
}
.lv-seq-row input:focus { border-color: var(--vscode-focusBorder); }
.lv-seq-err { padding: 0 8px 4px; font-size: 11px; color: var(--vscode-errorForeground, #f48771); }
.lv-seq-confirm { max-width: 230px; padding: 4px 8px 6px; font-size: 12px; }
.lv-seq-pop .lv-menu { padding: 0; min-width: 190px; }
.lv-seq-pop .lv-menu button:disabled { opacity: 0.45; cursor: default; background: transparent; }
.lv-seq-pop .lv-menu .lv-seq-sub { margin-left: auto; font-size: 11px; color: var(--vscode-descriptionForeground); }
.lv-seq-pop .lv-menu .lv-seq-danger { color: var(--vscode-errorForeground, #f48771); }
.lv-seq-pop .lv-seg button { display: inline-flex; align-items: center; gap: 4px; }
.lv-seq-danger-btn { background: var(--vscode-errorForeground, #f48771); color: #fff; }
.lv-seq-toggle[aria-pressed="true"] { background: color-mix(in srgb, var(--vscode-focusBorder) 22%, transparent); box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); }

@media (max-width: 700px) {
  .lv-seq-wide { display: none; }
}
`;
