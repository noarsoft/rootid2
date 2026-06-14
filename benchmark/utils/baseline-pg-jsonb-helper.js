// benchmark/utils/baseline-pg-jsonb-helper.js
// -----------------------------------------------------------------------------
// PostgreSQL JSONB Baseline helper
//
// แนวคิด:
// - 1 wiki revision = 1 row
// - page_id, revision_id, revision_timestamp เป็น column สำหรับ query
// - field wiki ทั้งหมดเก็บใน payload JSONB
// - ไม่มี _rootid / _prev_id / _flag
//
// Mutation helper:
// - มีให้ใช้ได้ แต่ benchmark หลักจะปิดไว้ด้วย BENCH_PG_JSONB_MUTATION=false
// - update = append synthetic revision row
// - delete = physical delete latest revision row
// -----------------------------------------------------------------------------

const MODEL_NAME = "pg_jsonb";

function safeDiv(a, b) {
  if (!b) return 0;
  return a / b;
}

function toPgTimestamp(value) {
  if (!value) return null;

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return d.toISOString();
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

function makeWikiJsonbPayload(row, options = {}) {
  const payload = {
    category_id: row.category_id ?? null,
    category_title: row.category_title ?? null,

    page_id: row.page_id ?? null,
    page_title: row.page_title ?? null,

    parent_id: row.parent_id ?? null,

    revision_id: row.revision_id ?? null,
    revision_timestamp: row.revision_timestamp ?? null,
    revision_user: row.revision_user ?? null,
    revision_comment: row.revision_comment ?? null,
    revision_size: row.revision_size ?? null,
    revision_sha1: row.revision_sha1 ?? null,

    content_format: row.content_format ?? null,
    content_model: row.content_model ?? null,

    text_hash: row.text_hash ?? null,
    text_size: row.text_size ?? null,

    source_file: row.source_file ?? null,
    source_index: row.source_index ?? null,
  };

  if (options.includeText) {
    payload.revision_text = getRevisionText(row);
  }

  return payload;
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

async function ensurePgJsonbTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS bench_wiki_jsonb (
      id BIGSERIAL PRIMARY KEY,

      run_id TEXT NOT NULL DEFAULT 'default',

      page_id BIGINT NOT NULL,
      revision_id BIGINT NOT NULL,
      revision_timestamp TIMESTAMPTZ NULL,

      payload JSONB NOT NULL DEFAULT '{}'::jsonb,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_jsonb
      ADD COLUMN IF NOT EXISTS run_id TEXT NOT NULL DEFAULT 'default'
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_jsonb
      DROP CONSTRAINT IF EXISTS bench_wiki_jsonb_unique
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_jsonb
      ADD CONSTRAINT bench_wiki_jsonb_unique
      UNIQUE (run_id, page_id, revision_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bench_wiki_jsonb_run_id
      ON bench_wiki_jsonb (run_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bench_wiki_jsonb_page_id
      ON bench_wiki_jsonb (page_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bench_wiki_jsonb_latest
      ON bench_wiki_jsonb (run_id, page_id, revision_timestamp DESC, revision_id DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bench_wiki_jsonb_history
      ON bench_wiki_jsonb (run_id, page_id, revision_timestamp ASC, revision_id ASC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bench_wiki_jsonb_payload_gin
      ON bench_wiki_jsonb USING GIN (payload)
  `);
}

async function clearPgJsonbRunData(db, runId) {
  await db.query(
    `
      DELETE FROM bench_wiki_jsonb
      WHERE run_id = $1
    `,
    [runId]
  );

  return { runId };
}

async function insertOneJsonbRevision(db, row) {
  await db.query(
    `
      INSERT INTO bench_wiki_jsonb (
        run_id,
        page_id,
        revision_id,
        revision_timestamp,
        payload
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (run_id, page_id, revision_id)
      DO NOTHING
    `,
    [
      row.run_id,
      row.page_id,
      row.revision_id,
      row.revision_timestamp,
      JSON.stringify(row.payload || {}),
    ]
  );
}

async function importWikiPagesPgJsonb(db, runId, pageMap, options = {}) {
  const imported = [];
  const pages = flattenPageMap(pageMap);

  let pageCount = 0;
  let revisionCount = 0;

  for (const page of pages) {
    const firstRow = page.rows[0];

    if (!firstRow) continue;

    let revisionsForPage = 0;

    for (const row of page.rows) {
      const revisionRow = {
        run_id: runId,
        page_id: normalizeBigInt(row.page_id),
        revision_id: normalizeBigInt(row.revision_id),
        revision_timestamp: toPgTimestamp(row.revision_timestamp),
        payload: makeWikiJsonbPayload(row, {
          includeText: options.includeText,
        }),
      };

      await insertOneJsonbRevision(db, revisionRow);

      revisionsForPage += 1;
      revisionCount += 1;
    }

    pageCount += 1;

    imported.push({
      page_id: normalizeBigInt(firstRow.page_id),
      page_title: firstRow.page_title || null,
      revisions: revisionsForPage,
    });

    if (options.progressEvery && pageCount % options.progressEvery === 0) {
      console.log(`[pg-jsonb] imported pages=${pageCount}, revisions=${revisionCount}`);
    }
  }

  return {
    imported,
    pages: pageCount,
    revisions: revisionCount,
  };
}

async function sampleLatestReadsPgJsonb(db, runId, importedPages, options = {}) {
  const limit = Number(options.limit || process.env.BENCH_SAMPLE_READS || 200);
  const sample = pickSamples(importedPages, limit);

  const latest = [];

  for (const item of sample) {
    const result = await db.query(
      `
        SELECT *
        FROM bench_wiki_jsonb
        WHERE run_id = $1
          AND page_id = $2
        ORDER BY revision_timestamp DESC NULLS LAST, revision_id DESC
        LIMIT 1
      `,
      [runId, item.page_id]
    );

    const row = result.rows[0] || null;

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

async function sampleHistoryReadsPgJsonb(db, runId, importedPages, options = {}) {
  const limit = Number(options.limit || process.env.BENCH_SAMPLE_READS || 200);
  const historyLimit = Number(options.historyLimit || process.env.BENCH_HISTORY_LIMIT || 1000);
  const sample = pickSamples(importedPages, limit);

  const histories = [];

  for (const item of sample) {
    const result = await db.query(
      `
        SELECT id, page_id, revision_id, revision_timestamp
        FROM bench_wiki_jsonb
        WHERE run_id = $1
          AND page_id = $2
        ORDER BY revision_timestamp ASC NULLS FIRST, revision_id ASC
        LIMIT $3
      `,
      [runId, item.page_id, historyLimit]
    );

    histories.push({
      page_id: item.page_id,
      page_title: item.page_title,
      versions: result.rows.length,
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

function makeSyntheticPgJsonbRevisionId(index = 0) {
  return Date.now() * 1000 + Number(index || 0);
}

async function getLatestPgJsonbRevision(db, runId, pageId) {
  const result = await db.query(
    `
      SELECT *
      FROM bench_wiki_jsonb
      WHERE run_id = $1
        AND page_id = $2
      ORDER BY revision_timestamp DESC NULLS LAST, revision_id DESC
      LIMIT 1
    `,
    [runId, pageId]
  );

  return result.rows[0] || null;
}

async function sampleUpdatesPgJsonb(db, runId, importedPages, options = {}) {
  const limit = Number(options.limit || process.env.BENCH_UPDATE_SAMPLE || 100);
  const sample = pickSamples(importedPages, limit);

  const updated = [];

  for (let i = 0; i < sample.length; i += 1) {
    const item = sample[i];
    const latest = await getLatestPgJsonbRevision(db, runId, item.page_id);

    if (!latest) continue;

    const revisionId = makeSyntheticPgJsonbRevisionId(i);
    const now = new Date().toISOString();
    const payload = {
      ...(latest.payload || {}),

      revision_id: revisionId,
      revision_timestamp: now,
      revision_user: "pg_jsonb_benchmark_update",
      revision_comment: `Synthetic PG JSONB benchmark update ${i + 1}`,
      revision_sha1: `synthetic-pg-jsonb-update-${runId}-${i + 1}`,
      text_hash: `synthetic-pg-jsonb-update-${runId}-${i + 1}`,
      text_size: Number(latest.payload?.text_size || 0) + 1,

      benchmark_update: true,
      benchmark_update_index: i + 1,
      benchmark_update_at: now,
    };

    await insertOneJsonbRevision(db, {
      run_id: runId,
      page_id: latest.page_id,
      revision_id: revisionId,
      revision_timestamp: now,
      payload,
    });

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

async function sampleLatestReadsAfterUpdatePgJsonb(db, runId, importedPages, options = {}) {
  return sampleLatestReadsPgJsonb(db, runId, importedPages, options);
}

async function sampleHistoryReadsAfterUpdatePgJsonb(db, runId, importedPages, options = {}) {
  return sampleHistoryReadsPgJsonb(db, runId, importedPages, options);
}

async function sampleDeletesPgJsonb(db, runId, importedPages, options = {}) {
  const limit = Number(options.limit || process.env.BENCH_DELETE_SAMPLE || 50);
  const sample = pickSamples(importedPages, limit);

  const deleted = [];

  for (const item of sample) {
    const latest = await getLatestPgJsonbRevision(db, runId, item.page_id);

    if (!latest) continue;

    await db.query(
      `
        DELETE FROM bench_wiki_jsonb
        WHERE id = $1
      `,
      [latest.id]
    );

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

async function sampleLatestReadsAfterDeletePgJsonb(db, runId, importedPages, options = {}) {
  return sampleLatestReadsPgJsonb(db, runId, importedPages, options);
}

async function verifyDeletesPgJsonb(db, runId, deletedItems) {
  const verified = [];

  let ok = 0;
  let failed = 0;

  for (const item of deletedItems || []) {
    const result = await db.query(
      `
        SELECT COUNT(*)::INTEGER AS count
        FROM bench_wiki_jsonb
        WHERE run_id = $1
          AND page_id = $2
          AND revision_id = $3
      `,
      [runId, item.page_id, item.deleted_revision_id]
    );

    const count = result.rows[0]?.count || 0;
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

async function getPgJsonbStats(db, runId) {
  const counts = await db.query(
    `
      SELECT
        COUNT(*)::INTEGER AS revisions,
        COUNT(DISTINCT page_id)::INTEGER AS pages
      FROM bench_wiki_jsonb
      WHERE run_id = $1
    `,
    [runId]
  );

  const sizes = await db.query(`
    SELECT
      pg_total_relation_size('bench_wiki_jsonb')::BIGINT AS jsonb_table_bytes,
      pg_database_size(current_database())::BIGINT AS database_bytes
  `);

  return {
    model: MODEL_NAME,
    pages: Number(counts.rows[0].pages || 0),
    revisions: Number(counts.rows[0].revisions || 0),
    jsonb_table_bytes: Number(sizes.rows[0].jsonb_table_bytes || 0),
    database_bytes: Number(sizes.rows[0].database_bytes || 0),
  };
}

module.exports = {
  MODEL_NAME,

  safeDiv,
  flattenPageMap,
  pickSamples,

  ensurePgJsonbTables,
  clearPgJsonbRunData,
  importWikiPagesPgJsonb,
  sampleLatestReadsPgJsonb,
  sampleHistoryReadsPgJsonb,

  sampleUpdatesPgJsonb,
  sampleLatestReadsAfterUpdatePgJsonb,
  sampleHistoryReadsAfterUpdatePgJsonb,
  sampleDeletesPgJsonb,
  sampleLatestReadsAfterDeletePgJsonb,
  verifyDeletesPgJsonb,

  getPgJsonbStats,
};