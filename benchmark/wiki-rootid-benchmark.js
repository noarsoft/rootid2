// benchmark/wiki-rootid-benchmark.js
// -----------------------------------------------------------------------------
// Wiki → RootID Core Benchmark
//
// Flow:
// 1. load_wiki_rows
// 2. insert/import
// 3. latest read
// 4. history read
// 5. update/version append sample
// 6. latest read after update
// 7. history read after update
// 8. delete sample
// 9. latest read after delete / delete verification
// 10. schema evolution
// 11. storage stats
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

const MODEL_NAME = "rootid";

function safeDiv(a, b) {
  if (!b) return 0;
  return a / b;
}

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
    ...stats,
  });

  rows.push({
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
    compare_sample: config.compareSample,
    migrate_sample: config.migrateSample,
  });

  return rows;
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
      m.avg_ms_per_compare ||
      m.avg_ms_per_migrate ||
      m.avg_ms_per_check ||
      "",
  }));
}

function makeSyntheticRootIdUpdatePayload(latestPayload = {}, options = {}) {
  const runId = options.runId || "benchmark";
  const index = Number(options.index || 0);
  const now = new Date();
  const syntheticRevisionId = Date.now() * 1000 + index;

  return {
    ...(latestPayload || {}),

    revision_id: syntheticRevisionId,
    revision_timestamp: now.toISOString(),
    revision_user: "rootid_benchmark_update",
    revision_comment: `Synthetic RootID benchmark update ${index + 1}`,
    revision_sha1: `synthetic-rootid-update-${runId}-${index + 1}`,
    text_hash: `synthetic-rootid-update-${runId}-${index + 1}`,
    text_size: Number(latestPayload.text_size || 0) + 1,

    benchmark_update: true,
    benchmark_update_index: index + 1,
    benchmark_update_at: now.toISOString(),
  };
}

async function sampleVersionUpdatesRootId(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const runId = options.runId || "benchmark";
  const limit = Number(options.limit || process.env.BENCH_UPDATE_SAMPLE || 100);
  const sample = importedPages.slice(0, Math.min(limit, importedPages.length));

  const updated = [];

  for (let i = 0; i < sample.length; i += 1) {
    const item = sample[i];

    const latestBefore = await dataService.getLatestDataByRootId(item.rootid, {
      auth,
      includeDeleted: false,
    });

    const payload = makeSyntheticRootIdUpdatePayload(latestBefore.payload || {}, {
      runId,
      index: i,
    });

    const latestAfter = await dataService.updateData(
      item.rootid,
      {
        payload,
        allowExtraFields: true,
      },
      { auth }
    );

    item.latest_id_after_update = latestAfter.id;
    item.updated_in_benchmark = true;

    updated.push({
      rootid: item.rootid,
      page_id: item.page_id,
      page_title: item.page_title,
      before_id: latestBefore.id,
      after_id: latestAfter.id,
      before_revision_id: latestBefore.payload?.revision_id ?? null,
      after_revision_id: latestAfter.payload?.revision_id ?? null,
    });
  }

  return {
    updated,
    updates: updated.length,
  };
}

async function sampleLatestReadsAfterUpdateRootId(dataService, importedPages, options = {}) {
  return sampleLatestReads(dataService, importedPages, options);
}

async function sampleHistoryReadsAfterUpdateRootId(dataService, importedPages, options = {}) {
  return sampleHistoryReads(dataService, importedPages, options);
}

async function sampleDeletesRootId(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const limit = Number(options.limit || process.env.BENCH_DELETE_SAMPLE || 50);
  const sample = importedPages.slice(0, Math.min(limit, importedPages.length));

  const deleted = [];

  for (const item of sample) {
    const latestBefore = await dataService.getLatestDataByRootId(item.rootid, {
      auth,
      includeDeleted: false,
    });

    const deleteMarker = await dataService.deleteData(item.rootid, {
      auth,
    });

    item.deleted_in_benchmark = true;
    item.delete_marker_id = deleteMarker.id;

    deleted.push({
      rootid: item.rootid,
      page_id: item.page_id,
      page_title: item.page_title,
      before_id: latestBefore.id,
      before_revision_id: latestBefore.payload?.revision_id ?? null,
      delete_marker_id: deleteMarker.id,
      delete_flag: deleteMarker._flag,
    });
  }

  return {
    deleted,
    deletes: deleted.length,
  };
}

async function sampleLatestReadsAfterDeleteRootId(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const limit = Number(options.limit || process.env.BENCH_DELETE_SAMPLE || 50);
  const sample = importedPages.slice(0, Math.min(limit, importedPages.length));

  const rows = [];

  let deletedMarkers = 0;
  let notFoundAsCurrent = 0;

  for (const item of sample) {
    const latestWithDeleted = await dataService.getLatestDataByRootId(item.rootid, {
      auth,
      includeDeleted: true,
    });

    if (latestWithDeleted?._flag === "d") {
      deletedMarkers += 1;
    }

    try {
      await dataService.getLatestDataByRootId(item.rootid, {
        auth,
        includeDeleted: false,
      });
    } catch (err) {
      if (err.code === "DATA_NOT_FOUND") {
        notFoundAsCurrent += 1;
      } else {
        throw err;
      }
    }

    rows.push({
      rootid: item.rootid,
      page_id: item.page_id,
      page_title: item.page_title,
      latest_id: latestWithDeleted?.id || null,
      latest_flag: latestWithDeleted?._flag || null,
    });
  }

  return {
    rows,
    reads: rows.length,
    deleted_markers: deletedMarkers,
    not_found_as_current: notFoundAsCurrent,
  };
}

