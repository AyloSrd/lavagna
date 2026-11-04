import * as assert from 'assert';
import { suite, test } from 'vitest';
import { SequenceData, parseSequence, toSequence } from '../../webview/format/sequence';
import * as edit from '../../webview/editors/sequence/edits';

const seq = (src: string): SequenceData => parseSequence(`sequenceDiagram\n${src}`)!;
const body = (d: SequenceData) => toSequence(d).split('\n').slice(1).map((l) => l.trim());

const BASE = seq([
  'participant A as Alice',
  'participant B as Bob',
  'A->>B: hi',
  'Note over A,B: both',
  'activate B',
  'B-->>A: yo',
  'deactivate B',
].join('\n'));

suite('sequence edits — steps', () => {
  test('moveStep swaps with the neighbour and reports the new index', () => {
    const r = edit.moveStep(BASE, 0, 1)!;
    assert.strictEqual(r.index, 1);
    assert.strictEqual(r.data.steps[0].type, 'note');
    assert.strictEqual(edit.moveStep(BASE, 0, -1), null);
    assert.strictEqual(edit.moveStep(BASE, BASE.steps.length - 1, 1), null);
  });

  test('moveStep passes over activation markers to the next visible row', () => {
    // [hi, note, activate B, yo, deactivate B]
    const r = edit.moveStep(BASE, 3, -1)!;
    assert.strictEqual(r.index, 1);
    assert.deepStrictEqual(body(r.data).slice(2), ['A->>B: hi', 'B-->>A: yo', 'Note over A,B: both', 'activate B', 'deactivate B']);
    assert.strictEqual(edit.moveStep(BASE, 3, 1), null);
  });

  test('moveStepTo drops a step at a boundary and ignores no-op moves', () => {
    const r = edit.moveStepTo(BASE, 0, BASE.steps.length)!;
    assert.strictEqual(r.index, BASE.steps.length - 1);
    assert.strictEqual(r.data.steps[r.index].type, 'message');
    assert.strictEqual(edit.moveStepTo(BASE, 1, 1), null);
    assert.strictEqual(edit.moveStepTo(BASE, 1, 2), null);
  });

  test('deleting a frame keeps the steps inside it, and its dividers and end go with it', () => {
    const d = seq('A->>B: one\nalt ok\nA->>B: two\nelse no\nloop again\nB->>A: three\nend\nend\nA->>B: four');
    const out = body(edit.deleteStep(d, 1));
    assert.deepStrictEqual(out, ['participant A', 'participant B', 'A->>B: one', 'A->>B: two', 'loop again', 'B->>A: three', 'end', 'A->>B: four']);
  });

  test('deleting a divider removes only that divider', () => {
    const d = seq('alt ok\nA->>B: x\nelse no\nA->>B: y\nend');
    assert.deepStrictEqual(body(edit.deleteStep(d, 2)).slice(2), ['alt ok', 'A->>B: x', 'A->>B: y', 'end']);
  });

  test('insertTemplate writes valid mermaid for every kind, at the boundary', () => {
    for (const kind of ['message', 'note', 'loop', 'alt', 'opt'] as const) {
      const r = edit.insertTemplate(BASE, 1, kind);
      assert.strictEqual(r.index, 1);
      assert.ok(parseSequence(toSequence(r.data)), kind);
    }
    const alt = edit.insertTemplate(BASE, 0, 'alt').data.steps.slice(0, 3).map((s) => s.type === 'block' ? s.keyword : s.type);
    assert.deepStrictEqual(alt, ['alt', 'else', 'end']);
  });

  test('insertTemplate on an empty diagram adds two participants first', () => {
    const r = edit.insertTemplate({ autonumber: false, participants: [], steps: [] }, 0, 'message');
    assert.deepStrictEqual(r.data.participants.map((p) => p.id), ['A', 'B']);
    assert.deepStrictEqual(body(r.data).slice(-1), ['A->>B: message']);
  });

  test('edits never mutate the input', () => {
    const before = JSON.stringify(BASE);
    edit.deleteStep(BASE, 0);
    edit.moveStep(BASE, 0, 1);
    edit.renameId(BASE, 'A', 'Z');
    edit.removeParticipant(BASE, 'B');
    edit.insertTemplate(BASE, 0, 'alt');
    assert.strictEqual(JSON.stringify(BASE), before);
  });
});

suite('sequence edits — participants', () => {
  test('renameId follows every reference', () => {
    const out = body(edit.renameId(BASE, 'B', 'Bob2'));
    assert.deepStrictEqual(out, [
      'participant A as Alice', 'participant Bob2 as Bob', 'A->>Bob2: hi', 'Note over A,Bob2: both',
      'activate Bob2', 'Bob2-->>A: yo', 'deactivate Bob2',
    ]);
  });

  test('removeParticipant drops the steps that use it; countRefs says how many', () => {
    assert.strictEqual(edit.countRefs(BASE, 'B'), 5);
    assert.deepStrictEqual(body(edit.removeParticipant(BASE, 'B')), ['participant A as Alice']);
  });

  test('checkId strips invalid characters and refuses duplicates or nothing', () => {
    assert.deepStrictEqual(edit.checkId(BASE, ' Al-ice! ', 'A'), { id: 'Alice' });
    assert.deepStrictEqual(edit.checkId(BASE, 'A', 'A'), { id: 'A' });
    assert.ok('error' in edit.checkId(BASE, 'B', 'A'));
    assert.ok('error' in edit.checkId(BASE, '---', 'A'));
  });

  test('ids from labels are cleaned, short and unique', () => {
    assert.strictEqual(edit.idFromLabel(BASE, 'Claude Code (agent)'), 'ClaudeCode');
    assert.strictEqual(edit.idFromLabel(BASE, '¿?'), 'P');
    assert.strictEqual(edit.idFromLabel(BASE, 'A'), 'A2');
    assert.strictEqual(edit.idFromLabel(BASE, 'A', 'A'), 'A');
  });

  test('addParticipant appends a uniquely named participant', () => {
    const r = edit.addParticipant(BASE);
    assert.strictEqual(r.id, 'P3');
    assert.strictEqual(r.data.participants.at(-1)!.label, 'New participant');
  });

  test('moveParticipant clamps and ignores no-ops', () => {
    assert.deepStrictEqual(edit.moveParticipant(BASE, 0, 9).participants.map((p) => p.id), ['B', 'A']);
    assert.strictEqual(edit.moveParticipant(BASE, 0, 0), BASE);
    assert.strictEqual(edit.moveParticipant(BASE, 5, 0), BASE);
  });
});
