#!/usr/bin/env node
// Fails when a committed brand asset has drifted from packages/brand/exports/.
//
// The extension copies its two files at build time into gitignored destinations,
// so it cannot drift. The website can: GitHub Pages serves docs/ straight from
// git, so docs/assets/ holds real committed copies, and nothing otherwise notices
// when a rebuilt export is not copied across. Run after the brand build:
//
//   node scripts/check-brand-sync.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exports_ = join(root, 'packages', 'brand', 'exports');

// export in packages/brand/exports → committed copy, relative to the repo root
const COPIES = {
  'favicon.svg': 'docs/assets/favicon.svg',
  'favicon.ico': 'docs/assets/favicon.ico',
  'apple-touch-icon.png': 'docs/assets/apple-touch-icon.png',
  'og-image.png': 'docs/assets/og-image.png',
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const problems = [];

for (const [name, copy] of Object.entries(COPIES)) {
  const from = join(exports_, name);
  const to = join(root, copy);
  if (!existsSync(from)) {
    problems.push(`packages/brand/exports/${name} is missing — run \`pnpm --filter @lavagna/brand run build\`.`);
    continue;
  }
  if (!existsSync(to)) {
    problems.push(`${copy} is missing — copy packages/brand/exports/${name} there.`);
    continue;
  }
  if (sha(from) !== sha(to)) {
    problems.push(`${copy} differs from packages/brand/exports/${name} — copy the export across and commit it.`);
  }
}

// The exports are generated, so their own checksum file should agree with them.
// A mismatch means someone edited exports/ by hand instead of editing src/.
const checksums = join(exports_, 'CHECKSUMS.txt');
if (!existsSync(checksums)) {
  problems.push('packages/brand/exports/CHECKSUMS.txt is missing — run the brand build.');
} else {
  for (const line of readFileSync(checksums, 'utf8').split('\n').filter(Boolean)) {
    const [want, name] = line.split(/\s+/);
    const file = join(exports_, name);
    if (!existsSync(file)) {
      problems.push(`packages/brand/exports/${name} is listed in CHECKSUMS.txt but missing.`);
    } else if (sha(file) !== want) {
      problems.push(`packages/brand/exports/${name} does not match CHECKSUMS.txt — exports/ is generated, edit src/ and rebuild.`);
    }
  }
}

if (problems.length) {
  console.error('Brand assets are out of sync:\n');
  for (const p of problems) { console.error(`  - ${p}`); }
  console.error('');
  process.exit(1);
}
console.log(`Brand assets in sync (${Object.keys(COPIES).length} committed copies, checksums verified).`);
