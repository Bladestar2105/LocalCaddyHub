const { test, describe } = require('node:test');
const assert = require('node:assert');
const { safeCompare, formatDuration, parseJSON } = require('../src/utils');

describe('formatDuration', () => {
  test('appends "s" to numeric values', () => {
    assert.strictEqual(formatDuration(10), '10s');
    assert.strictEqual(formatDuration(0), '0s');
  });

  test('appends "s" to string numeric values', () => {
    assert.strictEqual(formatDuration('30'), '30s');
    assert.strictEqual(formatDuration('0'), '0s');
  });

  test('appends "s" to decimal numeric values', () => {
    assert.strictEqual(formatDuration(10.5), '10.5s');
    assert.strictEqual(formatDuration('10.0'), '10.0s');
    assert.strictEqual(formatDuration('.5'), '.5s');
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

describe('parseJSON', () => {
  test('returns parsed object for valid JSON object string', () => {
    const json = '{"a":1,"b":"test"}';
    assert.deepStrictEqual(parseJSON(json), { a: 1, b: 'test' });
  });

  test('returns parsed array for valid JSON array string', () => {
    const json = '[1, 2, "three"]';
    assert.deepStrictEqual(parseJSON(json), [1, 2, 'three']);
  });

  test('returns empty array for "[]"', () => {
    assert.deepStrictEqual(parseJSON('[]'), []);
  });

  test('returns empty object for "{}"', () => {
    assert.deepStrictEqual(parseJSON('{}'), {});
  });

  test('returns default value for empty string', () => {
    assert.deepStrictEqual(parseJSON(''), []);
    assert.deepStrictEqual(parseJSON('', {}), {});
  });

  test('returns default value for null or undefined', () => {
    assert.deepStrictEqual(parseJSON(null), []);
    assert.deepStrictEqual(parseJSON(undefined, {}), {});
  });

  test('returns default value for invalid JSON string (error path)', () => {
    assert.deepStrictEqual(parseJSON('invalid-json'), []);
    assert.deepStrictEqual(parseJSON('{invalid}', { error: true }), { error: true });
  });

  test('handles default value as anything', () => {
    assert.strictEqual(parseJSON('invalid', 'default'), 'default');
    assert.strictEqual(parseJSON(null, 123), 123);
  });
});
