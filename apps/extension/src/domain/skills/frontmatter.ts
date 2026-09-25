// Minimal YAML frontmatter reader for SKILL.md files.
//
// Deliberately not a YAML parser: it understands the subset our skills emit —
// top-level `key: value` scalars and one level of nested mappings such as
// `metadata:` followed by indented `key: value` lines. Values may be bare or
// wrapped in single or double quotes. Anything else is ignored rather than
// rejected, so a hand-edited file still yields whatever it can.

export type FrontmatterValue = string | Record<string, string>;
export type Frontmatter = Record<string, FrontmatterValue>;

const KEY_VALUE = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/;

/** Returns undefined when the text doesn't start with a `---` block. */
export function parseFrontmatter(text: string): Frontmatter | undefined {
  // ﻿ spelled out: the literal BOM is invisible in an editor and one
  // encoding-normalising tool away from disappearing from the regex.
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return undefined;
  }
  const end = lines.findIndex((line, i) => i > 0 && (line.trim() === '---' || line.trim() === '...'));
  if (end === -1) {
    return undefined;
  }

  const result: Frontmatter = {};
  let nested: { key: string; map: Record<string, string> } | undefined;

  for (const raw of lines.slice(1, end)) {
    if (!raw.trim() || raw.trim().startsWith('#')) {
      continue;
    }
    const indented = /^\s/.test(raw);
    const match = KEY_VALUE.exec(raw.trim());
    if (!match) {
      continue; // lists, multi-line scalars, … — not something we emit
    }
    const [, key, rawValue] = match;
    if (indented) {
      if (nested && rawValue !== undefined) {
        nested.map[key] = unquote(rawValue);
      }
      continue;
    }
    if (rawValue === undefined || rawValue.trim() === '') {
      nested = { key, map: {} };
      result[key] = nested.map;
    } else {
      nested = undefined;
      result[key] = unquote(rawValue);
    }
  }
  return result;
}

/** `metadata.version` when present as a string. */
export function frontmatterVersion(frontmatter: Frontmatter | undefined): string | undefined {
  const metadata = frontmatter?.metadata;
  if (!metadata || typeof metadata === 'string') {
    return undefined;
  }
  const version = metadata.version;
  return version ? version : undefined;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.length >= 2 && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
