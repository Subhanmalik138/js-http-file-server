import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';

describe('HTTP integration', () => {
  let dir;
  let server;
  let base;
  const creds = 'Basic ' + Buffer.from('admin:s3cret').toString('base64');
  const authHeaders = { Authorization: creds };

  before(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fileserve-test-'));
    await fs.promises.writeFile(path.join(dir, 'hello.txt'), 'Hello, world!');
    await fs.promises.mkdir(path.join(dir, 'docs'));
    await fs.promises.writeFile(path.join(dir, 'docs', 'note.md'), '# note');
    server = createServer({ root: dir, upload: true, auth: { username: 'admin', password: 's3cret' } });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  const get = (p, headers = {}) => fetch(base + p, { headers });

  it('serves a file with correct content type', async () => {
    const r = await get('/hello.txt', authHeaders);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/plain/);
    assert.equal(await r.text(), 'Hello, world!');
  });

  it('requires auth on every route', async () => {
    const r = await get('/hello.txt');
    assert.equal(r.status, 401);
    assert.ok(r.headers.get('www-authenticate').startsWith('Basic'));
  });

  it('serves a directory listing', async () => {
    const r = await get('/', authHeaders);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    const html = await r.text();
    assert.ok(html.includes('hello.txt'));
    assert.ok(html.includes('docs'));
  });

  it('serves byte ranges with 206', async () => {
    const r = await get('/hello.txt', { ...authHeaders, Range: 'bytes=0-4' });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), 'bytes 0-4/13');
    assert.equal(await r.text(), 'Hello');
  });

  it('returns 416 for unsatisfiable ranges', async () => {
    const r = await get('/hello.txt', { ...authHeaders, Range: 'bytes=99-100' });
    assert.equal(r.status, 416);
  });

  it('returns 304 for a matching ETag', async () => {
    const etag = (await get('/hello.txt', authHeaders)).headers.get('etag');
    assert.ok(etag);
    const r = await get('/hello.txt', { ...authHeaders, 'If-None-Match': etag });
    assert.equal(r.status, 304);
  });

  it('answers HEAD without a body', async () => {
    const r = await fetch(base + '/hello.txt', { method: 'HEAD', headers: authHeaders });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-length'), '13');
    assert.equal(await r.text(), '');
  });

  it('blocks traversal with an encoded path', async () => {
    const r = await get('/%2e%2e/%2e%2e/etc/hostname', authHeaders);
    assert.ok([403, 404].includes(r.status));
  });

  it('returns 404 for missing files', async () => {
    const r = await get('/does-not-exist.txt', authHeaders);
    assert.equal(r.status, 404);
  });

  it('accepts PUT uploads and serves them back', async () => {
    const put = await fetch(base + '/new-file.bin', {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/octet-stream' },
      body: 'binary-data',
    });
    assert.equal(put.status, 201);
    const r = await get('/new-file.bin', authHeaders);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'binary-data');
  });
});
