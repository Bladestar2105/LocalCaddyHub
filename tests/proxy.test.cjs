const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const root = process.env.LCH_APP_ROOT || path.resolve(__dirname, '..');
const { generateCaddyfile } = require(path.join(root, 'src/caddy'));

async function listen(server, host = '127.0.0.1', port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server.address().port;
}
async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}
function stop(server) {
  server.closeAllConnections?.();
  return new Promise(resolve => server.close(resolve));
}
function request(port, pathname, options = {}) {
  const transport = options.tls ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request({ hostname: '127.0.0.1', port, path: pathname,
      method: options.method || 'GET', agent: options.agent,
      ...(options.tls || {}), headers: { Host: 'mail.example.test', ...options.headers } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(15000, () => req.destroy(new Error('Proxy request timed out')));
    req.on('error', reject);
    req.end(options.body);
  });
}
async function until(predicate, message, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  assert.fail(message);
}
function config(port, upstreamPort, overrides = {}) {
  return { general: { enabled: true, auto_https: 'off', log_level: 'INFO' },
    domains: [{ id: 'mail', enabled: true, fromDomain: 'mail.example.test', fromPort: String(port), disableTls: true }],
    subdomains: [], accessLists: [], basicAuths: [], headers: [], layer4: [],
    handlers: [{ id: 'pool', enabled: true, reverse: 'mail', handleType: 'handle', handlePath: '/*',
      handleDirective: 'reverse_proxy', toDomain: ['127.0.0.1', '[::1]'], toPort: String(upstreamPort),
      lb_policy: 'round_robin', ...overrides }] };
}
async function caddy(t, cfg, dir) {
  const binary = process.env.CADDY_BIN;
  assert.ok(binary, 'CADDY_BIN must point to the custom Caddy binary; this gate cannot run with a mock');
  const adminPort = await freePort();
  const file = path.join(dir, `Caddyfile-${adminPort}`);
  const content = generateCaddyfile(cfg, dir, path.join(dir, `logs-${adminPort}`))
    .replace('{\n', `{\n\tadmin 127.0.0.1:${adminPort}\n`);
  fs.writeFileSync(file, content);
  const env = { ...process.env, XDG_DATA_HOME: path.join(dir, 'storage'), XDG_CONFIG_HOME: path.join(dir, 'config') };
  try { execFileSync(binary, ['validate', '--config', file, '--adapter', 'caddyfile'], { env, stdio: 'pipe' }); }
  catch (err) { throw new Error(`${err.stderr}\nGenerated config:\n${content}`); }
  const child = spawn(binary, ['run', '--config', file, '--adapter', 'caddyfile'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  t.after(async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const forced = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { await exited; } finally { clearTimeout(forced); }
  });
  await until(async () => {
    if (child.exitCode !== null) assert.fail(`Caddy exited: ${output}`);
    try { return (await fetch(`http://127.0.0.1:${adminPort}/config/`, { headers: { Origin: `http://127.0.0.1:${adminPort}` } })).ok; } catch { return false; }
  }, `Caddy did not start: ${output}`);
  return { adminPort, file, child };
}
function temporaryDirectory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lch proxy-'));
  t.after(() => { if (process.env.LCH_KEEP_PROXY_LOGS !== '1') fs.rmSync(dir, { recursive: true, force: true }); else console.error(`Proxy logs retained: ${dir}`); });
  return dir;
}
function ntlmToken(type, user) {
  const signature = Buffer.alloc(12); signature.write('NTLMSSP\0'); signature.writeUInt32LE(type, 8);
  return 'NTLM ' + Buffer.concat([signature, Buffer.from(user)]).toString('base64');
}

