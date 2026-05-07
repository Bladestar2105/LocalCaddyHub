const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const db = require('./db');
const { parseJSON, isSafeFilename } = require('./utils');
const { generateCaddyfile } = require('./caddy');
const appPaths = require('./paths');
const { resolveCaddyBinary } = require('./caddyBinary');

const router = express.Router();

const certDir = appPaths.certsDir;

const upload = multer({ dest: certDir, limits: { fileSize: 10 * 1024 * 1024 } });
const allowedAcmeCaEndpoints = new Set([
  '',
  'https://acme-v02.api.letsencrypt.org/directory',
  'https://acme-staging-v02.api.letsencrypt.org/directory'
]);
const allowedTlsKeyTypes = new Set(['', 'rsa2048', 'rsa4096', 'p256', 'p384', 'ed25519']);

function toStringArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function autoHttpsDisablesAcme(general = {}) {
  return ['off', 'disable_certs'].includes(general.auto_https || '');
}

function normalizeAcmeCa(value) {
  const endpoint = typeof value === 'string' ? value.trim() : '';
  return allowedAcmeCaEndpoints.has(endpoint) ? endpoint : '';
}

function normalizeTlsKeyType(value) {
  const keyType = typeof value === 'string' ? value.trim() : '';
  if (!keyType) return 'rsa2048';
  return allowedTlsKeyTypes.has(keyType) ? keyType : 'rsa2048';
}

function normalizeAcmeConfig(input) {
  const config = {
    ...input,
    general: input.general || {},
    domains: (input.domains || []).map(d => ({ ...d })),
    subdomains: (input.subdomains || []).map(s => ({ ...s })),
    layer4: (input.layer4 || []).map(l => ({ ...l }))
  };
  config.general.acme_ca = normalizeAcmeCa(config.general.acme_ca);
  config.general.tls_key_type = normalizeTlsKeyType(config.general.tls_key_type);
  const acmeDisabled = autoHttpsDisablesAcme(config.general);
  const domainsById = new Map();

  config.domains.forEach(domain => {
    if (acmeDisabled || domain.disableTls) {
      domain.acme = false;
    }
    domainsById.set(domain.id, domain);
  });

  config.subdomains.forEach(subdomain => {
    const parent = domainsById.get(subdomain.reverse);
    if (acmeDisabled || (parent && parent.disableTls)) {
      subdomain.acme = false;
    }
  });

  config.layer4.forEach(route => {
    if (acmeDisabled || (!route.terminateTls && !route.starttls)) {
      route.acme = false;
    }
    if (route.acme) {
      route.customCert = '';
    }
  });

  return config;
}

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

function structuredConfigFromDb() {
  const general = getGeneralStmt.get() || { enabled: 0, enable_layer4: 0, http_port: '80', https_port: '443', log_level: 'INFO', acme_ca: '' };

  const domainsRows = getDomainsStmt.all();
  const subdomainsRows = getSubdomainsStmt.all();
  const handlersRows = getHandlersStmt.all();
  const accessListsRows = getAccessListsStmt.all();
  const basicAuthsRows = getBasicAuthsStmt.all();
  const headersRows = getHeadersStmt.all();
  const layer4Rows = getLayer4Stmt.all();

  return {
    general: {
      enabled: Boolean(general.enabled),
      enable_layer4: Boolean(general.enable_layer4),
      http_port: general.http_port || '',
      https_port: general.https_port || '',
      log_level: general.log_level || '',
      tls_email: general.tls_email || '',
      acme_ca: normalizeAcmeCa(general.acme_ca),
      tls_key_type: normalizeTlsKeyType(general.tls_key_type),
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
      acme: Boolean(l.acme),
      fromDomain: toStringArray(parseJSON(l.fromDomain)),
      toDomain: toStringArray(parseJSON(l.toDomain)),
      remote_ip: toStringArray(parseJSON(l.remote_ip))
    }))
  };
}

// /api/config/structured
router.get('/config/structured', (req, res) => {
  try {
    res.json(structuredConfigFromDb());
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to read config');
  }
});

