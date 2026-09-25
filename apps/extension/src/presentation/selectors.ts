import * as vscode from 'vscode';
import { LavagnaBlock } from '../domain/blocks/types';

/**
 * Lavagna boards are plain markdown files named `*.lavagna.md` — the language
 * id stays `markdown` so Copilot, inline chat, and markdown tooling keep working.
 */
export const LAVAGNA_DOC_SELECTOR: vscode.DocumentSelector = {
  language: 'markdown',
  pattern: '**/*.lavagna.md',
  scheme: 'file',
};

/** Block kinds that have a visual side editor. */
export const EDITABLE_KINDS = ['mermaid', 'tree', 'table', 'image'] as const;

/**
 * Whether to offer visual editing for a block. Unclosed fences are excluded:
 * their extent runs to end-of-file, so editing one would rewrite everything
 * after it. Keep every affordance (CodeLens, hover, the editBlock command)
 * behind this one predicate so they can't disagree.
 */
export function isEditableBlock(block: LavagnaBlock): boolean {
  return (EDITABLE_KINDS as readonly string[]).includes(block.kind) && block.closed;
}

export const KIND_LABEL: Record<string, string> = {
  mermaid: 'flowchart',
  tree: 'tree',
  table: 'table',
  image: 'image',
};
