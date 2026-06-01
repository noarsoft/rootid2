// benchmark/utils/mongo-bench-helper.js
// -----------------------------------------------------------------------------
// MongoDB Benchmark helper
//
// แนวคิด:
// - 1 wiki revision = 1 MongoDB document
// - page_id ใช้รวม logical object
// - latest query ใช้ sort revision_timestamp DESC, revision_id DESC
// - history query ใช้ find({ page_id }) sort ASC
// -----------------------------------------------------------------------------

const MODEL_NAME = "mongo";
const DEFAULT_COLLECTION = "bench_wiki_revision";

function safeDiv(a, b) {
  if (!b) return 0;
  return a / b;
}

function toDate(value) {
  if (!value) return null;

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return d;
}

function normalizeBigInt(value) {
  if (value === undefined || value === null || value === "") return null;

  const n = Number(value);

  if (!Number.isFinite(n)) return null;

  return Math.trunc(n);
}

function getRevisionText(row) {
  return row.revision_text || row.text || row["*"] || null;
}

function makeMongoWikiDocument(runId, row, options = {}) {
  const doc = {
    run_id: runId,

    category_id: row.category_id ?? null,
    category_title: row.category_title ?? null,

    page_id: normalizeBigInt(row.page_id),
    page_title: row.page_title ?? null,

    revision_id: normalizeBigInt(row.revision_id),
    revision_timestamp: toDate(row.revision_timestamp),
    revision_user: row.revision_user ?? null,
    revision_comment: row.revision_comment ?? null,
    revision_size: normalizeBigInt(row.revision_size),
    revision_sha1: row.revision_sha1 ?? null,

    text_hash: row.text_hash ?? null,
    text_size: normalizeBigInt(row.text_size),
    source_index: normalizeBigInt(row.source_index),

    created_at: new Date(),
  };

  if (options.includeText) {
    doc.revision_text = getRevisionText(row);
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

function getMongoWikiCollection(db, collectionName = DEFAULT_COLLECTION) {
  return db.collection(collectionName);
}

async function ensureMongoWikiIndexes(collection) {
  await collection.createIndex(
    {
      run_id: 1,
      page_id: 1,
      revision_id: 1,
    },
    {
      unique: true,
      name: "uniq_run_page_revision",
    }
  );

  await collection.createIndex(
    {
      run_id: 1,
    },
    {
      name: "idx_run_id",
    }
  );

  await collection.createIndex(
    {
      run_id: 1,
      page_id: 1,
      revision_timestamp: -1,
      revision_id: -1,
    },
    {
      name: "idx_latest",
    }
  );

  await collection.createIndex(
    {
      run_id: 1,
      page_id: 1,
      revision_timestamp: 1,
      revision_id: 1,
    },
    {
      name: "idx_history",
    }
  );
}

async function clearMongoRunData(collection, runId) {
  const result = await collection.deleteMany({
    run_id: runId,
  });

  return {
    model: MODEL_NAME,
    run_id: runId,
    deleted: result.deletedCount,
  };
}

async function importWikiPagesMongo(collection, runId, pageMap, options = {}) {
  const progressEvery = options.progressEvery || 100;
  const batchSize = options.batchSize || 1000;
  const pages = flattenPageMap(pageMap);

  const imported = [];
  let revisionCount = 0;
  let batch = [];

  async function flushBatch() {
    if (batch.length === 0) return;

    try {
      await collection.bulkWrite(batch, {
        ordered: false,
      });
    } catch (err) {
      // duplicate key จาก upsert race หรือ rerun บางกรณีไม่ควรทำให้ benchmark ล้มทันที
      if (err.code !== 11000) {
        throw err;
      }
    }

    batch = [];
  }

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];

    for (const row of page.rows) {
      const doc = makeMongoWikiDocument(runId, row, {
        includeText: Boolean(options.includeText),
      });

      batch.push({
        updateOne: {
          filter: {
            run_id: runId,
            page_id: doc.page_id,
            revision_id: doc.revision_id,
          },
          update: {
            $setOnInsert: doc,
          },
          upsert: true,
        },
      });

      revisionCount += 1;

      if (batch.length >= batchSize) {
        await flushBatch();
      }
    }

    imported.push({
      page_id: page.page_id,
      page_title: page.rows[0].page_title || "",
      revisions: page.rows.length,
    });

    if (progressEvery > 0 && (i + 1) % progressEvery === 0) {
      console.log(`[${MODEL_NAME}] imported pages: ${i + 1}/${pages.length}`);
    }
  }

  await flushBatch();

  return {
    model: MODEL_NAME,
    pages: pages.length,
    revisions: revisionCount,
    imported,
  };
}

async function sampleLatestReadsMongo(collection, runId, importedPages, options = {}) {
  const samples = pickSamples(importedPages, options.limit || 200);
  const latest = [];

  for (const page of samples) {
    const row = await collection
      .find({
        run_id: runId,
        page_id: page.page_id,
      })
      .sort({
        revision_timestamp: -1,
        revision_id: -1,
      })
      .limit(1)
      .next();

    if (row) {
      latest.push(row);
    }
  }

  return {
    model: MODEL_NAME,
    reads: samples.length,
    latest,
  };
}

async function sampleHistoryReadsMongo(collection, runId, importedPages, options = {}) {
  const samples = pickSamples(importedPages, options.limit || 200);
  const historyLimit = options.historyLimit || 1000;
  const histories = [];
  let totalVersions = 0;

  for (const page of samples) {
    const rows = await collection
      .find({
        run_id: runId,
        page_id: page.page_id,
      })
      .sort({
        revision_timestamp: 1,
        revision_id: 1,
      })
      .limit(historyLimit)
      .toArray();

    totalVersions += rows.length;

    histories.push({
      page_id: page.page_id,
      versions: rows.length,
      sample: rows.slice(0, 3),
    });
  }

  return {
    model: MODEL_NAME,
    reads: samples.length,
    avg_versions: safeDiv(totalVersions, samples.length),
    histories,
  };
}

async function getMongoStats(db, collection, runId) {
  const pages = await collection.distinct("page_id", {
    run_id: runId,
  });

  const revisions = await collection.countDocuments({
    run_id: runId,
  });

  let collectionStats = {};

  try {
    collectionStats = await db.command({
      collStats: collection.collectionName,
    });
  } catch (err) {
    collectionStats = {
      error: err.message,
    };
  }

  return {
    model: MODEL_NAME,
    pages: pages.length,
    revisions,
    collection: collection.collectionName,

    size_bytes: collectionStats.size || 0,
    storage_size_bytes: collectionStats.storageSize || 0,
    total_index_size_bytes: collectionStats.totalIndexSize || 0,
  };
}

module.exports = {
  MODEL_NAME,
  DEFAULT_COLLECTION,

  safeDiv,
  flattenPageMap,
  pickSamples,
  makeMongoWikiDocument,

  getMongoWikiCollection,
  ensureMongoWikiIndexes,
  clearMongoRunData,
  importWikiPagesMongo,
  sampleLatestReadsMongo,
  sampleHistoryReadsMongo,
  getMongoStats,
};