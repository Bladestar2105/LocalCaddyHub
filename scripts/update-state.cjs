const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const keys = ['LCH_DATA_DIR', 'PORT', 'HOME', 'PATH', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'CADDY_BIN'];
const filtered = env => Object.fromEntries(keys.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}
function property(name) {
  return JSON.parse(run('busctl', ['--system', '--json=short', 'get-property', 'org.freedesktop.systemd1',
    '/org/freedesktop/systemd1/unit/localcaddyhub_2eservice', 'org.freedesktop.systemd1.Service', name])).data;
}
function environment() {
  const pid = property('MainPID');
  if (pid) {
    const entries = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean);
    const env = filtered(Object.fromEntries(entries.map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; })));
    const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    if (property('MainPID') !== pid) throw new Error('Service changed during state resolution');
    return { env, cwd, pid };
  }
  return configuredEnvironment();
}
function configuredEnvironment() {
  // Let systemd parse its own EnvironmentFiles, including quoting, ordering and unsets.
  // The transient process prints only path/port settings, never bootstrap secrets.
  if (property('RootDirectory') || property('RootImage') || property('DynamicUser')) throw new Error('Cannot resolve inactive remapped/dynamic service');
  const cwd = property('WorkingDirectory') || '/';
  const args = ['--system', '--quiet', '--wait', '--pipe', '--collect', '--service-type=exec',
    `--property=WorkingDirectory=${cwd}`];
  const user = property('User');
  if (user) args.push(`--property=User=${user}`);
  for (const value of property('Environment')) if (keys.includes(value.split('=')[0])) args.push(`--setenv=${value}`);
  for (const name of ['EnvironmentFiles', 'PassEnvironment', 'UnsetEnvironment']) {
    const values = property(name).filter(value => name === 'EnvironmentFiles' || keys.includes(value.split('=')[0]));
    if (values.length) args.push(`--property=${name === 'EnvironmentFiles' ? 'EnvironmentFile' : name}=${values.map(value =>
      JSON.stringify(Array.isArray(value) ? `${value[1] ? '-' : ''}${value[0]}` : value)).join(' ')}`);
  }
  const code = `const keys=${JSON.stringify(keys)};console.log(JSON.stringify({cwd:process.cwd(),env:Object.fromEntries(keys.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]))}))`;
  const resolved = JSON.parse(run('systemd-run', [...args, process.execPath, '-e', code]));
  return { env: filtered(resolved.env), cwd: resolved.cwd, pid: 0 };
}
function canonical(filename) {
  if (fs.existsSync(filename)) return fs.realpathSync(filename);
  const parent = path.dirname(filename);
  if (parent === filename) return filename;
  return path.join(canonical(parent), path.basename(filename));
}
function resolveRuntime(state, install, binary, fallbackBinary) {
  const base = state.env.LCH_DATA_DIR ? path.resolve(state.cwd, state.env.LCH_DATA_DIR) : path.join(install, 'data');
  const legacy = !state.env.LCH_DATA_DIR && fs.existsSync(path.join(install, 'caddyhub.db'));
  const app = legacy ? install : base;
  state.config = path.join(app, 'Caddyfile');
  state.port = state.env.PORT || '8090';
  if (!/^\d+$/.test(state.port) || Number(state.port) < 1 || Number(state.port) > 65535) throw new Error('Invalid service PORT');
  state.binary = state.env.CADDY_BIN || fallbackBinary;
  if (!path.isAbsolute(state.binary)) throw new Error('Service CADDY_BIN must be an absolute path for updating');
  const caddyEnv = run(binary, ['environ'], { cwd: state.cwd, env: state.env });
  const caddyDir = key => {
    const match = caddyEnv.match(new RegExp(`^caddy\\.${key}=(.+)$`, 'm'));
    if (!match || !path.isAbsolute(match[1])) throw new Error('Cannot resolve Caddy storage');
    return match[1];
  };
  const db = path.join(app, 'caddyhub.db');
  state.targets = [canonical(db) + '-wal', canonical(db) + '-shm', path.join(app, 'caddyhub.db'), path.join(app, 'caddyhub.db-wal'), path.join(app, 'caddyhub.db-shm'),
    state.config, path.join(app, 'config.json'), path.join(app, 'certs'), caddyDir('AppDataDir'), caddyDir('AppConfigDir')].flatMap(target => {
    const nominal = path.join(canonical(path.dirname(target)), path.basename(target));
    return fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink() ? [nominal, canonical(target)] : [nominal];
  });
  state.targets = [...new Set(state.targets)].filter(target => !state.targets.some(other => other !== target && target.startsWith(other + path.sep)));
  if (state.targets.some(target => target === path.parse(target).root || target === canonical(install) || canonical(install).startsWith(target + path.sep))) throw new Error('Unsafe state root');
  if (state.pid) {
    // Reject private mount views that cannot be restored through their host paths.
    for (const target of state.targets) {
      let existing = target;
      while (!fs.existsSync(existing)) existing = path.dirname(existing);
      const host = fs.statSync(existing), service = fs.statSync(`/proc/${state.pid}/root${existing}`);
      if (host.dev !== service.dev || host.ino !== service.ino) throw new Error('Service storage is not visible at its host path');
    }
  }
  return state;
}
function resolveState(install, binary, fallbackBinary) {
  const state = resolveRuntime(environment(), install, binary, fallbackBinary);
  if (state.pid) {
    const upcoming = resolveRuntime(configuredEnvironment(), install, binary, fallbackBinary);
    if (JSON.stringify([state.targets, state.port, state.binary]) !== JSON.stringify([upcoming.targets, upcoming.port, upcoming.binary])) {
      throw new Error('Running and configured service state differ; align them before updating');
    }
  }
  return state;
}
function snapshot(state, backup) {
  const existing = state.targets.filter(target => fs.existsSync(target));
  // Absolute targets become relative archive entries, extracted only below /.
  const list = path.join(backup, 'state-files');
  fs.writeFileSync(list, existing.map(target => target.slice(1)).join('\0') + (existing.length ? '\0' : ''), { mode: 0o600 });
  run('tar', ['-cpf', path.join(backup, 'state.tar'), '-C', '/', '--null', '-T', list]);
}
function restore(state, backup) {
  run('tar', ['-tf', path.join(backup, 'state.tar')]);
  for (const target of state.targets) fs.rmSync(target, { recursive: true, force: true });
  run('tar', ['-xpf', path.join(backup, 'state.tar'), '-C', '/']);
}

try {
  const [action, file, ...args] = process.argv.slice(2);
  if (action === 'resolve') fs.writeFileSync(file, JSON.stringify(resolveState(...args)), { mode: 0o600 });
  else {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (action === 'snapshot') snapshot(state, args[0]);
    else if (action === 'restore') restore(state, args[0]);
    else if (action === 'get') process.stdout.write(state[args[0]]);
    else if (action === 'adapt') run(args[0], ['adapt', '--config', state.config, '--adapter', 'caddyfile'], { cwd: state.cwd, env: state.env });
    else throw new Error('Unknown update state operation');
  }
} catch {
  console.error('Could not resolve or preserve the service runtime state; update aborted. No environment values were logged.');
  process.exitCode = 1;
}
