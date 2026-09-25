# Vendored fonts

`build.mjs` rasterises with **only** these files (`loadSystemFonts: false`), so
`exports/og-image.png` is the same bytes on every machine. Nothing here ships in
the extension or on the website; they are build inputs.

| File | What |
| --- | --- |
| `inter-latin-400-normal.ttf` | Inter Regular, latin subset — the OG tagline. |
| `inter-latin-600-normal.ttf` | Inter SemiBold, latin subset — the wordmark. |
| `OFL-Inter.txt` | Inter's licence: SIL Open Font License 1.1. |

## Provenance

Both come from [`@fontsource/inter`](https://www.npmjs.com/package/@fontsource/inter)
`5.3.0` (the Fontsource build of [rsms/inter](https://github.com/rsms/inter),
OFL 1.1), which ships `.woff2` only. resvg reads TrueType and OpenType, so they
were converted with `fontTools` — a container change, the outlines and tables
are untouched:

```sh
npm pack @fontsource/inter@5.3.0
tar xzf fontsource-inter-5.3.0.tgz \
  package/files/inter-latin-400-normal.woff2 \
  package/files/inter-latin-600-normal.woff2 \
  package/LICENSE
python3 -c "
from fontTools.ttLib import TTFont
for w in ('400', '600'):
    f = TTFont('package/files/inter-latin-%s-normal.woff2' % w)
    f.flavor = None
    f.save('inter-latin-%s-normal.ttf' % w)
"
cp package/LICENSE OFL-Inter.txt
```

To update, redo the above with a newer version and rebuild; `exports/` will
change, which is the point — the checksums in `exports/CHECKSUMS.txt` move with
it and the diff is reviewable.
