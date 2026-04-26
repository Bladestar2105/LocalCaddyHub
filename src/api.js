const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const db = require('./db');
const { parseJSON } = require('./utils');
const { generateCaddyfile } = require('./caddy');
const appPaths = require('./paths');

const router = express.Router();

const certDir = appPaths.certsDir;

const upload = multer({ dest: certDir, limits: { fileSize: 10 * 1024 * 1024 } });

// /api/config
router.get('/config', async (req, res) => {
  try {
    const caddyfilePath = appPaths.caddyfile;
    let content = '';
    if (fs.existsSync(caddyfilePath)) {
      content = await fs.promises.readFile(caddyfilePath, 'utf-8');
    }
    res.json({ content });
  } catch (err) {
    res.status(500).send('Failed to read Caddyfile');
  }
});

router.post('/config', express.json(), async (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).send('Invalid request body');
    const caddyfilePath = appPaths.caddyfile;
    await fs.promises.writeFile(caddyfilePath, content, 'utf-8');
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send('Failed to write Caddyfile');
  }
});

// ⚡ Bolt: Cache prepared SQL statements at module level to eliminate parsing overhead on every request
const getGeneralStmt = db.prepare('SELECT * FROM general_config WHERE id = 1');
const getDomainsStmt = db.prepare('SELECT * FROM domains');
const getSubdomainsStmt = db.prepare('SELECT * FROM subdomains');
const getHandlersStmt = db.prepare('SELECT * FROM handlers');
const getAccessListsStmt = db.prepare('SELECT * FROM access_lists');
const getBasicAuthsStmt = db.prepare('SELECT * FROM basic_auths');
const getHeadersStmt = db.prepare('SELECT * FROM headers');
const getLayer4Stmt = db.prepare('SELECT * FROM layer4');

// /api/config/structured
router.get('/config/structured', (req, res) => {
  try {
    const general = getGeneralStmt.get() || { enabled: 0, enable_layer4: 0, http_port: '80', https_port: '443', log_level: 'INFO' };

    const domainsRows = getDomainsStmt.all();
    const subdomainsRows = getSubdomainsStmt.all();
    const handlersRows = getHandlersStmt.all();
    const accessListsRows = getAccessListsStmt.all();
    const basicAuthsRows = getBasicAuthsStmt.all();
    const headersRows = getHeadersStmt.all();
    const layer4Rows = getLayer4Stmt.all();

    const config = {
      general: {
        enabled: Boolean(general.enabled),
        enable_layer4: Boolean(general.enable_layer4),
        http_port: general.http_port || '',
        https_port: general.https_port || '',
        log_level: general.log_level || '',
        tls_email: general.tls_email || '',
        http_versions: general.http_versions || '',
        timeout_read_body: general.timeout_read_body || '',
        timeout_read_header: general.timeout_read_header || '',
        timeout_write: general.timeout_write || '',
        timeout_idle: general.timeout_idle || '',
        log_credentials: Boolean(general.log_credentials),
        auto_https: general.auto_https || '',
        log_roll_size_mb: general.log_roll_size_mb || 10,
        log_roll_keep: general.log_roll_keep || 7
      },
      domains: domainsRows.map(d => ({
        ...d,
        enabled: Boolean(d.enabled),
        accessLog: Boolean(d.accessLog),
        disableTls: Boolean(d.disableTls),
        acme: Boolean(d.acme),
        accesslist: parseJSON(d.accesslist),
        basicauth: parseJSON(d.basicauth)
      })),
      subdomains: subdomainsRows.map(s => ({
        ...s,
        enabled: Boolean(s.enabled),
        acme: Boolean(s.acme),
        accesslist: parseJSON(s.accesslist),
        basicauth: parseJSON(s.basicauth)
      })),
      handlers: handlersRows.map(h => ({
        ...h,
        enabled: Boolean(h.enabled),
        httpTls: Boolean(h.httpTls),
        ntlm: Boolean(h.ntlm),
        health_follow_redirects: Boolean(h.health_follow_redirects),
        health_status: h.health_status || '',
        health_body: h.health_body || '',
        health_passes: h.health_passes || 0,
        health_fails: h.health_fails || 0,
        health_uri: h.health_uri || '',
        health_port: h.health_port || '',
        health_interval: h.health_interval || '',
        health_timeout: h.health_timeout || '',
        health_headers: parseJSON(h.health_headers),
        passive_health_fail_duration: h.passive_health_fail_duration || '',
        passive_health_max_fails: h.passive_health_max_fails || '',
        passive_health_unhealthy_status: h.passive_health_unhealthy_status || '',
        passive_health_unhealthy_latency: h.passive_health_unhealthy_latency || '',
        passive_health_unhealthy_request_count: h.passive_health_unhealthy_request_count || '',
        http_tls_insecure_skip_verify: Boolean(h.http_tls_insecure_skip_verify),
        http_tls_server_name: h.http_tls_server_name || '',
        http_tls_trusted_ca_certs: h.http_tls_trusted_ca_certs || '',
        accesslist: parseJSON(h.accesslist),
        basicauth: parseJSON(h.basicauth),
        header: parseJSON(h.header),
        toDomain: parseJSON(h.toDomain),
        waf_enabled: Boolean(h.waf_enabled)
      })),
      accessLists: accessListsRows.map(a => ({
        ...a,
        invert: Boolean(a.invert),
        clientIps: parseJSON(a.clientIps)
      })),
      basicAuths: basicAuthsRows,
      headers: headersRows,
      layer4: layer4Rows.map(l => ({
        ...l,
        enabled: Boolean(l.enabled),
        invert_matchers: Boolean(l.invert_matchers),
        terminateTls: Boolean(l.terminateTls),
        starttls: Boolean(l.starttls),
        fromDomain: parseJSON(l.fromDomain),
        toDomain: parseJSON(l.toDomain),
        remote_ip: parseJSON(l.remote_ip)
      }))
    };

    res.json(config);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to read config');
  }
});