test('proxy: NTLM handshake stays on one backend socket with separate concurrent clients', { timeout: 20000 }, async t => {
  const dir = temporaryDirectory(t);
  let socketCounter = 0;
  const makeBackend = label => http.createServer((req, res) => {
    req.socket.socketId ||= `${label}-${++socketCounter}`;
    res.setHeader('X-Backend', label); res.setHeader('X-Socket', req.socket.socketId);
    const token = Buffer.from((req.headers.authorization || '').replace(/^NTLM /, ''), 'base64');
    const type = token.length >= 12 ? token.readUInt32LE(8) : 0;
    const user = token.subarray(12).toString();
    if (type === 1) { req.socket.user = user; res.writeHead(401, { 'WWW-Authenticate': ntlmToken(2, user) }); res.end('challenge'); }
    else if (type === 3 && req.socket.user === user) { res.end(user); }
    else { res.writeHead(401, { 'WWW-Authenticate': 'NTLM' }); res.end('unauthorized'); }
  });
  const first = makeBackend('one'), second = makeBackend('two');
  const backendPort = await listen(first, '127.0.0.1');
  await listen(second, '::1', backendPort);
  t.after(() => Promise.all([stop(first), stop(second)]));
  const port = await freePort();
  await caddy(t, config(port, backendPort, { ntlm: true }), dir);
  const handshake = async user => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const unauthenticated = await request(port, '/mapi/emsmdb', { agent });
      assert.equal(unauthenticated.status, 401);
      const challenge = await request(port, '/mapi/emsmdb', { agent, headers: { Authorization: ntlmToken(1, user) } });
      assert.equal(challenge.status, 401);
      const authenticated = await request(port, '/mapi/emsmdb', { agent, headers: { Authorization: ntlmToken(3, user) } });
      assert.equal(authenticated.status, 200, `Type3 reached ${authenticated.headers['x-socket']} after Type1 used ${challenge.headers['x-socket']}`);
      assert.equal(authenticated.headers['x-socket'], challenge.headers['x-socket']);
      assert.equal(authenticated.body, user);
      return authenticated.headers['x-socket'];
    } finally { agent.destroy(); }
  };
  await handshake('single-user');
  const sockets = await Promise.all([handshake('alice'), handshake('bob'), handshake('carol')]);
  assert.equal(new Set(sockets).size, 3, 'Concurrent users must never share NTLM authentication contexts');
});


test('proxy: Coraza forwards normal traffic and blocks SQL injection and XSS', { timeout: 20000 }, async t => {
  const dir = temporaryDirectory(t);
  let forwarded = 0;
  const backend = http.createServer((req, res) => { forwarded++; res.end('normal upstream response'); });
  const backendPort = await listen(backend);
  t.after(() => stop(backend));
  const port = await freePort();
  const cfg = config(port, backendPort, { waf_enabled: true, toDomain: ['127.0.0.1'] });
  await caddy(t, cfg, dir);
  const normal = await request(port, '/owa/?q=meeting');
  assert.equal(normal.status, 200); assert.equal(normal.body, 'normal upstream response');
  const baseline = forwarded;
  const injection = await request(port, '/owa/?id=' + encodeURIComponent("1' OR '1'='1 --"));
  assert.equal(injection.status, 403);
  const xss = await request(port, '/owa/?q=' + encodeURIComponent('<script>alert(document.cookie)</script>'));
  assert.equal(xss.status, 403);
  assert.equal(forwarded, baseline, 'Blocked requests must never reach Exchange-like backends');
});

function certificates(dir) {
  const run = args => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=LocalCaddyHub test CA', '-keyout', 'ca.key', '-out', 'ca.pem']);
  run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=mail.example.test', '-keyout', 'mail.key', '-out', 'mail.csr']);
  fs.writeFileSync(path.join(dir, 'server.ext'), 'subjectAltName=DNS:mail.example.test\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n');
  run(['x509', '-req', '-days', '2', '-in', 'mail.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-extfile', 'server.ext', '-out', 'mail.pem']);
  return { key: fs.readFileSync(path.join(dir, 'mail.key')), cert: fs.readFileSync(path.join(dir, 'mail.pem')), ca: fs.readFileSync(path.join(dir, 'ca.pem')) };
}

