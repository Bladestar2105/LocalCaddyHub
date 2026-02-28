const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { generateSessionToken, authMiddleware, csrfMiddleware } = require('./auth');
const apiRoutes = require('./api');

// Handle --help or -h flags for CI compatibility
if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log('Usage: node src/index.js [options]');
  process.exit(0);
}

const app = express();
const port = process.env.PORT || 8090;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(cors());

// Authentication Routes (unprotected)
app.post('/login', (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  const expectedUser = process.env.ADMIN_USER || 'admin';
  const expectedPass = process.env.ADMIN_PASS || 'admin';

  if (username === expectedUser && password === expectedPass) {
    const token = generateSessionToken();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, expiresAt);

    res.cookie('session', token, {
      path: '/',
      httpOnly: true,
      maxAge: 86400000 // 24 hours in milliseconds
    });
    return res.sendStatus(200);
  }

  res.status(401).send('Unauthorized');
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

// API routes
app.use('/api', apiRoutes);

// Static frontend files
app.use(express.static(path.join(__dirname, '..', 'static')));

// Start server
app.listen(port, () => {
  console.log(`LocalCaddyHub running on port ${port}`);
});
