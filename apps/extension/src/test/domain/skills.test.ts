import * as assert from 'assert';
import { suite, test } from 'vitest';
import { frontmatterVersion, parseFrontmatter } from '../../domain/skills/frontmatter';
import { compareVersions, parseSemver } from '../../domain/skills/semver';
import {
  joinPath,
  NoHomeError,
  NoWorkspaceError,
  planInstall,
  resolveSkillsDir,
  scopeUnavailableReason,
  skillDirFor,
} from '../../domain/skills/installPlan';
import { computeInstallState } from '../../domain/skills/installState';
import { agentTarget, agentTargetsFor, suggestTargets } from '../../domain/skills/agentTargets';
import { InvalidManifestError, parseManifest } from '../../domain/skills/manifest';
import {
  assertSafeSegment,
  isSafeRelativePath,
  isSafeSegment,
  UnsafeSegmentError,
} from '../../domain/skills/safeSegment';
import { SkillDescriptor } from '../../domain/skills/types';

const skill: SkillDescriptor = {
  id: 'lavagna',
  path: 'lavagna',
  title: 'Lavagna boards',
  summary: 'Treat a board as the working surface.',
  core: true,
  version: '0.2.0',
};

/** Everything a manifest could say that must never become a path. */
const TRAVERSALS = [
  '..',
  '.',
  '',
  '../../..',
  'a/../../b',
  'a/b',
  'a\\b',
  '/etc',
  '/etc/passwd',
  'C:',
  'C:\\Windows',
  '\\\\server\\share',
  '..\\..\\windows',
  './x',
  ' ',
  ' lavagna',
  'lavagna ',
  '.hidden',
  '-leading-dash',
  '_leading-underscore',
  'a'.repeat(65),
  'sk\u0000ill',
  'sk/ill',
  'sk\nill',
];

suite('skills — path safety', () => {
  test('accepts plain names only', () => {
    for (const ok of ['lavagna', 'a', 'SKILL.md', 'my-skill_2', 'v1.2.3', 'a'.repeat(64)]) {
      assert.strictEqual(isSafeSegment(ok), true, `${JSON.stringify(ok)} should be safe`);
    }
  });

  test('rejects every traversal, separator, drive letter and empty segment', () => {
    for (const bad of TRAVERSALS) {
      assert.strictEqual(isSafeSegment(bad), false, `${JSON.stringify(bad)} should be unsafe`);
    }
    assert.strictEqual(isSafeSegment(undefined), false);
    assert.strictEqual(isSafeSegment(42), false);
  });

  test('a relative path is safe only when every segment is', () => {
    assert.strictEqual(isSafeRelativePath('nested/b'), true);
    assert.strictEqual(isSafeRelativePath('references/guide.md'), true);
    assert.strictEqual(isSafeRelativePath('a/../../b'), false);
    assert.strictEqual(isSafeRelativePath('a//b'), false);
    assert.strictEqual(isSafeRelativePath('/a'), false);
    assert.strictEqual(isSafeRelativePath('a/'), false);
    assert.strictEqual(isSafeRelativePath(''), false);
  });

  test('assertSafeSegment throws UnsafeSegmentError naming what was rejected', () => {
    assert.throws(() => assertSafeSegment('../../..', 'skill id'), UnsafeSegmentError);
    assert.throws(() => assertSafeSegment('../../..', 'skill id'), /Unsafe skill id: "\.\.\/\.\.\/\.\."/);
  });
});

