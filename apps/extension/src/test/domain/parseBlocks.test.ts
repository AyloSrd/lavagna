import * as assert from 'assert';
import { suite, test } from 'vitest';
import { imageTarget, parseBlocks } from '../../domain/blocks/parseBlocks';

suite('parseBlocks', () => {
  test('parses a mermaid fence with content and line ranges', () => {
    const text = ['# Title', '', '```mermaid', 'flowchart TD', '  a --> b', '```', 'after'].join('\n');
    const blocks = parseBlocks(text);
    assert.strictEqual(blocks.length, 1);
    const b = blocks[0];
    assert.strictEqual(b.kind, 'mermaid');
    assert.strictEqual(b.language, 'mermaid');
    assert.strictEqual(b.startLine, 2);
    assert.strictEqual(b.endLine, 5);
    assert.strictEqual(b.contentStartLine, 3);
    assert.strictEqual(b.contentEndLine, 4);
    assert.strictEqual(b.content, 'flowchart TD\n  a --> b');
    assert.strictEqual(b.closed, true);
  });

  test('maps tree fences to their kind, others (including canvas) to code', () => {
    const text = ['```tree', 'root', '```', '```canvas', '{}', '```', '```typescript', 'x', '```'].join('\n');
    const kinds = parseBlocks(text).map((b) => b.kind);
    assert.deepStrictEqual(kinds, ['tree', 'code', 'code']);
  });

  test('bare fence has null language and kind code', () => {
    const blocks = parseBlocks('```\nplain\n```');
    assert.strictEqual(blocks[0].language, null);
    assert.strictEqual(blocks[0].kind, 'code');
  });

  test('empty fence body: contentEndLine < contentStartLine, empty content', () => {
    const blocks = parseBlocks('```tree\n```');
    const b = blocks[0];
    assert.strictEqual(b.content, '');
    assert.strictEqual(b.contentStartLine, 1);
    assert.strictEqual(b.contentEndLine, 0);
    assert.strictEqual(b.closed, true);
  });

  test('detects standalone local-image lines as image blocks', () => {
    const text = ['before', '![canvas](media/x.png)', 'after ![inline](y.png) text'].join('\n');
    const blocks = parseBlocks(text);
    assert.strictEqual(blocks.length, 1);
    const b = blocks[0];
    assert.strictEqual(b.kind, 'image');
    assert.strictEqual(b.startLine, 1);
    assert.strictEqual(b.endLine, 1);
    assert.strictEqual(b.content, '![canvas](media/x.png)');
  });

  test('image lines with titles parse; remote and data images are skipped', () => {
    assert.strictEqual(parseBlocks('![a](media/x.png "title")')[0]?.kind, 'image');
    assert.strictEqual(parseBlocks('![a](https://example.com/x.png)').length, 0);
    assert.strictEqual(parseBlocks('![a](data:image/png;base64,AAAA)').length, 0);
  });

  test('image lines inside fences are not image blocks', () => {
    const blocks = parseBlocks('```\n![a](media/x.png)\n```');
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].kind, 'code');
  });

  test('imageTarget extracts the target from a standalone image line', () => {
    assert.strictEqual(imageTarget('![canvas](media/x.png)'), 'media/x.png');
    assert.strictEqual(imageTarget('![a](media/x.png "t")'), 'media/x.png');
    assert.strictEqual(imageTarget('text ![a](x.png)'), null);
  });

  test('an image line with an empty target is an image block (canvas with no image yet)', () => {
    const blocks = parseBlocks('intro\n![canvas]()\noutro');
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].kind, 'image');
    assert.strictEqual(blocks[0].startLine, 1);
    assert.strictEqual(blocks[0].content, '![canvas]()');
    // '' distinguishes "no target yet" from "not an image line" (null).
    assert.strictEqual(imageTarget('![canvas]()'), '');
    assert.strictEqual(imageTarget('![]()'), '');
    assert.strictEqual(imageTarget('![a]( )'), '');
  });

  test('backtick fence inside a tilde fence does not close it', () => {
    const text = ['~~~', '```mermaid', 'flowchart TD', '```', '~~~'].join('\n');
    const blocks = parseBlocks(text);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].kind, 'code');
    assert.strictEqual(blocks[0].endLine, 4);
    assert.strictEqual(blocks[0].content, '```mermaid\nflowchart TD\n```');
  });

  test('closing fence must be at least as long as the opening', () => {
    const text = ['````tree', 'a', '```', 'b', '````'].join('\n');
    const b = parseBlocks(text)[0];
    assert.strictEqual(b.endLine, 4);
    assert.strictEqual(b.content, 'a\n```\nb');
  });

  test('longer closing fence still closes a shorter opening', () => {
    const b = parseBlocks('```tree\na\n````')[0];
    assert.strictEqual(b.closed, true);
    assert.strictEqual(b.content, 'a');
  });

  test('fences indented up to 3 spaces are recognized; 4 spaces are not', () => {
    const three = parseBlocks('   ```tree\na\n   ```');
    assert.strictEqual(three.length, 1);
    assert.strictEqual(three[0].kind, 'tree');
    const four = parseBlocks('    ```tree\na\n    ```');
    assert.strictEqual(four.length, 0);
  });

  test('unclosed fence runs to EOF with closed=false', () => {
    const text = ['before', '```mermaid', 'flowchart TD', '  a --> b'].join('\n');
    const b = parseBlocks(text)[0];
    assert.strictEqual(b.closed, false);
    assert.strictEqual(b.endLine, 3);
    assert.strictEqual(b.contentEndLine, 3);
    assert.strictEqual(b.content, 'flowchart TD\n  a --> b');
  });

  test('nothing is detected after an unclosed fence', () => {
    const text = ['```tree', 'a', '', '```mermaid', 'flowchart TD'].join('\n');
    const blocks = parseBlocks(text);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].kind, 'tree');
  });

  test('backtick fence info string containing a backtick is not a fence', () => {
    const blocks = parseBlocks('``` `foo\nx\n```');
    // The first line is rejected; the trailing ``` opens an unclosed bare fence.
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].startLine, 2);
    assert.strictEqual(blocks[0].closed, false);
  });

  test('detects a GFM pipe table with full range', () => {
    const text = ['intro', '| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |', '', 'outro'].join('\n');
    const blocks = parseBlocks(text);
    assert.strictEqual(blocks.length, 1);
    const t = blocks[0];
    assert.strictEqual(t.kind, 'table');
    assert.strictEqual(t.startLine, 1);
    assert.strictEqual(t.endLine, 4);
    assert.strictEqual(t.content, '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
  });

  test('a thematic break (---) is not a table delimiter', () => {
    const blocks = parseBlocks('title\n---\ntext');
    assert.strictEqual(blocks.length, 0);
  });

  test('table rows inside a fence are not detected as a table', () => {
    const text = ['```', '| a | b |', '|---|---|', '```'].join('\n');
    const blocks = parseBlocks(text);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].kind, 'code');
  });

  test('table directly followed by a fence keeps both ranges', () => {
    const text = ['| a |', '|---|', '| 1 |', '```tree', 'x', '```'].join('\n');
    const blocks = parseBlocks(text);
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].kind, 'table');
    assert.strictEqual(blocks[0].endLine, 2);
    assert.strictEqual(blocks[1].kind, 'tree');
    assert.strictEqual(blocks[1].startLine, 3);
  });

  test('indexOfKind counts per kind in document order', () => {
    const text = [
      '```tree', 'a', '```',
      '```mermaid', 'flowchart TD', '```',
      '```tree', 'b', '```',
    ].join('\n');
    const blocks = parseBlocks(text);
    assert.deepStrictEqual(
      blocks.map((b) => [b.kind, b.indexOfKind]),
      [['tree', 0], ['mermaid', 0], ['tree', 1]],
    );
  });

  test('handles CRLF line endings', () => {
    const text = '```tree\r\nroot\r\n  child\r\n```\r\n';
    const b = parseBlocks(text)[0];
    assert.strictEqual(b.kind, 'tree');
    assert.strictEqual(b.content, 'root\n  child');
    assert.strictEqual(b.closed, true);
  });
});
