const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const { generateSync } = require('otplib');

async function startApp(t, extraEnv = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lch-backend-'));
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const marker = path.join(dir, 'caddy-started');
  const fakeCaddy = path.join(dir, 'caddy');
  await fs.writeFile(fakeCaddy, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(marker)}, 'started');\n`, { mode: 0o700 });
  const child = spawn(process.execPath, [path.join(__dirname, '../src/index.js')], {
    env: { ...process.env, PORT: String(port), LCH_DATA_DIR: dir, CADDY_AUTOSTART: '0', CADDY_BIN: fakeCaddy,
      ADMIN_USER: 'operator', ADMIN_PASS: 'test-bootstrap-password', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('exit', resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) throw new Error(`Application exited: ${output}`);
    try {
      if ((await fetch(`${base}/login.html`)).ok) return { base, dir, marker, child };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Application did not become ready: ${output}`);
}

test('an isolated administration instance can start without launching Caddy', async t => {
  const { dir, marker } = await startApp(t);
  await new Promise(resolve => setTimeout(resolve, 200));
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
  await fs.access(path.join(dir, 'caddyhub.db'));
  assert.equal((await fs.stat(path.join(dir, 'certs'))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(dir, 'caddyhub.db'))).mode & 0o777, 0o600);
});

async function login(base, body = { username: 'operator', password: 'test-bootstrap-password' }) {
  return fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function authenticatedApp(t) {
  const app = await startApp(t);
  const response = await login(app.base);
  assert.equal(response.status, 200);
  app.headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Cookie: response.headers.get('set-cookie').split(';')[0] };
  return app;
}

function configWithDomain(name) {
  return { general: { enabled: false, http_port: '8080', https_port: '8443' },
    domains: [{ id: 'domain', enabled: false, fromDomain: name }],
    subdomains: [], handlers: [], accessLists: [], basicAuths: [], headers: [], layer4: [] };
}

test('TOTP failures are subject to the login lockout', async t => {
  const app = await startApp(t);
  const db = new Database(path.join(app.dir, 'caddyhub.db'));
  db.prepare('INSERT INTO users(id, username, password_hash, totp_secret, totp_enabled) VALUES(1,?,?,?,1)')
    .run('operator', bcrypt.hashSync('test-bootstrap-password', 4), 'JBSWY3DPEHPK3PXP');
  db.close();
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await login(app.base, { username: 'operator', password: 'test-bootstrap-password', totp: 'invalid' })).status, 401);
  }
  assert.equal((await login(app.base, { username: 'operator', password: 'test-bootstrap-password', totp: 'invalid' })).status, 429);
});

test('malformed configuration is rejected without losing the saved configuration', async t => {
  const app = await authenticatedApp(t);
  const saved = await fetch(`${app.base}/api/config/structured`, { method: 'POST', headers: app.headers, body: JSON.stringify(configWithDomain('saved.example')) });
  assert.equal(saved.status, 200);
  const oldFile = await fs.readFile(path.join(app.dir, 'Caddyfile'), 'utf8');
  const response = await fetch(`${app.base}/api/config/structured`, { method: 'POST', headers: app.headers, body: JSON.stringify({ general: {}, domains: 'not-an-array' }) });
  assert.equal(response.status, 400);
  const loaded = await (await fetch(`${app.base}/api/config/structured`, { headers: app.headers })).json();
  assert.equal(loaded.domains[0].fromDomain, 'saved.example');
  assert.equal(await fs.readFile(path.join(app.dir, 'Caddyfile'), 'utf8'), oldFile);
});

test('dangling access and authentication references cannot silently remove protection', async t => {
  const app = await authenticatedApp(t);
  for (const field of ['accesslist', 'basicauth']) {
    const config = configWithDomain('protected.example');
    config.domains[0][field] = ['missing-rule'];
    const response = await fetch(`${app.base}/api/config/structured`, { method: 'POST', headers: app.headers, body: JSON.stringify(config) });
    assert.equal(response.status, 400, field);
    const loaded = await (await fetch(`${app.base}/api/config/structured`, { headers: app.headers })).json();
    assert.equal(loaded.domains.length, 0);
  }
});

