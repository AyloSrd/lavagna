import { AGENT_TARGETS } from '../../domain/skills/agentTargets';
import {
  InstallDestination,
  planInstall,
  resolveSkillsDir,
  scopeUnavailableReason,
  skillDirFor,
} from '../../domain/skills/installPlan';
import { computeInstallState, isPresent } from '../../domain/skills/installState';
import {
  AgentTarget,
  INSTALL_SCOPES,
  InstallScope,
  InstallState,
  SkillDescriptor,
} from '../../domain/skills/types';
import { AgentDetectionPort } from '../ports/AgentDetectionPort';
import { SkillCatalogPort } from '../ports/SkillCatalogPort';
import { SkillFilesPort } from '../ports/SkillFilesPort';

export interface SkillsDeps {
  catalog: SkillCatalogPort;
  files: SkillFilesPort;
  detection: AgentDetectionPort;
}

/** A skill's state for one target: a scope is undefined when it isn't available. */
export interface TargetStatus {
  target: AgentTarget;
  global: InstallState | undefined;
  project: InstallState | undefined;
}

export interface SkillWithState {
  skill: SkillDescriptor;
  targets: TargetStatus[];
}

/** One row of the agent picker: where this target would receive the skill. */
export interface InstallOption {
  target: AgentTarget;
  /** Undefined when the scope has no root — the option can't be installed. */
  dir: string | undefined;
}

export type ScopeAvailability = { available: true } | { available: false; reason: string };

/** A destination we won't overwrite on our own, and why. */
export interface RefusedDestination {
  destination: InstallDestination;
  reason: string;
}

/** A destination whose write threw, and what threw. */
export interface FailedDestination {
  destination: InstallDestination;
  error: Error;
}

/**
 * The plan plus what is already at each destination. Computed before anything
 * is written so the caller can ask the user about the surprising cases; the
 * domain and this layer stay UI-free.
 */
export interface PreparedInstall {
  skill: SkillDescriptor;
  scope: InstallScope;
  /** Destinations that would be written without further questions. */
  writable: InstallDestination[];
  /** Already at the bundled version — nothing to do. */
  skipped: InstallDestination[];
  /**
   * A folder is there that isn't a copy of this skill we recognise — no
   * SKILL.md, one we can't read, one naming another skill or carrying no
   * readable version: a hand-written skill, or one another tool installed.
   * Replacing it destroys it, so it needs an explicit confirmation from the
   * caller. Only a destination where nothing exists is written unasked.
   */
  needsConfirmation: InstallDestination[];
  /**
   * Nothing may write here at all: a symlink or a file sits at the path, a
   * symlink on the way leads elsewhere, or the path can't be inspected.
   */
  refused: RefusedDestination[];
}

export interface InstallResult {
  skill: SkillDescriptor;
  scope: InstallScope;
  /** Destinations that received the files. */
  written: InstallDestination[];
  /** Destinations already holding this exact version, left untouched. */
  skipped: InstallDestination[];
  /** Destinations deliberately left alone — unconfirmed, or not ours to touch. */
  refused: RefusedDestination[];
  /** Destinations whose write threw. The other destinations still landed. */
  failed: FailedDestination[];
}

export function listSkills(deps: SkillsDeps): Promise<SkillDescriptor[]> {
  return deps.catalog.listSkills();
}

export async function listSkillsWithState(deps: SkillsDeps): Promise<SkillWithState[]> {
  const skills = await deps.catalog.listSkills();
  return Promise.all(
    skills.map(async (skill) => ({
      skill,
      targets: await Promise.all(AGENT_TARGETS.map((target) => targetStatus(deps.files, skill, target))),
    })),
  );
}

/** Where each agent would receive `skill` in `scope` — what the agent picker shows. */
export function installOptions(deps: SkillsDeps, scope: InstallScope): InstallOption[] {
  const roots = deps.files.roots();
  return AGENT_TARGETS.map((target) => ({ target, dir: resolveSkillsDir(target, scope, roots) }));
}

/** Whether `scope` has a root to install under, and the reason when it hasn't. */
export function scopeAvailability(deps: SkillsDeps, scope: InstallScope): ScopeAvailability {
  const reason = scopeUnavailableReason(scope, deps.files.roots());
  return reason === undefined ? { available: true } : { available: false, reason };
}

