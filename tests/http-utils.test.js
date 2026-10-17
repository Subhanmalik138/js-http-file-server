import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolvePath, parseRange } from '../src/http-utils.js';

const ROOT = path.resolve('/srv/files');

describe('resolvePath', () => {
  it('resolves ordinary paths inside the root', () => {
    assert.equal(resolvePath(ROOT, '/docs/readme.txt'), path.join(ROOT, 'docs', 'readme.txt'));
    assert.equal(resolvePath(ROOT, '/'), ROOT);
  });

  it('blocks directory traversal attempts', () => {
    assert.equal(resolvePath(ROOT, '/..%2f..%2fetc%2fpasswd'), null);
    assert.equal(resolvePath(ROOT, '/%2e%2e/secret'), null);
  });

  it('normalizes inner .. segments that stay inside the root', () => {
    assert.equal(resolvePath(ROOT, '/a/../b.txt'), path.join(ROOT, 'b.txt'));
  });

  it('throws 400 on malformed percent-encoding', () => {
    assert.throws(() => resolvePath(ROOT, '/%zz'), (e) => e.status === 400);
  });
});

describe('parseRange', () => {
  const SIZE = 1000;

  it('parses a plain start-end range', () => {
    assert.deepEqual(parseRange('bytes=0-99', SIZE), { start: 0, end: 99 });
  });

  it('supports open-ended and suffix ranges', () => {
    assert.deepEqual(parseRange('bytes=500-', SIZE), { start: 500, end: 999 });
    assert.deepEqual(parseRange('bytes=-200', SIZE), { start: 800, end: 999 });
  });

  it('clamps the end to the file size', () => {
    assert.deepEqual(parseRange('bytes=0-99999', SIZE), { start: 0, end: 999 });
  });

  it('rejects unsatisfiable, multi-range and garbage specs', () => {
    assert.equal(parseRange('bytes=1000-2000', SIZE), null);
    assert.equal(parseRange('bytes=0-10,20-30', SIZE), null);
    assert.equal(parseRange('items=0-10', SIZE), null);
    assert.equal(parseRange('bytes=abc-def', SIZE), null);
    assert.equal(parseRange(null, SIZE), null);
  });
});
