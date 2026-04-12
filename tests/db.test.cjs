const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const nodeModule = require('module');

// Mock better-sqlite3 to allow requiring src/db.js without the native module
const originalRequire = nodeModule.prototype.require;
nodeModule.prototype.require = function(name) {
  if (name === 'better-sqlite3') {
    return function() {
      return {
        pragma: () => {},
        prepare: () => ({ get: () => ({}), run: () => ({}), all: () => [] }),
        exec: () => {}
      };
    };
  }
  return originalRequire.apply(this, arguments);
};

const dbModule = require('../src/db');

// Restore require for tests
nodeModule.prototype.require = originalRequire;

/**
 * A wrapper around node:sqlite's DatabaseSync to provide a better-sqlite3 compatible interface.
 */
class SQLiteWrapper {
  constructor() {
    this.db = new DatabaseSync(':memory:');
  }

  exec(sql) {
    this.db.exec(sql);
  }

  prepare(sql) {
    const stmt = this.db.prepare(sql);
    return {
      get: (...args) => stmt.get(...args),
      all: (...args) => stmt.all(...args),
      run: (...args) => stmt.run(...args)
    };
  }

  pragma(p) {
    return this.prepare(`PRAGMA ${p}`).all();
  }

  close() {
    this.db.close();
  }
}

describe('db.js initialization', () => {
  let testDb;

  beforeEach(() => {
    testDb = new SQLiteWrapper();
  });

  test('initDb creates all tables', () => {
    dbModule.initDb(testDb);

    const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);

    assert.ok(tables.includes('general_config'));
    assert.ok(tables.includes('domains'));
    assert.ok(tables.includes('subdomains'));
    assert.ok(tables.includes('handlers'));
    assert.ok(tables.includes('access_lists'));
    assert.ok(tables.includes('basic_auths'));
    assert.ok(tables.includes('headers'));
    assert.ok(tables.includes('layer4'));
    assert.ok(tables.includes('users'));
    assert.ok(tables.includes('sessions'));
  });

  test('initGeneralConfig populates table if empty', () => {
    testDb.exec('CREATE TABLE general_config (id INTEGER PRIMARY KEY, enabled INTEGER, enable_layer4 INTEGER, http_port TEXT, https_port TEXT, log_level TEXT)');

    dbModule.initGeneralConfig(testDb);

    const row = testDb.prepare('SELECT * FROM general_config').get();
    assert.strictEqual(row.id, 1);
    assert.strictEqual(row.http_port, '80');
    assert.strictEqual(row.https_port, '443');
    assert.strictEqual(row.log_level, 'INFO');
  });

  test('initGeneralConfig does not overwrite existing data', () => {
    testDb.exec('CREATE TABLE general_config (id INTEGER PRIMARY KEY, enabled INTEGER, enable_layer4 INTEGER, http_port TEXT, https_port TEXT, log_level TEXT)');
    testDb.prepare("INSERT INTO general_config (id, http_port) VALUES (1, '8080')").run();

    dbModule.initGeneralConfig(testDb);

    const row = testDb.prepare('SELECT * FROM general_config').get();
    assert.strictEqual(row.http_port, '8080');
  });

  test('runMigrations adds missing columns', () => {
    testDb.exec('CREATE TABLE general_config (id INTEGER PRIMARY KEY)');
    testDb.exec('CREATE TABLE domains (id TEXT PRIMARY KEY)');
    testDb.exec('CREATE TABLE subdomains (id TEXT PRIMARY KEY)');
    testDb.exec('CREATE TABLE handlers (id TEXT PRIMARY KEY)');
    testDb.exec('CREATE TABLE access_lists (id TEXT PRIMARY KEY)');
    testDb.exec('CREATE TABLE layer4 (id TEXT PRIMARY KEY)');

    dbModule.runMigrations(testDb);

    const gcCols = testDb.pragma('table_info(general_config)').map(c => c.name);
    assert.ok(gcCols.includes('tls_email'));
    assert.ok(gcCols.includes('log_roll_keep'));

    const domainCols = testDb.pragma('table_info(domains)').map(c => c.name);
    assert.ok(domainCols.includes('client_auth_mode'));
    assert.ok(domainCols.includes('acme'));

    const handlerCols = testDb.pragma('table_info(handlers)').map(c => c.name);
    assert.ok(handlerCols.includes('waf_enabled'));
    assert.ok(handlerCols.includes('redir_status'));

    const layer4Cols = testDb.pragma('table_info(layer4)').map(c => c.name);
    assert.ok(layer4Cols.includes('starttls'));
    assert.ok(layer4Cols.includes('customCert'));
  });

  test('runMigrations is idempotent', () => {
    testDb.exec('CREATE TABLE general_config (id INTEGER PRIMARY KEY)');

    dbModule.runMigrations(testDb);
    const firstPassCols = testDb.pragma('table_info(general_config)').map(c => c.name);

    dbModule.runMigrations(testDb);
    const secondPassCols = testDb.pragma('table_info(general_config)').map(c => c.name);

    assert.deepStrictEqual(firstPassCols, secondPassCols);
  });
});
