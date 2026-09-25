import { frontmatterVersion, parseFrontmatter } from './frontmatter';
import { compareVersions } from './semver';
import { InstallState, SkillDescriptor } from './types';

/**
 * What a probe of `<skillsDir>/<skillId>/SKILL.md` found. `present` without
 * `skillMd` means the file is there but was not read — too large, or
 * unreadable — which is exactly the `unknown` case.
 */
export type InstalledSkill =
  | { present: false }
  | { present: true; skillMd?: string };

/**
 * State of an installed copy against the bundled skill. A copy newer than the
 * bundle (a user on a fresher marketplace install) counts as installed — there
 * is nothing for this extension to offer it. A SKILL.md whose frontmatter
 * `name` isn't this skill's id is someone else's skill that happens to sit in
 * the same folder: `unknown`, whatever version it claims.
 */
export function computeInstallState(
  bundled: Pick<SkillDescriptor, 'id' | 'version'>,
  installed: InstalledSkill,
): InstallState {
  if (!installed.present) {
    return 'not-installed';
  }
  if (installed.skillMd === undefined) {
    return 'unknown';
  }
  const frontmatter = parseFrontmatter(installed.skillMd);
  if (frontmatter?.name !== bundled.id) {
    return 'unknown';
  }
  const installedVersion = frontmatterVersion(frontmatter);
  if (installedVersion === undefined) {
    return 'unknown';
  }
  const cmp = compareVersions(installedVersion, bundled.version);
  if (cmp === undefined) {
    return 'unknown';
  }
  return cmp < 0 ? 'update-available' : 'installed';
}

/** Installed in any sense — something is there to update or remove. */
export function isPresent(state: InstallState): boolean {
  return state !== 'not-installed';
}
