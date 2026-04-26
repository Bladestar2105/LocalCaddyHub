const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const {
  loginRateLimiter,
  recordFailedAttempt,
  clearAttempts,
  loginAttempts,
  LOGIN_MAX_ATTEMPTS,
  evictionInterval
} = require('../src/rateLimiter');

// Clean up the interval after tests to prevent hanging
after(() => {
  clearInterval(evictionInterval);
});

describe('rateLimiter module', () => {
  const mockRes = () => {
    const res = {};
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.body = data;
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

  test('recordFailedAttempt increments count and sets lockedUntil', () => {
    const ip = '127.0.0.1';
    loginAttempts.delete(ip);

    // Initial attempt
    recordFailedAttempt(ip);
    assert.strictEqual(loginAttempts.get(ip).count, 1);
    assert.strictEqual(loginAttempts.get(ip).lockedUntil, null);

    // Reach max attempts
    for (let i = 1; i < LOGIN_MAX_ATTEMPTS; i++) {
      recordFailedAttempt(ip);
    }
    assert.strictEqual(loginAttempts.get(ip).count, LOGIN_MAX_ATTEMPTS);
    assert.ok(loginAttempts.get(ip).lockedUntil > Date.now());
  });

  test('clearAttempts removes entry', () => {
    const ip = '127.0.0.2';
    recordFailedAttempt(ip);
    assert.ok(loginAttempts.has(ip));

    clearAttempts(ip);
    assert.strictEqual(loginAttempts.has(ip), false);
  });

  test('loginRateLimiter middleware allows request', () => {
    const ip = '127.0.0.3';
    loginAttempts.delete(ip);
    const req = { ip };
    const res = mockRes();
    const next = mockNext();

    loginRateLimiter(req, res, next);

    assert.strictEqual(next.isCalled(), true);
    assert.strictEqual(req.loginAttemptsInfo.ip, ip);
    assert.strictEqual(req.loginAttemptsInfo.attempts, undefined);
  });

  test('loginRateLimiter middleware blocks locked IP', () => {
    const ip = '127.0.0.4';
    // Lock it manually or via recordFailedAttempt
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      recordFailedAttempt(ip);
    }

    const req = { ip };
    const res = mockRes();
    const next = mockNext();

    loginRateLimiter(req, res, next);

    assert.strictEqual(next.isCalled(), false);
    assert.strictEqual(res.statusCode, 429);
    assert.match(res.body.error, /Too many login attempts/);
  });

  test('loginRateLimiter middleware clears lock after timeout', () => {
    const ip = '127.0.0.5';
    // Manually set a lock that expired
    loginAttempts.set(ip, {
      count: LOGIN_MAX_ATTEMPTS,
      lockedUntil: Date.now() - 1000,
      lastAttempt: Date.now() - 1000
    });

    const req = { ip };
    const res = mockRes();
    const next = mockNext();

    loginRateLimiter(req, res, next);

    assert.strictEqual(next.isCalled(), true);
    assert.strictEqual(loginAttempts.has(ip), false); // Should have been cleared
  });
});
