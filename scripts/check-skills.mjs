#!/usr/bin/env node
// Validates the agent skills in /skills against the Agent Skills standard and
// against what the extension, the Claude Code plugin and `npx skills add`
// expect from them:
//
//   - every skills/*/SKILL.md has YAML frontmatter (parsed with a real YAML
//     loader) carrying `name`, `description` and `metadata.version`
//   - `name` equals the folder name and matches ^[a-z0-9-]{1,64}$
//   - `description` is at most 1024 characters
//   - `allowed-tools`, when present, is a list of tool names or one string
//   - `metadata.version` is a semver string (the extension compares it to
//     detect updates)
//   - the body is at most 500 lines
//   - every relative link in a SKILL.md body or in skills/*/references/**/*.md
//     points at an existing file
//   - skills/manifest.json lists every skill folder and nothing else, each
//     entry's `path` is a single safe folder name, and `id` equals `path`
//   - .claude-plugin/plugin.json is at least as new as the newest skill
//
// Exits non-zero with one line per problem. Run with:
//
//   node scripts/check-skills.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, 'skills');
const manifestPath = join(skillsDir, 'manifest.json');
const pluginPath = join(root, '.claude-plugin', 'plugin.json');

const NAME_RE = /^[a-z0-9-]{1,64}$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const MAX_DESCRIPTION = 1024;
const MAX_BODY_LINES = 500;

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

/** statSync that answers "is this a directory?" without throwing on a dangling symlink. */
const isDirectory = (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

// --- Frontmatter -----------------------------------------------------------

/**
 * Split a SKILL.md into its frontmatter text and body lines. A leading UTF-8
 * BOM is stripped first: real skill loaders ignore it, so the checker must
 * not report a BOM as "no frontmatter".
 */
function splitFrontmatter(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0] !== '---') {
    return null;
  }
  const end = lines.indexOf('---', 1);
  if (end === -1) {
    return null;
  }
  return { frontmatter: lines.slice(1, end).join('\n'), body: lines.slice(end + 1) };
}

/**
 * Parse frontmatter with a real YAML loader, so what passes here is exactly
 * what a skill runtime will accept: block sequences (`allowed-tools:`) work,
 * and malformed YAML is rejected rather than silently reinterpreted.
 */
function parseFrontmatter(text) {
  const value = parseYaml(text, { version: '1.2' });
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('frontmatter must be a YAML mapping');
  }
  return value;
}

// --- Links -------------------------------------------------------------------

/** An opening fence: its char and run length, or null. */
function openingFence(line) {
  const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) {
    return null;
  }
  const char = m[1][0];
  // A ``` info string may not contain a backtick.
  if (char === '`' && m[2].includes('`')) {
    return null;
  }
  return { char, length: m[1].length };
}

/** Does this line close the given fence? Same char, at least as long, nothing after it. */
function closesFence(line, fence) {
  const m = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return m !== null && m[1][0] === fence.char && m[1].length >= fence.length;
}

const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])(\s+)/;

/**
 * The prose lines of a markdown body: everything outside fenced code blocks
 * and outside 4-space-indented code blocks. Indented code is measured from
 * the content column of the enclosing list item, so a nested bullet is prose
 * while an indented example block is not.
 */
function proseLines(bodyLines) {
  const out = [];
  let fence = null;
  let inIndentedCode = false;
  let listContentIndent = 0;
  let prevBlank = true;

  for (const line of bodyLines) {
    const blank = line.trim() === '';
    const indent = line.length - line.trimStart().length;
    const codeIndent = listContentIndent + 4;

    if (fence) {
      if (closesFence(line, fence)) {
        fence = null;
      }
      prevBlank = blank;
      continue;
    }

    if (inIndentedCode) {
      if (blank || indent >= codeIndent) {
        prevBlank = blank;
        continue;
      }
      inIndentedCode = false;
    }

    if (!blank && prevBlank && indent >= codeIndent) {
      inIndentedCode = true;
      prevBlank = false;
      continue;
    }

    const opened = openingFence(line);
    if (opened) {
      fence = opened;
      prevBlank = false;
      continue;
    }

    const item = LIST_ITEM_RE.exec(line);
    if (item) {
      listContentIndent = item[1].length + item[2].length + item[3].length;
    } else if (!blank && indent <= listContentIndent && indent < codeIndent) {
      // A line back at or left of the item's own content column that is not a
      // list item ends the list context, unless it is a lazy continuation.
      if (indent === 0) {
        listContentIndent = 0;
      }
    }

    out.push(line);
    prevBlank = blank;
  }
  return out;
}

