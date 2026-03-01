const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const appPaths = require('./paths');

const db = new Database(appPaths.db);

db.pragma('journal_mode = WAL');

// Initialize database schema
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS general_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER DEFAULT 0,
      enable_layer4 INTEGER DEFAULT 0,
      http_port TEXT,
      https_port TEXT,
      log_level TEXT,
      tls_email TEXT,
      http_versions TEXT,
      timeout_read_body TEXT,
      timeout_read_header TEXT,
      timeout_write TEXT,
      timeout_idle TEXT,
      log_credentials INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      fromDomain TEXT,
      fromPort TEXT,
      accesslist TEXT, -- JSON array
      basicauth TEXT, -- JSON array
      description TEXT,
      accessLog INTEGER DEFAULT 0,
      disableTls INTEGER DEFAULT 0,
      customCert TEXT,
      client_auth_mode TEXT,
      client_auth_trust_pool TEXT
    );

    CREATE TABLE IF NOT EXISTS subdomains (
      id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      reverse TEXT, -- ID of Domain
      fromDomain TEXT,
      accesslist TEXT, -- JSON array
      basicauth TEXT, -- JSON array
      description TEXT,
      client_auth_mode TEXT,
      client_auth_trust_pool TEXT
    );

    CREATE TABLE IF NOT EXISTS handlers (
      id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      reverse TEXT, -- ID of Domain
      subdomain TEXT, -- ID of Subdomain
      handleType TEXT,
      handlePath TEXT,
      accesslist TEXT, -- JSON array
      basicauth TEXT, -- JSON array
      header TEXT, -- JSON array
      handleDirective TEXT,
      toDomain TEXT, -- JSON array
      toPort TEXT,
      httpTls INTEGER DEFAULT 0,
      ntlm INTEGER DEFAULT 0,
      description TEXT,
      lb_policy TEXT,
      lb_retries INTEGER DEFAULT 0,
      lb_try_duration TEXT,
      lb_try_interval TEXT,
      health_fails INTEGER DEFAULT 0,
      health_passes INTEGER DEFAULT 0,
      health_timeout TEXT,
      health_interval TEXT,
      health_uri TEXT,
      health_port TEXT,
      health_status TEXT,
      health_body TEXT,
      health_follow_redirects INTEGER DEFAULT 0,
      to_path TEXT,
      http_version TEXT,
      http_keepalive TEXT,
      http_tls_insecure_skip_verify INTEGER DEFAULT 0,
      http_tls_trusted_ca_certs TEXT,
      http_tls_server_name TEXT,
      passive_health_fail_duration TEXT,
      passive_health_max_fails TEXT,
      passive_health_unhealthy_status TEXT,
      passive_health_unhealthy_latency TEXT,
      passive_health_unhealthy_request_count TEXT,
      redir_status TEXT DEFAULT '301'
    );

    CREATE TABLE IF NOT EXISTS access_lists (
      id TEXT PRIMARY KEY,
      accesslistName TEXT,
      clientIps TEXT, -- JSON array
      invert INTEGER DEFAULT 0,
      description TEXT,
      http_response_code TEXT,
      http_response_message TEXT,
      request_matcher TEXT DEFAULT 'client_ip'
    );

    CREATE TABLE IF NOT EXISTS basic_auths (
      id TEXT PRIMARY KEY,
      basicauthuser TEXT,
      basicauthpass TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS headers (
      id TEXT PRIMARY KEY,
      headerUpDown TEXT,
      headerType TEXT,
      headerValue TEXT,
      headerReplace TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS layer4 (
      id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      sequence TEXT,
      type TEXT,
      protocol TEXT,
      fromDomain TEXT, -- JSON array
      fromPort TEXT,
      matchers TEXT,
      toDomain TEXT, -- JSON array
      toPort TEXT,
      terminateTls INTEGER DEFAULT 0,
      proxyProtocol TEXT,
      description TEXT,
      originate_tls TEXT,
      remote_ip TEXT,
      lb_policy TEXT,
      passive_health_fail_duration TEXT,
      passive_health_max_fails TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      totp_secret TEXT,
      totp_enabled INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
  `);

  // Initialize general_config if empty
  const stmt = db.prepare('SELECT COUNT(*) AS count FROM general_config');
  const result = stmt.get();
  if (result.count === 0) {
    db.prepare("INSERT INTO general_config (id, enabled, enable_layer4, http_port, https_port, log_level) VALUES (1, 0, 0, '80', '443', 'INFO')").run();
  }

  // Perform schema migrations for existing databases
  const migrations = [
    { table: 'general_config', column: 'tls_email', def: 'TEXT' },
    { table: 'general_config', column: 'http_versions', def: 'TEXT' },
    { table: 'general_config', column: 'timeout_read_body', def: 'TEXT' },
    { table: 'general_config', column: 'timeout_read_header', def: 'TEXT' },
    { table: 'general_config', column: 'timeout_write', def: 'TEXT' },
    { table: 'general_config', column: 'timeout_idle', def: 'TEXT' },
    { table: 'general_config', column: 'log_credentials', def: 'INTEGER DEFAULT 0' },
    { table: 'domains', column: 'client_auth_mode', def: 'TEXT' },
    { table: 'domains', column: 'client_auth_trust_pool', def: 'TEXT' },
    { table: 'subdomains', column: 'client_auth_mode', def: 'TEXT' },
    { table: 'subdomains', column: 'client_auth_trust_pool', def: 'TEXT' },
    { table: 'handlers', column: 'to_path', def: 'TEXT' },
    { table: 'handlers', column: 'http_version', def: 'TEXT' },
    { table: 'handlers', column: 'http_keepalive', def: 'TEXT' },
    { table: 'handlers', column: 'http_tls_insecure_skip_verify', def: 'INTEGER DEFAULT 0' },
    { table: 'handlers', column: 'http_tls_trusted_ca_certs', def: 'TEXT' },
    { table: 'handlers', column: 'http_tls_server_name', def: 'TEXT' },
    { table: 'handlers', column: 'passive_health_fail_duration', def: 'TEXT' },
    { table: 'handlers', column: 'passive_health_max_fails', def: 'TEXT' },
    { table: 'handlers', column: 'passive_health_unhealthy_status', def: 'TEXT' },
    { table: 'handlers', column: 'passive_health_unhealthy_latency', def: 'TEXT' },
    { table: 'handlers', column: 'passive_health_unhealthy_request_count', def: 'TEXT' },
    { table: 'handlers', column: 'redir_status', def: "TEXT DEFAULT '301'" },
    { table: 'access_lists', column: 'http_response_code', def: 'TEXT' },
    { table: 'access_lists', column: 'http_response_message', def: 'TEXT' },
    { table: 'access_lists', column: 'request_matcher', def: "TEXT DEFAULT 'client_ip'" },
    { table: 'layer4', column: 'originate_tls', def: 'TEXT' },
    { table: 'layer4', column: 'remote_ip', def: 'TEXT' },
    { table: 'layer4', column: 'lb_policy', def: 'TEXT' },
    { table: 'layer4', column: 'passive_health_fail_duration', def: 'TEXT' },
    { table: 'layer4', column: 'passive_health_max_fails', def: 'TEXT' }
  ];

  for (const m of migrations) {
    try {
      // Check if column exists, if not, this will throw or we can just catch the error
      const info = db.pragma(`table_info(${m.table})`);
      const exists = info.some(col => col.name === m.column);
      if (!exists) {
        db.prepare(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.def}`).run();
      }
    } catch (e) {
      console.warn(`Failed to migrate ${m.table}.${m.column}: ${e.message}`);
    }
  }
}

initDb();

module.exports = db;
