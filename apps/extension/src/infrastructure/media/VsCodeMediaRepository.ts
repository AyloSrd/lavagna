import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { MediaPort } from '../../application/ports/MediaPort';
import { log } from '../logging/log';
import { ContainmentError } from '../paths/realPath';
import { createFileExclusive, inspectWriteTarget, WriteTarget } from '../paths/writeTarget';

const MEDIA_DIR = ['.lavagna', 'media'];

/**
 * Writes media files into `.lavagna/media/` within the workspace.
 *
 * The folder is part of the checkout, so a repository can plant anything in it
 * — and the file name is the hash of the bytes, which anyone can compute for
 * the bundled blank page. A committed `.lavagna/media/<hash>.png` (or
 * `.lavagna`, or `media`) that is a symlink to `.git/config` or `~/.bashrc`
 * would turn a click on "Blank page" into an overwrite of that file. So on a
 * local workspace nothing is written until the whole path down from the
 * workspace root is shown to be real folders and the file is either absent or
 * already a regular file.
 */
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
    // Content-hashed name dedupes identical images and avoids collisions.
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const name = `${hash}.${ext}`;
    const target = vscode.Uri.joinPath(dir, name);
    const relative = [...MEDIA_DIR, name].join('/');

    try {
      if (this._workspaceRoot.scheme === 'file') {
        await this._saveLocal(dir, target, bytes, relative);
      } else {
        await this._saveVirtual(dir, target, bytes, relative);
      }
    } catch (error) {
      if (error instanceof ContainmentError) {
        log(`media: ${error.message}`);
        throw new Error(
          `Lavagna: refusing to write ${relative} — .lavagna/media must be a real folder inside the workspace, with no symbolic links, and the image path must be free or a plain file.`,
        );
      }
      throw error;
    }
    return relative;
  }

  /** A folder on the local disk, where git can have committed symlinks. */
  private async _saveLocal(
    dir: vscode.Uri,
    target: vscode.Uri,
    bytes: Uint8Array,
    relative: string,
  ): Promise<void> {
    const root = this._workspaceRoot.fsPath;
    // Before `mkdir`, which would happily create through a link…
    await inspectWriteTarget(target.fsPath, root);
    await vscode.workspace.fs.createDirectory(dir);
    // …and after, to see what is really there now.
    const existing = await inspectWriteTarget(target.fsPath, root);
    if (this._sameOrRefuse(existing, bytes, relative)) {
      return;
    }
    // `wx` (O_EXCL) refuses a symlink or a file that appeared since the check.
    if (await createFileExclusive(target.fsPath, bytes)) {
      return;
    }
    const raced = await inspectWriteTarget(target.fsPath, root);
    if (raced.kind === 'absent' || !this._sameOrRefuse(raced, bytes, relative)) {
      throw new Error(`Lavagna: could not create ${relative} — try again.`);
    }
  }

  /**
   * A virtual workspace (`vscode-vfs://…`). Its `fsPath` names nothing on the
   * local disk, so the Node checks don't apply — and the providers behind such
   * schemes (GitHub, remote repositories) have no symlinks to follow. Kept to
   * what `workspace.fs` can say: an existing entry must be a plain file.
   */
  private async _saveVirtual(
    dir: vscode.Uri,
    target: vscode.Uri,
    bytes: Uint8Array,
    relative: string,
  ): Promise<void> {
    await vscode.workspace.fs.createDirectory(dir);
    let existing: WriteTarget = { kind: 'absent' };
    try {
      const stat = await vscode.workspace.fs.stat(target);
      if (stat.type !== vscode.FileType.File) {
        throw new ContainmentError(`${target.toString()} exists and is not a regular file`);
      }
      existing = { kind: 'file', size: stat.size };
    } catch (error) {
      if (error instanceof ContainmentError) {
        throw error;
      }
      // Not there (or not statable): fall through to the write.
    }
    if (this._sameOrRefuse(existing, bytes, relative)) {
      return;
    }
    await vscode.workspace.fs.writeFile(target, bytes);
  }

  /**
   * True when `relative` already holds these bytes, so there is nothing to
   * write. Same name means same content hash: identical bytes are there, and
   * nothing is overwritten. A regular file of another size under that name is
   * not ours; leave it and say so. False when the name is free.
   */
  private _sameOrRefuse(existing: WriteTarget, bytes: Uint8Array, relative: string): boolean {
    if (existing.kind !== 'file') {
      return false;
    }
    if (existing.size === bytes.byteLength) {
      return true;
    }
    throw new Error(
      `Lavagna: ${relative} already exists with different content — move or delete it, then try again.`,
    );
  }
}
