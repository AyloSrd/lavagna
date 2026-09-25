// Agent skills the extension ships and can install for the user's coding
// agents. Pure types — file I/O lives behind the ports in application/.

/** One entry of the bundled `skills/manifest.json`, plus the version read from its SKILL.md. */
export interface SkillDescriptor {
  id: string;
  /** Folder of the skill inside the bundle, relative to `skills/`. */
  path: string;
  title: string;
  summary: string;
  /** The skill Lavagna itself relies on — the one the first-board prompt offers. */
  core: boolean;
  /** `metadata.version` of the bundled SKILL.md. */
  version: string;
}

export type AgentTargetId = 'claude-code' | 'cursor' | 'codex' | 'copilot' | 'gemini' | 'agents';

/** A coding agent that reads skills from a well-known directory. */
export interface AgentTarget {
  id: AgentTargetId;
  label: string;
  /** Skills directory relative to the workspace folder. */
  projectDir: string;
  /** Skills directory relative to the user's home. */
  globalDir: string;
}

export type InstallScope = 'global' | 'project';

export const INSTALL_SCOPES: readonly InstallScope[] = ['global', 'project'];

/**
 * State of one skill for one target in one scope.
 * - `installed`: the installed SKILL.md carries the bundled version (or newer)
 * - `update-available`: it carries an older version
 * - `unknown`: a SKILL.md is there but its version can't be read
 */
export type InstallState = 'not-installed' | 'installed' | 'update-available' | 'unknown';

/**
 * A file of a skill folder: '/'-separated path relative to the folder, plus its
 * bytes. Every segment of `path` must be a plain name — the writer rejects
 * anything else rather than trusting the catalogue that produced it.
 */
export interface SkillFile {
  path: string;
  bytes: Uint8Array;
}

/**
 * Where installs go. Both are optional: a host can report no home directory,
 * and project scope needs a local folder to be open.
 */
export interface InstallRoots {
  /** Absolute home directory; undefined disables the global scope. */
  home?: string;
  /** Absolute path of the local workspace folder; undefined disables the project scope. */
  workspaceRoot?: string;
}
