# Releasing

Releases are manual, on purpose. CI checks and builds every change and
attaches a `.vsix` to the run, but nothing is published automatically: a
maintainer publishes from their own machine with tokens that never leave it.

## One-time setup

- **VS Code Marketplace**: an Azure DevOps personal access token with the
  *Marketplace (Manage)* scope, for the `aylosrd` publisher. Tokens expire
  (at most a year).
- **Open VSX** (Cursor, VSCodium, Windsurf…): an account at open-vsx.org,
  the Eclipse Foundation publisher agreement signed, the `aylosrd` namespace
  claimed, and an access token.

Store both in the macOS keychain, once:

```bash
security add-generic-password -a "$USER" -s vsce -w    # prompts, nothing in argv
security add-generic-password -a "$USER" -s ovsx -w
```

**Never** `vsce login`. Since vsce 2 it writes the PAT **in plaintext** to
`~/.vsce` — exactly the dotfile this avoids. (It no longer uses keytar either,
which is why `keytar: false` in `pnpm-workspace.yaml` is right.)

Tokens live in the keychain and nowhere else: never committed, never in
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

   Before typing any of this, run through the checklist once more:

   - [ ] `pnpm check-vsix` is green
   - [ ] you have read the file list it printed
   - [ ] no `.env`, no board, no local or agent folder in it
   - [ ] the version in the file name is the one you meant to ship

   Both tools read their token from the environment, so it never becomes an
   argv entry — an argv entry is readable by any process on the machine via
   `ps` / `/proc/<pid>/cmdline`, and is recorded verbatim in shell history.
   Nothing below puts a token on a command line, and nothing writes one to
   disk, and no token outlives the command that needs it:

   ```bash
   cd apps/extension

   # Each token is read from the keychain for one command only: it is set in
   # that command's environment, never exported, never an argument, and the
   # other tool never sees it. `pnpm exec` runs the vsce/ovsx installed in this
   # workspace and nothing else; `npx` would download a package from the
   # registry if the local one were missing, and run it with the token.

   VSCE_PAT="$(security find-generic-password -a "$USER" -s vsce -w)" \
     pnpm exec vsce publish --no-dependencies --packagePath lavagna-<version>.vsix   # VS Code Marketplace

   OVSX_PAT="$(security find-generic-password -a "$USER" -s ovsx -w)" \
     pnpm exec ovsx publish lavagna-<version>.vsix                                   # Open VSX
   ```

   Do not `export` either token, do not pass `-p <token>` to either tool, do
   not use `npx` here, and do not run `vsce login` (see *One-time setup*).

8. Create a GitHub Release for the tag and attach the `.vsix`, so people who
   don't use either marketplace can still install.

The skills need no publishing step: Claude Code's marketplace and
`npx skills add` read them straight from the repository at the tag or `main`.
