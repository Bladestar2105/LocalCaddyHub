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

/**
 * Formats a duration value for Caddy. If it's a number, appends 's'.
 * @param {string|number} val
 * @returns {string|number}
 */
function formatDuration(val) {
  if (val === null || val === undefined || val === '' || val === false) return val;
  const strVal = val.toString().trim();
  if (strVal === '') return val;
  if (/^\d+$/.test(strVal)) return strVal + 's';
  return strVal;
}

/**
 * Helper to safely parse JSON or return default.
 * @param {string} str
 * @param {any} def
 * @returns {any}
 */
function parseJSON(str, def = []) {
  if (!str) return def;
  if (str === '[]') return [];
  if (str === '{}') return {};
  try { return JSON.parse(str); } catch { return def; }
}

module.exports = {
  safeCompare,
  formatDuration,
  parseJSON,
};
