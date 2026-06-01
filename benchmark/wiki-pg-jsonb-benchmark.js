// benchmark/wiki-pg-jsonb-benchmark.js
// -----------------------------------------------------------------------------
// Wiki → PostgreSQL JSONB Baseline Benchmark
//
// Refactor version:
// - ใช้ helper: benchmark/utils/baseline-pg-jsonb-helper.js
// - ไฟล์นี้เหลือหน้าที่ orchestration:
//   load wiki → run benchmark steps → write JSON/CSV
// -----------------------------------------------------------------------------

require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");

const pool = require("../src/db/pool");

const { measure, round } = require("./utils/timer");
const { loadWikiRows } = require("./utils/wiki-loader");
const { writeCsv, writeFlattenedCsv } = require("./utils/csv-writer");

const {
  createBenchmarkRunId,
  ensureDir,
  makeResultFileName,
} = require("./utils/rootid-bench-helper");

const {
  MODEL_NAME,
  safeDiv,
  ensurePgJsonbTables,
  clearPgJsonbRunData,
  importWikiPagesPgJsonb,
  sampleLatestReadsPgJsonb,
  sampleHistoryReadsPgJsonb,
  getPgJsonbStats,
} = require("./utils/baseline-pg-jsonb-helper");

function getIntEnv(name, defaultValue) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw === "") {
    return defaultValue;
  }

  const n = Number(raw);

  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }

  return Math.trunc(n);
}

function getBoolEnv(name, defaultValue = false) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw === "") {
    return defaultValue;
  }

  const value = String(raw).trim().toLowerCase();

  if (["1", "true", "yes", "y", "on"].includes(value)) return true;
  if (["0", "false", "no", "n", "off"].includes(value)) return false;

  return defaultValue;
}

async function writeJson(filePath, data) {
  const outputPath = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), "utf8");
  return outputPath;
}

function compactMetric(metric) {
  const out = { ...metric };
  delete out.started_at;
  return out;
}

function makeSummaryRows(metrics, stats, config, wikiSummary) {
  return [
    ...metrics.map(compactMetric),
    {
      name: "wiki_input_summary",
      rows: wikiSummary.rows,
      pages: wikiSummary.pages,
      revisions: wikiSummary.revisions,
      categories: wikiSummary.categories,
      avg_revisions_per_page: round(wikiSummary.avg_revisions_per_page),
      min_revisions_per_page: wikiSummary.min_revisions_per_page,
      max_revisions_per_page: wikiSummary.max_revisions_per_page,
    },
    {
      name: "pg_jsonb_db_stats",
      ...stats,
    },
    {
      name: "benchmark_config",
      model: MODEL_NAME,
      run_id: config.runId,
      sample_reads: config.sampleReads,
      history_limit: config.historyLimit,
      max_pages: config.maxPages || "",
      max_revisions_per_page: config.maxRevisionsPerPage || "",
      include_text: config.includeText,
    },
  ];
}

function makeConsoleRows(metrics) {
  return metrics.map((m) => ({
    name: m.name,
    ms: m.ms,
    rows: m.rows || "",
    pages: m.pages || "",
    revisions: m.revisions || "",
    reads: m.reads || "",
    avg_ms:
      m.avg_ms_per_read ||
      m.avg_ms_per_history ||
      "",
  }));
}

