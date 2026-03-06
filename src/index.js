const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const bcrypt = require('bcrypt');

// Helper for timing-safe comparison to prevent timing attacks on fallback login
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  if (bufferA.length !== bufferB.length) {
    // Dummy comparison to prevent leaking length difference early
    crypto.timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return crypto.timingSafeEqual(bufferA, bufferB);
}
const { generateSecret, verifySync, generateURI } = require('otplib');
const qrcode = require('qrcode');
const { generateSessionToken, authMiddleware, csrfMiddleware } = require('./auth');
const apiRoutes = require('./api');
const { execFile } = require('child_process');
const appPaths = require('./paths');
const fs = require('fs');

// Handle --help or -h flags for CI compatibility
if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log('Usage: node src/index.js [options]');
  process.exit(0);
}

const app = express();
const port = process.env.PORT || 8090;

app.disable('x-powered-by'); // 🛡️ Sentinel: Prevent leaking Express version

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(cors());

// 🛡️ Sentinel: Add security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Authentication Routes (unprotected)
app.post('/login', async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  const tokenInput = req.body.totp;

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const expectedUserEnv = process.env.ADMIN_USER;
  const expectedPassEnv = process.env.ADMIN_PASS;

  const userRow = db.prepare('SELECT * FROM users WHERE id = 1').get();

  let validLogin = false;
  let needsSetup = false;

  if (userRow) {
    // Database user exists
    if (username === userRow.username) {
      const match = await bcrypt.compare(password, userRow.password_hash);
      if (match) {
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
    }
  } else if (expectedUserEnv && expectedPassEnv) {
    // Fallback to env vars if no DB user is set up yet, and env vars are explicitly defined
    if (safeCompare(username, expectedUserEnv) && safeCompare(password, expectedPassEnv)) {
      validLogin = true;
      needsSetup = true; // Must change password
    }
  }

  if (validLogin) {
    const sessionToken = generateSessionToken();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(sessionToken, expiresAt);

    res.cookie('session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict', // 🛡️ Sentinel: Prevent CSRF by not sending cookie cross-site
      maxAge: 86400000 // 24 hours in milliseconds
    });

    return res.json({ success: true, needsSetup });
  }

  res.status(401).json({ error: 'unauthorized' });
});

app.get('/logout', (req, res) => {
  const token = req.cookies.session;
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
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

  const userRow = db.prepare('SELECT * FROM users WHERE id = 1').get();
  if (userRow) {
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET username=?, password_hash=? WHERE id=1').run(newUsername, hash);
  } else {
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('INSERT INTO users (id, username, password_hash) VALUES (1, ?, ?)').run(newUsername, hash);
  }
  res.json({ success: true });
});

app.post('/api/2fa/generate', async (req, res) => {
  const secret = generateSecret();
  const userRow = db.prepare('SELECT username FROM users WHERE id = 1').get();
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
    db.prepare('UPDATE users SET totp_secret=?, totp_enabled=1 WHERE id=1').run(secret);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid token' });
  }
});

app.post('/api/2fa/disable', (req, res) => {
  db.prepare('UPDATE users SET totp_secret=NULL, totp_enabled=0 WHERE id=1').run();
  res.json({ success: true });
});

app.get('/api/2fa/status', (req, res) => {
  const userRow = db.prepare('SELECT totp_enabled FROM users WHERE id = 1').get();
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
    // 🛡️ Sentinel: Fix command injection vulnerability by using execFile instead of exec
    execFile('caddy', ['start', '--config', appPaths.caddyfile], (error, stdout, stderr) => {
      if (error) {
        console.error('Failed to start Caddy on boot:', error.message);
      } else {
        console.log('Caddy started successfully.');
      }
    });
  }
});
