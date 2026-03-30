const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const bcrypt = require('bcrypt');

const { generateSecret, verifySync, generateURI } = require('otplib');
const qrcode = require('qrcode');
const { generateSessionToken, authMiddleware, csrfMiddleware } = require('./auth');
const { safeCompare } = require('./utils');
const apiRoutes = require('./api');
const appPaths = require('./paths');
const fs = require('fs');

// Handle --help or -h flags for CI compatibility
if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log('Usage: node src/index.js [options]');
  process.exit(0);
}

// ⚡ Bolt: Cache prepared SQL statements at module level to eliminate parsing overhead on every request
const getUserStmt = db.prepare('SELECT * FROM users WHERE id = 1');
const insertSessionStmt = db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)');
const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE token = ?');
const updateUserAuthStmt = db.prepare('UPDATE users SET username=?, password_hash=? WHERE id=1');
const insertUserAuthStmt = db.prepare('INSERT INTO users (id, username, password_hash) VALUES (1, ?, ?)');
const getUsernameStmt = db.prepare('SELECT username FROM users WHERE id = 1');
const updateTotpSecretStmt = db.prepare('UPDATE users SET totp_secret=?, totp_enabled=1 WHERE id=1');
const disableTotpStmt = db.prepare('UPDATE users SET totp_secret=NULL, totp_enabled=0 WHERE id=1');
const getTotpEnabledStmt = db.prepare('SELECT totp_enabled FROM users WHERE id = 1');

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

// 🛡️ Sentinel: Simple IP-based rate limiter for login attempts to prevent brute force
const loginAttempts = new Map();

// 🛡️ Sentinel: Active eviction strategy to prevent memory leaks from IP addresses
// that fail fewer times than the lockout threshold and are never locked out.
setInterval(() => {
  const now = Date.now();
  const evictionTime = 15 * 60 * 1000; // 15 minutes
  for (const [ip, attempts] of loginAttempts.entries()) {
    if (attempts.lockedUntil && now >= attempts.lockedUntil) {
      loginAttempts.delete(ip);
    } else if (attempts.lastAttempt && now - attempts.lastAttempt > evictionTime) {
      loginAttempts.delete(ip);
    }
  }
}, 15 * 60 * 1000); // Run every 15 minutes

function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const lockoutTime = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;

  let attempts = loginAttempts.get(ip);
  if (attempts && attempts.lockedUntil) {
    if (now < attempts.lockedUntil) {
      return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    } else {
      loginAttempts.delete(ip);
      attempts = null;
    }
  }

  req.loginAttemptsInfo = { ip, attempts };
  next();
}

// Authentication Routes (unprotected)
app.post('/login', loginRateLimiter, async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  const tokenInput = req.body.totp;

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(401).json({ error: 'unauthorized' });
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
           return res.status(401).json({ error: 'invalid_totp' });
        }
        let isValid = false;
        try {
          isValid = verifySync({ token: tokenInput, secret: userRow.totp_secret }).valid;
        } catch (err) {
          // Ignore format errors etc and treat as invalid
        }
        if (!isValid) {
          return res.status(401).json({ error: 'invalid_totp' });
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
    const sessionToken = generateSessionToken();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    insertSessionStmt.run(sessionToken, expiresAt);

    res.cookie('session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict', // 🛡️ Sentinel: Prevent CSRF by not sending cookie cross-site
      maxAge: 86400000 // 24 hours in milliseconds
    });

    // Clear failed attempts on successful login
    if (req.loginAttemptsInfo && req.loginAttemptsInfo.ip) {
      loginAttempts.delete(req.loginAttemptsInfo.ip);
    }
    return res.json({ success: true, needsSetup });
  }

  // Record failed attempt
  if (req.loginAttemptsInfo && req.loginAttemptsInfo.ip) {
    const { ip, attempts } = req.loginAttemptsInfo;
    let newCount = attempts ? attempts.count + 1 : 1;
    let lockedUntil = newCount >= 5 ? Date.now() + 15 * 60 * 1000 : null; // 15 min lockout after 5 fails
    loginAttempts.set(ip, { count: newCount, lockedUntil, lastAttempt: Date.now() });
  }

  res.status(401).json({ error: 'unauthorized' });
});

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
app.post('/api/setup', async (req, res) => {
  const { newUsername, newPassword } = req.body;
  if (!newUsername || !newPassword) return res.status(400).send('Missing fields');
  if (typeof newUsername !== 'string' || typeof newPassword !== 'string') return res.status(400).send('Invalid fields');

  const userRow = getUserStmt.get();
  if (userRow) {
    const hash = await bcrypt.hash(newPassword, 10);
    updateUserAuthStmt.run(newUsername, hash);
  } else {
    const hash = await bcrypt.hash(newPassword, 10);
    insertUserAuthStmt.run(newUsername, hash);
  }
  res.json({ success: true });
});

app.post('/api/2fa/generate', async (req, res) => {
  const secret = generateSecret();
  const userRow = getUsernameStmt.get();
  const username = userRow ? userRow.username : process.env.ADMIN_USER;

  const otpauth = generateURI({ label: username, issuer: 'LocalCaddyHub', secret });
  const imageUrl = await qrcode.toDataURL(otpauth);

  res.json({ secret, qrCodeUrl: imageUrl });
});

app.post('/api/2fa/verify', (req, res) => {
  const { token, secret } = req.body;
  let isValid = false;
  try {
    isValid = verifySync({ token, secret }).valid;
  } catch (err) {
    // Treat format/length errors as invalid
  }

  if (isValid) {
    updateTotpSecretStmt.run(secret);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid token' });
  }
});

app.post('/api/2fa/disable', (req, res) => {
  disableTotpStmt.run();
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

// Start server
app.listen(port, () => {
  console.log(`LocalCaddyHub running on port ${port}`);

  // Auto-start Caddy if a Caddyfile exists
  if (fs.existsSync(appPaths.caddyfile)) {
    console.log('Found Caddyfile, starting Caddy...');
    const { spawn } = require('child_process');
    const cp = spawn('caddy', ['start', '--config', appPaths.caddyfile], {
      detached: true,
      stdio: 'ignore'
    });
    cp.unref();
    cp.on('error', (err) => {
      console.error('Failed to start Caddy on boot:', err.message);
    });
    cp.on('exit', (code) => {
      if (code === 0 || code === null) {
        console.log('Caddy started successfully on boot.');
      } else {
        console.error('Caddy exited with code', code);
      }
    });
  }
});
