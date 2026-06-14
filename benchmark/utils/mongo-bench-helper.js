// benchmark/utils/mongo-bench-helper.js
// -----------------------------------------------------------------------------
// MongoDB Document Baseline helper
//
// แนวคิด:
// - 1 wiki revision = 1 MongoDB document
// - run_id + page_id + revision_id ใช้แยกแต่ละ benchmark run
// - ไม่มี _rootid / _prev_id / _flag
//
// Mutation helper:
// - update = append synthetic revision document
// - delete = physical delete latest revision document
// -----------------------------------------------------------------------------

const MODEL_NAME = "mongo";
const DEFAULT_COLLECTION = "bench_wiki_revision";

function safeDiv(a, b) {
  if (!b) return 0;
  return a / b;
}

function normalizeBigInt(value) {
  if (value === undefined || value === null || value === "") return null;

  const n = Number(value);

  if (!Number.isFinite(n)) return null;

  return Math.trunc(n);
}

function toDate(value) {
  if (!value) return null;

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return null;

  return d;
}

function getRevisionText(row) {
  return row.revision_text || row.text || row["*"] || null;
}

function getMongoWikiCollection(db, collectionName = DEFAULT_COLLECTION) {
  return db.collection(collectionName || DEFAULT_COLLECTION);
}

function makeMongoRevisionDocument(runId, row, options = {}) {
  const revisionText = options.includeText ? getRevisionText(row) : null;

  const doc = {
    run_id: runId,

    category_id: row.category_id ?? null,
    category_title: row.category_title ?? null,

    page_id: normalizeBigInt(row.page_id),
    page_title: row.page_title ?? null,

    parent_id: normalizeBigInt(row.parent_id),

    revision_id: normalizeBigInt(row.revision_id),
    revision_timestamp: toDate(row.revision_timestamp),
    revision_timestamp_raw: row.revision_timestamp ?? null,
    revision_user: row.revision_user ?? null,
    revision_comment: row.revision_comment ?? null,
    revision_size: normalizeBigInt(row.revision_size),
    revision_sha1: row.revision_sha1 ?? null,

    content_format: row.content_format ?? null,
    content_model: row.content_model ?? null,

    text_hash: row.text_hash ?? null,
    text_size: normalizeBigInt(row.text_size),

    source_file: row.source_file ?? null,
    source_index: normalizeBigInt(row.source_index),

    created_at: new Date(),
  };

  if (options.includeText) {
    doc.revision_text = revisionText;
  }

  return doc;
}

function flattenPageMap(pageMap) {
  const pages = [];

  for (const [pageId, rows] of pageMap.entries()) {
    const sorted = [...rows].sort((a, b) => {
      const at = new Date(a.revision_timestamp || 0).getTime();
      const bt = new Date(b.revision_timestamp || 0).getTime();

      if (at !== bt) return at - bt;

      return Number(a.revision_id || 0) - Number(b.revision_id || 0);
    });

    if (sorted.length === 0) continue;

    pages.push({
      page_id: Number(pageId),
      rows: sorted,
    });
  }

  return pages;
}

function pickSamples(importedPages, limit) {
  return importedPages.slice(0, Math.min(limit, importedPages.length));
}

async function ensureMongoWikiIndexes(collection) {
  await collection.createIndex(
    { run_id: 1, page_id: 1, revision_id: 1 },
    { unique: true, name: "uniq_run_page_revision" }
  );

  await collection.createIndex(
    { run_id: 1 },
    { name: "idx_run_id" }
  );

  await collection.createIndex(
    { run_id: 1, page_id: 1 },
    { name: "idx_run_page" }
  );

  await collection.createIndex(
    { run_id: 1, page_id: 1, revision_timestamp: -1, revision_id: -1 },
    { name: "idx_latest" }
  );

  await collection.createIndex(
    { run_id: 1, page_id: 1, revision_timestamp: 1, revision_id: 1 },
    { name: "idx_history" }
  );
}

async function clearMongoRunData(collection, runId) {
  const result = await collection.deleteMany({ run_id: runId });

  return {
    runId,
    deletedCount: result.deletedCount || 0,
  };
}

async function insertOneMongoRevision(collection, doc) {
  try {
    await collection.insertOne(doc);
    return true;
  } catch (err) {
    if (err && err.code === 11000) {
      return false;
    }

    throw err;
  }
}

