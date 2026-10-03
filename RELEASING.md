# Releasing

Releases are manual, on purpose. CI checks and builds every change and
attaches a `.vsix` to the run, but nothing is published automatically: a
maintainer publishes by hand — the VS Code Marketplace by uploading the
`.vsix` on its website, Open VSX from their own machine with a token that never
leaves it.

## One-time setup

- **VS Code Marketplace**: sign in at
  <https://marketplace.visualstudio.com/manage> with a Microsoft account and
  create the publisher `aylosrd` (it must match `"publisher"` in
  `apps/extension/package.json`). That is all: releases are uploaded on that
  page, so there is **no token**.

  Why not `vsce publish`: it needs an Azure DevOps personal access token scoped
  to *All accessible organizations* — a "global" PAT, and Azure DevOps retires
  those on **1 December 2026**. The replacement (Microsoft Entra ID with
  `vsce publish --azure-credential`) needs an Azure subscription and is built
  for publishing from CI, which this project doesn't do. The web upload needs
  neither, and leaves no publishing credential to leak.
- **Open VSX** (Cursor, VSCodium, Windsurf…): an Eclipse Foundation account
  linked to GitHub at open-vsx.org, the publisher agreement signed, an access
  token, and the `aylosrd` namespace claimed once (see below).

Store the Open VSX token in the macOS keychain, once:

```bash
security add-generic-password -a "$USER" -s ovsx -w    # prompts, nothing in argv
```

Then claim the namespace, once:

```bash
cd apps/extension
OVSX_PAT="$(security find-generic-password -a "$USER" -s ovsx -w)" \
  pnpm exec ovsx create-namespace aylosrd
```

The token lives in the keychain and nowhere else: never committed, never in
`.npmrc` or any dotfile, never a GitHub Actions secret. CI has no publish step
and must never be given one.

## Cutting a release

1. Make sure `main` is green and `apps/extension/CHANGELOG.md` has a section
   for the new version.
2. Bump the version in `apps/extension/package.json` and
   `.claude-plugin/plugin.json` (they move together).
3. Refresh notices if dependencies changed: `node scripts/third-party-notices.mjs`.
4. Build, package and verify the contents:

   ```bash
   pnpm check && pnpm build
   pnpm check-vsix        # packages → apps/extension/lavagna-<version>.vsix, then checks it
   ```

   `pnpm check-vsix` prints every entry in the archive and fails if anything is
   outside the allowlist in `scripts/check-vsix.mjs`, or if the bundled skills
   are not exactly the files `git ls-files skills` lists (the build copies only
   those, so an uncommitted draft in `/skills` never ships). **Read the list.** The
   `.vsix` goes to the Marketplace and Open VSX: public, and for practical
   purposes permanent. Before publishing, confirm by eye that there is no
   `.env`, no `.lavagna/` board, no `.claude/`, `.vscode/` or `.cursor/`
   folder, no sourcemap, and nothing else that is yours rather than the
   extension's.

5. Install the `.vsix` locally (*Extensions: Install from VSIX…*) in both
   VS Code and Cursor and smoke-test a board.
6. Commit, tag, push:

   ```bash
   git commit -am "chore: release <version>"
   git tag v<version> && git push && git push --tags
   ```

7. Publish, by hand.

   Before uploading anything, run through the checklist once more:

   - [ ] `pnpm check-vsix` is green
   - [ ] you have read the file list it printed
   - [ ] no `.env`, no board, no local or agent folder in it
   - [ ] the version in the file name is the one you meant to ship

   **VS Code Marketplace — upload on the website.** Open
   <https://marketplace.visualstudio.com/manage/publishers/aylosrd>:

   - first release: **+ New extension → Visual Studio Code**, then choose
     `apps/extension/lavagna-<version>.vsix`;
   - later releases: on the Lavagna row, **⋯ → Update**, then choose the new
     `.vsix`.

   The Marketplace verifies the package (a few minutes) before the new version
   goes live; the row shows its status.

   **Open VSX — from your machine.** The token is read from the keychain for
   this one command: set in its environment, never exported, never an
   argument (an argument is readable by any process via `ps` and lands in shell
   history), never written to disk. `pnpm exec` runs the `ovsx` installed in
   this workspace and nothing else; `npx` would download a package from the
   registry if the local one were missing, and run it with the token.

   ```bash
   cd apps/extension
   OVSX_PAT="$(security find-generic-password -a "$USER" -s ovsx -w)" \
     pnpm exec ovsx publish lavagna-<version>.vsix
   ```

   Do not `export` the token, do not pass `-p <token>`, and do not use `npx`
   here.

8. Create a GitHub Release for the tag and attach the `.vsix`, so people who
   don't use either marketplace can still install.

The skills need no publishing step: Claude Code's marketplace and
`npx skills add` read them straight from the repository at the tag or `main`.
