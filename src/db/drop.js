// src/db/drop.js
// -----------------------------------------------------------------------------
// Drop database objects
// Reads sql/drop-all.sql and executes it
// -----------------------------------------------------------------------------
//
// WARNING:
// This deletes all Root-ID prototype tables/views/functions.
// Use only in development or when you intentionally want to reset DB.
// -----------------------------------------------------------------------------

require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("./pool");

async function main() {
  const dropPath = path.resolve(__dirname, "../../sql/drop-all.sql");

  console.log(`[drop] Reading SQL: ${dropPath}`);

  const sql = await fs.readFile(dropPath, "utf8");

  const client = await pool.connect();

  try {
    console.log("[drop] Dropping database objects...");

    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");

    console.log("[drop] Done");
  } catch (err) {
    await client.query("ROLLBACK");

    console.error("[drop] Failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();