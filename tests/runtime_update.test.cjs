const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync, spawn } = require('node:child_process');
const updateScript = path.resolve(__dirname, '../update.sh');
const realNode = process.execPath;

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lch-update-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const upstream = path.join(dir, 'upstream');
  const install = path.join(dir, 'install');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(upstream); fs.mkdirSync(bin);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  git(upstream, 'init', '-b', 'main');
  git(upstream, 'config', 'user.name', 'Runtime test');
  git(upstream, 'config', 'user.email', 'runtime@example.invalid');
  fs.mkdirSync(path.join(upstream, 'scripts'));
  fs.writeFileSync(path.join(upstream, '.gitignore'), 'node_modules/\ndata/\n');
  fs.writeFileSync(path.join(upstream, 'version'), 'old');
  const build = path.join(upstream, 'scripts/build-caddy.sh');
  fs.writeFileSync(build, `#!/bin/sh
cat > "$1" <<'CADDY'
#!/bin/sh
# new-caddy
if [ "$1" = environ ]; then printf 'caddy.AppDataDir=%s/caddy\\ncaddy.AppConfigDir=%s/caddy\\n' "$XDG_DATA_HOME" "$XDG_CONFIG_HOME"; fi
if [ "$1" = adapt ] && [ -f "$(dirname "$0")/invalid-config" ]; then exit 25; fi
exit 0
CADDY
chmod +x "$1"
if [ "$TEST_FAIL" = config ]; then touch "$(dirname "$1")/invalid-config"; fi
`); fs.chmodSync(build, 0o755);
  git(upstream, 'add', '.'); git(upstream, 'commit', '-m', 'old');
  git(dir, 'clone', upstream, install);
  const old = git(install, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(upstream, 'version'), 'new');
  git(upstream, 'commit', '-am', 'new');
  fs.mkdirSync(path.join(install, 'node_modules'));
  fs.writeFileSync(path.join(install, 'node_modules/version'), 'old-deps');
  fs.mkdirSync(path.join(install, 'data'));
  fs.writeFileSync(path.join(install, 'data/caddyhub.db'), 'old-database');
  const caddy = path.join(dir, 'caddy'); fs.writeFileSync(caddy, 'old-caddy');
  const log = path.join(dir, 'service.log');
  const unit = path.join(dir, 'unit.json');
  const runtime = { HOME: dir, PATH: process.env.PATH, XDG_DATA_HOME: path.join(dir, 'caddy-data'), XDG_CONFIG_HOME: path.join(dir, 'caddy-config') };
  fs.writeFileSync(unit, JSON.stringify({ runtime, properties: { MainPID: 0, RootDirectory: '', RootImage: '', DynamicUser: false,
    WorkingDirectory: install, User: '', Environment: [], EnvironmentFiles: [], PassEnvironment: [], UnsetEnvironment: [] } }));

  const stubs = {
    id: 'echo 0',
    npm: 'if [ "$1" = ci ]; then [ "$TEST_FAIL" != install ] || exit 23; mkdir -p node_modules; printf new-deps > node_modules/version; fi',
    go: 'if [ "$1" = env ]; then printf "%s\\n" "$TEST_TOOLS"; fi',
    systemctl: 'if [ \"$1\" = stop ] && [ \"$TEST_FAIL\" = stop-fail ]; then if [ -e \"$TEST_TOOLS/stopped-once\" ]; then exit 28; fi; touch \"$TEST_TOOLS/stopped-once\"; fi; if [ "$1" = is-active ] && [ "$TEST_FAIL" = inactive ]; then exit 3; fi; printf "%s\\n" "$*" >> "$TEST_LOG"; if [ "$1" = start ] && [ "$(cat "$LCH_INSTALL_DIR/version")" = new ]; then "$TEST_NODE" "$TEST_MUTATE"; fi',
    setcap: 'if [ "$TEST_FAIL" = activation ] && [ ! -e "$TEST_TOOLS/failed" ]; then touch "$TEST_TOOLS/failed"; exit 24; fi',
    curl: 'printf "%s\\n" "$*" >> "$TEST_TOOLS/curl.log"; if [ "$TEST_FAIL" = health ] || [ "$TEST_FAIL" = restore-fail ] || [ "$TEST_FAIL" = stop-fail ]; then exit 22; fi; if [ "$TEST_FAIL" = caddy-health ]; then case "$*" in *:2019*) exit 22 ;; esac; fi',
    tar: 'if [ \"$1\" = -xpf ] && [ \"$TEST_FAIL\" = restore-fail ]; then exit 29; fi; exec /usr/bin/tar \"$@\"',
    seq: 'echo 1', sleep: ':'
  };
  for (const [name, body] of Object.entries(stubs)) {
    const file = path.join(bin, name); fs.writeFileSync(file, '#!/bin/sh\n' + body + '\n'); fs.chmodSync(file, 0o755);
  }
  fs.writeFileSync(path.join(bin, 'busctl'), '#!' + realNode + '\nconst fs=require("fs");const unit=JSON.parse(fs.readFileSync(process.env.TEST_UNIT));if(process.env.TEST_FAIL==="resolve")process.exit(1);const key=process.argv.at(-1);console.log(JSON.stringify({type:"test",data:unit.properties[key]}));\n'); fs.chmodSync(path.join(bin, 'busctl'), 0o755);
  fs.writeFileSync(path.join(bin, 'systemd-run'), '#!' + realNode + '\nconst fs=require("fs"),cp=require("child_process");fs.writeFileSync(process.env.TEST_TOOLS+"/resolver-args.json",JSON.stringify(process.argv));const unit=JSON.parse(fs.readFileSync(process.env.TEST_UNIT));process.stdout.write(cp.execFileSync(process.execPath,process.argv.slice(-2),{env:unit.runtime}));\n'); fs.chmodSync(path.join(bin, 'systemd-run'), 0o755);
  const mutate = path.join(dir, 'mutate.cjs');
  fs.writeFileSync(mutate, `const fs=require('fs'),path=require('path');const env=JSON.parse(fs.readFileSync(process.env.TEST_UNIT)).runtime;const base=env.LCH_DATA_DIR||path.join(process.env.LCH_INSTALL_DIR,'data');fs.writeFileSync(path.join(base,'caddyhub.db'),'migrated');fs.writeFileSync(path.join(base,'caddyhub.db-wal'),'new-wal');for(const item of [path.join(base,'Caddyfile'),path.join(base,'config.json'),path.join(base,'certs/key.key'),path.join(env.XDG_DATA_HOME,'caddy/certificate.key'),path.join(env.XDG_CONFIG_HOME,'caddy/autosave.json')]){fs.mkdirSync(path.dirname(item),{recursive:true});fs.writeFileSync(item,'new-state');}`);
  const run = failure => spawnSync('bash', [updateScript], { encoding: 'utf8', env: { ...process.env,
    PATH: bin + ':' + process.env.PATH, LCH_INSTALL_DIR: install, LCH_CADDY_BIN: caddy,
    TEST_FAIL: failure, TEST_TOOLS: dir, TEST_LOG: log, TEST_UNIT: unit, TEST_NODE: realNode, TEST_MUTATE: mutate } });
  return {dir, install, caddy, old, git, run, unit, runtime, setRuntime: env => { const u=JSON.parse(fs.readFileSync(unit));u.runtime={...runtime,...env};u.properties.Environment=Object.entries(env).map(([k,v])=>k+'='+v);fs.writeFileSync(unit,JSON.stringify(u)); }, serviceLog: () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''};
}

