#!/usr/bin/env node
// Fails if the packaged .vsix contains anything we did not deliberately ship.
//
// The .vsix is published to the Marketplace and Open VSX: public, and for
// practical purposes permanent. `.vscodeignore` is a denylist, so a new kind of
// local file (a board under .lavagna/, an agent folder, a stray dotfile) leaks
// by default and nobody notices — none of it shows up in `git status` either,
// because it is all gitignored. This check inverts that: every entry in the
// archive must match an explicit allowlist, so anything new is a hard failure
// until someone adds it here on purpose.
//
//   node scripts/check-vsix.mjs            # after `pnpm --filter lavagna run package`
//   pnpm check-vsix                        # package, then check
import { execFileSync } from 'node:child_process';
import { openSync, readSync, fstatSync, closeSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(root, 'apps', 'extension');

// --- what is allowed to ship -------------------------------------------------

/** Exact archive paths. vsce lowercases readme/changelog and adds .txt to LICENSE. */
const ALLOWED_FILES = new Set([
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/package.json',
  'extension/readme.md',
  'extension/changelog.md',
  'extension/LICENSE.txt',
  'extension/THIRD_PARTY_NOTICES.md',
  'extension/dist/extension.js',
  'extension/media/icon.png',
  'extension/media/spiral.svg',
  'extension/media/blank-canvas.png',
  'extension/media/webview.js',
]);

/**
 * The bundled skills: `extension/skills/<p>` ships if and only if git tracks
 * `skills/<p>`. Their names are open-ended, but not anything-goes — an
 * untracked draft sitting in /skills must not reach the Marketplace, and a
 * tracked file missing from the package is a truncated skill.
 */
const SKILLS_PREFIX = 'extension/skills/';
const trackedSkills = gitTrackedSkills();

/** `git ls-files -z -- skills` from the repo root, mapped to their archive paths. */
function gitTrackedSkills() {
  let out;
  try {
    // argv array, no shell.
    out = execFileSync('git', ['ls-files', '-z', '--', 'skills'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    console.error(`✘ \`git ls-files -- skills\` failed in ${root}: ${String(error.message).trim()}`);
    console.error('  This check compares the bundled skills against git, so it needs git and a checkout.');
    process.exit(1);
  }
  const files = out.split('\0').filter(Boolean);
  if (files.length === 0) {
    console.error(`✘ git tracks nothing under ${join(root, 'skills')} — cannot verify the bundled skills.`);
    process.exit(1);
  }
  return new Set(files.map((file) => `extension/${file}`));
}

/** Must be present — a silently truncated package is a failure too. */
const REQUIRED_FILES = [
  'extension.vsixmanifest',
  'extension/package.json',
  'extension/dist/extension.js',
  'extension/media/webview.js',
  'extension/skills/manifest.json',
];

// --- what must never ship, allowlist or not ---------------------------------

/**
 * Belt and braces: these are reported as leaks even if someone widens the
 * allowlist above, and they name the thing that leaked rather than saying
 * "unexpected entry".
 */
const DENIED_SEGMENTS = [
  '.env', '.lavagna', '.claude', '.vscode', '.cursor', '.idea', '.git', '.npmrc', '.DS_Store',
  'CLAUDE.md', 'node_modules',
];
const DENIED_SUFFIXES = ['.map', '.vsix', '.log'];

function deniedReason(path) {
  for (const segment of path.split('/')) {
    for (const denied of DENIED_SEGMENTS) {
      // `.env` also catches `.env.local`; `.git` also catches `.gitignore`;
      // `.cursor` also catches `.cursorrules`.
      if (segment === denied || segment.startsWith(`${denied}.`) || segment.startsWith(denied)) {
        return `contains \`${denied}\``;
      }
    }
  }
  for (const suffix of DENIED_SUFFIXES) {
    if (path.endsWith(suffix)) { return `ends in \`${suffix}\``; }
  }
  return null;
}

/** Undefined when the entry may ship; otherwise the verdict to print. */
function notAllowedReason(path) {
  if (ALLOWED_FILES.has(path)) { return undefined; }
  if (path.startsWith(SKILLS_PREFIX)) {
    return trackedSkills.has(path) ? undefined : `NOT TRACKED (skills/${path.slice(SKILLS_PREFIX.length)} is not in git)`;
  }
  return 'NOT ALLOWED';
}

// --- reading the archive -----------------------------------------------------

// A .vsix is a zip. Read its central directory directly rather than shelling
// out to `unzip`, which is not installed everywhere (Windows) and would put a
// file name on a command line.
function zipEntries(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const tailLength = Math.min(size, 0xffff + 22);
    const tail = Buffer.alloc(tailLength);
    readSync(fd, tail, 0, tailLength, size - tailLength);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) { throw new Error(`${file} is not a zip archive (no end-of-central-directory record)`); }

    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === 0xffffffff || count === 0xffff) {
      throw new Error(`${file} uses ZIP64 — this checker cannot read it; inspect it by hand`);
    }

    const cd = Buffer.alloc(cdSize);
    readSync(fd, cd, 0, cdSize, cdOffset);

    const entries = [];
    let at = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(at) !== 0x02014b50) { throw new Error(`${file}: corrupt central directory at entry ${i}`); }
      const nameLength = cd.readUInt16LE(at + 28);
      const extraLength = cd.readUInt16LE(at + 30);
      const commentLength = cd.readUInt16LE(at + 32);
      const bytes = cd.readUInt32LE(at + 24);
      entries.push({ path: cd.toString('utf8', at + 46, at + 46 + nameLength), bytes });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

// --- locating the package ----------------------------------------------------

const { name, version } = JSON.parse(readFileSync(join(extDir, 'package.json'), 'utf8'));
const expected = `${name}-${version}.vsix`;
const found = readdirSync(extDir).filter((f) => f.endsWith('.vsix'));

if (!found.includes(expected)) {
  console.error(`✘ ${expected} not found in apps/extension.`);
  console.error('  Run `pnpm --filter lavagna run package` first, or `pnpm check-vsix` to do both.');
  process.exit(1);
}
const stale = found.filter((f) => f !== expected);

// --- the check ---------------------------------------------------------------

const entries = zipEntries(join(extDir, expected)).sort((a, b) => a.path.localeCompare(b.path));
const problems = [];

console.log(`${expected} — ${entries.length} entries\n`);
for (const { path, bytes } of entries) {
  const denied = deniedReason(path);
  const verdict = denied ? `LEAK (${denied})` : notAllowedReason(path) ?? 'ok';
  if (verdict !== 'ok') { problems.push(`${path} — ${verdict}`); }
  console.log(`  ${verdict === 'ok' ? ' ' : '✘'} ${path.padEnd(46)} ${String(bytes).padStart(8)} B  ${verdict}`);
}

const present = new Set(entries.map((e) => e.path));
for (const required of REQUIRED_FILES) {
  if (!present.has(required)) { problems.push(`${required} — MISSING from the package`); }
}
for (const tracked of trackedSkills) {
  if (!present.has(tracked)) { problems.push(`${tracked} — MISSING from the package (tracked in git)`); }
}

console.log('');
if (stale.length) {
  console.warn(`⚠ other .vsix files in apps/extension (not checked): ${stale.join(', ')}`);
  console.warn('  Delete them so a stale build is never published by mistake.\n');
}

if (problems.length) {
  console.error(`✘ ${problems.length} problem(s) with ${expected}:`);
  for (const problem of problems) { console.error(`    ${problem}`); }
  console.error('\n  Nothing local or secret may ship. A NOT TRACKED skill file: commit it or delete it,');
  console.error('  then rebuild (the build copies only git-tracked skill files). Otherwise fix');
  console.error('  apps/extension/.vscodeignore, or —');
  console.error('  if the entry genuinely belongs in the package — add it to the allowlist in');
  console.error('  scripts/check-vsix.mjs, deliberately and in its own commit.');
  process.exit(1);
}

console.log(`✔ ${expected}: every entry is on the allowlist and nothing local leaked.`);
