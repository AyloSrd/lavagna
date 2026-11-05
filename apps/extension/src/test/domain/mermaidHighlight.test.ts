import * as assert from 'assert';
import { suite, test } from 'vitest';
import { changedLines, highlightLine, Token } from '../../webview/format/mermaidHighlight';

const kinds = (tokens: Token[]) => tokens.filter((t) => t.kind !== 'plain').map((t) => `${t.kind}:${t.text}`);
const joined = (tokens: Token[]) => tokens.map((t) => t.text).join('');

suite('highlightLine', () => {
  test('colours flowchart keywords, arrows and quoted labels', () => {
    assert.deepStrictEqual(kinds(highlightLine('flowchart TD')), ['keyword:flowchart', 'keyword:TD']);
    assert.deepStrictEqual(
      kinds(highlightLine('  n3 -->|"yes"| n4')),
      ['arrow:-->', 'string:|"yes"|'],
    );
    assert.deepStrictEqual(kinds(highlightLine('  n1(["Start"])')), ['string:"Start"']);
  });

  test('reads the longest arrow first', () => {
    for (const op of ['-->>', '->>', '--)', '-)', '--x', '-x', '-.->', '-.-', '==>', '===', '---']) {
      assert.deepStrictEqual(kinds(highlightLine(`A${op}B: hi`)), [`arrow:${op}`], op);
    }
  });

  test('colours sequence keywords and comments', () => {
    assert.deepStrictEqual(
      kinds(highlightLine('  Note right of A: careful')),
      ['keyword:Note', 'keyword:right', 'keyword:of'],
    );
    assert.deepStrictEqual(kinds(highlightLine('%% a comment --> here')), ['comment:%% a comment --> here']);
  });

  test('always reproduces the input exactly', () => {
    for (const line of ['', '   ', 'A["unterminated', 'x |half', 'é ü --> ✓', '\t%%']) {
      assert.strictEqual(joined(highlightLine(line)), line);
    }
  });
});

suite('changedLines', () => {
  test('reports edited and added lines, by index', () => {
    assert.deepStrictEqual(changedLines('a\nb\nc', 'a\nB\nc\nd'), [1, 3]);
    assert.deepStrictEqual(changedLines('same', 'same'), []);
  });
});