test('update dependency failure leaves the existing service and checkout untouched', t => {
  const f = fixture(t); const result = f.run('install');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.serviceLog(), '');
  assert.equal(f.git(f.install, 'rev-parse', 'HEAD'), f.old);
  assert.equal(fs.readFileSync(f.caddy, 'utf8'), 'old-caddy');
});

test('failed activation restores old source, dependencies and binary and restarts service', t => {
  const f = fixture(t); const result = f.run('activation');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.git(f.install, 'rev-parse', 'HEAD'), f.old);
  assert.equal(fs.readFileSync(path.join(f.install, 'node_modules/version'), 'utf8'), 'old-deps');
  assert.equal(fs.readFileSync(f.caddy, 'utf8'), 'old-caddy');
  assert.match(f.serviceLog(), /stop localcaddyhub/);
  assert.match(f.serviceLog(), /start localcaddyhub/);
});

test('failed health check restores the pre-migration database', t => {
  const f = fixture(t); const result = f.run('health');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.git(f.install, 'rev-parse', 'HEAD'), f.old);
  assert.equal(fs.readFileSync(path.join(f.install, 'data/caddyhub.db'), 'utf8'), 'old-database');
  assert.equal(fs.existsSync(path.join(f.install, 'data/caddyhub.db-wal')), false, 'A failed revision must not leave a newer WAL beside the restored database');
  const backup = fs.readdirSync(f.dir).find(name => name.startsWith('install.backup.'));
  const saved = execFileSync('tar', ['-xOf', path.join(f.dir, backup, 'state.tar'), fs.realpathSync(path.join(f.install, 'data/caddyhub.db')).slice(1)], {encoding: 'utf8'});
  assert.equal(saved, 'old-database');
  assert.match(result.stderr, /restoring previous revision/);
});

