# Lavagna

A prompt-writing blackboard for VS Code and Cursor. Boards are plain markdown
files edited in the native text editor, with visual side editors for trees,
tables, flowcharts, sequence diagrams and sketches — plus agent skills so that
Claude Code, Cursor, Codex and friends treat a board as the living plan.

This repository holds everything Lavagna ships:

| Path | What it is |
| --- | --- |
| [`apps/extension/`](apps/extension) | The VS Code / Cursor extension ([its README](apps/extension/README.md) is the Marketplace page) |
| [`skills/`](skills) | The agent skills, one folder per skill — the single source of truth |
| [`.claude-plugin/`](.claude-plugin) | Plugin + marketplace manifests that make this repo installable from Claude Code |
| [`docs/`](docs) | The website, plain HTML, served by GitHub Pages from this folder |
| [`packages/brand/`](packages/brand) | Logo and icon sources and their exports |
| [`scripts/`](scripts) | Maintainer scripts (skills and brand validation, `.vsix` verification, third-party notices) |

## Install

**Extension.** Search for *Lavagna* in the Extensions view of VS Code
(Marketplace) or Cursor (Open VSX), or download the `.vsix` from the
[releases](https://github.com/AyloSrd/lavagna/releases) and use
*Extensions: Install from VSIX…*.

**Skills.** Two ways to the same files:

- From the extension: the *Skills* section of the Lavagna panel lists the
  skills and installs the ones you pick, for the agents it detects. Nothing is
  written until you click, and a folder the extension doesn't recognise is
  named in a confirmation before it is replaced.
- Claude Code: `/plugin marketplace add AyloSrd/lavagna`, then
  `/plugin install lavagna@lavagna`.
- Any agent that reads `SKILL.md` (Cursor, Codex, Copilot, Gemini CLI, …):
  `npx skills add AyloSrd/lavagna`.

The `.vsix` bundles `skills/`, so the extension installs from its own copy;
the three channels always deliver the same files.

## Development

```bash
pnpm install
pnpm check              # typecheck + lint + unit tests + skills and brand validation
pnpm build              # extension bundles (dist/, media/webview.js) + skills copy
pnpm test:integration   # VS Code integration suites (downloads VS Code once)
pnpm dev                # extension watch mode; then F5 in VS Code
```

Turborepo runs the per-package tasks and caches them; `pnpm --filter lavagna
run <task>` runs one directly. The extension's unit tests are Vitest; the
integration suites run inside VS Code via `@vscode/test-cli`.

## Releasing

Releases are cut by hand from a maintainer's machine — CI builds and tests,
it never publishes. See [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE). Bundled third-party packages are listed in
[`apps/extension/THIRD_PARTY_NOTICES.md`](apps/extension/THIRD_PARTY_NOTICES.md).

## Security

Found a vulnerability? Please report it privately — see [SECURITY.md](SECURITY.md).
