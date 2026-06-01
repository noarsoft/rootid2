// benchmark/utils/baseline-pg-relational-helper.js
// -----------------------------------------------------------------------------
// PostgreSQL Relational Baseline helper
//
// แนวคิด:
// - 1 wiki page = 1 row ใน bench_wiki_page
// - 1 wiki revision = 1 row ใน bench_wiki_revision
// - ไม่มี _rootid / _prev_id / _flag
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
      run_id TEXT NOT NULL,

      category_id TEXT NULL,
      category_title TEXT NULL,

      page_id BIGINT NOT NULL,
      page_title TEXT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT bench_wiki_page_unique
        UNIQUE (run_id, page_id)
    );

    CREATE INDEX IF NOT EXISTS idx_bench_wiki_page_run_id
      ON bench_wiki_page (run_id);

    CREATE INDEX IF NOT EXISTS idx_bench_wiki_page_page_id
      ON bench_wiki_page (page_id);

    CREATE TABLE IF NOT EXISTS bench_wiki_revision (
      id BIGSERIAL PRIMARY KEY,
      run_id TEXT NOT NULL,

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

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT bench_wiki_revision_unique
        UNIQUE (run_id, page_id, revision_id)
    );

    CREATE INDEX IF NOT EXISTS idx_bench_wiki_revision_run_id
      ON bench_wiki_revision (run_id);

    CREATE INDEX IF NOT EXISTS idx_bench_wiki_revision_page_id
      ON bench_wiki_revision (page_id);

    CREATE INDEX IF NOT EXISTS idx_bench_wiki_revision_latest
      ON bench_wiki_revision (run_id, page_id, revision_timestamp DESC, revision_id DESC);

    CREATE INDEX IF NOT EXISTS idx_bench_wiki_revision_history
      ON bench_wiki_revision (run_id, page_id, revision_timestamp ASC, revision_id ASC);
  `);
}

async function clearPgRelationalRunData(db, runId) {
  await db.query("DELETE FROM bench_wiki_revision WHERE run_id = $1", [runId]);
  await db.query("DELETE FROM bench_wiki_page WHERE run_id = $1", [runId]);

  return {
    model: MODEL_NAME,
    run_id: runId,
    cleared: true,
  };
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
  const progressEvery = options.progressEvery || 100;
  const pages = flattenPageMap(pageMap);

  let revisionCount = 0;
  const imported = [];

  await db.query("BEGIN");

  try {
    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i];
      const firstRow = page.rows[0];

      await insertOnePage(db, makePageRow(runId, firstRow));

      for (const row of page.rows) {
        const revisionRow = makeRevisionRow(runId, row, {
          includeText: Boolean(options.includeText),
        });

        await insertOneRevision(db, revisionRow);
        revisionCount += 1;
      }

      imported.push({
        page_id: page.page_id,
        page_title: firstRow.page_title || "",
        revisions: page.rows.length,
      });

      if (progressEvery > 0 && (i + 1) % progressEvery === 0) {
        console.log(`[${MODEL_NAME}] imported pages: ${i + 1}/${pages.length}`);
      }
    }

    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }

  return {
    model: MODEL_NAME,
    pages: pages.length,
    revisions: revisionCount,
    imported,
  };
}

async function sampleLatestReadsPgRelational(db, runId, importedPages, options = {}) {
  const samples = pickSamples(importedPages, options.limit || 200);
  const latest = [];

  for (const page of samples) {
    const result = await db.query(
      `
        SELECT *
        FROM bench_wiki_revision
        WHERE run_id = $1
          AND page_id = $2
        ORDER BY revision_timestamp DESC NULLS LAST, revision_id DESC
        LIMIT 1
      `,
      [runId, page.page_id]
    );

    if (result.rows[0]) {
      latest.push(result.rows[0]);
    }
  }

  return {
    model: MODEL_NAME,
    reads: samples.length,
    latest,
  };
}

async function sampleHistoryReadsPgRelational(db, runId, importedPages, options = {}) {
  const samples = pickSamples(importedPages, options.limit || 200);
  const historyLimit = options.historyLimit || 1000;
  const histories = [];
  let totalVersions = 0;

  for (const page of samples) {
    const result = await db.query(
      `
        SELECT *
        FROM bench_wiki_revision
        WHERE run_id = $1
          AND page_id = $2
        ORDER BY revision_timestamp ASC NULLS LAST, revision_id ASC
        LIMIT $3
      `,
      [runId, page.page_id, historyLimit]
    );

    totalVersions += result.rows.length;

    histories.push({
      page_id: page.page_id,
      versions: result.rows.length,
      sample: result.rows.slice(0, 3),
    });
  }

  return {
    model: MODEL_NAME,
    reads: samples.length,
    avg_versions: safeDiv(totalVersions, samples.length),
    histories,
  };
}

async function getPgRelationalStats(db, runId) {
  const counts = await db.query(
    `
      SELECT
        (SELECT COUNT(*)::BIGINT FROM bench_wiki_page WHERE run_id = $1) AS pages,
        (SELECT COUNT(*)::BIGINT FROM bench_wiki_revision WHERE run_id = $1) AS revisions,
        (SELECT COUNT(DISTINCT page_id)::BIGINT FROM bench_wiki_revision WHERE run_id = $1) AS page_ids
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
  getPgRelationalStats,
};