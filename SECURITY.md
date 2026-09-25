# Security policy

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue or pull
request: open this repository's **Security** tab and choose **Report a
vulnerability**. That creates a private advisory visible only to you and the
maintainer.

Include what you found, how to reproduce it, and what an attacker could do
with it. You'll get an acknowledgement as soon as possible; Lavagna is
maintained by one person, so please allow a little time for a fix before
disclosing publicly.

## Supported versions

Fixes land in the latest release of the extension and in the skills on
`main`. Older releases are not patched; update to the latest version.

## What's in scope

- **The VS Code / Cursor extension** (`apps/extension`), for example: writing
  or deleting files outside the intended skills folder, path traversal from a
  skill manifest or a board, anything that runs without the user's action,
  webview escapes, or content from a board or clipboard ending up somewhere
  it shouldn't.
- **The agent skills** (`skills/`): instructions that could lead a coding
  agent to act destructively, run commands, read outside the workspace, or
  copy secrets onto a board.
- **The build and release tooling** (`scripts/`, `.github/`): anything that
  could leak a publishing token or ship unintended files in the `.vsix`.

## Worth knowing

The extension makes no network requests and collects no telemetry. It only
writes files in the open workspace (boards and their media under `.lavagna/`)
and, when you click **Install skill**, in the agent skills folders you choose.
