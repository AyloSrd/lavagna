// Regenerates everything in exports/ from src/. Run with `pnpm --filter @lavagna/brand run build`.
//
// Sources are SVG; rasterisation is @resvg/resvg-js with the fonts vendored in
// fonts/ and nothing from the host, so every export is byte-reproducible on any
// platform. The only non-trivial steps are the ICO container (hand-written below,
// PNG-in-ICO) and the activity-bar mark, which is the spiral re-fitted into a
// 24×24 box.
//
// mark.svg holds the one copy of the outline. The other sources carry a
// {{MARK_PATH}} placeholder that is substituted here, so the path cannot go stale
// in three files at once. The cost is that those sources draw no spiral until the
// build runs — that is deliberate: an obviously unfinished file beats a silently
// wrong one.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, 'src');
const OUT = join(here, 'exports');
const FONTS = join(here, 'fonts');
mkdirSync(OUT, { recursive: true });

const read = (name) => readFileSync(join(SRC, name), 'utf8');
const written = [];
const write = (name, data) => {
  writeFileSync(join(OUT, name), data);
  written.push(name);
  console.log(`  ${name}`);
};

// ---------------------------------------------------------------------------
// Fonts. Only the OG image contains text. It renders with the vendored Inter and
// nothing else: no system fonts are loaded, so the result does not depend on what
// the build machine happens to have installed. The sources also pin every string
// with `textLength`, so even a viewer without Inter gets the same layout.
// See fonts/README.md for provenance.
const font = {
  loadSystemFonts: false,
  fontFiles: [join(FONTS, 'inter-latin-400-normal.ttf'), join(FONTS, 'inter-latin-600-normal.ttf')],
  defaultFontFamily: 'Inter',
};

const png = (svg, width, extra = {}) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: width }, font, ...extra }).render().asPng();

// ---------------------------------------------------------------------------
// ICO container: PNG-encoded entries (supported everywhere since Windows Vista).
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = header.length + dir.length;
  pngs.forEach((buf, i) => {
    // Fixed offsets 16 and 20 are the IHDR's width and height. The PNG spec
    // requires IHDR to be the first chunk, and the signature plus the chunk
    // length and type are a fixed 16 bytes, so these offsets always land on it.
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const e = i * 16;
    dir.writeUInt8(w >= 256 ? 0 : w, e);
    dir.writeUInt8(h >= 256 ? 0 : h, e + 1);
    dir.writeUInt8(0, e + 2); // palette size
    dir.writeUInt8(0, e + 3); // reserved
    dir.writeUInt16LE(1, e + 4); // colour planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32LE(buf.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...pngs]);
}

// ---------------------------------------------------------------------------
// The mark, injected into every source that draws it.
const MARK_PLACEHOLDER = '{{MARK_PATH}}';

// The path grammar the code below understands: absolute M, L, Q and Z with plain
// decimal numbers. mark.svg is a cleaned glyph extraction and uses exactly that;
// anything else (H, V, C, A, a relative form, exponent notation) would be dropped
// by the tokeniser and its coordinates silently appended to the previous command,
// so refuse it here instead of emitting a plausible-looking wrong icon.
const PATH_ALPHABET = /^[MLQZ0-9.\s-]+$/;

function markPath() {
  const svg = read('mark.svg');
  const m = svg.match(/ d="([^"]+)"/);
  if (!m) {
    throw new Error('src/mark.svg: no element with a d attribute. It must hold exactly one path — it is the only copy of the outline.');
  }
  const d = m[1];
  if (!PATH_ALPHABET.test(d)) {
    const bad = d.match(/[^MLQZ0-9.\s-]/g);
    throw new Error(`src/mark.svg: unsupported path syntax ${JSON.stringify([...new Set(bad)].join(''))}. Only absolute M, L, Q, Z and plain decimal numbers are understood; re-express the path or teach parsePath() the new commands.`);
  }
  return d;
}

// `<!-- build: … -->` comments explain the placeholder to whoever opens the
// source; they say nothing to whoever opens the export (favicon.svg is icon.svg),
// so they are dropped on the way out.
const BUILD_NOTE = /[ \t]*<!--\s*build:[\s\S]*?-->\n?/g;

function withMark(name, d) {
  const svg = read(name);
  if (!svg.includes(MARK_PLACEHOLDER)) {
    throw new Error(`src/${name}: expected the ${MARK_PLACEHOLDER} placeholder. Every source that draws the mark takes it from src/mark.svg at build time; do not paste the outline in.`);
  }
  return svg.replace(BUILD_NOTE, '').replaceAll(MARK_PLACEHOLDER, d);
}

