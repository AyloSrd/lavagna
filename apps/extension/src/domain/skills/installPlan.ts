import { assertSafeSegment } from './safeSegment';
import { AgentTarget, InstallRoots, InstallScope, SkillDescriptor } from './types';

/** One directory a skill will be copied into, and the targets that read it. */
export interface InstallDestination {
  /** Absolute skills directory, e.g. `/home/me/.claude/skills`. */
  dir: string;
  /** `<dir>/<skillId>` — the folder that receives the skill's files. */
  skillDir: string;
  targets: AgentTarget[];
}

export interface InstallPlan {
  skill: SkillDescriptor;
  scope: InstallScope;
  /** Deduplicated by directory, in target-table order of first appearance. */
  destinations: InstallDestination[];
}

export class NoWorkspaceError extends Error {
  constructor() {
    super('Open a local folder to install skills into this workspace.');
    this.name = 'NoWorkspaceError';
  }
}

export class NoHomeError extends Error {
  constructor() {
    super('This host reports no home folder, so skills cannot be installed globally.');
    this.name = 'NoHomeError';
  }
}

/** The root a scope installs under, or undefined when that scope is unavailable. */
export function scopeRoot(scope: InstallScope, roots: InstallRoots): string | undefined {
  const root = scope === 'global' ? roots.home : roots.workspaceRoot;
  return root ? root : undefined;
}

/** Why `scope` can't be installed into, or undefined when it can. */
export function scopeUnavailableReason(scope: InstallScope, roots: InstallRoots): string | undefined {
  if (scopeRoot(scope, roots) !== undefined) {
    return undefined;
  }
  return scope === 'global' ? new NoHomeError().message : new NoWorkspaceError().message;
}

/**
 * Absolute skills directory of a target in a scope. Undefined when the scope's
 * root is unavailable — no workspace folder open, or a host with no home.
 */
export function resolveSkillsDir(
  target: AgentTarget,
  scope: InstallScope,
  roots: InstallRoots,
): string | undefined {
  const root = scopeRoot(scope, roots);
  if (root === undefined) {
    return undefined;
  }
  return joinPath(root, scope === 'global' ? target.globalDir : target.projectDir);
}

/**
 * `<skillsDir>/<skill.id>`. Throws UnsafeSegmentError when the id is anything
 * but a plain path segment — belt and braces with the manifest parser, because
 * this is the last place before a path reaches the filesystem adapter.
 */
export function skillDirFor(
  skill: SkillDescriptor,
  target: AgentTarget,
  scope: InstallScope,
  roots: InstallRoots,
): string | undefined {
  assertSafeSegment(skill.id, 'skill id');
  const dir = resolveSkillsDir(target, scope, roots);
  return dir === undefined ? undefined : joinPath(dir, skill.id);
}

/**
 * Where to copy `skill` for `targets` in `scope`. Targets sharing a directory
 * (every `.agents/skills` user at project scope) collapse into one destination.
 * Throws NoWorkspaceError / NoHomeError when the scope has no root, and
 * UnsafeSegmentError for an id that isn't a plain segment — all before
 * anything is written.
 */
export function planInstall(
  skill: SkillDescriptor,
  scope: InstallScope,
  targets: readonly AgentTarget[],
  roots: InstallRoots,
): InstallPlan {
  assertSafeSegment(skill.id, 'skill id');
  if (scope === 'project' && scopeRoot('project', roots) === undefined) {
    throw new NoWorkspaceError();
  }
  if (scope === 'global' && scopeRoot('global', roots) === undefined) {
    throw new NoHomeError();
  }
  const byDir = new Map<string, InstallDestination>();
  for (const target of targets) {
    const dir = resolveSkillsDir(target, scope, roots);
    if (dir === undefined) {
      continue;
    }
    const existing = byDir.get(dir);
    if (existing) {
      existing.targets.push(target);
    } else {
      byDir.set(dir, { dir, skillDir: joinPath(dir, skill.id), targets: [target] });
    }
  }
  return { skill, scope, destinations: [...byDir.values()] };
}

/**
 * Joins with '/'. Roots come from the host and may use backslashes on Windows;
 * a mixed path is still a valid file path there, and the adapters normalise
 * through `Uri.file` anyway. Kept here so the domain stays free of `node:path`.
 */
export function joinPath(base: string, ...segments: string[]): string {
  let result = base.replace(/[\\/]+$/, '');
  for (const segment of segments) {
    result += '/' + segment.replace(/^[\\/]+|[\\/]+$/g, '');
  }
  return result;
}
