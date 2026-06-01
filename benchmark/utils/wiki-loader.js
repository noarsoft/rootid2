// benchmark/utils/wiki-loader.js
// -----------------------------------------------------------------------------
// Wiki normalized data loader
//
// รองรับไฟล์:
// 1) Array ตรง ๆ
// 2) { rows: [...] }
// 3) { data: [...] }
// 4) { meta: {...}, rows: [...] }
//
// normalized row field ที่คาดหวัง:
//   category_id
//   category_title
//   page_id
//   page_title
//   revision_id
//   revision_timestamp
//   revision_user
//   revision_comment
//   revision_size
//   revision_sha1
//   text_hash
//   text_size
// -----------------------------------------------------------------------------

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_WIKI_NORMALIZED_PATH = "benchmark/data/wiki-normalized.json";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getWikiPath(inputPath = null) {
  return path.resolve(
    process.cwd(),
    inputPath ||
      process.env.WIKI_NORMALIZED_PATH ||
      process.env.WIKI_JSON_PATH ||
      DEFAULT_WIKI_NORMALIZED_PATH
  );
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function extractRows(parsed) {
  if (Array.isArray(parsed)) {
    return {
      meta: {},
      rows: parsed,
    };
  }

  if (isPlainObject(parsed) && Array.isArray(parsed.rows)) {
    return {
      meta: parsed.meta || {},
      rows: parsed.rows,
    };
  }

  if (isPlainObject(parsed) && Array.isArray(parsed.data)) {
    return {
      meta: parsed.meta || {},
      rows: parsed.data,
    };
  }

  if (isPlainObject(parsed) && Array.isArray(parsed.revisions)) {
    return {
      meta: parsed.meta || {},
      rows: parsed.revisions,
    };
  }

  throw new Error(
    "Unsupported wiki JSON shape. Expected array or object with rows/data/revisions array."
  );
}

function toInteger(value, defaultValue = null) {
  if (value === null || value === undefined || value === "") return defaultValue;

  const n = Number(value);

  if (!Number.isFinite(n)) return defaultValue;

  return Math.trunc(n);
}

function toStringValue(value, defaultValue = "") {
  if (value === null || value === undefined) return defaultValue;
  return String(value);
}

function normalizeRow(row, sourceIndex = 0) {
  return {
    category_id: toInteger(row.category_id, null),
    category_title: toStringValue(row.category_title, ""),
    page_id: toInteger(row.page_id, null),
    page_title: toStringValue(row.page_title, ""),
    revision_id: toInteger(row.revision_id, null),
    revision_timestamp: toStringValue(row.revision_timestamp, ""),
    revision_user: toStringValue(row.revision_user, ""),
    revision_comment: toStringValue(row.revision_comment, ""),
    revision_size: toInteger(row.revision_size, null),
    revision_sha1: toStringValue(row.revision_sha1, ""),
    text_hash: toStringValue(row.text_hash, ""),
    text_size: toInteger(row.text_size, null),
    source_index: toInteger(row.source_index, sourceIndex),

    // optional
    ...(row.revision_text !== undefined
      ? { revision_text: toStringValue(row.revision_text, "") }
      : {}),
  };
}

function isValidWikiRow(row) {
  return (
    isPlainObject(row) &&
    Number.isInteger(row.page_id) &&
    Number.isInteger(row.revision_id)
  );
}

function sortWikiRows(rows) {
  return [...rows].sort((a, b) => {
    if (a.page_id !== b.page_id) {
      return a.page_id - b.page_id;
    }

    const at = Date.parse(a.revision_timestamp);
    const bt = Date.parse(b.revision_timestamp);

    if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) {
      return at - bt;
    }

    return a.revision_id - b.revision_id;
  });
}

function groupByPage(rows, options = {}) {
  const maxPages = Number(options.maxPages || process.env.BENCH_MAX_PAGES || 0);
  const maxRevisionsPerPage = Number(
    options.maxRevisionsPerPage ||
      process.env.BENCH_MAX_REVISIONS_PER_PAGE ||
      0
  );

  const sorted = sortWikiRows(rows);
  const map = new Map();

  for (const row of sorted) {
    const key = String(row.page_id);

    if (!map.has(key)) {
      if (maxPages > 0 && map.size >= maxPages) {
        continue;
      }

      map.set(key, []);
    }

    const list = map.get(key);

    if (maxRevisionsPerPage > 0 && list.length >= maxRevisionsPerPage) {
      continue;
    }

    list.push(row);
  }

  return map;
}

function flattenPageMap(pageMap) {
  return [...pageMap.values()].flat();
}

function summarizeWikiRows(rows) {
  const pageSet = new Set();
  const revisionSet = new Set();
  const categorySet = new Set();
  const revisionCounts = new Map();

  for (const row of rows) {
    pageSet.add(String(row.page_id));
    revisionSet.add(String(row.revision_id));

    if (row.category_title) {
      categorySet.add(String(row.category_title));
    }

    const pageKey = String(row.page_id);
    revisionCounts.set(pageKey, (revisionCounts.get(pageKey) || 0) + 1);
  }

  const counts = [...revisionCounts.values()].sort((a, b) => a - b);
  const sum = counts.reduce((acc, n) => acc + n, 0);
  const mid = Math.floor(counts.length / 2);

  return {
    rows: rows.length,
    pages: pageSet.size,
    revisions: revisionSet.size,
    categories: categorySet.size,
    min_revisions_per_page: counts.length ? counts[0] : 0,
    max_revisions_per_page: counts.length ? counts[counts.length - 1] : 0,
    avg_revisions_per_page: counts.length ? sum / counts.length : 0,
    median_revisions_per_page: counts.length
      ? counts.length % 2 === 0
        ? (counts[mid - 1] + counts[mid]) / 2
        : counts[mid]
      : 0,
  };
}

async function loadWikiRows(inputPath = null, options = {}) {
  const filePath = getWikiPath(inputPath);
  const parsed = await readJson(filePath);
  const extracted = extractRows(parsed);

  const normalized = [];
  const invalid = [];

  for (let i = 0; i < extracted.rows.length; i += 1) {
    const raw = extracted.rows[i];

    if (!isPlainObject(raw)) {
      invalid.push({
        index: i,
        reason: "ROW_NOT_OBJECT",
      });
      continue;
    }

    const row = normalizeRow(raw, i);

    if (!isValidWikiRow(row)) {
      invalid.push({
        index: i,
        reason: "INVALID_PAGE_OR_REVISION_ID",
        row,
      });
      continue;
    }

    normalized.push(row);
  }

  const pageMap = groupByPage(normalized, options);
  const limitedRows = flattenPageMap(pageMap);
  const summary = summarizeWikiRows(limitedRows);

  return {
    filePath,
    sourceMeta: extracted.meta,
    rows: limitedRows,
    pageMap,
    invalid,
    summary: {
      ...summary,
      invalid_rows: invalid.length,
      max_pages_limit:
        Number(options.maxPages || process.env.BENCH_MAX_PAGES || 0) || null,
      max_revisions_per_page_limit:
        Number(
          options.maxRevisionsPerPage ||
            process.env.BENCH_MAX_REVISIONS_PER_PAGE ||
            0
        ) || null,
    },
  };
}

module.exports = {
  DEFAULT_WIKI_NORMALIZED_PATH,
  getWikiPath,
  readJson,
  extractRows,
  normalizeRow,
  isValidWikiRow,
  sortWikiRows,
  groupByPage,
  flattenPageMap,
  summarizeWikiRows,
  loadWikiRows,
};