test('successful update activates the tested revision and retains a private backup', t => {
  const f = fixture(t); const result = f.run('');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(f.install, 'version'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(f.install, 'node_modules/version'), 'utf8'), 'new-deps');
  assert.match(fs.readFileSync(f.caddy, 'utf8'), /# new-caddy/);
  const backup = fs.readdirSync(f.dir).find(name => name.startsWith('install.backup.'));
  assert.ok(backup);
  assert.equal(fs.statSync(path.join(f.dir, backup)).mode & 0o777, 0o700);
});


test('update preserves an inactive service and refuses local source edits', t => {
  const f = fixture(t); const result = f.run('inactive');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(f.serviceLog(), /start localcaddyhub/);
  fs.writeFileSync(path.join(f.install, 'version'), 'local edit');
  const dirty = f.run('');
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /Commit or stash local source changes/);
  assert.equal(fs.readFileSync(path.join(f.install, 'version'), 'utf8'), 'local edit');
});


test('update rejects incompatible Caddy configuration before stopping the existing service', t => {
  const f = fixture(t); const result = f.run('config');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.serviceLog(), '');
  assert.equal(f.git(f.install, 'rev-parse', 'HEAD'), f.old);
});

test('update rolls back when Node starts but Caddy does not', t => {
  const f = fixture(t); const result = f.run('caddy-health');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.git(f.install, 'rev-parse', 'HEAD'), f.old);
  assert.equal(fs.readFileSync(path.join(f.install, 'data/caddyhub.db'), 'utf8'), 'old-database');
  assert.match(result.stderr, /restoring previous revision/);
});


test('failed update restores external service-only app state and Caddy storage and uses the service port', t => {
  const f = fixture(t), external = path.join(f.dir, 'external data');
  fs.mkdirSync(external);
  f.setRuntime({ LCH_DATA_DIR: external, PORT: '9843', ADMIN_PASS: 'must-not-appear-in-output' });
  const originals = [path.join(external, 'caddyhub.db'), path.join(external, 'Caddyfile'), path.join(external, 'config.json'),
    path.join(external, 'certs/key.key'), path.join(f.runtime.XDG_DATA_HOME, 'caddy/certificate.key'), path.join(f.runtime.XDG_CONFIG_HOME, 'caddy/autosave.json')];
  for (const file of originals) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'old-state'); }
  const result = f.run('health');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  for (const file of originals) assert.equal(fs.readFileSync(file, 'utf8'), 'old-state', file);
  assert.equal(fs.existsSync(path.join(external, 'caddyhub.db-wal')), false);
  assert.doesNotMatch(result.stdout + result.stderr + fs.readFileSync(path.join(f.dir, 'resolver-args.json'), 'utf8'), /must-not-appear/);
  assert.match(fs.readFileSync(path.join(f.dir, 'curl.log'), 'utf8'), /127\.0\.0\.1:9843\/login\.html/);
  assert.equal(f.git(f.install, 'rev-parse', 'HEAD'), f.old);
});

test('an unresolved service environment aborts before stopping or changing state', t => {
  const f = fixture(t), result = f.run('resolve');
  assert.notEqual(result.status, 0);
  assert.equal(f.serviceLog(), '');
  assert.equal(f.git(f.install, 'rev-parse', 'HEAD'), f.old);
});