const updateGeneralStmt = db.prepare('UPDATE general_config SET enabled=?, enable_layer4=?, http_port=?, https_port=?, log_level=?, tls_email=?, http_versions=?, timeout_read_body=?, timeout_read_header=?, timeout_write=?, timeout_idle=?, log_credentials=?, auto_https=?, log_roll_size_mb=?, log_roll_keep=? WHERE id=1');

const deleteDomainsStmt = db.prepare('DELETE FROM domains');
const insertDomainStmt = db.prepare(`
  INSERT INTO domains (id, enabled, fromDomain, fromPort, accesslist, basicauth, description, accessLog, disableTls, customCert, client_auth_mode, client_auth_trust_pool, acme)
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.enabled'),
    json_extract(value, '$.fromDomain'),
    json_extract(value, '$.fromPort'),
    json_extract(value, '$.accesslist'),
    json_extract(value, '$.basicauth'),
    json_extract(value, '$.description'),
    json_extract(value, '$.accessLog'),
    json_extract(value, '$.disableTls'),
    json_extract(value, '$.customCert'),
    json_extract(value, '$.client_auth_mode'),
    json_extract(value, '$.client_auth_trust_pool'),
    json_extract(value, '$.acme')
  FROM json_each(?)
`);

const deleteSubdomainsStmt = db.prepare('DELETE FROM subdomains');
const insertSubdomainStmt = db.prepare(`
  INSERT INTO subdomains (id, enabled, reverse, fromDomain, accesslist, basicauth, description, client_auth_mode, client_auth_trust_pool, acme)
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.enabled'),
    json_extract(value, '$.reverse'),
    json_extract(value, '$.fromDomain'),
    json_extract(value, '$.accesslist'),
    json_extract(value, '$.basicauth'),
    json_extract(value, '$.description'),
    json_extract(value, '$.client_auth_mode'),
    json_extract(value, '$.client_auth_trust_pool'),
    json_extract(value, '$.acme')
  FROM json_each(?)
`);