async function verifyDeletesRootId(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const limit = Number(options.limit || process.env.BENCH_DELETE_SAMPLE || 50);
  const sample = importedPages.slice(0, Math.min(limit, importedPages.length));

  const verified = [];

  let ok = 0;
  let failed = 0;

  for (const item of sample) {
    const latest = await dataService.getLatestDataByRootId(item.rootid, {
      auth,
      includeDeleted: true,
    });

    const history = await dataService.getDataHistory(item.rootid, {
      auth,
      includeDeleted: true,
      limit: options.historyLimit || 1000,
      offset: 0,
      order: "ASC",
    });

    const isDeleted = latest?._flag === "d";
    const hasHistory = history.length > 0;
    const passed = isDeleted && hasHistory;

    if (passed) ok += 1;
    else failed += 1;

    verified.push({
      rootid: item.rootid,
      page_id: item.page_id,
      page_title: item.page_title,
      latest_id: latest?.id || null,
      latest_flag: latest?._flag || null,
      history_versions: history.length,
      ok: passed,
    });
  }

  return {
    verified,
    checks: verified.length,
    ok,
    failed,
  };
}

async function main() {
  const runId = process.env.BENCH_RUN_ID || createBenchmarkRunId("wiki-rootid");

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

    compareSample: getIntEnv("BENCH_COMPARE_SAMPLE", 100),
    migrateSample: getIntEnv("BENCH_MIGRATE_SAMPLE", 100),

    clearRunBefore: getBoolEnv("BENCH_CLEAR_RUN_BEFORE", true),
    clearRunAfter: getBoolEnv("BENCH_CLEAR_RUN_AFTER", false),
  };

  const metrics = [];
  const outputDir = "benchmark/results";

  await ensureDir(outputDir);

  console.log(`[${MODEL_NAME}] starting`);
  console.log(`[${MODEL_NAME}] runId:`, runId);
  console.log(`[${MODEL_NAME}] config:`, JSON.stringify(config, null, 2));

  const businessService = new BusinessService(pool);
  const schemaService = new SchemaService(pool);
  const dataService = new DataService(pool);

  const auth = createBenchmarkAuth();

  try {
    if (config.clearRunBefore) {
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

    if (wiki.rows.length === 0 || wiki.pageMap.size === 0) {
      throw new Error("Wiki data is empty after loading/grouping");
    }

    const createBusiness = await measure("create_business", async () => {
      return createBenchmarkBusiness(businessService, {
        runId,
        name: `Wikipedia Benchmark ${runId}`,
      });
    });

    metrics.push(createBusiness.metric);

    const business = createBusiness.result;

    const createSchema = await measure("create_schema_v1", async () => {
      return createBenchmarkWikiSchema(schemaService, business, {
        runId,
        includeText: config.includeText,
      });
    });

    metrics.push(createSchema.metric);

    const schema = createSchema.result;

    const importWiki = await measure("import_wiki_pages_as_rootid", async () => {
      return importWikiPagesAsRootId(dataService, schema, wiki.pageMap, {
        auth,
        runId,
        progressEvery: config.progressEvery,

        // benchmark/demo data ให้เปิด share all
        shareMode: "all",
      });
    });

    metrics.push({
      ...importWiki.metric,
      pages: importWiki.result.pages,
      revisions: importWiki.result.revisions,
      updates: importWiki.result.updates,
      revisions_per_sec: round(safeDiv(importWiki.result.revisions, importWiki.metric.ms / 1000)),
      pages_per_sec: round(safeDiv(importWiki.result.pages, importWiki.metric.ms / 1000)),
      updates_per_sec: round(safeDiv(importWiki.result.updates, importWiki.metric.ms / 1000)),
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
      avg_ms_per_read: round(safeDiv(latestReads.metric.ms, latestReads.result.reads)),
      reads_per_sec: round(safeDiv(latestReads.result.reads, latestReads.metric.ms / 1000)),
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
      avg_ms_per_history: round(safeDiv(historyReads.metric.ms, historyReads.result.reads)),
      history_reads_per_sec: round(safeDiv(historyReads.result.reads, historyReads.metric.ms / 1000)),
    });

    const updateSample = await measure("sample_version_updates", async () => {
      return sampleVersionUpdatesRootId(dataService, importedPages, {
        auth,
        runId,
        limit: config.updateSample,
      });
    });

    metrics.push({
      ...updateSample.metric,
      updates: updateSample.result.updates,
      avg_ms_per_update: round(safeDiv(updateSample.metric.ms, updateSample.result.updates)),
      updates_per_sec: round(safeDiv(updateSample.result.updates, updateSample.metric.ms / 1000)),
    });

    const latestReadsAfterUpdate = await measure(
      "sample_latest_reads_after_update",
      async () => {
        return sampleLatestReadsAfterUpdateRootId(dataService, importedPages, {
          auth,
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

    const historyReadsAfterUpdate = await measure(
      "sample_history_reads_after_update",
      async () => {
        return sampleHistoryReadsAfterUpdateRootId(dataService, importedPages, {
          auth,
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

    const deleteSample = await measure("sample_deletes", async () => {
      return sampleDeletesRootId(dataService, importedPages, {
        auth,
        limit: config.deleteSample,
      });
    });

    metrics.push({
      ...deleteSample.metric,
      deletes: deleteSample.result.deletes,
      avg_ms_per_delete: round(safeDiv(deleteSample.metric.ms, deleteSample.result.deletes)),
      deletes_per_sec: round(safeDiv(deleteSample.result.deletes, deleteSample.metric.ms / 1000)),
    });

    const latestReadsAfterDelete = await measure(
      "sample_latest_reads_after_delete",
      async () => {
        return sampleLatestReadsAfterDeleteRootId(dataService, importedPages, {
          auth,
          limit: config.deleteSample,
        });
      }
    );

    metrics.push({
      ...latestReadsAfterDelete.metric,
      reads: latestReadsAfterDelete.result.reads,
      deleted_markers: latestReadsAfterDelete.result.deleted_markers,
      not_found_as_current: latestReadsAfterDelete.result.not_found_as_current,
      avg_ms_per_read: round(
        safeDiv(latestReadsAfterDelete.metric.ms, latestReadsAfterDelete.result.reads)
      ),
      reads_per_sec: round(
        safeDiv(latestReadsAfterDelete.result.reads, latestReadsAfterDelete.metric.ms / 1000)
      ),
    });

    const deleteVerification = await measure("verify_deletes", async () => {
      return verifyDeletesRootId(dataService, importedPages, {
        auth,
        limit: config.deleteSample,
        historyLimit: config.historyLimit,
      });
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

    const activePages = importedPages.filter((item) => !item.deleted_in_benchmark);

    const updateSchema = await measure("update_schema_to_v2", async () => {
      return updateBenchmarkWikiSchemaToV2(schemaService, schema, {
        includeText: config.includeText,
      });
    });

    metrics.push(updateSchema.metric);

    const schemaV2 = updateSchema.result;

    const compareSample = await measure("sample_compare_with_latest_schema", async () => {
      return sampleCompareWithLatestSchema(dataService, activePages, {
        auth,
        limit: config.compareSample,
      });
    });

    metrics.push({
      ...compareSample.metric,
      rows: compareSample.result.rows,
      avg_ms_per_compare: round(safeDiv(compareSample.metric.ms, compareSample.result.rows)),
      compares_per_sec: round(safeDiv(compareSample.result.rows, compareSample.metric.ms / 1000)),
    });

    const migrateSample = await measure("sample_migrate_to_latest_schema", async () => {
      return sampleMigrateToLatestSchema(dataService, activePages, {
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
      avg_ms_per_migrate: round(safeDiv(migrateSample.metric.ms, migrateSample.result.rows)),
      migrates_per_sec: round(safeDiv(migrateSample.result.rows, migrateSample.metric.ms / 1000)),
    });

    const stats = await getRootIdDbStats(pool, runId);

    const output = {
      benchmark: "wiki-rootid",
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
      rootid: {
        business,
        schema_v1: schema,
        schema_v2: schemaV2,
      },
      metrics,
      stats,
      imported: {
        pages: importedPages.length,
        active_pages_after_delete: activePages.length,
        sample: importedPages.slice(0, 10),
      },
      samples: {
        latest: latestReads.result.rows.slice(0, 10),
        history: historyReads.result.histories.slice(0, 10),

        updates: updateSample.result.updated.slice(0, 10),
        latest_after_update: latestReadsAfterUpdate.result.rows.slice(0, 10),
        history_after_update: historyReadsAfterUpdate.result.histories.slice(0, 10),

        deletes: deleteSample.result.deleted.slice(0, 10),
        latest_after_delete: latestReadsAfterDelete.result.rows.slice(0, 10),
        delete_verification: deleteVerification.result.verified.slice(0, 10),

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

    await writeCsv(summaryCsvFile, makeSummaryRows(metrics, stats, config, wiki.summary), {
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
        "latest_id_after_update",
        "delete_marker_id",
        "revisions",
        "updates",
        "updated_in_benchmark",
        "deleted_in_benchmark",
      ],
    });

    console.log(`\n[${MODEL_NAME}] done`);
    console.log(`[${MODEL_NAME}] result json:`, jsonFile);
    console.log(`[${MODEL_NAME}] summary csv:`, summaryCsvFile);
    console.log(`[${MODEL_NAME}] metrics csv:`, metricsCsvFile);
    console.log(`[${MODEL_NAME}] imported csv:`, importedCsvFile);

    console.table(makeConsoleRows(metrics));
    console.table([stats]);

    if (config.clearRunAfter) {
      await clearBenchmarkRunData(pool, runId);
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