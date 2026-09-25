import * as vscode from 'vscode';
import {
  installOptions,
  InstallResult,
  listSkills,
  prepareInstall,
  PreparedInstall,
  prepareUpdate,
  removeSkill,
  runInstall,
  scopeAvailability,
  SkillsDeps,
} from '../../application/usecases/skills';
import { InstallDestination } from '../../domain/skills/installPlan';
import { AgentTarget, INSTALL_SCOPES, InstallScope, SkillDescriptor } from '../../domain/skills/types';
import { log } from '../../infrastructure/logging/log';
import { SkillsNode, SkillsTreeProvider, TargetNode } from '../providers/SkillsTreeProvider';

const SKILL_MD = 'SKILL.md';

/**
 * Every write to a skills directory starts here, from a click. The install
 * flow asks the workspace folder (multi-root only), the scope, then the
 * targets — and, when an unrecognised folder is already at a destination, a
 * modal that names it. Only then are files copied.
 */
export function registerSkillCommands(deps: SkillsDeps, tree: SkillsTreeProvider): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('lavagna.installSkill', (arg?: SkillsNode | string) =>
      guarded(async () => {
        const skill = await resolveSkill(deps, arg);
        if (!skill) {
          return;
        }
        const scoped = await pickScopeAndFolder(deps);
        if (!scoped) {
          return;
        }
        const { deps: scopedDeps, scope } = scoped;
        const preselected = new Set(await scopedDeps.detection.detect());
        if (isTargetNode(arg)) {
          preselected.add(arg.status.target.id);
        }
        const targets = await pickTargets(scopedDeps, scope, preselected);
        if (!targets) {
          return; // cancelled
        }
        if (targets.length === 0) {
          vscode.window.showInformationMessage('Lavagna: nothing selected — no skill was installed.');
          return;
        }
        const prepared = await prepareInstall(scopedDeps, skill, scope, targets);
        const approved = await confirmReplacements(skill, [prepared]);
        if (approved === undefined) {
          return; // the modal was dismissed
        }
        // Whatever happens below, the tree must show what is actually on disk.
        try {
          await reportInstall(await runInstall(scopedDeps, prepared, approved));
        } finally {
          tree.refresh();
        }
      }),
    ),

    vscode.commands.registerCommand('lavagna.updateSkill', (node?: TargetNode) =>
      guarded(async () => {
        if (!isTargetNode(node)) {
          return; // only invokable from a target row
        }
        const { skill, status } = node;
        const prepared = await prepareUpdate(deps, skill, status.target);
        const approved = await confirmReplacements(skill, prepared);
        if (approved === undefined) {
          return;
        }
        const results: InstallResult[] = [];
        try {
          for (const one of prepared) {
            results.push(await runInstall(deps, one, approved));
          }
        } finally {
          tree.refresh();
        }
        const written = results.filter((r) => r.written.length > 0);
        if (written.length === 0) {
          await reportNothingWritten(results, `${skill.title} is already up to date for ${status.target.label}.`);
          return;
        }
        await showWithReveal(
          `Updated ${skill.title} for ${status.target.label} (${written.map((r) => scopeWord(r.scope)).join(', ')})`
            + problemSuffix(results),
          written[0].written[0],
        );
      }),
    ),

    vscode.commands.registerCommand('lavagna.removeSkill', (node?: TargetNode) =>
      guarded(async () => {
        if (!isTargetNode(node)) {
          return;
        }
        const { skill, status } = node;
        const pick = await vscode.window.showWarningMessage(
          `Remove ${skill.title} for ${status.target.label}? The skill folder is deleted in every scope where it is installed.`,
          { modal: true },
          'Remove',
        );
        if (pick !== 'Remove') {
          return;
        }
        let removed: Awaited<ReturnType<typeof removeSkill>>;
        try {
          removed = await removeSkill(deps, skill, status.target);
        } finally {
          tree.refresh();
        }
        const failures = removed.failed.map((f) => `${displayPath(f.skillDir)}: ${f.error.message}`);
        if (removed.removed.length === 0) {
          vscode.window.showInformationMessage(
            failures.length > 0
              ? `Lavagna: ${skill.title} could not be removed — ${failures.join('; ')}`
              : `${skill.title} was not installed for ${status.target.label}.`,
          );
          return;
        }
        const scopes = removed.removed.map((r) => scopeWord(r.scope)).join(', ');
        vscode.window.showInformationMessage(
          `Removed ${skill.title} for ${status.target.label} (${scopes})`
            + (failures.length > 0 ? ` — ${failures.length} could not be removed: ${failures.join('; ')}` : ''),
        );
      }),
    ),

    vscode.commands.registerCommand('lavagna.refreshSkills', () => tree.refresh()),
  ];
}

