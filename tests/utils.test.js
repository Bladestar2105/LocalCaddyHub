const { test, describe } = require('node:test');
const assert = require('node:assert');
const { safeCompare, formatDuration, isSafeFilename } = require('../src/utils');

describe('formatDuration', () => {
  test('appends "s" to numeric values', () => {
    assert.strictEqual(formatDuration(10), '10s');
    assert.strictEqual(formatDuration(0), '0s');
  });

  test('appends "s" to string numeric values', () => {
    assert.strictEqual(formatDuration('30'), '30s');
    assert.strictEqual(formatDuration('0'), '0s');
  });

  test('trims whitespace and appends "s" to string numeric values', () => {
    assert.strictEqual(formatDuration('  45  '), '45s');
  });

  test('returns the original value for already formatted strings', () => {
    assert.strictEqual(formatDuration('10s'), '10s');
    assert.strictEqual(formatDuration('5m'), '5m');
    assert.strictEqual(formatDuration('1h'), '1h');
  });

  test('returns the original value for non-numeric strings', () => {
    assert.strictEqual(formatDuration('abc'), 'abc');
    assert.strictEqual(formatDuration('10 s'), '10 s');
  });

  test('returns the original value for falsy values', () => {
    assert.strictEqual(formatDuration(null), null);
    assert.strictEqual(formatDuration(undefined), undefined);
    assert.strictEqual(formatDuration(''), '');
    assert.strictEqual(formatDuration(false), false);
  });

  test('handles large numbers', () => {
    assert.strictEqual(formatDuration(86400), '86400s');
  });
});

describe('isSafeFilename', () => {
  test('returns true for safe filenames', () => {
    assert.strictEqual(isSafeFilename('test.log'), true);
    assert.strictEqual(isSafeFilename('access.log'), true);
    assert.strictEqual(isSafeFilename('my-cert.crt'), true);
    assert.strictEqual(isSafeFilename('config_file'), true);
  });

  test('returns false for filenames with path traversal', () => {
    assert.strictEqual(isSafeFilename('..'), false);
    assert.strictEqual(isSafeFilename('../etc/passwd'), false);
    assert.strictEqual(isSafeFilename('logs/../../etc/passwd'), false);
    assert.strictEqual(isSafeFilename('..\\windows\\system32'), false);
  });

  test('returns false for filenames with slashes', () => {
    assert.strictEqual(isSafeFilename('folder/file.txt'), false);
    assert.strictEqual(isSafeFilename('folder\\file.txt'), false);
    assert.strictEqual(isSafeFilename('/abs/path'), false);
    assert.strictEqual(isSafeFilename('C:\\abs\\path'), false);
  });

  test('returns false for empty or non-string inputs', () => {
    assert.strictEqual(isSafeFilename(''), false);
    assert.strictEqual(isSafeFilename(null), false);
    assert.strictEqual(isSafeFilename(undefined), false);
    assert.strictEqual(isSafeFilename(123), false);
    assert.strictEqual(isSafeFilename({}), false);
  });
});

describe('safeCompare', () => {
  test('returns true for matching strings', () => {
    assert.strictEqual(safeCompare('hello', 'hello'), true);
    assert.strictEqual(safeCompare('', ''), true);
    assert.strictEqual(safeCompare('a'.repeat(1000), 'a'.repeat(1000)), true);
  });

  test('returns false for non-matching strings of same length', () => {
    assert.strictEqual(safeCompare('hello', 'world'), false);
    assert.strictEqual(safeCompare('abc', 'abd'), false);
  });

  test('returns false for non-matching strings of different length', () => {
    assert.strictEqual(safeCompare('hello', 'hello world'), false);
    assert.strictEqual(safeCompare('world', 'hello'), false);
    assert.strictEqual(safeCompare('a', ''), false);
  });

  test('returns false for non-string inputs', () => {
    assert.strictEqual(safeCompare(null, 'hello'), false);
    assert.strictEqual(safeCompare('hello', null), false);
    assert.strictEqual(safeCompare(undefined, 'hello'), false);
    assert.strictEqual(safeCompare(123, 123), false);
    assert.strictEqual(safeCompare({}, {}), false);
    assert.strictEqual(safeCompare([], []), false);
    assert.strictEqual(safeCompare(true, true), false);
  });
});
