// benchmark/scripts/export-benchmark-json.js
// -----------------------------------------------------------------------------
// Export benchmark results into clean JSON for HTML dashboard / graph / table
//
// Reads:
//   benchmark/results/*-result-*.json
//
// Writes:
//   benchmark/results/wiki-benchmark-summary-<runId or latest>.json
// -----------------------------------------------------------------------------

require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");

const RESULTS_DIR = path.resolve(process.cwd(), "benchmark/results");

const MODELS = [
  {
    key: "pg_relational",
    method: "PG Relational",
    prefix: "wiki-pg-relational-result-",
    importMetric: "import_wiki_pages",
    mutationEnv: "BENCH_PG_RELATIONAL_MUTATION",
    insertNote:
      "Insert page records into bench_wiki_page and revision records into bench_wiki_revision. The input is loaded from wiki-normalized.json before database insertion.",
    updateNote:
      "Optional baseline mutation. When enabled, update appends a synthetic revision row. Disabled by default so PG Relational can remain a reference dataset.",
    deleteNote:
      "Optional baseline mutation. When enabled, delete physically removes the latest revision row. Disabled by default.",
    schemaNote:
      "Fixed relational schema with separated page and revision tables.",
  },
  {
    key: "pg_jsonb",
    method: "PG JSONB",
    prefix: "wiki-pg-jsonb-result-",
    importMetric: "import_wiki_pages",
    mutationEnv: "BENCH_PG_JSONB_MUTATION",
    insertNote:
      "Insert each Wikipedia revision as a JSONB payload row into bench_wiki_jsonb. The input is loaded from wiki-normalized.json before database insertion.",
    updateNote:
      "Optional baseline mutation. When enabled, update appends a synthetic JSONB revision row. Disabled by default.",
    deleteNote:
      "Optional baseline mutation. When enabled, delete physically removes the latest JSONB revision row. Disabled by default.",
    schemaNote:
      "Single PostgreSQL table using JSONB payload for revision records.",
  },
  {
    key: "mongo",
    method: "MongoDB",
    prefix: "wiki-mongo-result-",
    importMetric: "import_wiki_pages",
    mutationEnv: "BENCH_MONGO_MUTATION",
    insertNote:
      "Insert each Wikipedia revision as a MongoDB document. The input is loaded from wiki-normalized.json before database insertion.",
    updateNote:
      "Optional baseline mutation. When enabled, update appends a synthetic revision document. Disabled by default.",
    deleteNote:
      "Optional baseline mutation. When enabled, delete physically removes the latest revision document. Disabled by default.",
    schemaNote:
      "Document-based storage using MongoDB collection.",
  },
  {
    key: "rootid",
    method: "RootID",
    prefix: "wiki-rootid-result-",
    importMetric: "import_wiki_pages_as_rootid",
    mutationEnv: null,
    insertNote:
      "Insert revisions into the RootID data table as version chains. Each page_id becomes one logical _rootid chain, and each revision becomes one physical version row. Updating a page creates a new version and marks the previous current row as _flag='u'.",
    updateNote:
      "RootID update creates a new version row and marks the previous current row as historical with _flag='u'.",
    deleteNote:
      "RootID delete creates a delete marker with _flag='d' while preserving previous versions.",
    schemaNote:
      "Versioned schema model. Schema v1 is created before import. Schema v2 is created after import to evaluate schema comparison and migration.",
  },
];

function round(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function safeValue(value) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function getMetric(result, name) {
  return (result.metrics || []).find((m) => m.name === name) || null;
}

function getStat(stats, names) {
  for (const name of names) {
    if (stats && stats[name] !== undefined && stats[name] !== null) {
      return stats[name];
    }
  }
  return null;
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
  if (!(await pathExists(RESULTS_DIR))) return [];

  const files = await fs.readdir(RESULTS_DIR);

  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(RESULTS_DIR, file));
}

async function findLatestModelFile(model) {
  const runId = process.env.BENCH_RUN_ID || "";
  const jsonFiles = await listJsonFiles();

  const candidates = [];

  for (const filePath of jsonFiles) {
    const fileName = path.basename(filePath);

    if (!fileName.startsWith(model.prefix)) continue;
    if (runId && !fileName.includes(runId)) continue;

    const stat = await fs.stat(filePath);

    candidates.push({
      filePath,
      fileName,
      mtimeMs: stat.mtimeMs,
    });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0] || null;
}

function makeReadBlock(metric, metricName, type) {
  if (!metric) {
    return {
      metric_name: metricName,
      execute_ms: null,
      reads: null,
      avg_ms_per_read: null,
      avg_ms_per_history: null,
      reads_per_sec: null,
      history_reads_per_sec: null,
      avg_versions: null,
    };
  }

  if (type === "history") {
    return {
      metric_name: metricName,
      execute_ms: round(metric.ms),
      reads: safeValue(metric.reads),
      avg_versions: round(metric.avg_versions),
      avg_ms_per_history: round(metric.avg_ms_per_history),
      history_reads_per_sec: round(metric.history_reads_per_sec),
    };
  }

  return {
    metric_name: metricName,
    execute_ms: round(metric.ms),
    reads: safeValue(metric.reads),
    avg_ms_per_read: round(metric.avg_ms_per_read),
    reads_per_sec: round(metric.reads_per_sec),
    deleted_markers: safeValue(metric.deleted_markers),
    not_found_as_current: safeValue(metric.not_found_as_current),
  };
}