test('proxy: verified HTTPS bridging preserves Exchange-like paths, headers, POST bodies and long polls', { timeout: 20000 }, async t => {
  const dir = temporaryDirectory(t);
  const cert = certificates(dir);
  const backend = https.createServer(cert, async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    if (req.url.includes('longpoll')) await new Promise(resolve => setTimeout(resolve, 120));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ method: req.method, url: req.url, body, host: req.headers.host,
      authorization: req.headers.authorization, trace: req.headers['x-test-trace'],
      forwardedProto: req.headers['x-forwarded-proto'], sni: req.socket.servername }));
  });
  const backendPort = await listen(backend);
  t.after(() => stop(backend));
  const port = await freePort();
  const cfg = config(port, backendPort, { handlePath: '/EWS/*', toDomain: ['127.0.0.1'], httpTls: true,
    http_tls_server_name: 'mail.example.test', http_tls_trusted_ca_certs: 'ca.pem', header: ['public-host'] });
  cfg.domains[0] = { ...cfg.domains[0], disableTls: false, customCert: 'mail.pem' };
  cfg.headers = [{ id: 'public-host', headerUpDown: 'header_up', headerType: 'Host', headerValue: '{http.request.host}' }];
  cfg.handlers.push({ ...cfg.handlers[0], id: 'untrusted', handlePath: '/untrusted/*', http_tls_trusted_ca_certs: '' });
  cfg.handlers.push({ ...cfg.handlers[0], id: 'wrong-sni', handlePath: '/wrong-sni/*', http_tls_server_name: 'wrong.example.test' });
  await caddy(t, cfg, dir);
  const tls = { ca: cert.ca, servername: 'mail.example.test' };
  const body = '<soap:Envelope>' + 'exchange-body-'.repeat(5000) + '</soap:Envelope>';
  const response = await request(port, '/EWS/Exchange.asmx?trace=abc', { tls, method: 'POST', body,
    headers: { 'Content-Type': 'text/xml', Authorization: 'Negotiate client-auth-context', 'X-Test-Trace': 'preserved' } });
  assert.equal(response.status, 200);
  const observed = JSON.parse(response.body);
  assert.deepEqual(observed, { method: 'POST', url: '/EWS/Exchange.asmx?trace=abc', body, host: 'mail.example.test',
    authorization: 'Negotiate client-auth-context', trace: 'preserved', forwardedProto: 'https', sni: 'mail.example.test' });
  const longPoll = await request(port, '/EWS/longpoll?keep=1', { tls });
  assert.equal(longPoll.status, 200);
  assert.equal(JSON.parse(longPoll.body).url, '/EWS/longpoll?keep=1');
  assert.equal((await request(port, '/untrusted/Exchange.asmx', { tls })).status, 502, 'Untrusted backend certificates must fail closed');
  assert.equal((await request(port, '/wrong-sni/Exchange.asmx', { tls })).status, 502, 'Backend certificate names must be verified');
});

test('proxy: per-service health isolates a failed virtual directory and survives a backend TCP failure', { timeout: 20000 }, async t => {
  const dir = temporaryDirectory(t);
  const health = [{ owa: true, mapi: true }, { owa: true, mapi: true }];
  const makeBackend = index => http.createServer((req, res) => {
    const service = req.url.toLowerCase().split('/')[1];
    res.setHeader('X-Backend', String(index));
    if (req.url.endsWith('/healthcheck.htm')) { res.statusCode = health[index][service] ? 200 : 503; res.end(); return; }
    res.end(JSON.stringify({ index, url: req.url }));
  });
  const first = makeBackend(0), second = makeBackend(1);
  const backendPort = await listen(first, '127.0.0.1');
  await listen(second, '::1', backendPort);
  t.after(() => Promise.all([stop(first), stop(second)]));
  const port = await freePort();
  const cfg = config(port, backendPort, { id: 'owa', handlePath: '/owa/*', health_uri: '/owa/healthcheck.htm',
    health_interval: '100ms', health_timeout: '100ms', health_status: '200', health_fails: 1, health_passes: 1,
    lb_try_duration: '500ms', lb_try_interval: '20ms', passive_health_fail_duration: '1s', passive_health_max_fails: 1 });
  cfg.handlers.push({ ...cfg.handlers[0], id: 'mapi', handlePath: '/mapi/*', health_uri: '/mapi/healthcheck.htm' });
  await caddy(t, cfg, dir);
  const sample = pathname => Promise.all(Array.from({ length: 8 }, () => request(port, pathname)));
  await until(async () => new Set((await sample('/owa/inbox')).map(res => res.headers['x-backend'])).size === 2, 'Both healthy backends should receive traffic');
  health[0].owa = false;
  await until(async () => (await sample('/owa/inbox')).every(res => res.status === 200 && res.headers['x-backend'] === '1'), 'Unhealthy OWA member was not removed');
  assert.equal(new Set((await sample('/mapi/emsmdb')).map(res => res.headers['x-backend'])).size, 2, 'An OWA failure must not remove healthy MAPI on that server');
  await stop(first);
  await until(async () => (await sample('/mapi/emsmdb')).every(res => res.status === 200 && res.headers['x-backend'] === '1'), 'Pool did not survive a TCP backend failure');
  const preserved = await request(port, '/mapi/emsmdb?MailboxId=abc');
  assert.equal(JSON.parse(preserved.body).url, '/mapi/emsmdb?MailboxId=abc');
});


