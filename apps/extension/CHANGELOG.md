# Change Log

## 0.2.1

Replaces 0.2.0, which was withdrawn from Open VSX.

### Changed

- A shorter README, written as a guide for people using the extension.

## 0.2.0

### Changed

- New icon and activity-bar mark: the ꩜ spiral, in chalk on a slate tile.
- Dependency updates, among them konva 10.7, react-konva 19.3 and
  @xyflow/react 12.12 in the editors, and esbuild 0.28 in the build.
- The Marketplace categories no longer include *Notebooks*.

### Security

- Saving an image never writes through a symbolic link: if `.lavagna`,
  `.lavagna/media` or the image's file in it is a link — something a cloned
  repository could plant to make Lavagna overwrite a file elsewhere — the save
  is refused with an error instead.
- **Choose image** accepts only real PNG, JPEG, GIF, WebP and BMP files, up to
  32 MB; the file's contents decide, not its name.
- A very long line in a board no longer freezes the editor. Several patterns
  that read board text took seconds to minutes on lines with tens of thousands
  of spaces; they now run in linear time, and very large tree blocks open
  read-only like the other oversized blocks.
- An image link or file reference that leads outside the workspace through a
  symbolic link opens read-only or not at all, and *Delete Board* acts only on
  a board directly inside `.lavagna/`, showing its path before asking.
- Lavagna declares that it does not run in Restricted Mode (untrusted
  workspaces) or in virtual workspaces.

## 0.1.5

### Fixed

- **Paste as Text** sat above Copy in the right-click menu instead of below
  Paste, because its sort order put it at the top of the cut/copy/paste group.
  It now sorts after the native Paste.

## 0.1.4

### Fixed

- A board whose name matches an editor another extension registers — Cursor
  claims `mcp`, so `mcp.lavagna.md` — didn't open from the Lavagna panel. The
  tree used the built-in `vscode.open`, which resolves editor associations and
  handed the file to that editor. Boards now open as text explicitly, the same
  way newly created ones already did.

## 0.1.3

### Added

- **Paste as Text** in the editor's right-click menu (and the command palette):
  pastes the clipboard verbatim inside a board, for when you want the code and
  not a reference. `Cmd+V` is unchanged — it still inserts a reference when it
  can identify the source.

## 0.1.2

### Fixed

- **Lavagna: Insert Sequence Diagram** was missing from the command palette. Its
  `when` clause had a doubled backslash, so the regex looked for a literal
  backslash and matched no filename. Present since the command was added,
  including in 0.1.1; the right-click entry was unaffected.
- Pasting copied code into a board relied on the editor reporting where the copy
  came from, and produced raw text whenever it didn't. The source is now resolved
  by matching the clipboard against recent selections — identical text only, with
  the file re-read to confirm those lines still hold it, so a stale source pastes
  plain rather than referencing the wrong lines.
- The extension activates at startup, so the copy is captured even when no board
  has been opened yet in the window.

### Changed

- One gesture for pasting: `Cmd+V` inserts a reference when the source resolves
  and the code when it doesn't. **Lavagna: Paste as File Reference** and its
  `⌘⌥L V` keybinding are removed; `lavagna.pasteAsFileReference` still turns the
  behaviour off.

## 0.1.1

### Added

- **`/Spiral ꩜`** in the block menu and the right-click *Insert Block* submenu:
  inserts the bare `꩜` character (U+AA5C) with the cursor after it. A marker
  rather than a block — no fence, no editor — for tooling that watches boards for
  these and answers in place.
- Visual editing for mermaid **sequence diagrams**: a rendered lifeline diagram
  above an editable step list, with all eight arrow kinds, participants,
  notes, and `loop`/`alt`/`opt`/`par` nesting preserved across a round trip.
- Copied code pasted into a board becomes a file reference
  (`[@src/foo.ts:12-40](src/foo.ts#L12-L40)`) instead of raw text, with
  **Lavagna: Paste as File Reference** (`⌘⌥L V`) to do it on demand and
  `lavagna.pasteAsFileReference` to turn the automatic behaviour off.

### Fixed

- The file-reference picker kept only the selections matching the current
  search. Picks are now pinned under a **Selected** heading and survive typing a
  new query, so files can be gathered across several searches.
- Opening a board no longer requires touching the Lavagna view or a command
  first: the extension activates on markdown, so the slash menu, CodeLens,
  hover and links are there immediately.
- The slash menu opens mid-line after whitespace, not only at the start of a
  line.
- Data loss, denial-of-service and path-traversal issues in board handling:
  writing to an unclosed fence no longer replaces the rest of the file, a table
  no longer swallows a following fence, and file references are checked for
  containment before opening.

## 0.1.0

First release of the markdown-native Lavagna. Boards are plain `*.lavagna.md`
files edited in the normal text editor — so autocomplete, inline chat, undo,
find/replace and git all keep working — with visual editors for the blocks where
raw text is awkward.

### Boards

- Boards live in `.lavagna/` at the workspace root, listed in a **Lavagna** view
  in the activity bar with create / open / delete and automatic refresh when
  files change outside the panel.
- The folder is created on first use; projects that never use Lavagna are left
  untouched.
- Every feature is scoped to the `*.lavagna.md` filename, so plain `.md` files
  are unaffected. Files keep the `markdown` language id.

### Inserting blocks

- Type **`/`** at the start of a line for a Notion-style block menu: filter as
  you type, Enter to insert, Esc to dismiss. Also available from the editor's
  right-click menu.
- The menu stays quiet mid-line (so `src/`, URLs and dates don't trigger it) and
  inside fenced blocks.

### Visual block editors

Recognised blocks get an *Edit … · Lavagna* CodeLens and hover link, opening a
reusable panel beside the editor.

- **Flowcharts** (` ```mermaid `) — all 14 classic mermaid shapes, six edge
  styles, five directions, click-to-place nodes. Existing and hand-written
  diagrams open for editing, and each node's shape and each edge's stroke
  survive a round trip.
- **Trees** (` ```tree `) — outliner keys: Enter splits, Tab/Shift+Tab indent
  and outdent, Backspace at the start merges up, arrows navigate.
- **Tables** (GFM pipe tables) — grid editing with row/column operations and
  per-column alignment.
- **Canvas** (a markdown image line) — draw on an image: pen, shapes, arrows,
  text, colours. Start from a blank page or your own image; Save flattens the
  drawing into a new PNG in `.lavagna/media/`.

### Referencing files

- **Insert File Reference** — a fuzzy workspace-file picker that inserts
  `[@src/foo.ts](src/foo.ts#L1)`.
- **Copy code, paste into a board** — the paste-as menu offers a reference
  carrying the line range, `[@src/foo.ts:12-40](src/foo.ts#L12-L40)`.
- Clicking a reference opens the file and reveals the range.

### Editing model

- Visual edits are written straight into the markdown: the file goes dirty like
  any other edit, `Cmd+S` saves, and **`Cmd+Z` in the text editor undoes visual
  edits** with the side editor following along.
- Editing a block as text while its editor is open raises a banner offering
  *Load file version* or *Keep mine*.
- Blocks that can't be round-tripped without losing information — mermaid
  subgraphs, styles and classes, non-flowchart diagram types — open read-only
  and their fence is left byte-identical.

### Notes

- AI assistance comes from the editor itself; the extension contributes none of
  its own.
- Requires VS Code or Cursor `^1.105.0` and an open folder.
