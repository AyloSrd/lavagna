// Sync engine for one block-editing session. Pure browser-API-free logic
// (setTimeout aside) so the state machine is unit-testable outside a webview.
//
// States:
//   clean    — editor content equals the document's fence content
//   pending  — local edits inside the debounce window or sent-but-unacked
//   conflict — the fence changed under us while we had local edits (or a write
//              failed); no timers run and nothing is written until the user
//              picks "Load file version" or "Keep mine"
//   gone     — the fence was deleted; editing is disabled, content is kept so
//              the user can copy it out
//
// External updates NEVER merge — they replace (clean) or raise the banner (pending).

export type SyncStatus = 'clean' | 'pending' | 'conflict' | 'gone';

export interface SyncSnapshot {
  status: SyncStatus;
  /** What the editor shows. */
  content: string;
  /** Stashed file version behind the conflict banner (null for write failures). */
  fileContent: string | null;
  /** Message of a failed write, if that's what caused the conflict. */
  failure: string | null;
}

export type PostChange = (rev: number, content: string, force: boolean) => void;

export class BlockSync {
  private status: SyncStatus = 'clean';
  private content: string;
  private rev = 0;
  private inFlightRev: number | null = null;
  private dirty = false; // local edits not yet sent
  private fileContent: string | null = null;
  private failure: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private snap: SyncSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(
    initialContent: string,
    private readonly post: PostChange,
    private readonly debounceMs = 300,
  ) {
    this.content = initialContent;
    this.snap = this.buildSnapshot();
  }

  /** Stable snapshot identity between changes — safe for useSyncExternalStore. */
  readonly snapshot = (): SyncSnapshot => this.snap;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  userEdited(next: string): void {
    if (this.status === 'gone') {
      return;
    }
    this.content = next;
    if (this.status === 'conflict') {
      this.emit(); // keep typing locally; nothing is written during a conflict
      return;
    }
    this.status = 'pending';
    this.dirty = true;
    this.scheduleSend();
    this.emit();
  }

  /** Gesture end (drag drop, blur, …) — send without waiting out the debounce. */
  flush(): void {
    this.clearTimer();
    this.sendNow();
  }

  handleAck(rev: number): void {
    if (this.status !== 'pending' || this.inFlightRev !== rev) {
      return;
    }
    this.inFlightRev = null;
    if (!this.dirty && this.timer === null) {
      this.status = 'clean';
      this.emit();
    }
  }

  handleExternalUpdate(content: string): void {
    switch (this.status) {
      case 'gone':
        return;
      case 'clean':
        this.content = content;
        this.emit();
        return;
      case 'conflict':
        this.fileContent = content;
        this.emit();
        return;
      case 'pending':
        if (content === this.content) {
          // Our write raced an identical external edit — treat as an ack.
          this.clearTimer();
          this.inFlightRev = null;
          this.dirty = false;
          this.status = 'clean';
        } else {
          this.clearTimer();
          this.inFlightRev = null;
          this.dirty = false;
          this.status = 'conflict';
          this.fileContent = content;
        }
        this.emit();
    }
  }

  handleWriteFailed(message: string): void {
    if (this.status === 'gone') {
      return;
    }
    this.clearTimer();
    this.inFlightRev = null;
    this.dirty = false;
    this.status = 'conflict';
    this.failure = message;
    this.emit();
  }

  handleGone(): void {
    this.clearTimer();
    this.status = 'gone';
    this.emit();
  }

  /** Conflict banner: discard local edits, adopt the file's version. */
  loadFileVersion(): void {
    if (this.status !== 'conflict') {
      return;
    }
    if (this.fileContent !== null) {
      this.content = this.fileContent;
    }
    this.fileContent = null;
    this.failure = null;
    this.status = 'clean';
    this.emit();
  }

  /** Conflict banner: force-write the editor's version over the fence. */
  keepMine(): void {
    if (this.status !== 'conflict') {
      return;
    }
    this.fileContent = null;
    this.failure = null;
    this.status = 'pending';
    this.rev += 1;
    this.inFlightRev = this.rev;
    this.dirty = false;
    this.post(this.rev, this.content, true);
    this.emit();
  }

  dispose(): void {
    this.clearTimer();
    this.listeners.clear();
  }

  private scheduleSend(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sendNow();
    }, this.debounceMs);
  }

  private sendNow(): void {
    if (this.status !== 'pending' || !this.dirty) {
      return;
    }
    this.rev += 1;
    this.inFlightRev = this.rev;
    this.dirty = false;
    this.post(this.rev, this.content, false);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private buildSnapshot(): SyncSnapshot {
    return {
      status: this.status,
      content: this.content,
      fileContent: this.fileContent,
      failure: this.failure,
    };
  }

  private emit(): void {
    this.snap = this.buildSnapshot();
    this.listeners.forEach((listener) => listener());
  }
}
