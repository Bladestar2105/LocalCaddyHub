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

const { authMiddleware, csrfMiddleware } = require('../src/auth');

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
  res.redirect = (location) => {
    res.redirectLocation = location;
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

describe('authMiddleware', () => {
  test('allows unauthenticated login support script', () => {
    const req = {
      path: '/i18n.js',
      cookies: {}
    };
    const res = mockRes();
    const next = mockNext();

    authMiddleware(req, res, next);

    assert.strictEqual(next.isCalled(), true);
    assert.strictEqual(res.redirectLocation, undefined);
  });

  test('redirects other unauthenticated static assets to login', () => {
    const req = {
      path: '/app.js',
      cookies: {}
    };
    const res = mockRes();
    const next = mockNext();

    authMiddleware(req, res, next);

    assert.strictEqual(next.isCalled(), false);
    assert.strictEqual(res.redirectLocation, '/login.html');
  });
});

describe('csrfMiddleware', () => {
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
