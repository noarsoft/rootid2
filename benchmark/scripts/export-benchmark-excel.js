// benchmark/scripts/export-benchmark-excel.js
// -----------------------------------------------------------------------------
// Export RootID Wiki Benchmark results to Excel (.xlsx)
//
// Reads:
//   benchmark/results/*-result-*.json
//
// Writes:
//   benchmark/results/wiki-benchmark-report-<runId or latest>.xlsx
//
// Required:
//   npm install exceljs
//
// Usage:
//   npm run bench:wiki:excel
//
// Optional:
//   BENCH_RUN_ID=paper-run-001 npm run bench:wiki:excel
// -----------------------------------------------------------------------------

require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const ExcelJS = require("exceljs");

const RESULTS_DIR = path.resolve(process.cwd(), "benchmark/results");

const MODEL_FILE_PREFIXES = [
  {
    key: "pg_relational",
    label: "PG Relational",
    prefix: "wiki-pg-relational-result-",
  },
  {
    key: "pg_jsonb",
    label: "PG JSONB",
    prefix: "wiki-pg-jsonb-result-",
  },
  {
    key: "mongo",
    label: "MongoDB",
    prefix: "wiki-mongo-result-",
  },
  {
    key: "rootid",
    label: "RootID",
    prefix: "wiki-rootid-result-",
  },
];

