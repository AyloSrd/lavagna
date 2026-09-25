# Lavagna

A prompt-writing blackboard for VS Code and Cursor. Boards are plain markdown
files, edited in the **native text editor** — so autocomplete, inline chat,
undo, find/replace, and git all keep working — with visual side editors for the
blocks where a grid or a diagram beats raw text.

## Boards

A board is a `*.lavagna.md` file inside `.lavagna/` at the workspace root. The
folder is created the first time you make a board; projects that never use
Lavagna stay untouched.

The **Lavagna** view in the activity bar (spiral icon) lists the boards in
`.lavagna/` and refreshes itself when files are added, changed, or removed —
including from outside the panel (`git pull`, manual edits). From there you can
create a board (named `<slug>.lavagna.md`), open one, or delete one (to the OS
trash, with a confirmation).

Files keep the `markdown` language id; every Lavagna feature is scoped to the
`*.lavagna.md` filename pattern, so plain `.md` files are unaffected.

## Inserting blocks

Type **`/`** to open the block menu — Notion-style: keep
typing to filter, arrows to move, Enter to insert, Esc or clicking away to
dismiss. The same list lives in the editor's right-click menu under *Insert
Block*.

```
/Flowchart   /Sequence Diagram   /Tree   /Canvas   /Table   /Spiral ꩜   /File Reference
```

**Spiral ꩜** inserts the bare `꩜` character (U+AA5C) and leaves the cursor after
it — a marker rather than a block, for tooling that watches boards for these and
answers in place.

The menu stays out of the way: the `/` must start a word — at the beginning of
the line or after a space — so paths (`src/`), URLs, dates (`12/`) and "and/or"
don't trigger it, and it never opens inside a fenced block, where `/` is just
content.

## Visual block editors

Editable blocks get an **"Edit … · Lavagna"** CodeLens above them plus a hover
link. Clicking either opens a single reusable panel beside the text editor; open
another block and the same panel retargets to it.

| Block | Written as | Editor |
| --- | --- | --- |
| Tree | ` ```tree ` fence | Outliner: Enter splits into a sibling, Tab / Shift+Tab indent and outdent, Backspace at the start merges up, ↑/↓ move between lines, plus per-line add-child / add-sibling / remove and **Format** to normalize indentation |
| Flowchart | ` ```mermaid ` fence | Node-and-edge editor (React Flow): all 14 mermaid shapes, six edge styles, five directions, click-to-place nodes |
| Sequence diagram | ` ```mermaid ` fence | Lifeline diagram plus an editable step list: participants (reorder, rename, actor toggle), messages with all eight arrow kinds, notes |
| Table | GFM pipe table | Grid editor: Tab between cells, Enter inserts a row, add/remove rows and columns, per-column alignment |
| Canvas | a markdown image line | Draws on the image: the PNG is the locked background, marks go on top — pen, rect, ellipse, line, arrow, text, colours, stroke width, fill |

**Insert Canvas** inserts `![canvas]()` — an image line with no target — and
writes nothing to disk. Opening it offers two choices: **Start blank** (a white
page) or **Choose an image** (a file picker). The same chooser appears when a
link points at a file that no longer exists. Once there's an image, the toolbar
offers **Replace image** to swap it, confirming first if unsaved marks would be
lost.

Any standalone local image line is drawable, including screenshots pasted with
VS Code's own markdown image paste. Remote (`https:`) and `data:` images are
left alone. Files are dropped into `.lavagna/media/` under a content-hashed
name, so re-choosing the same file doesn't duplicate it.

The **Save** button flattens background + marks into a new PNG and updates the
link; saved marks become pixels, so editing again paints over them. Nothing is
written while you sketch. Text can be re-edited by double-clicking it up until
Save, and Save is disabled while a text box is open — the text isn't part of the
canvas until it's committed.

Drag-and-drop isn't offered: VS Code's webview intercepts file drops and opens
them in an editor tab, so the webview never receives them.

### Flowcharts

The fence is the source of truth, and it's read with a parser for the flowchart
grammar rather than a pattern for the subset Lavagna itself writes — so existing
and hand-written diagrams open for editing, not read-only. It understands all 14
classic node shapes, chains (`a --> b --> c`), `&` fan-outs, dotted / thick /
arrowless edges, both label syntaxes, and shapes declared after an edge.

Everything it reads, it preserves: each node keeps its original shape and each
edge its stroke and arrow across a round trip, so editing one node doesn't
reformat the rest of the diagram.

In the editor, **＋ Node** arms placement — the cursor becomes a crosshair and
your next click drops the node there (Esc cancels). Selecting a node offers a
**Shape** dropdown (all 14); selecting an edge offers a **style** dropdown (the
six stroke/arrow combinations) and its label. **Direction** covers all five of
mermaid's.

One thing mermaid doesn't store is coordinates, so a diagram you didn't lay out
here gets positions derived from its edges — drag once and they stick.

### Sequence diagrams

A ` ```mermaid ` fence is dispatched on its header, so `sequenceDiagram` opens
its own editor rather than being refused by the flowchart parser: a rendered
lifeline diagram above an editable step list.

