const path = require('path');
const fs = require('fs');

const appRoot = path.join(__dirname, '..');
const dataDir = path.join(appRoot, 'data');

// Legacy paths (to support existing deployments that mounted files directly)
const legacyDbPath = path.join(appRoot, 'caddyhub.db');
const legacyCaddyfilePath = path.join(appRoot, 'Caddyfile');
const legacyConfigPath = path.join(appRoot, 'config.json');
const legacyCertsDir = path.join(appRoot, 'certs');

// New paths (using /data directory for easier volume mounting)
const newDbPath = path.join(dataDir, 'caddyhub.db');
const newCaddyfilePath = path.join(dataDir, 'Caddyfile');
const newConfigPath = path.join(dataDir, 'config.json');
const newCertsDir = path.join(dataDir, 'certs');

// Check if we should use legacy paths
// We only check for legacyDbPath (caddyhub.db).
// Why? Because Caddyfile is bundled in the Docker image, so it ALWAYS exists.
// Checking for Caddyfile would force legacy mode for all new users, causing data loss
// because their data would be written to the ephemeral /app instead of the mounted /app/data volume.
// caddyhub.db is only created at runtime, so if it exists in the root, it means the user
// either mounted it explicitly (legacy docker run) or is running outside Docker in the old format.
const isLegacy = fs.existsSync(legacyDbPath);

let dbPath, caddyfilePath, configPath, certsDir;

if (isLegacy) {
    dbPath = legacyDbPath;
    caddyfilePath = legacyCaddyfilePath;
    configPath = legacyConfigPath;
    certsDir = legacyCertsDir;

    // Ensure certs directory exists even in legacy mode
    if (!fs.existsSync(certsDir)) {
        fs.mkdirSync(certsDir, { recursive: true });
    }
} else {
    // New structured data directory approach
    dbPath = newDbPath;
    caddyfilePath = newCaddyfilePath;
    configPath = newConfigPath;
    certsDir = newCertsDir;

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // Ensure certs directory exists
    if (!fs.existsSync(certsDir)) {
        fs.mkdirSync(certsDir, { recursive: true });
    }

    // Initialize default Caddyfile if it doesn't exist
    if (!fs.existsSync(caddyfilePath)) {
        // Try to copy from app root if we bundled a default one
        const bundledCaddyfile = path.join(appRoot, 'Caddyfile');
        if (fs.existsSync(bundledCaddyfile)) {
            fs.copyFileSync(bundledCaddyfile, caddyfilePath);
        } else {
            // Fallback default
            fs.writeFileSync(caddyfilePath, "{\n\thttp_port 80\n\thttps_port 443\n}\n", 'utf-8');
        }
    }

    // Initialize config.json if it doesn't exist
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, "{}", 'utf-8');
    }
}

module.exports = {
    db: dbPath,
    caddyfile: caddyfilePath,
    config: configPath,
    certsDir: certsDir,
    isLegacy: isLegacy
};
