const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const express = require('express');
const Module = require('node:module');

test('automatic renewal checks preserve existing certificates and established Caddy sessions', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lch-renewal-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.LCH_DATA_DIR = path.join(directory, 'data');
  const storage = path.join(directory, 'caddy');
  const assets = path.join(storage, 'certificates', 'acme.example', 'mail.example.test');
  fs.mkdirSync(assets, { recursive: true });
  const cert = path.join(assets, 'mail.example.test.crt');
  const key = path.join(assets, 'mail.example.test.key');
  childProcess.execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-days', '2', '-subj', '/CN=mail.example.test', '-keyout', key, '-out', cert], { stdio: 'ignore' });
  const previous = [fs.readFileSync(cert), fs.readFileSync(key)];
  const nativeFetch = global.fetch;
  const nativeExecFile = childProcess.execFile;
  const nativeSpawn = childProcess.spawn;
  const operations = [];
  let running = true;
  global.fetch = async url => {
    operations.push(String(url));
    if (String(url).endsWith('/stop')) running = false;
    return { ok: String(url).endsWith('/config/') ? running : true, text: async () => '' };
  };
  childProcess.execFile = (binary, args, ...rest) => {
    operations.push(args.join(' '));
    rest.at(-1)(null, args[0] === 'environ' ? `caddy.AppDataDir=${storage}\n` : '', '');
  };
  childProcess.spawn = () => {
    operations.push('spawn'); running = true;
    const process = new EventEmitter(); process.unref = () => {};
    return process;
  };
  const apiPath = require.resolve('../src/api');
  let router;
  try {
    if (process.env.LCH_TEST_API_SOURCE) {
      const api = new Module(apiPath, module);
      api.filename = apiPath; api.paths = Module._nodeModulePaths(path.dirname(apiPath));
      api._compile(fs.readFileSync(process.env.LCH_TEST_API_SOURCE, 'utf8'), apiPath);
      router = api.exports;
    } else router = require(apiPath);
  } finally {
    childProcess.execFile = nativeExecFile;
    childProcess.spawn = nativeSpawn;
  }
  t.after(() => { global.fetch = nativeFetch; require('../src/db').close(); });
  const app = express();
  app.use(express.json()); app.use('/api', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const pairs = await (await nativeFetch(`${base}/api/certs/pfx/list`)).json();
  assert.equal(pairs.length, 1);
  const response = await nativeFetch(`${base}/api/certs/letsencrypt/renew`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pairs[0].id }) });
  assert.equal(response.status, 200);
  assert.deepEqual(fs.readFileSync(cert), previous[0]);
  assert.deepEqual(fs.readFileSync(key), previous[1]);
  assert.ok(operations.some(operation => operation.endsWith('/load')));
  assert.ok(!operations.some(operation => operation.endsWith('/stop') || operation === 'spawn'));
  assert.match((await response.json()).output, /automatically when due/);
});
