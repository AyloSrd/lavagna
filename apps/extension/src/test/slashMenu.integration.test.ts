import * as assert from 'assert';
import * as vscode from 'vscode';
import { SlashMenuProvider } from '../presentation/providers/SlashMenuProvider';
import { BLOCK_SNIPPETS } from '../presentation/blockSnippets';

const provider = new SlashMenuProvider();

/** Open an in-memory markdown doc and ask for completions at `|` (removed). */
async function completeAt(text: string) {
  const offset = text.indexOf('|');
  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: text.replace('|', ''),
  });
  // The provider needs only the document and position; the token and context
  // are unused, so they are omitted rather than faked.
  const items = provider.provideCompletionItems(doc, doc.positionAt(offset));
  return items as vscode.CompletionItem[] | undefined;
}

suite('SlashMenuProvider', () => {
  test('offers every block when / starts the line', async () => {
    const items = await completeAt('/|');
    assert.ok(items, 'no menu offered');
    assert.strictEqual(items.length, BLOCK_SNIPPETS.length);
  });

  test('offers the menu on an indented line too', async () => {
    assert.ok(await completeAt('   /|'));
  });

  test('opens mid-line when the / starts a word (after whitespace)', async () => {
    assert.ok(await completeAt('some text /|'), 'after a space');
    assert.ok(await completeAt('a\tb /|'), 'after a tab');
    assert.ok(await completeAt('text /flo|'), 'with filter text typed');
  });

  test('stays closed when the / follows a non-space — paths, URLs, dates', async () => {
    assert.strictEqual(await completeAt('see src/|'), undefined);
    assert.strictEqual(await completeAt('https://|'), undefined);
    assert.strictEqual(await completeAt('on 12/|'), undefined);
    assert.strictEqual(await completeAt('a and/|'), undefined);
  });

  test('stays closed inside a fenced block', async () => {
    assert.strictEqual(await completeAt('```tree\n/|\n```'), undefined);
    assert.strictEqual(await completeAt('```mermaid\nflowchart TD\n/|\n```'), undefined);
  });

  test('still opens after a fence has closed', async () => {
    assert.ok(await completeAt('```tree\nroot\n```\n/|'));
  });

  test('the replaced range swallows the slash and any filter text', async () => {
    const items = (await completeAt('/flo|'))!;
    const range = items[0].range as vscode.Range;
    assert.strictEqual(range.start.character, 0);
    assert.strictEqual(range.end.character, 4); // '/flo'
  });

  test('mid-line, the range covers only the slash onward — not the space before it', async () => {
    const items = (await completeAt('hello /flo|'))!;
    const range = items[0].range as vscode.Range;
    assert.strictEqual(range.start.character, 6, 'starts at the slash, not the space');
    assert.strictEqual(range.end.character, 10);
  });

  test('filter text carries the slash so typing /flo matches', async () => {
    const items = (await completeAt('/|'))!;
    assert.ok(items.every((i) => i.filterText?.startsWith('/')));
    assert.ok(items.some((i) => i.filterText === '/Flowchart'));
  });

  test('authored order is preserved', async () => {
    const items = (await completeAt('/|'))!;
    const sorted = [...items].sort((a, b) => String(a.sortText).localeCompare(String(b.sortText)));
    assert.deepStrictEqual(
      sorted.map((i) => i.filterText),
      BLOCK_SNIPPETS.map((s) => `/${s.label}`),
    );
  });

  test('bodied entries insert a snippet; File Reference runs its picker', async () => {
    const items = (await completeAt('/|'))!;
    const flow = items.find((i) => i.filterText === '/Flowchart')!;
    assert.ok(flow.insertText instanceof vscode.SnippetString);
    const ref = items.find((i) => i.filterText === '/File Reference')!;
    assert.strictEqual(ref.insertText, '');
    assert.strictEqual(ref.command?.command, 'lavagna.insertFileRef');
  });
});

suite('block menus stay in step with BLOCK_SNIPPETS', () => {
  // The slash menu derives from the list, but the context submenu and the
  // palette are declared in package.json — so only a test keeps them together.
  const pkg = require('../../package.json');
  const commandIds: string[] = pkg.contributes.commands.map((c: { command: string }) => c.command);
  const submenu: { command: string; group: string }[] = pkg.contributes.menus['lavagna.insertSubmenu'];

  test('every snippet is reachable from the right-click submenu', () => {
    const expected = BLOCK_SNIPPETS.map((s) => s.command ?? `lavagna.insertBlock.${s.key}`);
    assert.deepStrictEqual(submenu.map((m) => m.command), expected);
  });

  test('the submenu is ordered like the slash menu', () => {
    const ordinals = submenu.map((m) => Number(m.group.split('@')[1]));
    assert.deepStrictEqual(ordinals, submenu.map((_, i) => i + 1));
  });

  test('every bodied snippet has a declared command', () => {
    for (const snippet of BLOCK_SNIPPETS.filter((s) => s.body)) {
      assert.ok(
        commandIds.includes(`lavagna.insertBlock.${snippet.key}`),
        `lavagna.insertBlock.${snippet.key} is missing from contributes.commands`,
      );
    }
  });

  test('the spiral inserts U+AA5C and nothing else', () => {
    const spiral = BLOCK_SNIPPETS.find((s) => s.key === 'spiral');
    assert.ok(spiral, 'spiral snippet missing');
    assert.strictEqual(spiral.body, '꩜ $0');
  });
});

suite('menu `when` clauses are valid regexes', () => {
  // A doubled backslash survives JSON, tsc, eslint, the build and packaging, and
  // then silently matches nothing — Insert Sequence Diagram was missing from the
  // palette that way. Cheap to assert, invisible otherwise.
  const pkg = require('../../package.json');

  const clauses: { where: string; command: string; when: string }[] = [];
  for (const [menu, items] of Object.entries(pkg.contributes.menus)) {
    for (const item of items as { command?: string; when?: string }[]) {
      if (item.when?.includes('resourceFilename')) {
        clauses.push({ where: menu, command: item.command ?? '?', when: item.when });
      }
    }
  }

  test('every resourceFilename clause matches a board and rejects a plain .md', () => {
    assert.ok(clauses.length > 0, 'no resourceFilename clauses found — did the shape change?');
    for (const { where, command, when } of clauses) {
      const source = /\/(.+)\/$/.exec(when.split('=~')[1].trim())?.[1];
      assert.ok(source, `${where}/${command}: no regex literal in ${when}`);
      const re = new RegExp(source);
      assert.ok(re.test('notes.lavagna.md'), `${where}/${command}: does not match a board (${when})`);
      assert.ok(!re.test('README.md'), `${where}/${command}: also matches a plain .md (${when})`);
    }
  });
});
