import * as vscode from 'vscode';
import { SkillCatalogPort } from '../../application/ports/SkillCatalogPort';
import { frontmatterVersion, parseFrontmatter } from '../../domain/skills/frontmatter';
import { parseManifest } from '../../domain/skills/manifest';
import { parseSemver } from '../../domain/skills/semver';
import { SkillDescriptor, SkillFile } from '../../domain/skills/types';
import { log } from '../logging/log';

const SKILLS_DIR = 'skills';
const MANIFEST = 'manifest.json';
const SKILL_MD = 'SKILL.md';

/**
 * Reads the skills copied into the extension bundle at build time
 * (`<extension>/skills/manifest.json` + one folder per skill). Read-only.
 */
export class BundledSkillCatalog implements SkillCatalogPort {
  constructor(private readonly _extensionUri: vscode.Uri) {}

  private get _root(): vscode.Uri {
    return vscode.Uri.joinPath(this._extensionUri, SKILLS_DIR);
  }

  async listSkills(): Promise<SkillDescriptor[]> {
    const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this._root, MANIFEST));
    const entries = parseManifest(JSON.parse(new TextDecoder().decode(raw)));
    return Promise.all(
      entries.map(async (entry) => {
        const skillMd = await vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(this._root, entry.path, SKILL_MD),
        );
        return { ...entry, version: BundledSkillCatalog._version(entry.id, new TextDecoder().decode(skillMd)) };
      }),
    );
  }

  async readSkillFiles(skill: SkillDescriptor): Promise<SkillFile[]> {
    const files: SkillFile[] = [];
    await this._collect(vscode.Uri.joinPath(this._root, skill.path), '', files);
    return files;
  }

  /**
   * Both degraded cases are silent in the UI, so they are loud in the log: a
   * bundled skill without a version reads as 0.0.0 (every installed copy then
   * counts as up to date and Update becomes a permanent no-op), and one with a
   * version that isn't semver makes every row read "installed, version
   * unreadable" and every Install rewrite the folder.
   */
  private static _version(id: string, skillMd: string): string {
    const version = frontmatterVersion(parseFrontmatter(skillMd));
    if (version === undefined) {
      log(`skills: bundled "${id}" has no metadata.version — it reads as 0.0.0 and can never offer an update`);
      return '0.0.0';
    }
    if (parseSemver(version) === undefined) {
      log(`skills: bundled "${id}" has a non-semver version "${version}" — every installed copy reads as unknown`);
    }
    return version;
  }

  private async _collect(dir: vscode.Uri, prefix: string, out: SkillFile[]): Promise<void> {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(dir)) {
      const uri = vscode.Uri.joinPath(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (type === vscode.FileType.Directory) {
        await this._collect(uri, rel, out);
      } else if (type === vscode.FileType.File) {
        out.push({ path: rel, bytes: await vscode.workspace.fs.readFile(uri) });
      }
    }
  }
}
