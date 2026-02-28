const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'caddyhub.db');
const db = new Database(dbPath);

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
      log_level TEXT
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
      customCert TEXT
    );

    CREATE TABLE IF NOT EXISTS subdomains (
      id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      reverse TEXT, -- ID of Domain
      fromDomain TEXT,
      accesslist TEXT, -- JSON array
      basicauth TEXT, -- JSON array
      description TEXT
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
      health_follow_redirects INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS access_lists (
      id TEXT PRIMARY KEY,
      accesslistName TEXT,
      clientIps TEXT, -- JSON array
      invert INTEGER DEFAULT 0,
      description TEXT
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
      description TEXT
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
}

initDb();

module.exports = db;
