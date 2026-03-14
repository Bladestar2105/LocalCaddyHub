const crypto = require('crypto');

/**
 * Helper for timing-safe comparison to prevent timing attacks.
 * Uses HMAC to ensure both buffers have the same length (32 bytes for SHA256)
 * regardless of input length, preventing length-based timing attacks.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  const key = crypto.randomBytes(32);
  const hmacA = crypto.createHmac('sha256', key).update(a).digest();
  const hmacB = crypto.createHmac('sha256', key).update(b).digest();

  return crypto.timingSafeEqual(hmacA, hmacB);
}

module.exports = {
  safeCompare,
};