const deleteHandlersStmt = db.prepare('DELETE FROM handlers');
const insertHandlerStmt = db.prepare(`
  INSERT INTO handlers (
    id, enabled, reverse, subdomain, handleType, handlePath, accesslist, basicauth, header, handleDirective, toDomain, toPort, httpTls, ntlm, description,
    lb_policy, lb_retries, lb_try_duration, lb_try_interval,
    health_fails, health_passes, health_timeout, health_interval, health_uri, health_port, health_status, health_body, health_follow_redirects, health_headers,
    to_path, http_version, http_keepalive, http_tls_insecure_skip_verify, http_tls_trusted_ca_certs, http_tls_server_name,
    passive_health_fail_duration, passive_health_max_fails, passive_health_unhealthy_status, passive_health_unhealthy_latency, passive_health_unhealthy_request_count, redir_status, waf_enabled
  )
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.enabled'),
    json_extract(value, '$.reverse'),
    json_extract(value, '$.subdomain'),
    json_extract(value, '$.handleType'),
    json_extract(value, '$.handlePath'),
    json_extract(value, '$.accesslist'),
    json_extract(value, '$.basicauth'),
    json_extract(value, '$.header'),
    json_extract(value, '$.handleDirective'),
    json_extract(value, '$.toDomain'),
    json_extract(value, '$.toPort'),
    json_extract(value, '$.httpTls'),
    json_extract(value, '$.ntlm'),
    json_extract(value, '$.description'),
    json_extract(value, '$.lb_policy'),
    json_extract(value, '$.lb_retries'),
    json_extract(value, '$.lb_try_duration'),
    json_extract(value, '$.lb_try_interval'),
    json_extract(value, '$.health_fails'),
    json_extract(value, '$.health_passes'),
    json_extract(value, '$.health_timeout'),
    json_extract(value, '$.health_interval'),
    json_extract(value, '$.health_uri'),
    json_extract(value, '$.health_port'),
    json_extract(value, '$.health_status'),
    json_extract(value, '$.health_body'),
    json_extract(value, '$.health_follow_redirects'),
    json_extract(value, '$.health_headers'),
    json_extract(value, '$.to_path'),
    json_extract(value, '$.http_version'),
    json_extract(value, '$.http_keepalive'),
    json_extract(value, '$.http_tls_insecure_skip_verify'),
    json_extract(value, '$.http_tls_trusted_ca_certs'),
    json_extract(value, '$.http_tls_server_name'),
    json_extract(value, '$.passive_health_fail_duration'),
    json_extract(value, '$.passive_health_max_fails'),
    json_extract(value, '$.passive_health_unhealthy_status'),
    json_extract(value, '$.passive_health_unhealthy_latency'),
    json_extract(value, '$.passive_health_unhealthy_request_count'),
    json_extract(value, '$.redir_status'),
    json_extract(value, '$.waf_enabled')
  FROM json_each(?)
`);

const deleteAccessListsStmt = db.prepare('DELETE FROM access_lists');
const insertAccessListStmt = db.prepare(`
  INSERT INTO access_lists (id, accesslistName, clientIps, invert, description, http_response_code, http_response_message, request_matcher)
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.accesslistName'),
    json_extract(value, '$.clientIps'),
    json_extract(value, '$.invert'),
    json_extract(value, '$.description'),
    json_extract(value, '$.http_response_code'),
    json_extract(value, '$.http_response_message'),
    json_extract(value, '$.request_matcher')
  FROM json_each(?)
`);

const deleteBasicAuthsStmt = db.prepare('DELETE FROM basic_auths');
const insertBasicAuthStmt = db.prepare(`
  INSERT INTO basic_auths (id, basicauthuser, basicauthpass, description)
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.basicauthuser'),
    json_extract(value, '$.basicauthpass'),
    json_extract(value, '$.description')
  FROM json_each(?)
`);

const deleteHeadersStmt = db.prepare('DELETE FROM headers');
const insertHeaderStmt = db.prepare(`
  INSERT INTO headers (id, headerUpDown, headerType, headerValue, headerReplace, description)
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.headerUpDown'),
    json_extract(value, '$.headerType'),
    json_extract(value, '$.headerValue'),
    json_extract(value, '$.headerReplace'),
    json_extract(value, '$.description')
  FROM json_each(?)
`);

const deleteLayer4Stmt = db.prepare('DELETE FROM layer4');
const insertLayer4Stmt = db.prepare(`
  INSERT INTO layer4 (id, enabled, sequence, type, protocol, fromDomain, fromPort, matchers, invert_matchers, toDomain, toPort, terminateTls, proxyProtocol, description, originate_tls, remote_ip, lb_policy, passive_health_fail_duration, passive_health_max_fails, starttls, default_sni, customCert)
  SELECT
    json_extract(value, '$.id'),
    json_extract(value, '$.enabled'),
    json_extract(value, '$.sequence'),
    json_extract(value, '$.type'),
    json_extract(value, '$.protocol'),
    json_extract(value, '$.fromDomain'),
    json_extract(value, '$.fromPort'),
    json_extract(value, '$.matchers'),
    json_extract(value, '$.invert_matchers'),
    json_extract(value, '$.toDomain'),
    json_extract(value, '$.toPort'),
    json_extract(value, '$.terminateTls'),
    json_extract(value, '$.proxyProtocol'),
    json_extract(value, '$.description'),
    json_extract(value, '$.originate_tls'),
    json_extract(value, '$.remote_ip'),
    json_extract(value, '$.lb_policy'),
    json_extract(value, '$.passive_health_fail_duration'),
    json_extract(value, '$.passive_health_max_fails'),
    json_extract(value, '$.starttls'),
    json_extract(value, '$.default_sni'),
    json_extract(value, '$.customCert')
  FROM json_each(?)
`);