export function canInstall(deps: SkillsDeps, scope: InstallScope): boolean {
  return scopeAvailability(deps, scope).available;
}

export async function targetStatus(
  files: SkillFilesPort,
  skill: SkillDescriptor,
  target: AgentTarget,
): Promise<TargetStatus> {
  const [global, project] = await Promise.all([
    readState(files, skill, target, 'global'),
    readState(files, skill, target, 'project'),
  ]);
  return { target, global, project };
}

/** Undefined when the scope has no root — no workspace folder, or no home. */
export async function readState(
  files: SkillFilesPort,
  skill: SkillDescriptor,
  target: AgentTarget,
  scope: InstallScope,
): Promise<InstallState | undefined> {
  const skillDir = skillDirFor(skill, target, scope, files.roots());
  if (skillDir === undefined) {
    return undefined;
  }
  return computeInstallState(skill, await files.readSkillMd(skillDir));
}

/**
 * Reads the state of every destination the plan covers, without writing. Throws
 * NoWorkspaceError / NoHomeError for an unavailable scope and UnsafeSegmentError
 * for a skill id that isn't a plain path segment — before any I/O.
 */
export async function prepareInstall(
  deps: SkillsDeps,
  skill: SkillDescriptor,
  scope: InstallScope,
  targets: readonly AgentTarget[],
): Promise<PreparedInstall> {
  const plan = planInstall(skill, scope, targets, deps.files.roots());
  const prepared: PreparedInstall = {
    skill,
    scope,
    writable: [],
    skipped: [],
    needsConfirmation: [],
    refused: [],
  };
  for (const destination of plan.destinations) {
    const kind = await deps.files.entryKind(destination.skillDir);
    if (kind === 'symlink') {
      prepared.refused.push({
        destination,
        reason: 'a symbolic link is in the way — remove or repoint it first',
      });
      continue;
    }
    if (kind === 'unsafe-path') {
      prepared.refused.push({
        destination,
        reason: 'the path to this folder goes through a symbolic link or leads outside the '
          + (scope === 'global' ? 'home folder' : 'workspace folder') + ' — Lavagna won\'t write there',
      });
      continue;
    }
    if (kind === 'file') {
      prepared.refused.push({ destination, reason: 'a file, not a folder, is in the way' });
      continue;
    }
    if (kind === 'unreadable') {
      prepared.refused.push({ destination, reason: 'what is at this path can\'t be inspected' });
      continue;
    }
    const state = computeInstallState(skill, await deps.files.readSkillMd(destination.skillDir));
    if (kind === 'absent' && state === 'not-installed') {
      // Nothing there at all: the only destination written without a word.
      prepared.writable.push(destination);
    } else if (state === 'installed') {
      prepared.skipped.push(destination);
    } else if (state === 'update-available') {
      // Our own skill, by name, at an older version — what Update is for.
      prepared.writable.push(destination);
    } else {
      // A folder that isn't a copy of this skill we can recognise: no SKILL.md,
      // one we couldn't read, one naming another skill, no readable version.
      // Replacing it deletes it, so the user decides.
      prepared.needsConfirmation.push(destination);
    }
  }
  return prepared;
}

/**
 * Writes what `prepared` says can be written. A destination in
 * `needsConfirmation` is written only when its `skillDir` is in `approved` —
 * the command layer puts it there after the user confirmed the replacement.
 *
 * One destination failing does not abort the others: the failure is collected
 * so the caller can report what did land. The catalogue is read once, up
 * front, so an unreadable bundle can never leave a destroyed destination.
 */
