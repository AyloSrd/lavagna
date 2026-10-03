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
// Names are not enough: a file on the allowlist can still carry a local path, a
// token or an unexpected e-mail address inside it, so every text entry is also
// decompressed and scanned (see "what must never appear inside a file").
//
//   node scripts/check-vsix.mjs            # after `pnpm --filter lavagna run package`
//   pnpm check-vsix                        # package, then check
//   node scripts/check-vsix.mjs some.vsix  # check one explicit file instead
import { execFileSync } from 'node:child_process';
import { openSync, readSync, fstatSync, closeSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

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

/**
 * The skills ship only while package.json contributes the Skills view — the
 * same switch esbuild.js reads. When it doesn't, the package must carry no
 * skill file at all.
 */
const extensionManifest = JSON.parse(readFileSync(join(extDir, 'package.json'), 'utf8'));
const shipsSkills = Object.values(extensionManifest.contributes?.views ?? {})
  .flat()
  .some((view) => view && view.id === 'lavagna.skills');
const trackedSkills = shipsSkills ? gitTrackedSkills() : new Set();

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
  ...(shipsSkills ? ['extension/skills/manifest.json'] : []),
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
    if (!shipsSkills) { return 'NOT SHIPPED (skills are not released: package.json contributes no Skills view)'; }
    return trackedSkills.has(path) ? undefined : `NOT TRACKED (skills/${path.slice(SKILLS_PREFIX.length)} is not in git)`;
  }
  return 'NOT ALLOWED';
}

// --- what must never appear inside a file ----------------------------------

/** Entries whose bytes are scanned. Everything else (png, …) is binary. */
const TEXT_SUFFIXES = ['.js', '.json', '.md', '.txt', '.xml', '.svg', '.vsixmanifest'];
const isTextEntry = (path) => TEXT_SUFFIXES.some((suffix) => path.endsWith(suffix));