function buildModelSummary(model, result, sourceFile) {
  const loadMetric = getMetric(result, "load_wiki_rows");
  const importMetric = getMetric(result, model.importMetric);

  const latestReadMetric = getMetric(result, "sample_latest_reads");
  const historyReadMetric = getMetric(result, "sample_history_reads");

  const updateMetric = getMetric(result, "sample_version_updates");
  const latestAfterUpdateMetric = getMetric(result, "sample_latest_reads_after_update");
  const historyAfterUpdateMetric = getMetric(result, "sample_history_reads_after_update");

  const deleteMetric = getMetric(result, "sample_deletes");
  const latestAfterDeleteMetric = getMetric(result, "sample_latest_reads_after_delete");
  const verifyDeleteMetric = getMetric(result, "verify_deletes");

  const createBusinessMetric = getMetric(result, "create_business");
  const createSchemaV1Metric = getMetric(result, "create_schema_v1");
  const updateSchemaV2Metric = getMetric(result, "update_schema_to_v2");
  const compareMetric = getMetric(result, "sample_compare_with_latest_schema");
  const migrateMetric = getMetric(result, "sample_migrate_to_latest_schema");

  const wikiSummary = result.wiki?.summary || {};
  const stats = result.stats || {};
  const config = result.config || {};

  return {
    method: model.method,
    method_key: model.key,
    benchmark: result.benchmark || null,
    run_id: result.runId || null,
    timestamp: result.timestamp || null,
    source_file: sourceFile,

    dataset: {
      rows: safeValue(wikiSummary.rows),
      pages: safeValue(wikiSummary.pages),
      revisions: safeValue(wikiSummary.revisions),
      categories: safeValue(wikiSummary.categories),
      avg_revisions_per_page: round(wikiSummary.avg_revisions_per_page),
      min_revisions_per_page: safeValue(wikiSummary.min_revisions_per_page),
      max_revisions_per_page: safeValue(wikiSummary.max_revisions_per_page),
      invalid_rows: safeValue(result.wiki?.invalidRows),
      include_text: safeValue(config.includeText),
      note:
        "Each Wikipedia page is treated as one logical object. Each revision is treated as one version record.",
    },

    input_loading: {
      metric_name: "load_wiki_rows",
      execute_ms: round(loadMetric?.ms),
      rows: safeValue(loadMetric?.rows),
      pages: safeValue(loadMetric?.pages),
      revisions: safeValue(loadMetric?.revisions),
      note:
        "Load wiki-normalized.json into memory and group rows by page_id. This step does not insert data into the database.",
    },

    insert: {
      metric_name: model.importMetric,
      execute_ms: round(importMetric?.ms),
      pages: safeValue(importMetric?.pages),
      revisions: safeValue(importMetric?.revisions),
      updates: safeValue(importMetric?.updates),
      pages_per_sec: round(importMetric?.pages_per_sec),
      revisions_per_sec: round(importMetric?.revisions_per_sec),
      updates_per_sec: round(importMetric?.updates_per_sec),
      note: model.insertNote,
    },

    read: {
      latest: {
        ...makeReadBlock(latestReadMetric, "sample_latest_reads", "latest"),
        note:
          "Read latest/current version samples. Default sample size is controlled by BENCH_SAMPLE_READS.",
      },
      history: {
        ...makeReadBlock(historyReadMetric, "sample_history_reads", "history"),
        note:
          "Read version history samples for logical objects/pages. Default sample size is controlled by BENCH_SAMPLE_READS.",
      },
    },

    update: {
      enabled:
        model.key === "rootid" ||
        Boolean(config.enableMutation) ||
        Boolean(updateMetric),
      mutation_env: model.mutationEnv,
      metric_name: "sample_version_updates",
      execute_ms: round(updateMetric?.ms),
      updates: safeValue(updateMetric?.updates),
      avg_ms_per_update: round(updateMetric?.avg_ms_per_update),
      updates_per_sec: round(updateMetric?.updates_per_sec),
      note: model.updateNote,
    },

    read_after_update: {
      latest: makeReadBlock(
        latestAfterUpdateMetric,
        "sample_latest_reads_after_update",
        "latest"
      ),
      history: makeReadBlock(
        historyAfterUpdateMetric,
        "sample_history_reads_after_update",
        "history"
      ),
    },

    delete: {
      enabled:
        model.key === "rootid" ||
        Boolean(config.enableMutation) ||
        Boolean(deleteMetric),
      mutation_env: model.mutationEnv,
      metric_name: "sample_deletes",
      execute_ms: round(deleteMetric?.ms),
      deletes: safeValue(deleteMetric?.deletes),
      avg_ms_per_delete: round(deleteMetric?.avg_ms_per_delete),
      deletes_per_sec: round(deleteMetric?.deletes_per_sec),
      note: model.deleteNote,
    },

    read_after_delete: {
      latest: makeReadBlock(
        latestAfterDeleteMetric,
        "sample_latest_reads_after_delete",
        "latest"
      ),
      verification: verifyDeleteMetric
        ? {
            metric_name: "verify_deletes",
            execute_ms: round(verifyDeleteMetric.ms),
            checks: safeValue(verifyDeleteMetric.checks),
            ok: safeValue(verifyDeleteMetric.ok),
            failed: safeValue(verifyDeleteMetric.failed),
            avg_ms_per_check: round(verifyDeleteMetric.avg_ms_per_check),
            checks_per_sec: round(verifyDeleteMetric.checks_per_sec),
          }
        : null,
    },

    schema: {
      model: model.schemaNote,
      create_business_ms: round(createBusinessMetric?.ms),
      create_schema_v1_ms: round(createSchemaV1Metric?.ms),
      update_schema_v2_ms: round(updateSchemaV2Metric?.ms),
      compare_with_latest_schema: compareMetric
        ? {
            metric_name: "sample_compare_with_latest_schema",
            execute_ms: round(compareMetric.ms),
            rows: safeValue(compareMetric.rows),
            avg_ms_per_compare: round(compareMetric.avg_ms_per_compare),
            compares_per_sec: round(compareMetric.compares_per_sec),
            note:
              "RootID-only operation. Compare data rows created with schema v1 against the latest schema version.",
          }
        : null,
      migrate_to_latest_schema: migrateMetric
        ? {
            metric_name: "sample_migrate_to_latest_schema",
            execute_ms: round(migrateMetric.ms),
            rows: safeValue(migrateMetric.rows),
            migrated: safeValue(migrateMetric.migrated),
            already_latest: safeValue(migrateMetric.alreadyLatest),
            requires_review: safeValue(migrateMetric.requiresReview),
            avg_ms_per_migrate: round(migrateMetric.avg_ms_per_migrate),
            migrates_per_sec: round(migrateMetric.migrates_per_sec),
            note:
              "RootID-only operation. Migrate selected data rows to the latest schema version by creating new RootID versions.",
          }
        : null,
    },

    storage: {
      pages: getStat(stats, ["pages"]),
      revisions: getStat(stats, ["revisions"]),
      documents: getStat(stats, ["documents"]),
      physical_rows: getStat(stats, [
        "data_physical_rows",
        "physical_rows",
        "revisions",
        "documents",
      ]),
      current_rows: getStat(stats, ["data_current_rows"]),
      history_rows: getStat(stats, ["data_history_rows"]),
      deleted_rows: getStat(stats, ["data_deleted_rows"]),
      logical_rootids: getStat(stats, ["data_rootids", "page_ids"]),
      database_bytes: getStat(stats, ["database_bytes"]),
      data_table_bytes: getStat(stats, ["data_table_bytes"]),
      schema_table_bytes: getStat(stats, ["data_schema_table_bytes"]),
      page_table_bytes: getStat(stats, ["page_table_bytes"]),
      revision_table_bytes: getStat(stats, ["revision_table_bytes"]),
      jsonb_table_bytes: getStat(stats, ["jsonb_table_bytes"]),
      collection_bytes: getStat(stats, ["collection_bytes", "storage_size"]),
      note:
        "Storage statistics are model-specific. Not every model reports the same storage fields.",
    },

    raw_metrics: result.metrics || [],
  };
}

