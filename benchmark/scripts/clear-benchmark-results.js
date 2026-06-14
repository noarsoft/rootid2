// benchmark/scripts/clear-benchmark-results.js
// -----------------------------------------------------------------------------
// Clear benchmark result files only
// Deletes files in benchmark/results:
//   .json, .csv, .xlsx
// -----------------------------------------------------------------------------

const fs = require("node:fs/promises");
const path = require("node:path");

const RESULTS_DIR = path.resolve(process.cwd(), "benchmark/results");

const ALLOWED_EXT = new Set([".json", ".csv", ".xlsx"]);

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_err) {
    return false;
  }
}

async function main() {
  if (!(await pathExists(RESULTS_DIR))) {
    console.log("[clear-benchmark-results] results dir not found:", RESULTS_DIR);
    return;
  }

  const files = await fs.readdir(RESULTS_DIR);

  let deleted = 0;

  for (const file of files) {
    const fullPath = path.join(RESULTS_DIR, file);
    const stat = await fs.stat(fullPath);

    if (!stat.isFile()) continue;

    const ext = path.extname(file).toLowerCase();

    if (!ALLOWED_EXT.has(ext)) continue;

    await fs.unlink(fullPath);
    deleted += 1;

    console.log("[deleted]", file);
  }

  console.log(`[clear-benchmark-results] done. deleted files: ${deleted}`);
}

main().catch((err) => {
  console.error("[clear-benchmark-results] failed:", err);
  process.exit(1);
});