test('proxy: Exchange virtual-directory bare, descendant and case variants preserve their full paths', { timeout: 20000 }, async t => {
  const dir = temporaryDirectory(t);
  const backend = http.createServer((req, res) => res.end(JSON.stringify({ url: req.url })));
  const backendPort = await listen(backend);
  t.after(() => stop(backend));
  const port = await freePort();
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'examples/exchange-dag.json'), 'utf8'));
  cfg.domains[0] = { ...cfg.domains[0], fromDomain: 'mail.example.test', additionalHosts: [],
    fromPort: String(port), disableTls: true, customCert: '' };
  cfg.handlers = cfg.handlers.map(handler => ({ ...handler, toDomain: ['127.0.0.1'], toPort: String(backendPort),
    httpTls: false, http_tls_trusted_ca_certs: '', http_tls_server_name: '', health_interval: '100ms' }));
  const services = ['owa', 'ecp', 'EWS', 'mapi', 'Microsoft-Server-ActiveSync', 'OAB', 'Autodiscover'];
  await caddy(t, cfg, dir);
  for (const service of services) {
    for (const pathname of [`/${service}`, `/${service}/client?check=1`, `/${service.toUpperCase()}/client?check=2`]) {
      const response = await request(port, pathname);
      assert.equal(response.status, 200, pathname);
      assert.equal(JSON.parse(response.body).url, pathname, pathname);
    }
  }
});



