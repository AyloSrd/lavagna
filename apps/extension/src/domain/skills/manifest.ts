// Shape of the bundled `skills/manifest.json`. Validated by shape, never by
// skill id: the catalogue grows without the extension knowing the names. What
// *is* checked is that `id` and `path` are plain path segments — `id` becomes
// the folder the installer deletes and rewrites, so a manifest can never name
// a destination outside the skills directory.

import { isSafeRelativePath, isSafeSegment } from './safeSegment';

export interface ManifestEntry {
  id: string;
  path: string;
  title: string;
  summary: string;
  core: boolean;
}

export class InvalidManifestError extends Error {
  constructor(reason: string) {
    super(`Invalid skills manifest: ${reason}`);
    this.name = 'InvalidManifestError';
  }
}

/** Accepts the parsed JSON of the manifest; throws InvalidManifestError when it doesn't fit. */
export function parseManifest(json: unknown): ManifestEntry[] {
  if (!isRecord(json)) {
    throw new InvalidManifestError('not an object');
  }
  if (json.version !== 1) {
    throw new InvalidManifestError(`unsupported version ${String(json.version)}`);
  }
  if (!Array.isArray(json.skills)) {
    throw new InvalidManifestError('"skills" is not an array');
  }
  const seen = new Set<string>();
  return json.skills.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new InvalidManifestError(`skill #${index} is not an object`);
    }
    for (const field of ['id', 'path', 'title', 'summary'] as const) {
      if (typeof entry[field] !== 'string' || !entry[field]) {
        throw new InvalidManifestError(`skill #${index} has no "${field}"`);
      }
    }
    // `id` is the destination folder name; a single safe segment, nothing else.
    if (!isSafeSegment(entry.id)) {
      throw new InvalidManifestError(`skill #${index} has an unsafe id ${JSON.stringify(entry.id)}`);
    }
    // `path` addresses a folder inside the bundle; every segment must be safe.
    if (!isSafeRelativePath(entry.path)) {
      throw new InvalidManifestError(`skill #${index} has an unsafe path ${JSON.stringify(entry.path)}`);
    }
    const id = entry.id as string;
    if (seen.has(id)) {
      // Two entries would fight over one directory, and the tree would throw on
      // the duplicate TreeItem id.
      throw new InvalidManifestError(`duplicate skill id "${id}"`);
    }
    seen.add(id);
    return {
      id,
      path: entry.path as string,
      title: entry.title as string,
      summary: entry.summary as string,
      core: entry.core === true,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
