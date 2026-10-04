# Lavagna

A blackboard for writing prompts and plans in VS Code and Cursor.

Boards are ordinary markdown files, so autocomplete, inline chat, undo, search
and git all keep working. Where a picture says it better than text — a
flowchart, a tree, a table, a sketch — Lavagna opens a visual editor beside the
text and writes your changes straight back into the file.

## Getting started

1. Click the **Lavagna** icon (the spiral) in the activity bar.
2. Click **New Board** and give it a name.
3. Start writing. Type **`/`** to insert a block.

Boards live in a `.lavagna/` folder at the root of your project, as
`<name>.lavagna.md` files. The folder appears only when you create your first
board, and your other markdown files are never touched.

## Blocks

Type `/` at the start of a line or after a space to pick a block (the same list
is in the right-click menu under *Insert Block*):

| Block | What you get |
| --- | --- |
| **Flowchart** | Boxes and arrows you can drag around, with all of mermaid's node shapes and arrow styles |
| **Sequence diagram** | Who talks to whom, in order: participants, messages and notes |
| **Tree** | An outliner — Enter for a new line, Tab / Shift+Tab to indent |
| **Table** | A spreadsheet-like grid with rows, columns and alignment |
| **Canvas** | Draw on a blank page or on top of an image: pen, shapes, arrows, text |
| **File reference** | A link to a file (or lines in it) from your project |
| **Spiral ꩜** | A small marker to flag a spot — a question, a to-do |

Click **Edit … · Lavagna** above a block (or hover it) to open its visual
editor. Edits land in the file as you go, `Cmd+S` saves, and `Cmd+Z` undoes
them like any other edit. Diagrams you wrote by hand open too, and stay exactly
as you wrote them; anything the editor can't handle safely opens read-only.

Canvas images are saved in `.lavagna/media/`; your drawing is only written
when you click **Save**.

## Linking to code

- **Copy, then paste into a board.** Copy some code in any file, paste it into a
  board, and you get a link like `[@src/foo.ts:12-40](src/foo.ts#L12-L40)`
  instead of the raw code. Click it to jump back to those lines. Want the code
  itself? Right-click → **Paste as Text**.
- **Insert File Reference** opens a search over your project's files; tick one
  or several to insert links to them.

To turn the paste behaviour off, set `lavagna.pasteAsFileReference` to `false`.

## Shortcuts

| Action | Mac | Windows / Linux |
| --- | --- | --- |
| New board | `⌘⌥L` then `N` | `Ctrl+Alt+L` then `N` |
| Edit the block under the cursor | `⌘⌥L` then `E` | `Ctrl+Alt+L` then `E` |
| Insert a block | `/` | `/` |

## Good to know

- Works in VS Code and Cursor 1.105 or newer, in a folder you've opened and
  trusted. It stays off in untrusted (Restricted Mode) windows.
- Lavagna has no AI of its own and never connects to the internet: your
  editor's assistant (Copilot, Cursor) works in boards because they're plain
  markdown.
- Deleted boards go to your system's trash.

Found a bug or a security issue? See the
[repository](https://github.com/AyloSrd/lavagna) — security reports go through
its [private reporting](https://github.com/AyloSrd/lavagna/security).
