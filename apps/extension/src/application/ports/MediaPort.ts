export interface MediaPort {
  /** False when no workspace folder is open — UI should disable media affordances. */
  readonly isAvailable: boolean;

  /**
   * Persist raw bytes under `.lavagna/media/` in the workspace.
   * Returns the workspace-relative path (e.g. `.lavagna/media/ab12cd34.png`).
   * Throws `MediaUnavailableError` when `isAvailable` is false.
   */
  save(bytes: Uint8Array, ext: string): Promise<string>;
}

export class MediaUnavailableError extends Error {
  constructor() {
    super('No workspace folder is open, so media cannot be saved.');
    this.name = 'MediaUnavailableError';
  }
}
