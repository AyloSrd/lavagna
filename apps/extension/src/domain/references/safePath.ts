// Validation for path-like strings that come out of board content. Boards are
// untrusted (git pull, teammates, AI output), so every consumer of a board
// target must run it through here before touching the filesystem.
//
// Pure — the workspace-containment half needs `realpath` and lives in the
// infrastructure layer; this is the string-level gate.

/**
 * Reject targets that must never be resolved:
 *  - absolute (`/etc/passwd`, `\\server\share`, `C:\…`) — a board has no
 *    business naming a location outside the document's own tree;
 *  - any `..` segment — the only traversal primitive `Uri.joinPath` honours;
 *  - a leading `//`, which `Uri.file` turns into a URI *authority*, producing a
 *    UNC path and an outbound SMB connection (credential leak) on Windows;
 *  - control characters, which have no place in a path and can hide the rest of
 *    the string in the UI.
 */
export function isSafeRelativePath(target: string): boolean {
  if (!target || target.length > 1024) {
    return false;
  }
  if (/[\u0000-\u001f\u007f]/.test(target)) {
    return false;
  }
  if (target.startsWith('/') || target.startsWith('\\')) {
    return false;
  }
  if (/^[A-Za-z]:/.test(target)) {
    return false; // drive-letter absolute
  }
  return !target
    .split(/[/\\]/)
    .some((segment) => segment === '..');
}
