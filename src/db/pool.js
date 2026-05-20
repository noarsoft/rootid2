// src/db/pool.js
// -----------------------------------------------------------------------------
// PostgreSQL connection pool
// -----------------------------------------------------------------------------

const { Pool } = require("pg");
const config = require("../config/config");

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,

  max: config.db.max,
  idleTimeoutMillis: config.db.idleTimeoutMillis,
  connectionTimeoutMillis: config.db.connectionTimeoutMillis,

  ssl: config.db.ssl
    ? {
        rejectUnauthorized: false,
      }
    : false,
});

pool.on("connect", (client) => {
  client.query("SET client_encoding TO 'UTF8'");
  if (config.app.env !== "test") {
    console.log("[db] PostgreSQL connected (UTF-8)");
  }
});

pool.on("error", (err) => {
  console.error("[db] Unexpected PostgreSQL pool error:", err);
});

module.exports = pool;