router.post('/config/structured', express.json(), async (req, res) => {
  try {
    const config = req.body;

    // ⚡ Bolt: Pre-process data outside transaction to minimize write-lock duration.
    const processedDomains = (config.domains || []).map(d => ({
      ...d,
      enabled: d.enabled ? 1 : 0,
      accesslist: JSON.stringify(d.accesslist || []),
      basicauth: JSON.stringify(d.basicauth || []),
      accessLog: d.accessLog ? 1 : 0,
      disableTls: d.disableTls ? 1 : 0,
      acme: d.acme ? 1 : 0
    }));

    const processedSubdomains = (config.subdomains || []).map(s => ({
      ...s,
      enabled: s.enabled ? 1 : 0,
      accesslist: JSON.stringify(s.accesslist || []),
      basicauth: JSON.stringify(s.basicauth || []),
      acme: s.acme ? 1 : 0
    }));

    const processedHandlers = (config.handlers || []).map(h => ({
      ...h,
      enabled: h.enabled ? 1 : 0,
      accesslist: JSON.stringify(h.accesslist || []),
      basicauth: JSON.stringify(h.basicauth || []),
      header: JSON.stringify(h.header || []),
      toDomain: JSON.stringify(h.toDomain || []),
      httpTls: h.httpTls ? 1 : 0,
      ntlm: h.ntlm ? 1 : 0,
      health_follow_redirects: h.health_follow_redirects ? 1 : 0,
      health_headers: JSON.stringify(h.health_headers || []),
      http_tls_insecure_skip_verify: h.http_tls_insecure_skip_verify ? 1 : 0,
      redir_status: h.redir_status || '301',
      waf_enabled: h.waf_enabled ? 1 : 0
    }));

    const processedAccessLists = (config.accessLists || []).map(a => ({
      ...a,
      clientIps: JSON.stringify(a.clientIps || []),
      invert: a.invert ? 1 : 0,
      request_matcher: a.request_matcher || 'client_ip'
    }));

    const processedLayer4 = (config.layer4 || []).map(l => ({
      ...l,
      enabled: l.enabled ? 1 : 0,
      fromDomain: JSON.stringify(l.fromDomain || []),
      invert_matchers: l.invert_matchers ? 1 : 0,
      toDomain: JSON.stringify(l.toDomain || []),
      terminateTls: l.terminateTls ? 1 : 0,
      remote_ip: JSON.stringify(l.remote_ip || []),
      starttls: l.starttls ? 1 : 0
    }));

    // ⚡ Bolt: Perform all database operations within a single transaction for atomicity and I/O efficiency.
    const saveTransaction = db.transaction(() => {
      // General
      if (config.general) {
        const http_versions = Array.isArray(config.general.http_versions) ? config.general.http_versions.join(' ') : (config.general.http_versions || '');
        updateGeneralStmt.run(config.general.enabled ? 1 : 0, config.general.enable_layer4 ? 1 : 0, config.general.http_port, config.general.https_port, config.general.log_level, config.general.tls_email, http_versions, config.general.timeout_read_body, config.general.timeout_read_header, config.general.timeout_write, config.general.timeout_idle, config.general.log_credentials ? 1 : 0, config.general.auto_https, config.general.log_roll_size_mb, config.general.log_roll_keep);
      }

      deleteDomainsStmt.run();
      if (processedDomains.length > 0) insertDomainStmt.run(JSON.stringify(processedDomains));

      deleteSubdomainsStmt.run();
      if (processedSubdomains.length > 0) insertSubdomainStmt.run(JSON.stringify(processedSubdomains));

      deleteHandlersStmt.run();
      if (processedHandlers.length > 0) insertHandlerStmt.run(JSON.stringify(processedHandlers));

      deleteAccessListsStmt.run();
      if (processedAccessLists.length > 0) insertAccessListStmt.run(JSON.stringify(processedAccessLists));

      deleteBasicAuthsStmt.run();
      if (config.basicAuths && config.basicAuths.length > 0) insertBasicAuthStmt.run(JSON.stringify(config.basicAuths));

      deleteHeadersStmt.run();
      if (config.headers && config.headers.length > 0) insertHeaderStmt.run(JSON.stringify(config.headers));

      deleteLayer4Stmt.run();
      if (processedLayer4.length > 0) insertLayer4Stmt.run(JSON.stringify(processedLayer4));
    });

    saveTransaction();

    const caddyfileContent = generateCaddyfile(config, certDir);
    await fs.promises.writeFile(appPaths.caddyfile, caddyfileContent, 'utf-8');

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to save config');
  }
});

