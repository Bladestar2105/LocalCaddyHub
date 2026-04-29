const fs = require('fs');
const path = require('path');

function resolveCaddyBinary() {
  const configured = process.env.CADDY_BIN && process.env.CADDY_BIN.trim();
  if (configured) return configured;

  const localBinary = path.join(__dirname, '..', '.codex-bin', 'caddy');
  try {
    fs.accessSync(localBinary, fs.constants.X_OK);
    return localBinary;
  } catch (err) {
    return 'caddy';
  }
}

module.exports = { resolveCaddyBinary };
