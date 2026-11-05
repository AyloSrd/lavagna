// Shared look for the block editors. Injected once as a <style> element (see
// index.tsx), so editors use class names instead of repeating inline styles.
// Colours come only from the VS Code theme variables the webview receives.

export const UI_CSS = `
.lv-editor { position: relative; height: 100%; display: flex; flex-direction: column; }
.lv-bar {
  display: flex; align-items: center; gap: 4px; flex: none; flex-wrap: wrap;
  min-height: 36px; padding: 4px 8px;
  border-bottom: 1px solid var(--vscode-panel-border, #333);
}
.lv-spacer { flex: 1; }
.lv-body { position: relative; flex: 1; min-height: 0; display: flex; }
.lv-stage { position: relative; flex: 1; min-width: 0; overflow: hidden; }
.lv-grid {
  background-image: radial-gradient(color-mix(in srgb, var(--vscode-foreground) 12%, transparent) 1px, transparent 1.2px);
  background-size: 20px 20px;
}

.lv-icon {
  position: relative; display: inline-grid; place-items: center; flex: none;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 5px;
  background: transparent; color: var(--vscode-foreground); cursor: pointer;
}
.lv-icon:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31)); }
.lv-icon:focus-visible, .lv-btn:focus-visible, .lv-seg button:focus-visible, .lv-swatch:focus-visible {
  outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px;
}
.lv-icon[aria-pressed="true"] {
  background: color-mix(in srgb, var(--vscode-focusBorder) 22%, transparent);
  box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
}
.lv-icon:disabled { opacity: 0.35; cursor: default; background: transparent; }
.lv-icon--danger { color: var(--vscode-errorForeground, #f48771); }
.lv-key { position: absolute; right: 2px; bottom: 0; font-size: 8.5px; line-height: 1; color: var(--vscode-descriptionForeground); }
.lv-svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

.lv-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; white-space: nowrap;
  border: 1px solid transparent; border-radius: 4px; cursor: pointer; font: inherit; font-size: 12px;
  background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ccc);
}
.lv-btn:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
.lv-btn:disabled { opacity: 0.5; cursor: default; }
.lv-btn--primary { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); }
.lv-btn--primary:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
.lv-btn--ghost { background: transparent; color: var(--vscode-foreground); }
.lv-btn--ghost:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31)); }

.lv-sep { width: 1px; align-self: stretch; margin: 4px 2px; flex: none; background: var(--vscode-panel-border, #444); }
.lv-sep--h { width: auto; height: 1px; margin: 3px 4px; }

.lv-seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 6px; background: var(--vscode-button-secondaryBackground, #3a3d41); }
.lv-seg button {
  display: inline-grid; place-items: center; min-width: 26px; height: 24px; padding: 0 7px;
  border: 0; border-radius: 4px; background: transparent; color: var(--vscode-foreground); cursor: pointer; font: inherit; font-size: 12px;
}
.lv-seg button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31)); }
.lv-seg button[aria-pressed="true"] { background: var(--vscode-editor-background); box-shadow: 0 0 0 1px var(--vscode-panel-border, #444); }

.lv-swatch {
  width: 18px; height: 18px; padding: 0; flex: none; border-radius: 50%; cursor: pointer;
  border: 1px solid rgba(128, 128, 128, 0.5);
}
.lv-swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--vscode-editorWidget-background), 0 0 0 4px var(--vscode-focusBorder); }

.lv-float {
  background: var(--vscode-editorWidget-background, #252526);
  border: 1px solid var(--vscode-editorWidget-border, #454545);
  border-radius: 8px;
  box-shadow: 0 4px 16px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
}
.lv-ctx { position: absolute; z-index: 20; display: flex; align-items: center; gap: 2px; padding: 3px; white-space: nowrap; width: max-content; max-width: calc(100% - 16px); overflow-x: auto; }
.lv-pop { position: absolute; z-index: 30; padding: 6px; }
.lv-menu { display: flex; flex-direction: column; min-width: 180px; padding: 4px; }
.lv-menu button {
  display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; border: 0; border-radius: 4px;
  background: transparent; color: var(--vscode-foreground); cursor: pointer; font: inherit; text-align: left;
}
.lv-menu button:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }

.lv-hint {
  position: absolute; left: 50%; bottom: 12px; z-index: 5; transform: translateX(-50%);
  padding: 3px 10px; border-radius: 12px; font-size: 11.5px; white-space: nowrap; pointer-events: none;
  color: var(--vscode-descriptionForeground); background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border, #444);
}
.lv-kbd, .lv-hint kbd, .lv-help kbd {
  font: 10.5px var(--vscode-editor-font-family, monospace); padding: 0 4px; border-radius: 3px; white-space: nowrap;
  border: 1px solid var(--vscode-panel-border, #444); background: var(--vscode-textPreformat-background, rgba(128, 128, 128, 0.15));
}
.lv-zoom { position: absolute; left: 12px; bottom: 12px; z-index: 5; display: flex; align-items: center; gap: 2px; padding: 2px; }
.lv-zoom .lv-pct {
  min-width: 46px; height: 24px; border: 0; border-radius: 4px; background: transparent; color: var(--vscode-foreground);
  cursor: pointer; font: inherit; font-size: 12px; font-variant-numeric: tabular-nums;
}
.lv-zoom .lv-pct:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31)); }

.lv-code {
  flex: none; width: 300px; display: flex; flex-direction: column;
  border-left: 1px solid var(--vscode-panel-border, #333); background: var(--vscode-editor-background);
}
.lv-code-head {
  display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 6px 0 12px; flex: none;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-panel-border, #333);
}
.lv-code pre { flex: 1; margin: 0; padding: 8px 0; overflow: auto; font: 12px/1.6 var(--vscode-editor-font-family, monospace); }
.lv-code-line { display: block; padding: 0 12px 0 0; white-space: pre; }
.lv-code-line.lv-flash { animation: lv-flash 1.2s ease-out; }
.lv-code-ln { display: inline-block; width: 34px; padding-right: 10px; text-align: right; color: var(--vscode-editorLineNumber-foreground, #858585); user-select: none; }
.lv-code-foot { padding: 8px 12px; font-size: 11px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border, #333); }
@keyframes lv-flash {
  from { background: color-mix(in srgb, var(--vscode-editor-selectionBackground, #264f78) 70%, transparent); }
  to { background: transparent; }
}
.lv-tok-keyword { color: var(--vscode-symbolIcon-keywordForeground, #569cd6); }
.lv-tok-arrow { color: var(--vscode-symbolIcon-operatorForeground, #c586c0); }
.lv-tok-string { color: var(--vscode-debugTokenExpression-string, #ce9178); }
.lv-tok-comment { color: var(--vscode-descriptionForeground, #6a9955); font-style: italic; }

.lv-help {
  width: min(520px, calc(100vw - 32px)); padding: 18px 20px; border-radius: 10px;
  border: 1px solid var(--vscode-editorWidget-border, #454545);
  background: var(--vscode-editorWidget-background, #252526); color: var(--vscode-foreground);
  box-shadow: 0 8px 30px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
}
.lv-help::backdrop { background: rgba(0, 0, 0, 0.35); }
.lv-help h3 { margin: 0 0 12px; font-size: 14px; }
.lv-help .lv-icon { position: absolute; top: 10px; right: 10px; }
.lv-keys { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 20px; }
.lv-keys div { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; font-size: 12px; border-bottom: 1px solid var(--vscode-panel-border, #444); }

@media (max-width: 700px) {
  .lv-code { position: absolute; inset: 0 0 0 auto; z-index: 25; width: min(300px, 85%); box-shadow: -8px 0 24px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36)); }
  .lv-hint { display: none; }
  .lv-keys { grid-template-columns: 1fr; }
}
`;
