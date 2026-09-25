import * as vscode from 'vscode';
import { computeBlockEdit } from '../domain/blocks/computeBlockEdit';
import { parseBlocks } from '../domain/blocks/parseBlocks';
import { BlockRef, LavagnaBlock } from '../domain/blocks/types';

export type ApplyResult = 'applied' | 'gone' | 'failed';

export interface BlockSessionEvents {
  /** The fence changed in the document and it was NOT the echo of our own write. */
  onExternalUpdate(content: string): void;
  /** The fence can no longer be located. */
  onGone(): void;
}

/**
 * Host-side identity of one open block: relocates the fence by (kind, indexOfKind)
 * on every document change, suppresses echoes of its own writes, and applies
 * webview edits through a freshly computed range — never a stale one.
 */
export class BlockSessionTracker implements vscode.Disposable {
  private lastKnownContent: string;
  private lastAppliedText: string | null = null;
  private goneNotified = false;
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly document: vscode.TextDocument,
    private readonly ref: BlockRef,
    initial: LavagnaBlock,
    private readonly events: BlockSessionEvents,
  ) {
    this.lastKnownContent = initial.content;
    this.subscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === this.document && e.contentChanges.length > 0) {
        this.checkDocument();
      }
    });
  }

  /** The fence body as of the last time we saw it. */
  currentContent(): string {
    return this.lastKnownContent;
  }

  async apply(content: string, force = false): Promise<ApplyResult> {
    const text = this.document.getText();
    // Identity is positional (kind + ordinal), so a block inserted above this
    // one silently becomes "our" block. Verify the relocated block still holds
    // what we last saw before writing, or the user's edit lands in a block they
    // never opened. `force` is the explicit "Keep mine" path.
    if (!force && !this.stillOurBlock(text)) {
      this.events.onExternalUpdate(this.currentContent());
      return 'failed';
    }
    const edit = computeBlockEdit(text, this.ref, content);
    if (!edit) {
      this.notifyGone();
      return 'gone';
    }
    const body = content.replace(/\r?\n$/, '');
    // Set BEFORE applying: the change event fires synchronously inside applyEdit.
    this.lastAppliedText = body;
    const range = this.document.validateRange(
      new vscode.Range(edit.startLine, 0, edit.endLineExclusive, 0),
    );
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(this.document.uri, range, edit.newText);
    const ok = await vscode.workspace.applyEdit(workspaceEdit);
    if (!ok) {
      this.lastAppliedText = null;
      return 'failed';
    }
    return 'applied';
  }

  dispose(): void {
    this.subscription.dispose();
  }

  /**
   * True when the block at our ordinal still contains what we last observed —
   * i.e. relocation found the same block, not a different one that shifted into
   * this position.
   */
  private stillOurBlock(text: string): boolean {
    const block = parseBlocks(text).find(
      (b) => b.kind === this.ref.kind && b.indexOfKind === this.ref.indexOfKind,
    );
    if (!block) {
      return false;
    }
    return block.content === this.lastKnownContent || block.content === this.lastAppliedText;
  }

  private checkDocument(): void {
    const block = parseBlocks(this.document.getText()).find(
      (b) => b.kind === this.ref.kind && b.indexOfKind === this.ref.indexOfKind,
    );
    if (!block) {
      this.notifyGone();
      return;
    }
    this.goneNotified = false;
    if (block.content === this.lastKnownContent) {
      return; // the change was elsewhere in the document
    }
    this.lastKnownContent = block.content;
    if (this.lastAppliedText !== null && block.content === this.lastAppliedText) {
      return; // echo of our own write — the panel sends block.ack instead
    }
    this.events.onExternalUpdate(block.content);
  }

  private notifyGone(): void {
    if (!this.goneNotified) {
      this.goneNotified = true;
      this.events.onGone();
    }
  }
}
