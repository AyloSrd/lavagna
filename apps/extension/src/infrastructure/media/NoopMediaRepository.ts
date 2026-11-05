import { MediaPort, MediaUnavailableError } from '../../application/ports/MediaPort';

/** Used when no workspace folder is open — media saving is disabled. */
export class NoopMediaRepository implements MediaPort {
  readonly isAvailable = false;

  async save(_bytes: Uint8Array, _ext: string): Promise<string> {
    throw new MediaUnavailableError();
  }

  async listFiles(): Promise<string[]> {
    return [];
  }

  async trash(_name: string): Promise<void> {
    throw new MediaUnavailableError();
  }
}
