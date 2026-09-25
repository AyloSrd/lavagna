import * as assert from 'assert';
import { suite, test } from 'vitest';
import { parseTable, serializeTable } from '../../webview/format/tableFormat';

suite('tableFormat', () => {
  test('parses a simple table with header, alignment, and rows', () => {
    const data = parseTable('| Name | Age |\n| :--- | ---: |\n| Ada | 36 |\n| Alan | 41 |');
    assert.ok(data);
    assert.deepStrictEqual(data.header, ['Name', 'Age']);
    assert.deepStrictEqual(data.align, ['left', 'right']);
    assert.deepStrictEqual(data.rows, [['Ada', '36'], ['Alan', '41']]);
  });

  test('serialize → parse round-trips including alignment', () => {
    const data = {
      header: ['A', 'B', 'C'],
      align: ['center', null, 'right'] as const,
      rows: [['1', '2', '3']],
    };
    const text = serializeTable({ ...data, align: [...data.align] });
    assert.strictEqual(text, '| A | B | C |\n| :---: | --- | ---: |\n| 1 | 2 | 3 |');
    const back = parseTable(text);
    assert.ok(back);
    assert.deepStrictEqual(back.align, ['center', null, 'right']);
    assert.deepStrictEqual(back.rows, data.rows);
  });

  test('escaped pipes inside cells survive the round trip', () => {
    const text = serializeTable({ header: ['cmd'], align: [null], rows: [['a | b']] });
    assert.ok(text.includes('a \\| b'));
    const back = parseTable(text);
    assert.ok(back);
    assert.deepStrictEqual(back.rows, [['a | b']]);
  });

  test('ragged rows are normalized to the header width', () => {
    const data = parseTable('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |');
    assert.ok(data);
    assert.deepStrictEqual(data.rows, [['1', ''], ['1', '2']]);
  });

  test('tables without outer pipes parse too', () => {
    const data = parseTable('a | b\n--- | ---\n1 | 2');
    assert.ok(data);
    assert.deepStrictEqual(data.header, ['a', 'b']);
    assert.deepStrictEqual(data.rows, [['1', '2']]);
  });

  test('rejects non-tables', () => {
    assert.strictEqual(parseTable('just text'), null);
    assert.strictEqual(parseTable('| a |\n| not delimiter |'), null);
    assert.strictEqual(parseTable(''), null);
  });
});
