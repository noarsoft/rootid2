// benchmark/utils/baseline-pg-relational-helper.js
// -----------------------------------------------------------------------------
// PostgreSQL Relational Baseline helper
//
// แนวคิด:
// - 1 wiki page = 1 row ใน bench_wiki_page
// - 1 wiki revision = 1 row ใน bench_wiki_revision
// - ไม่มี _rootid / _prev_id / _flag
//
// Mutation helper:
// - มีให้ใช้ได้ แต่ benchmark หลักจะปิดไว้ด้วย BENCH_PG_RELATIONAL_MUTATION=false
// - เพื่อให้ PG Relational คงเป็น reference dataset สำหรับ correctness
// -----------------------------------------------------------------------------

const MODEL_NAME = "pg_relational";

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

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  return String(value);
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

function makePageRow(runId, firstRow) {
  return {
    run_id: runId,
    category_id: normalizeText(firstRow.category_id),
    category_title: normalizeText(firstRow.category_title),
    page_id: normalizeBigInt(firstRow.page_id),
    page_title: normalizeText(firstRow.page_title),
  };
}

function makeRevisionRow(runId, row, options = {}) {
  const revisionText = options.includeText ? getRevisionText(row) : null;

  return {
    run_id: runId,

    category_id: normalizeText(row.category_id),
    category_title: normalizeText(row.category_title),

    page_id: normalizeBigInt(row.page_id),
    page_title: normalizeText(row.page_title),

    revision_id: normalizeBigInt(row.revision_id),
    revision_timestamp: toPgTimestamp(row.revision_timestamp),
    revision_user: normalizeText(row.revision_user),
    revision_comment: normalizeText(row.revision_comment),
    revision_size: normalizeBigInt(row.revision_size),
    revision_sha1: normalizeText(row.revision_sha1),

    text_hash: normalizeText(row.text_hash),
    text_size: normalizeBigInt(row.text_size),
    source_index: normalizeBigInt(row.source_index),
    revision_text: revisionText,
  };
}

