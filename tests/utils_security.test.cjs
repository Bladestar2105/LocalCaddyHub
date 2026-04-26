const { test, describe } = require('node:test');
const assert = require('node:assert');
const { isSafeFilename } = require('../src/utils');

describe('isSafeFilename', () => {
  test('allows safe filenames', () => {
    assert.strictEqual(isSafeFilename('access.log'), true);
    assert.strictEqual(isSafeFilename('error-123.log'), true);
    assert.strictEqual(isSafeFilename('my_config.json'), true);
  });

  test('rejects path traversal', () => {
    assert.strictEqual(isSafeFilename('../etc/passwd'), false);
    assert.strictEqual(isSafeFilename('..'), false);
    assert.strictEqual(isSafeFilename('/etc/passwd'), false);
    assert.strictEqual(isSafeFilename('C:\\Windows\\System32'), false);
  });

  test('rejects dangerous shell characters', () => {
    assert.strictEqual(isSafeFilename('file;rm -rf /'), false);
    assert.strictEqual(isSafeFilename('file&whoami'), false);
    assert.strictEqual(isSafeFilename('file|ls'), false);
    assert.strictEqual(isSafeFilename('file$(id)'), false);
    assert.strictEqual(isSafeFilename('file`id`'), false);
    assert.strictEqual(isSafeFilename('file>out'), false);
    assert.strictEqual(isSafeFilename('file<in'), false);
  });

  test('rejects null bytes', () => {
    assert.strictEqual(isSafeFilename('file.log\0.txt'), false);
  });

  test('rejects empty or non-string inputs', () => {
    assert.strictEqual(isSafeFilename(''), false);
    assert.strictEqual(isSafeFilename(null), false);
    assert.strictEqual(isSafeFilename(undefined), false);
    assert.strictEqual(isSafeFilename(123), false);
    assert.strictEqual(isSafeFilename({}), false);
  });
});
