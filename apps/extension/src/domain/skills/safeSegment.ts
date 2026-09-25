// The single rule that keeps catalogue content from escaping a skills folder.
//
// Every path the extension builds for a skill is `<skillsDir>/<id>` plus the
// '/'-separated segments of a file inside the skill. Both come from data —
// today the bundled `skills/manifest.json`, tomorrow possibly a downloaded
// catalogue — and both end up in a recursive delete followed by a write. A
// segment is therefore accepted only when it is a plain name: no separator, no
// drive letter, no `.` or `..`, nothing that a filesystem resolves upwards.

/**
 * One path segment: starts with a letter or digit, then letters, digits, dots,
 * dashes and underscores, at most 64 characters. Deliberately strict — it has
 * to reject `..`, `.`, ``, `/etc`, `a/b`, `C:` and `\\server\share` without
 * relying on any later normalisation.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class UnsafeSegmentError extends Error {
  constructor(what: string, value: unknown) {
    super(`Unsafe ${what}: ${JSON.stringify(value)}`);
    this.name = 'UnsafeSegmentError';
  }
}

export function isSafeSegment(value: unknown): value is string {
  return typeof value === 'string' && value !== '.' && value !== '..' && SAFE_SEGMENT.test(value);
}

/** Every '/'- or '\'-separated segment of `value` is safe, and there is at least one. */
export function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') {
    return false;
  }
  const segments = value.split(/[\\/]/);
  return segments.length > 0 && segments.every(isSafeSegment);
}

export function assertSafeSegment(value: unknown, what: string): asserts value is string {
  if (!isSafeSegment(value)) {
    throw new UnsafeSegmentError(what, value);
  }
}

export function assertSafeRelativePath(value: unknown, what: string): asserts value is string {
  if (!isSafeRelativePath(value)) {
    throw new UnsafeSegmentError(what, value);
  }
}
