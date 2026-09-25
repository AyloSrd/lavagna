// Tiny fuzzy path matcher. Pure — no vscode. Used to filter the file-reference
// picker ourselves and hand VS Code's QuickPick only the top few matches, so
// its native filter never has to score the whole workspace on every keystroke.
//
// Subsequence match, case-insensitive, with bonuses for consecutive characters
// and for matches at path/word boundaries — so a query tends to land on the
// basename. Not as clever as a dedicated library (fzf, uFuzzy); the real win is
// the result cap, and this keeps the dependency count at zero. Swappable if a
// pathological repo ever needs more.

function scorePath(query: string, hay: string): number | null {
  let qi = 0;
  let score = 0;
  let prevMatch = -2;
  for (let i = 0; i < hay.length && qi < query.length; i++) {
    if (hay[i] !== query[qi]) {
      continue;
    }
    let bonus = 1;
    if (i === prevMatch + 1) {
      bonus += 3; // consecutive run
    }
    const before = i === 0 ? '/' : hay[i - 1];
    if (before === '/' || before === '.' || before === '-' || before === '_') {
      bonus += 6; // start of a path/word segment (favours basename hits)
    }
    score += bonus;
    prevMatch = i;
    qi++;
  }
  if (qi < query.length) {
    return null; // not a subsequence — no match
  }
  return score - hay.length * 0.01; // gentle tie-break toward shorter paths
}

/**
 * Best-first, capped. An empty query returns the first `limit` paths unchanged
 * (already sorted by the caller). Matching and ranking are case-insensitive.
 */
export function fuzzyFilter(paths: readonly string[], query: string, limit: number): string[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return paths.slice(0, limit);
  }
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const s = scorePath(q, path.toLowerCase());
    if (s !== null) {
      scored.push({ path, score: s });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return scored.slice(0, limit).map((x) => x.path);
}

/**
 * Split the picker's rows into the pinned block and the ranked remainder.
 *
 * Pinned rows are the ones already chosen, in the order they were chosen; they
 * stay on screen regardless of the query, which is what lets a selection
 * survive a new search. They're removed from the ranked half so nothing appears
 * twice — a duplicate row would be two checkboxes for one file.
 */
export function partitionPicks(
  paths: readonly string[],
  query: string,
  picked: ReadonlySet<string>,
  limit: number,
): { pinned: string[]; rest: string[] } {
  // Exclude the picks *before* ranking, not after: capping first and filtering
  // second lets high-ranking picks eat into the cap, so picking the top few
  // matches can leave the ranked half short — or empty — with matches unshown.
  return {
    pinned: [...picked],
    rest: fuzzyFilter(
      picked.size ? paths.filter((p) => !picked.has(p)) : paths,
      query,
      limit,
    ),
  };
}
