#!/usr/bin/env node
// Writes apps/extension/THIRD_PARTY_NOTICES.md from the extension's production
// dependency tree — every package esbuild bundles into dist/ and media/.
// Their licences (MIT and friends) require the notice to travel with the code,
// and the .vsix is where the code travels. Run after changing dependencies:
//
//   node scripts/third-party-notices.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(root, 'apps', 'extension');

// Content assets and code vendored inside an npm package are not packages
// themselves, so `pnpm licenses list` can never see them. This block is
// hand-written and appended verbatim on every run, so the attribution survives
// regeneration. Add to it when a new licensed asset or embedded third-party
// code ships in the .vsix.
const ASSET_NOTICES = `
---

# Embedded code

## StackBlur

http://www.quasimondo.com/StackBlurForCanvas — Copyright (c) 2010 Mario
Klingemann, MIT.

Konva's \`Blur\` filter embeds StackBlur 0.5, so it is part of
\`media/webview.js\`. The notice below is the one carried in Konva's source.

\`\`\`
StackBlur - a fast almost Gaussian Blur For Canvas

Version:   0.5
Author:    Mario Klingemann
Website:   http://www.quasimondo.com/StackBlurForCanvas

Copyright (c) 2010 Mario Klingemann

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
\`\`\`

---

# Assets

The extension also ships artwork derived from third-party font software.

## Noto Sans Cham

https://github.com/notofonts/cham — Copyright 2022 The Noto Project Authors,
SIL Open Font License 1.1.

\`media/icon.png\` and \`media/spiral.svg\` are drawn from the outline of
U+AA5C CHAM PUNCTUATION SPIRAL as it appears in Noto Sans Cham. Glyph outlines
used as artwork are not Font Software under the OFL, so no OFL obligation
attaches to these files and the Reserved Font Name "Noto" is not used for
them; the attribution is given because it is owed in courtesy, and the full
licence text is committed at \`packages/brand/OFL.txt\` in the source
repository.
`;

// `pnpm` is `pnpm.cmd` on Windows, and execFile does not consult PATHEXT.
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const raw = execFileSync(pnpm, ['licenses', 'list', '--prod', '--json', '--filter', 'lavagna'], {
  cwd: root,
  encoding: 'utf8',
});
const byLicense = JSON.parse(raw);

// Each entry carries a singular `name` and parallel `versions[]` / `paths[]`
// arrays — one pair per version of that package in the tree. Both have to be
// walked: a package resolved at two versions is bundled twice, and a notice
// file that under-reports is the one bug this file cannot have.
const packages = [];
for (const [license, entries] of Object.entries(byLicense)) {
  for (const entry of entries) {
    entry.versions.forEach((version, i) => {
      packages.push({ name: entry.name, version, license, dir: entry.paths[i], homepage: entry.homepage });
    });
  }
}
// Type-only packages never reach the bundle.
const bundled = packages.filter((p) => !p.name.startsWith('@types/'));
bundled.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

function licenseText(dir) {
  if (!dir || !existsSync(dir)) { return null; }
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

let out = `# Third-party notices

Lavagna bundles the following open-source packages into its published
extension (\`dist/extension.js\` and \`media/webview.js\`). Each is used under
the licence indicated; the full licence texts follow.

| Package | Version | Licence |
| --- | --- | --- |
`;
for (const p of bundled) {
  out += `| ${p.name} | ${p.version} | ${p.license} |\n`;
}
out += '\n';
for (const p of bundled) {
  const text = licenseText(p.dir);
  out += `\n---\n\n## ${p.name}@${p.version}\n\n`;
  if (p.homepage) { out += `${p.homepage}\n\n`; }
  out += text ? '```\n' + text + '\n```\n' : `_Licence: ${p.license} (no licence file shipped in the package)._\n`;
}
out += ASSET_NOTICES;
writeFileSync(join(extDir, 'THIRD_PARTY_NOTICES.md'), out);
console.log(`Wrote THIRD_PARTY_NOTICES.md for ${bundled.length} packages + assets.`);