// Node's HTTP parser rejects RPC_IN_DATA/OUT_DATA before a request handler runs.
// This length-delimited fixture accepts Exchange's methods without emulating IIS.
function rawBackend(handler) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let head = Buffer.alloc(0), headers, method, pathname, parts = [], size = 0, length = 0;
    socket.on('data', data => {
      if (!headers) {
        head = Buffer.concat([head, data]);
        const end = head.indexOf('\r\n\r\n'); if (end < 0) return;
        const lines = head.subarray(0, end).toString().split('\r\n');
        [method, pathname] = lines.shift().split(' ');
        headers = Object.fromEntries(lines.map(line => { const colon = line.indexOf(':'); return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]; }));
        length = Number(headers['content-length'] || 0);
        data = head.subarray(end + 4); head = Buffer.alloc(0);
      }
      parts.push(data); size += data.length;
      if (size < length) return;
      const body = Buffer.concat(parts);
      const response = JSON.stringify(handler({ method, url: pathname, headers, body }));
      socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(response)}\r\nConnection: keep-alive\r\n\r\n${response}`);
      headers = undefined; parts = []; size = 0;
    });
  });
  server.closeAllConnections = () => { for (const socket of sockets) socket.destroy(); };
  return server;
}

test('proxy: WAF allows Exchange binary MIME types, SOAP and large attachments without changing bytes', { timeout: 30000 }, async t => {
  const dir = temporaryDirectory(t);
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  const backend = rawBackend(req => ({ url: req.url, method: req.method, type: req.headers['content-type'], digest: digest(req.body) }));
  const backendPort = await listen(backend);
  t.after(() => stop(backend));
  const port = await freePort();
  await caddy(t, config(port, backendPort, { waf_enabled: true, waf_profile: 'exchange', toDomain: ['127.0.0.1'] }), dir);
  const requests = [
    ['/Microsoft-Server-ActiveSync?Cmd=Sync&User=alice&DeviceId=TEST123&DeviceType=Test', 'application/vnd.ms-sync.wbxml', Buffer.from([3,1,106,0,0x45,0x5c,0x03,0x31,0,1,1])],
    ['/mapi/emsmdb?MailboxId=alice@example.test', 'application/mapi-http', Buffer.from([0,0,0,0,4,0,0,0,0,0,0,0])],
    ['/EWS/Exchange.asmx', 'text/xml; charset=utf-8', Buffer.from('<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body/></soap:Envelope>')],
    ['/Autodiscover/Autodiscover.xml', 'text/xml; charset=utf-8', Buffer.from('<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/requestschema/2006"><Request><EMailAddress>alice@example.test</EMailAddress><AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a</AcceptableResponseSchema></Request></Autodiscover>')],
    ['/rpc/rpcproxy.dll', 'application/rpc', Buffer.from([5,0,11,3,16,0,0,0,16,0,0,0,1,0,0,0]), 'RPC_IN_DATA'],
    ['/rpc/rpcproxy.dll', 'application/rpc', Buffer.from([5,0,11,3,16,0,0,0,16,0,0,0,2,0,0,0]), 'RPC_OUT_DATA'],
    ['/EWS/Exchange.asmx', 'text/xml; charset=utf-8', Buffer.from('<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><soap:Body><m:CreateAttachment><m:ParentItemId Id="test-item"/><m:Attachments><t:FileAttachment><t:Name>attachment.bin</t:Name><t:Content>' + 'A'.repeat(15 * 1024 * 1024) + '</t:Content></t:FileAttachment></m:Attachments></m:CreateAttachment></soap:Body></soap:Envelope>')]
  ];
  for (const [pathname, type, body, method = 'POST'] of requests) {
    await t.test(`${method} ${type}: ${body.length} bytes`, async () => {
      const response = await request(port, pathname, { method, body, headers: { 'Content-Type': type } });
      assert.equal(response.status, 200, `${pathname} (${type}, ${body.length} bytes): ${response.body.slice(0,100)}`);
      const observed = JSON.parse(response.body);
      assert.equal(observed.url, pathname); assert.equal(observed.method, method); assert.equal(observed.type, type); assert.equal(observed.digest, digest(body));
    });
  }
});


test('proxy: Exchange WAF retains attack detection, narrow MIME exceptions and a configurable body cap', { timeout: 20000 }, async t => {
  const dir = temporaryDirectory(t);
  let forwarded = 0;
  const backend = http.createServer(async (req, res) => {
    for await (const part of req) {} forwarded++; res.end('accepted');
  });
  const backendPort = await listen(backend);
  t.after(() => stop(backend));
  const port = await freePort();
  await caddy(t, config(port, backendPort, { waf_enabled: true, waf_profile: 'exchange', waf_body_limit_mb: 1,
    toDomain: ['127.0.0.1'] }), dir);
  const small = await request(port, '/EWS/Exchange.asmx', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: '<Envelope/>' });
  assert.equal(small.status, 200);
  const baseline = forwarded;
  const tooLarge = await request(port, '/EWS/Exchange.asmx', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: '<Envelope>' + 'A'.repeat(2 * 1024 * 1024) + '</Envelope>' });
  assert.equal(tooLarge.status, 413);
  const wrongPath = await request(port, '/not-exchange', { method: 'POST', headers: { 'Content-Type': 'application/vnd.ms-sync.wbxml' }, body: Buffer.from([3,1,106,0,69,1]) });
  assert.equal(wrongPath.status, 403, 'Exchange MIME exceptions must not affect unrelated paths');
  for (const attack of ["1' OR '1'='1 --", '<script>alert(document.cookie)</script>']) {
    const response = await request(port, '/mapi/emsmdb?q=' + encodeURIComponent(attack), { method: 'POST',
      headers: { 'Content-Type': 'application/mapi-http' }, body: Buffer.from([0,0,0,0,4,0,0,0]) });
    assert.equal(response.status, 403, 'Allowed Exchange binary MIME types must not disable query attack detection');
  }
  assert.equal(forwarded, baseline, 'Rejected oversized bodies, unrelated MIME types and attacks must not reach the upstream');
});


test('proxy: Exchange attachment handling retains WAF metadata and namespace checks and rejects invalid base64', { timeout: 30000 }, async t => {
  const dir = temporaryDirectory(t);
  let forwarded = 0;
  const backend = http.createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    forwarded++; res.end(crypto.createHash('sha256').update(Buffer.concat(parts)).digest('hex'));
  });
  const backendPort = await listen(backend);
  t.after(() => stop(backend));
  const port = await freePort();
  await caddy(t, config(port, backendPort, { waf_enabled: true, waf_profile: 'exchange', toDomain: ['127.0.0.1'] }), dir);
  const envelope = value => '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"><s:Body>' + value + '</s:Body></s:Envelope>';
  const postXml = value => request(port, '/EWS/Exchange.asmx', { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8' }, body: value });
  const attachment = '<t:FileAttachment><t:Name>file.bin</t:Name><t:Content>' + 'A'.repeat(15 * 1024 * 1024) + '</t:Content></t:FileAttachment>';
  const mime = envelope('<m:CreateItem><m:Items><t:Message><t:MimeContent CharacterSet="UTF-8">' + Buffer.from('From: alice@example.test\r\nTo: bob@example.test\r\nSubject: test\r\n\r\nHello').toString('base64') + '</t:MimeContent></t:Message></m:Items></m:CreateItem>');
  const mimeResponse = await postXml(mime);
  assert.equal(mimeResponse.status, 200);
  assert.equal(mimeResponse.body, crypto.createHash('sha256').update(mime).digest('hex'), 'Documented MIME content must pass with unchanged transport bytes');
  const baseline = forwarded;
  for (const attack of ["1' OR '1'='1 --", '&lt;script&gt;alert(document.cookie)&lt;/script&gt;']) {
    const response = await postXml(envelope('<m:CreateAttachment><m:Attachments>' + attachment + '</m:Attachments><t:Subject>' + attack + '</t:Subject></m:CreateAttachment>'));
    assert.equal(response.status, 403, 'Metadata after a large attachment must still be inspected');
  }
  const negative = [
    ['attachment attributes remain inspected', envelope('<t:FileAttachment Name="&lt;script&gt;alert(document.cookie)&lt;/script&gt;"><t:Content>QUJD</t:Content></t:FileAttachment>'), 403],
    ['matching local names in a different namespace remain inspected', envelope('<evil:FileAttachment xmlns:evil="urn:untrusted"><evil:Content>&lt;script&gt;alert(document.cookie)&lt;/script&gt;</evil:Content></evil:FileAttachment>'), 403],
    ['Content outside FileAttachment remains ordinary inspected XML', envelope('<t:Body><t:Content>&lt;script&gt;alert(document.cookie)&lt;/script&gt;</t:Content></t:Body>'), 403],
    ['invalid attachment base64 fails closed', envelope('<t:FileAttachment><t:Content>not-valid-base64!</t:Content></t:FileAttachment>'), 400]
  ];
  for (const [name, body, status] of negative) {
    await t.test(name, async () => assert.equal((await postXml(body)).status, status));
  }
  assert.equal(forwarded, baseline, 'Rejected payloads must not reach Exchange-like backends');
});


test('proxy: actual API validation preserves SQLite and Caddyfile after real Caddy rejects raw and structured changes', { timeout: 20000 }, async t => {
  const binary = process.env.CADDY_BIN;
  assert.ok(binary, 'The API validation gate requires a real custom Caddy binary');
  const dir = temporaryDirectory(t), port = await freePort();
  const app = spawn(process.execPath, ['src/index.js'], { cwd: root,
    env: { ...process.env, PORT: String(port), LCH_DATA_DIR: dir, CADDY_AUTOSTART: '0', CADDY_BIN: binary,
      ADMIN_USER: 'bootstrap-api', ADMIN_PASS: 'bootstrap-api-secret', XDG_DATA_HOME: path.join(dir, 'storage'), XDG_CONFIG_HOME: path.join(dir, 'config') },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  app.stdout.on('data', data => { output += data; }); app.stderr.on('data', data => { output += data; });
  t.after(async () => {
    if (app.exitCode !== null) return;
    const exited = once(app, 'exit'); app.kill('SIGTERM');
    const forced = setTimeout(() => app.kill('SIGKILL'), 2000);
    try { await exited; } finally { clearTimeout(forced); }
  });
  const base = `http://127.0.0.1:${port}`;
  await until(async () => { if (app.exitCode !== null) assert.fail(output); try { return (await fetch(base + '/login.html')).ok; } catch { return false; } }, 'Actual API did not start');
  let cookie;
  const api = (endpoint, body) => fetch(base + endpoint, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(cookie ? { Cookie: cookie } : {}) } });
  const login = await api('/login', { username: 'bootstrap-api', password: 'bootstrap-api-secret' });
  assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
  const setup = await api('/api/setup', { newUsername: 'api-operator', newPassword: 'api-validation-secret' });
  assert.equal(setup.status, 200); cookie = setup.headers.get('set-cookie')?.split(';')[0] || cookie;
  const initial = await (await api('/api/config/structured')).json();
  const cfg = config(await freePort(), await freePort(), { toDomain: ['127.0.0.1'] });
  cfg.general = { ...initial.general, ...cfg.general };
  const saved = await api('/api/config/structured', cfg);
  assert.equal(saved.status, 200, await saved.text());
  const original = fs.readFileSync(path.join(dir, 'Caddyfile'), 'utf8');
  const Database = require(path.join(root, 'node_modules/better-sqlite3'));
  const db = new Database(path.join(dir, 'caddyhub.db'), { readonly: true });
  t.after(() => db.close());
  const snapshot = () => ['general_config', 'domains', 'subdomains', 'handlers', 'access_lists', 'basic_auths', 'headers', 'layer4']
    .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
  const records = snapshot();
  const invalidRaw = await api('/api/config', { content: '{\ninvalid_global_directive yes\n}\n' });
  assert.equal(invalidRaw.status, 400, await invalidRaw.text());
  assert.equal(fs.readFileSync(path.join(dir, 'Caddyfile'), 'utf8'), original);
  assert.deepEqual(snapshot(), records);
  cfg.general.http_versions = 'not-a-real-http-version';
  const invalidStructured = await api('/api/config/structured', cfg);
  assert.equal(invalidStructured.status, 400, await invalidStructured.text());
  assert.equal(fs.readFileSync(path.join(dir, 'Caddyfile'), 'utf8'), original);
  assert.deepEqual(snapshot(), records);
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.includes('candidate') || name.endsWith('.tmp')), []);
});