/** Relative link targets in markdown, excluding code blocks and inline code. */
function relativeLinks(bodyLines) {
  const targets = [];
  for (const line of proseLines(bodyLines)) {
    const prose = line.replace(/`[^`]*`/g, '');
    for (const m of prose.matchAll(/\]\((<[^>]*>|[^)\s]+)\)/g)) {
      const target = m[1].replace(/^<|>$/g, '');
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) {
        continue; // URL, in-page anchor, or root-relative (not a file we can check)
      }
      const path = target.split('#')[0];
      if (path) {
        targets.push(path);
      }
    }
  }
  return targets;
}

/** Check every relative link in `bodyLines`, resolved against `baseDir`. */
function checkLinks(where, bodyLines, baseDir) {
  for (const target of relativeLinks(bodyLines)) {
    let decoded;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      fail(where, `link target ${JSON.stringify(target)} is not valid percent-encoding`);
      continue;
    }
    if (!existsSync(resolve(baseDir, decoded))) {
      fail(where, `link target ${JSON.stringify(target)} does not exist`);
    }
  }
}

/** Every *.md under a directory, recursively. Missing directory yields nothing. */
function markdownFiles(dir) {
  if (!isDirectory(dir)) {
    return [];
  }
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (isDirectory(path)) {
      out.push(...markdownFiles(path));
    } else if (entry.name.endsWith('.md')) {
      out.push(path);
    }
  }
  return out;
}

/** Compare two semver core versions; prerelease tags are ignored. */
function compareVersions(a, b) {
  const parts = (v) => v.split('-')[0].split('+')[0].split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) {
      return (x[i] ?? 0) - (y[i] ?? 0);
    }
  }
  return 0;
}

// --- Skills -------------------------------------------------------------------

const skillFolders = readdirSync(skillsDir)
  .filter((entry) => isDirectory(join(skillsDir, entry)))
  .sort();

if (skillFolders.length === 0) {
  fail('skills/', 'no skill folders found');
}

const skillVersions = [];

for (const folder of skillFolders) {
  const where = `skills/${folder}/SKILL.md`;
  const skillPath = join(skillsDir, folder, 'SKILL.md');
  if (!existsSync(skillPath)) {
    fail(where, 'missing');
    continue;
  }

  const text = readFileSync(skillPath, 'utf8');
  const parts = splitFrontmatter(text);
  if (!parts) {
    fail(where, 'no YAML frontmatter delimited by --- lines at the top');
    continue;
  }

  let fm;
  try {
    fm = parseFrontmatter(parts.frontmatter);
  } catch (error) {
    fail(where, `frontmatter does not parse: ${error.message}`);
    continue;
  }

  if (typeof fm.name !== 'string' || fm.name === '') {
    fail(where, 'frontmatter lacks `name`');
  } else {
    if (!NAME_RE.test(fm.name)) {
      fail(where, `name ${JSON.stringify(fm.name)} must match ^[a-z0-9-]{1,64}$`);
    }
    if (fm.name !== folder) {
      fail(where, `name ${JSON.stringify(fm.name)} does not equal its folder name ${JSON.stringify(folder)}`);
    }
  }

  if (typeof fm.description !== 'string' || fm.description.trim() === '') {
    fail(where, 'frontmatter lacks `description`');
  } else if (fm.description.length > MAX_DESCRIPTION) {
    fail(where, `description is ${fm.description.length} characters; the limit is ${MAX_DESCRIPTION}`);
  }

  const allowed = fm['allowed-tools'];
  if (allowed !== undefined) {
    const names = Array.isArray(allowed) ? allowed : [allowed];
    if (names.length === 0 || names.some((name) => typeof name !== 'string' || name.trim() === '')) {
      fail(where, '`allowed-tools` must be a non-empty list of tool names, or one string');
    }
  }

  const version = fm.metadata && typeof fm.metadata === 'object' ? fm.metadata.version : undefined;
  if (typeof version !== 'string') {
    fail(where, 'frontmatter lacks `metadata.version`');
  } else if (!SEMVER_RE.test(version)) {
    fail(where, `metadata.version ${JSON.stringify(version)} is not semver`);
  } else {
    skillVersions.push(version);
  }

  if (parts.body.length > MAX_BODY_LINES) {
    fail(where, `body is ${parts.body.length} lines; the limit is ${MAX_BODY_LINES}`);
  }

  checkLinks(where, parts.body, join(skillsDir, folder));

  for (const file of markdownFiles(join(skillsDir, folder, 'references'))) {
    const label = relative(root, file).split(sep).join('/');
    checkLinks(label, readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/), dirname(file));
  }
}

// --- Manifest -----------------------------------------------------------------

if (!existsSync(manifestPath)) {
  fail('skills/manifest.json', 'missing');
} else {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail('skills/manifest.json', `does not parse: ${error.message}`);
  }
  if (manifest) {
    const entries = Array.isArray(manifest.skills) ? manifest.skills : [];
    if (!Array.isArray(manifest.skills)) {
      fail('skills/manifest.json', '`skills` must be an array');
    }
    const listed = new Set();
    for (const [i, entry] of entries.entries()) {
      const where = `skills/manifest.json skills[${i}]`;
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        fail(where, 'must be an object');
        continue;
      }
      for (const key of ['id', 'path', 'title', 'summary']) {
        if (typeof entry[key] !== 'string' || entry[key].trim() === '') {
          fail(where, `missing string field \`${key}\``);
        }
      }
      if (typeof entry.core !== 'boolean') {
        fail(where, '`core` must be a boolean');
      }
      if (typeof entry.path === 'string') {
        // `path` names a folder directly under skills/ — never an absolute
        // path and never something that can escape it with `..`. This is the
        // only validator between manifest.json and files copied onto a user's
        // machine by the Skills panel and the plugin manifests.
        if (isAbsolute(entry.path)) {
          fail(where, `path ${JSON.stringify(entry.path)} must be a single skills/ folder name, not an absolute path`);
          continue;
        }
        if (!NAME_RE.test(entry.path)) {
          fail(where, `path ${JSON.stringify(entry.path)} must be a single skills/ folder name matching ^[a-z0-9-]{1,64}$`);
          continue;
        }
        if (listed.has(entry.path)) {
          fail(where, `path ${JSON.stringify(entry.path)} is listed twice`);
        }
        listed.add(entry.path);
        if (!existsSync(join(skillsDir, entry.path, 'SKILL.md'))) {
          fail(where, `path ${JSON.stringify(entry.path)} has no SKILL.md under skills/`);
        }
        if (typeof entry.id === 'string' && entry.id !== entry.path) {
          fail(where, `id ${JSON.stringify(entry.id)} should equal path ${JSON.stringify(entry.path)}`);
        }
      }
    }
    for (const folder of skillFolders) {
      if (!listed.has(folder)) {
        fail('skills/manifest.json', `skill folder ${JSON.stringify(folder)} is not listed`);
      }
    }
    const coreCount = entries.filter((entry) => entry && entry.core === true).length;
    if (coreCount > 1) {
      fail('skills/manifest.json', `expected at most one \`core: true\` entry, found ${coreCount}`);
    }
  }
}