// ---------------------------------------------------------------------------
// Activity-bar mark: mark.svg re-fitted into a 24-unit box with 2 units of
// padding. The commands are transformed in place, so the export keeps the glyph's
// curves — the earlier version flattened them to a 673-point polygon to apply a
// 0.12-unit inset, which is an eighth of a pixel at the size the icon is drawn
// and well under the rasteriser's own antialiasing.
const ACTIVITY_SIZE = 24, ACTIVITY_PAD = 2;

function parsePath(d) {
  const tokens = d.match(/[MLQZ]|-?\d*\.?\d+/g) ?? [];
  const segs = [];
  for (let i = 0; i < tokens.length; ) {
    const cmd = tokens[i++];
    const nums = [];
    while (i < tokens.length && !/^[A-Z]$/.test(tokens[i])) nums.push(parseFloat(tokens[i++]));
    if (nums.length % 2 !== 0) {
      throw new Error(`src/mark.svg: command ${cmd} has an odd number of coordinates (${nums.length}).`);
    }
    const pts = [];
    for (let k = 0; k < nums.length; k += 2) pts.push([nums[k], nums[k + 1]]);
    segs.push({ cmd, pts });
  }
  return segs;
}

// Exact bounding box of the outline. Control points are deliberately not measured:
// a quadratic lies strictly inside its control polygon, so using them would report
// a box larger than the glyph and the fit would come out slightly small and off
// centre. A quadratic has at most one extremum per axis, at
// t = (p0 − c) / (p0 − 2c + p2).
function bbox(segs) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const hit = ([x, y]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  let cur = null;
  for (const { cmd, pts } of segs) {
    if (cmd === 'M' || cmd === 'L') { cur = pts[0]; hit(cur); }
    else if (cmd === 'Q') {
      const [c, p] = pts;
      hit(p);
      for (const axis of [0, 1]) {
        const den = cur[axis] - 2 * c[axis] + p[axis];
        if (Math.abs(den) < 1e-12) continue;
        const t = (cur[axis] - c[axis]) / den;
        if (t <= 0 || t >= 1) continue;
        const u = 1 - t;
        hit([
          u * u * cur[0] + 2 * u * t * c[0] + t * t * p[0],
          u * u * cur[1] + 2 * u * t * c[1] + t * t * p[1],
        ]);
      }
      cur = p;
    }
  }
  return { minX, minY, maxX, maxY };
}

function activityBar(d) {
  const segs = parsePath(d);
  const { minX, minY, maxX, maxY } = bbox(segs);
  const inner = ACTIVITY_SIZE - 2 * ACTIVITY_PAD;
  const s = inner / Math.max(maxX - minX, maxY - minY);
  const ox = ACTIVITY_PAD + (inner - (maxX - minX) * s) / 2;
  const oy = ACTIVITY_PAD + (inner - (maxY - minY) * s) / 2;
  const r = (v) => String(Math.round(v * 100) / 100); // 0.01 of 24 units — a 400th of a pixel at 24px
  const path = segs
    .map(({ cmd, pts }) => cmd + pts.map(([x, y]) => `${r((x - minX) * s + ox)} ${r((y - minY) * s + oy)}`).join(' '))
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ACTIVITY_SIZE} ${ACTIVITY_SIZE}" width="${ACTIVITY_SIZE}" height="${ACTIVITY_SIZE}">
  <path fill="currentColor" d="${path}"/>
</svg>
`;
}

// ---------------------------------------------------------------------------
console.log('exports/');
const mark = markPath();
const iconSvg = withMark('icon.svg', mark);
const fullBleedSvg = withMark('icon-fullbleed.svg', mark);
const ogSvg = withMark('og-image.svg', mark);

for (const size of [128, 256, 512]) write(`icon-${size}.png`, png(iconSvg, size));

write('favicon.svg', iconSvg);
const fav16 = png(iconSvg, 16), fav32 = png(iconSvg, 32);
write('favicon-16.png', fav16);
write('favicon-32.png', fav32);
write('favicon.ico', ico([fav16, fav32]));

// iOS applies its own corner mask, so the touch icon is the full-bleed tile.
write('apple-touch-icon.png', png(fullBleedSvg, 180));

write('og-image.png', png(ogSvg, 1200));

write('activity-bar.svg', activityBar(mark));

// A future contributor seeing exports/ change can tell drift from intent: these
// sums move only when a source, a font or this script does. `cd exports &&
// sha256sum -c CHECKSUMS.txt` verifies them.
const sums = written
  .sort()
  .map((name) => `${createHash('sha256').update(readFileSync(join(OUT, name))).digest('hex')}  ${name}`)
  .join('\n');
writeFileSync(join(OUT, 'CHECKSUMS.txt'), sums + '\n');
console.log('  CHECKSUMS.txt');