suite('skills — frontmatter', () => {
  test('reads top-level scalars and the nested metadata mapping', () => {
    const fm = parseFrontmatter(
      '---\nname: lavagna\ndescription: Work with boards: dual-channel.\nmetadata:\n  version: "0.1.0"\n  author: someone\n---\n\n# Lavagna\n',
    );
    assert.deepStrictEqual(fm, {
      name: 'lavagna',
      description: 'Work with boards: dual-channel.',
      metadata: { version: '0.1.0', author: 'someone' },
    });
    assert.strictEqual(frontmatterVersion(fm), '0.1.0');
  });

  test('accepts single-quoted and bare versions', () => {
    assert.strictEqual(frontmatterVersion(parseFrontmatter("---\nmetadata:\n  version: '1.2.3'\n---\n")), '1.2.3');
    assert.strictEqual(frontmatterVersion(parseFrontmatter('---\nmetadata:\n  version: 1.2.3\n---\n')), '1.2.3');
  });

  test('tolerates CRLF, blank lines and comments', () => {
    const fm = parseFrontmatter('---\r\n# a comment\r\nname: x\r\n\r\nmetadata:\r\n  version: "0.0.1"\r\n---\r\nbody');
    assert.strictEqual(fm?.name, 'x');
    assert.strictEqual(frontmatterVersion(fm), '0.0.1');
  });

  test('missing metadata gives no version; a scalar metadata is not a mapping', () => {
    assert.strictEqual(frontmatterVersion(parseFrontmatter('---\nname: x\n---\n')), undefined);
    assert.strictEqual(frontmatterVersion(parseFrontmatter('---\nmetadata: nope\n---\n')), undefined);
    assert.strictEqual(frontmatterVersion(parseFrontmatter('---\nmetadata:\n  version: ""\n---\n')), undefined);
  });

  test('no frontmatter block, or an unterminated one, is undefined', () => {
    assert.strictEqual(parseFrontmatter('# Just markdown\n'), undefined);
    assert.strictEqual(parseFrontmatter('---\nname: x\n'), undefined);
    assert.strictEqual(parseFrontmatter(''), undefined);
    assert.strictEqual(frontmatterVersion(undefined), undefined);
  });

  test('a top-level key after a nested mapping closes the mapping', () => {
    const fm = parseFrontmatter('---\nmetadata:\n  version: 1.0.0\nname: after\n---\n');
    assert.deepStrictEqual(fm, { metadata: { version: '1.0.0' }, name: 'after' });
  });

  test('a leading byte-order mark does not hide the opening ---', () => {
    const fm = parseFrontmatter('﻿---\nname: x\nmetadata:\n  version: "1.0.0"\n---\nbody');
    assert.strictEqual(fm?.name, 'x');
    assert.strictEqual(frontmatterVersion(fm), '1.0.0');
    // Only one, and only at the start.
    assert.strictEqual(parseFrontmatter('x﻿---\nname: y\n---\n'), undefined);
  });
});