const CONTENT_RULES = [
  // A developer's home directory baked in by a bundler, a stack trace or a pasted log.
  // The Windows form is matched with one to four backslashes: raw text, a JS
  // string literal (`C:\\Users\\`) and a JSON-in-a-string literal.
  { kind: 'local path', pattern: /\/Users\/[^\s"'`<>)]*|\/home\/[^\s"'`<>)]*|[A-Za-z]:\\{1,4}Users\\{1,4}[^\s"'`<>)]*/g },
  // Credentials. Prefix-anchored so ordinary base64 does not trip them.
  {
    kind: 'token',
    secret: true,
    pattern: new RegExp(
      [
        'gh[pousr]_[A-Za-z0-9]{20,}', // GitHub: personal, OAuth, user-to-server, server-to-server, refresh
        'github_pat_[A-Za-z0-9_]{20,}',
        'npm_[A-Za-z0-9]{30,}',
        'AKIA[0-9A-Z]{16}',
        '-----BEGIN [A-Z ]*PRIVATE KEY',
        'xox[baprs]-[A-Za-z0-9-]*',
      ].join('|'),
      'g',
    ),
  },
  // Sourcemaps are denied by name; a reference to one inside the bundle is the
  // same leak (it points at, or inlines, the original sources).
  { kind: 'sourcemap', pattern: /sourceMappingURL/g },
  // A TLD-looking domain is required, so \`@xyflow/react\`, \`@media\` and
  // \`pkg@1.2.3\` are not addresses. \`name@2x.png\` is a file name: see below.
  { kind: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/g },
];

/**
 * E-mail addresses that may ship. The first two are the StackBlur author's,
 * from the licence comment Konva embeds (see THIRD_PARTY_NOTICES.md).
 */
const ALLOWED_EMAILS = new Set(['mario@quasimondo.com', 'mario@quasimondo.de']);
const FILE_LIKE_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'ico', 'css', 'js', 'json', 'woff', 'woff2']);

function emailAllowed(address) {
  const lower = address.toLowerCase();
  const tld = lower.slice(lower.lastIndexOf('.') + 1);
  return (
    ALLOWED_EMAILS.has(lower) ||
    lower.endsWith('@users.noreply.github.com') ||
    lower.startsWith('noreply@') ||
    FILE_LIKE_TLDS.has(tld) // \`icon@2x.png\`, not an address
  );
}

/** At most this many distinct matches per rule per entry are printed. */
const MAX_REPORTED = 5;

/** `{ what, line }` per finding in one text entry; `what` is `content: <kind>: <match>`. */
function scanContent(text) {
  const findings = [];
  for (const { kind, pattern, secret } of CONTENT_RULES) {
    const seen = new Set();
    let hidden = 0;
    for (const m of text.matchAll(pattern)) {
      if (kind === 'email' && emailAllowed(m[0])) { continue; }
      if (seen.has(m[0])) { continue; }
      seen.add(m[0]);
      if (seen.size > MAX_REPORTED) { hidden++; continue; }
      // Never echo a whole credential into a terminal or a CI log.
      const shown = secret ? `${m[0].slice(0, 8)}…` : m[0];
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({ what: `content: ${kind}: ${shown.length > 60 ? `${shown.slice(0, 60)}…` : shown}`, line });
    }
    if (hidden) { findings.push({ what: `content: ${kind}: … and ${hidden} more distinct match(es)` }); }
  }
  return findings;
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
      const flags = cd.readUInt16LE(at + 8);
      const method = cd.readUInt16LE(at + 10);
      const packed = cd.readUInt32LE(at + 20);
      const bytes = cd.readUInt32LE(at + 24);
      const localOffset = cd.readUInt32LE(at + 42);
      entries.push({
        path: cd.toString('utf8', at + 46, at + 46 + nameLength),
        bytes, packed, method, flags, localOffset,
      });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

/**
 * The uncompressed bytes of one entry. The sizes come from the central
 * directory (a local header may defer them to a data descriptor); the local
 * header is read only for the length of its name and extra field, which can
 * differ from the central copy. Only stored (0) and deflate (8) are handled;
 * anything else, or an encrypted entry, throws rather than being skipped.
 */
function readEntry(file, entry) {
  if (entry.flags & 0x1) { throw new Error('encrypted entry'); }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`unsupported compression method ${entry.method} (only 0 stored and 8 deflate)`);
  }
  const fd = openSync(file, 'r');
  try {
    const header = Buffer.alloc(30);
    if (readSync(fd, header, 0, 30, entry.localOffset) !== 30 || header.readUInt32LE(0) !== 0x04034b50) {
      throw new Error('corrupt local file header');
    }
    const start = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const packed = Buffer.alloc(entry.packed);
    if (readSync(fd, packed, 0, entry.packed, start) !== entry.packed) { throw new Error('truncated entry data'); }
    // maxOutputLength: a lying header must not turn into a decompression bomb.
    const data = entry.method === 0
      ? packed
      : inflateRawSync(packed, { maxOutputLength: Math.max(entry.bytes, 1) });
    if (data.length !== entry.bytes) {
      throw new Error(`size mismatch (header says ${entry.bytes} B, got ${data.length} B)`);
    }
    return data;
  } finally {
    closeSync(fd);
  }
}

// --- locating the package ----------------------------------------------------

const { name, version } = extensionManifest;
const explicit = process.argv[2];
if (process.argv.length > 3 || explicit?.startsWith('-')) {
  console.error('usage: node scripts/check-vsix.mjs [path/to/file.vsix]');
  process.exit(2);
}

let expected = `${name}-${version}.vsix`;
let vsixPath = join(extDir, expected);
let stale = [];
if (explicit) {
  vsixPath = resolve(explicit);
  expected = vsixPath.split(/[\\/]/).pop();
} else {
  const found = readdirSync(extDir).filter((f) => f.endsWith('.vsix'));
  if (!found.includes(expected)) {
    console.error(`✘ ${expected} not found in apps/extension.`);
    console.error('  Run `pnpm --filter lavagna run package` first, or `pnpm check-vsix` to do both.');
    process.exit(1);
  }
  stale = found.filter((f) => f !== expected);
}

// --- the check ---------------------------------------------------------------

const entries = zipEntries(vsixPath).sort((a, b) => a.path.localeCompare(b.path));
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

// Names passed; now look inside. Done for every text entry, allowlisted or not.
console.log('\ncontent scan:');
let scanned = 0;
for (const entry of entries) {
  if (!isTextEntry(entry.path)) { continue; }
  scanned++;
  let findings;
  try {
    findings = scanContent(readEntry(vsixPath, entry).toString('utf8'));
  } catch (error) {
    findings = [{ what: `content: UNREADABLE: ${error.message}` }];
  }
  for (const { what, line } of findings) {
    const verdict = `LEAK (${what})${line ? ` line ${line}` : ''}`;
    problems.push(`${entry.path} — ${verdict}`);
    console.log(`  ✘ ${entry.path.padEnd(46)} ${verdict}`);
  }
}
console.log(`  ${scanned} text entries scanned\n`);

// Releases are uploaded by hand from this folder, so a leftover file from an
// earlier version (or an unchecked rebuild under another name) is one wrong
// click from being published.
for (const file of stale) {
  problems.push(`${file} — STALE .vsix in apps/extension (not this build; delete it)`);
}

if (problems.length) {
  console.error(`✘ ${problems.length} problem(s) with ${expected}:`);
  for (const problem of problems) { console.error(`    ${problem}`); }
  console.error('\n  Nothing local or secret may ship. A content LEAK means the build embedded it: remove the')
  console.error('  source (an e-mail address that is genuinely fine goes in ALLOWED_EMAILS). A STALE .vsix: delete it.')
  console.error('  A NOT TRACKED skill file: commit it or delete it,');
  console.error('  then rebuild (the build copies only git-tracked skill files). Otherwise fix');
  console.error('  apps/extension/.vscodeignore, or —');
  console.error('  if the entry genuinely belongs in the package — add it to the allowlist in');
  console.error('  scripts/check-vsix.mjs, deliberately and in its own commit.');
  process.exit(1);
}

console.log(`✔ ${expected}: every entry is on the allowlist and nothing local leaked.`);
