// benchmark/wiki-pg-relational-benchmark.js
// -----------------------------------------------------------------------------
// Wiki → PostgreSQL Relational Baseline Benchmark
//
// Default:
// - PG Relational ไม่ mutate หลัง import
// - ใช้เป็น reference dataset สำหรับ correctness
//
// Optional mutation:
// - BENCH_PG_RELATIONAL_MUTATION=true
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
  ensurePgRelationalTables,
  clearPgRelationalRunData,
  importWikiPagesPgRelational,
  sampleLatestReadsPgRelational,
  sampleHistoryReadsPgRelational,
  sampleUpdatesPgRelational,
  sampleLatestReadsAfterUpdatePgRelational,
  sampleHistoryReadsAfterUpdatePgRelational,
  sampleDeletesPgRelational,
  sampleLatestReadsAfterDeletePgRelational,
  verifyDeletesPgRelational,
  getPgRelationalStats,
} = require("./utils/baseline-pg-relational-helper");

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
      name: "pg_relational_db_stats",
      ...stats,
    },
    {
      name: "benchmark_config",
      model: MODEL_NAME,
      run_id: config.runId,
      sample_reads: config.sampleReads,
      update_sample: config.updateSample,
      delete_sample: config.deleteSample,
      history_limit: config.historyLimit,
      max_pages: config.maxPages || "",
      max_revisions_per_page: config.maxRevisionsPerPage || "",
      include_text: config.includeText,
      enable_mutation: config.enableMutation,
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
    updates: m.updates || "",
    deletes: m.deletes || "",
    reads: m.reads || "",
    avg_ms:
      m.avg_ms_per_read ||
      m.avg_ms_per_history ||
      m.avg_ms_per_update ||
      m.avg_ms_per_delete ||
      m.avg_ms_per_check ||
      "",
  }));
}

