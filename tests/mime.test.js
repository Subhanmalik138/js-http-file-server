import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lookupMime } from '../src/mime.js';

describe('lookupMime', () => {
  it('maps common extensions', () => {
    assert.equal(lookupMime('index.html'), 'text/html; charset=utf-8');
    assert.equal(lookupMime('app.js'), 'text/javascript; charset=utf-8');
    assert.equal(lookupMime('data.json'), 'application/json; charset=utf-8');
    assert.equal(lookupMime('photo.PNG'), 'image/png');
    assert.equal(lookupMime('movie.mp4'), 'video/mp4');
  });

  it('is case-insensitive and uses the last extension', () => {
    assert.equal(lookupMime('archive.TAR.GZ'), 'application/gzip');
  });

  it('falls back to octet-stream for unknown or missing extensions', () => {
    assert.equal(lookupMime('file.unknownext'), 'application/octet-stream');
    assert.equal(lookupMime('Makefile'), 'application/octet-stream');
  });
});