test('service EnvironmentFiles are delegated to systemd without evaluating or exposing secrets', t => {
  const f = fixture(t), external = path.join(f.dir, 'file state');
  fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'caddyhub.db'), 'original');
  f.setRuntime({ LCH_DATA_DIR: external, PORT: '9844', ADMIN_PASS: 'file-secret-$(touch forbidden)' });
  const file = path.join(f.dir, 'service environment');
  fs.writeFileSync(file, `LCH_DATA_DIR="${external}"\nPORT=9844\nADMIN_PASS='file-secret-$(touch forbidden)'\n`);
  const unit = JSON.parse(fs.readFileSync(f.unit));
  unit.properties.Environment = [];
  unit.properties.EnvironmentFiles = [[file, false]];
  fs.writeFileSync(f.unit, JSON.stringify(unit));
  const result = f.run('health');
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(external, 'caddyhub.db'), 'utf8'), 'original');
  const args = JSON.parse(fs.readFileSync(path.join(f.dir, 'resolver-args.json'), 'utf8'));
  assert.ok(args.includes('--property=EnvironmentFile=' + JSON.stringify(file)));
  assert.doesNotMatch(result.stdout + result.stderr + JSON.stringify(args), /file-secret/);
  assert.equal(fs.existsSync(path.join(f.install, 'forbidden')), false);
  assert.match(fs.readFileSync(path.join(f.dir, 'curl.log'), 'utf8'), /127\.0\.0\.1:9844\/login\.html/);
});


if (process.platform === 'linux') test('an active service uses its actual process environment for external state and port', async t => {
  const f = fixture(t), external = path.join(f.dir, 'running state');
  fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'caddyhub.db'), 'original');
  f.setRuntime({ LCH_DATA_DIR: external, PORT: '9845' });
  const unit = JSON.parse(fs.readFileSync(f.unit));
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: f.install, env: unit.runtime, stdio: 'ignore' });
  t.after(() => child.kill('SIGTERM'));
  await new Promise(resolve => child.once('spawn', resolve));
  unit.properties.MainPID = child.pid;
  fs.writeFileSync(f.unit, JSON.stringify(unit));
  const result = f.run('health');
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(external, 'caddyhub.db'), 'utf8'), 'original');
  assert.match(fs.readFileSync(path.join(f.dir, 'curl.log'), 'utf8'), /127\.0\.0\.1:9845\/login\.html/);
  assert.ok(fs.existsSync(path.join(f.dir, 'resolver-args.json')));
});


if (process.platform === 'linux') test('changed unit storage is rejected before stop while an older service environment is still running', async t => {
  const f = fixture(t), original = path.join(f.dir, 'old state'), upcoming = path.join(f.dir, 'new state');
  for (const dir of [original, upcoming]) { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'caddyhub.db'), 'original'); }
  f.setRuntime({ LCH_DATA_DIR: original });
  const unit = JSON.parse(fs.readFileSync(f.unit));
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: f.install, env: unit.runtime, stdio: 'ignore' });
  t.after(() => child.kill('SIGTERM'));
  await new Promise(resolve => child.once('spawn', resolve));
  unit.properties.MainPID = child.pid;
  unit.runtime.LCH_DATA_DIR = upcoming;
  fs.writeFileSync(f.unit, JSON.stringify(unit));
  const result = f.run('health');
  assert.notEqual(result.status, 0);
  assert.equal(f.serviceLog(), '');
  for (const dir of [original, upcoming]) assert.equal(fs.readFileSync(path.join(dir, 'caddyhub.db'), 'utf8'), 'original');
});


test('an incomplete rollback retains its backup and does not restart against unrestored state', t => {
  const f = fixture(t), result = f.run('restore-fail');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Rollback incomplete; service left stopped/);
  assert.equal((f.serviceLog().match(/^start localcaddyhub$/gm) || []).length, 1);
  const backup = fs.readdirSync(f.dir).find(name => name.startsWith('install.backup.'));
  assert.ok(fs.existsSync(path.join(f.dir, backup, 'state.tar')));
});


test('rollback never overwrites state while the failed service cannot be stopped', t => {
  const f = fixture(t), result = f.run('stop-fail');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot stop the failed service/);
  assert.equal(fs.readFileSync(path.join(f.install, 'data/caddyhub.db'), 'utf8'), 'migrated');
  assert.equal(fs.readFileSync(path.join(f.install, 'version'), 'utf8'), 'new');
  const backup = fs.readdirSync(f.dir).find(name => name.startsWith('install.backup.'));
  assert.ok(fs.existsSync(path.join(f.dir, backup, 'state.tar')));
});
