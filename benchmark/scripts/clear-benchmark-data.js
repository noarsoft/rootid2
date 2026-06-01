// benchmark/scripts/clear-benchmark-data.js
// -----------------------------------------------------------------------------
// Clear RootID benchmark data
//
// ใช้สำหรับล้างข้อมูล benchmark ก่อนรัน benchmark ใหม่
// รันจาก root project:
//
//   node benchmark/scripts/clear-benchmark-data.js
//
// หรือถ้าต้องการล้าง upload metadata ด้วย:
//
//   CLEAR_UPLOADS=true node benchmark/scripts/clear-benchmark-data.js
//
// Windows PowerShell:
//
//   $env:CLEAR_UPLOADS="true"; node benchmark/scripts/clear-benchmark-data.js
// -----------------------------------------------------------------------------

require("dotenv").config();

const pool = require("../../src/db/pool");

function getBoolEnv(name, defaultValue = false) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw === "") {
    return defaultValue;
  }

  const value = String(raw).trim().toLowerCase();

  return ["1", "true", "yes", "y", "on"].includes(value);
}

async function countRows(client, tableName) {
  const result = await client.query(`SELECT COUNT(*)::INTEGER AS count FROM ${tableName}`);
  return result.rows[0]?.count || 0;
}

async function printCounts(client, label) {
  const tables = [
    "data_share_user",
    "data",
    "tableview",
    "form",
    "data_schema",
    "business",
    "upload",
  ];

  console.log(`\n[clear-benchmark] ${label}`);

  for (const table of tables) {
    const count = await countRows(client, table);
    console.log(`  ${table}: ${count}`);
  }
}

async function clearBenchmarkData() {
  const clearUploads = getBoolEnv("CLEAR_UPLOADS", false);

  const client = await pool.connect();

  try {
    await printCounts(client, "before");

    console.log("\n[clear-benchmark] clearing benchmark data...");

    await client.query("BEGIN");

    // ตาราง map/share ต้องลบก่อน data เพราะอ้าง data_rootid
    await client.query("DELETE FROM data_share_user");

    // data อ้าง data_schema
    await client.query("DELETE FROM data");

    // form/tableview อ้าง data_schema
    await client.query("DELETE FROM tableview");
    await client.query("DELETE FROM form");

    // data_schema อ้าง business
    await client.query("DELETE FROM data_schema");

    // business เป็น root tenant
    await client.query("DELETE FROM business");

    // upload ไม่เกี่ยวกับ RootID benchmark โดยตรง
    // ปกติไม่ลบ เว้นแต่ตั้ง CLEAR_UPLOADS=true
    if (clearUploads) {
      await client.query("DELETE FROM upload");
    }

    await client.query("COMMIT");

    console.log("[clear-benchmark] clear done");

    await printCounts(client, "after");
  } catch (err) {
    await client.query("ROLLBACK");

    console.error("[clear-benchmark] failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

clearBenchmarkData();