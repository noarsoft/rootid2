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

function getTrustProxyEnv(name, defaultValue = 0) {
  const value = getEnv(name);

  if (value === undefined) {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  if (["true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "off"].includes(normalized)) {
    return false;
  }

  if (["loopback", "linklocal", "uniquelocal"].includes(normalized)) {
    return normalized;
  }

  throw new Error(`Environment variable ${name} must be boolean, integer, or known trust proxy mode`);
}

function parseCorsOrigins(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return [
      "http://localhost:3002",
      "http://localhost:4173",
      "https://app.aicamt.com",
      "https://auth.aicamt.com",
    ];
  }

  if (raw === "*") {
    return "*";
  }

  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const config = {
  app: {
    name: getEnv("APP_NAME", "rootid-figma-prototype"),
    env: getEnv("NODE_ENV", "development"),
    port: getIntEnv("PORT", 3000),
    corsOrigin: parseCorsOrigins(getEnv("CORS_ORIGIN")),
    trustProxy: getTrustProxyEnv("TRUST_PROXY", 1),
  },

  auth: {
    meUrl: getEnv("AUTH_ME_URL", "http://localhost:3001/api/auth/me"),
    providerLoginUrl: getEnv("AUTH_PROVIDER_LOGIN_URL", "http://localhost:3001/html/provider_login.html"),
    redirectParam: getEnv("AUTH_REDIRECT_PARAM", "redirect"),
    requestTimeoutMs: getIntEnv("AUTH_REQUEST_TIMEOUT_MS", 5000),
    tokenCookieName: getEnv("AUTH_PROVIDER_TOKEN_COOKIE", "rootid2_token"),
    tokenCookieSecure: getBoolEnv("AUTH_PROVIDER_TOKEN_COOKIE_SECURE", false),
    tokenCookieSameSite: getEnv("AUTH_PROVIDER_TOKEN_COOKIE_SAMESITE", "lax"),
    tokenCookieMaxAgeMs: getIntEnv("AUTH_PROVIDER_TOKEN_COOKIE_MAX_AGE_MS", 7 * 24 * 60 * 60 * 1000),
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

  upload: {
    chunkSizeKb: getIntEnv("UPLOAD_CHUNK_SIZE_KB", 200),
    maxFileSizeMb: getIntEnv("UPLOAD_MAX_FILE_SIZE_MB", 2),
    tmpDir: getEnv("UPLOAD_TMP_DIR", "update/tmp"),
    targetDir: getEnv("UPLOAD_TARGET_DIR", "upload"),
  },
};

config.upload.chunkSizeBytes = config.upload.chunkSizeKb * 1024;
config.upload.maxFileSizeBytes = config.upload.maxFileSizeMb * 1024 * 1024;

module.exports = config;