test('a failed Caddyfile replacement does not commit new database configuration', async t => {
  const app = await authenticatedApp(t);
  const endpoint = `${app.base}/api/config/structured`;
  assert.equal((await fetch(endpoint, { method: 'POST', headers: app.headers, body: JSON.stringify(configWithDomain('saved.example')) })).status, 200);
  await fs.rename(path.join(app.dir, 'Caddyfile'), path.join(app.dir, 'previous-Caddyfile'));
  await fs.mkdir(path.join(app.dir, 'Caddyfile'));
  assert.equal((await fetch(endpoint, { method: 'POST', headers: app.headers, body: JSON.stringify(configWithDomain('replacement.example')) })).status, 500);
  const loaded = await (await fetch(endpoint, { headers: app.headers })).json();
  assert.equal(loaded.domains[0].fromDomain, 'saved.example');
});

test('setup rejects weak and bcrypt-truncated passwords', async t => {
  const app = await authenticatedApp(t);
  for (const newPassword of ['short', 'a'.repeat(73), 'ü'.repeat(37)]) {
    const response = await fetch(`${app.base}/api/setup`, { method: 'POST', headers: app.headers,
      body: JSON.stringify({ newUsername: 'operator', newPassword }) });
    assert.equal(response.status, 400);
  }
});

test('certificate uploads reject invalid PEM and do not overwrite existing private keys', async t => {
  const app = await authenticatedApp(t);
  const upload = async (filename, content) => {
    const form = new FormData();
    form.append('file', new Blob([content]), filename);
    return fetch(`${app.base}/api/certs`, { method: 'POST', headers: { Cookie: app.headers.Cookie, 'X-Requested-With': 'XMLHttpRequest' }, body: form });
  };
  assert.equal((await upload('invalid.pem', 'not a certificate')).status, 400);
  assert.equal((await upload('file.txt', 'unrelated content')).status, 400);
  const key = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.equal((await upload('private.key', key)).status, 200);
  assert.equal((await upload('private.key', key)).status, 409);
  assert.equal(await fs.readFile(path.join(app.dir, 'certs', 'private.key'), 'utf8'), key);
  assert.equal((await fs.stat(path.join(app.dir, 'certs', 'private.key'))).mode & 0o777, 0o600);
  const files = await fs.readdir(path.join(app.dir, 'certs'));
  assert.deepEqual(files, ['private.key']);
});

test('help does not initialize a database or configuration directory', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lch-help-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'data');
  assert.match(execFileSync(process.execPath, [path.join(__dirname, '../src/index.js'), '--help'], {
    env: { ...process.env, LCH_DATA_DIR: dataDir }, encoding: 'utf8'
  }), /Usage:/);
  await assert.rejects(fs.access(dataDir), { code: 'ENOENT' });
});

test('filesystem failures in certificate export return an error and keep the server alive', async t => {
  const app = await authenticatedApp(t);
  await fs.rm(path.join(app.dir, 'certs'), { recursive: true });
  await fs.writeFile(path.join(app.dir, 'certs'), 'not a directory');
  const response = await fetch(`${app.base}/api/certs/pfx/download`, { method: 'POST', headers: app.headers,
    body: JSON.stringify({ id: 'missing', password: 'pfx-password' }) }).catch(() => null);
  assert.ok(response, 'connection must not be dropped by an unhandled rejection');
  assert.equal(response.status, 500);
  assert.equal((await fetch(`${app.base}/api/config/structured`, { headers: app.headers })).status, 200);
});

test('certificate reference cleanup rolls back when the Caddyfile cannot be replaced', async t => {
  const app = await authenticatedApp(t);
  const config = configWithDomain('saved.example');
  config.domains[0].customCert = 'missing.pem';
  assert.equal((await fetch(`${app.base}/api/config/structured`, { method: 'POST', headers: app.headers, body: JSON.stringify(config) })).status, 200);
  await fs.rename(path.join(app.dir, 'Caddyfile'), path.join(app.dir, 'previous-Caddyfile'));
  await fs.mkdir(path.join(app.dir, 'Caddyfile'));
  assert.equal((await fetch(`${app.base}/api/certs/references/cleanup`, { method: 'POST', headers: app.headers, body: '{}' })).status, 500);
  const loaded = await (await fetch(`${app.base}/api/config/structured`, { headers: app.headers })).json();
  assert.equal(loaded.domains[0].customCert, 'missing.pem');
});

test('renew-all without managed certificates leaves the selected key type untouched', async t => {
  const app = await authenticatedApp(t);
  const config = configWithDomain('saved.example');
  config.general.tls_key_type = 'p256';
  assert.equal((await fetch(`${app.base}/api/config/structured`, { method: 'POST', headers: app.headers, body: JSON.stringify(config) })).status, 200);
  assert.equal((await fetch(`${app.base}/api/certs/letsencrypt/renew-all-rsa`, { method: 'POST', headers: app.headers, body: '{}' })).status, 404);
  const loaded = await (await fetch(`${app.base}/api/config/structured`, { headers: app.headers })).json();
  assert.equal(loaded.general.tls_key_type, 'p256');
});

