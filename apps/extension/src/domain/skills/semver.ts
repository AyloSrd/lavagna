// Tiny semver comparator — enough to tell whether an installed skill is older
// than the bundled one. No dependency: the whole extension is bundled, and
// skill versions are strings we write ourselves.

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers; empty for a release. */
  prerelease: string[];
}

// Digits are capped at 9 per component: `Number()` on a longer run silently
// loses precision (`'9'.repeat(21)` becomes 1e21) and the comparison stops
// meaning anything. A version that long isn't one.
const SEMVER = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(text: string): Semver | undefined {
  const match = SEMVER.exec(text.trim());
  if (!match) {
    return undefined;
  }
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ? prerelease.split('.') : [],
  };
}

/** Negative when `a < b`, zero when equal, positive when `a > b`. Both must parse. */
export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  if (a.patch !== b.patch) {
    return a.patch - b.patch;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

/** Convenience over strings; undefined when either side isn't valid semver. */
export function compareVersions(a: string, b: string): number | undefined {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  return pa && pb ? compareSemver(pa, pb) : undefined;
}

// A release outranks any prerelease of the same version; otherwise identifiers
// compare pairwise, numeric ones numerically and before alphanumeric ones.
function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) {
    return 0;
  }
  if (a.length === 0) {
    return 1;
  }
  if (b.length === 0) {
    return -1;
  }
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] === undefined) {
      return -1;
    }
    if (b[i] === undefined) {
      return 1;
    }
    // Same digit cap as SEMVER: a longer run compares as a string rather than
    // as a number that has lost its low digits.
    const na = /^\d{1,9}$/.test(a[i]) ? Number(a[i]) : undefined;
    const nb = /^\d{1,9}$/.test(b[i]) ? Number(b[i]) : undefined;
    if (na !== undefined && nb !== undefined) {
      if (na !== nb) {
        return na - nb;
      }
    } else if (na !== undefined) {
      return -1;
    } else if (nb !== undefined) {
      return 1;
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}
