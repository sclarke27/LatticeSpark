import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getApiKey, requireApiKey, requireAdminToken, authHeaders } from '../../src/utils/auth.js';

// Helper to create a mock request
function mockReq(headers = {}) {
  return { headers };
}

// Helper to create mock response
function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; }
  };
  return res;
}

describe('getApiKey', () => {
  it('extracts from x-api-key header', () => {
    assert.equal(getApiKey(mockReq({ 'x-api-key': 'abc123' })), 'abc123');
  });

  it('extracts from x-latticespark-api-key header', () => {
    assert.equal(getApiKey(mockReq({ 'x-latticespark-api-key': 'xyz' })), 'xyz');
  });

  it('extracts from Authorization Bearer header', () => {
    assert.equal(getApiKey(mockReq({ authorization: 'Bearer tok456' })), 'tok456');
  });

  it('prefers x-api-key over other headers', () => {
    assert.equal(getApiKey(mockReq({
      'x-api-key': 'first',
      'x-latticespark-api-key': 'second',
      authorization: 'Bearer third'
    })), 'first');
  });

  it('returns empty string when no key present', () => {
    assert.equal(getApiKey(mockReq()), '');
  });

  it('ignores non-Bearer authorization', () => {
    assert.equal(getApiKey(mockReq({ authorization: 'Basic abc123' })), '');
  });
});

describe('requireApiKey', () => {
  it('passes when no key configured (dev mode)', (_, done) => {
    const mw = requireApiKey('');
    mw(mockReq(), mockRes(), () => done());
  });

  it('passes when key matches', (_, done) => {
    const mw = requireApiKey('secret');
    mw(mockReq({ 'x-api-key': 'secret' }), mockRes(), () => done());
  });

  it('returns 401 when key does not match', () => {
    const mw = requireApiKey('secret');
    const res = mockRes();
    let nextCalled = false;
    mw(mockReq({ 'x-api-key': 'wrong' }), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'unauthorized' });
  });

  it('returns 401 when no key provided', () => {
    const mw = requireApiKey('secret');
    const res = mockRes();
    let nextCalled = false;
    mw(mockReq(), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });
});

describe('requireAdminToken', () => {
  it('passes when no admin token configured', (_, done) => {
    const mw = requireAdminToken('', 'apikey');
    mw(mockReq(), mockRes(), () => done());
  });

  it('passes when admin token matches via x-admin-token', (_, done) => {
    const mw = requireAdminToken('admin123', 'apikey');
    mw(mockReq({ 'x-admin-token': 'admin123' }), mockRes(), () => done());
  });

  it('passes when admin token matches via x-latticespark-admin', (_, done) => {
    const mw = requireAdminToken('admin123', 'apikey');
    mw(mockReq({ 'x-latticespark-admin': 'admin123' }), mockRes(), () => done());
  });

  it('falls back to API key as admin token', (_, done) => {
    const mw = requireAdminToken('admin123', 'apikey');
    mw(mockReq({ 'x-api-key': 'admin123' }), mockRes(), () => done());
  });

  it('returns 403 when admin token does not match', () => {
    const mw = requireAdminToken('admin123', 'apikey');
    const res = mockRes();
    let nextCalled = false;
    mw(mockReq({ 'x-api-key': 'wrong' }), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'admin token required' });
  });
});

describe('authHeaders', () => {
  it('returns X-API-Key header when key is set', () => {
    assert.deepEqual(authHeaders('mykey'), { 'X-API-Key': 'mykey' });
  });

  it('returns empty object when key is empty', () => {
    assert.deepEqual(authHeaders(''), {});
  });

  it('returns empty object when key is falsy', () => {
    assert.deepEqual(authHeaders(undefined), {});
    assert.deepEqual(authHeaders(null), {});
  });
});
