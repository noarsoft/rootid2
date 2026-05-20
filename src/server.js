// src/server.js
// -----------------------------------------------------------------------------
// HTTP server entrypoint
// -----------------------------------------------------------------------------

const config = require("./config/config");
const createApp = require("./app");
const pool = require("./db/pool");

const app = createApp();

const server = app.listen(config.app.port, () => {
  console.log(`[server] ${config.app.name} running`);
  console.log(`[server] env: ${config.app.env}`);
  console.log(`[server] port: ${config.app.port}`);
  console.log(`[server] health: http://localhost:${config.app.port}/api/health`);
});

function shutdown(signal) {
  console.log(`[server] ${signal} received. Shutting down...`);

  server.close(async (err) => {
    if (err) {
      console.error("[server] Error while closing HTTP server:", err);
      process.exit(1);
    }

    try {
      await pool.end();
      console.log("[server] PostgreSQL pool closed");
      process.exit(0);
    } catch (poolErr) {
      console.error("[server] Error while closing PostgreSQL pool:", poolErr);
      process.exit(1);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception:", err);
  shutdown("uncaughtException");
});