function safeSheetName(name) {
  return String(name)
    .replace(/[\\/*?:[\]]/g, "_")
    .slice(0, 31);
}

function normalizeCell(value) {
  if (value === null || value === undefined) return "";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return value;
  }

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function collectHeaders(rows, preferred = []) {
  const headers = [];
  const seen = new Set();

  for (const h of preferred) {
    if (!seen.has(h)) {
      headers.push(h);
      seen.add(h);
    }
  }

  for (const row of rows || []) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) {
        headers.push(key);
        seen.add(key);
      }
    }
  }

  return headers;
}

function addTableSheet(workbook, sheetName, rows, options = {}) {
  const ws = workbook.addWorksheet(safeSheetName(sheetName));

  const title = options.title || sheetName;
  const subtitle = options.subtitle || "";

  ws.addRow([title]);
  ws.getCell("A1").font = { bold: true, size: 16 };
  ws.getCell("A1").alignment = { vertical: "middle" };

  if (subtitle) {
    ws.addRow([subtitle]);
    ws.getCell("A2").font = { italic: true, color: { argb: "666666" } };
    ws.addRow([]);
  } else {
    ws.addRow([]);
  }

  if (!rows || rows.length === 0) {
    ws.addRow(["No data"]);
    return ws;
  }

  const headers = collectHeaders(rows, options.preferredHeaders || []);
  const headerRow = ws.addRow(headers);

  headerRow.font = { bold: true, color: { argb: "FFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "1F4E78" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  for (const row of rows) {
    ws.addRow(headers.map((h) => normalizeCell(row[h])));
  }

  const startRow = subtitle ? 4 : 3;
  const endRow = ws.rowCount;
  const endCol = headers.length;

  if (endCol > 0 && endRow >= startRow) {
    const tableRef = `A${startRow}`;
    const tableName = `tbl_${safeSheetName(sheetName).replace(/[^A-Za-z0-9_]/g, "_")}`;

    try {
      ws.addTable({
        name: tableName.slice(0, 30),
        ref: tableRef,
        headerRow: true,
        totalsRow: false,
        style: {
          theme: "TableStyleMedium2",
          showRowStripes: true,
        },
        columns: headers.map((h) => ({ name: h })),
        rows: rows.map((row) => headers.map((h) => normalizeCell(row[h]))),
      });

      // Remove manually added rows duplicated by addTable
      // ExcelJS addTable writes data itself, so rebuild sheet is simpler.
      ws.spliceRows(startRow, rows.length + 1);
      ws.addTable({
        name: `${tableName}_2`.slice(0, 30),
        ref: tableRef,
        headerRow: true,
        totalsRow: false,
        style: {
          theme: "TableStyleMedium2",
          showRowStripes: true,
        },
        columns: headers.map((h) => ({ name: h })),
        rows: rows.map((row) => headers.map((h) => normalizeCell(row[h]))),
      });
    } catch (_err) {
      // fallback: plain rows are already present
    }
  }

  ws.views = [{ state: "frozen", ySplit: subtitle ? 4 : 3 }];

  for (let i = 1; i <= Math.max(headers.length, 1); i += 1) {
    const col = ws.getColumn(i);

    let maxLen = 10;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const text = normalizeCell(cell.value);
      maxLen = Math.max(maxLen, String(text).length);
    });

    col.width = Math.min(Math.max(maxLen + 2, 10), 42);
  }

  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = {
        vertical: "top",
        wrapText: true,
      };
    });
  });

  return ws;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_err) {
    return false;
  }
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function listJsonFiles() {
  if (!(await pathExists(RESULTS_DIR))) {
    return [];
  }

  const files = await fs.readdir(RESULTS_DIR);

  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(RESULTS_DIR, file));
}

function getMtimeMsSafe(stat) {
  return stat && Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
}

async function findResultFiles() {
  const runId = process.env.BENCH_RUN_ID || "";
  const jsonFiles = await listJsonFiles();

  const found = [];

  for (const model of MODEL_FILE_PREFIXES) {
    const candidates = [];

    for (const filePath of jsonFiles) {
      const base = path.basename(filePath);

      if (!base.startsWith(model.prefix)) continue;
      if (runId && !base.includes(runId)) continue;

      const stat = await fs.stat(filePath);

      candidates.push({
        ...model,
        filePath,
        fileName: base,
        mtimeMs: getMtimeMsSafe(stat),
      });
    }

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (candidates[0]) {
      found.push(candidates[0]);
    }
  }

  return found;
}

function metricRowsFromResult(result, modelInfo) {
  return (result.metrics || []).map((metric) => ({
    model: modelInfo.label,
    model_key: modelInfo.key,
    benchmark: result.benchmark || "",
    run_id: result.runId || "",
    timestamp: result.timestamp || "",
    metric_name: metric.name || "",
    ms: metric.ms ?? "",
    rows: metric.rows ?? "",
    pages: metric.pages ?? "",
    revisions: metric.revisions ?? "",
    updates: metric.updates ?? "",
    reads: metric.reads ?? "",
    avg_versions: metric.avg_versions ?? "",
    avg_ms_per_read: metric.avg_ms_per_read ?? "",
    avg_ms_per_history: metric.avg_ms_per_history ?? "",
    avg_ms_per_compare: metric.avg_ms_per_compare ?? "",
    avg_ms_per_migrate: metric.avg_ms_per_migrate ?? "",
    reads_per_sec: metric.reads_per_sec ?? "",
    revisions_per_sec: metric.revisions_per_sec ?? "",
    pages_per_sec: metric.pages_per_sec ?? "",
    history_reads_per_sec: metric.history_reads_per_sec ?? "",
    compares_per_sec: metric.compares_per_sec ?? "",
    migrates_per_sec: metric.migrates_per_sec ?? "",
  }));
}

function statsRowsFromResult(result, modelInfo) {
  const stats = result.stats || {};

  return Object.entries(stats).map(([key, value]) => ({
    model: modelInfo.label,
    model_key: modelInfo.key,
    benchmark: result.benchmark || "",
    run_id: result.runId || "",
    stat_name: key,
    stat_value: value,
  }));
}

function wikiSummaryRowFromResult(result, modelInfo) {
  const summary = result.wiki?.summary || {};

  return {
    model: modelInfo.label,
    model_key: modelInfo.key,
    benchmark: result.benchmark || "",
    run_id: result.runId || "",
    rows: summary.rows ?? "",
    pages: summary.pages ?? "",
    revisions: summary.revisions ?? "",
    categories: summary.categories ?? "",
    avg_revisions_per_page: summary.avg_revisions_per_page ?? "",
    min_revisions_per_page: summary.min_revisions_per_page ?? "",
    max_revisions_per_page: summary.max_revisions_per_page ?? "",
    invalid_rows: result.wiki?.invalidRows ?? "",
    file_path: result.wiki?.filePath ?? "",
  };
}

function configRowsFromResult(result, modelInfo) {
  const config = result.config || {};

  return Object.entries(config).map(([key, value]) => ({
    model: modelInfo.label,
    model_key: modelInfo.key,
    benchmark: result.benchmark || "",
    run_id: result.runId || "",
    config_name: key,
    config_value: value,
  }));
}

function getMetric(result, metricName) {
  return (result.metrics || []).find((m) => m.name === metricName) || {};
}

function getFirstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return "";
}

function overviewRowFromResult(result, modelInfo, fileName) {
  const importMetric =
    getMetric(result, "import_wiki_pages_as_rootid").name
      ? getMetric(result, "import_wiki_pages_as_rootid")
      : getMetric(result, "import_wiki_pages");

  const latestMetric = getMetric(result, "sample_latest_reads");
  const historyMetric = getMetric(result, "sample_history_reads");
  const compareMetric = getMetric(result, "sample_compare_with_latest_schema");
  const migrateMetric = getMetric(result, "sample_migrate_to_latest_schema");

  const stats = result.stats || {};
  const wikiSummary = result.wiki?.summary || {};

  return {
    model: modelInfo.label,
    model_key: modelInfo.key,
    benchmark: result.benchmark || "",
    run_id: result.runId || "",
    source_file: fileName,

    wiki_pages: wikiSummary.pages ?? "",
    wiki_revisions: wikiSummary.revisions ?? "",
    wiki_rows: wikiSummary.rows ?? "",

    import_ms: importMetric.ms ?? "",
    revisions_per_sec: importMetric.revisions_per_sec ?? "",
    pages_per_sec: importMetric.pages_per_sec ?? "",

    latest_read_ms: latestMetric.ms ?? "",
    latest_reads: latestMetric.reads ?? "",
    latest_avg_ms_per_read: latestMetric.avg_ms_per_read ?? "",

    history_read_ms: historyMetric.ms ?? "",
    history_reads: historyMetric.reads ?? "",
    history_avg_ms_per_history: historyMetric.avg_ms_per_history ?? "",
    avg_versions: historyMetric.avg_versions ?? "",

    schema_compare_ms: compareMetric.ms ?? "",
    schema_compare_rows: compareMetric.rows ?? "",
    schema_compare_avg_ms: compareMetric.avg_ms_per_compare ?? "",

    schema_migrate_ms: migrateMetric.ms ?? "",
    schema_migrate_rows: migrateMetric.rows ?? "",
    schema_migrate_avg_ms: migrateMetric.avg_ms_per_migrate ?? "",

    physical_rows: getFirstValue(
      stats.data_physical_rows,
      stats.revisions,
      stats.documents
    ),
    current_rows: stats.data_current_rows ?? "",
    history_rows: stats.data_history_rows ?? "",
    deleted_rows: stats.data_deleted_rows ?? "",
    logical_rootids: stats.data_rootids ?? stats.page_ids ?? "",

    database_bytes: stats.database_bytes ?? "",
    data_table_bytes: stats.data_table_bytes ?? "",
    revision_table_bytes: stats.revision_table_bytes ?? "",
    page_table_bytes: stats.page_table_bytes ?? "",
  };
}

function addReadmeSheet(workbook, outputFile, files) {
  const ws = workbook.addWorksheet("README");

  const rows = [
    ["RootID Wiki Benchmark Excel Report"],
    [""],
    ["Generated At", new Date().toISOString()],
    ["Output File", outputFile],
    ["Results Directory", RESULTS_DIR],
    ["BENCH_RUN_ID", process.env.BENCH_RUN_ID || "(latest files per model)"],
    [""],
    ["Included Files"],
    ...files.map((file) => [file.label, file.fileName]),
    [""],
    ["Sheets"],
    ["Overview", "Main paper-ready comparison table"],
    ["Metrics_Long", "All benchmark metrics in long format"],
    ["Stats_Long", "Database/table/storage statistics"],
    ["Wiki_Summary", "Input dataset summary per model"],
    ["Config_Long", "Benchmark configuration per model"],
  ];

  for (const row of rows) {
    ws.addRow(row);
  }

  ws.getCell("A1").font = { bold: true, size: 18 };
  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 80;

  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
    });
  });

  return ws;
}

async function main() {
  const files = await findResultFiles();

  if (files.length === 0) {
    throw new Error(
      `No benchmark result JSON files found in ${RESULTS_DIR}. Run benchmark first.`
    );
  }

  console.log("[benchmark-excel] found files:");
  for (const file of files) {
    console.log(`- ${file.label}: ${file.fileName}`);
  }

  const loaded = [];

  for (const file of files) {
    const result = await readJson(file.filePath);
    loaded.push({
      ...file,
      result,
    });
  }

  const workbook = new ExcelJS.Workbook();

  workbook.creator = "RootID Benchmark";
  workbook.created = new Date();
  workbook.modified = new Date();

  const runId = process.env.BENCH_RUN_ID || "latest";
  const outputFile = path.join(
    RESULTS_DIR,
    `wiki-benchmark-report-${String(runId).replace(/[^a-zA-Z0-9._-]/g, "_")}.xlsx`
  );

  addReadmeSheet(workbook, outputFile, loaded);

  const overviewRows = loaded.map((item) =>
    overviewRowFromResult(item.result, item, item.fileName)
  );

  const metricRows = loaded.flatMap((item) =>
    metricRowsFromResult(item.result, item)
  );

  const statRows = loaded.flatMap((item) =>
    statsRowsFromResult(item.result, item)
  );

  const wikiRows = loaded.map((item) =>
    wikiSummaryRowFromResult(item.result, item)
  );

  const configRows = loaded.flatMap((item) =>
    configRowsFromResult(item.result, item)
  );

  addTableSheet(workbook, "Overview", overviewRows, {
    title: "Benchmark Overview",
    subtitle: "Paper-ready comparison table across PG Relational, PG JSONB, MongoDB, and RootID.",
    preferredHeaders: [
      "model",
      "benchmark",
      "run_id",
      "wiki_pages",
      "wiki_revisions",
      "import_ms",
      "revisions_per_sec",
      "latest_avg_ms_per_read",
      "history_avg_ms_per_history",
      "schema_compare_avg_ms",
      "schema_migrate_avg_ms",
      "physical_rows",
      "current_rows",
      "history_rows",
      "database_bytes",
      "source_file",
    ],
  });

  addTableSheet(workbook, "Metrics_Long", metricRows, {
    title: "Metrics Long Format",
    subtitle: "Raw metrics from each benchmark JSON file.",
  });

  addTableSheet(workbook, "Stats_Long", statRows, {
    title: "Statistics Long Format",
    subtitle: "Database/table/storage statistics from benchmark outputs.",
  });

  addTableSheet(workbook, "Wiki_Summary", wikiRows, {
    title: "Wiki Input Summary",
    subtitle: "Dataset summary reported by each benchmark.",
  });

  addTableSheet(workbook, "Config_Long", configRows, {
    title: "Benchmark Configuration",
    subtitle: "Environment/config values used by each benchmark.",
  });

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  await workbook.xlsx.writeFile(outputFile);

  console.log("[benchmark-excel] done");
  console.log("[benchmark-excel] output:", outputFile);
}

main().catch((err) => {
  console.error("[benchmark-excel] failed:", err);
  process.exit(1);
});