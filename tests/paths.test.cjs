const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const nodeModule = require('module');

// Helper to clear module cache
function clearCache(moduleName) {
  const resolvedPath = require.resolve(moduleName);
  delete require.cache[resolvedPath];
}

const originalRequire = nodeModule.prototype.require;
let mockFs = {};

nodeModule.prototype.require = function(name) {
  if (name === 'fs') {
    return mockFs;
  }
  return originalRequire.apply(this, arguments);
};

describe('paths.js', () => {
  const originalDataDir = process.env.LCH_DATA_DIR;
  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.LCH_DATA_DIR;
    else process.env.LCH_DATA_DIR = originalDataDir;
  });
  beforeEach(() => {
    mockFs = {
      existsSync: () => false,
      mkdirSync: () => {},
      chmodSync: () => {},
      writeFileSync: () => {},
      copyFileSync: () => {}
    };
    clearCache('../src/paths');
  });

  test('uses legacy paths if legacy database exists', () => {
    const appRoot = path.join(__dirname, '..');
    const legacyDbPath = path.join(appRoot, 'caddyhub.db');
    const legacyCertsDir = path.join(appRoot, 'certs');

    let mkdirCalledWith = [];
    mockFs.existsSync = (p) => {
      if (p === legacyDbPath) return true;
      if (p === legacyCertsDir) return false;
      return false;
    };
    mockFs.mkdirSync = (p, options) => {
      mkdirCalledWith.push({ p, options });
    };

    const paths = require('../src/paths');

    assert.strictEqual(paths.isLegacy, true);
    assert.strictEqual(paths.db, legacyDbPath);
    assert.strictEqual(paths.certsDir, legacyCertsDir);
    assert.deepStrictEqual(mkdirCalledWith, [{ p: legacyCertsDir, options: { recursive: true, mode: 0o700 } }]);
  });

  test('explicit data directory isolates an instance even when a legacy database exists', () => {
    process.env.LCH_DATA_DIR = '/tmp/lch-isolated-instance';
    mockFs.existsSync = () => true;
    const paths = require('../src/paths');
    assert.strictEqual(paths.isLegacy, false);
    assert.strictEqual(paths.db, '/tmp/lch-isolated-instance/caddyhub.db');
    assert.strictEqual(paths.caddyfile, '/tmp/lch-isolated-instance/Caddyfile');
    assert.strictEqual(paths.certsDir, '/tmp/lch-isolated-instance/certs');
    assert.strictEqual(paths.logsDir, '/tmp/lch-isolated-instance/logs');
  });

  test('uses new paths and initializes data dir if legacy database does not exist', () => {
    const appRoot = path.join(__dirname, '..');
    const dataDir = path.join(appRoot, 'data');
    const newDbPath = path.join(dataDir, 'caddyhub.db');
    const newCaddyfilePath = path.join(dataDir, 'Caddyfile');
    const newConfigPath = path.join(dataDir, 'config.json');
    const newCertsDir = path.join(dataDir, 'certs');
    const bundledCaddyfile = path.join(appRoot, 'Caddyfile');

    let mkdirs = [];
    let writes = [];
    let copies = [];

    mockFs.existsSync = (p) => {
        // none exist
        return false;
    };
    mockFs.mkdirSync = (p, opt) => mkdirs.push(p);
    mockFs.writeFileSync = (p, content) => writes.push({p, content});
    mockFs.copyFileSync = (src, dest) => copies.push({src, dest});

    const paths = require('../src/paths');

    assert.strictEqual(paths.isLegacy, false);
    assert.strictEqual(paths.db, newDbPath);
    assert.strictEqual(paths.caddyfile, newCaddyfilePath);

    assert.ok(mkdirs.includes(dataDir));
    assert.ok(mkdirs.includes(newCertsDir));
    assert.ok(writes.some(w => w.p === newConfigPath));
    // Since bundledCaddyfile doesn't exist in our mock, it should use fallback write
    assert.ok(writes.some(w => w.p === newCaddyfilePath));
  });

  test('copies bundled Caddyfile if it exists in clean start', () => {
    const appRoot = path.join(__dirname, '..');
    const dataDir = path.join(appRoot, 'data');
    const newCaddyfilePath = path.join(dataDir, 'Caddyfile');
    const bundledCaddyfile = path.join(appRoot, 'Caddyfile');

    let copies = [];
    mockFs.existsSync = (p) => {
        if (p === bundledCaddyfile) return true;
        return false;
    };
    mockFs.copyFileSync = (src, dest) => copies.push({src, dest});

    const paths = require('../src/paths');

    assert.deepStrictEqual(copies, [{ src: bundledCaddyfile, dest: newCaddyfilePath }]);
  });

  test('does not re-initialize if files already exist in new structure', () => {
    const appRoot = path.join(__dirname, '..');
    const dataDir = path.join(appRoot, 'data');

    let mkdirs = [];
    let writes = [];

    mockFs.existsSync = (p) => {
        if (p === path.join(appRoot, 'caddyhub.db')) return false; // isLegacy check
        return true; // everything else exists
    };
    mockFs.mkdirSync = (p, opt) => mkdirs.push(p);
    mockFs.writeFileSync = (p, content) => writes.push({p, content});

    const paths = require('../src/paths');

    assert.strictEqual(paths.isLegacy, false);
    assert.strictEqual(mkdirs.length, 0);
    assert.strictEqual(writes.length, 0);
  });
});
