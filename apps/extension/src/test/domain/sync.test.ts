import * as assert from 'assert';
import { suite, test } from 'vitest';
import { BlockSync } from '../../webview/sync';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Posted {
  rev: number;
  content: string;
  force: boolean;
}

function make(initial = 'a') {
  const posts: Posted[] = [];
  const sync = new BlockSync(initial, (rev, content, force) => posts.push({ rev, content, force }), 10);
  return { sync, posts };
}

suite('BlockSync', () => {
  test('user edit debounces, sends once, ack returns to clean', async () => {
    const { sync, posts } = make();
    sync.userEdited('b');
    sync.userEdited('bc');
    assert.strictEqual(sync.snapshot().status, 'pending');
    assert.strictEqual(posts.length, 0);
    await sleep(25);
    assert.deepStrictEqual(posts, [{ rev: 1, content: 'bc', force: false }]);
    sync.handleAck(1);
    assert.strictEqual(sync.snapshot().status, 'clean');
  });

  test('flush sends immediately without waiting out the debounce', () => {
    const { sync, posts } = make();
    sync.userEdited('b');
    sync.flush();
    assert.deepStrictEqual(posts, [{ rev: 1, content: 'b', force: false }]);
  });

  test('external update while clean replaces content silently', () => {
    const { sync, posts } = make();
    sync.handleExternalUpdate('from-file');
    assert.strictEqual(sync.snapshot().status, 'clean');
    assert.strictEqual(sync.snapshot().content, 'from-file');
    assert.strictEqual(posts.length, 0);
  });

  test('identical external update while pending acts as an ack', () => {
    const { sync } = make();
    sync.userEdited('b');
    sync.handleExternalUpdate('b');
    assert.strictEqual(sync.snapshot().status, 'clean');
  });

  test('different external update while pending raises a conflict and stops writes', async () => {
    const { sync, posts } = make();
    sync.userEdited('mine');
    sync.handleExternalUpdate('theirs');
    const snap = sync.snapshot();
    assert.strictEqual(snap.status, 'conflict');
    assert.strictEqual(snap.content, 'mine');
    assert.strictEqual(snap.fileContent, 'theirs');
    // Local edits during conflict stay local; nothing is posted.
    sync.userEdited('mine2');
    await sleep(25);
    assert.strictEqual(posts.length, 0);
    assert.strictEqual(sync.snapshot().status, 'conflict');
  });

  test('loadFileVersion adopts the file content and returns to clean', () => {
    const { sync } = make();
    sync.userEdited('mine');
    sync.handleExternalUpdate('theirs');
    sync.loadFileVersion();
    assert.strictEqual(sync.snapshot().status, 'clean');
    assert.strictEqual(sync.snapshot().content, 'theirs');
  });

  test('keepMine force-writes the editor content', () => {
    const { sync, posts } = make();
    sync.userEdited('mine');
    sync.handleExternalUpdate('theirs');
    sync.keepMine();
    assert.deepStrictEqual(posts, [{ rev: 1, content: 'mine', force: true }]);
    assert.strictEqual(sync.snapshot().status, 'pending');
    sync.handleAck(1);
    assert.strictEqual(sync.snapshot().status, 'clean');
  });

  test('external update while in conflict refreshes the stashed file version', () => {
    const { sync } = make();
    sync.userEdited('mine');
    sync.handleExternalUpdate('theirs');
    sync.handleExternalUpdate('theirs-2');
    assert.strictEqual(sync.snapshot().status, 'conflict');
    assert.strictEqual(sync.snapshot().fileContent, 'theirs-2');
  });

  test('writeFailed conflicts with the failure message; keepMine retries', () => {
    const { sync, posts } = make();
    sync.userEdited('b');
    sync.flush();
    sync.handleWriteFailed('disk full');
    const snap = sync.snapshot();
    assert.strictEqual(snap.status, 'conflict');
    assert.strictEqual(snap.failure, 'disk full');
    assert.strictEqual(snap.fileContent, null);
    sync.keepMine();
    assert.deepStrictEqual(posts.at(-1), { rev: 2, content: 'b', force: true });
  });

  test('edits made while a write is in flight keep the session pending after ack', async () => {
    const { sync, posts } = make();
    sync.userEdited('b');
    sync.flush(); // rev 1 in flight
    sync.userEdited('bc'); // typed before the ack lands
    sync.handleAck(1);
    assert.strictEqual(sync.snapshot().status, 'pending');
    await sleep(25);
    assert.deepStrictEqual(posts.at(-1), { rev: 2, content: 'bc', force: false });
    sync.handleAck(2);
    assert.strictEqual(sync.snapshot().status, 'clean');
  });

  test('gone freezes everything but keeps the content for copy-out', async () => {
    const { sync, posts } = make();
    sync.userEdited('b');
    sync.handleGone();
    assert.strictEqual(sync.snapshot().status, 'gone');
    assert.strictEqual(sync.snapshot().content, 'b');
    sync.userEdited('c');
    sync.handleExternalUpdate('x');
    await sleep(25);
    assert.strictEqual(posts.length, 0);
    assert.strictEqual(sync.snapshot().status, 'gone');
  });

  test('notifies subscribers on every transition', () => {
    const { sync } = make();
    let calls = 0;
    const unsubscribe = sync.subscribe(() => calls++);
    sync.userEdited('b');
    sync.handleExternalUpdate('c');
    assert.ok(calls >= 2);
    unsubscribe();
    sync.handleGone();
    assert.strictEqual(calls, 2);
  });
});
