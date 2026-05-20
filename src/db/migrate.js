// src/db/migrate.js
// -----------------------------------------------------------------------------
// Simple migration runner
// Reads sql/schema.sql and executes it
// -----------------------------------------------------------------------------

require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("./pool");

async function main() {
  const schemaPath = path.resolve(__dirname, "../../sql/schema.sql");

  console.log(`[migrate] Reading schema: ${schemaPath}`);

  const sql = await fs.readFile(schemaPath, "utf8");

  const client = await pool.connect();

  try {
    console.log("[migrate] Running migration...");

    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");

    console.log("[migrate] Done");
  } catch (err) {
    await client.query("ROLLBACK");

    console.error("[migrate] Failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();