async function guarded(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`skills command failed: ${message}`);
    vscode.window.showErrorMessage(`Lavagna: ${message}`);
  }
}

function isTargetNode(arg: unknown): arg is TargetNode {
  return typeof arg === 'object' && arg !== null && (arg as TargetNode).kind === 'target';
}

/** From a tree node, a skill id, or — from the palette — a QuickPick over the catalogue. */
async function resolveSkill(deps: SkillsDeps, arg?: SkillsNode | string): Promise<SkillDescriptor | undefined> {
  if (typeof arg === 'object' && arg !== null) {
    return arg.kind === 'skill' ? arg.entry.skill : arg.skill;
  }
  const skills = await listSkills(deps);
  if (typeof arg === 'string') {
    const skill = skills.find((s) => s.id === arg);
    if (!skill) {
      throw new Error(`Unknown skill "${arg}".`);
    }
    return skill;
  }
  if (skills.length === 1) {
    return skills[0];
  }
  const pick = await vscode.window.showQuickPick(
    skills.map((skill) => ({ label: skill.title, description: `v${skill.version}`, detail: skill.summary, skill })),
    { title: 'Install skill', placeHolder: 'Which skill?' },
  );
  return pick?.skill;
}

/**
 * The workspace folder (asked only when more than one is open) and the scope.
 * Returns deps whose project scope points at the chosen folder. A scope with
 * no root — no local folder, no home, an untrusted workspace — is not offered;
 * when nothing is left, the reasons are shown instead.
 */
async function pickScopeAndFolder(
  deps: SkillsDeps,
): Promise<{ deps: SkillsDeps; scope: InstallScope } | undefined> {
  const folder = await pickWorkspaceFolder();
  if (folder === 'cancelled') {
    return undefined;
  }
  const scoped: SkillsDeps = { ...deps, files: deps.files.withProjectRoot(folder) };

  const unavailable: string[] = [];
  const items: Array<vscode.QuickPickItem & { scope: InstallScope }> = [];
  for (const scope of INSTALL_SCOPES) {
    const reason = scopeReason(scoped, scope);
    if (reason) {
      unavailable.push(reason);
      continue;
    }
    items.push(
      scope === 'global'
        ? { label: 'Global', description: 'once per machine, every project (recommended)', scope }
        : { label: 'This workspace', description: 'visible to teammates, shows in git', scope },
    );
  }
  if (items.length === 0) {
    vscode.window.showErrorMessage(`Lavagna: ${unavailable.join(' ')}`);
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(items, {
    title: 'Install skill — where?',
    placeHolder: unavailable.length > 0 ? unavailable.join(' ') : 'Choose a scope',
  });
  return pick ? { deps: scoped, scope: pick.scope } : undefined;
}

/** The domain's reason, plus the one thing only the host knows: workspace trust. */
function scopeReason(deps: SkillsDeps, scope: InstallScope): string | undefined {
  const availability = scopeAvailability(deps, scope);
  if (!availability.available) {
    return availability.reason;
  }
  if (scope === 'project' && !vscode.workspace.isTrusted) {
    return 'Skills can only be installed into a trusted workspace.';
  }
  return undefined;
}

/**
 * `undefined` for "use the default", a path for the chosen folder,
 * `'cancelled'` when the user dismissed the picker. Only asked when more than
 * one folder is open — a single-folder workspace has nothing to choose.
 */
async function pickWorkspaceFolder(): Promise<string | undefined | 'cancelled'> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const local = folders.filter((f) => f.uri.scheme === 'file');
  if (local.length <= 1) {
    return local[0]?.uri.fsPath;
  }
  const pick = await vscode.window.showQuickPick(
    local.map((folder) => ({ label: folder.name, detail: folder.uri.fsPath, folder })),
    { title: 'Install skill — into which folder?', placeHolder: 'This workspace has several folders' },
  );
  return pick ? pick.folder.uri.fsPath : 'cancelled';
}

async function pickTargets(
  deps: SkillsDeps,
  scope: InstallScope,
  preselected: ReadonlySet<string>,
): Promise<AgentTarget[] | undefined> {
  const items = installOptions(deps, scope).map((option) => ({
    label: option.target.label,
    detail: option.dir === undefined ? '' : displayPath(option.dir),
    picked: preselected.has(option.target.id),
    target: option.target,
  }));
  const picks = await vscode.window.showQuickPick(items, {
    title: 'Install skill — for which agents?',
    placeHolder: 'Detected agents are pre-selected; the skill is copied once per directory',
    canPickMany: true,
  });
  return picks?.map((pick) => pick.target);
}