suite('skills — semver', () => {
  test('parses release and prerelease versions, with or without v', () => {
    assert.deepStrictEqual(parseSemver('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] });
    assert.deepStrictEqual(parseSemver('v1.2.3-beta.2+build'), {
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['beta', '2'],
    });
    assert.strictEqual(parseSemver('1.2'), undefined);
    assert.strictEqual(parseSemver('latest'), undefined);
  });

  test('compares numerically, not lexically', () => {
    assert.ok(compareVersions('0.1.0', '0.2.0')! < 0);
    assert.ok(compareVersions('0.10.0', '0.9.0')! > 0);
    assert.ok(compareVersions('1.0.0', '0.99.99')! > 0);
    assert.strictEqual(compareVersions('1.0.0', 'v1.0.0'), 0);
  });

  test('a release outranks its prereleases; prereleases order by identifiers', () => {
    assert.ok(compareVersions('1.0.0', '1.0.0-rc.1')! > 0);
    assert.ok(compareVersions('1.0.0-alpha', '1.0.0-beta')! < 0);
    assert.ok(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')! < 0);
    assert.ok(compareVersions('1.0.0-rc.1', '1.0.0-rc.1.1')! < 0);
    assert.ok(compareVersions('1.0.0-1', '1.0.0-alpha')! < 0);
  });

  test('unparsable input yields undefined', () => {
    assert.strictEqual(compareVersions('x', '1.0.0'), undefined);
    assert.strictEqual(compareVersions('1.0.0', ''), undefined);
  });

  test('digit runs past precision are rejected rather than compared as 1e21', () => {
    assert.strictEqual(parseSemver('999999999999999999999.0.0'), undefined);
    assert.strictEqual(compareVersions('999999999999999999999.0.0', '1.0.0'), undefined);
    assert.deepStrictEqual(parseSemver('999999999.0.0'), {
      major: 999999999,
      minor: 0,
      patch: 0,
      prerelease: [],
    });
    // A prerelease identifier that long compares as text, not as a lossy number.
    assert.ok(compareVersions('1.0.0-99999999999999999999', '1.0.0-2')! > 0);
  });
});

suite('skills — install plan', () => {
  const roots = { home: '/home/me/', workspaceRoot: '/ws' };

  test('joinPath tolerates trailing and leading separators', () => {
    assert.strictEqual(joinPath('/home/me/', '.claude/skills', 'lavagna'), '/home/me/.claude/skills/lavagna');
    assert.strictEqual(joinPath('C:\\Users\\me\\', '.codex/skills'), 'C:\\Users\\me/.codex/skills');
  });

  test('resolves global dirs under home and project dirs under the workspace', () => {
    assert.strictEqual(resolveSkillsDir(agentTarget('cursor'), 'global', roots), '/home/me/.cursor/skills');
    assert.strictEqual(resolveSkillsDir(agentTarget('cursor'), 'project', roots), '/ws/.agents/skills');
    assert.strictEqual(resolveSkillsDir(agentTarget('cursor'), 'project', { home: '/home/me' }), undefined);
  });

  test('project scope deduplicates every .agents/skills target into one destination', () => {
    const plan = planInstall(skill, 'project', agentTargetsFor(['claude-code', 'cursor', 'codex', 'copilot', 'gemini', 'agents']), roots);
    assert.deepStrictEqual(
      plan.destinations.map((d) => [d.dir, d.targets.map((t) => t.id)]),
      [
        ['/ws/.claude/skills', ['claude-code']],
        ['/ws/.agents/skills', ['cursor', 'codex', 'copilot', 'gemini', 'agents']],
      ],
    );
    assert.strictEqual(plan.destinations[1].skillDir, '/ws/.agents/skills/lavagna');
  });

  test('global scope keeps one destination per agent', () => {
    const plan = planInstall(skill, 'global', agentTargetsFor(['cursor', 'codex', 'agents']), roots);
    assert.deepStrictEqual(
      plan.destinations.map((d) => d.dir),
      ['/home/me/.cursor/skills', '/home/me/.codex/skills', '/home/me/.agents/skills'],
    );
  });

  test('project scope without a workspace folder throws before planning anything', () => {
    assert.throws(() => planInstall(skill, 'project', agentTargetsFor(['cursor']), { home: '/home/me' }), NoWorkspaceError);
  });

  test('no targets → empty plan, nothing to write', () => {
    assert.deepStrictEqual(planInstall(skill, 'global', [], roots).destinations, []);
  });

  test('an unsafe skill id never becomes a path, in either entry point', () => {
    for (const id of TRAVERSALS) {
      const evil = { ...skill, id };
      assert.throws(
        () => planInstall(evil, 'global', agentTargetsFor(['claude-code']), roots),
        UnsafeSegmentError,
        `planInstall accepted id ${JSON.stringify(id)}`,
      );
      assert.throws(
        () => skillDirFor(evil, agentTarget('claude-code'), 'global', roots),
        UnsafeSegmentError,
        `skillDirFor accepted id ${JSON.stringify(id)}`,
      );
    }
    // The id is checked before the scope, so even an impossible scope can't
    // slip a traversal past by throwing a different error first.
    assert.throws(
      () => planInstall({ ...skill, id: '../../..' }, 'project', [], { home: '/home/me' }),
      UnsafeSegmentError,
    );
  });

  test('an empty home makes the global scope unavailable instead of targeting /', () => {
    const noHome = { workspaceRoot: '/ws' };
    assert.strictEqual(resolveSkillsDir(agentTarget('claude-code'), 'global', noHome), undefined);
    assert.strictEqual(resolveSkillsDir(agentTarget('claude-code'), 'global', { home: '' }), undefined);
    assert.strictEqual(skillDirFor(skill, agentTarget('claude-code'), 'global', noHome), undefined);
    assert.throws(() => planInstall(skill, 'global', agentTargetsFor(['claude-code']), noHome), NoHomeError);
    assert.match(scopeUnavailableReason('global', noHome)!, /no home folder/i);
    assert.strictEqual(scopeUnavailableReason('global', roots), undefined);
    assert.match(scopeUnavailableReason('project', { home: '/home/me' })!, /local folder/i);
    assert.strictEqual(scopeUnavailableReason('project', roots), undefined);
  });
});

suite('skills — install state', () => {
  const BUNDLED = { id: 'lavagna', version: '0.2.0' };
  const skillMd = (version: string) => `---\nname: lavagna\nmetadata:\n  version: "${version}"\n---\n# Lavagna\n`;

  test('absent → not-installed', () => {
    assert.strictEqual(computeInstallState(BUNDLED, { present: false }), 'not-installed');
  });

  test('same version → installed; newer installed copy also counts as installed', () => {
    assert.strictEqual(computeInstallState(BUNDLED, { present: true, skillMd: skillMd('0.2.0') }), 'installed');
    assert.strictEqual(computeInstallState(BUNDLED, { present: true, skillMd: skillMd('0.3.0') }), 'installed');
  });

  test('older installed copy → update-available', () => {
    assert.strictEqual(computeInstallState(BUNDLED, { present: true, skillMd: skillMd('0.1.9') }), 'update-available');
    assert.strictEqual(computeInstallState(BUNDLED, { present: true, skillMd: skillMd('0.2.0-rc.1') }), 'update-available');
  });

  test('present but unreadable version → unknown', () => {
    assert.strictEqual(computeInstallState(BUNDLED, { present: true }), 'unknown');
    assert.strictEqual(computeInstallState(BUNDLED, { present: true, skillMd: '# no frontmatter' }), 'unknown');
    assert.strictEqual(computeInstallState(BUNDLED, { present: true, skillMd: '---\nname: x\n---\n' }), 'unknown');
    assert.strictEqual(computeInstallState(BUNDLED, { present: true, skillMd: skillMd('latest') }), 'unknown');
    assert.strictEqual(computeInstallState({ ...BUNDLED, version: 'garbage' }, { present: true, skillMd: skillMd('0.2.0') }), 'unknown');
  });

  test('a SKILL.md for another skill → unknown, whatever version it claims', () => {
    const other = (version: string) => `---\nname: my-own-skill\nmetadata:\n  version: "${version}"\n---\n`;
    assert.strictEqual(computeInstallState(BUNDLED, { present: true, skillMd: other('0.1.0') }), 'unknown');
    assert.strictEqual(computeInstallState(BUNDLED, { present: true, skillMd: other('0.2.0') }), 'unknown');
    const unnamed = '---\nmetadata:\n  version: "0.1.0"\n---\n';
    assert.strictEqual(computeInstallState(BUNDLED, { present: true, skillMd: unnamed }), 'unknown');
  });
});

suite('skills — agent detection', () => {
  test('unions editor, extension and workspace signals in table order', () => {
    assert.deepStrictEqual(
      suggestTargets({
        appName: 'Cursor',
        extensionIds: ['GitHub.copilot-chat', 'ms-python.python'],
        presentMarkers: ['CLAUDE.md'],
      }),
      ['claude-code', 'cursor', 'copilot'],
    );
  });

  test('Windsurf maps to the generic .agents target; nothing detected → empty', () => {
    assert.deepStrictEqual(suggestTargets({ appName: 'Windsurf', extensionIds: [], presentMarkers: [] }), ['agents']);
    assert.deepStrictEqual(suggestTargets({ appName: 'Visual Studio Code', extensionIds: [], presentMarkers: [] }), []);
  });

  test('every extension and marker resolves to a known target', () => {
    assert.deepStrictEqual(
      suggestTargets({
        appName: 'Visual Studio Code',
        extensionIds: ['anthropic.claude-code', 'openai.chatgpt', 'google.geminicodeassist'],
        presentMarkers: ['.cursor', '.codex', '.github/copilot-instructions.md', '.gemini', 'AGENTS.md', '.agents'],
      }),
      ['claude-code', 'cursor', 'codex', 'copilot', 'gemini', 'agents'],
    );
  });

  test('agentTargetsFor drops unknown ids and keeps table order', () => {
    assert.deepStrictEqual(agentTargetsFor(['agents', 'nope', 'claude-code']).map((t) => t.id), ['claude-code', 'agents']);
  });
});

suite('skills — manifest', () => {
  test('parses the documented shape and defaults core to false', () => {
    const entries = parseManifest({
      version: 1,
      skills: [
        { id: 'a', path: 'a', title: 'A', summary: 'sa', core: true },
        { id: 'b', path: 'nested/b', title: 'B', summary: 'sb' },
      ],
    });
    assert.deepStrictEqual(entries, [
      { id: 'a', path: 'a', title: 'A', summary: 'sa', core: true },
      { id: 'b', path: 'nested/b', title: 'B', summary: 'sb', core: false },
    ]);
  });

  test('rejects wrong versions, missing fields and paths that escape the bundle', () => {
    assert.throws(() => parseManifest(null), InvalidManifestError);
    assert.throws(() => parseManifest({ version: 2, skills: [] }), InvalidManifestError);
    assert.throws(() => parseManifest({ version: 1, skills: [{ id: 'a', path: 'a', title: 'A' }] }), InvalidManifestError);
    assert.throws(
      () => parseManifest({ version: 1, skills: [{ id: 'a', path: '../a', title: 'A', summary: 's' }] }),
      InvalidManifestError,
    );
  });

  test('rejects every unsafe id — the id is the folder that gets deleted and rewritten', () => {
    for (const id of TRAVERSALS) {
      assert.throws(
        () => parseManifest({ version: 1, skills: [{ id, path: 'lavagna', title: 'X', summary: 's' }] }),
        InvalidManifestError,
        `manifest accepted id ${JSON.stringify(id)}`,
      );
    }
  });

  test('rejects every unsafe path segment', () => {
    for (const path of ['..', '', '/etc', 'a/../../b', 'C:\\Windows', 'a//b', 'nested/..']) {
      assert.throws(
        () => parseManifest({ version: 1, skills: [{ id: 'a', path, title: 'X', summary: 's' }] }),
        InvalidManifestError,
        `manifest accepted path ${JSON.stringify(path)}`,
      );
    }
  });

  test('rejects duplicate ids — they fight over one folder and break the tree', () => {
    assert.throws(
      () =>
        parseManifest({
          version: 1,
          skills: [
            { id: 'a', path: 'a', title: 'A', summary: 'sa' },
            { id: 'a', path: 'b', title: 'B', summary: 'sb' },
          ],
        }),
      /duplicate skill id "a"/,
    );
  });
});
