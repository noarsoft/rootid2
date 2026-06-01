// benchmark/wiki-rootid-benchmark.js
// -----------------------------------------------------------------------------
// Wiki → RootID Core Benchmark
//
// แนวคิด:
// - ไม่ผ่าน API / Express / auth middleware
// - ใช้ service โดยตรงกับ PostgreSQL pool
// - 1 wiki page_id = 1 RootID logical object
// - revisions ของ page เดียวกัน = versions ใน RootID chain
//
// Requires:
//   benchmark/utils/timer.js
//   benchmark/utils/wiki-loader.js
//   benchmark/utils/csv-writer.js
//   benchmark/utils/rootid-bench-helper.js
//
// Usage:
//
//   node benchmark/wiki-rootid-benchmark.js
//
// PowerShell:
//
//   $env:WIKI_NORMALIZED_PATH="benchmark/data/wiki-normalized-small.json";
//   $env:BENCH_SAMPLE_READS=100;
//   node benchmark/wiki-rootid-benchmark.js
//
// Optional env:
//
//   BENCH_RUN_ID
//   WIKI_NORMALIZED_PATH
//   BENCH_MAX_PAGES
//   BENCH_MAX_REVISIONS_PER_PAGE
//   BENCH_SAMPLE_READS
//   BENCH_HISTORY_LIMIT
//   BENCH_PROGRESS_EVERY
//   BENCH_INCLUDE_TEXT
//   BENCH_MIGRATE_SAMPLE
//   BENCH_COMPARE_SAMPLE
//   BENCH_CLEAR_RUN_BEFORE
//   BENCH_CLEAR_RUN_AFTER
// -----------------------------------------------------------------------------

require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");

const pool = require("../src/db/pool");

const BusinessService = require("../src/services/business.service");
const SchemaService = require("../src/services/schema.service");
const DataService = require("../src/services/data.service");

const { measure, round } = require("./utils/timer");
const { loadWikiRows } = require("./utils/wiki-loader");
const { writeCsv, writeFlattenedCsv } = require("./utils/csv-writer");

const {
  createBenchmarkAuth,
  createBenchmarkRunId,
  createBenchmarkBusiness,
  createBenchmarkWikiSchema,
  updateBenchmarkWikiSchemaToV2,
  importWikiPagesAsRootId,
  sampleLatestReads,
  sampleHistoryReads,
  sampleCompareWithLatestSchema,
  sampleMigrateToLatestSchema,
  getRootIdDbStats,
  clearBenchmarkRunData,
  ensureDir,
  makeResultFileName,
} = require("./utils/rootid-bench-helper");

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

function compactMetric(metric) {
  const out = { ...metric };

  delete out.started_at;

  return out;
}

function makeSummaryRows(metrics, stats, config, wikiSummary) {
  const rows = [];

  for (const metric of metrics) {
    rows.push(compactMetric(metric));
  }

  rows.push({
    name: "wiki_input_summary",
    rows: wikiSummary.rows,
    pages: wikiSummary.pages,
    revisions: wikiSummary.revisions,
    categories: wikiSummary.categories,
    avg_revisions_per_page: round(wikiSummary.avg_revisions_per_page),
    min_revisions_per_page: wikiSummary.min_revisions_per_page,
    max_revisions_per_page: wikiSummary.max_revisions_per_page,
  });

  rows.push({
    name: "rootid_db_stats",
    data_physical_rows: stats.data_physical_rows,
    data_current_rows: stats.data_current_rows,
    data_history_rows: stats.data_history_rows,
    data_deleted_rows: stats.data_deleted_rows,
    data_rootids: stats.data_rootids,
    data_table_bytes: stats.data_table_bytes,
    data_schema_table_bytes: stats.data_schema_table_bytes,
    database_bytes: stats.database_bytes,
  });

  rows.push({
    name: "benchmark_config",
    run_id: config.runId,
    sample_reads: config.sampleReads,
    compare_sample: config.compareSample,
    migrate_sample: config.migrateSample,
    max_pages: config.maxPages || "",
    max_revisions_per_page: config.maxRevisionsPerPage || "",
    include_text: config.includeText,
  });

  return rows;
}

async function writeJson(filePath, data) {
  const outputPath = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), "utf8");
  return outputPath;
}