/**
 * A folder we did not put there is never replaced silently. Returns the set of
 * skill folders the user agreed to overwrite (empty when there was nothing to
 * ask), or `undefined` when they dismissed the modal — which cancels the whole
 * operation rather than half-doing it.
 */
async function confirmReplacements(
  skill: SkillDescriptor,
  prepared: readonly PreparedInstall[],
): Promise<ReadonlySet<string> | undefined> {
  const destinations = prepared.flatMap((p) => p.needsConfirmation);
  if (destinations.length === 0) {
    return new Set();
  }
  const list = destinations.map((d) => `• ${displayPath(d.skillDir)}`).join('\n');
  const pick = await vscode.window.showWarningMessage(
    `Replace ${destinations.length === 1 ? 'a folder' : `${destinations.length} folders`} Lavagna did not install?`,
    {
      modal: true,
      detail:
        `A folder is already at ${destinations.length === 1 ? 'this location' : 'these locations'} `
        + `that Lavagna can't recognise as its own copy of ${skill.title} — no SKILL.md, another skill's, `
        + `or one whose version can't be read. It may be a skill you wrote or another tool installed. `
        + `Installing ${skill.title} deletes the folder and everything in it.\n\n${list}`,
    },
    'Replace',
    'Skip these',
  );
  if (pick === 'Replace') {
    return new Set(destinations.map((d) => d.skillDir));
  }
  if (pick === 'Skip these') {
    return new Set();
  }
  return undefined;
}

/** Per destination, not per selected agent: several agents share one folder. */
async function reportInstall(result: InstallResult): Promise<void> {
  const parts: string[] = [];
  if (result.written.length > 0) {
    parts.push(`Installed ${result.skill.title} into ${destinationList(result.written)}`);
  }
  if (result.skipped.length > 0) {
    parts.push(`${result.skipped.length} already up to date (${destinationList(result.skipped)})`);
  }
  for (const { destination, reason } of result.refused) {
    parts.push(`skipped ${displayPath(destination.skillDir)} — ${reason}`);
  }
  for (const { destination, error } of result.failed) {
    parts.push(`failed at ${displayPath(destination.skillDir)} — ${error.message}`);
  }
  if (parts.length === 0) {
    vscode.window.showInformationMessage(`Lavagna: nothing to install for ${result.skill.title}.`);
    return;
  }
  const message = `${parts.join('; ')} (${scopeWord(result.scope)}).`;
  if (result.written.length === 0) {
    if (result.failed.length > 0 || result.refused.length > 0) {
      vscode.window.showWarningMessage(`Lavagna: ${message}`);
      return;
    }
    await showWithReveal(message, result.skipped[0]);
    return;
  }
  await showWithReveal(message, result.written[0]);
}

async function reportNothingWritten(results: readonly InstallResult[], fallback: string): Promise<void> {
  const problems = results.flatMap(describeProblems);
  vscode.window.showInformationMessage(problems.length > 0 ? `Lavagna: ${problems.join('; ')}` : fallback);
}

function problemSuffix(results: readonly InstallResult[]): string {
  const problems = results.flatMap(describeProblems);
  return problems.length > 0 ? ` — ${problems.join('; ')}` : '';
}

function describeProblems(result: InstallResult): string[] {
  return [
    ...result.refused.map(({ destination, reason }) => `${displayPath(destination.skillDir)}: ${reason}`),
    ...result.failed.map(({ destination, error }) => `${displayPath(destination.skillDir)}: ${error.message}`),
  ];
}

function destinationList(destinations: readonly InstallDestination[]): string {
  return destinations.map((d) => displayPath(d.skillDir)).join(', ');
}

async function showWithReveal(message: string, destination: InstallDestination | undefined): Promise<void> {
  if (!destination) {
    vscode.window.showInformationMessage(message);
    return;
  }
  const pick = await vscode.window.showInformationMessage(message, 'Show files');
  if (pick === 'Show files') {
    // The SKILL.md, not its folder: revealing a directory selects it in its
    // parent, which is one level away from what the user asked to see.
    await vscode.commands.executeCommand(
      'revealFileInOS',
      vscode.Uri.joinPath(vscode.Uri.file(destination.skillDir), SKILL_MD),
    );
  }
}

/**
 * The domain joins with '/' on every platform. `Uri.file().fsPath` puts the
 * host's separator back, so a Windows user is never shown `C:\Users\me/.codex`.
 */
function displayPath(dir: string): string {
  return vscode.Uri.file(dir).fsPath;
}

function scopeWord(scope: InstallScope): string {
  return scope === 'global' ? 'global' : 'this workspace';
}
