// Block model for *.lavagna.md documents. Pure types — no vscode, no browser.

export type BlockKind = 'mermaid' | 'tree' | 'code' | 'table' | 'image';

export interface LavagnaBlock {
  kind: BlockKind;
  /** First token of the fence info string, lowercased; null for non-fenced blocks. */
  language: string | null;
  /** 0-based, inclusive. start/end cover the fences; content* covers the inner lines. */
  startLine: number;
  endLine: number;
  /**
   * Content lines, 0-based inclusive. For an empty fence body,
   * contentEndLine < contentStartLine. For tables and images, content spans
   * the whole block.
   */
  contentStartLine: number;
  contentEndLine: number;
  /** Inner text joined with '\n' ('' for an empty fence body). */
  content: string;
  /** Ordinal among blocks of the same kind, in document order — the handle for write-back. */
  indexOfKind: number;
  /** False when the fence runs to end-of-file without a closing fence. */
  closed: boolean;
}

export interface BlockRef {
  kind: BlockKind;
  indexOfKind: number;
}