test('Exchange WAF profile and bounded request limit survive a configuration round trip', async t => {
  const app = await authenticatedApp(t);
  const config = configWithDomain('saved.example');
  config.handlers.push({ id: 'exchange', reverse: 'domain', enabled: false, waf_enabled: true, waf_profile: 'exchange', waf_body_limit_mb: 128 });
  assert.equal((await fetch(`${app.base}/api/config/structured`, { method: 'POST', headers: app.headers, body: JSON.stringify(config) })).status, 200);
  const loaded = await (await fetch(`${app.base}/api/config/structured`, { headers: app.headers })).json();
  assert.equal(loaded.handlers[0].waf_profile, 'exchange');
  assert.equal(loaded.handlers[0].waf_body_limit_mb, 128);
  config.handlers[0].waf_body_limit_mb = 0.5;
  assert.equal((await fetch(`${app.base}/api/config/structured`, { method: 'POST', headers: app.headers, body: JSON.stringify(config) })).status, 400);
});

test('setting credentials rotates the current session and revokes every previous session', async t => {
  const app = await authenticatedApp(t);
  const second = await login(app.base);
  const secondCookie = second.headers.get('set-cookie').split(';')[0];
  const setup = await fetch(`${app.base}/api/setup`, { method: 'POST', headers: app.headers,
    body: JSON.stringify({ newUsername: 'administrator', newPassword: 'a-new-secure-password' }) });
  assert.equal(setup.status, 200);
  const setCookie = setup.headers.get('set-cookie');
  assert.ok(setCookie, 'credential changes must issue a fresh session');
  const freshCookie = setCookie.split(';')[0];
  assert.notEqual(freshCookie, app.headers.Cookie);
  for (const Cookie of [app.headers.Cookie, secondCookie]) {
    assert.equal((await fetch(`${app.base}/api/config/structured`, { headers: { Cookie } })).status, 401);
  }
  assert.equal((await fetch(`${app.base}/api/config/structured`, { headers: { Cookie: freshCookie } })).status, 200);
  assert.equal((await login(app.base, { username: 'administrator', password: 'a-new-secure-password' })).status, 200);
});

test('starting Caddy reports a delayed startup failure instead of premature success', async t => {
  const app = await authenticatedApp(t);
  await fs.writeFile(path.join(app.dir, 'caddy'), `#!${process.execPath}\nif(process.argv[2]==='run')setTimeout(()=>process.exit(2),250);\n`);
  const response = await fetch(`${app.base}/api/start`, { method: 'POST', headers: app.headers, body: '{}' });
  const result = await response.json();
  assert.match(result.error || '', /Caddy exited with code 2/);
});

test('an unavailable log reader reports a stream error without crashing the administration server', async t => {
  const app = await startApp(t, { PATH: '/not-a-search-path' });
  const authenticated = await login(app.base);
  const Cookie = authenticated.headers.get('set-cookie').split(';')[0];
  await fs.writeFile(path.join(app.dir, 'logs', 'access.log'), 'test line\n');
  let body = '';
  try {
    const response = await fetch(`${app.base}/api/logs/stream?file=access.log`, { headers: { Cookie }, signal: AbortSignal.timeout(2000) });
    body = await response.text();
  } catch {}
  assert.match(body, /Failed to start log reader/);
  assert.equal((await fetch(`${app.base}/api/config/structured`, { headers: { Cookie } })).status, 200);
});

test('an unavailable archive tool fails the download without crashing the administration server', async t => {
  const app = await startApp(t, { PATH: '/not-a-search-path' });
  const authenticated = await login(app.base);
  const Cookie = authenticated.headers.get('set-cookie').split(';')[0];
  const storage = path.join(app.dir, 'caddy-storage');
  await fs.mkdir(path.join(storage, 'certificates'), { recursive: true });
  await fs.writeFile(path.join(app.dir, 'caddy'), `#!${process.execPath}\nconsole.log(${JSON.stringify('caddy.AppDataDir=' + storage)});\n`);
  const response = await fetch(`${app.base}/api/certs/acme/download`, { headers: { Cookie }, signal: AbortSignal.timeout(2000) }).catch(() => null);
  assert.equal(response && response.status, 500);
  assert.equal((await fetch(`${app.base}/api/config/structured`, { headers: { Cookie } })).status, 200);
});

