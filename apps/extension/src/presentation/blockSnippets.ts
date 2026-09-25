// Single source of truth for the insertable blocks. Both the "Insert Block"
// context submenu and the `/` slash menu read this list, so they can't drift
// apart.

export interface BlockSnippet {
  /** Command suffix: `lavagna.insertBlock.<key>`. */
  key: string;
  label: string;
  detail: string;
  /** SnippetString body. Omitted for entries that run a command instead. */
  body?: string;
  /** Run instead of inserting text (used by File Reference's picker). */
  command?: string;
}

export const BLOCK_SNIPPETS: BlockSnippet[] = [
  {
    key: 'flow',
    label: 'Flowchart',
    detail: 'mermaid flowchart — editable visually',
    body: '```mermaid\nflowchart TD\n  a["${1:Start}"] --> b["${2:End}"]\n```\n',
  },
  {
    key: 'sequence',
    label: 'Sequence Diagram',
    detail: 'mermaid sequenceDiagram — editable visually',
    body: '```mermaid\nsequenceDiagram\n  participant ${1:A}\n  participant ${2:B}\n  ${1:A}->>${2:B}: ${3:message}\n```\n',
  },
  {
    key: 'tree',
    label: 'Tree',
    detail: 'indented outline with connectors',
    body: '```tree\n${1:root}\n  ${2:child}\n```\n',
  },
  {
    key: 'canvas',
    label: 'Canvas',
    detail: 'drawing — pick a blank page or an image',
    // An empty target means "no image yet" — the editor opens on the
    // blank-page / upload chooser and writes the file only once you choose.
    body: '![${1:canvas}]()\n',
  },
  {
    key: 'table',
    label: 'Table',
    detail: 'GFM pipe table — editable as a grid',
    body: '| ${1:Column} | ${2:Column} |\n| --- | --- |\n| $3 | $4 |\n',
  },
  {
    key: 'spiral',
    label: 'Spiral ꩜',
    detail: 'insert the ꩜ marker',
    // U+AA5C. A marker, not a block: a skill watches for these and answers in
    // place, so the snippet is just the character and a space to type after.
    body: '꩜ $0',
  },
  {
    key: 'fileRef',
    label: 'File Reference',
    detail: 'pick a workspace file to link',
    command: 'lavagna.insertFileRef',
  },
];
