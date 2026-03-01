const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const db = require('./db');
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

// Helper to safely parse JSON or return default
function parseJSON(str, def = []) {
  if (!str) return def;
  try { return JSON.parse(str); } catch { return def; }
}

// /api/config/structured
router.get('/config/structured', (req, res) => {
  try {
    const general = db.prepare('SELECT * FROM general_config WHERE id = 1').get() || { enabled: 0, enable_layer4: 0, http_port: '80', https_port: '443', log_level: 'INFO' };

    const domainsRows = db.prepare('SELECT * FROM domains').all();
    const subdomainsRows = db.prepare('SELECT * FROM subdomains').all();
    const handlersRows = db.prepare('SELECT * FROM handlers').all();
    const accessListsRows = db.prepare('SELECT * FROM access_lists').all();
    const basicAuthsRows = db.prepare('SELECT * FROM basic_auths').all();
    const headersRows = db.prepare('SELECT * FROM headers').all();
    const layer4Rows = db.prepare('SELECT * FROM layer4').all();

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
        log_credentials: Boolean(general.log_credentials)
      },
      domains: domainsRows.map(d => ({
        ...d,
        enabled: Boolean(d.enabled),
        accessLog: Boolean(d.accessLog),
        disableTls: Boolean(d.disableTls),
        accesslist: parseJSON(d.accesslist),
        basicauth: parseJSON(d.basicauth)
      })),
      subdomains: subdomainsRows.map(s => ({
        ...s,
        enabled: Boolean(s.enabled),
        accesslist: parseJSON(s.accesslist),
        basicauth: parseJSON(s.basicauth)
      })),
      handlers: handlersRows.map(h => ({
        ...h,
        enabled: Boolean(h.enabled),
        httpTls: Boolean(h.httpTls),
        ntlm: Boolean(h.ntlm),
        health_follow_redirects: Boolean(h.health_follow_redirects),
        http_tls_insecure_skip_verify: Boolean(h.http_tls_insecure_skip_verify),
        accesslist: parseJSON(h.accesslist),
        basicauth: parseJSON(h.basicauth),
        header: parseJSON(h.header),
        toDomain: parseJSON(h.toDomain)
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
        terminateTls: Boolean(l.terminateTls),
        fromDomain: parseJSON(l.fromDomain),
        toDomain: parseJSON(l.toDomain)
      }))
    };

    res.json(config);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to read config');
  }
});