test('concurrent credential changes cannot reuse a session revoked during password hashing', async t => {
  const app = await authenticatedApp(t);
  const responses = await Promise.all(['first-secure-password', 'second-secure-password'].map(newPassword =>
    fetch(`${app.base}/api/setup`, { method: 'POST', headers: app.headers,
      body: JSON.stringify({ newUsername: 'operator', newPassword }) })));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
});

test('an in-flight login cannot issue a session for credentials changed during its password check', async t => {
  const app = await authenticatedApp(t);
  const db = new Database(path.join(app.dir, 'caddyhub.db'));
  // A slower existing hash keeps login in flight while the new credentials are saved.
  db.prepare('INSERT INTO users(id, username, password_hash) VALUES(1,?,?)')
    .run('operator', bcrypt.hashSync('previous-secure-password', 12));
  db.close();
  const pendingLogin = login(app.base, { username: 'operator', password: 'previous-secure-password' });
  const updated = await fetch(`${app.base}/api/setup`, { method: 'POST', headers: app.headers,
    body: JSON.stringify({ newUsername: 'operator', newPassword: 'replacement-secure-password' }) });
  assert.equal(updated.status, 200);
  const staleLogin = await pendingLogin;
  assert.equal(staleLogin.status, 401);
  assert.equal(staleLogin.headers.get('set-cookie'), null);
});

test('enabling and disabling TOTP rotates the session and revokes older cookies', async t => {
  const app = await authenticatedApp(t);
  const setup = await fetch(`${app.base}/api/setup`, { method: 'POST', headers: app.headers,
    body: JSON.stringify({ newUsername: 'operator', newPassword: 'a-new-secure-password' }) });
  app.headers.Cookie = setup.headers.get('set-cookie')?.split(';')[0] || app.headers.Cookie;
  const second = await login(app.base, { username: 'operator', password: 'a-new-secure-password' });
  const secondCookie = second.headers.get('set-cookie').split(';')[0];
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const enabled = await fetch(`${app.base}/api/2fa/verify`, { method: 'POST', headers: app.headers,
    body: JSON.stringify({ secret, token: generateSync({ secret }) }) });
  assert.equal(enabled.status, 200);
  const enabledCookie = enabled.headers.get('set-cookie')?.split(';')[0];
  assert.ok(enabledCookie, 'enabling TOTP must issue a fresh session');
  for (const Cookie of [app.headers.Cookie, secondCookie]) {
    assert.equal((await fetch(`${app.base}/api/2fa/status`, { headers: { Cookie } })).status, 401);
  }
  const secondMfa = await login(app.base, { username: 'operator', password: 'a-new-secure-password', totp: generateSync({ secret }) });
  assert.equal(secondMfa.status, 200);
  const disabled = await fetch(`${app.base}/api/2fa/disable`, { method: 'POST', headers: { ...app.headers, Cookie: enabledCookie } });
  assert.equal(disabled.status, 200);
  const disabledCookie = disabled.headers.get('set-cookie')?.split(';')[0];
  assert.ok(disabledCookie, 'disabling TOTP must issue a fresh session');
  for (const Cookie of [enabledCookie, secondMfa.headers.get('set-cookie').split(';')[0]]) {
    assert.equal((await fetch(`${app.base}/api/2fa/status`, { headers: { Cookie } })).status, 401);
  }
  const status = await fetch(`${app.base}/api/2fa/status`, { headers: { Cookie: disabledCookie } });
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { enabled: false });
});

test('startup hardens existing data directories and private files', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lch-upgrade-permissions-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.chmod(dir, 0o755);
  await fs.mkdir(path.join(dir, 'certs'), { mode: 0o755 });
  const names = ['caddyhub.db', 'caddyhub.db-wal', 'caddyhub.db-shm', 'Caddyfile', 'config.json'];
  for (const name of names) await fs.writeFile(path.join(dir, name), 'existing-data', { mode: 0o644 });
  execFileSync(process.execPath, ['-e', "require('./src/paths')"], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, LCH_DATA_DIR: dir }
  });
  for (const directory of [dir, path.join(dir, 'certs')]) assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
  for (const name of names) {
    assert.equal((await fs.stat(path.join(dir, name))).mode & 0o777, 0o600, name);
    assert.equal(await fs.readFile(path.join(dir, name), 'utf8'), 'existing-data');
  }
});