const updateGeneralStmt = db.prepare('UPDATE general_config SET enabled=?, enable_layer4=?, http_port=?, https_port=?, log_level=?, tls_email=?, acme_ca=?, tls_key_type=?, http_versions=?, timeout_read_body=?, timeout_read_header=?, timeout_write=?, timeout_idle=?, log_credentials=?, auto_https=?, log_roll_size_mb=?, log_roll_keep=? WHERE id=1');

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
  INSERT INTO layer4 (id, enabled, sequence, type, protocol, fromDomain, fromPort, matchers, invert_matchers, toDomain, toPort, terminateTls, proxyProtocol, description, originate_tls, remote_ip, lb_policy, passive_health_fail_duration, passive_health_max_fails, starttls, default_sni, upstream_tls_server_name, acme, customCert)
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
    json_extract(value, '$.upstream_tls_server_name'),
    json_extract(value, '$.acme'),
    json_extract(value, '$.customCert')
  FROM json_each(?)
`);

const clearDomainCustomCertStmt = db.prepare("UPDATE domains SET customCert='' WHERE id=?");
const clearDomainClientAuthTrustPoolStmt = db.prepare("UPDATE domains SET client_auth_trust_pool='' WHERE id=?");
const clearSubdomainClientAuthTrustPoolStmt = db.prepare("UPDATE subdomains SET client_auth_trust_pool='' WHERE id=?");
const clearHandlerTrustedCaStmt = db.prepare("UPDATE handlers SET http_tls_trusted_ca_certs='' WHERE id=?");
const clearLayer4CustomCertStmt = db.prepare("UPDATE layer4 SET customCert='' WHERE id=?");
const setGeneralTlsKeyTypeStmt = db.prepare('UPDATE general_config SET tls_key_type=? WHERE id=1');

function keyNameForCustomCertificate(filename) {
  return String(filename || '').replace(/\.pem$/i, '') + '.key';
}

function certificateReferenceRows() {
  const references = [];

  function add(file, type, owner, clearKey, companionOf = '') {
    if (!file) return;
    references.push({ file, type, owner, clearKey, companionOf });
  }

  for (const domain of getDomainsStmt.all()) {
    const owner = domain.fromDomain || domain.id;
    if (domain.customCert) {
      add(domain.customCert, 'Domain custom certificate', owner, `domain:customCert:${domain.id}`);
      add(keyNameForCustomCertificate(domain.customCert), 'Domain custom certificate key', owner, `domain:customCert:${domain.id}`, domain.customCert);
    }
    add(domain.client_auth_trust_pool, 'Domain client auth trust pool', owner, `domain:client_auth_trust_pool:${domain.id}`);
  }

  for (const subdomain of getSubdomainsStmt.all()) {
    const owner = subdomain.fromDomain || subdomain.id;
    add(subdomain.client_auth_trust_pool, 'Subdomain client auth trust pool', owner, `subdomain:client_auth_trust_pool:${subdomain.id}`);
  }

  for (const handler of getHandlersStmt.all()) {
    const owner = handler.description || handler.handlePath || handler.id;
    add(handler.http_tls_trusted_ca_certs, 'Handler upstream TLS trusted CA', owner, `handler:http_tls_trusted_ca_certs:${handler.id}`);
  }

  for (const route of getLayer4Stmt.all()) {
    const owner = route.description || route.fromPort || route.id;
    if (route.customCert) {
      add(route.customCert, 'Layer 4 custom certificate', owner, `layer4:customCert:${route.id}`);
      add(keyNameForCustomCertificate(route.customCert), 'Layer 4 custom certificate key', owner, `layer4:customCert:${route.id}`, route.customCert);
    }
  }

  return references;
}

function clearCertificateReference(clearKey) {
  const [table, field, id] = String(clearKey).split(':');
  if (!table || !field || !id) return false;

  if (table === 'domain' && field === 'customCert') clearDomainCustomCertStmt.run(id);
  else if (table === 'domain' && field === 'client_auth_trust_pool') clearDomainClientAuthTrustPoolStmt.run(id);
  else if (table === 'subdomain' && field === 'client_auth_trust_pool') clearSubdomainClientAuthTrustPoolStmt.run(id);
  else if (table === 'handler' && field === 'http_tls_trusted_ca_certs') clearHandlerTrustedCaStmt.run(id);
  else if (table === 'layer4' && field === 'customCert') clearLayer4CustomCertStmt.run(id);
  else return false;

  return true;
}

function clearCertificateReferencesForFiles(filenames) {
  const files = new Set(filenames.filter(Boolean));
  const cleared = [];
  const seen = new Set();
  const tx = db.transaction(() => {
    for (const reference of certificateReferenceRows()) {
      if (!files.has(reference.file)) continue;
      if (seen.has(reference.clearKey)) continue;
      if (clearCertificateReference(reference.clearKey)) {
        seen.add(reference.clearKey);
        cleared.push(reference);
      }
    }
  });

  tx();
  return cleared;
}

async function writeStructuredCaddyfileFromDb() {
  const caddyfileContent = generateCaddyfile(structuredConfigFromDb(), certDir);
  await fs.promises.writeFile(appPaths.caddyfile, caddyfileContent, 'utf-8');
}

async function existingCustomCertFileSet() {
  const dirents = await fs.promises.readdir(certDir, { withFileTypes: true });
  return new Set(dirents.filter(dirent => !dirent.isDirectory()).map(dirent => dirent.name));
}

async function missingCertificateReferences() {
  const existingFiles = await existingCustomCertFileSet();
  return certificateReferenceRows().filter(reference => !existingFiles.has(reference.file));
}

router.post('/config/structured', express.json(), async (req, res) => {
  try {
    const config = normalizeAcmeConfig(req.body || {});

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
      fromDomain: JSON.stringify(toStringArray(l.fromDomain)),
      invert_matchers: l.invert_matchers ? 1 : 0,
      toDomain: JSON.stringify(toStringArray(l.toDomain)),
      terminateTls: l.terminateTls ? 1 : 0,
      remote_ip: JSON.stringify(toStringArray(l.remote_ip)),
      starttls: l.starttls ? 1 : 0,
      acme: l.acme ? 1 : 0
    }));

    // ⚡ Bolt: Perform all database operations within a single transaction for atomicity and I/O efficiency.
    const saveTransaction = db.transaction(() => {
      // General
      if (config.general) {
        const http_versions = Array.isArray(config.general.http_versions) ? config.general.http_versions.join(' ') : (config.general.http_versions || '');
        updateGeneralStmt.run(config.general.enabled ? 1 : 0, config.general.enable_layer4 ? 1 : 0, config.general.http_port, config.general.https_port, config.general.log_level, config.general.tls_email, config.general.acme_ca, config.general.tls_key_type, http_versions, config.general.timeout_read_body, config.general.timeout_read_header, config.general.timeout_write, config.general.timeout_idle, config.general.log_credentials ? 1 : 0, config.general.auto_https, config.general.log_roll_size_mb, config.general.log_roll_keep);
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
  if (!isSafeFilename(filename) || !filename.endsWith('.log')) {
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
  execFile(resolveCaddyBinary(), cmdArgs, (error, stdout, stderr) => {
    res.json({
      output: stdout,
      stderr: stderr,
      error: error ? error.message : undefined
    });
  });
}

function execCaddyPromise(cmdArgs) {
  return new Promise((resolve, reject) => {
    execFile(resolveCaddyBinary(), cmdArgs, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function isCaddyAdminReady() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);
  try {
    const apiRes = await fetch('http://localhost:2019/config/', {
      headers: { 'Origin': 'http://localhost:2019' },
      signal: controller.signal
    });
    return apiRes.ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadCaddyfileThroughAdmin() {
  const caddyfileContent = await fs.promises.readFile(appPaths.caddyfile, 'utf-8');
  const apiRes = await fetch('http://localhost:2019/load', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/caddyfile',
      'Cache-Control': 'no-cache',
      'Origin': 'http://localhost:2019'
    },
    body: caddyfileContent
  });
  if (!apiRes.ok) {
    const errText = await apiRes.text();
    const err = new Error(`Failed to reload: ${apiRes.statusText}`);
    err.stderr = errText;
    throw err;
  }
}

function startCaddyDetached() {
  return new Promise((resolve, reject) => {
    const cp = spawn(resolveCaddyBinary(), ['run', '--config', appPaths.caddyfile], {
      detached: true,
      stdio: 'ignore'
    });

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    cp.unref();
    cp.on('error', (err) => finish(reject, err));
    cp.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        finish(reject, new Error(`Caddy exited with code ${code}`));
      }
    });
    setTimeout(() => finish(resolve), 500);
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

  const cp = spawn(resolveCaddyBinary(), ['run', '--config', appPaths.caddyfile], {
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
    await loadCaddyfileThroughAdmin();
    return res.json({ output: 'Caddy reloaded successfully.', stderr: '', error: undefined });
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

function normalizeAcmeHost(value) {
  let host = String(value || '').trim().toLowerCase();
  if (!host) return '';
  try {
    if (/^https?:\/\//.test(host)) host = new URL(host).hostname;
  } catch (e) {
    return '';
  }
  host = host.replace(/^\*\./, '').replace(/\.$/, '');
  if (!host || host.includes('*') || host.includes(':') || !host.includes('.')) return '';
  return host;
}

function configuredAcmeTargets() {
  const general = getGeneralStmt.get() || {};
  if (autoHttpsDisablesAcme(general)) return [];

  const targets = [];
  const seen = new Set();
  const domains = getDomainsStmt.all();
  const domainsById = new Map(domains.map(domain => [domain.id, domain]));

  function addTarget(host, type) {
    const normalized = normalizeAcmeHost(host);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    targets.push({ host: normalized, type });
  }

  for (const domain of domains) {
    if (domain.enabled && domain.acme && !domain.disableTls) {
      addTarget(domain.fromDomain, 'Domain');
    }
  }

  for (const subdomain of getSubdomainsStmt.all()) {
    const parent = domainsById.get(subdomain.reverse);
    if (!subdomain.enabled || !parent || !parent.enabled || parent.disableTls) continue;
    if (subdomain.acme || parent.acme) {
      addTarget(`${subdomain.fromDomain}.${parent.fromDomain}`, 'Subdomain');
    }
  }

  for (const route of getLayer4Stmt.all()) {
    if (!route.enabled || !route.acme || (!route.terminateTls && !route.starttls)) continue;
    let hosts = toStringArray(parseJSON(route.fromDomain));
    if (hosts.length === 0 && route.default_sni) hosts = [route.default_sni];
    for (const host of hosts) {
      addTarget(host, 'Layer 4');
    }
  }

  return targets;
}

async function getCaddyAppDataDir() {
  if (cachedAppDataDir) return cachedAppDataDir;
  const { stdout } = await execCaddyPromise(['environ']);
  const match = stdout.match(/caddy\.AppDataDir=(.+)/);
  if (!match) throw new Error('Could not find Caddy AppDataDir');
  cachedAppDataDir = match[1].trim();
  return cachedAppDataDir;
}

async function readRecentTextFile(filePath, maxBytes = 256 * 1024) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString('utf-8');
  } finally {
    await handle.close();
  }
}

function parseCaddyLogLine(line) {
  try {
    const entry = JSON.parse(line);
    return {
      time: entry.ts ? new Date(entry.ts * 1000).toISOString() : '',
      level: entry.level || '',
      logger: entry.logger || '',
      msg: entry.msg || '',
      error: entry.error || '',
      raw: line
    };
  } catch (e) {
    return { time: '', level: '', logger: '', msg: line, error: '', raw: line };
  }
}

async function readAcmeLogEntries(targetHosts) {
  const logPath = path.join(logsDir, 'caddy-global.log');
  let text = '';
  try {
    text = await readRecentTextFile(logPath);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const terms = ['acme', 'letsencrypt', 'certificate', 'challenge', 'issuer', 'tls.obtain', 'tls.renew', 'tls.cache'];
  const hosts = targetHosts.map(host => host.toLowerCase());
  return text.split('\n')
    .filter(Boolean)
    .filter(line => {
      const lower = line.toLowerCase();
      return terms.some(term => lower.includes(term)) || hosts.some(host => lower.includes(host));
    })
    .slice(-80)
    .map(parseCaddyLogLine);
}

async function findManagedCertificateHosts(certificateHosts) {
  const found = new Set();
  if (certificateHosts.length === 0) return found;

  let certificatesDir;
  try {
    certificatesDir = path.join(await getCaddyAppDataDir(), 'certificates');
  } catch (e) {
    return found;
  }

  async function walk(dir, depth = 0) {
    if (depth > 6) return;
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      const lowerPath = entryPath.toLowerCase();
      if (entry.isDirectory()) {
        await walk(entryPath, depth + 1);
      } else if (/\.(crt|pem)$/.test(entry.name.toLowerCase())) {
        for (const host of certificateHosts) {
          if (lowerPath.includes(host.toLowerCase())) {
            found.add(host);
          }
        }
      }
    }
  }

  await walk(certificatesDir);
  return found;
}

function pfxCertificateId(source, certPath, keyPath) {
  return crypto
    .createHash('sha256')
    .update(`${source}\0${certPath}\0${keyPath}`)
    .digest('hex');
}

function safeDownloadName(value, fallback = 'certificate') {
  const name = String(value || fallback).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return name || fallback;
}

function parseCertificateDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstCertificateInput(buffer) {
  const text = buffer.toString('utf-8');
  const match = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  return match ? match[0] : buffer;
}

async function readCertificateMetadata(certPath) {
  try {
    const input = firstCertificateInput(await fs.promises.readFile(certPath));
    const certificate = new crypto.X509Certificate(input);
    const validFrom = parseCertificateDate(certificate.validFrom);
    const validTo = parseCertificateDate(certificate.validTo);
    const daysRemaining = validTo ? Math.ceil((validTo.getTime() - Date.now()) / 86400000) : null;

    return {
      validFrom: validFrom ? validFrom.toISOString() : '',
      validTo: validTo ? validTo.toISOString() : '',
      daysRemaining,
      expired: typeof daysRemaining === 'number' ? daysRemaining < 0 : false,
      expiresSoon: typeof daysRemaining === 'number' ? daysRemaining >= 0 && daysRemaining <= 30 : false,
      subject: certificate.subject || '',
      certificateIssuer: certificate.issuer || '',
      subjectAltName: certificate.subjectAltName || '',
      serialNumber: certificate.serialNumber || '',
      fingerprint256: certificate.fingerprint256 || ''
    };
  } catch (err) {
    return {
      validFrom: '',
      validTo: '',
      daysRemaining: null,
      expired: false,
      expiresSoon: false,
      certificateParseError: err.message
    };
  }
}

function publicCertificateMetadata(certificate) {
  return {
    validFrom: certificate.validFrom || '',
    validTo: certificate.validTo || '',
    daysRemaining: typeof certificate.daysRemaining === 'number' ? certificate.daysRemaining : null,
    expired: Boolean(certificate.expired),
    expiresSoon: Boolean(certificate.expiresSoon),
    subject: certificate.subject || '',
    certificateIssuer: certificate.certificateIssuer || '',
    subjectAltName: certificate.subjectAltName || '',
    serialNumber: certificate.serialNumber || '',
    fingerprint256: certificate.fingerprint256 || '',
    certificateParseError: certificate.certificateParseError || ''
  };
}

async function listCertificatePairs(rootDir, options = {}) {
  const pairs = [];
  const source = options.source || 'Certificate';
  const recursive = Boolean(options.recursive);
  const maxDepth = options.maxDepth || 6;

  async function scan(dir, depth = 0) {
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    const files = entries.filter(entry => entry.isFile()).map(entry => entry.name);
    const keys = new Map(
      files
        .filter(name => name.toLowerCase().endsWith('.key'))
        .map(name => [name.replace(/\.key$/i, '').toLowerCase(), name])
    );
    const certs = files.filter(name => /\.(crt|pem|cer)$/i.test(name));

    for (const certName of certs) {
      const base = certName.replace(/\.(crt|pem|cer)$/i, '');
      const keyName = keys.get(base.toLowerCase());
      if (!keyName) continue;

      const certPath = path.join(dir, certName);
      const keyPath = path.join(dir, keyName);
      const relDir = path.relative(rootDir, dir);
      const relCert = path.relative(rootDir, certPath);
      const relKey = path.relative(rootDir, keyPath);
      const issuer = relDir && relDir !== '.' ? relDir.split(path.sep)[0] : '';
      const host = base.toLowerCase();
      const metadata = await readCertificateMetadata(certPath);

      pairs.push({
        id: pfxCertificateId(source, certPath, keyPath),
        name: base,
        host,
        source,
        issuer,
        certRelPath: relCert,
        keyRelPath: relKey,
        certPath,
        keyPath,
        storageDir: dir,
        renewable: source === 'Caddy-managed ACME',
        ...metadata
      });
    }

    if (!recursive || depth >= maxDepth) return;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await scan(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  await scan(rootDir);
  return pairs;
}

async function listPfxCertificates() {
  const customPairs = await listCertificatePairs(certDir, { source: 'Custom upload' });
  let managedPairs = [];
  try {
    const certificatesDir = path.join(await getCaddyAppDataDir(), 'certificates');
    managedPairs = await listCertificatePairs(certificatesDir, {
      source: 'Caddy-managed ACME',
      recursive: true
    });
  } catch (e) {
    managedPairs = [];
  }

  const byId = new Map();
  for (const pair of [...managedPairs, ...customPairs]) {
    byId.set(pair.id, pair);
  }

  return [...byId.values()].sort((a, b) => {
    return `${a.source}:${a.name}`.localeCompare(`${b.source}:${b.name}`);
  });
}

function publicPfxCertificate(pair) {
  return {
    id: pair.id,
    name: pair.name,
    host: pair.host,
    source: pair.source,
    issuer: pair.issuer,
    certRelPath: pair.certRelPath,
    renewable: Boolean(pair.renewable),
    ...publicCertificateMetadata(pair)
  };
}

async function listCustomCertificateFiles() {
  const dirents = await fs.promises.readdir(certDir, { withFileTypes: true });
  const files = dirents
    .filter(dirent => !dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort((a, b) => a.localeCompare(b));

  return Promise.all(files.map(async (name) => {
    const lowerName = name.toLowerCase();
    const isCertificate = /\.(crt|pem|cer)$/i.test(name);
    const file = {
      name,
      source: 'Custom upload',
      kind: lowerName.endsWith('.key') ? 'key' : (isCertificate ? 'certificate' : 'file')
    };

    if (isCertificate) {
      Object.assign(file, await readCertificateMetadata(path.join(certDir, name)));
    }

    return file;
  }));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function stopCaddyThroughAdmin() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const apiRes = await fetch('http://localhost:2019/stop', {
      method: 'POST',
      headers: { 'Origin': 'http://localhost:2019' },
      signal: controller.signal
    });
    if (!apiRes.ok) {
      throw new Error(`Failed to stop Caddy: ${apiRes.statusText}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForCaddyAdminState(expectedReady, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if ((await isCaddyAdminReady()) === expectedReady) return;
    await sleep(250);
  }
  throw new Error(expectedReady ? 'Caddy admin API did not become reachable' : 'Caddy admin API did not stop');
}