test('proxy: every selected Basic Auth user can independently access the same protected domain', { timeout: 20000 }, async t => {
  const dir = temporaryDirectory(t);
  const backend = http.createServer((req, res) => res.end('authenticated upstream'));
  const backendPort = await listen(backend);
  t.after(() => stop(backend));
  const port = await freePort();
  const cfg = config(port, backendPort, { toDomain: ['127.0.0.1'] });
  const bcrypt = require(path.join(root, 'node_modules/bcrypt'));
  cfg.domains[0].basicauth = ['alice', 'bob'];
  cfg.basicAuths = [
    { id: 'alice', basicauthuser: 'alice', basicauthpass: bcrypt.hashSync('alice-password', 4) },
    { id: 'bob', basicauthuser: 'bob', basicauthpass: bcrypt.hashSync('bob-password', 4) }
  ];
  await caddy(t, cfg, dir);
  assert.equal((await request(port, '/owa/')).status, 401);
  for (const [username, password] of [['alice', 'alice-password'], ['bob', 'bob-password']]) {
    const response = await request(port, '/owa/', { headers: { Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') } });
    assert.equal(response.status, 200, `${username} must not need another selected user's credentials`);
    assert.equal(response.body, 'authenticated upstream');
  }
  const denied = await request(port, '/owa/', { headers: { Authorization: 'Basic ' + Buffer.from('alice:incorrect').toString('base64') } });
  assert.equal(denied.status, 401);
});


test('proxy: reloading Caddy completes with an idle authenticated NTLM upstream socket', { timeout: 15000 }, async t => {
  const dir = temporaryDirectory(t);
  const backend = http.createServer((req, res) => {
    if (req.headers.authorization) req.socket.user = 'operator';
    res.end(req.socket.user || 'anonymous');
  });
  const backendPort = await listen(backend);
  t.after(() => stop(backend));
  const port = await freePort();
  const runtime = await caddy(t, config(port, backendPort, { ntlm: true, toDomain: ['127.0.0.1'] }), dir);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => agent.destroy());
  assert.equal((await request(port, '/mapi/emsmdb', { agent, headers: { Authorization: ntlmToken(3, 'operator') } })).status, 200);
  const content = fs.readFileSync(runtime.file, 'utf8').replace('level INFO', 'level WARN');
  const response = await fetch(`http://127.0.0.1:${runtime.adminPort}/load`, { method: 'POST',
    headers: { Origin: `http://127.0.0.1:${runtime.adminPort}`, 'Content-Type': 'text/caddyfile' },
    body: content, signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  const afterReload = await request(port, '/mapi/emsmdb', { agent, headers: { Authorization: ntlmToken(3, 'operator') } });
  assert.equal(afterReload.status, 200);
  assert.equal(afterReload.body, 'operator');
  assert.equal((await request(port, '/mapi/emsmdb', { agent: false })).body, 'anonymous');
});

for (const encrypted of [false, true]) test(`proxy: ${encrypted ? 'HTTPS bridge' : 'HTTP'} source-port reuse cannot inherit NTLM authentication`, { timeout: 15000 }, async t => {
  const dir = temporaryDirectory(t);
  const cert = encrypted ? certificates(dir) : undefined;
  const handler = (req, res) => {
    const token = Buffer.from((req.headers.authorization || '').replace(/^NTLM /, ''), 'base64');
    const type = token.length >= 12 ? token.readUInt32LE(8) : 0;
    const user = token.subarray(12).toString();
    if (type === 1) { req.socket.pendingUser = user; res.writeHead(401, { 'WWW-Authenticate': ntlmToken(2, user) }); res.end('challenge'); return; }
    if (type === 3 && req.socket.pendingUser === user) req.socket.user = user;
    res.setHeader('X-Upstream-SNI', req.socket.servername || '');
    res.end(req.socket.user || 'anonymous');
  };
  const backend = encrypted ? https.createServer(cert, handler) : http.createServer(handler);
  const backendPort = await listen(backend);
  t.after(() => stop(backend));
  const port = await freePort(), localPort = await freePort();
  const cfg = config(port, backendPort, { ntlm: true, toDomain: ['127.0.0.1'] });
  const tlsOptions = encrypted ? { ca: cert.ca, servername: 'mail.example.test' } : undefined;
  if (encrypted) {
    cfg.domains[0] = { ...cfg.domains[0], disableTls: false, customCert: 'mail.pem' };
    Object.assign(cfg.handlers[0], { httpTls: true, http_tls_server_name: 'mail.example.test', http_tls_trusted_ca_certs: 'ca.pem' });
  }
  await caddy(t, cfg, dir);
  let clientSocket;
  const agent = new (encrypted ? https.Agent : http.Agent)({ keepAlive: true, maxSockets: 1, localPort, ...tlsOptions });
  // Keep the underlying TCP socket so both HTTP and TLS can send an actual RST.
  agent.createConnection = options => {
    clientSocket = net.connect({ host: options.host, port: options.port, localPort });
    return encrypted ? tls.connect({ ...options, socket: clientSocket }) : clientSocket;
  };
  t.after(() => agent.destroy());
  const challenge = await request(port, '/mapi/emsmdb', { agent, tls: tlsOptions, headers: { Authorization: ntlmToken(1, 'alice') } });
  assert.equal(challenge.status, 401);
  const authenticated = await request(port, '/mapi/emsmdb', { agent, tls: tlsOptions, headers: { Authorization: ntlmToken(3, 'alice') } });
  assert.equal(authenticated.body, 'alice');
  if (encrypted) assert.equal(authenticated.headers['x-upstream-sni'], 'mail.example.test');
  assert.equal(clientSocket.localPort, localPort);
  const closed = once(clientSocket, 'close'); clientSocket.resetAndDestroy(); await closed;
  const replacement = new (encrypted ? https.Agent : http.Agent)({ keepAlive: true, maxSockets: 1, localPort, ...tlsOptions });
  t.after(() => replacement.destroy());
  const anonymous = await request(port, '/mapi/emsmdb', { agent: replacement, tls: tlsOptions });
  assert.equal(anonymous.body, 'anonymous', 'A new connection using the same source address must not receive the previous user context');
});
