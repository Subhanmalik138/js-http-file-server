import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseBasicAuth, checkAuth } from '../src/auth.js';

describe('parseBasicAuth', () => {
  it('decodes a valid header', () => {
    const header = 'Basic ' + Buffer.from('admin:s3cret').toString('base64');
    assert.deepEqual(parseBasicAuth(header), { username: 'admin', password: 's3cret' });
  });

  it('keeps colons inside the password', () => {
    const header = 'Basic ' + Buffer.from('u:p:a:s:s').toString('base64');
    assert.deepEqual(parseBasicAuth(header), { username: 'u', password: 'p:a:s:s' });
  });

  it('returns null for missing, non-Basic or malformed headers', () => {
    assert.equal(parseBasicAuth(undefined), null);
    assert.equal(parseBasicAuth('Bearer token'), null);
    assert.equal(
      parseBasicAuth('Basic ' + Buffer.from('nocolon').toString('base64')),
      null
    );
  });
});

describe('checkAuth', () => {
  const auth = { username: 'admin', password: 's3cret' };
  const header = 'Basic ' + Buffer.from('admin:s3cret').toString('base64');
  const bad = 'Basic ' + Buffer.from('admin:wrong').toString('base64');

  it('allows everything when no credentials are configured', () => {
    assert.equal(checkAuth({ headers: {} }, null), true);
  });

  it('accepts correct credentials and rejects wrong ones', () => {
    assert.equal(checkAuth({ headers: { authorization: header } }, auth), true);
    assert.equal(checkAuth({ headers: { authorization: bad } }, auth), false);
    assert.equal(checkAuth({ headers: {} }, auth), false);
  });
});
