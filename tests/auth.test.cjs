const { test, describe } = require('node:test');
const assert = require('node:assert');
const nodeModule = require('module');

// Mock better-sqlite3 before requiring src/auth.js
const originalRequire = nodeModule.prototype.require;
nodeModule.prototype.require = function(name) {
  if (name === 'better-sqlite3') {
    return function() {
      return {
        pragma: () => {},
        prepare: () => ({
          get: () => ({}),
          run: () => ({}),
          all: () => []
        }),
        exec: () => {}
      };
    };
  }
  return originalRequire.apply(this, arguments);
};

const { csrfMiddleware } = require('../src/auth');

describe('csrfMiddleware', () => {
  const mockRes = () => {
    const res = {};
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.send = (msg) => {
      res.body = msg;
      return res;
    };
    return res;
  };

  const mockNext = () => {
    let called = false;
    const next = () => {
      called = true;
    };
    next.isCalled = () => called;
    return next;
  };

  test('allows GET request to /api/ without header', () => {
    const req = {
      method: 'GET',
      path: '/api/test',
      headers: {}
    };
    const res = mockRes();
    const next = mockNext();

    csrfMiddleware(req, res, next);

    assert.strictEqual(next.isCalled(), true);
    assert.strictEqual(res.statusCode, undefined);
  });

  test('allows HEAD request to /api/ without header', () => {
    const req = {
      method: 'HEAD',
      path: '/api/test',
      headers: {}
    };
    const res = mockRes();
    const next = mockNext();

    csrfMiddleware(req, res, next);

    assert.strictEqual(next.isCalled(), true);
  });

  test('allows OPTIONS request to /api/ without header', () => {
    const req = {
      method: 'OPTIONS',
      path: '/api/test',
      headers: {}
    };
    const res = mockRes();
    const next = mockNext();

    csrfMiddleware(req, res, next);

    assert.strictEqual(next.isCalled(), true);
  });

  test('allows POST request to non-api path without header', () => {
    const req = {
      method: 'POST',
      path: '/login',
      headers: {}
    };
    const res = mockRes();
    const next = mockNext();

    csrfMiddleware(req, res, next);

    assert.strictEqual(next.isCalled(), true);
  });

  test('blocks POST request to /api/ without header', () => {
    const req = {
      method: 'POST',
      path: '/api/save',
      headers: {}
    };
    const res = mockRes();
    const next = mockNext();

    csrfMiddleware(req, res, next);

    assert.strictEqual(next.isCalled(), false);
    assert.strictEqual(res.statusCode, 403);
    assert.match(res.body, /CSRF check failed/);
  });

  test('allows POST request to /api/ with X-Requested-With header', () => {
    const req = {
      method: 'POST',
      path: '/api/save',
      headers: {
        'x-requested-with': 'XMLHttpRequest'
      }
    };
    const res = mockRes();
    const next = mockNext();

    csrfMiddleware(req, res, next);

    assert.strictEqual(next.isCalled(), true);
    assert.strictEqual(res.statusCode, undefined);
  });

  test('blocks POST request to /api/ with wrong header value', () => {
    const req = {
      method: 'POST',
      path: '/api/save',
      headers: {
        'x-requested-with': 'Fetch'
      }
    };
    const res = mockRes();
    const next = mockNext();

    csrfMiddleware(req, res, next);

    assert.strictEqual(next.isCalled(), false);
    assert.strictEqual(res.statusCode, 403);
  });

  test('is case-insensitive for /api/ path', () => {
    const req = {
      method: 'POST',
      path: '/API/save',
      headers: {}
    };
    const res = mockRes();
    const next = mockNext();

    csrfMiddleware(req, res, next);

    assert.strictEqual(next.isCalled(), false);
    assert.strictEqual(res.statusCode, 403);
  });
});