Participants can be renamed (every reference is renamed with them), relabelled,
reordered, toggled between `participant` and `actor`, and deleted. Steps are
messages — with from / arrow / to dropdowns covering all eight arrow kinds
(`->` `-->` `->>` `-->>` `-x` `--x` `-)` `--)`) — or notes, and both can be
reordered or removed. Clicking a message in the diagram selects its row.

Aliases, activation suffixes (`A->>+B`), two-actor notes (`Note over A,B`),
`loop`/`alt`/`else`/`opt`/`par` nesting and `autonumber` all survive a round
trip, so editing one message doesn't reformat the diagram.

## Referencing files

Boards often point at code, so there are two ways to drop a file reference into
one without the Explorer → *Copy Relative Path* dance:

- **Insert File Reference** (in the *Insert Block* submenu) opens a fuzzy file
  picker of the workspace; pick one or several and it inserts
  `[@src/foo.ts](src/foo.ts#L1)` at the cursor, workspace-root-relative.

  Selections persist across searches: what you've ticked is pinned under a
  **Selected** heading at the top of the list and stays ticked while you type a
  new query, so you can gather files from several searches in one go. Untick to
  drop one. References are inserted in the order you picked them, one per line.
- **Copy code, paste it** — copy a selection in any file, then paste into a
  board with a plain `Cmd+V`. You get `[@src/foo.ts:12-40](src/foo.ts#L12-L40)`
  instead of the raw code. If the source can't be identified, you get the code,
  exactly as a normal paste would — there's nothing extra to press either way.

  Inside boards only, and only when the copy came from a file in the same
  workspace folder. Copies from untitled buffers, the terminal, another
  workspace root, or another application paste as plain text, as does anything
  pasted inside a code fence. `Cmd+Z` undoes it like any edit, and
  `lavagna.pasteAsFileReference: false` turns it off entirely.

  To paste the raw code on purpose, right-click → **Paste as Text** (also
  *Lavagna: Paste as Text* in the palette). `Cmd+V` stays the reference.

  How the source is found: from the editor when it reports where a copy came
  from, and otherwise by matching the clipboard against recent selections. A
  match needs the text to be identical, and the file is re-read to confirm those
  lines still hold it — so an edited or deleted source pastes as plain text
  rather than producing a reference to the wrong lines.

  How the keystroke is taken: `Cmd+V` is bound to a Lavagna command inside
  `*.lavagna.md` files. The paste API would be the proper mechanism, and it isn't
  dependable — Cursor registers a paste provider and then never calls it, on copy
  or on paste — so the binding is scoped to a focused editor on a board, and
  anything it can't turn into a reference is handed straight to the normal paste.
  It is never the reason a paste goes missing.

  If something looks wrong, **View → Output → Lavagna** narrates each paste: which
  guard declined, what was on the clipboard, and what the tracker had.

References read `[@src/foo.ts](…)` — the `@` marks them as filesystem mentions
(text only; the link target stays a clean path). Clicking one opens the file
(and jumps to the line, if any) — VS Code's own markdown links resolve relative
to the board's folder and only jump for `.md` targets, so Lavagna owns the click
for its references. Every reference carries a `#L` anchor (whole-file refs get
`#L1`) so this handling always applies. You can also drag a file from the Explorer straight
onto the editor text (not the tab bar) — that's a built-in VS Code shortcut that
inserts a relative path.

Paste interception needs the finalized paste API (VS Code 1.97+); where it's
absent, or where the editor doesn't consult extensions on paste, pasting behaves
normally and everything else is unaffected.

### Editing model

Edits in a side editor are written straight into the markdown file — debounced
while you type, flushed at the end of a gesture (drag, click, blur). Every write
is a workspace edit, so the file becomes dirty like any other edit, `Cmd+S`
saves it, and **`Cmd+Z` in the text editor undoes visual edits** and the side
editor follows along. Editing the same block as text while its editor is open
raises a banner offering *Load file version* or *Keep mine*. Deleting the block
leaves the editor in a "removed" state with the content still copyable.

