// The install/update/remove use cases, against fake ports. Pure TypeScript —
// nothing here imports `vscode`, which is the whole point of the port design:
// the skip/replace decision, the per-destination loop and the multi-scope
// iteration are the parts that can destroy a folder, and they are testable
// without downloading an editor.

import * as assert from 'assert';
import { suite, test } from 'vitest';
import { EntryKind, SkillFilesPort } from '../../application/ports/SkillFilesPort';
import { SkillCatalogPort } from '../../application/ports/SkillCatalogPort';
import { AgentDetectionPort } from '../../application/ports/AgentDetectionPort';
import {
  canInstall,
  installOptions,
  installSkill,
  isInstalledForAny,
  listSkillsWithState,
  prepareInstall,
  prepareUpdate,
  removeSkill,
  runInstall,
  scopeAvailability,
  SkillsDeps,
  updateSkill,
} from '../../application/usecases/skills';
import { agentTarget, agentTargetsFor } from '../../domain/skills/agentTargets';
import { InstalledSkill } from '../../domain/skills/installState';
import { NoHomeError, NoWorkspaceError } from '../../domain/skills/installPlan';
import { UnsafeSegmentError } from '../../domain/skills/safeSegment';
import { AgentTargetId, InstallRoots, SkillDescriptor, SkillFile } from '../../domain/skills/types';

const CORE: SkillDescriptor = {
  id: 'lavagna',
  path: 'lavagna',
  title: 'Lavagna boards',
  summary: 'Treat a board as the working surface.',
  core: true,
  version: '0.2.0',
};

const skillMd = (version: string) => `---\nname: lavagna\nmetadata:\n  version: "${version}"\n---\n`;

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bundle(version = CORE.version): SkillFile[] {
  return [
    { path: 'SKILL.md', bytes: bytes(skillMd(version)) },
    { path: 'references/guide.md', bytes: bytes('# guide') },
  ];
}

/** An in-memory skills disk: one entry per skill folder. */
class FakeSkillFiles implements SkillFilesPort {
  /** skillDir → its files. A key with no SKILL.md is a folder we can't read. */
  readonly tree: Map<string, SkillFile[]>;
  /** Paths that are a symbolic link rather than a real folder. */
  readonly links: Set<string>;
  /** Paths whose probe fails for a reason other than "not found". */
  readonly unreadable: Set<string>;
  /** Paths whose write must throw, to exercise a partial failure. */
  readonly failWrites: Set<string>;
  readonly failDeletes: Set<string>;
  readonly writes: string[];
  readonly deletes: string[];

  constructor(
    private readonly _roots: InstallRoots,
    shared?: Pick<FakeSkillFiles, 'tree' | 'links' | 'unreadable' | 'failWrites' | 'failDeletes' | 'writes' | 'deletes'>,
  ) {
    this.tree = shared?.tree ?? new Map();
    this.links = shared?.links ?? new Set();
    this.unreadable = shared?.unreadable ?? new Set();
    this.failWrites = shared?.failWrites ?? new Set();
    this.failDeletes = shared?.failDeletes ?? new Set();
    this.writes = shared?.writes ?? [];
    this.deletes = shared?.deletes ?? [];
  }

  roots(): InstallRoots {
    return this._roots;
  }

  withProjectRoot(root: string | undefined): SkillFilesPort {
    return new FakeSkillFiles({ ...this._roots, workspaceRoot: root }, this);
  }

  async entryKind(dir: string): Promise<EntryKind> {
    if (this.links.has(dir)) {
      return 'symlink';
    }
    if (this.unreadable.has(dir)) {
      return 'unreadable';
    }
    return this.tree.has(dir) ? 'directory' : 'absent';
  }

  async readSkillMd(skillDir: string): Promise<InstalledSkill> {
    const files = this.tree.get(skillDir);
    if (!files) {
      return { present: false };
    }
    const file = files.find((f) => f.path === 'SKILL.md');
    if (!file) {
      return { present: false };
    }
    // A zero-length entry stands for "there, but not read" (too large).
    return file.bytes.length === 0
      ? { present: true }
      : { present: true, skillMd: new TextDecoder().decode(file.bytes) };
  }

  async writeTree(dir: string, files: readonly SkillFile[]): Promise<void> {
    if (this.failWrites.has(dir)) {
      throw new Error('EROFS: read-only file system');
    }
    await this.deleteTree(dir);
    this.tree.set(dir, files.map((f) => ({ ...f })));
    this.writes.push(dir);
  }

