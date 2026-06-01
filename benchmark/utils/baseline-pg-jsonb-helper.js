// benchmark/utils/baseline-pg-jsonb-helper.js
// -----------------------------------------------------------------------------
// PostgreSQL JSONB Baseline helper
//
// แนวคิด:
// - 1 wiki revision = 1 row
// - page_id, revision_id, revision_timestamp เป็น column สำหรับ query
// - field wiki ทั้งหมดเก็บใน payload JSONB
// - ไม่มี _rootid / _prev_id / _flag
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

    revision_id: row.revision_id ?? null,
    revision_timestamp: row.revision_timestamp ?? null,
    revision_user: row.revision_user ?? null,
    revision_comment: row.revision_comment ?? null,
    revision_size: row.revision_size ?? null,
    revision_sha1: row.revision_sha1 ?? null,

    text_hash: row.text_hash ?? null,
    text_size: row.text_size ?? null,
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
      run_id TEXT NOT NULL,

      page_id BIGINT NOT NULL,
      revision_id BIGINT NOT NULL,
      revision_timestamp TIMESTAMPTZ NULL,

      payload JSONB NOT NULL DEFAULT '{}'::jsonb,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT bench_wiki_jsonb_unique
        UNIQUE (run_id, page_id, revision_id)
    );

    CREATE INDEX IF NOT EXISTS idx_bench_wiki_jsonb_run_id
      ON bench_wiki_jsonb (run_id);

    CREATE INDEX IF NOT EXISTS idx_bench_wiki_jsonb_page_id
      ON bench_wiki_jsonb (page_id);

    CREATE INDEX IF NOT EXISTS idx_bench_wiki_jsonb_latest
      ON bench_wiki_jsonb (run_id, page_id, revision_timestamp DESC, revision_id DESC);

    CREATE INDEX IF NOT EXISTS idx_bench_wiki_jsonb_history
      ON bench_wiki_jsonb (run_id, page_id, revision_timestamp ASC, revision_id ASC);

    CREATE INDEX IF NOT EXISTS idx_bench_wiki_jsonb_payload_gin
      ON bench_wiki_jsonb USING GIN (payload);
  `);
}

async function clearPgJsonbRunData(db, runId) {
  await db.query("DELETE FROM bench_wiki_jsonb WHERE run_id = $1", [runId]);

  return {
    model: MODEL_NAME,
    run_id: runId,
    cleared: true,
  };
}

async function insertOneJsonbRevision(db, runId, row, options = {}) {
  const pageId = normalizeBigInt(row.page_id);
  const revisionId = normalizeBigInt(row.revision_id);
  const revisionTimestamp = toPgTimestamp(row.revision_timestamp);
  const payload = makeWikiJsonbPayload(row, {
    includeText: Boolean(options.includeText),
  });

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
      runId,
      pageId,
      revisionId,
      revisionTimestamp,
      JSON.stringify(payload),
    ]
  );
}

async function importWikiPagesPgJsonb(db, runId, pageMap, options = {}) {
  const progressEvery = options.progressEvery || 100;
  const pages = flattenPageMap(pageMap);

  let revisionCount = 0;
  const imported = [];

  await db.query("BEGIN");

  try {
    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i];

      for (const row of page.rows) {
        await insertOneJsonbRevision(db, runId, row, {
          includeText: Boolean(options.includeText),
        });

        revisionCount += 1;
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

async function sampleLatestReadsPgJsonb(db, runId, importedPages, options = {}) {
  const samples = pickSamples(importedPages, options.limit || 200);
  const latest = [];

  for (const page of samples) {
    const result = await db.query(
      `
        SELECT *
        FROM bench_wiki_jsonb
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

async function sampleHistoryReadsPgJsonb(db, runId, importedPages, options = {}) {
  const samples = pickSamples(importedPages, options.limit || 200);
  const historyLimit = options.historyLimit || 1000;
  const histories = [];
  let totalVersions = 0;

  for (const page of samples) {
    const result = await db.query(
      `
        SELECT *
        FROM bench_wiki_jsonb
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

async function getPgJsonbStats(db, runId) {
  const counts = await db.query(
    `
      SELECT
        COUNT(*)::BIGINT AS revisions,
        COUNT(DISTINCT page_id)::BIGINT AS pages
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
  makeWikiJsonbPayload,
  flattenPageMap,
  pickSamples,

  ensurePgJsonbTables,
  clearPgJsonbRunData,
  importWikiPagesPgJsonb,
  sampleLatestReadsPgJsonb,
  sampleHistoryReadsPgJsonb,
  getPgJsonbStats,
};