// --- Plugin manifest ----------------------------------------------------------

// Adding, removing or changing a skill has to reach `/plugin update` users,
// which keys off the plugin's own version.
if (!existsSync(pluginPath)) {
  fail('.claude-plugin/plugin.json', 'missing');
} else {
  let plugin;
  try {
    plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));
  } catch (error) {
    fail('.claude-plugin/plugin.json', `does not parse: ${error.message}`);
  }
  if (plugin) {
    if (typeof plugin.version !== 'string' || !SEMVER_RE.test(plugin.version)) {
      fail('.claude-plugin/plugin.json', `version ${JSON.stringify(plugin.version)} is not semver`);
    } else {
      const newest = skillVersions.sort(compareVersions).at(-1);
      if (newest && compareVersions(plugin.version, newest) < 0) {
        fail(
          '.claude-plugin/plugin.json',
          `version ${JSON.stringify(plugin.version)} is older than the newest skill version ${JSON.stringify(newest)}; bump it when a skill changes`,
        );
      }
    }
  }
}

// --- Report -------------------------------------------------------------------

if (problems.length > 0) {
  console.error(`check-skills: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(`check-skills: ${skillFolders.length} skill${skillFolders.length === 1 ? '' : 's'} OK (${skillFolders.join(', ')})`);
