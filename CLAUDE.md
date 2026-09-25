# Lavagna

Monorepo for the Lavagna VS Code / Cursor extension, its agent skills, brand
assets and website. pnpm workspaces + Turborepo.

```
apps/extension/     the extension (package name `lavagna`) — see "Extension architecture"
skills/             agent skills, one folder per skill with a SKILL.md — the single source of truth
  manifest.json     catalogue of the skills, for the plugin/marketplace manifests
.claude-plugin/     plugin.json + marketplace.json: this repo is its own Claude Code marketplace
docs/               website, plain HTML, no build step; GitHub Pages serves this folder from main
packages/brand/     logo/icon sources and exports (nothing here is imported at runtime)
scripts/            maintainer scripts
```

## Conventions

- **Skills live only in `/skills`.** The extension build copies the files git
  tracks there into `apps/extension/skills/` (gitignored) so the `.vsix`
  carries them — an untracked file is never bundled. Never edit
  the copy. Each SKILL.md carries `metadata.version`; bump it when the content
  changes. Adding or removing a skill also bumps `.claude-plugin/plugin.json`'s
  `version` — that is what `/plugin install` and `/plugin update` key off, and
  `pnpm check-skills` fails when it falls behind the newest skill. The
  extension's Skills panel installs from the bundled copy (`BundledSkillCatalog`);
  `/plugin marketplace add` and `npx skills add` read the same folder from git.
- **Brand assets live only in `packages/brand/exports`.** The extension build
  copies `icon-256.png` → `media/icon.png` and `activity-bar.svg` →
  `media/spiral.svg` (both gitignored). `docs/assets/` must stay committed
  because Pages serves it from git, so `scripts/check-brand-sync.mjs` fails the
  build when those copies drift. Everything in `exports/` is generated: edit
  `src/`, never the export.
- **Nothing installs skills silently.** The extension writes a skill to disk
  only on an explicit *Install skill* / *Update* click, or after a prompt the
  user answers; a folder it does not recognise is confirmed before it is
  replaced. Every destination is `<skillsDir>/<safe-id>`, validated in the
  domain and re-checked in the adapter — keep it that way.
- **No publishing automation.** CI (`.github/workflows/ci.yml`) typechecks,
  lints, tests, builds and attaches the `.vsix`; releases are manual per
  `RELEASING.md`. Do not add publish steps to CI.
- **Tests.** Unit tests are Vitest (`apps/extension/src/test/domain`, pure
  TypeScript, no `vscode`). Integration suites are Mocha under
  `@vscode/test-cli` (`apps/extension/src/test/*.integration.test.ts`).
- **Website is plain HTML.** One page, its CSS inline in a `<style>` block; no
  framework, no bundler. `docs/.nojekyll` must stay.
- Run everything from the root: `pnpm check` (typecheck, lint, unit tests,
  `scripts/check-brand-sync.mjs` and `scripts/check-skills.mjs`), `pnpm build`,
  `pnpm test:integration`.
  Dependencies that must run install scripts are allow-listed in `pnpm-workspace.yaml`.

## Extension architecture (`apps/extension`)

Clean architecture. Inner layers never import outer layers.

```
src/
  extension.ts          composition root — wire dependencies, register commands
  domain/               business logic, types, use cases (no vscode or browser imports)
  application/          orchestrates use cases; depends on domain + port interfaces
  infrastructure/       VS Code API, VFS, fetch adapters implementing ports
  presentation/         providers, command handlers, webview panel + message routing
  shared/               message protocol types shared between host and webview
  webview/              React app — compiled by esbuild into media/webview.js
```

`domain` ← `application` ← `infrastructure` / `presentation`. `domain` must
not import `vscode` or browser APIs. `webview/` is a separate build artifact
and imports only from `shared/`.

### Two worlds: extension host ↔ webview

The extension host (Node.js) and the webview (browser sandbox) are isolated
runtimes that communicate exclusively via `postMessage`. The protocol is the
discriminated unions in `shared/messages.ts`, used by both sides.
`presentation/` routes incoming webview messages to use cases and posts
responses back; the webview calls `vscode.postMessage(msg)` and listens on
`window.addEventListener('message', …)`.

### Adding a feature

1. Define types and use case in `domain/`
2. Add a port interface in `application/` if external I/O is needed
3. Implement the adapter in `infrastructure/`
4. Add message types to `shared/` if the webview is involved
5. Route messages in `presentation/`; update React components in `webview/`
6. Wire everything in `extension.ts`

### Avoid

- VS Code API calls outside `infrastructure/`, `presentation/` and `extension.ts`
- Browser API calls outside `webview/`
- God files with all logic in `extension.ts`
- Importing `vscode` from `domain/`, `shared/`, or `webview/`
- Leaking UI or persistence details into domain types

### Pragmatism

- Keep modules focused; extend existing layers before inventing new patterns
- Small obvious helpers can stay inline — don't over-abstract for one-off code