Two blocks are deliberately conservative about what they'll touch:

- The flowchart editor refuses what it can't write back without losing it:
  subgraphs, `classDef`/`class`/`style`/`linkStyle`, click handlers, `:::class`
  annotations. The sequence editor likewise refuses `box` grouping,
  `create`/`destroy`, `link`, and `rect` colouring. Diagram types with no editor
  yet (`classDiagram`, `pie`, …) also open read-only. In every case the fence is
  left byte-identical.
- A canvas whose image can't be loaded at all — a remote or otherwise
  unsupported target — opens read-only rather than touching the link. (A merely
  *missing* local file gets the chooser instead, so you can pick a replacement.)

## Agent skills

Lavagna ships the agent skills that teach a coding agent how to work with
boards — the `lavagna` skill and any others listed in the bundle. They live
at the foot of the Lavagna panel: under the boards list sits a collapsed
**Skills** line with an **Install skill** button on it. Click the button to
install one; click the line to expand it and see every skill with its bundled
version and, for each supported agent, whether it is installed, out of date,
or absent — in each of two scopes.

**Nothing is installed until you click.** Opening the view only reads. Every
write goes through an explicit action: the **Install skill** button on a skill
row, or **Install** / **Update** / **Remove** on an agent row.

Installing asks two questions, then copies the skill folder (never a symlink):

1. **Scope** — *Global*: once per machine, under your home folder, available in
   every project (recommended). *This workspace*: inside the open folder, so
   teammates get it through git. A scope with nowhere to write is not offered,
   and the picker says why. (When the window has several folders open, you are
   asked which one first.)
2. **Agents** — a multi-select of the agents below. The ones detected from the
   editor (Cursor, Windsurf), installed extensions (Claude Code, Codex, Copilot
   Chat, Gemini Code Assist) and workspace markers (`CLAUDE.md`, `.cursor/`,
   `AGENTS.md`, …) are pre-checked; detection is only a hint and you can change
   the selection. Each entry shows the exact folder it would write to.

If a folder Lavagna can't recognise as its own copy of the skill is already at
one of those destinations — one with no `SKILL.md`, one whose `SKILL.md` names
another skill or carries no readable version, so a skill you wrote by hand or
one another tool put there — a modal names every such folder and asks before
anything is replaced. Only a destination where nothing exists yet is written
without asking. *Skip these* installs the rest; dismissing it installs nothing.
A destination that is a symbolic link is never installed over at all, and
nothing is written or removed through a symbolic link inside the workspace — a
repository could commit `.agents/skills` as a link to anywhere. Under your home
folder a linked folder (a dotfile-managed `~/.claude`, say) is fine as long as
it really resolves inside your home.

Where the files land, per agent:

| Agent | This workspace | Global |
| --- | --- | --- |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| Cursor | `.agents/skills/` | `~/.cursor/skills/` |
| Codex | `.agents/skills/` | `~/.codex/skills/` |
| GitHub Copilot | `.agents/skills/` | `~/.copilot/skills/` |
| Gemini CLI | `.agents/skills/` | `~/.gemini/skills/` |
| Other agents (`.agents`) | `.agents/skills/` | `~/.agents/skills/` |

Several agents read the same `.agents/skills/` folder at workspace scope; the
skill is written once per distinct folder, and the view shows it as installed
for every agent that reads it — and the result message names the folders it
wrote, not the agents you ticked. A destination already holding the same
version is left alone; an older copy is replaced — that is also what **Update**
does. **Remove** confirms first, then deletes the skill's folder for that agent
in every scope where it exists; at workspace scope it goes to the trash. State
comes from the `name` and `metadata.version` in each installed `SKILL.md`, so
a copy installed by other means is recognised too — and a folder that isn't a
recognisable copy is never replaced without the confirmation above.

Two limits, declared in the extension manifest:

- **Virtual workspaces** (`vscode-vfs://…`) have no workspace scope — the files
  would have to land on a local disk that has nothing to do with them. Global
  scope still works, and so does everything else in Lavagna.
- **Restricted Mode.** Skills are only installed into a trusted workspace. The
  workspace scope is not offered until you trust the folder.

After you create your first board, Lavagna may show a one-line prompt offering
to install its core skill for the agents it detected — only if the skill isn't
installed anywhere yet, and never after *Don't ask again*. It is offered once:
after the first board, Lavagna remembers and does not ask again. The prompt
writes nothing itself: *Install…* just opens the flow above.
`lavagna.skills.suggestOnFirstBoard: false` turns it off.