async function importWikiPagesMongo(collection, runId, pageMap, options = {}) {
  const imported = [];
  const pages = flattenPageMap(pageMap);

  let pageCount = 0;
  let revisionCount = 0;

  const batchSize = Number(options.batchSize || process.env.BENCH_MONGO_BATCH_SIZE || 1000);

  let batch = [];

  async function flushBatch() {
    if (batch.length === 0) return;

    try {
      const result = await collection.insertMany(batch, {
        ordered: false,
      });

      revisionCount += result.insertedCount || batch.length;
    } catch (err) {
      if (err && err.code === 11000) {
        revisionCount += err.result?.insertedCount || 0;
      } else if (err && err.writeErrors) {
        revisionCount += err.result?.insertedCount || 0;
      } else {
        throw err;
      }
    }

    batch = [];
  }

  for (const page of pages) {
    const firstRow = page.rows[0];

    if (!firstRow) continue;

    let revisionsForPage = 0;

    for (const row of page.rows) {
      batch.push(
        makeMongoRevisionDocument(runId, row, {
          includeText: options.includeText,
        })
      );

      revisionsForPage += 1;

      if (batch.length >= batchSize) {
        await flushBatch();
      }
    }

    pageCount += 1;

    imported.push({
      page_id: normalizeBigInt(firstRow.page_id),
      page_title: firstRow.page_title || null,
      revisions: revisionsForPage,
    });

    if (options.progressEvery && pageCount % options.progressEvery === 0) {
      console.log(`[mongo] queued/imported pages=${pageCount}`);
    }
  }

  await flushBatch();

  return {
    imported,
    pages: pageCount,
    revisions: revisionCount,
  };
}

async function sampleLatestReadsMongo(collection, runId, importedPages, options = {}) {
  const limit = Number(options.limit || process.env.BENCH_SAMPLE_READS || 200);
  const sample = pickSamples(importedPages, limit);

  const latest = [];

  for (const item of sample) {
    const row = await collection
      .find({
        run_id: runId,
        page_id: item.page_id,
      })
      .sort({
        revision_timestamp: -1,
        revision_id: -1,
      })
      .limit(1)
      .next();

    latest.push({
      page_id: item.page_id,
      page_title: item.page_title,
      revision_id: row?.revision_id || null,
      revision_timestamp: row?.revision_timestamp || null,
    });
  }

  return {
    latest,
    reads: latest.length,
  };
}

async function sampleHistoryReadsMongo(collection, runId, importedPages, options = {}) {
  const limit = Number(options.limit || process.env.BENCH_SAMPLE_READS || 200);
  const historyLimit = Number(options.historyLimit || process.env.BENCH_HISTORY_LIMIT || 1000);
  const sample = pickSamples(importedPages, limit);

  const histories = [];

  for (const item of sample) {
    const rows = await collection
      .find(
        {
          run_id: runId,
          page_id: item.page_id,
        },
        {
          projection: {
            _id: 1,
            page_id: 1,
            revision_id: 1,
            revision_timestamp: 1,
          },
        }
      )
      .sort({
        revision_timestamp: 1,
        revision_id: 1,
      })
      .limit(historyLimit)
      .toArray();

    histories.push({
      page_id: item.page_id,
      page_title: item.page_title,
      versions: rows.length,
    });
  }

  return {
    histories,
    reads: histories.length,
    avg_versions:
      histories.length > 0
        ? histories.reduce((sum, item) => sum + item.versions, 0) / histories.length
        : 0,
  };
}

function makeSyntheticMongoRevisionId(index = 0) {
  return Date.now() * 1000 + Number(index || 0);
}

async function getLatestMongoRevision(collection, runId, pageId) {
  return collection
    .find({
      run_id: runId,
      page_id: pageId,
    })
    .sort({
      revision_timestamp: -1,
      revision_id: -1,
    })
    .limit(1)
    .next();
}