async function main() {
  const summaries = [];
  const missing = [];

  for (const model of MODELS) {
    const file = await findLatestModelFile(model);

    if (!file) {
      missing.push(model.method);
      continue;
    }

    const result = await readJson(file.filePath);

    summaries.push(buildModelSummary(model, result, file.fileName));

    console.log(`[export-json] loaded ${model.method}: ${file.fileName}`);
  }

  if (summaries.length === 0) {
    throw new Error(
      `No benchmark result files found in ${RESULTS_DIR}. Run benchmark first.`
    );
  }

  const runId = process.env.BENCH_RUN_ID || "latest";

  const output = {
    report_type: "wiki_benchmark_summary",
    generated_at: new Date().toISOString(),
    run_id: runId,
    source_dir: RESULTS_DIR,
    missing_methods: missing,
    methods: summaries,
  };

  const outputFile = path.join(
    RESULTS_DIR,
    `wiki-benchmark-summary-${String(runId).replace(/[^a-zA-Z0-9._-]/g, "_")}.json`
  );

  await fs.writeFile(outputFile, JSON.stringify(output, null, 2), "utf8");

  console.log("[export-json] done");
  console.log("[export-json] output:", outputFile);

  if (missing.length > 0) {
    console.log("[export-json] missing methods:", missing.join(", "));
  }
}

main().catch((err) => {
  console.error("[export-json] failed:", err);
  process.exit(1);
});