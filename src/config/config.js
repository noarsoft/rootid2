// src/config/config.js
// -----------------------------------------------------------------------------
// Central app configuration
// -----------------------------------------------------------------------------

require("dotenv").config();

function getEnv(name, defaultValue = undefined) {
  const value = process.env[name];

  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  return value;
}

function getIntEnv(name, defaultValue) {
  const value = getEnv(name);

  if (value === undefined) return defaultValue;

  const n = Number(value);

  if (!Number.isInteger(n)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }

  return n;
}

function getBoolEnv(name, defaultValue = false) {
  const value = getEnv(name);

  if (value === undefined) return defaultValue;

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Environment variable ${name} must be boolean`);
}

const config = {
  app: {
    name: getEnv("APP_NAME", "rootid-figma-prototype"),
    env: getEnv("NODE_ENV", "development"),
    port: getIntEnv("PORT", 3000),
    corsOrigin: getEnv("CORS_ORIGIN", "*"),
  },

  db: {
    host: getEnv("PGHOST", "localhost"),
    port: getIntEnv("PGPORT", 5432),
    database: getEnv("PGDATABASE", "rootid_figma"),
    user: getEnv("PGUSER", "postgres"),
    password: getEnv("PGPASSWORD", "postgres"),

    max: getIntEnv("PGPOOL_MAX", 10),
    idleTimeoutMillis: getIntEnv("PGPOOL_IDLE_TIMEOUT_MS", 30000),
    connectionTimeoutMillis: getIntEnv("PGPOOL_CONNECTION_TIMEOUT_MS", 5000),

    ssl: getBoolEnv("PGSSL", false),
  },

  rootid: {
    defaultLimit: getIntEnv("DEFAULT_LIMIT", 100),
    maxLimit: getIntEnv("MAX_LIMIT", 1000),

    flags: {
      normal: "",
      updated: "u",
      deleted: "d",
    },
  },
};

module.exports = config;