export async function runInstall(
  deps: SkillsDeps,
  prepared: PreparedInstall,
  approved: ReadonlySet<string> = new Set(),
): Promise<InstallResult> {
  const result: InstallResult = {
    skill: prepared.skill,
    scope: prepared.scope,
    written: [],
    skipped: [...prepared.skipped],
    refused: [...prepared.refused],
    failed: [],
  };
  const targetDirs = [...prepared.writable];
  for (const destination of prepared.needsConfirmation) {
    if (approved.has(destination.skillDir)) {
      targetDirs.push(destination);
    } else {
      result.refused.push({
        destination,
        reason: 'an unrecognised skill folder is already there and replacing it was not confirmed',
      });
    }
  }
  if (targetDirs.length === 0) {
    return result;
  }
  const files = await deps.catalog.readSkillFiles(prepared.skill);
  for (const destination of targetDirs) {
    try {
      await deps.files.writeTree(destination.skillDir, files);
      result.written.push(destination);
    } catch (error) {
      result.failed.push({ destination, error: asError(error) });
    }
  }
  return result;
}

/**
 * Copies the skill into every distinct directory the targets read in `scope`.
 * A destination already at the bundled version is skipped; an older one is
 * replaced. An unrecognised folder is left alone unless its path is in
 * `approved`.
 */
export async function installSkill(
  deps: SkillsDeps,
  skill: SkillDescriptor,
  scope: InstallScope,
  targets: readonly AgentTarget[],
  approved?: ReadonlySet<string>,
): Promise<InstallResult> {
  return runInstall(deps, await prepareInstall(deps, skill, scope, targets), approved);
}

/** Every scope where a copy of `skill` exists for `target`, prepared for a rewrite. */
export async function prepareUpdate(
  deps: SkillsDeps,
  skill: SkillDescriptor,
  target: AgentTarget,
): Promise<PreparedInstall[]> {
  const status = await targetStatus(deps.files, skill, target);
  const prepared: PreparedInstall[] = [];
  for (const scope of INSTALL_SCOPES) {
    const state = status[scope];
    if (state !== undefined && isPresent(state)) {
      prepared.push(await prepareInstall(deps, skill, scope, [target]));
    }
  }
  return prepared;
}

/** Re-installs the skill for one target in every scope where a copy exists. No scope question asked. */
export async function updateSkill(
  deps: SkillsDeps,
  skill: SkillDescriptor,
  target: AgentTarget,
  approved?: ReadonlySet<string>,
): Promise<InstallResult[]> {
  const prepared = await prepareUpdate(deps, skill, target);
  const results: InstallResult[] = [];
  for (const one of prepared) {
    results.push(await runInstall(deps, one, approved));
  }
  return results;
}

export interface RemoveResult {
  /** Skill folders deleted, one per scope where the skill was installed. */
  removed: Array<{ scope: InstallScope; skillDir: string }>;
  /** Scopes whose delete threw; the others still happened. */
  failed: Array<{ scope: InstallScope; skillDir: string; error: Error }>;
}

/** Deletes `<dir>/<skillId>` for the target in every scope where it is installed. */
export async function removeSkill(
  deps: SkillsDeps,
  skill: SkillDescriptor,
  target: AgentTarget,
): Promise<RemoveResult> {
  const status = await targetStatus(deps.files, skill, target);
  const removed: RemoveResult['removed'] = [];
  const failed: RemoveResult['failed'] = [];
  for (const scope of INSTALL_SCOPES) {
    const state = status[scope];
    const skillDir = skillDirFor(skill, target, scope, deps.files.roots());
    if (state === undefined || !isPresent(state) || skillDir === undefined) {
      continue;
    }
    try {
      await deps.files.deleteTree(skillDir);
      removed.push({ scope, skillDir });
    } catch (error) {
      failed.push({ scope, skillDir, error: asError(error) });
    }
  }
  return { removed, failed };
}

/** The skills marked `core` in the manifest — what Lavagna itself relies on. */
export async function coreSkills(deps: SkillsDeps): Promise<SkillDescriptor[]> {
  return (await deps.catalog.listSkills()).filter((skill) => skill.core);
}

/** True when the skill is present, in any scope, for any of the given targets. */
export async function isInstalledForAny(
  deps: SkillsDeps,
  skill: SkillDescriptor,
  targets: readonly AgentTarget[],
): Promise<boolean> {
  for (const target of targets) {
    const status = await targetStatus(deps.files, skill, target);
    if (INSTALL_SCOPES.some((scope) => status[scope] !== undefined && isPresent(status[scope]!))) {
      return true;
    }
  }
  return false;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