  async deleteTree(dir: string): Promise<void> {
    if (this.failDeletes.has(dir)) {
      throw new Error('EPERM: operation not permitted');
    }
    this.tree.delete(dir);
    this.deletes.push(dir);
  }
}

class FakeCatalog implements SkillCatalogPort {
  reads = 0;
  constructor(
    private readonly _skills: SkillDescriptor[] = [CORE],
    private readonly _files: SkillFile[] | Error = bundle(),
  ) {}
  async listSkills(): Promise<SkillDescriptor[]> {
    return this._skills;
  }
  async readSkillFiles(): Promise<SkillFile[]> {
    this.reads++;
    if (this._files instanceof Error) {
      throw this._files;
    }
    return this._files;
  }
}

class FakeDetection implements AgentDetectionPort {
  constructor(private readonly _ids: AgentTargetId[] = []) {}
  async detect(): Promise<AgentTargetId[]> {
    return this._ids;
  }
}

function makeDeps(
  roots: InstallRoots = { home: '/home/me', workspaceRoot: '/ws' },
  catalog: FakeCatalog = new FakeCatalog(),
): SkillsDeps & { files: FakeSkillFiles; catalog: FakeCatalog } {
  return { catalog, files: new FakeSkillFiles(roots), detection: new FakeDetection() };
}

