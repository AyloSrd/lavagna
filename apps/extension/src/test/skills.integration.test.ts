import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentDetectionPort } from '../application/ports/AgentDetectionPort';
import {
  installSkill,
  listSkillsWithState,
  prepareInstall,
  readState,
  removeSkill,
  runInstall,
  SkillsDeps,
} from '../application/usecases/skills';
import { agentTarget, agentTargetsFor } from '../domain/skills/agentTargets';
import { AgentTargetId } from '../domain/skills/types';
import { BundledSkillCatalog } from '../infrastructure/skills/BundledSkillCatalog';
import { VsCodeSkillFiles } from '../infrastructure/skills/VsCodeSkillFiles';
import { SkillsTreeProvider } from '../presentation/providers/SkillsTreeProvider';

class FakeDetection implements AgentDetectionPort {
  constructor(private readonly _ids: AgentTargetId[]) {}
  detect(): Promise<AgentTargetId[]> {
    return Promise.resolve(this._ids);
  }
}

suite('Skills (integration)', () => {
  // The bundle the running extension carries — what production reads.
  const extensionUri = vscode.extensions.getExtension('aylosrd.lavagna')!.extensionUri;
  const tempDirs: string[] = [];

  /**
   * A throwaway "workspace" and "home" per test, so the project and global
   * scopes both land in temp folders rather than the real ones, and no test
   * depends on the state another one left behind.
   */
  function freshDeps(): SkillsDeps & { workspace: string; home: string } {
    const workspace = temp('lavagna-skills-ws-');
    const home = temp('lavagna-skills-home-');
    return {
      catalog: new BundledSkillCatalog(extensionUri),
      files: new VsCodeSkillFiles(vscode.Uri.file(workspace), home),
      detection: new FakeDetection(['claude-code', 'cursor']),
      workspace,
      home,
    };
  }

  function temp(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  async function core(deps: SkillsDeps) {
    const [skill] = (await deps.catalog.listSkills()).filter((s) => s.core);
    return skill;
  }

  suiteTeardown(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the bundled catalog has a manifest with at least one versioned skill', async () => {
    const deps = freshDeps();
    const skills = await deps.catalog.listSkills();
    assert.ok(skills.length >= 1, 'no skills in the bundle');
    for (const skill of skills) {
      assert.ok(skill.id && skill.title && skill.summary, `incomplete entry ${skill.id}`);
      assert.match(skill.version, /^\d+\.\d+\.\d+/, `${skill.id} has no semver version`);
      assert.notStrictEqual(skill.version, '0.0.0', `${skill.id} lost its metadata.version in the bundle`);
      const files = await deps.catalog.readSkillFiles(skill);
      assert.ok(files.some((f) => f.path === 'SKILL.md'), `${skill.id} has no SKILL.md`);
    }
    assert.ok(skills.some((s) => s.core), 'no core skill');
  });

  test('nothing is installed before the user acts', async () => {
    const deps = freshDeps();
    const [entry] = await listSkillsWithState(deps);
    for (const status of entry.targets) {
      assert.strictEqual(status.global, 'not-installed');
      assert.strictEqual(status.project, 'not-installed');
    }
    assert.deepStrictEqual(fs.readdirSync(deps.workspace), []);
    assert.deepStrictEqual(fs.readdirSync(deps.home), []);

    const tree = new SkillsTreeProvider(deps);
    const [row] = await tree.getChildren((await tree.getChildren())[0]);
    assert.strictEqual(tree.getTreeItem(row).contextValue, 'lavagnaSkillTarget.installable');
    assert.strictEqual(tree.getTreeItem(row).description, 'global – · project –');
  });

  test('installing the core skill at project scope writes SKILL.md once per directory', async () => {
    const deps = freshDeps();
    const skill = await core(deps);
    const targets = agentTargetsFor(['claude-code', 'cursor', 'codex']);
    const result = await installSkill(deps, skill, 'project', targets);

    assert.deepStrictEqual(
      result.written.map((d) => normalize(d.dir)).sort(),
      [path.join(deps.workspace, '.agents/skills'), path.join(deps.workspace, '.claude/skills')]
        .map(normalize)
        .sort(),
    );
    assert.deepStrictEqual(result.skipped, []);
    assert.deepStrictEqual(result.refused, []);
    assert.deepStrictEqual(result.failed, []);
    for (const dir of ['.claude/skills', '.agents/skills']) {
      const skillMd = path.join(deps.workspace, dir, skill.id, 'SKILL.md');
      assert.ok(fs.existsSync(skillMd), `${skillMd} missing`);
    }
    // Global scope untouched.
    assert.deepStrictEqual(fs.readdirSync(deps.home), []);

    assert.strictEqual(await readState(deps.files, skill, agentTarget('claude-code'), 'project'), 'installed');
    assert.strictEqual(await readState(deps.files, skill, agentTarget('codex'), 'project'), 'installed');
    assert.strictEqual(await readState(deps.files, skill, agentTarget('claude-code'), 'global'), 'not-installed');
  });

  test('re-installing the same version skips; an older copy reads update-available and is overwritten', async () => {
    const deps = freshDeps();
    const skill = await core(deps);
    await installSkill(deps, skill, 'project', agentTargetsFor(['claude-code']));

    const again = await installSkill(deps, skill, 'project', agentTargetsFor(['claude-code']));
    assert.deepStrictEqual(again.written, []);
    assert.strictEqual(again.skipped.length, 1);

    const skillDir = path.join(deps.workspace, '.claude/skills', skill.id);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: lavagna\nmetadata:\n  version: "0.0.1"\n---\n');
    fs.writeFileSync(path.join(skillDir, 'stale.txt'), 'old');
    assert.strictEqual(await readState(deps.files, skill, agentTarget('claude-code'), 'project'), 'update-available');

    const updated = await installSkill(deps, skill, 'project', agentTargetsFor(['claude-code']));
    assert.strictEqual(updated.written.length, 1);
    assert.strictEqual(await readState(deps.files, skill, agentTarget('claude-code'), 'project'), 'installed');
    assert.strictEqual(fs.existsSync(path.join(skillDir, 'stale.txt')), false);
  });

  test('a foreign SKILL.md is left alone until the replacement is approved', async () => {
    const deps = freshDeps();
    const skill = await core(deps);
    const skillDir = path.join(deps.workspace, '.claude/skills', skill.id);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# hand-written, no frontmatter\n');
    fs.writeFileSync(path.join(skillDir, 'notes.md'), 'mine\n');

    const refused = await installSkill(deps, skill, 'project', agentTargetsFor(['claude-code']));
    assert.deepStrictEqual(refused.written, []);
    assert.strictEqual(refused.refused.length, 1);
    assert.ok(fs.existsSync(path.join(skillDir, 'notes.md')), 'the foreign folder was destroyed');

    const prepared = await prepareInstall(deps, skill, 'project', agentTargetsFor(['claude-code']));
    assert.strictEqual(prepared.needsConfirmation.length, 1);
    const done = await runInstall(deps, prepared, new Set(prepared.needsConfirmation.map((d) => d.skillDir)));
    assert.strictEqual(done.written.length, 1);
    assert.strictEqual(fs.existsSync(path.join(skillDir, 'notes.md')), false);
  });

  test('an existing folder with no SKILL.md is left alone until the replacement is approved', async () => {
    const deps = freshDeps();
    const skill = await core(deps);
    const skillDir = path.join(deps.home, '.claude/skills', skill.id);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'my-notes.md'), 'mine\n');

    const prepared = await prepareInstall(deps, skill, 'global', agentTargetsFor(['claude-code']));
    assert.deepStrictEqual(prepared.writable, []);
    assert.strictEqual(prepared.needsConfirmation.length, 1);
    const refused = await runInstall(deps, prepared);
    assert.deepStrictEqual(refused.written, []);
    assert.ok(fs.existsSync(path.join(skillDir, 'my-notes.md')), 'the folder was deleted without confirmation');

    const done = await runInstall(deps, prepared, new Set(prepared.needsConfirmation.map((d) => d.skillDir)));
    assert.strictEqual(done.written.length, 1);
    assert.ok(fs.existsSync(path.join(skillDir, 'SKILL.md')));
    assert.strictEqual(fs.existsSync(path.join(skillDir, 'my-notes.md')), false);
  });

  test('a symlinked destination is refused, and a dangling one does not wedge the install', async () => {
    const deps = freshDeps();
    const skill = await core(deps);
    const skillsDir = path.join(deps.workspace, '.claude/skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const elsewhere = temp('lavagna-skills-elsewhere-');
    fs.symlinkSync(elsewhere, path.join(skillsDir, skill.id));

    const refused = await installSkill(deps, skill, 'project', agentTargetsFor(['claude-code']));
    assert.deepStrictEqual(refused.written, []);
    assert.strictEqual(refused.refused.length, 1);
    assert.match(refused.refused[0].reason, /symbolic link/);
    assert.deepStrictEqual(fs.readdirSync(elsewhere), [], 'the link target was written into');

    // A link with no target is equally refused, and never leaves an EEXIST behind.
    fs.unlinkSync(path.join(skillsDir, skill.id));
    fs.symlinkSync(path.join(elsewhere, 'gone'), path.join(skillsDir, skill.id));
    const dangling = await installSkill(deps, skill, 'project', agentTargetsFor(['claude-code']));
    assert.strictEqual(dangling.written.length + dangling.refused.length, 1);
  });

  test('a symlinked .agents/skills in the workspace is refused for install, remove and direct writes', async () => {
    const deps = freshDeps();
    const skill = await core(deps);
    const outside = temp('lavagna-skills-outside-');
    // What a repository can commit: `.agents/skills -> <somewhere else>`.
    fs.mkdirSync(path.join(deps.workspace, '.agents'));
    fs.symlinkSync(outside, path.join(deps.workspace, '.agents/skills'), 'junction');

    const result = await installSkill(deps, skill, 'project', agentTargetsFor(['cursor']));
    assert.deepStrictEqual(result.written, []);
    assert.strictEqual(result.refused.length, 1);
    assert.match(result.refused[0].reason, /symbolic link/);
    assert.deepStrictEqual(fs.readdirSync(outside), [], 'the install wrote through the link');

    // A folder of the same name out there reads as installed through the link —
    // and Remove must still not reach it.
    const victim = path.join(outside, skill.id);
    fs.mkdirSync(victim);
    fs.writeFileSync(path.join(victim, 'SKILL.md'), `---\nname: ${skill.id}\nmetadata:\n  version: "0.0.1"\n---\n`);
    const { removed, failed } = await removeSkill(deps, skill, agentTarget('cursor'));
    assert.deepStrictEqual(removed, []);
    assert.strictEqual(failed.length, 1);
    assert.match(failed[0].error.message, /Refusing to modify/);
    assert.ok(fs.existsSync(path.join(victim, 'SKILL.md')), 'remove deleted through the link');

    const dir = path.join(deps.workspace, '.agents/skills', skill.id);
    await assert.rejects(deps.files.writeTree(dir, []), /Refusing to modify/);
    await assert.rejects(deps.files.deleteTree(dir), /Refusing to modify/);
    assert.ok(fs.existsSync(path.join(victim, 'SKILL.md')));
  });

  test('a home folder reached through a symlink still takes a global install', async () => {
    const deps = freshDeps();
    const skill = await core(deps);
    const homeLink = path.join(temp('lavagna-skills-homelink-'), 'home');
    fs.symlinkSync(deps.home, homeLink, 'junction');
    const linked: SkillsDeps = { ...deps, files: new VsCodeSkillFiles(vscode.Uri.file(deps.workspace), homeLink) };

    const result = await installSkill(linked, skill, 'global', agentTargetsFor(['claude-code']));
    assert.strictEqual(result.written.length, 1);
    assert.deepStrictEqual(result.refused, []);
    assert.ok(fs.existsSync(path.join(deps.home, '.claude/skills', skill.id, 'SKILL.md')));
  });

  test('a path outside the home and the workspace is refused by the adapter itself', async () => {
    const deps = freshDeps();
    const outside = temp('lavagna-skills-outside-');
    await assert.rejects(deps.files.writeTree(path.join(outside, 'x'), []), /Refusing to modify/);
    await assert.rejects(deps.files.deleteTree(outside), /Refusing to modify/);
    // The roots themselves are not "inside" themselves.
    await assert.rejects(deps.files.deleteTree(deps.home), /Refusing to modify/);
    await assert.rejects(deps.files.deleteTree(deps.workspace), /Refusing to modify/);
    // A `..` walks straight out of the workspace. Probed on a name that does
    // not exist, so a broken guard here can't cost anything.
    await assert.rejects(
      deps.files.deleteTree(path.join(deps.workspace, '..', 'lavagna-guard-probe-nonexistent')),
      /Refusing to modify/,
    );
    assert.ok(fs.existsSync(outside));
  });

  test('a skill file path that is not a plain relative path is refused before anything is deleted', async () => {
    const deps = freshDeps();
    const skill = await core(deps);
    await installSkill(deps, skill, 'project', agentTargetsFor(['claude-code']));
    const skillDir = path.join(deps.workspace, '.claude/skills', skill.id);

    await assert.rejects(
      deps.files.writeTree(skillDir, [{ path: '../../evil.sh', bytes: new Uint8Array([1]) }]),
      /Unsafe skill file path/,
    );
    assert.ok(fs.existsSync(path.join(skillDir, 'SKILL.md')), 'the existing folder was deleted anyway');
    assert.strictEqual(fs.existsSync(path.join(deps.workspace, '.claude/evil.sh')), false);
  });

  test('the tree reflects state; a shared .agents/skills copy shows for every agent reading it', async () => {
    const deps = freshDeps();
    const skill = await core(deps);
    await installSkill(deps, skill, 'project', agentTargetsFor(['claude-code', 'cursor', 'codex']));

    const tree = new SkillsTreeProvider(deps);
    const roots = await tree.getChildren();
    assert.ok(roots.length >= 1);
    assert.strictEqual(tree.getTreeItem(roots[0]).collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    const rows = await tree.getChildren(roots[0]);
    const claude = rows.find((r) => r.kind === 'target' && r.status.target.id === 'claude-code')!;
    const gemini = rows.find((r) => r.kind === 'target' && r.status.target.id === 'gemini')!;
    // Installed at project scope only, so Install is still offered for global.
    assert.strictEqual(tree.getTreeItem(claude).contextValue, 'lavagnaSkillTarget.present.installable');
    assert.strictEqual(tree.getTreeItem(claude).description, 'global – · project ✓');
    // Installed for cursor/codex, but Gemini reads the same project directory.
    assert.strictEqual(tree.getTreeItem(gemini).contextValue, 'lavagnaSkillTarget.present.installable');
    assert.strictEqual(tree.getTreeItem(gemini).description, 'global – · project ✓');
  });

  test('remove deletes the skill folder in the scopes where it was installed', async () => {
    const deps = freshDeps();
    const skill = await core(deps);
    await installSkill(deps, skill, 'project', agentTargetsFor(['claude-code', 'cursor']));

    const { removed, failed } = await removeSkill(deps, skill, agentTarget('claude-code'));
    assert.deepStrictEqual(removed.map((r) => r.scope), ['project']);
    assert.deepStrictEqual(failed, []);
    assert.strictEqual(fs.existsSync(path.join(deps.workspace, '.claude/skills', skill.id)), false);
    // The shared .agents/skills copy belongs to other targets too and stays.
    assert.strictEqual(fs.existsSync(path.join(deps.workspace, '.agents/skills', skill.id, 'SKILL.md')), true);
  });

  test('project scope without a workspace folder writes nothing', async () => {
    const deps = freshDeps();
    const skill = await core(deps);
    const noWorkspace: SkillsDeps = { ...deps, files: new VsCodeSkillFiles(undefined, deps.home) };
    await assert.rejects(
      installSkill(noWorkspace, skill, 'project', agentTargetsFor(['claude-code'])),
      /Open a local folder/,
    );
    assert.deepStrictEqual(fs.readdirSync(deps.home), []);
  });

  test('a virtual workspace folder is not a project-scope root', async () => {
    const deps = freshDeps();
    const virtual = new VsCodeSkillFiles(vscode.Uri.parse('vscode-vfs://github/org/repo'), deps.home);
    assert.strictEqual(virtual.roots().workspaceRoot, undefined);
    await assert.rejects(
      installSkill({ ...deps, files: virtual }, await core(deps), 'project', agentTargetsFor(['claude-code'])),
      /Open a local folder/,
    );
  });

  test('a host with no home folder has no global scope', async () => {
    const deps = freshDeps();
    const homeless = new VsCodeSkillFiles(vscode.Uri.file(deps.workspace), '');
    assert.strictEqual(homeless.roots().home, undefined);
    await assert.rejects(
      installSkill({ ...deps, files: homeless }, await core(deps), 'global', agentTargetsFor(['claude-code'])),
      /no home folder/,
    );
    assert.deepStrictEqual(fs.readdirSync(deps.workspace), []);
  });
});

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}
