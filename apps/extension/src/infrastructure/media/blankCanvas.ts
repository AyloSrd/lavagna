import * as vscode from 'vscode';

const SEED = ['media', 'blank-canvas.png'];

let cached: Uint8Array | undefined;

/**
 * Bytes of the bundled blank canvas, used when the user picks "blank page" in
 * the chooser. Written into `.lavagna/media/` through MediaPort like any other
 * image, so it is content-hashed and deduped across boards.
 */
export async function blankCanvasBytes(extensionUri: vscode.Uri): Promise<Uint8Array> {
  if (!cached) {
    cached = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, ...SEED));
  }
  return cached;
}