async function main() {
  const runId = process.env.BENCH_RUN_ID || createBenchmarkRunId("wiki-rootid");

  const config = {
    runId,
    wikiPath:
      process.env.WIKI_NORMALIZED_PATH ||
      process.env.WIKI_JSON_PATH ||
      "benchmark/data/wiki-normalized.json",

    maxPages: getIntEnv("BENCH_MAX_PAGES", 0),
    maxRevisionsPerPage: getIntEnv("BENCH_MAX_REVISIONS_PER_PAGE", 0),

    sampleReads: getIntEnv("BENCH_SAMPLE_READS", 200),
    historyLimit: getIntEnv("BENCH_HISTORY_LIMIT", 1000),
    compareSample: getIntEnv("BENCH_COMPARE_SAMPLE", 100),
    migrateSample: getIntEnv("BENCH_MIGRATE_SAMPLE", 100),

    progressEvery: getIntEnv("BENCH_PROGRESS_EVERY", 100),

    includeText: getBoolEnv("BENCH_INCLUDE_TEXT", false),
    clearRunBefore: getBoolEnv("BENCH_CLEAR_RUN_BEFORE", false),
    clearRunAfter: getBoolEnv("BENCH_CLEAR_RUN_AFTER", false),
  };

  const auth = createBenchmarkAuth(1);
  const metrics = [];

  const outputDir = "benchmark/results";
  await ensureDir(outputDir);

  console.log("[wiki-rootid-benchmark] starting");
  console.log("[wiki-rootid-benchmark] runId:", runId);
  console.log("[wiki-rootid-benchmark] config:", JSON.stringify(config, null, 2));

  const businessService = new BusinessService(pool);
  const schemaService = new SchemaService(pool);
  const dataService = new DataService(pool);

  try {
    if (config.clearRunBefore) {
      console.log("[wiki-rootid-benchmark] clear previous run data:", runId);

      const clearBefore = await measure("clear_run_before", async () => {
        return clearBenchmarkRunData(pool, runId);
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

    console.log("[wiki-rootid-benchmark] wiki summary:");
    console.log(JSON.stringify(wiki.summary, null, 2));

    if (wiki.rows.length === 0 || wiki.pageMap.size === 0) {
      throw new Error("Wiki data is empty after loading/grouping");
    }

    const createBusiness = await measure("create_business", async () => {
      return createBenchmarkBusiness(businessService, {
        runId,
        name: `Benchmark Wiki ${runId}`,
      });
    });

    metrics.push(createBusiness.metric);

    const business = createBusiness.result;

    const createSchema = await measure("create_schema_v1", async () => {
      return createBenchmarkWikiSchema(schemaService, business, {
        runId,
        includeText: config.includeText,
        name: `Wikipedia Benchmark Schema ${runId}`,
      });
    });

    metrics.push(createSchema.metric);

    const schema = createSchema.result;

    const importWiki = await measure("import_wiki_pages_as_rootid", async () => {
      return importWikiPagesAsRootId(dataService, schema, wiki.pageMap, {
        auth,
        runId,
        progressEvery: config.progressEvery,
      });
    });

    metrics.push({
      ...importWiki.metric,
      pages: importWiki.result.pages,
      revisions: importWiki.result.revisions,
      updates: importWiki.result.updates,
      revisions_per_sec: round(importWiki.result.revisions / (importWiki.metric.ms / 1000)),
      pages_per_sec: round(importWiki.result.pages / (importWiki.metric.ms / 1000)),
      updates_per_sec: round(importWiki.result.updates / (importWiki.metric.ms / 1000)),
    });

    const importedPages = importWiki.result.imported;

    const latestReads = await measure("sample_latest_reads", async () => {
      return sampleLatestReads(dataService, importedPages, {
        auth,
        limit: config.sampleReads,
      });
    });

    metrics.push({
      ...latestReads.metric,
      reads: latestReads.result.reads,
      avg_ms_per_read: round(latestReads.metric.ms / latestReads.result.reads),
      reads_per_sec: round(latestReads.result.reads / (latestReads.metric.ms / 1000)),
    });

    const historyReads = await measure("sample_history_reads", async () => {
      return sampleHistoryReads(dataService, importedPages, {
        auth,
        limit: config.sampleReads,
        historyLimit: config.historyLimit,
      });
    });

    metrics.push({
      ...historyReads.metric,
      reads: historyReads.result.reads,
      avg_versions: round(historyReads.result.avg_versions),
      avg_ms_per_history: round(historyReads.metric.ms / historyReads.result.reads),
      history_reads_per_sec: round(historyReads.result.reads / (historyReads.metric.ms / 1000)),
    });

    const updateSchema = await measure("update_schema_to_v2", async () => {
      return updateBenchmarkWikiSchemaToV2(schemaService, schema, {
        includeText: config.includeText,
      });
    });

    metrics.push(updateSchema.metric);

    const compareSample = await measure("sample_compare_with_latest_schema", async () => {
      return sampleCompareWithLatestSchema(dataService, importedPages, {
        auth,
        limit: config.compareSample,
      });
    });

    metrics.push({
      ...compareSample.metric,
      rows: compareSample.result.rows,
      avg_ms_per_compare: round(compareSample.metric.ms / compareSample.result.rows),
      compares_per_sec: round(compareSample.result.rows / (compareSample.metric.ms / 1000)),
    });

    const migrateSample = await measure("sample_migrate_to_latest_schema", async () => {
      return sampleMigrateToLatestSchema(dataService, importedPages, {
        auth,
        limit: config.migrateSample,
        force: true,
      });
    });

    metrics.push({
      ...migrateSample.metric,
      rows: migrateSample.result.rows,
      migrated: migrateSample.result.migrated,
      alreadyLatest: migrateSample.result.alreadyLatest,
      requiresReview: migrateSample.result.requiresReview,
      avg_ms_per_migrate: round(migrateSample.metric.ms / migrateSample.result.rows),
      migrates_per_sec: round(migrateSample.result.rows / (migrateSample.metric.ms / 1000)),
    });

    const statsAfter = await getRootIdDbStats(pool, runId);

    const output = {
      benchmark: "wiki-rootid-core",
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
      stats: statsAfter,
      imported: {
        pages: importedPages.length,
        sample: importedPages.slice(0, 10),
      },
      samples: {
        history: historyReads.result.histories.slice(0, 10),
        compare: compareSample.result.compared.slice(0, 10),
        migrate: migrateSample.result.details.slice(0, 10),
      },
    };

    const jsonFile = path.join(
      outputDir,
      makeResultFileName("wiki-rootid-result", "json", runId)
    );

    const summaryCsvFile = path.join(
      outputDir,
      makeResultFileName("wiki-rootid-summary", "csv", runId)
    );

    const metricsCsvFile = path.join(
      outputDir,
      makeResultFileName("wiki-rootid-metrics", "csv", runId)
    );

    const importedCsvFile = path.join(
      outputDir,
      makeResultFileName("wiki-rootid-imported", "csv", runId)
    );

    await writeJson(jsonFile, output);

    await writeCsv(summaryCsvFile, makeSummaryRows(metrics, statsAfter, config, wiki.summary), {
      bom: true,
    });

    await writeFlattenedCsv(metricsCsvFile, metrics, {
      bom: true,
      maxDepth: 2,
    });

    await writeCsv(importedCsvFile, importedPages, {
      bom: true,
      headers: [
        "page_id",
        "page_title",
        "rootid",
        "first_id",
        "latest_id",
        "revisions",
        "updates",
      ],
    });

    console.log("\n[wiki-rootid-benchmark] done");
    console.log("[wiki-rootid-benchmark] result json:", jsonFile);
    console.log("[wiki-rootid-benchmark] summary csv:", summaryCsvFile);
    console.log("[wiki-rootid-benchmark] metrics csv:", metricsCsvFile);
    console.log("[wiki-rootid-benchmark] imported csv:", importedCsvFile);

    console.log("\n[wiki-rootid-benchmark] metrics:");
    console.table(
      metrics.map((m) => ({
        name: m.name,
        ms: m.ms,
        rows: m.rows || "",
        pages: m.pages || "",
        revisions: m.revisions || "",
        updates: m.updates || "",
        reads: m.reads || "",
        avg_ms:
          m.avg_ms_per_read ||
          m.avg_ms_per_history ||
          m.avg_ms_per_compare ||
          m.avg_ms_per_migrate ||
          "",
      }))
    );

    console.log("\n[wiki-rootid-benchmark] db stats:");
    console.table([statsAfter]);

    if (config.clearRunAfter) {
      console.log("[wiki-rootid-benchmark] clear run after:", runId);
      await clearBenchmarkRunData(pool, runId);
    }
  } finally {
    await pool.end();
  }
}

main().catch(async (err) => {
  console.error("[wiki-rootid-benchmark] failed:", err);

  if (err.benchmarkResult) {
    console.error("[wiki-rootid-benchmark] metric:", err.benchmarkResult);
  }

  try {
    await pool.end();
  } catch (_err) {
    // ignore
  }

  process.exit(1);
});