async function main() {
  const runId = process.env.BENCH_RUN_ID || createBenchmarkRunId("wiki-pg-relational");

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
    updateSample: getIntEnv("BENCH_UPDATE_SAMPLE", 100),
    deleteSample: getIntEnv("BENCH_DELETE_SAMPLE", 50),
    historyLimit: getIntEnv("BENCH_HISTORY_LIMIT", 1000),

    progressEvery: getIntEnv("BENCH_PROGRESS_EVERY", 100),

    includeText: getBoolEnv("BENCH_INCLUDE_TEXT", false),

    clearRunBefore: getBoolEnv("BENCH_CLEAR_RUN_BEFORE", true),
    clearRunAfter: getBoolEnv("BENCH_CLEAR_RUN_AFTER", false),

    enableMutation: getBoolEnv("BENCH_PG_RELATIONAL_MUTATION", false),
  };

  const metrics = [];
  const outputDir = "benchmark/results";

  await ensureDir(outputDir);

  console.log(`[${MODEL_NAME}] starting`);
  console.log(`[${MODEL_NAME}] runId:`, runId);
  console.log(`[${MODEL_NAME}] config:`, JSON.stringify(config, null, 2));

  try {
    await ensurePgRelationalTables(pool);

    if (config.clearRunBefore) {
      const clearBefore = await measure("clear_run_before", async () => {
        return clearPgRelationalRunData(pool, runId);
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
      return importWikiPagesPgRelational(pool, runId, wiki.pageMap, {
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
      return sampleLatestReadsPgRelational(pool, runId, importedPages, {
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
      return sampleHistoryReadsPgRelational(pool, runId, importedPages, {
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

    let updateSample = null;
    let latestReadsAfterUpdate = null;
    let historyReadsAfterUpdate = null;
    let deleteSample = null;
    let latestReadsAfterDelete = null;
    let deleteVerification = null;

    if (config.enableMutation) {
      updateSample = await measure("sample_version_updates", async () => {
        return sampleUpdatesPgRelational(pool, runId, importedPages, {
          limit: config.updateSample,
        });
      });

      metrics.push({
        ...updateSample.metric,
        updates: updateSample.result.updates,
        avg_ms_per_update: round(safeDiv(updateSample.metric.ms, updateSample.result.updates)),
        updates_per_sec: round(safeDiv(updateSample.result.updates, updateSample.metric.ms / 1000)),
      });

      latestReadsAfterUpdate = await measure(
        "sample_latest_reads_after_update",
        async () => {
          return sampleLatestReadsAfterUpdatePgRelational(pool, runId, importedPages, {
            limit: config.sampleReads,
          });
        }
      );

      metrics.push({
        ...latestReadsAfterUpdate.metric,
        reads: latestReadsAfterUpdate.result.reads,
        avg_ms_per_read: round(
          safeDiv(latestReadsAfterUpdate.metric.ms, latestReadsAfterUpdate.result.reads)
        ),
        reads_per_sec: round(
          safeDiv(latestReadsAfterUpdate.result.reads, latestReadsAfterUpdate.metric.ms / 1000)
        ),
      });

      historyReadsAfterUpdate = await measure(
        "sample_history_reads_after_update",
        async () => {
          return sampleHistoryReadsAfterUpdatePgRelational(pool, runId, importedPages, {
            limit: config.sampleReads,
            historyLimit: config.historyLimit,
          });
        }
      );

      metrics.push({
        ...historyReadsAfterUpdate.metric,
        reads: historyReadsAfterUpdate.result.reads,
        avg_versions: round(historyReadsAfterUpdate.result.avg_versions),
        avg_ms_per_history: round(
          safeDiv(historyReadsAfterUpdate.metric.ms, historyReadsAfterUpdate.result.reads)
        ),
        history_reads_per_sec: round(
          safeDiv(
            historyReadsAfterUpdate.result.reads,
            historyReadsAfterUpdate.metric.ms / 1000
          )
        ),
      });

      deleteSample = await measure("sample_deletes", async () => {
        return sampleDeletesPgRelational(pool, runId, importedPages, {
          limit: config.deleteSample,
        });
      });

      metrics.push({
        ...deleteSample.metric,
        deletes: deleteSample.result.deletes,
        avg_ms_per_delete: round(safeDiv(deleteSample.metric.ms, deleteSample.result.deletes)),
        deletes_per_sec: round(safeDiv(deleteSample.result.deletes, deleteSample.metric.ms / 1000)),
      });

      latestReadsAfterDelete = await measure(
        "sample_latest_reads_after_delete",
        async () => {
          return sampleLatestReadsAfterDeletePgRelational(pool, runId, importedPages, {
            limit: config.deleteSample,
          });
        }
      );

      metrics.push({
        ...latestReadsAfterDelete.metric,
        reads: latestReadsAfterDelete.result.reads,
        avg_ms_per_read: round(
          safeDiv(latestReadsAfterDelete.metric.ms, latestReadsAfterDelete.result.reads)
        ),
        reads_per_sec: round(
          safeDiv(latestReadsAfterDelete.result.reads, latestReadsAfterDelete.metric.ms / 1000)
        ),
      });

      deleteVerification = await measure("verify_deletes", async () => {
        return verifyDeletesPgRelational(pool, runId, deleteSample.result.deleted);
      });

      metrics.push({
        ...deleteVerification.metric,
        checks: deleteVerification.result.checks,
        ok: deleteVerification.result.ok,
        failed: deleteVerification.result.failed,
        avg_ms_per_check: round(
          safeDiv(deleteVerification.metric.ms, deleteVerification.result.checks)
        ),
        checks_per_sec: round(
          safeDiv(deleteVerification.result.checks, deleteVerification.metric.ms / 1000)
        ),
      });
    }

    const stats = await getPgRelationalStats(pool, runId);

    const output = {
      benchmark: "wiki-pg-relational",
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

        updates: updateSample?.result?.updated?.slice(0, 10) || [],
        latest_after_update:
          latestReadsAfterUpdate?.result?.latest?.slice(0, 10) || [],
        history_after_update:
          historyReadsAfterUpdate?.result?.histories?.slice(0, 10) || [],

        deletes: deleteSample?.result?.deleted?.slice(0, 10) || [],
        latest_after_delete:
          latestReadsAfterDelete?.result?.latest?.slice(0, 10) || [],
        delete_verification:
          deleteVerification?.result?.verified?.slice(0, 10) || [],
      },
    };

    const jsonFile = path.join(
      outputDir,
      makeResultFileName("wiki-pg-relational-result", "json", runId)
    );

    const summaryCsvFile = path.join(
      outputDir,
      makeResultFileName("wiki-pg-relational-summary", "csv", runId)
    );

    const metricsCsvFile = path.join(
      outputDir,
      makeResultFileName("wiki-pg-relational-metrics", "csv", runId)
    );

    const importedCsvFile = path.join(
      outputDir,
      makeResultFileName("wiki-pg-relational-imported", "csv", runId)
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
      await clearPgRelationalRunData(pool, runId);
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