// Logs
const logsDir = path.join(__dirname, '..', 'data', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

router.get('/logs/files', async (req, res) => {
  try {
    const files = await fs.promises.readdir(logsDir, { withFileTypes: true });
    const logFiles = files.filter(f => f.isFile() && f.name.endsWith('.log')).map(f => f.name);
    res.json(logFiles);
  } catch (err) {
    if (err.code === 'ENOENT') return res.json([]);
    res.status(500).send('Failed to read logs directory');
  }
});

router.get('/logs/stream', async (req, res) => {
  const filename = req.query.file;
  if (typeof filename !== 'string') return res.status(400).send('Invalid filename');
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\') || !filename.endsWith('.log')) {
    return res.status(400).send('Invalid filename');
  }

  const filePath = path.join(logsDir, filename);

  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: 'Log file not found' })}\n\n`);
    res.end();
    return;
  }

  // Use child_process tail to read the file
  // 🛡️ Sentinel: Use '--' to ensure filePath is not treated as an option if it starts with a hyphen.
  const tail = spawn('tail', ['-f', '-n', '100', '--', filePath]);

  let buffer = '';

  tail.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // The last element is the remainder of an incomplete line

    lines.forEach(line => {
      if (line.trim()) {
        res.write(`data: ${line}\n\n`);
      }
    });
  });

  tail.stderr.on('data', (data) => {
    console.error(`Tail error: ${data.toString()}`);
  });

  req.on('close', () => {
    tail.kill();
  });
});

// Exec Caddy commands
function execCaddy(cmdArgs, res) {
  execFile('caddy', cmdArgs, (error, stdout, stderr) => {
    res.json({
      output: stdout,
      stderr: stderr,
      error: error ? error.message : undefined
    });
  });
}

router.post('/validate', (req, res) => execCaddy(['validate', '--config', appPaths.caddyfile], res));

router.post('/start', async (req, res) => {
  try {
    // Check if it is already running
    const checkRes = await fetch('http://localhost:2019/config/', { headers: { 'Origin': 'http://localhost:2019' } }).catch(() => null);
    if (checkRes && checkRes.ok) {
      return res.json({ output: 'Caddy is already running.', stderr: '', error: undefined });
    }
  } catch (e) {
    console.error('Failed to check if Caddy is running:', e.message || e);
  }

  const cp = spawn('caddy', ['run', '--config', appPaths.caddyfile], {
    detached: true,
    stdio: 'ignore'
  });

  cp.unref();

  cp.on('error', (err) => {
    if (!res.headersSent) {
      res.json({ output: '', stderr: '', error: err.message });
    }
  });

  cp.on('exit', (code) => {
    if (!res.headersSent) {
      if (code === 0 || code === null) {
        res.json({ output: 'Caddy started successfully.', stderr: '', error: undefined });
      } else {
        res.json({ output: '', stderr: '', error: `Caddy exited with code ${code}` });
      }
    }
  });

  // Fallback timeout in case Caddy successfully detaches but takes a while to exit the parent process
  setTimeout(() => {
    if (!res.headersSent) {
      res.json({ output: 'Caddy start command executed.', stderr: '', error: undefined });
    }
  }, 100);
});

router.post('/stop', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const apiRes = await fetch('http://localhost:2019/stop', {
      method: 'POST',
      headers: { 'Origin': 'http://localhost:2019' },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (apiRes.ok) {
      return res.json({ output: 'Caddy stopped successfully.', stderr: '', error: undefined });
    } else {
      return res.json({ output: '', stderr: '', error: `Failed to stop: ${apiRes.statusText}` });
    }
  } catch (e) {
    // If we cannot connect to API, fallback to CLI
    execCaddy(['stop'], res);
  }
});

router.post('/reload', async (req, res) => {
  try {
    let caddyfileContent = '';
    try {
      caddyfileContent = await fs.promises.readFile(appPaths.caddyfile, 'utf-8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const apiRes = await fetch('http://localhost:2019/load', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/caddyfile',
        'Cache-Control': 'no-cache',
        'Origin': 'http://localhost:2019'
      },
      body: caddyfileContent
    });
    if (apiRes.ok) {
      return res.json({ output: 'Caddy reloaded successfully.', stderr: '', error: undefined });
    } else {
      const errText = await apiRes.text();
      return res.json({ output: '', stderr: errText, error: `Failed to reload: ${apiRes.statusText}` });
    }
  } catch (e) {
    // If we cannot connect to API, fallback to CLI
    execCaddy(['reload', '--config', appPaths.caddyfile], res);
  }
});

// Stats
router.get('/stats', (req, res) => {
  fetch('http://localhost:2019/metrics', {
    headers: {
      'Origin': 'http://localhost:2019'
    }
  })
    .then(r => r.text())
    .then(text => {
      res.set('Content-Type', 'text/plain');
      res.send(text);
    })
    .catch(err => {
      res.status(503).send('Metrics unavailable (is Caddy running?)');
    });
});

// Certs
let cachedAppDataDir = null;

router.get('/certs/acme/download', async (req, res) => {
  if (cachedAppDataDir) {
    const certificatesDir = path.join(cachedAppDataDir, 'certificates');
    return await serveCertificates(certificatesDir, res);
  }

  execFile('caddy', ['environ'], async (error, stdout) => {
    if (error) {
      console.error('Failed to query Caddy environment:', error);
      return res.status(500).send('Failed to query Caddy environment');
    }
    const match = stdout.match(/caddy\.AppDataDir=(.+)/);
    if (!match) {
      return res.status(500).send('Could not find Caddy AppDataDir');
    }
    cachedAppDataDir = match[1].trim();
    const certificatesDir = path.join(cachedAppDataDir, 'certificates');
    return await serveCertificates(certificatesDir, res);
  });
});

async function serveCertificates(certificatesDir, res) {
  try {
    await fs.promises.access(certificatesDir, fs.constants.F_OK);
  } catch (err) {
    return res.status(404).send('No Let\'s Encrypt certificates found.');
  }

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', 'attachment; filename="letsencrypt-certificates.tar.gz"');

  const tarProcess = spawn('tar', ['-czf', '-', '-C', certificatesDir, '.']);

  tarProcess.stdout.pipe(res);

  tarProcess.stderr.on('data', (data) => {
    console.error(`tar stderr: ${data}`);
  });

  tarProcess.on('close', (code) => {
    if (code !== 0) {
      console.error(`tar process exited with code ${code}`);
      if (!res.headersSent) {
        res.status(500).end();
      }
    }
  });
}



router.get('/certs', async (req, res) => {
  try {
    // ⚡ Bolt: Use asynchronous readdir with { withFileTypes: true } to prevent event loop blocking
    // and eliminate O(n) synchronous statSync calls.
    const dirents = await fs.promises.readdir(certDir, { withFileTypes: true });
    const files = dirents.filter(dirent => !dirent.isDirectory()).map(dirent => dirent.name);
    res.json(files);
  } catch (err) {
    res.status(500).send('Failed to read certs directory');
  }
});

router.post('/certs', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).send('Failed to get file');
  const safeName = path.basename(req.file.originalname);
  const dstPath = path.join(certDir, safeName);
  try {
    // ⚡ Bolt: Use asynchronous rename to prevent event loop blocking.
    await fs.promises.rename(req.file.path, dstPath);
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send('Failed to write file');
  }
});

router.delete('/certs', async (req, res) => {
  const filename = req.query.file;
  if (typeof filename !== 'string') return res.status(400).send('Invalid filename');
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).send('Invalid filename');
  }
  const filePath = path.join(certDir, filename);
  try {
    // ⚡ Bolt: Use asynchronous unlink to prevent event loop blocking,
    // and catch ENOENT instead of using existsSync to avoid TOCTOU races.
    await fs.promises.unlink(filePath);
    res.sendStatus(200);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.status(404).send('File not found');
    } else {
      res.status(500).send('Failed to delete file');
    }
  }
});

module.exports = router;
