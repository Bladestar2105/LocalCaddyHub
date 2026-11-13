if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log('Usage: node src/index.js [options]');
  process.exit(0);
}

process.umask(0o077);

const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const bcrypt = require('bcrypt');

const { generateSecret, verifySync, generateURI } = require('otplib');
const qrcode = require('qrcode');
const { generateSessionToken, authMiddleware, csrfMiddleware } = require('./auth');
const { safeCompare, asyncHandler } = require('./utils');
const { loginRateLimiter, clearAttempts } = require('./rateLimiter');
const apiRoutes = require('./api');
const appPaths = require('./paths');
const { resolveCaddyBinary } = require('./caddyBinary');
const fs = require('fs');

// ⚡ Bolt: Cache prepared SQL statements at module level to eliminate parsing overhead on every request
const getUserStmt = db.prepare('SELECT * FROM users WHERE id = 1');
const insertSessionStmt = db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)');
const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE token = ?');
const deleteAllSessionsStmt = db.prepare('DELETE FROM sessions');
const getSessionStmt = db.prepare('SELECT expires_at FROM sessions WHERE token = ?');
const updateUserAuthStmt = db.prepare('UPDATE users SET username=?, password_hash=? WHERE id=1');
const insertUserAuthStmt = db.prepare('INSERT INTO users (id, username, password_hash) VALUES (1, ?, ?)');
const getUsernameStmt = db.prepare('SELECT username FROM users WHERE id = 1');
const updateTotpSecretStmt = db.prepare('UPDATE users SET totp_secret=?, totp_enabled=1 WHERE id=1');
const disableTotpStmt = db.prepare('UPDATE users SET totp_secret=NULL, totp_enabled=0 WHERE id=1');
const getTotpEnabledStmt = db.prepare('SELECT totp_enabled FROM users WHERE id = 1');

function setSessionCookie(res, token) {
  res.cookie('session', token, { path: '/', httpOnly: true, sameSite: 'strict', maxAge: 86400000 });
}

const updateAuthentication = db.transaction((currentToken, update) => {
  const session = getSessionStmt.get(currentToken);
  if (!session || Date.now() >= session.expires_at) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }
  update();
  deleteAllSessionsStmt.run();
  const token = generateSessionToken();
  insertSessionStmt.run(token, Date.now() + 86400000);
  return token;
});

const app = express();
const port = process.env.PORT || 8090;

app.disable('x-powered-by'); // 🛡️ Sentinel: Prevent leaking Express version

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// 🛡️ Sentinel: Add security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Authentication Routes (unprotected)
app.post('/login', loginRateLimiter, asyncHandler(async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  const tokenInput = req.body.totp;
  const rejectLogin = (error = 'unauthorized') => {
    return res.status(401).json({ error });
  };

  if (typeof username !== 'string' || typeof password !== 'string') {
    return rejectLogin();
  }

  const expectedUserEnv = process.env.ADMIN_USER;
  const expectedPassEnv = process.env.ADMIN_PASS;

  const userRow = getUserStmt.get();

  let validLogin = false;
  let needsSetup = false;

  if (userRow) {
    // Database user exists
    const userMatch = username === userRow.username;
    // 🛡️ Sentinel: Always perform the bcrypt comparison to prevent username enumeration timing attacks.
    const passMatch = await bcrypt.compare(password, userRow.password_hash);

    if (userMatch && passMatch) {
      if (userRow.totp_enabled) {
        if (!tokenInput) {
           return rejectLogin('invalid_totp');
        }
        let isValid = false;
        try {
          isValid = verifySync({ token: tokenInput, secret: userRow.totp_secret }).valid;
        } catch (err) {
          // Ignore format errors etc and treat as invalid
        }
        if (!isValid) {
          return rejectLogin('invalid_totp');
        }
      }
      validLogin = true;
    }
  } else if (expectedUserEnv && expectedPassEnv) {
    // Fallback to env vars if no DB user is set up yet, and env vars are explicitly defined
    // 🛡️ Sentinel: Avoid logical short-circuiting to prevent timing leaks
    const envUserMatch = safeCompare(username, expectedUserEnv);
    const envPassMatch = safeCompare(password, expectedPassEnv);
    if (envUserMatch && envPassMatch) {
      validLogin = true;
      needsSetup = true; // Must change password
    }
  }

  if (validLogin) {
    // A password/MFA change may have revoked these credentials during the bcrypt check.
    const currentUser = getUserStmt.get();
    if (Boolean(currentUser) !== Boolean(userRow) || (userRow &&
      ['username', 'password_hash', 'totp_secret', 'totp_enabled'].some(field => currentUser[field] !== userRow[field]))) {
      return rejectLogin();
    }
    const sessionToken = generateSessionToken();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    insertSessionStmt.run(sessionToken, expiresAt);

    setSessionCookie(res, sessionToken);

    // Clear failed attempts on successful login
    if (req.loginAttemptsInfo && req.loginAttemptsInfo.ip) {
      clearAttempts(req.loginAttemptsInfo.ip);
    }
    return res.json({ success: true, needsSetup });
  }

  rejectLogin();
}));

