// Which images in `.lavagna/media/` no board uses any more. Pure — no vscode.
//
// A canvas links its image as `![alt](media/<name>)`, but a board can also
// mention one inline, in an HTML `<img>`, percent-encoded, or through another
// relative path, or with markdown escapes (`my\_pic.png`). So the boards are
// not parsed as markdown: an image counts as used when its file name appears
// anywhere in any board, compared without case and in one Unicode form (macOS
// can store `é` decomposed while the board holds it composed). That errs
// towards keeping — a name quoted in prose keeps its file — which is the side
// a delete should err on.

/** What the cleanup may consider: images, never dotfiles like `.gitkeep`. */
const CLEANABLE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/** Characters that cannot be part of a link target's last segment. */
const SEPARATORS = /[\s/\\()[\]<>"'`|?#=,;]+/;

/** Runs of `%XX`, decoded as UTF-8 where they form valid text. */
const PERCENT_RUNS = /(?:%[0-9a-f]{2})+/gi;

/** A markdown backslash escape: `\` before ASCII punctuation. */
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/g;

export function isCleanableMediaName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.startsWith('.') &&
    !/[/\\\0]/.test(name) &&
    CLEANABLE.test(name)
  );
}

/** One spelling for comparing: composed Unicode, lower case. */
const fold = (text: string): string => text.normalize('NFC').toLowerCase();

function percentDecode(text: string): string {
  return text.replace(PERCENT_RUNS, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * The names in `mediaNames` that none of `boardTexts` mentions, sorted. One
 * pass over the boards collects every word that could end a link target; a
 * name is looked up in that set. Only a name that itself contains a separator
 * (a space, a parenthesis) can't be a single word, and is searched for in the
 * full text instead.
 */
export function findUnusedMedia(mediaNames: readonly string[], boardTexts: readonly string[]): string[] {
  const words = new Set<string>();
  const texts: string[] = [];
  for (const raw of boardTexts) {
    const unescaped = raw.replace(MARKDOWN_ESCAPE, '$1');
    const spellings = new Set([raw, unescaped, percentDecode(raw), percentDecode(unescaped)].map(fold));
    for (const text of spellings) {
      texts.push(text);
      for (const word of text.split(SEPARATORS)) {
        if (word) {
          words.add(word);
        }
      }
    }
  }
  const isUsed = (name: string): boolean => {
    const folded = fold(name);
    return SEPARATORS.test(folded) ? texts.some((t) => t.includes(folded)) : words.has(folded);
  };
  return mediaNames.filter((name) => !isUsed(name)).sort((a, b) => a.localeCompare(b));
}