async function ensurePgRelationalTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS bench_wiki_page (
      id BIGSERIAL PRIMARY KEY,

      run_id TEXT NOT NULL DEFAULT 'default',

      page_id BIGINT NOT NULL,
      page_title TEXT NULL,

      category_id TEXT NULL,
      category_title TEXT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_page
      ADD COLUMN IF NOT EXISTS run_id TEXT NOT NULL DEFAULT 'default'
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_page
      ADD COLUMN IF NOT EXISTS page_title TEXT NULL
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_page
      ADD COLUMN IF NOT EXISTS category_id TEXT NULL
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_page
      ADD COLUMN IF NOT EXISTS category_title TEXT NULL
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_page
      DROP CONSTRAINT IF EXISTS bench_wiki_page_page_id_key
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_page
      DROP CONSTRAINT IF EXISTS bench_wiki_page_unique
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_page
      ADD CONSTRAINT bench_wiki_page_unique
      UNIQUE (run_id, page_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bench_wiki_page_run_id
      ON bench_wiki_page (run_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bench_wiki_page_page_id
      ON bench_wiki_page (page_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bench_wiki_page_run_page
      ON bench_wiki_page (run_id, page_id)
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS bench_wiki_revision (
      id BIGSERIAL PRIMARY KEY,

      run_id TEXT NOT NULL DEFAULT 'default',

      category_id TEXT NULL,
      category_title TEXT NULL,

      page_id BIGINT NOT NULL,
      page_title TEXT NULL,

      revision_id BIGINT NOT NULL,
      revision_timestamp TIMESTAMPTZ NULL,
      revision_user TEXT NULL,
      revision_comment TEXT NULL,
      revision_size BIGINT NULL,
      revision_sha1 TEXT NULL,

      text_hash TEXT NULL,
      text_size BIGINT NULL,
      source_index BIGINT NULL,
      revision_text TEXT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_revision
      ADD COLUMN IF NOT EXISTS run_id TEXT NOT NULL DEFAULT 'default'
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_revision
      ADD COLUMN IF NOT EXISTS category_id TEXT NULL
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_revision
      ADD COLUMN IF NOT EXISTS category_title TEXT NULL
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_revision
      ADD COLUMN IF NOT EXISTS page_title TEXT NULL
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_revision
      ADD COLUMN IF NOT EXISTS revision_text TEXT NULL
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_revision
      DROP CONSTRAINT IF EXISTS bench_wiki_revision_unique
  `);

  await db.query(`
    ALTER TABLE IF EXISTS bench_wiki_revision
      ADD CONSTRAINT bench_wiki_revision_unique
      UNIQUE (run_id, page_id, revision_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bench_wiki_revision_run_id
      ON bench_wiki_revision (run_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bench_wiki_revision_page_id
      ON bench_wiki_revision (page_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bench_wiki_revision_latest
      ON bench_wiki_revision (run_id, page_id, revision_timestamp DESC, revision_id DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bench_wiki_revision_history
      ON bench_wiki_revision (run_id, page_id, revision_timestamp ASC, revision_id ASC)
  `);
}

async function clearPgRelationalRunData(db, runId) {
  await db.query(
    `
      DELETE FROM bench_wiki_revision
      WHERE run_id = $1
    `,
    [runId]
  );

  await db.query(
    `
      DELETE FROM bench_wiki_page
      WHERE run_id = $1
    `,
    [runId]
  );

  return { runId };
}

async function insertOnePage(db, pageRow) {
  await db.query(
    `
      INSERT INTO bench_wiki_page (
        run_id,
        category_id,
        category_title,
        page_id,
        page_title
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (run_id, page_id)
      DO UPDATE SET
        category_id = EXCLUDED.category_id,
        category_title = EXCLUDED.category_title,
        page_title = EXCLUDED.page_title
    `,
    [
      pageRow.run_id,
      pageRow.category_id,
      pageRow.category_title,
      pageRow.page_id,
      pageRow.page_title,
    ]
  );
}

async function insertOneRevision(db, revisionRow) {
  await db.query(
    `
      INSERT INTO bench_wiki_revision (
        run_id,
        category_id,
        category_title,
        page_id,
        page_title,
        revision_id,
        revision_timestamp,
        revision_user,
        revision_comment,
        revision_size,
        revision_sha1,
        text_hash,
        text_size,
        source_index,
        revision_text
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15
      )
      ON CONFLICT (run_id, page_id, revision_id)
      DO NOTHING
    `,
    [
      revisionRow.run_id,
      revisionRow.category_id,
      revisionRow.category_title,
      revisionRow.page_id,
      revisionRow.page_title,
      revisionRow.revision_id,
      revisionRow.revision_timestamp,
      revisionRow.revision_user,
      revisionRow.revision_comment,
      revisionRow.revision_size,
      revisionRow.revision_sha1,
      revisionRow.text_hash,
      revisionRow.text_size,
      revisionRow.source_index,
      revisionRow.revision_text,
    ]
  );
}

async function importWikiPagesPgRelational(db, runId, pageMap, options = {}) {
  const imported = [];
  const pages = flattenPageMap(pageMap);

  let pageCount = 0;
  let revisionCount = 0;

  for (const page of pages) {
    const firstRow = page.rows[0];

    if (!firstRow) continue;

    const pageRow = makePageRow(runId, firstRow);
    await insertOnePage(db, pageRow);

    let revisionsForPage = 0;

    for (const row of page.rows) {
      const revisionRow = makeRevisionRow(runId, row, {
        includeText: options.includeText,
      });

      await insertOneRevision(db, revisionRow);

      revisionsForPage += 1;
      revisionCount += 1;
    }

    pageCount += 1;

    imported.push({
      page_id: pageRow.page_id,
      page_title: pageRow.page_title,
      revisions: revisionsForPage,
    });

    if (options.progressEvery && pageCount % options.progressEvery === 0) {
      console.log(
        `[pg-relational] imported pages=${pageCount}, revisions=${revisionCount}`
      );
    }
  }

  return {
    imported,
    pages: pageCount,
    revisions: revisionCount,
  };
}

async function sampleLatestReadsPgRelational(db, runId, importedPages, options = {}) {
  const limit = Number(options.limit || process.env.BENCH_SAMPLE_READS || 200);
  const sample = pickSamples(importedPages, limit);

  const latest = [];

  for (const item of sample) {
    const result = await db.query(
      `
        SELECT *
        FROM bench_wiki_revision
        WHERE run_id = $1
          AND page_id = $2
        ORDER BY revision_timestamp DESC NULLS LAST, revision_id DESC
        LIMIT 1
      `,
      [runId, item.page_id]
    );

    latest.push({
      page_id: item.page_id,
      page_title: item.page_title,
      revision_id: result.rows[0]?.revision_id || null,
      revision_timestamp: result.rows[0]?.revision_timestamp || null,
    });
  }

  return {
    latest,
    reads: latest.length,
  };
}

async function sampleHistoryReadsPgRelational(db, runId, importedPages, options = {}) {
  const limit = Number(options.limit || process.env.BENCH_SAMPLE_READS || 200);
  const historyLimit = Number(options.historyLimit || process.env.BENCH_HISTORY_LIMIT || 1000);
  const sample = pickSamples(importedPages, limit);

  const histories = [];

  for (const item of sample) {
    const result = await db.query(
      `
        SELECT *
        FROM bench_wiki_revision
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

function makeSyntheticPgRevisionId(index = 0) {
  return Date.now() * 1000 + Number(index || 0);
}

async function getLatestPgRelationalRevision(db, runId, pageId) {
  const result = await db.query(
    `
      SELECT *
      FROM bench_wiki_revision
      WHERE run_id = $1
        AND page_id = $2
      ORDER BY revision_timestamp DESC NULLS LAST, revision_id DESC
      LIMIT 1
    `,
    [runId, pageId]
  );

  return result.rows[0] || null;
}

async function sampleUpdatesPgRelational(db, runId, importedPages, options = {}) {
  const limit = Number(options.limit || process.env.BENCH_UPDATE_SAMPLE || 100);
  const sample = pickSamples(importedPages, limit);

  const updated = [];

  for (let i = 0; i < sample.length; i += 1) {
    const item = sample[i];
    const latest = await getLatestPgRelationalRevision(db, runId, item.page_id);

    if (!latest) continue;

    const revisionId = makeSyntheticPgRevisionId(i);
    const revisionTimestamp = new Date().toISOString();

    await insertOneRevision(db, {
      run_id: runId,

      category_id: latest.category_id,
      category_title: latest.category_title,

      page_id: latest.page_id,
      page_title: latest.page_title,

      revision_id: revisionId,
      revision_timestamp: revisionTimestamp,
      revision_user: "pg_relational_benchmark_update",
      revision_comment: `Synthetic PG Relational benchmark update ${i + 1}`,
      revision_size: latest.revision_size,
      revision_sha1: `synthetic-pg-rel-update-${runId}-${i + 1}`,

      text_hash: `synthetic-pg-rel-update-${runId}-${i + 1}`,
      text_size: Number(latest.text_size || 0) + 1,
      source_index: null,
      revision_text: latest.revision_text,
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

async function sampleLatestReadsAfterUpdatePgRelational(db, runId, importedPages, options = {}) {
  return sampleLatestReadsPgRelational(db, runId, importedPages, options);
}

async function sampleHistoryReadsAfterUpdatePgRelational(db, runId, importedPages, options = {}) {
  return sampleHistoryReadsPgRelational(db, runId, importedPages, options);
}

async function sampleDeletesPgRelational(db, runId, importedPages, options = {}) {
  const limit = Number(options.limit || process.env.BENCH_DELETE_SAMPLE || 50);
  const sample = pickSamples(importedPages, limit);

  const deleted = [];

  for (const item of sample) {
    const latest = await getLatestPgRelationalRevision(db, runId, item.page_id);

    if (!latest) continue;

    await db.query(
      `
        DELETE FROM bench_wiki_revision
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

async function sampleLatestReadsAfterDeletePgRelational(db, runId, importedPages, options = {}) {
  return sampleLatestReadsPgRelational(db, runId, importedPages, options);
}

async function verifyDeletesPgRelational(db, runId, deletedItems) {
  const verified = [];

  let ok = 0;
  let failed = 0;

  for (const item of deletedItems || []) {
    const result = await db.query(
      `
        SELECT COUNT(*)::INTEGER AS count
        FROM bench_wiki_revision
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

async function getPgRelationalStats(db, runId) {
  const counts = await db.query(
    `
      SELECT
        (SELECT COUNT(*)::INTEGER
         FROM bench_wiki_page
         WHERE run_id = $1) AS pages,

        (SELECT COUNT(*)::INTEGER
         FROM bench_wiki_revision
         WHERE run_id = $1) AS revisions,

        (SELECT COUNT(DISTINCT page_id)::INTEGER
         FROM bench_wiki_revision
         WHERE run_id = $1) AS page_ids
    `,
    [runId]
  );

  const sizes = await db.query(`
    SELECT
      pg_total_relation_size('bench_wiki_page')::BIGINT AS page_table_bytes,
      pg_total_relation_size('bench_wiki_revision')::BIGINT AS revision_table_bytes,
      pg_database_size(current_database())::BIGINT AS database_bytes
  `);

  return {
    model: MODEL_NAME,
    pages: Number(counts.rows[0].pages || 0),
    revisions: Number(counts.rows[0].revisions || 0),
    page_ids: Number(counts.rows[0].page_ids || 0),
    page_table_bytes: Number(sizes.rows[0].page_table_bytes || 0),
    revision_table_bytes: Number(sizes.rows[0].revision_table_bytes || 0),
    database_bytes: Number(sizes.rows[0].database_bytes || 0),
  };
}

module.exports = {
  MODEL_NAME,

  safeDiv,
  flattenPageMap,
  pickSamples,

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
};