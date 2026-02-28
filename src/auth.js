const crypto = require('crypto');
const db = require('./db');

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function authMiddleware(req, res, next) {
  const allowList = ['/login', '/login.html'];
  if (allowList.includes(req.path)) {
    return next();
  }

  const token = req.cookies.session;
  let valid = false;

  if (token) {
    const stmt = db.prepare('SELECT expires_at FROM sessions WHERE token = ?');
    const session = stmt.get(token);

    if (session) {
      if (Date.now() < session.expires_at) {
        valid = true;
      } else {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
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
