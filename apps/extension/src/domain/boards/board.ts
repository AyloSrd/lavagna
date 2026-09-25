// Board naming and template logic. Pure — file I/O lives behind BoardRepositoryPort.

export interface Board {
  /** Display name, derived from the file name. */
  name: string;
  slug: string;
  fsPath: string;
  modifiedAt?: number;
}

export const BOARD_SUFFIX = '.lavagna.md';

/** Kebab-case slug; diacritics stripped. Falls back to 'board' when nothing survives. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'board';
}

export function boardFileName(slug: string): string {
  return `${slug}${BOARD_SUFFIX}`;
}

export function isBoardFileName(fileName: string): boolean {
  return fileName.endsWith(BOARD_SUFFIX) && fileName.length > BOARD_SUFFIX.length;
}

/** "my-board.lavagna.md" → "My Board". */
export function boardNameFromFileName(fileName: string): string {
  const slug = fileName.endsWith(BOARD_SUFFIX)
    ? fileName.slice(0, -BOARD_SUFFIX.length)
    : fileName;
  return slug
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

/** Returns `slug`, or `slug-2`, `slug-3`, … until it no longer collides. */
export function uniqueSlug(slug: string, existingSlugs: string[]): string {
  if (!existingSlugs.includes(slug)) {
    return slug;
  }
  for (let n = 2; ; n++) {
    const candidate = `${slug}-${n}`;
    if (!existingSlugs.includes(candidate)) {
      return candidate;
    }
  }
}

export function boardTemplate(name: string): string {
  return `# ${name}\n\n`;
}