async function sampleUpdatesMongo(collection, runId, importedPages, options = {}) {
  const limit = Number(options.limit || process.env.BENCH_UPDATE_SAMPLE || 100);
  const sample = pickSamples(importedPages, limit);

  const updated = [];

  for (let i = 0; i < sample.length; i += 1) {
    const item = sample[i];
    const latest = await getLatestMongoRevision(collection, runId, item.page_id);

    if (!latest) continue;

    const revisionId = makeSyntheticMongoRevisionId(i);
    const now = new Date();

    const doc = {
      ...latest,

      _id: undefined,

      revision_id: revisionId,
      revision_timestamp: now,
      revision_timestamp_raw: now.toISOString(),
      revision_user: "mongo_benchmark_update",
      revision_comment: `Synthetic MongoDB benchmark update ${i + 1}`,
      revision_sha1: `synthetic-mongo-update-${runId}-${i + 1}`,
      text_hash: `synthetic-mongo-update-${runId}-${i + 1}`,
      text_size: Number(latest.text_size || 0) + 1,

      benchmark_update: true,
      benchmark_update_index: i + 1,
      benchmark_update_at: now,
      created_at: now,
    };

    delete doc._id;

    await insertOneMongoRevision(collection, doc);

    updated.push({
      page_id: item.page_id,
      page_title: item.page_title,
      before_revision_id: latest.revision_id,
      after_revision_id: revisionId,
    });
  }

  return {
    updated,
    updates: updated.length,
  };
}

async function sampleLatestReadsAfterUpdateMongo(collection, runId, importedPages, options = {}) {
  return sampleLatestReadsMongo(collection, runId, importedPages, options);
}

async function sampleHistoryReadsAfterUpdateMongo(collection, runId, importedPages, options = {}) {
  return sampleHistoryReadsMongo(collection, runId, importedPages, options);
}

async function sampleDeletesMongo(collection, runId, importedPages, options = {}) {
  const limit = Number(options.limit || process.env.BENCH_DELETE_SAMPLE || 50);
  const sample = pickSamples(importedPages, limit);

  const deleted = [];

  for (const item of sample) {
    const latest = await getLatestMongoRevision(collection, runId, item.page_id);

    if (!latest) continue;

    await collection.deleteOne({
      _id: latest._id,
    });

    deleted.push({
      page_id: item.page_id,
      page_title: item.page_title,
      deleted_revision_id: latest.revision_id,
    });
  }

  return {
    deleted,
    deletes: deleted.length,
  };
}

async function sampleLatestReadsAfterDeleteMongo(collection, runId, importedPages, options = {}) {
  return sampleLatestReadsMongo(collection, runId, importedPages, options);
}

async function verifyDeletesMongo(collection, runId, deletedItems) {
  const verified = [];

  let ok = 0;
  let failed = 0;

  for (const item of deletedItems || []) {
    const count = await collection.countDocuments({
      run_id: runId,
      page_id: item.page_id,
      revision_id: item.deleted_revision_id,
    });

    const isDeleted = count === 0;

    if (isDeleted) ok += 1;
    else failed += 1;

    verified.push({
      page_id: item.page_id,
      page_title: item.page_title,
      deleted_revision_id: item.deleted_revision_id,
      ok: isDeleted,
    });
  }

  return {
    verified,
    checks: verified.length,
    ok,
    failed,
  };
}

async function getMongoStats(db, collection, runId) {
  const revisions = await collection.countDocuments({
    run_id: runId,
  });

  const pageIds = await collection.distinct("page_id", {
    run_id: runId,
  });

  let collectionStats = {};

  try {
    collectionStats = await db.command({
      collStats: collection.collectionName,
    });
  } catch (_err) {
    collectionStats = {};
  }

  return {
    model: MODEL_NAME,
    pages: pageIds.length,
    revisions,
    documents: revisions,
    collection_name: collection.collectionName,
    collection_bytes:
      Number(collectionStats.size || 0) ||
      Number(collectionStats.storageSize || 0) ||
      null,
    storage_size: Number(collectionStats.storageSize || 0) || null,
    total_index_size: Number(collectionStats.totalIndexSize || 0) || null,
  };
}

module.exports = {
  MODEL_NAME,
  DEFAULT_COLLECTION,

  safeDiv,
  flattenPageMap,
  pickSamples,

  getMongoWikiCollection,
  ensureMongoWikiIndexes,
  clearMongoRunData,
  importWikiPagesMongo,
  sampleLatestReadsMongo,
  sampleHistoryReadsMongo,

  sampleUpdatesMongo,
  sampleLatestReadsAfterUpdateMongo,
  sampleHistoryReadsAfterUpdateMongo,
  sampleDeletesMongo,
  sampleLatestReadsAfterDeleteMongo,
  verifyDeletesMongo,

  getMongoStats,
};