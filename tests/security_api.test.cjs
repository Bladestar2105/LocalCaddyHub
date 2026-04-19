const { test, describe } = require('node:test');
const assert = require('node:assert');
const nodeModule = require('module');

// Mock dependencies before requiring src/api.js
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
        exec: () => {},
        transaction: (fn) => fn
      };
    };
  }
  if (name === './db') {
    return {
      prepare: () => ({
        get: () => ({}),
        run: () => ({}),
        all: () => []
      }),
      transaction: (fn) => fn
    };
  }
  if (name === './paths') {
    return {
      certsDir: '/tmp/certs',
      caddyfile: '/tmp/Caddyfile'
    };
  }
  if (name === './caddy') {
    return {
      generateCaddyfile: () => 'mock caddyfile'
    };
  }
  if (name === 'express') {
    const mockRouter = () => ({
      get: () => {},
      post: () => {},
      delete: () => {},
      use: () => {},
      stack: []
    });
    const express = () => ({
      use: () => {},
      get: () => {},
      post: () => {},
      listen: () => {}
    });
    express.Router = () => {
        const r = {
            stack: [],
            get: (path, ...handlers) => r.stack.push({ route: { path, methods: { get: true }, stack: handlers.map(h => ({ handle: h })) } }),
            post: (path, ...handlers) => r.stack.push({ route: { path, methods: { post: true }, stack: handlers.map(h => ({ handle: h })) } }),
            delete: (path, ...handlers) => r.stack.push({ route: { path, methods: { delete: true }, stack: handlers.map(h => ({ handle: h })) } }),
            use: () => {}
        };
        return r;
    };
    express.json = () => (req, res, next) => next();
    return express;
  }
  if (name === 'multer') {
    return () => ({
      single: () => (req, res, next) => next(),
      array: () => (req, res, next) => next(),
      fields: () => (req, res, next) => next()
    });
  }
  return originalRequire.apply(this, arguments);
};

const router = require('../src/api');

// Helper to find a route handler
function findRoute(method, path) {
  const layer = router.stack.find(layer =>
    layer.route &&
    layer.route.path === path &&
    layer.route.methods[method]
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack[0].handle;
}

describe('API Security - Path Traversal', () => {
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
    res.json = (val) => {
      res.body = val;
      return res;
    };
    res.sendStatus = (code) => {
      res.statusCode = code;
      return res;
    };
    res.writeHead = (code, headers) => {
        res.statusCode = code;
        res.headers = headers;
        return res;
    };
    return res;
  };

  describe('/api/logs/stream', () => {
    test('blocks path traversal with forward slash', async () => {
      const handler = findRoute('get', '/logs/stream');
      const req = { query: { file: 'test/../../../etc/passwd' } };
      const res = mockRes();
      await handler(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body, 'Invalid filename');
    });

    test('blocks path traversal with double dots', async () => {
      const handler = findRoute('get', '/logs/stream');
      const req = { query: { file: '..' } };
      const res = mockRes();
      await handler(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body, 'Invalid filename');
    });

    test('blocks path traversal with backslash', async () => {
      const handler = findRoute('get', '/logs/stream');
      const req = { query: { file: 'subdir\\..\\..\\etc\\passwd.log' } };
      const res = mockRes();
      await handler(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body, 'Invalid filename');
    });
  });

  describe('/api/certs', () => {
    test('blocks path traversal with forward slash', async () => {
      const handler = findRoute('delete', '/certs');
      const req = { query: { file: 'test/../../../etc/passwd' } };
      const res = mockRes();
      await handler(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body, 'Invalid filename');
    });

    test('blocks path traversal with backslash', async () => {
      const handler = findRoute('delete', '/certs');
      const req = { query: { file: 'subdir\\secret.pem' } };
      const res = mockRes();
      await handler(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body, 'Invalid filename');
    });
  });
});
