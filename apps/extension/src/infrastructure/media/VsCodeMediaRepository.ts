import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { MediaPort } from '../../application/ports/MediaPort';

const MEDIA_DIR = ['.lavagna', 'media'];

/** Writes media files into `.lavagna/media/` within the workspace. */
export class VsCodeMediaRepository implements MediaPort {
  readonly isAvailable = true;

  constructor(private readonly _workspaceRoot: vscode.Uri) {}

  async save(bytes: Uint8Array, ext: string): Promise<string> {
    // Defence in depth: `ext` is interpolated into the filename and joinPath
    // normalizes `..`, so an unvalidated value could escape the media folder.
    if (!/^[a-z0-9]{1,8}$/i.test(ext)) {
      throw new Error('Refusing to write media with a suspicious extension.');
    }
    const dir = vscode.Uri.joinPath(this._workspaceRoot, ...MEDIA_DIR);
    await vscode.workspace.fs.createDirectory(dir);

    // Content-hashed name dedupes identical images and avoids collisions.
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const name = `${hash}.${ext}`;
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, name), bytes);

    return [...MEDIA_DIR, name].join('/');
  }
}
