import { SkillDescriptor, SkillFile } from '../../domain/skills/types';

/** The skills the extension carries in its own bundle (`<extension>/skills/`). */
export interface SkillCatalogPort {
  /** Manifest entries with their bundled versions. Throws when the manifest can't be read. */
  listSkills(): Promise<SkillDescriptor[]>;
  /** Every file of the skill's folder — SKILL.md plus any `references/` etc. */
  readSkillFiles(skill: SkillDescriptor): Promise<SkillFile[]>;
}
