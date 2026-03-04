const crypto = require('crypto');
const db = require('./db');

// ⚡ Bolt: Pre-compile frequently used statements to eliminate parsing overhead on every request
const getSessionStmt = db.prepare('SELECT expires_at FROM sessions WHERE token = ?');
const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE token = ?');
const getFirstUserStmt = db.prepare('SELECT id FROM users WHERE id = 1');

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function authMiddleware(req, res, next) {
  const allowList = ['/login', '/login.html', '/setup.html'];
  if (allowList.includes(req.path)) {
    return next();
  }

  const token = req.cookies.session;
  let valid = false;

  if (token) {
    const session = getSessionStmt.get(token);

    if (session) {
      if (Date.now() < session.expires_at) {
        valid = true;
      } else {
        deleteSessionStmt.run(token);
      }
    }
  }

  if (!valid) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).send('Unauthorized');
    } else {
      return res.redirect('/login.html');
    }
  }

  // Enforce setup if trying to access main app but users table is empty
  if (req.path === '/' || req.path === '/index.html') {
    const userRow = getFirstUserStmt.get();
    if (!userRow) {
      return res.redirect('/setup.html');
    }
  }

  next();
}

function csrfMiddleware(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (!safeMethods.includes(req.method) && req.path.startsWith('/api/')) {
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return res.status(403).send('CSRF check failed: missing X-Requested-With header');
    }
  }
  next();
}

module.exports = {
  generateSessionToken,
  authMiddleware,
  csrfMiddleware,
};