app.get('/logout', (req, res) => {
  const token = req.cookies.session;
  if (token) {
    deleteSessionStmt.run(token);
  }

  res.clearCookie('session', { path: '/' });
  res.redirect('/login.html');
});

// Middleware for protected routes
app.use(authMiddleware);
app.use(csrfMiddleware);

// Setup & 2FA Routes (Protected, but some exceptions in API logic for setup)
app.post('/api/setup', asyncHandler(async (req, res) => {
  const { newUsername, newPassword } = req.body;
  if (!newUsername || !newPassword) return res.status(400).send('Missing fields');
  if (typeof newUsername !== 'string' || typeof newPassword !== 'string') return res.status(400).send('Invalid fields');
  if (!newUsername.trim() || newUsername.length > 128 || newPassword.length < 12 || Buffer.byteLength(newPassword, 'utf8') > 72) {
    return res.status(400).send('Use a username of 1–128 characters and a password of at least 12 characters and at most 72 UTF-8 bytes');
  }

  const hash = await bcrypt.hash(newPassword, 10);
  const token = updateAuthentication(req.cookies.session, () => {
    if (getUserStmt.get()) updateUserAuthStmt.run(newUsername, hash);
    else insertUserAuthStmt.run(newUsername, hash);
  });
  setSessionCookie(res, token);
  res.json({ success: true });
}));

app.post('/api/2fa/generate', asyncHandler(async (req, res) => {
  const secret = generateSecret();
  const userRow = getUsernameStmt.get();
  const username = userRow ? userRow.username : process.env.ADMIN_USER;

  const otpauth = generateURI({ label: username, issuer: 'LocalCaddyHub', secret });
  const imageUrl = await qrcode.toDataURL(otpauth);

  res.json({ secret, qrCodeUrl: imageUrl });
}));

app.post('/api/2fa/verify', (req, res) => {
  const { token, secret } = req.body;
  let isValid = false;
  try {
    isValid = verifySync({ token, secret }).valid;
  } catch (err) {
    // Treat format/length errors as invalid
  }

  if (isValid) {
    const sessionToken = updateAuthentication(req.cookies.session, () => updateTotpSecretStmt.run(secret));
    setSessionCookie(res, sessionToken);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid token' });
  }
});

app.post('/api/2fa/disable', (req, res) => {
  const token = updateAuthentication(req.cookies.session, () => disableTotpStmt.run());
  setSessionCookie(res, token);
  res.json({ success: true });
});

app.get('/api/2fa/status', (req, res) => {
  const userRow = getTotpEnabledStmt.get();
  res.json({ enabled: userRow ? Boolean(userRow.totp_enabled) : false });
});

// API routes
app.use('/api', apiRoutes);

// Static frontend files
app.use(express.static(path.join(__dirname, '..', 'static')));

app.use((err, req, res, next) => {
  console.error(err.message);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Internal server error' });
});

// Start server
app.listen(port, () => {
  console.log(`LocalCaddyHub listening on port ${port}`);
  // Auto-start Caddy if a Caddyfile exists
  if (process.env.CADDY_AUTOSTART !== '0' && fs.existsSync(appPaths.caddyfile)) {
    const { spawn } = require('child_process');
    const cp = spawn(resolveCaddyBinary(), ['start', '--config', appPaths.caddyfile], {
      detached: true,
      stdio: 'ignore'
    });
    cp.unref();
    cp.on('error', (err) => {
      console.error('Failed to start Caddy on boot:', err.message);
    });
    cp.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error('Caddy exited with code', code);
      }
    });
  }
});
