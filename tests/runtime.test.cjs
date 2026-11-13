const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const Database = require('better-sqlite3');

const root = process.env.LCH_APP_ROOT || path.resolve(__dirname, '..');

async function launch(dataDir, credentials = {}) {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: root,
    env: { ...process.env, ADMIN_USER: '', ADMIN_PASS: '', ...credentials,
      PORT: String(port), LCH_DATA_DIR: dataDir, CADDY_AUTOSTART: '0',
      XDG_DATA_HOME: path.join(dataDir, 'caddy-data'), XDG_CONFIG_HOME: path.join(dataDir, 'caddy-config') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const base = `http://127.0.0.1:${port}`;
  for (let attempts = 0; attempts < 100; attempts++) {
    if (child.exitCode !== null) throw new Error(`App exited: ${output}`);
    try {
      const response = await fetch(`${base}/login.html`);
      if (response.ok) return { child, base, stop: async () => {
        if (child.exitCode !== null) return;
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }};
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill('SIGKILL');
  throw new Error(`App did not start: ${output}`);
}

function post(base, route, body, cookie) {
  return fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body)
  });
}

test('fresh SQLite startup, explicit bootstrap, setup and persistence across restart', { timeout: 20000 }, async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lch-runtime-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const credentials = { ADMIN_USER: 'bootstrap-user', ADMIN_PASS: 'temporary-long-secret' };
  let app = await launch(dataDir, credentials);
  t.after(async () => app.stop());
  assert.equal((await fetch(app.base + '/api/config/structured')).status, 401);
  const login = await post(app.base, '/login', { username: credentials.ADMIN_USER, password: credentials.ADMIN_PASS });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).needsSetup, true);
  let cookie = login.headers.get('set-cookie').split(';')[0];
  const setup = await post(app.base, '/api/setup', { newUsername: 'operator', newPassword: 'persisted-strong-password' }, cookie);
  assert.equal(setup.status, 200);
  cookie = setup.headers.get('set-cookie')?.split(';')[0] || cookie;
  const config = await fetch(app.base + '/api/config/structured', { headers: { Cookie: cookie } });
  assert.equal(config.status, 200);
  assert.ok((await config.json()).general);
  await app.stop();
  const db = new Database(path.join(dataDir, 'caddyhub.db'), { readonly: true });
  assert.equal(db.prepare('SELECT username FROM users WHERE id=1').get().username, 'operator');
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  db.close();
  app = await launch(dataDir);
  assert.equal((await post(app.base, '/login', { username: 'operator', password: 'persisted-strong-password' })).status, 200);
  assert.equal((await post(app.base, '/login', { username: credentials.ADMIN_USER, password: credentials.ADMIN_PASS })).status, 401);
});

test('fresh database has no implicit admin/admin login', { timeout: 15000 }, async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lch-no-default-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const app = await launch(dataDir);
  t.after(() => app.stop());
  assert.equal((await post(app.base, '/login', { username: 'admin', password: 'admin' })).status, 401);
});


test('deployment defaults retain legacy SQLite, configuration and certificates while explicit data overrides win', t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lch-deployment-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const appRoot = path.join(directory, 'app');
  fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true });
  fs.copyFileSync(path.join(root, 'src/paths.js'), path.join(appRoot, 'src/paths.js'));
  const defaultEnv = { ...process.env };
  // Relocate the image's default into the sandbox without hiding its presence.
  if (process.env.LCH_APP_ROOT && defaultEnv.LCH_DATA_DIR) defaultEnv.LCH_DATA_DIR = path.join(appRoot, 'data');
  else delete defaultEnv.LCH_DATA_DIR;
  const resolve = env => JSON.parse(execFileSync(process.execPath,
    ['-e', 'console.log(JSON.stringify(require(process.argv[1])))', path.join(appRoot, 'src/paths.js')], { env, encoding: 'utf8' }));
  const legacyDb = new Database(path.join(appRoot, 'caddyhub.db'));
  legacyDb.exec("CREATE TABLE users (username TEXT); INSERT INTO users VALUES ('saved-administrator')");
  legacyDb.close();
  fs.writeFileSync(path.join(appRoot, 'Caddyfile'), '# saved legacy configuration\n');
  fs.writeFileSync(path.join(appRoot, 'config.json'), '{"saved":true}');
  fs.mkdirSync(path.join(appRoot, 'certs'));
  fs.writeFileSync(path.join(appRoot, 'certs', 'saved.pem'), 'saved certificate');
  const legacy = resolve(defaultEnv);
  assert.equal(legacy.isLegacy, true, 'Image defaults must not silently force an existing legacy deployment into a new empty database');
  assert.equal(legacy.db, path.join(appRoot, 'caddyhub.db'));
  const saved = new Database(legacy.db, { readonly: true });
  assert.equal(saved.prepare('SELECT username FROM users').get().username, 'saved-administrator'); saved.close();
  assert.equal(fs.readFileSync(legacy.caddyfile, 'utf8'), '# saved legacy configuration\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(legacy.config, 'utf8')), { saved: true });
  assert.equal(fs.readFileSync(path.join(legacy.certsDir, 'saved.pem'), 'utf8'), 'saved certificate');
  const override = path.join(directory, 'explicit data');
  const explicit = resolve({ ...defaultEnv, LCH_DATA_DIR: override });
  assert.equal(explicit.isLegacy, false);
  assert.equal(explicit.db, path.join(override, 'caddyhub.db'));
  assert.equal(explicit.caddyfile, path.join(override, 'Caddyfile'));
  assert.equal(explicit.certsDir, path.join(override, 'certs'));
  fs.unlinkSync(path.join(appRoot, 'caddyhub.db'));
  const fresh = resolve(defaultEnv);
  assert.equal(fresh.isLegacy, false);
  assert.equal(fresh.db, path.join(appRoot, 'data', 'caddyhub.db'));
  assert.equal(fresh.caddyfile, path.join(appRoot, 'data', 'Caddyfile'));
  assert.equal(fresh.certsDir, path.join(appRoot, 'data', 'certs'));
});
