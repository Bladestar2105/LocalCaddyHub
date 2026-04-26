// 🛡️ Sentinel: Login rate limiting and eviction constants
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes
const LOGIN_EVICTION_TIME = 15 * 60 * 1000; // 15 minutes

// 🛡️ Sentinel: Simple IP-based rate limiter for login attempts to prevent brute force
const loginAttempts = new Map();

// 🛡️ Sentinel: Active eviction strategy to prevent memory leaks from IP addresses
// that fail fewer times than the lockout threshold and are never locked out.
const evictionInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, attempts] of loginAttempts.entries()) {
    if (attempts.lockedUntil && now >= attempts.lockedUntil) {
      loginAttempts.delete(ip);
    } else if (attempts.lastAttempt && now - attempts.lastAttempt > LOGIN_EVICTION_TIME) {
      loginAttempts.delete(ip);
    }
  }
}, LOGIN_EVICTION_TIME);

/**
 * Middleware for IP-based rate limiting of login attempts.
 */
function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

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

/**
 * Records a failed login attempt for the given IP.
 * Locks the IP if LOGIN_MAX_ATTEMPTS is reached.
 * @param {string} ip
 */
function recordFailedAttempt(ip) {
  if (!ip) return;
  const attempts = loginAttempts.get(ip);
  const newCount = attempts ? attempts.count + 1 : 1;
  const lockedUntil = newCount >= LOGIN_MAX_ATTEMPTS ? Date.now() + LOGIN_LOCKOUT_TIME : null;
  loginAttempts.set(ip, { count: newCount, lockedUntil, lastAttempt: Date.now() });
}

/**
 * Clears all login attempt records for the given IP.
 * @param {string} ip
 */
function clearAttempts(ip) {
  if (!ip) return;
  loginAttempts.delete(ip);
}

module.exports = {
  loginRateLimiter,
  recordFailedAttempt,
  clearAttempts,
  // Exported for testing
  loginAttempts,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_LOCKOUT_TIME,
  LOGIN_EVICTION_TIME,
  evictionInterval
};