async function restartOrStartCaddy() {
  const wasRunning = await isCaddyAdminReady();
  if (wasRunning) {
    await stopCaddyThroughAdmin();
    await waitForCaddyAdminState(false, 8000);
  }

  await startCaddyDetached();
  await waitForCaddyAdminState(true, 15000);
  return wasRunning ? 'Caddy restarted successfully.' : 'Caddy started successfully.';
}

function renewalBackupRoot() {
  return path.join(path.dirname(certDir), 'renewal-backups', new Date().toISOString().replace(/[:.]/g, '-'));
}

function renewalAssetPaths(certificate) {
  const dir = path.dirname(certificate.certPath);
  const certBase = path.basename(certificate.certPath).replace(/\.(crt|pem|cer)$/i, '');
  const keyBase = path.basename(certificate.keyPath).replace(/\.key$/i, '');
  const names = new Set([
    path.basename(certificate.certPath),
    path.basename(certificate.keyPath),
    `${certBase}.json`,
    `${keyBase}.json`
  ]);
  return [...names].map(name => path.join(dir, name));
}

async function moveFileToBackup(from, to) {
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fs.promises.copyFile(from, to);
    await fs.promises.unlink(from);
  }
}

async function moveRenewalAssetsToBackup(certificate) {
  const backupDir = renewalBackupRoot();
  const moved = [];

  for (const filePath of renewalAssetPaths(certificate)) {
    const backupPath = path.join(backupDir, path.basename(filePath));
    try {
      await moveFileToBackup(filePath, backupPath);
      moved.push({ from: filePath, to: backupPath });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  if (moved.length === 0) {
    throw new Error('No stored certificate assets were found for renewal');
  }

  return { backupDir, moved };
}

async function restoreRenewalAssets(moved) {
  for (const item of [...moved].reverse()) {
    try {
      await moveFileToBackup(item.to, item.from);
    } catch (err) {
      console.error(`Failed to restore certificate asset ${item.from}: ${err.message}`);
    }
  }
}

async function moveCertificatesForRenewal(certificates) {
  const movedGroups = [];
  try {
    for (const certificate of certificates) {
      movedGroups.push(await moveRenewalAssetsToBackup(certificate));
    }
    return movedGroups;
  } catch (err) {
    for (const group of [...movedGroups].reverse()) {
      await restoreRenewalAssets(group.moved);
    }
    throw err;
  }
}

async function restoreRenewalGroups(groups) {
  for (const group of [...groups].reverse()) {
    await restoreRenewalAssets(group.moved);
  }
}

router.post('/certs/letsencrypt/request', async (req, res) => {
  try {
    const targets = configuredAcmeTargets();
    if (targets.length === 0) {
      return res.json({
        output: '',
        stderr: '',
        error: 'No valid Let\'s Encrypt targets are configured. Enable Let\'s Encrypt on a public domain first.',
        targets
      });
    }

    await fs.promises.access(appPaths.caddyfile, fs.constants.F_OK);
    await execCaddyPromise(['validate', '--config', appPaths.caddyfile]);

    if (await isCaddyAdminReady()) {
      await loadCaddyfileThroughAdmin();
      return res.json({
        output: 'Caddy reloaded successfully. Let\'s Encrypt certificate issuance has been requested for configured ACME domains.',
        stderr: '',
        error: undefined,
        targets
      });
    }

    await startCaddyDetached();
    res.json({
      output: 'Caddy start command executed. Let\'s Encrypt certificate issuance has been requested for configured ACME domains.',
      stderr: '',
      error: undefined,
      targets
    });
  } catch (err) {
    res.json({
      output: err.stdout || '',
      stderr: err.stderr || '',
      error: err.message
    });
  }
});

router.get('/certs/letsencrypt/status', async (req, res) => {
  try {
    const targets = configuredAcmeTargets();
    const hosts = targets.map(target => target.host);
    const [caddyRunning, foundHosts, logs] = await Promise.all([
      isCaddyAdminReady(),
      findManagedCertificateHosts(hosts),
      readAcmeLogEntries(hosts)
    ]);

    res.json({
      checkedAt: new Date().toISOString(),
      caddyRunning,
      targets: targets.map(target => ({
        ...target,
        certificateFound: foundHosts.has(target.host)
      })),
      logs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/certs/letsencrypt/renew', express.json(), async (req, res) => {
  const { id } = req.body || {};
  if (typeof id !== 'string' || !id) {
    return res.status(400).json({ error: 'Missing certificate selection' });
  }

  let movedAssets = null;
  try {
    const certificate = (await listPfxCertificates()).find(pair => pair.id === id);
    if (!certificate) {
      return res.status(404).json({ error: 'Certificate/key pair not found' });
    }
    if (!certificate.renewable) {
      return res.status(400).json({ error: 'Only Caddy-managed ACME certificates can be renewed here' });
    }

    setGeneralTlsKeyTypeStmt.run('rsa2048');
    await writeStructuredCaddyfileFromDb();
    await fs.promises.access(appPaths.caddyfile, fs.constants.F_OK);
    await execCaddyPromise(['validate', '--config', appPaths.caddyfile]);

    movedAssets = await moveRenewalAssetsToBackup(certificate);
    const restartMessage = await restartOrStartCaddy();

    res.json({
      output: `Manual renewal requested for ${certificate.name}. ${restartMessage}`,
      stderr: '',
      error: undefined,
      certificate: publicPfxCertificate(certificate),
      movedAssets: movedAssets.moved.map(item => path.basename(item.from)),
      backupDir: movedAssets.backupDir
    });
  } catch (err) {
    if (movedAssets) {
      await restoreRenewalAssets(movedAssets.moved);
    }
    res.status(500).json({
      output: err.stdout || '',
      stderr: err.stderr || '',
      error: err.message
    });
  }
});

router.post('/certs/letsencrypt/renew-all-rsa', express.json(), async (req, res) => {
  let movedGroups = [];
  try {
    setGeneralTlsKeyTypeStmt.run('rsa2048');
    await writeStructuredCaddyfileFromDb();
    await fs.promises.access(appPaths.caddyfile, fs.constants.F_OK);
    await execCaddyPromise(['validate', '--config', appPaths.caddyfile]);

    const certificates = (await listPfxCertificates()).filter(pair => pair.renewable);
    if (certificates.length === 0) {
      return res.status(404).json({ error: 'No Caddy-managed ACME certificates found' });
    }

    movedGroups = await moveCertificatesForRenewal(certificates);
    const restartMessage = await restartOrStartCaddy();

    res.json({
      output: `RSA renewal requested for ${certificates.length} Caddy-managed ACME certificate(s). ${restartMessage}`,
      stderr: '',
      error: undefined,
      certificates: certificates.map(publicPfxCertificate),
      backupDirs: movedGroups.map(group => group.backupDir)
    });
  } catch (err) {
    if (movedGroups.length > 0) {
      await restoreRenewalGroups(movedGroups);
    }
    res.status(500).json({
      output: err.stdout || '',
      stderr: err.stderr || '',
      error: err.message
    });
  }
});

router.get('/certs/pfx/list', async (req, res) => {
  try {
    const certificates = await listPfxCertificates();
    res.json(certificates.map(publicPfxCertificate));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/certs/pfx/download', express.json(), async (req, res) => {
  const { id, password } = req.body || {};
  if (typeof id !== 'string' || !id) {
    return res.status(400).send('Missing certificate selection');
  }
  if (typeof password !== 'string' || password.length < 1 || password.length > 256 || password.includes('\0')) {
    return res.status(400).send('Password must be between 1 and 256 characters');
  }

  const certificate = (await listPfxCertificates()).find(pair => pair.id === id);
  if (!certificate) {
    return res.status(404).send('Certificate/key pair not found');
  }

  const outputName = `${safeDownloadName(certificate.name)}.pfx`;
  const env = {
    ...process.env,
    LOCALCADDYHUB_PFX_PASSWORD: password
  };
  const args = [
    'pkcs12',
    '-export',
    '-inkey', certificate.keyPath,
    '-in', certificate.certPath,
    '-out', '-',
    '-name', certificate.name,
    '-passout', 'env:LOCALCADDYHUB_PFX_PASSWORD'
  ];

  execFile('openssl', args, { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024, env }, (error, stdout, stderr) => {
    if (error) {
      console.error(`PFX export failed: ${stderr ? stderr.toString('utf-8') : error.message}`);
      return res.status(500).send(stderr ? stderr.toString('utf-8') : error.message);
    }

    res.setHeader('Content-Type', 'application/x-pkcs12');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(stdout);
  });
});

router.get('/certs/references/missing', async (req, res) => {
  try {
    res.json(await missingCertificateReferences());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/certs/references/cleanup', express.json(), async (req, res) => {
  try {
    const missing = await missingCertificateReferences();
    const cleared = clearCertificateReferencesForFiles(missing.map(reference => reference.file));
    await writeStructuredCaddyfileFromDb();
    res.json({ missing, cleared });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/certs/acme/download', async (req, res) => {
  try {
    const certificatesDir = path.join(await getCaddyAppDataDir(), 'certificates');
    return await serveCertificates(certificatesDir, res);
  } catch (error) {
    console.error('Failed to query Caddy environment:', error);
    return res.status(500).send(error.message || 'Failed to query Caddy environment');
  }
});

async function serveCertificates(certificatesDir, res) {
  try {
    await fs.promises.access(certificatesDir, fs.constants.F_OK);
  } catch (err) {
    return res.status(404).send('No Caddy-managed ACME certificates found.');
  }

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', 'attachment; filename="caddy-acme-certificates.tar.gz"');

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
    res.json(await listCustomCertificateFiles());
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
  if (!isSafeFilename(filename)) {
    return res.status(400).send('Invalid filename');
  }
  const removeReferences = req.query.removeReferences === '1';
  const references = certificateReferenceRows().filter(reference => reference.file === filename);
  if (references.length > 0 && !removeReferences) {
    return res.status(409).json({
      error: 'Certificate is still referenced by the configuration',
      references
    });
  }

  const filePath = path.join(certDir, filename);
  try {
    let clearedReferences = [];
    if (removeReferences) {
      clearedReferences = clearCertificateReferencesForFiles([filename]);
      await writeStructuredCaddyfileFromDb();
    }

    // ⚡ Bolt: Use asynchronous unlink to prevent event loop blocking,
    // and catch ENOENT instead of using existsSync to avoid TOCTOU races.
    await fs.promises.unlink(filePath);
    res.json({ deleted: true, clearedReferences });
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.status(404).send('File not found');
    } else {
      res.status(500).send('Failed to delete file');
    }
  }
});

module.exports = router;