The same skills are available outside the extension: as a Claude Code plugin
via `/plugin marketplace add AyloSrd/lavagna`, or for any agent with
`npx skills add AyloSrd/lavagna`.

## Commands and shortcuts

| Command | Shortcut | Where |
| --- | --- | --- |
| Lavagna: New Board | `⌘⌥L N` / `Ctrl+Alt+L N` | View title bar, command palette |
| Lavagna: Edit Block Visually | `⌘⌥L E` / `Ctrl+Alt+L E` | CodeLens, hover, editor context menu |
| Lavagna: Insert Block › Flowchart / Sequence Diagram / Tree / Canvas / Table / File Reference | `/` after whitespace | Slash menu, editor context menu, command palette |
| Paste as file reference | `Cmd+V` / `Ctrl+V` | In a board, when the copy source is known |
| Lavagna: Paste as Text | — | Editor context menu, command palette |
| Lavagna: Delete Board / Refresh Boards | — | Boards view |
| Lavagna: Install Skill | — | Skills view (skill rows, and agent rows not yet installed everywhere), command palette |
| Lavagna: Update Skill / Remove Skill | — | Skills view, agent rows — Update only when an older copy is installed, Remove only when something is |
| Lavagna: Refresh Skills | — | Skills view title bar |

`Edit Block Visually` invoked from the keyboard targets the block under the
cursor. Insert and edit commands only appear on `*.lavagna.md` files.

## Requirements

VS Code or Cursor `^1.105.0`. A workspace folder is required for boards and
media. AI assistance comes from the editor itself (Copilot autocomplete and
inline chat work in boards because they're ordinary markdown) — the extension
contributes none of its own.

## Repo layout

Clean architecture; inner layers never import outer ones, and `domain/` has no
`vscode` or browser imports.

```
src/
  extension.ts            composition root — wires ports, registers commands and providers
  domain/
    blocks/               fence/table/image parser, block ranges, block-edit computation
    boards/               board naming, slugs, file names, template
    references/           file-reference format/parse, fuzzy path matcher
    skills/               agent targets + detection rules, frontmatter/semver, install plan and state,
                          and the path-segment validator every install destination goes through
  application/
    ports/                BoardRepositoryPort, MediaPort, SkillCatalogPort, SkillFilesPort, AgentDetectionPort
    usecases/             create / list / delete board; list / install / update / remove skill
  infrastructure/
    boards/               workspace.fs-backed board repository (+ no-workspace no-op)
    media/                content-hashed writer for .lavagna/media/ (+ no-op, blank-page seed)
    skills/               bundled catalog reader, workspace.fs skill writer, agent detection
  presentation/
    providers/            CodeLens, hover, boards tree, skills tree, file-reference links, slash menu
    commands/             board, block, skill, and file-reference commands
    SkillSuggestion.ts    the opt-in prompt after the first board — asks, never writes
    blockSnippets.ts      the insertable blocks — read by both the slash and context menus
    BlockEditorPanel.ts   the side panel: webview lifecycle, message routing
    BlockSessionTracker.ts block identity, range tracking, echo suppression, write-back
    selectors.ts          document selector and editable block kinds
  shared/messages.ts      host ↔ webview message protocol (shared by both sides)
  webview/                React app, bundled to media/webview.js
    BlockEditorApp.tsx    kind dispatch, conflict banner, removed-block state
    sync.ts               write-back state machine (clean / pending / conflict / gone)
    editors/              Tree, Flow, Table, Canvas (+ chooser, text overlay), read-only fallback
    format/               mermaid, tree, and table text conversion
    hostBridge.ts         message plumbing
```

The host and the webview are separate runtimes that talk only through
`postMessage` using the types in `shared/messages.ts`. esbuild produces two
bundles: `dist/extension.js` (Node) and `media/webview.js` (browser).

## Development

This package lives in the [Lavagna monorepo](https://github.com/AyloSrd/lavagna)
under `apps/extension/`; the agent skills it bundles come from the repo's
`skills/` folder and are copied in at build time.

```bash
pnpm install                          # at the repo root
pnpm check                            # type-check + lint + unit tests (Vitest)
pnpm build                            # both bundles + skills copy
pnpm test:integration                 # Mocha suites inside VS Code
pnpm dev                              # watch mode, then F5 to launch the Extension Development Host
```

To build an installable package:

```bash
pnpm --filter lavagna run package     # → lavagna-<version>.vsix
```

(`--no-dependencies` is baked into the script: esbuild already bundles
everything, and vsce's dependency scan doesn't understand pnpm's layout.)