async function main() {
  const runId = process.env.BENCH_RUN_ID || createBenchmarkRunId("wiki-pg-jsonb");

  const config = {
    runId,
    model: MODEL_NAME,

    wikiPath:
      process.env.WIKI_NORMALIZED_PATH ||
      process.env.WIKI_JSON_PATH ||
      "benchmark/data/wiki-normalized.json",

    maxPages: getIntEnv("BENCH_MAX_PAGES", 0),
    maxRevisionsPerPage: getIntEnv("BENCH_MAX_REVISIONS_PER_PAGE", 0),

    sampleReads: getIntEnv("BENCH_SAMPLE_READS", 200),
    historyLimit: getIntEnv("BENCH_HISTORY_LIMIT", 1000),
    progressEvery: getIntEnv("BENCH_PROGRESS_EVERY", 100),

    includeText: getBoolEnv("BENCH_INCLUDE_TEXT", false),
    clearRunBefore: getBoolEnv("BENCH_CLEAR_RUN_BEFORE", true),
    clearRunAfter: getBoolEnv("BENCH_CLEAR_RUN_AFTER", false),
  };

  const metrics = [];
  const outputDir = "benchmark/results";

  await ensureDir(outputDir);

  console.log(`[${MODEL_NAME}] starting`);
  console.log(`[${MODEL_NAME}] runId:`, runId);
  console.log(`[${MODEL_NAME}] config:`, JSON.stringify(config, null, 2));

  try {
    await ensurePgJsonbTables(pool);

    if (config.clearRunBefore) {
      const clearBefore = await measure("clear_run_before", async () => {
        return clearPgJsonbRunData(pool, runId);
      });

      metrics.push(clearBefore.metric);
    }

    const loadWiki = await measure("load_wiki_rows", async () => {
      return loadWikiRows(config.wikiPath, {
        maxPages: config.maxPages,
        maxRevisionsPerPage: config.maxRevisionsPerPage,
      });
    });

    metrics.push({
      ...loadWiki.metric,
      rows: loadWiki.result.summary.rows,
      pages: loadWiki.result.summary.pages,
      revisions: loadWiki.result.summary.revisions,
      categories: loadWiki.result.summary.categories,
      avg_revisions_per_page: round(loadWiki.result.summary.avg_revisions_per_page),
    });

    const wiki = loadWiki.result;

    if (wiki.rows.length === 0 || wiki.pageMap.size === 0) {
      throw new Error("Wiki data is empty after loading/grouping");
    }

    const importWiki = await measure("import_wiki_pages", async () => {
      return importWikiPagesPgJsonb(pool, runId, wiki.pageMap, {
        progressEvery: config.progressEvery,
        includeText: config.includeText,
      });
    });

    metrics.push({
      ...importWiki.metric,
      pages: importWiki.result.pages,
      revisions: importWiki.result.revisions,
      revisions_per_sec: round(safeDiv(importWiki.result.revisions, importWiki.metric.ms / 1000)),
      pages_per_sec: round(safeDiv(importWiki.result.pages, importWiki.metric.ms / 1000)),
    });

    const importedPages = importWiki.result.imported;

    const latestReads = await measure("sample_latest_reads", async () => {
      return sampleLatestReadsPgJsonb(pool, runId, importedPages, {
        limit: config.sampleReads,
      });
    });

    metrics.push({
      ...latestReads.metric,
      reads: latestReads.result.reads,
      avg_ms_per_read: round(safeDiv(latestReads.metric.ms, latestReads.result.reads)),
      reads_per_sec: round(safeDiv(latestReads.result.reads, latestReads.metric.ms / 1000)),
    });

    const historyReads = await measure("sample_history_reads", async () => {
      return sampleHistoryReadsPgJsonb(pool, runId, importedPages, {
        limit: config.sampleReads,
        historyLimit: config.historyLimit,
      });
    });

    metrics.push({
      ...historyReads.metric,
      reads: historyReads.result.reads,
      avg_versions: round(historyReads.result.avg_versions),
      avg_ms_per_history: round(safeDiv(historyReads.metric.ms, historyReads.result.reads)),
      history_reads_per_sec: round(safeDiv(historyReads.result.reads, historyReads.metric.ms / 1000)),
    });

    const stats = await getPgJsonbStats(pool, runId);

    const output = {
      benchmark: "wiki-pg-jsonb",
      model: MODEL_NAME,
      runId,
      timestamp: new Date().toISOString(),
      config,
      wiki: {
        filePath: wiki.filePath,
        sourceMeta: wiki.sourceMeta,
        summary: wiki.summary,
        invalidRows: wiki.invalid.length,
      },
      metrics,
      stats,
      imported: {
        pages: importedPages.length,
        sample: importedPages.slice(0, 10),
      },
      samples: {
        latest: latestReads.result.latest.slice(0, 10),
        history: historyReads.result.histories.slice(0, 10),
      },
    };

    const jsonFile = path.join(
      outputDir,
      makeResultFileName("wiki-pg-jsonb-result", "json", runId)
    );

    const summaryCsvFile = path.join(
      outputDir,
      makeResultFileName("wiki-pg-jsonb-summary", "csv", runId)
    );

    const metricsCsvFile = path.join(
      outputDir,
      makeResultFileName("wiki-pg-jsonb-metrics", "csv", runId)
    );

    const importedCsvFile = path.join(
      outputDir,
      makeResultFileName("wiki-pg-jsonb-imported", "csv", runId)
    );

    await writeJson(jsonFile, output);

    await writeCsv(summaryCsvFile, makeSummaryRows(metrics, stats, config, wiki.summary), {
      bom: true,
    });

    await writeFlattenedCsv(metricsCsvFile, metrics, {
      bom: true,
      maxDepth: 2,
    });

    await writeCsv(importedCsvFile, importedPages, {
      bom: true,
      headers: ["page_id", "page_title", "revisions"],
    });

    console.log(`\n[${MODEL_NAME}] done`);
    console.log(`[${MODEL_NAME}] result json:`, jsonFile);
    console.log(`[${MODEL_NAME}] summary csv:`, summaryCsvFile);
    console.log(`[${MODEL_NAME}] metrics csv:`, metricsCsvFile);
    console.log(`[${MODEL_NAME}] imported csv:`, importedCsvFile);

    console.table(makeConsoleRows(metrics));
    console.table([stats]);

    if (config.clearRunAfter) {
      await clearPgJsonbRunData(pool, runId);
    }
  } finally {
    await pool.end();
  }
}

main().catch(async (err) => {
  console.error(`[${MODEL_NAME}] failed:`, err);

  try {
    await pool.end();
  } catch (_err) {
    // ignore
  }

  process.exit(1);
});