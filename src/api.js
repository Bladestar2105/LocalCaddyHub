const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const db = require('./db');
const { generateCaddyfile } = require('./caddy');
const appPaths = require('./paths');

const router = express.Router();

const certDir = appPaths.certsDir;

const upload = multer({ dest: certDir, limits: { fileSize: 10 * 1024 * 1024 } });

// /api/config
router.get('/config', (req, res) => {
  try {
    const caddyfilePath = appPaths.caddyfile;
    let content = '';
    if (fs.existsSync(caddyfilePath)) {
      content = fs.readFileSync(caddyfilePath, 'utf-8');
    }
    res.json({ content });
  } catch (err) {
    res.status(500).send('Failed to read Caddyfile');
  }
});

router.post('/config', express.json(), (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).send('Invalid request body');
    const caddyfilePath = appPaths.caddyfile;
    fs.writeFileSync(caddyfilePath, content, 'utf-8');
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
        log_level: general.log_level || ''
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

router.post('/config/structured', express.json(), (req, res) => {
  try {
    const config = req.body;
    const saveTransaction = db.transaction(() => {
      // General
      if (config.general) {
        db.prepare('UPDATE general_config SET enabled=?, enable_layer4=?, http_port=?, https_port=?, log_level=? WHERE id=1')
          .run(config.general.enabled ? 1 : 0, config.general.enable_layer4 ? 1 : 0, config.general.http_port, config.general.https_port, config.general.log_level);
      }

      // Domains
      db.prepare('DELETE FROM domains').run();
      if (config.domains) {
        const stmt = db.prepare('INSERT INTO domains (id, enabled, fromDomain, fromPort, accesslist, basicauth, description, accessLog, disableTls, customCert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const d of config.domains) {
          stmt.run(d.id, d.enabled ? 1 : 0, d.fromDomain, d.fromPort, JSON.stringify(d.accesslist || []), JSON.stringify(d.basicauth || []), d.description, d.accessLog ? 1 : 0, d.disableTls ? 1 : 0, d.customCert);
        }
      }

      // Subdomains
      db.prepare('DELETE FROM subdomains').run();
      if (config.subdomains) {
        const stmt = db.prepare('INSERT INTO subdomains (id, enabled, reverse, fromDomain, accesslist, basicauth, description) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const s of config.subdomains) {
          stmt.run(s.id, s.enabled ? 1 : 0, s.reverse, s.fromDomain, JSON.stringify(s.accesslist || []), JSON.stringify(s.basicauth || []), s.description);
        }
      }

      // Handlers
      db.prepare('DELETE FROM handlers').run();
      if (config.handlers) {
        const stmt = db.prepare(`INSERT INTO handlers (
          id, enabled, reverse, subdomain, handleType, handlePath, accesslist, basicauth, header, handleDirective, toDomain, toPort, httpTls, ntlm, description,
          lb_policy, lb_retries, lb_try_duration, lb_try_interval,
          health_fails, health_passes, health_timeout, health_interval, health_uri, health_port, health_status, health_body, health_follow_redirects
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const h of config.handlers) {
          stmt.run(
            h.id, h.enabled ? 1 : 0, h.reverse, h.subdomain, h.handleType, h.handlePath, JSON.stringify(h.accesslist || []), JSON.stringify(h.basicauth || []), JSON.stringify(h.header || []), h.handleDirective, JSON.stringify(h.toDomain || []), h.toPort, h.httpTls ? 1 : 0, h.ntlm ? 1 : 0, h.description,
            h.lb_policy, h.lb_retries, h.lb_try_duration, h.lb_try_interval,
            h.health_fails, h.health_passes, h.health_timeout, h.health_interval, h.health_uri, h.health_port, h.health_status, h.health_body, h.health_follow_redirects ? 1 : 0
          );
        }
      }

      // Access Lists
      db.prepare('DELETE FROM access_lists').run();
      if (config.accessLists) {
        const stmt = db.prepare('INSERT INTO access_lists (id, accesslistName, clientIps, invert, description) VALUES (?, ?, ?, ?, ?)');
        for (const a of config.accessLists) {
          stmt.run(a.id, a.accesslistName, JSON.stringify(a.clientIps || []), a.invert ? 1 : 0, a.description);
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
        const stmt = db.prepare('INSERT INTO layer4 (id, enabled, sequence, type, protocol, fromDomain, fromPort, matchers, toDomain, toPort, terminateTls, proxyProtocol, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const l of config.layer4) {
          stmt.run(l.id, l.enabled ? 1 : 0, l.sequence, l.type, l.protocol, JSON.stringify(l.fromDomain || []), l.fromPort, l.matchers, JSON.stringify(l.toDomain || []), l.toPort, l.terminateTls ? 1 : 0, l.proxyProtocol, l.description);
        }
      }
    });

    saveTransaction();

    const caddyfileContent = generateCaddyfile(config, certDir);
    fs.writeFileSync(appPaths.caddyfile, caddyfileContent, 'utf-8');

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to save config');
  }
});

// Exec Caddy commands
function execCaddy(cmdArgs, res) {
  exec(`caddy ${cmdArgs.join(' ')}`, (error, stdout, stderr) => {
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
