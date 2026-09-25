import { InstalledSkill } from '../../domain/skills/installState';
import { InstallRoots, SkillFile } from '../../domain/skills/types';

/**
 * What already sits where a skill would be installed. `absent` means nothing
 * exists at the path — not "we couldn't look": a failed probe is `unreadable`.
 * `unsafe-path` means the path itself is not one the adapter will write to: a
 * symlinked component on the way, or a real location outside the root.
 */
export type EntryKind = 'absent' | 'directory' | 'file' | 'symlink' | 'unsafe-path' | 'unreadable';

/**
 * The directories skills are installed into — under the user's home for the
 * global scope, under the workspace folder for the project scope. Every write
 * here happens only as the result of an explicit user action.
 *
 * Verbs only, plus `roots()`: the use cases ask the adapter where it can
 * write, and the domain turns that into paths. Nothing above the application
 * layer does path arithmetic.
 */
export interface SkillFilesPort {
  /** Home directory and, when a local folder is open, the workspace root. */
  roots(): InstallRoots;
  /**
   * The same port with project scope resolved against `root` instead — a
   * multi-root workspace asks the user which folder before installing.
   */
  withProjectRoot(root: string | undefined): SkillFilesPort;
  /** What is at `skillDir` today. A symlink is never installed over, nor written through. */
  entryKind(skillDir: string): Promise<EntryKind>;
  /** Whether `<skillDir>/SKILL.md` exists and, when it is small enough to read, its text. */
  readSkillMd(skillDir: string): Promise<InstalledSkill>;
  /**
   * Replaces `dir` with exactly `files` (a stale file from an older version
   * never lingers). Rejects any file path that isn't a plain relative path,
   * and any `dir` outside the roots — on disk, symlinks resolved.
   */
  writeTree(dir: string, files: readonly SkillFile[]): Promise<void>;
  /**
   * Removes `dir` and everything under it; a missing dir is not an error.
   * Refuses a `dir` outside the roots exactly as `writeTree` does.
   */
  deleteTree(dir: string): Promise<void>;
}
