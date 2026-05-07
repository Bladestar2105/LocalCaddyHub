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

// 🛡️ Sentinel: separate, slightly more permissive limiter for post-auth
// sensitive actions (2FA enable/verify/disable, password change). The same
// IP-based bucket would lock out legitimate operators who test 2FA repeatedly,
// so we track a different counter with its own threshold and window.
const SENSITIVE_MAX_ATTEMPTS = 10;
const SENSITIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const sensitiveAttempts = new Map();

const sensitiveEvictionInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sensitiveAttempts.entries()) {
    if (now - entry.firstAttempt > SENSITIVE_WINDOW_MS) {
      sensitiveAttempts.delete(key);
    }
  }
}, SENSITIVE_WINDOW_MS);

function sensitiveActionLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  let entry = sensitiveAttempts.get(ip);
  if (entry && now - entry.firstAttempt > SENSITIVE_WINDOW_MS) {
    sensitiveAttempts.delete(ip);
    entry = null;
  }

  if (entry && entry.count >= SENSITIVE_MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((entry.firstAttempt + SENSITIVE_WINDOW_MS - now) / 1000);
    res.setHeader('Retry-After', String(Math.max(retryAfterSec, 1)));
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  if (entry) {
    entry.count += 1;
  } else {
    sensitiveAttempts.set(ip, { count: 1, firstAttempt: now });
  }
  next();
}

module.exports = {
  loginRateLimiter,
  recordFailedAttempt,
  clearAttempts,
  sensitiveActionLimiter,
  // Exported for testing
  loginAttempts,
  sensitiveAttempts,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_LOCKOUT_TIME,
  LOGIN_EVICTION_TIME,
  SENSITIVE_MAX_ATTEMPTS,
  SENSITIVE_WINDOW_MS,
  evictionInterval,
  sensitiveEvictionInterval
};