suite('skills use cases — install', () => {
  test('a destination already at the bundled version is skipped, not rewritten', async () => {
    const deps = makeDeps();
    deps.files.tree.set('/ws/.claude/skills/lavagna', bundle());

    const result = await installSkill(deps, CORE, 'project', agentTargetsFor(['claude-code']));

    assert.deepStrictEqual(result.written, []);
    assert.deepStrictEqual(result.skipped.map((d) => d.skillDir), ['/ws/.claude/skills/lavagna']);
    assert.deepStrictEqual(deps.files.writes, []);
    assert.deepStrictEqual(deps.files.deletes, []);
  });

  test('an older copy is replaced, and the stale files go with it', async () => {
    const deps = makeDeps();
    deps.files.tree.set('/ws/.claude/skills/lavagna', [
      { path: 'SKILL.md', bytes: bytes(skillMd('0.1.0')) },
      { path: 'stale.txt', bytes: bytes('old') },
    ]);

    const result = await installSkill(deps, CORE, 'project', agentTargetsFor(['claude-code']));

    assert.deepStrictEqual(result.written.map((d) => d.skillDir), ['/ws/.claude/skills/lavagna']);
    assert.deepStrictEqual(
      deps.files.tree.get('/ws/.claude/skills/lavagna')!.map((f) => f.path),
      ['SKILL.md', 'references/guide.md'],
    );
  });

  test('an unrecognised folder is refused without confirmation and replaced with it', async () => {
    const deps = makeDeps();
    const dir = '/ws/.claude/skills/lavagna';
    const foreign = [{ path: 'SKILL.md', bytes: bytes('# hand-written, no frontmatter') }];
    deps.files.tree.set(dir, foreign);

    const refused = await installSkill(deps, CORE, 'project', agentTargetsFor(['claude-code']));
    assert.deepStrictEqual(refused.written, []);
    assert.deepStrictEqual(refused.refused.map((r) => r.destination.skillDir), [dir]);
    assert.match(refused.refused[0].reason, /not confirmed/);
    assert.deepStrictEqual(deps.files.tree.get(dir), foreign, 'the foreign folder was touched');
    assert.strictEqual(deps.catalog.reads, 0, 'the bundle was read for a write that never happened');

    // The command layer collects the confirmation and passes the approved paths.
    const prepared = await prepareInstall(deps, CORE, 'project', agentTargetsFor(['claude-code']));
    assert.deepStrictEqual(prepared.needsConfirmation.map((d) => d.skillDir), [dir]);
    const done = await runInstall(deps, prepared, new Set([dir]));
    assert.deepStrictEqual(done.written.map((d) => d.skillDir), [dir]);
    assert.deepStrictEqual(deps.files.tree.get(dir)!.map((f) => f.path), ['SKILL.md', 'references/guide.md']);
  });

  test('an existing folder with no SKILL.md needs confirmation, and is replaced only once approved', async () => {
    // The audit's case: the folder is there, holding only the user's notes.
    const deps = makeDeps();
    const dir = '/ws/.claude/skills/lavagna';
    const notes = [{ path: 'my-notes.md', bytes: bytes('mine') }];
    deps.files.tree.set(dir, notes);

    const prepared = await prepareInstall(deps, CORE, 'project', agentTargetsFor(['claude-code']));
    assert.deepStrictEqual(prepared.writable, []);
    assert.deepStrictEqual(prepared.needsConfirmation.map((d) => d.skillDir), [dir]);

    // Unconfirmed: nothing is deleted, the bundle is not even read.
    const unconfirmed = await runInstall(deps, prepared);
    assert.deepStrictEqual(unconfirmed.written, []);
    assert.deepStrictEqual(unconfirmed.refused.map((r) => r.destination.skillDir), [dir]);
    assert.match(unconfirmed.refused[0].reason, /not confirmed/);
    assert.deepStrictEqual(deps.files.deletes, []);
    assert.deepStrictEqual(deps.files.writes, []);
    assert.deepStrictEqual(deps.files.tree.get(dir), notes, 'the folder was touched without confirmation');
    assert.strictEqual(deps.catalog.reads, 0);

    // Approved: replaced with the bundle.
    const done = await runInstall(deps, prepared, new Set([dir]));
    assert.deepStrictEqual(done.written.map((d) => d.skillDir), [dir]);
    assert.deepStrictEqual(deps.files.tree.get(dir)!.map((f) => f.path), ['SKILL.md', 'references/guide.md']);
  });

  test('a SKILL.md naming another skill needs confirmation, even at an older version', async () => {
    const deps = makeDeps();
    const dir = '/home/me/.claude/skills/lavagna';
    const other = `---\nname: my-own-skill\nmetadata:\n  version: "0.0.1"\n---\n`;
    deps.files.tree.set(dir, [{ path: 'SKILL.md', bytes: bytes(other) }]);

    const prepared = await prepareInstall(deps, CORE, 'global', agentTargetsFor(['claude-code']));
    assert.deepStrictEqual(prepared.writable, []);
    assert.deepStrictEqual(prepared.skipped, []);
    assert.deepStrictEqual(prepared.needsConfirmation.map((d) => d.skillDir), [dir]);

    // Update goes through the same gate.
    const [update] = await prepareUpdate(deps, CORE, agentTarget('claude-code'));
    assert.deepStrictEqual(update.writable, []);
    assert.deepStrictEqual(update.needsConfirmation.map((d) => d.skillDir), [dir]);
    const results = await updateSkill(deps, CORE, agentTarget('claude-code'));
    assert.deepStrictEqual(results.flatMap((r) => r.written), []);
    assert.deepStrictEqual(deps.files.deletes, []);
  });

  test('only a destination where nothing exists is written without asking', async () => {
    const deps = makeDeps();
    deps.files.tree.set('/ws/.claude/skills/lavagna', []); // an empty folder is still a folder

    const prepared = await prepareInstall(deps, CORE, 'project', agentTargetsFor(['claude-code', 'cursor']));

    assert.deepStrictEqual(prepared.writable.map((d) => d.skillDir), ['/ws/.agents/skills/lavagna']);
    assert.deepStrictEqual(prepared.needsConfirmation.map((d) => d.skillDir), ['/ws/.claude/skills/lavagna']);
  });

  test('a destination that cannot be inspected is refused, never treated as absent', async () => {
    const deps = makeDeps();
    const dir = '/ws/.claude/skills/lavagna';
    deps.files.unreadable.add(dir);

    const result = await installSkill(deps, CORE, 'project', agentTargetsFor(['claude-code']), new Set([dir]));

    assert.deepStrictEqual(result.written, []);
    assert.deepStrictEqual(result.refused.map((r) => r.destination.skillDir), [dir]);
    assert.match(result.refused[0].reason, /can't be inspected/);
    assert.deepStrictEqual(deps.files.deletes, []);
  });

  test('a SKILL.md that was not read counts as unrecognised, never as absent', async () => {
    const deps = makeDeps();
    // Zero bytes stands for the adapter refusing to read a 2 GB file.
    deps.files.tree.set('/ws/.claude/skills/lavagna', [{ path: 'SKILL.md', bytes: new Uint8Array() }]);

    const prepared = await prepareInstall(deps, CORE, 'project', agentTargetsFor(['claude-code']));
    assert.deepStrictEqual(prepared.writable, []);
    assert.strictEqual(prepared.needsConfirmation.length, 1);
  });

  test('a symlink at the destination is refused outright — never confirmable', async () => {
    const deps = makeDeps();
    const dir = '/home/me/.claude/skills/lavagna';
    deps.files.links.add(dir);

    const result = await installSkill(deps, CORE, 'global', agentTargetsFor(['claude-code']), new Set([dir]));

    assert.deepStrictEqual(result.written, []);
    assert.strictEqual(result.refused.length, 1);
    assert.match(result.refused[0].reason, /symbolic link/);
    assert.deepStrictEqual(deps.files.deletes, []);
  });

  test('a failure to read the bundle writes nothing at all', async () => {
    const deps = makeDeps({ home: '/home/me', workspaceRoot: '/ws' }, new FakeCatalog([CORE], new Error('EIO')));
    deps.files.tree.set('/ws/.claude/skills/lavagna', [{ path: 'SKILL.md', bytes: bytes(skillMd('0.1.0')) }]);

    await assert.rejects(installSkill(deps, CORE, 'project', agentTargetsFor(['claude-code', 'cursor'])), /EIO/);

    assert.deepStrictEqual(deps.files.writes, []);
    assert.deepStrictEqual(deps.files.deletes, []);
    assert.ok(deps.files.tree.has('/ws/.claude/skills/lavagna'), 'the old copy was destroyed');
  });

  test('one failing destination does not lose the others, and is reported', async () => {
    const deps = makeDeps();
    deps.files.failWrites.add('/ws/.agents/skills/lavagna');

    const result = await installSkill(
      deps,
      CORE,
      'project',
      agentTargetsFor(['claude-code', 'cursor']),
    );

    assert.deepStrictEqual(result.written.map((d) => d.skillDir), ['/ws/.claude/skills/lavagna']);
    assert.deepStrictEqual(result.failed.map((f) => f.destination.skillDir), ['/ws/.agents/skills/lavagna']);
    assert.match(result.failed[0].error.message, /read-only/);
  });

  test('project scope deduplicates every .agents/skills target into one write', async () => {
    const deps = makeDeps();

    const result = await installSkill(
      deps,
      CORE,
      'project',
      agentTargetsFor(['claude-code', 'cursor', 'codex', 'copilot', 'gemini', 'agents']),
    );

    assert.deepStrictEqual(deps.files.writes, ['/ws/.claude/skills/lavagna', '/ws/.agents/skills/lavagna']);
    assert.strictEqual(deps.catalog.reads, 1, 'the bundle should be read once per install');
    assert.deepStrictEqual(
      result.written.map((d) => d.targets.map((t) => t.id)),
      [['claude-code'], ['cursor', 'codex', 'copilot', 'gemini', 'agents']],
    );
    // Global scope keeps one directory per agent.
    const global = await installSkill(deps, CORE, 'global', agentTargetsFor(['cursor', 'codex', 'agents']));
    assert.deepStrictEqual(global.written.map((d) => d.skillDir), [
      '/home/me/.cursor/skills/lavagna',
      '/home/me/.codex/skills/lavagna',
      '/home/me/.agents/skills/lavagna',
    ]);
  });

  test('an unavailable scope throws before any I/O', async () => {
    const noWorkspace = makeDeps({ home: '/home/me' });
    await assert.rejects(
      installSkill(noWorkspace, CORE, 'project', agentTargetsFor(['claude-code'])),
      NoWorkspaceError,
    );
    const noHome = makeDeps({ workspaceRoot: '/ws' });
    await assert.rejects(installSkill(noHome, CORE, 'global', agentTargetsFor(['claude-code'])), NoHomeError);
    assert.deepStrictEqual(noWorkspace.files.writes, []);
    assert.deepStrictEqual(noHome.files.writes, []);
  });

  test('an unsafe skill id never reaches the port', async () => {
    const deps = makeDeps();
    await assert.rejects(
      installSkill(deps, { ...CORE, id: '../../..' }, 'global', agentTargetsFor(['claude-code'])),
      UnsafeSegmentError,
    );
    assert.deepStrictEqual(deps.files.deletes, []);
    assert.deepStrictEqual(deps.files.writes, []);
  });
});

suite('skills use cases — update and remove', () => {
  test('update rewrites every scope where a copy exists, and only those', async () => {
    const deps = makeDeps();
    deps.files.tree.set('/home/me/.claude/skills/lavagna', [
      { path: 'SKILL.md', bytes: bytes(skillMd('0.1.0')) },
    ]);

    const results = await updateSkill(deps, CORE, agentTarget('claude-code'));

    assert.deepStrictEqual(deps.files.writes, ['/home/me/.claude/skills/lavagna']);
    assert.deepStrictEqual(results.map((r) => r.scope), ['global']);
    assert.strictEqual(results[0].written.length, 1);
  });

  test('remove deletes only where the skill is actually present', async () => {
    const deps = makeDeps();
    deps.files.tree.set('/ws/.claude/skills/lavagna', bundle());

    const { removed, failed } = await removeSkill(deps, CORE, agentTarget('claude-code'));

    assert.deepStrictEqual(removed, [{ scope: 'project', skillDir: '/ws/.claude/skills/lavagna' }]);
    assert.deepStrictEqual(failed, []);
    assert.deepStrictEqual(deps.files.deletes, ['/ws/.claude/skills/lavagna']);
  });

  test('remove of something that is not installed deletes nothing', async () => {
    const deps = makeDeps();
    const { removed } = await removeSkill(deps, CORE, agentTarget('claude-code'));
    assert.deepStrictEqual(removed, []);
    assert.deepStrictEqual(deps.files.deletes, []);
  });

  test('a failing delete is reported, the other scope still goes', async () => {
    const deps = makeDeps();
    deps.files.tree.set('/home/me/.claude/skills/lavagna', bundle());
    deps.files.tree.set('/ws/.claude/skills/lavagna', bundle());
    deps.files.failDeletes.add('/home/me/.claude/skills/lavagna');

    const { removed, failed } = await removeSkill(deps, CORE, agentTarget('claude-code'));

    assert.deepStrictEqual(removed.map((r) => r.scope), ['project']);
    assert.deepStrictEqual(failed.map((f) => f.scope), ['global']);
  });
});

suite('skills use cases — reading state', () => {
  test('installOptions names a directory per agent, and none when the scope has no root', () => {
    const deps = makeDeps();
    assert.deepStrictEqual(
      installOptions(deps, 'project').map((o) => [o.target.id, o.dir]),
      [
        ['claude-code', '/ws/.claude/skills'],
        ['cursor', '/ws/.agents/skills'],
        ['codex', '/ws/.agents/skills'],
        ['copilot', '/ws/.agents/skills'],
        ['gemini', '/ws/.agents/skills'],
        ['agents', '/ws/.agents/skills'],
      ],
    );
    const noHome = makeDeps({ workspaceRoot: '/ws' });
    assert.deepStrictEqual(installOptions(noHome, 'global').map((o) => o.dir), [
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    assert.strictEqual(canInstall(noHome, 'global'), false);
    assert.strictEqual(canInstall(noHome, 'project'), true);
    assert.deepStrictEqual(scopeAvailability(deps, 'global'), { available: true });
    assert.match((scopeAvailability(noHome, 'global') as { reason: string }).reason, /no home folder/i);
  });

  test('withProjectRoot retargets the project scope without touching the global one', async () => {
    const deps = makeDeps();
    const other = deps.files.withProjectRoot('/other');
    assert.deepStrictEqual(other.roots(), { home: '/home/me', workspaceRoot: '/other' });
    await installSkill({ ...deps, files: other }, CORE, 'project', agentTargetsFor(['claude-code']));
    assert.deepStrictEqual(deps.files.writes, ['/other/.claude/skills/lavagna']);
  });

  test('the tree state covers every agent, with the unavailable scope left undefined', async () => {
    const deps = makeDeps({ home: '/home/me' });
    deps.files.tree.set('/home/me/.claude/skills/lavagna', bundle());

    const [entry] = await listSkillsWithState(deps);

    assert.strictEqual(entry.targets.length, 6);
    const claude = entry.targets.find((t) => t.target.id === 'claude-code')!;
    assert.strictEqual(claude.global, 'installed');
    assert.strictEqual(claude.project, undefined);
    assert.strictEqual(entry.targets.find((t) => t.target.id === 'cursor')!.global, 'not-installed');
    assert.strictEqual(await isInstalledForAny(deps, CORE, agentTargetsFor(['claude-code'])), true);
    assert.strictEqual(await isInstalledForAny(deps, CORE, agentTargetsFor(['cursor'])), false);
  });
});
