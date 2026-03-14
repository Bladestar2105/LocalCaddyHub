const { test, describe } = require('node:test');
const assert = require('node:assert');
const { safeCompare } = require('../src/utils');

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