router.post('/config/structured', express.json(), async (req, res) => {
  try {
    const config = req.body;
    const saveTransaction = db.transaction(() => {
      // General
      if (config.general) {
        db.prepare('UPDATE general_config SET enabled=?, enable_layer4=?, http_port=?, https_port=?, log_level=?, tls_email=?, http_versions=?, timeout_read_body=?, timeout_read_header=?, timeout_write=?, timeout_idle=?, log_credentials=? WHERE id=1')
          .run(config.general.enabled ? 1 : 0, config.general.enable_layer4 ? 1 : 0, config.general.http_port, config.general.https_port, config.general.log_level, config.general.tls_email, config.general.http_versions, config.general.timeout_read_body, config.general.timeout_read_header, config.general.timeout_write, config.general.timeout_idle, config.general.log_credentials ? 1 : 0);
      }

      // Domains
      db.prepare('DELETE FROM domains').run();
      if (config.domains) {
        const stmt = db.prepare('INSERT INTO domains (id, enabled, fromDomain, fromPort, accesslist, basicauth, description, accessLog, disableTls, customCert, client_auth_mode, client_auth_trust_pool) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const d of config.domains) {
          stmt.run(d.id, d.enabled ? 1 : 0, d.fromDomain, d.fromPort, JSON.stringify(d.accesslist || []), JSON.stringify(d.basicauth || []), d.description, d.accessLog ? 1 : 0, d.disableTls ? 1 : 0, d.customCert, d.client_auth_mode, d.client_auth_trust_pool);
        }
      }

      // Subdomains
      db.prepare('DELETE FROM subdomains').run();
      if (config.subdomains) {
        const stmt = db.prepare('INSERT INTO subdomains (id, enabled, reverse, fromDomain, accesslist, basicauth, description, client_auth_mode, client_auth_trust_pool) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const s of config.subdomains) {
          stmt.run(s.id, s.enabled ? 1 : 0, s.reverse, s.fromDomain, JSON.stringify(s.accesslist || []), JSON.stringify(s.basicauth || []), s.description, s.client_auth_mode, s.client_auth_trust_pool);
        }
      }

      // Handlers
      db.prepare('DELETE FROM handlers').run();
      if (config.handlers) {
        const stmt = db.prepare(`INSERT INTO handlers (
          id, enabled, reverse, subdomain, handleType, handlePath, accesslist, basicauth, header, handleDirective, toDomain, toPort, httpTls, ntlm, description,
          lb_policy, lb_retries, lb_try_duration, lb_try_interval,
          health_fails, health_passes, health_timeout, health_interval, health_uri, health_port, health_status, health_body, health_follow_redirects,
          to_path, http_version, http_keepalive, http_tls_insecure_skip_verify, http_tls_trusted_ca_certs, http_tls_server_name,
          passive_health_fail_duration, passive_health_max_fails, passive_health_unhealthy_status, passive_health_unhealthy_latency, passive_health_unhealthy_request_count, redir_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const h of config.handlers) {
          stmt.run(
            h.id, h.enabled ? 1 : 0, h.reverse, h.subdomain, h.handleType, h.handlePath, JSON.stringify(h.accesslist || []), JSON.stringify(h.basicauth || []), JSON.stringify(h.header || []), h.handleDirective, JSON.stringify(h.toDomain || []), h.toPort, h.httpTls ? 1 : 0, h.ntlm ? 1 : 0, h.description,
            h.lb_policy, h.lb_retries, h.lb_try_duration, h.lb_try_interval,
            h.health_fails, h.health_passes, h.health_timeout, h.health_interval, h.health_uri, h.health_port, h.health_status, h.health_body, h.health_follow_redirects ? 1 : 0,
            h.to_path, h.http_version, h.http_keepalive, h.http_tls_insecure_skip_verify ? 1 : 0, h.http_tls_trusted_ca_certs, h.http_tls_server_name,
            h.passive_health_fail_duration, h.passive_health_max_fails, h.passive_health_unhealthy_status, h.passive_health_unhealthy_latency, h.passive_health_unhealthy_request_count, h.redir_status || '301'
          );
        }
      }

      // Access Lists
      db.prepare('DELETE FROM access_lists').run();
      if (config.accessLists) {
        const stmt = db.prepare('INSERT INTO access_lists (id, accesslistName, clientIps, invert, description, http_response_code, http_response_message, request_matcher) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        for (const a of config.accessLists) {
          stmt.run(a.id, a.accesslistName, JSON.stringify(a.clientIps || []), a.invert ? 1 : 0, a.description, a.http_response_code, a.http_response_message, a.request_matcher || 'client_ip');
        }
      }

      // Basic Auths
      db.prepare('DELETE FROM basic_auths').run();
      if (config.basicAuths) {
        const stmt = db.prepare('INSERT INTO basic_auths (id, basicauthuser, basicauthpass, description) VALUES (?, ?, ?, ?)');
        for (const b of config.basicAuths) {
          stmt.run(b.id, b.basicauthuser, b.basicauthpass, b.description);
        }
      }

      // Headers
      db.prepare('DELETE FROM headers').run();
      if (config.headers) {
        const stmt = db.prepare('INSERT INTO headers (id, headerUpDown, headerType, headerValue, headerReplace, description) VALUES (?, ?, ?, ?, ?, ?)');
        for (const h of config.headers) {
          stmt.run(h.id, h.headerUpDown, h.headerType, h.headerValue, h.headerReplace, h.description);
        }
      }

      // Layer 4
      db.prepare('DELETE FROM layer4').run();
      if (config.layer4) {
        const stmt = db.prepare('INSERT INTO layer4 (id, enabled, sequence, type, protocol, fromDomain, fromPort, matchers, toDomain, toPort, terminateTls, proxyProtocol, description, originate_tls, remote_ip, lb_policy, passive_health_fail_duration, passive_health_max_fails) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const l of config.layer4) {
          stmt.run(l.id, l.enabled ? 1 : 0, l.sequence, l.type, l.protocol, JSON.stringify(l.fromDomain || []), l.fromPort, l.matchers, JSON.stringify(l.toDomain || []), l.toPort, l.terminateTls ? 1 : 0, l.proxyProtocol, l.description, l.originate_tls, JSON.stringify(l.remote_ip || []), l.lb_policy, l.passive_health_fail_duration, l.passive_health_max_fails);
        }
      }
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

// Exec Caddy commands
function execCaddy(cmdArgs, res) {
  execFile('caddy', cmdArgs, (error, stdout, stderr) => {
    res.json({
      output: stdout,
      error: error ? error.message : undefined
    });
  });
}

router.post('/validate', (req, res) => execCaddy(['validate', '--config', appPaths.caddyfile], res));
router.post('/start', (req, res) => execCaddy(['start', '--config', appPaths.caddyfile], res));
router.post('/stop', (req, res) => execCaddy(['stop'], res));
router.post('/reload', (req, res) => execCaddy(['reload', '--config', appPaths.caddyfile], res));

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
router.get('/certs', (req, res) => {
  try {
    const files = fs.readdirSync(certDir).filter(f => !fs.statSync(path.join(certDir, f)).isDirectory());
    res.json(files);
  } catch (err) {
    res.status(500).send('Failed to read certs directory');
  }
});

router.post('/certs', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send('Failed to get file');
  const safeName = path.basename(req.file.originalname);
  const dstPath = path.join(certDir, safeName);
  try {
    fs.renameSync(req.file.path, dstPath);
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send('Failed to write file');
  }
});

router.delete('/certs', (req, res) => {
  const filename = req.query.file;
  if (!filename || filename.includes('..') || filename.includes('/')) {
    return res.status(400).send('Invalid filename');
  }
  const filePath = path.join(certDir, filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.sendStatus(200);
    } else {
      res.status(404).send('File not found');
    }
  } catch (err) {
    res.status(500).send('Failed to delete file');
  }
});

module.exports = router;
