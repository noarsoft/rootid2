// benchmark/utils/rootid-bench-helper.js
// -----------------------------------------------------------------------------
// RootID benchmark helper
//
// ใช้ร่วมกับ:
// - benchmark/wiki-rootid-benchmark.js
// - benchmark/wiki-pg-relational-benchmark.js
// - benchmark/wiki-pg-jsonb-benchmark.js
// - benchmark/wiki-mongo-benchmark.js
// - export/report/dashboard scripts
// -----------------------------------------------------------------------------

const fs = require("node:fs/promises");
const path = require("node:path");

function round(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digits));
}

function safeDiv(a, b) {
  if (!b) return 0;
  return a / b;
}

function createBenchmarkRunId(prefix = "benchmark") {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  const datePart = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("");

  const timePart = [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");

  const randomPart = Math.random().toString(16).slice(2, 8);

  return `${prefix}-${datePart}-${timePart}-${randomPart}`;
}

function createBenchmarkAuth() {
  const userId = 1;

  return {
    id: userId,
    user_id: userId,
    userId,

    username: "benchmark",
    email: "benchmark@rootid.local",
    role: "admin",
    is_admin: true,

    user: {
      id: userId,
      user_id: userId,
      userId,
      username: "benchmark",
      email: "benchmark@rootid.local",
      role: "admin",
      is_admin: true,
    },

    source: "benchmark",
  };
}

function createServiceContext(auth, extra = {}) {
  const base = auth || createBenchmarkAuth();

  const userId =
    Number(base.user?.id) ||
    Number(base.user?.user_id) ||
    Number(base.user?.userId) ||
    Number(base.id) ||
    Number(base.user_id) ||
    Number(base.userId) ||
    1;

  const user = {
    ...(base.user || {}),
    id: userId,
    user_id: userId,
    userId,
    username: base.user?.username || base.username || "benchmark",
    email: base.user?.email || base.email || "benchmark@rootid.local",
    role: base.user?.role || base.role || "admin",
    is_admin:
      base.user?.is_admin === true ||
      base.is_admin === true ||
      base.user?.role === "admin" ||
      base.role === "admin",
  };

  return {
    ...base,

    id: userId,
    user_id: userId,
    userId,

    sub: userId,
    uid: userId,
    account_id: userId,

    username: user.username,
    email: user.email,
    role: user.role,
    is_admin: user.is_admin,

    user,
    currentUser: user,
    reqUser: user,

    source: base.source || "benchmark",

    ...extra,
  };
}

function makeServiceOptions(auth, extra = {}) {
  const context = createServiceContext(auth);

  return {
    auth: context,

    // เผื่อบาง method อ่านจาก top-level
    id: context.id,
    user_id: context.user_id,
    userId: context.userId,
    user: context.user,
    role: context.role,
    is_admin: context.is_admin,

    ...extra,
  };
}

async function ensureDir(dirPath) {
  const fullPath = path.resolve(process.cwd(), dirPath);
  await fs.mkdir(fullPath, { recursive: true });
  return fullPath;
}

function makeResultFileName(prefix, ext, runId) {
  return `${prefix}-${runId}.${ext}`;
}

function getRevisionText(row) {
  return row.revision_text || row.text || row["*"] || null;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") return null;

  const n = Number(value);

  if (!Number.isFinite(n)) return null;

  return n;
}

function normalizeInteger(value) {
  const n = normalizeNumber(value);
  if (n === null) return null;
  return Math.trunc(n);
}

function createWikiSchemaPayload(options = {}) {
  const includeText = Boolean(options.includeText);

  const payload = {
    benchmark_run_id: {
      type: "string",
      label: "Benchmark Run ID",
      required: false,
      default: options.runId || "",
      control: "textbox",
    },

    category_id: {
      type: "string",
      label: "Category ID",
      required: false,
      control: "textbox",
    },

    category_title: {
      type: "string",
      label: "Category Title",
      required: false,
      control: "textbox",
    },

    page_id: {
      type: "number",
      label: "Page ID",
      required: true,
      control: "numberbox",
    },

    page_title: {
      type: "string",
      label: "Page Title",
      required: true,
      control: "textbox",
    },

    revision_id: {
      type: "number",
      label: "Revision ID",
      required: true,
      control: "numberbox",
    },

    revision_timestamp: {
      type: "string",
      label: "Revision Timestamp",
      required: false,
      control: "textbox",
    },

    revision_user: {
      type: "string",
      label: "Revision User",
      required: false,
      control: "textbox",
    },

    revision_comment: {
      type: "string",
      label: "Revision Comment",
      required: false,
      control: "textarea",
    },

    revision_size: {
      type: "number",
      label: "Revision Size",
      required: false,
      control: "numberbox",
    },

    revision_sha1: {
      type: "string",
      label: "Revision SHA1",
      required: false,
      control: "textbox",
    },

    text_hash: {
      type: "string",
      label: "Text Hash",
      required: false,
      control: "textbox",
    },

    text_size: {
      type: "number",
      label: "Text Size",
      required: false,
      control: "numberbox",
    },

    source_index: {
      type: "number",
      label: "Source Index",
      required: false,
      control: "numberbox",
    },
  };

  if (includeText) {
    payload.revision_text = {
      type: "string",
      label: "Revision Text",
      required: false,
      control: "textarea",
    };
  }

  return payload;
}

function createWikiSchemaPayloadV2(options = {}) {
  return {
    ...createWikiSchemaPayload(options),

    wiki_source: {
      type: "string",
      label: "Wiki Source",
      required: false,
      default: "wikipedia",
      control: "textbox",
    },

    normalized_at: {
      type: "string",
      label: "Normalized At",
      required: false,
      default: new Date().toISOString(),
      control: "textbox",
    },
  };
}

function wikiRowToPayload(row, options = {}) {
  const includeText = Boolean(options.includeText);

  const payload = {
    benchmark_run_id: options.runId || null,

    category_id: row.category_id ?? null,
    category_title: row.category_title ?? null,

    page_id: normalizeInteger(row.page_id),
    page_title: row.page_title ?? null,

    revision_id: normalizeInteger(row.revision_id),
    revision_timestamp: row.revision_timestamp ?? null,
    revision_user: row.revision_user ?? null,
    revision_comment: row.revision_comment ?? null,
    revision_size: normalizeInteger(row.revision_size),
    revision_sha1: row.revision_sha1 ?? null,

    text_hash: row.text_hash ?? null,
    text_size: normalizeInteger(row.text_size),

    source_index: normalizeInteger(row.source_index),
  };

  if (includeText) {
    payload.revision_text = getRevisionText(row);
  }

  return payload;
}

function sortWikiRows(rows) {
  return [...rows].sort((a, b) => {
    const at = new Date(a.revision_timestamp || 0).getTime();
    const bt = new Date(b.revision_timestamp || 0).getTime();

    if (at !== bt) return at - bt;

    return Number(a.revision_id || 0) - Number(b.revision_id || 0);
  });
}

async function callFirst(target, methodNames, args) {
  for (const name of methodNames) {
    if (target && typeof target[name] === "function") {
      return target[name](...args);
    }
  }

  throw new Error(`No supported method found. Tried: ${methodNames.join(", ")}`);
}

async function createBenchmarkBusiness(businessService, options = {}) {
  const runId = options.runId || createBenchmarkRunId("wiki-business");
  const auth = options.auth || createBenchmarkAuth();

  const input = {
    name: options.name || `Wikipedia Benchmark ${runId}`,
    description:
      options.description ||
      "Benchmark business for Wikipedia revision dataset",
    payload: {
      benchmark: true,
      benchmark_run_id: runId,
      source: "wikipedia",
    },
  };

  return callFirst(
    businessService,
    ["createBusiness", "create", "createOne"],
    [input, makeServiceOptions(auth)]
  );
}

async function createBenchmarkWikiSchema(schemaService, business, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const runId = options.runId || createBenchmarkRunId("wiki-schema");

  const input = {
    business_id: business.id,
    business_rootid: business._rootid || business.rootid || business.id,
    name: options.name || `Wikipedia Revision Schema ${runId}`,
    description:
      options.description ||
      "Schema v1 for Wikipedia revision benchmark",
    payload: createWikiSchemaPayload({
      includeText: options.includeText,
      runId,
    }),
  };

  return callFirst(
    schemaService,
    ["createSchema", "createDataSchema", "create", "createOne"],
    [input, makeServiceOptions(auth)]
  );
}

async function updateBenchmarkWikiSchemaToV2(schemaService, schema, options = {}) {
  const auth = options.auth || createBenchmarkAuth();

  const input = {
    name: options.name || `${schema.name || "Wikipedia Revision Schema"} v2`,
    description:
      options.description ||
      "Schema v2 for Wikipedia benchmark: add wiki_source and normalized_at",
    payload: createWikiSchemaPayloadV2({
      includeText: options.includeText,
      runId: options.runId,
    }),
  };

  return callFirst(
    schemaService,
    ["updateSchema", "updateDataSchema", "update", "updateByRootId"],
    [
      schema._rootid || schema.rootid || schema.id,
      input,
      makeServiceOptions(auth),
    ]
  );
}

async function createDataRoot(dataService, schema, payload, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const shareMode = options.shareMode || options.share_mode || "all";

  const input = {
    business_id: schema.business_id,
    business_rootid: schema.business_rootid || schema.business_id,

    data_schema_id: schema.id,
    schema_id: schema.id,

    data_schema_rootid: schema._rootid || schema.rootid || schema.id,
    schema_rootid: schema._rootid || schema.rootid || schema.id,

    payload,
    allowExtraFields: true,

    // benchmark/demo data ให้เปิดเห็นทั้งหมด
    share_mode: shareMode,
    shareMode,
  };

  return callFirst(
    dataService,
    ["createData", "create", "createOne"],
    [input, makeServiceOptions(auth)]
  );
}

async function updateDataRoot(dataService, rootid, payload, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const shareMode = options.shareMode || options.share_mode || "all";

  return callFirst(
    dataService,
    ["updateData", "updateByRootId", "update", "createNextVersion"],
    [
      rootid,
      {
        payload,
        allowExtraFields: true,

        // ให้ version ใหม่ยังเป็น all ด้วย
        share_mode: shareMode,
        shareMode,
      },
      makeServiceOptions(auth),
    ]
  );
}

async function getLatestDataByRootId(dataService, rootid, options = {}) {
  const auth = options.auth || createBenchmarkAuth();

  return callFirst(
    dataService,
    [
      "getLatestDataByRootId",
      "getLatestByRootId",
      "getCurrentByRootId",
      "getCurrentDataByRootId",
    ],
    [
      rootid,
      makeServiceOptions(auth, {
        includeDeleted: Boolean(options.includeDeleted),
      }),
    ]
  );
}

async function getDataHistoryByRootId(dataService, rootid, options = {}) {
  const auth = options.auth || createBenchmarkAuth();

  return callFirst(
    dataService,
    [
      "getDataHistory",
      "getHistory",
      "getHistoryByRootId",
      "getDataHistoryByRootId",
    ],
    [
      rootid,
      makeServiceOptions(auth, {
        includeDeleted: options.includeDeleted !== false,
        limit: options.historyLimit || options.limit || 1000,
        offset: options.offset || 0,
        order: options.order || "ASC",
      }),
    ]
  );
}

async function deleteDataByRootId(dataService, rootid, options = {}) {
  const auth = options.auth || createBenchmarkAuth();

  return callFirst(
    dataService,
    ["deleteData", "softDeleteData", "deleteByRootId", "softDeleteByRootId"],
    [rootid, makeServiceOptions(auth)]
  );
}

async function importWikiPagesAsRootId(dataService, schema, pageMap, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const runId = options.runId || "benchmark";
  const progressEvery = Number(options.progressEvery || 100);

  // benchmark/demo data ให้เปิด share all
  const shareMode = options.shareMode || options.share_mode || "all";

  const imported = [];
  let pages = 0;
  let revisions = 0;
  let updates = 0;

  const entries = Array.from(pageMap.entries());

  for (let i = 0; i < entries.length; i += 1) {
    const [pageId, pageRows] = entries[i];
    const sortedRows = sortWikiRows(pageRows);

    if (sortedRows.length === 0) {
      continue;
    }

    const firstRow = sortedRows[0];

    const firstPayload = wikiRowToPayload(firstRow, {
      runId,
      includeText: options.includeText,
    });

    const firstData = await createDataRoot(dataService, schema, firstPayload, {
      auth,
      shareMode,
    });

    const rootid = firstData._rootid || firstData.rootid || firstData.id;

    let latest = firstData;
    let pageUpdates = 0;

    for (let r = 1; r < sortedRows.length; r += 1) {
      const row = sortedRows[r];

      const payload = wikiRowToPayload(row, {
        runId,
        includeText: options.includeText,
      });

      latest = await updateDataRoot(dataService, rootid, payload, {
        auth,
        shareMode,
      });

      pageUpdates += 1;
      updates += 1;
    }

    pages += 1;
    revisions += sortedRows.length;

    imported.push({
      page_id: normalizeInteger(firstRow.page_id) || normalizeInteger(pageId),
      page_title: firstRow.page_title || null,
      rootid,
      first_id: firstData.id,
      latest_id: latest.id,
      revisions: sortedRows.length,
      updates: pageUpdates,
      updated_in_benchmark: false,
      deleted_in_benchmark: false,
    });

    if (progressEvery > 0 && pages % progressEvery === 0) {
      console.log(
        `[rootid] imported pages=${pages}/${entries.length}, revisions=${revisions}, updates=${updates}`
      );
    }
  }

  return {
    imported,
    pages,
    revisions,
    updates,
  };
}

function pickSamples(importedPages, limit) {
  return importedPages.slice(0, Math.min(limit, importedPages.length));
}

async function sampleLatestReads(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const limit = Number(options.limit || process.env.BENCH_SAMPLE_READS || 200);
  const sample = pickSamples(importedPages, limit);

  const rows = [];

  for (const item of sample) {
    const latest = await getLatestDataByRootId(dataService, item.rootid, {
      auth,
      includeDeleted: Boolean(options.includeDeleted),
    });

    rows.push({
      rootid: item.rootid,
      page_id: item.page_id,
      page_title: item.page_title,
      id: latest?.id || null,
      flag: latest?._flag ?? null,
      revision_id: latest?.payload?.revision_id ?? null,
    });
  }

  return {
    rows,
    reads: rows.length,
  };
}

async function sampleHistoryReads(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const limit = Number(options.limit || process.env.BENCH_SAMPLE_READS || 200);
  const sample = pickSamples(importedPages, limit);

  const histories = [];

  for (const item of sample) {
    const history = await getDataHistoryByRootId(dataService, item.rootid, {
      auth,
      includeDeleted: options.includeDeleted !== false,
      historyLimit: options.historyLimit || 1000,
      order: options.order || "ASC",
    });

    histories.push({
      rootid: item.rootid,
      page_id: item.page_id,
      page_title: item.page_title,
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

async function sampleVersionUpdates(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const runId = options.runId || "benchmark";
  const limit = Number(options.limit || process.env.BENCH_UPDATE_SAMPLE || 100);
  const sample = pickSamples(importedPages, limit);

  const updated = [];

  for (let i = 0; i < sample.length; i += 1) {
    const item = sample[i];

    const latestBefore = await getLatestDataByRootId(dataService, item.rootid, {
      auth,
      includeDeleted: false,
    });

    const payload = makeSyntheticRootIdUpdatePayload(latestBefore.payload || {}, {
      runId,
      index: i,
    });

    const latestAfter = await updateDataRoot(dataService, item.rootid, payload, {
      auth,
      shareMode: options.shareMode || options.share_mode || "all",
    });

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

async function sampleLatestReadsAfterUpdate(dataService, importedPages, options = {}) {
  return sampleLatestReads(dataService, importedPages, options);
}

async function sampleHistoryReadsAfterUpdate(dataService, importedPages, options = {}) {
  return sampleHistoryReads(dataService, importedPages, options);
}

async function sampleDeletes(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const limit = Number(options.limit || process.env.BENCH_DELETE_SAMPLE || 50);
  const sample = pickSamples(importedPages, limit);

  const deleted = [];

  for (const item of sample) {
    const latestBefore = await getLatestDataByRootId(dataService, item.rootid, {
      auth,
      includeDeleted: false,
    });

    const deleteMarker = await deleteDataByRootId(dataService, item.rootid, {
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

async function sampleLatestReadsAfterDelete(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const limit = Number(options.limit || process.env.BENCH_DELETE_SAMPLE || 50);
  const sample = pickSamples(importedPages, limit);

  const rows = [];

  let deletedMarkers = 0;
  let notFoundAsCurrent = 0;

  for (const item of sample) {
    const latestWithDeleted = await getLatestDataByRootId(dataService, item.rootid, {
      auth,
      includeDeleted: true,
    });

    if (latestWithDeleted?._flag === "d") {
      deletedMarkers += 1;
    }

    try {
      await getLatestDataByRootId(dataService, item.rootid, {
        auth,
        includeDeleted: false,
      });
    } catch (err) {
      if (err.code === "DATA_NOT_FOUND" || err.code === "NOT_FOUND") {
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

async function verifyDeletes(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const limit = Number(options.limit || process.env.BENCH_DELETE_SAMPLE || 50);
  const sample = pickSamples(importedPages, limit);

  const verified = [];

  let ok = 0;
  let failed = 0;

  for (const item of sample) {
    const latest = await getLatestDataByRootId(dataService, item.rootid, {
      auth,
      includeDeleted: true,
    });

    const history = await getDataHistoryByRootId(dataService, item.rootid, {
      auth,
      includeDeleted: true,
      historyLimit: options.historyLimit || 1000,
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

async function sampleCompareWithLatestSchema(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();
  const limit = Number(options.limit || process.env.BENCH_COMPARE_SAMPLE || 100);
  const sample = pickSamples(importedPages, limit);

  const compared = [];

  for (const item of sample) {
    const latest = await getLatestDataByRootId(dataService, item.rootid, {
      auth,
      includeDeleted: false,
    });

    let result = null;

    try {
      result = await callFirst(
        dataService,
        [
          "compareWithLatestSchema",
          "compareDataWithLatestSchema",
          "compareDataSchema",
          "compareSchema",
        ],
        [latest.id, makeServiceOptions(auth)]
      );
    } catch (_err) {
      result = {
        supported: false,
        message:
          "compareWithLatestSchema method not found or failed; benchmark fallback result",
      };
    }

    compared.push({
      rootid: item.rootid,
      page_id: item.page_id,
      data_id: latest.id,
      result,
    });
  }

  return {
    compared,
    rows: compared.length,
  };
}

async function sampleMigrateToLatestSchema(dataService, importedPages, options = {}) {
  const auth = options.auth || createBenchmarkAuth();

  const limit = Number(options.limit || process.env.BENCH_MIGRATE_SAMPLE || 100);
  const sample = pickSamples(importedPages, limit);

  const details = [];

  let migrated = 0;
  let alreadyLatest = 0;
  let requiresReview = 0;

  for (const item of sample) {
    const latest = await getLatestDataByRootId(dataService, item.rootid, {
      auth,
      includeDeleted: false,
    });

    let result = null;

    try {
      result = await callFirst(
        dataService,
        [
          "migrateToLatestSchema",
          "migrateDataToLatestSchema",
          "migrateSchema",
        ],
        [
          latest.id,
          makeServiceOptions(auth, {
            force: Boolean(options.force),
          }),
        ]
      );
    } catch (_err) {
      result = {
        supported: false,
        migrated: false,
        alreadyLatest: false,
        requiresReview: false,
        message:
          "migrateToLatestSchema method not found or failed; benchmark fallback result",
      };
    }

    if (result?.migrated) migrated += 1;
    else if (result?.alreadyLatest) alreadyLatest += 1;
    else if (result?.requiresReview) requiresReview += 1;

    details.push({
      rootid: item.rootid,
      page_id: item.page_id,
      data_id: latest.id,
      result,
    });
  }

  return {
    details,
    rows: details.length,
    migrated,
    alreadyLatest,
    requiresReview,
  };
}

async function clearBenchmarkRunData(pool, runId) {
  await pool
    .query(
      `
        DELETE FROM data_share_user
        WHERE data_rootid IN (
          SELECT _rootid
          FROM data
          WHERE payload->>'benchmark_run_id' = $1
        )
      `,
      [runId]
    )
    .catch(() => null);

  await pool
    .query(
      `
        DELETE FROM data
        WHERE payload->>'benchmark_run_id' = $1
      `,
      [runId]
    )
    .catch(() => null);

  await pool
    .query(
      `
        DELETE FROM tableview
        WHERE payload->>'benchmark_run_id' = $1
      `,
      [runId]
    )
    .catch(() => null);

  await pool
    .query(
      `
        DELETE FROM form
        WHERE payload->>'benchmark_run_id' = $1
      `,
      [runId]
    )
    .catch(() => null);

  await pool
    .query(
      `
        DELETE FROM data_schema
        WHERE payload->>'benchmark_run_id' = $1
           OR name LIKE $2
      `,
      [runId, `%${runId}%`]
    )
    .catch(() => null);

  await pool
    .query(
      `
        DELETE FROM business
        WHERE payload->>'benchmark_run_id' = $1
           OR name LIKE $2
      `,
      [runId, `%${runId}%`]
    )
    .catch(() => null);

  return { runId };
}

async function getRootIdDbStats(pool, runId) {
  const counts = await pool.query(
    `
      SELECT
        COUNT(*)::INTEGER AS data_physical_rows,
        COUNT(*) FILTER (WHERE _flag = '')::INTEGER AS data_current_rows,
        COUNT(*) FILTER (WHERE _flag = 'u')::INTEGER AS data_history_rows,
        COUNT(*) FILTER (WHERE _flag = 'd')::INTEGER AS data_deleted_rows,
        COUNT(DISTINCT _rootid)::INTEGER AS data_rootids
      FROM data
      WHERE payload->>'benchmark_run_id' = $1
    `,
    [runId]
  );

  const schemaCounts = await pool
    .query(
      `
        SELECT
          COUNT(*)::INTEGER AS schema_physical_rows,
          COUNT(*) FILTER (WHERE _flag = '')::INTEGER AS schema_current_rows,
          COUNT(*) FILTER (WHERE _flag = 'u')::INTEGER AS schema_history_rows,
          COUNT(DISTINCT _rootid)::INTEGER AS schema_rootids
        FROM data_schema
        WHERE payload->>'benchmark_run_id' = $1
           OR name LIKE $2
      `,
      [runId, `%${runId}%`]
    )
    .catch(() => ({ rows: [{}] }));

  const sizes = await pool.query(`
    SELECT
      pg_total_relation_size('data')::BIGINT AS data_table_bytes,
      pg_total_relation_size('data_schema')::BIGINT AS data_schema_table_bytes,
      pg_database_size(current_database())::BIGINT AS database_bytes
  `);

  return {
    model: "rootid",

    data_physical_rows: Number(counts.rows[0]?.data_physical_rows || 0),
    data_current_rows: Number(counts.rows[0]?.data_current_rows || 0),
    data_history_rows: Number(counts.rows[0]?.data_history_rows || 0),
    data_deleted_rows: Number(counts.rows[0]?.data_deleted_rows || 0),
    data_rootids: Number(counts.rows[0]?.data_rootids || 0),

    schema_physical_rows: Number(schemaCounts.rows[0]?.schema_physical_rows || 0),
    schema_current_rows: Number(schemaCounts.rows[0]?.schema_current_rows || 0),
    schema_history_rows: Number(schemaCounts.rows[0]?.schema_history_rows || 0),
    schema_rootids: Number(schemaCounts.rows[0]?.schema_rootids || 0),

    data_table_bytes: Number(sizes.rows[0]?.data_table_bytes || 0),
    data_schema_table_bytes: Number(sizes.rows[0]?.data_schema_table_bytes || 0),
    database_bytes: Number(sizes.rows[0]?.database_bytes || 0),
  };
}

module.exports = {
  round,
  safeDiv,

  createBenchmarkRunId,
  createBenchmarkAuth,
  createServiceContext,
  makeServiceOptions,

  ensureDir,
  makeResultFileName,

  createWikiSchemaPayload,
  createWikiSchemaPayloadV2,
  wikiRowToPayload,

  createBenchmarkBusiness,
  createBenchmarkWikiSchema,
  updateBenchmarkWikiSchemaToV2,

  importWikiPagesAsRootId,

  sampleLatestReads,
  sampleHistoryReads,

  sampleVersionUpdates,
  sampleLatestReadsAfterUpdate,
  sampleHistoryReadsAfterUpdate,

  sampleDeletes,
  sampleLatestReadsAfterDelete,
  verifyDeletes,

  sampleCompareWithLatestSchema,
  sampleMigrateToLatestSchema,

  getRootIdDbStats,
  clearBenchmarkRunData,
};