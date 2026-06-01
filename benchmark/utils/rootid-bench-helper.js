// benchmark/utils/rootid-bench-helper.js
// -----------------------------------------------------------------------------
// RootID benchmark helper
//
// ใช้กับ benchmark ที่เรียก service/repository โดยตรง ไม่ผ่าน API
//
// Services expected:
//   BusinessService
//   SchemaService
//   DataService
//
// หมายเหตุ:
// - DataService ต้องใช้ auth context
// - benchmark นี้จึงสร้าง mock admin auth ให้
// -----------------------------------------------------------------------------

const path = require("node:path");
const fs = require("node:fs/promises");

const { round } = require("./timer");

function createBenchmarkAuth(userId = 1) {
  return {
    user: {
      id: userId,
      user_id: userId,
    },
    roles: [
      {
        role_code: "admin",
        system_code: "rootid2",
      },
    ],
    isAdmin: true,
    provider: "benchmark",
  };
}

function createBenchmarkRunId(prefix = "bench") {
  const now = new Date();

  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  return `${prefix}-${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}

function createWikiSchemaPayload(options = {}) {
  const includeText = Boolean(options.includeText);

  return {
    benchmark_run_id: {
      type: "string",
      label: "Benchmark Run ID",
      required: true,
    },
    category_id: {
      type: "integer",
      label: "Category ID",
    },
    category_title: {
      type: "string",
      label: "Category Title",
    },
    page_id: {
      type: "integer",
      label: "Page ID",
      required: true,
    },
    page_title: {
      type: "string",
      label: "Page Title",
      required: true,
    },
    revision_id: {
      type: "integer",
      label: "Revision ID",
      required: true,
    },
    revision_timestamp: {
      type: "string",
      label: "Revision Timestamp",
    },
    revision_user: {
      type: "string",
      label: "Revision User",
    },
    revision_comment: {
      type: "string",
      label: "Revision Comment",
    },
    revision_size: {
      type: "integer",
      label: "Revision Size",
    },
    revision_sha1: {
      type: "string",
      label: "Revision SHA1",
    },
    text_hash: {
      type: "string",
      label: "Text Hash",
    },
    text_size: {
      type: "integer",
      label: "Text Size",
    },
    source_index: {
      type: "integer",
      label: "Source Index",
    },

    ...(includeText
      ? {
          revision_text: {
            type: "string",
            label: "Revision Text",
          },
        }
      : {}),
  };
}

function createWikiSchemaPayloadV2(options = {}) {
  const includeText = Boolean(options.includeText);

  return {
    ...createWikiSchemaPayload({ includeText }),

    // เพิ่ม field ใหม่สำหรับทดสอบ schema evolution
    wiki_source: {
      type: "string",
      label: "Wiki Source",
      default: "wikipedia",
    },
    normalized_at: {
      type: "string",
      label: "Normalized At",
      default: new Date().toISOString(),
    },
  };
}

function wikiRowToPayload(row, options = {}) {
  const runId = options.runId || options.benchmarkRunId || "benchmark";

  const payload = {
    benchmark_run_id: runId,
    category_id: row.category_id,
    category_title: row.category_title || "",
    page_id: row.page_id,
    page_title: row.page_title || "",
    revision_id: row.revision_id,
    revision_timestamp: row.revision_timestamp || "",
    revision_user: row.revision_user || "",
    revision_comment: row.revision_comment || "",
    revision_size: row.revision_size,
    revision_sha1: row.revision_sha1 || "",
    text_hash: row.text_hash || "",
    text_size: row.text_size,
    source_index: row.source_index,
  };

  if (row.revision_text !== undefined) {
    payload.revision_text = row.revision_text || "";
  }

  return payload;
}

async function createBenchmarkBusiness(businessService, options = {}) {
  const runId = options.runId || createBenchmarkRunId();

  return businessService.createBusiness({
    name: options.name || `Benchmark ${runId}`,
    icon: options.icon || "benchmark",
  });
}

async function createBenchmarkWikiSchema(schemaService, business, options = {}) {
  const runId = options.runId || createBenchmarkRunId();

  return schemaService.createSchema({
    business_id: business.id,
    name: options.name || `Wikipedia Benchmark Schema ${runId}`,
    payload: createWikiSchemaPayload({
      includeText: options.includeText,
    }),
  });
}

async function updateBenchmarkWikiSchemaToV2(schemaService, schema, options = {}) {
  return schemaService.updateSchema(schema._rootid, {
    name: options.name || `${schema.name || "Wikipedia Benchmark Schema"} v2`,
    payload: createWikiSchemaPayloadV2({
      includeText: options.includeText,
    }),
  });
}

function getFirstAndRestRevisions(pageRows) {
  const list = Array.isArray(pageRows) ? pageRows : [];

  return {
    first: list[0] || null,
    rest: list.slice(1),
  };
}

async function importWikiPageAsRootId(dataService, schema, pageRows, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const runId = options.runId || "benchmark";

  const { first, rest } = getFirstAndRestRevisions(pageRows);

  if (!first) {
    return null;
  }

  const created = await dataService.createData(
    {
      data_schema_id: schema.id,
      payload: wikiRowToPayload(first, { runId }),
      share_mode: "self",
    },
    { auth }
  );

  let latest = created;
  let updateCount = 0;

  for (const revision of rest) {
    latest = await dataService.updateData(
      created._rootid,
      {
        payload: wikiRowToPayload(revision, { runId }),
      },
      { auth }
    );

    updateCount += 1;
  }

  return {
    page_id: first.page_id,
    page_title: first.page_title,
    rootid: created._rootid,
    first_id: created.id,
    latest_id: latest.id,
    revisions: pageRows.length,
    updates: updateCount,
  };
}

async function importWikiPagesAsRootId(dataService, schema, pageMap, options = {}) {
  const imported = [];
  let pageIndex = 0;
  let revisionCount = 0;
  let updateCount = 0;

  for (const pageRows of pageMap.values()) {
    const result = await importWikiPageAsRootId(
      dataService,
      schema,
      pageRows,
      options
    );

    if (result) {
      imported.push(result);
      revisionCount += result.revisions;
      updateCount += result.updates;
    }

    pageIndex += 1;

    if (options.progressEvery && pageIndex % options.progressEvery === 0) {
      console.log(
        `[rootid-bench] imported pages=${pageIndex}, revisions=${revisionCount}`
      );
    }
  }

  return {
    imported,
    pages: imported.length,
    revisions: revisionCount,
    updates: updateCount,
  };
}

async function sampleLatestReads(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const limit = Number(options.limit || process.env.BENCH_SAMPLE_READS || 200);
  const sample = importedPages.slice(0, Math.min(limit, importedPages.length));

  const rows = [];

  for (const item of sample) {
    const row = await dataService.getLatestDataByRootId(item.rootid, {
      auth,
    });

    rows.push(row);
  }

  return {
    rows,
    reads: rows.length,
  };
}

async function sampleHistoryReads(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const limit = Number(options.limit || process.env.BENCH_SAMPLE_READS || 200);
  const sample = importedPages.slice(0, Math.min(limit, importedPages.length));

  const histories = [];

  for (const item of sample) {
    const history = await dataService.getDataHistory(item.rootid, {
      auth,
      limit: options.historyLimit || 1000,
      offset: 0,
      order: "ASC",
    });

    histories.push({
      rootid: item.rootid,
      page_id: item.page_id,
      versions: history.length,
    });
  }

  return {
    histories,
    reads: histories.length,
    avg_versions:
      histories.length > 0
        ? histories.reduce((sum, item) => sum + item.versions, 0) /
          histories.length
        : 0,
  };
}

async function sampleCompareWithLatestSchema(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const limit = Number(options.limit || process.env.BENCH_SAMPLE_READS || 100);
  const sample = importedPages.slice(0, Math.min(limit, importedPages.length));

  const compared = [];

  for (const item of sample) {
    const latest = await dataService.getLatestDataByRootId(item.rootid, {
      auth,
    });

    const result = await dataService.compareDataWithLatestSchema(latest.id, {
      auth,
    });

    compared.push({
      rootid: item.rootid,
      page_id: item.page_id,
      isLatest: result.isLatest,
      fieldCount: Object.keys(result.compare || {}).length,
      removedCount: Object.keys(result.removed || {}).length,
    });
  }

  return {
    compared,
    rows: compared.length,
  };
}

async function sampleMigrateToLatestSchema(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const limit = Number(options.limit || process.env.BENCH_SAMPLE_READS || 100);
  const sample = importedPages.slice(0, Math.min(limit, importedPages.length));

  let migrated = 0;
  let alreadyLatest = 0;
  let requiresReview = 0;

  const details = [];

  for (const item of sample) {
    try {
      const result = await dataService.migrateDataToLatestSchema(item.rootid, {
        auth,
        force: options.force === undefined ? true : Boolean(options.force),
      });

      if (result.migrated) {
        migrated += 1;
      } else {
        alreadyLatest += 1;
      }

      details.push({
        rootid: item.rootid,
        page_id: item.page_id,
        migrated: Boolean(result.migrated),
        reason: result.reason || null,
      });
    } catch (err) {
      if (err.code === "DATA_MIGRATION_REQUIRES_REVIEW") {
        requiresReview += 1;

        details.push({
          rootid: item.rootid,
          page_id: item.page_id,
          migrated: false,
          error_code: err.code,
        });

        continue;
      }

      throw err;
    }
  }

  return {
    rows: sample.length,
    migrated,
    alreadyLatest,
    requiresReview,
    details,
  };
}

async function getRootIdDbStats(db, runId = null) {
  const values = [];
  const payloadFilter = runId
    ? "WHERE payload->>'benchmark_run_id' = $1"
    : "";

  if (runId) {
    values.push(runId);
  }

  const dataStats = await db.query(
    `
      SELECT
        COUNT(*)::INTEGER AS data_physical_rows,
        COUNT(*) FILTER (WHERE _flag = '')::INTEGER AS data_current_rows,
        COUNT(*) FILTER (WHERE _flag = 'u')::INTEGER AS data_history_rows,
        COUNT(*) FILTER (WHERE _flag = 'd')::INTEGER AS data_deleted_rows,
        COUNT(DISTINCT _rootid)::INTEGER AS data_rootids
      FROM data
      ${payloadFilter}
    `,
    values
  );

  const relationStats = await db.query(
    `
      SELECT
        pg_total_relation_size('data') AS data_table_bytes,
        pg_total_relation_size('data_schema') AS data_schema_table_bytes,
        pg_total_relation_size('business') AS business_table_bytes,
        pg_database_size(current_database()) AS database_bytes
    `
  );

  return {
    ...(dataStats.rows[0] || {}),
    ...(relationStats.rows[0] || {}),
  };
}

async function clearBenchmarkRunData(db, runId) {
  if (!runId) {
    const err = new Error("runId is required");
    err.code = "BENCHMARK_RUN_ID_REQUIRED";
    throw err;
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const rootidsResult = await client.query(
      `
        SELECT DISTINCT _rootid
        FROM data
        WHERE payload->>'benchmark_run_id' = $1
      `,
      [runId]
    );

    const rootids = rootidsResult.rows.map((row) => Number(row._rootid));

    if (rootids.length > 0) {
      await client.query(
        `
          DELETE FROM data_share_user
          WHERE data_rootid = ANY($1::bigint[])
        `,
        [rootids]
      );

      await client.query(
        `
          DELETE FROM data
          WHERE _rootid = ANY($1::bigint[])
        `,
        [rootids]
      );
    }

    await client.query(
      `
        DELETE FROM tableview
        WHERE payload->>'benchmark_run_id' = $1
      `,
      [runId]
    );

    await client.query(
      `
        DELETE FROM form
        WHERE payload->>'benchmark_run_id' = $1
      `,
      [runId]
    );

    await client.query(
      `
        DELETE FROM data_schema
        WHERE name LIKE $1
      `,
      [`%${runId}%`]
    );

    await client.query(
      `
        DELETE FROM business
        WHERE name LIKE $1
      `,
      [`%${runId}%`]
    );

    await client.query("COMMIT");

    return {
      runId,
      dataRootidsDeleted: rootids.length,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function ensureDir(dirPath) {
  const outputPath = path.resolve(process.cwd(), dirPath);
  await fs.mkdir(outputPath, { recursive: true });
  return outputPath;
}

function makeResultFileName(prefix, ext, runId = null) {
  const safeRunId = String(runId || createBenchmarkRunId())
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);

  return `${prefix}-${safeRunId}.${ext.replace(/^\./, "")}`;
}

function metricWithThroughput(metric, count, countField = "rows") {
  const n = Number(count);

  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(Number(metric.ms))) {
    return {
      ...metric,
      [countField]: count,
    };
  }

  return {
    ...metric,
    [countField]: n,
    [`${countField}_per_sec`]: round(n / (Number(metric.ms) / 1000)),
    [`avg_ms_per_${countField.slice(0, -1) || countField}`]: round(
      Number(metric.ms) / n
    ),
  };
}

module.exports = {
  createBenchmarkAuth,
  createBenchmarkRunId,

  createWikiSchemaPayload,
  createWikiSchemaPayloadV2,
  wikiRowToPayload,

  createBenchmarkBusiness,
  createBenchmarkWikiSchema,
  updateBenchmarkWikiSchemaToV2,

  getFirstAndRestRevisions,
  importWikiPageAsRootId,
  importWikiPagesAsRootId,

  sampleLatestReads,
  sampleHistoryReads,
  sampleCompareWithLatestSchema,
  sampleMigrateToLatestSchema,

  getRootIdDbStats,
  clearBenchmarkRunData,

  ensureDir,
  makeResultFileName,
  metricWithThroughput,
};