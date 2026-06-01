// benchmark/scripts/normalize-wiki-data.js
// -----------------------------------------------------------------------------
// Normalize Wiki benchmark data
//
// Input:
//   benchmark/data/json/**/*.json
//
// Output:
//   benchmark/data/wiki-normalized.json
//
// รองรับ raw MediaWiki API response:
//   query.pages.{pageid}.revisions[]
//
// และรองรับ legacy content format:
//   revision["*"]
//
// รวมถึง new slot format:
//   revision.slots.main["*"]
//   revision.slots.main.content
// -----------------------------------------------------------------------------

require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_INPUT_DIR = "benchmark/data/json";
const DEFAULT_OUTPUT_PATH = "benchmark/data/wiki-normalized.json";

function getArgValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.find((x) => x.startsWith(prefix));

  if (!found) return null;

  return found.slice(prefix.length);
}

function getNumberArg(name, defaultValue = 0) {
  const value = getArgValue(name);

  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return defaultValue;
  }

  return Math.trunc(n);
}

function getBoolArg(name, defaultValue = false) {
  const value = getArgValue(name);

  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }

  const s = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;

  return defaultValue;
}

const MAX_PAGES =
  getNumberArg("--max-pages", Number(process.env.BENCH_MAX_PAGES || 0));

const MAX_REVISIONS_PER_PAGE =
  getNumberArg(
    "--max-revisions-per-page",
    Number(process.env.BENCH_MAX_REVISIONS_PER_PAGE || 0)
  );

const INCLUDE_TEXT =
  getBoolArg(
    "--include-text",
    String(process.env.WIKI_INCLUDE_TEXT || "false").toLowerCase() === "true"
  );

function getInputDir() {
  return path.resolve(
    process.cwd(),
    process.env.WIKI_JSON_DIR || getArgValue("--input") || DEFAULT_INPUT_DIR
  );
}

function getOutputPath() {
  return path.resolve(
    process.cwd(),
    process.env.WIKI_NORMALIZED_PATH ||
      getArgValue("--output") ||
      DEFAULT_OUTPUT_PATH
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function walkJsonFiles(dirPath) {
  const files = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const childFiles = await walkJsonFiles(fullPath);
      files.push(...childFiles);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function readJsonObject(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function firstDefined(row, keys, defaultValue = null) {
  for (const key of keys) {
    if (
      row &&
      Object.prototype.hasOwnProperty.call(row, key) &&
      row[key] !== undefined &&
      row[key] !== null
    ) {
      return row[key];
    }
  }

  return defaultValue;
}

function toInteger(value, defaultValue = null) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return defaultValue;
  }

  return Math.trunc(n);
}

function toStringValue(value, defaultValue = "") {
  if (value === null || value === undefined) {
    return defaultValue;
  }

  if (typeof value === "string") {
    return value;
  }

  return String(value);
}

function hashText(text) {
  return crypto
    .createHash("sha1")
    .update(String(text || ""), "utf8")
    .digest("hex");
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const raw = String(value).trim();
  const d = new Date(raw);

  if (!Number.isNaN(d.getTime())) {
    return d.toISOString();
  }

  return raw;
}

function getRevisionText(rev) {
  return (
    rev?.["*"] ||
    rev?.slots?.main?.["*"] ||
    rev?.slots?.main?.content ||
    rev?.text ||
    rev?.revision_text ||
    rev?.content ||
    rev?.wiki_text ||
    rev?.body ||
    ""
  );
}

function getCategoryFromFile(inputDir, filePath) {
  const rel = path.relative(inputDir, filePath);
  const parts = rel.split(path.sep);

  if (parts.length <= 1) {
    return {
      category_id: "",
      category_title: "",
    };
  }

  const category = parts[0];

  return {
    category_id: category,
    category_title: category,
  };
}

function extractRowsFromMediaWikiResponse(parsed, filePath, inputDir) {
  const fileCategory = getCategoryFromFile(inputDir, filePath);
  const rows = [];

  if (!isPlainObject(parsed?.query?.pages)) {
    return rows;
  }

  const pages = parsed.query.pages;

  for (const page of Object.values(pages)) {
    if (!isPlainObject(page)) continue;

    const revisions = Array.isArray(page.revisions) ? page.revisions : [];

    for (let i = 0; i < revisions.length; i += 1) {
      const rev = revisions[i];

      if (!isPlainObject(rev)) continue;

      rows.push({
        category_id: fileCategory.category_id,
        category_title: fileCategory.category_title,

        page_id: page.pageid,
        page_title: page.title,

        revision_id: rev.revid,
        parent_id: rev.parentid,
        revision_timestamp: rev.timestamp,
        revision_user: rev.user,
        revision_comment: rev.comment,
        revision_size: rev.size,
        revision_sha1: rev.sha1,

        content_format: rev.contentformat,
        content_model: rev.contentmodel,

        revision_text: getRevisionText(rev),

        source_file: path.relative(process.cwd(), filePath),
        source_revision_index: i,
      });
    }
  }

  return rows;
}

function extractRowsFromGenericJson(parsed, filePath, inputDir) {
  const fileCategory = getCategoryFromFile(inputDir, filePath);

  let arr = [];

  if (Array.isArray(parsed)) arr = parsed;
  else if (Array.isArray(parsed.rows)) arr = parsed.rows;
  else if (Array.isArray(parsed.data)) arr = parsed.data;
  else if (Array.isArray(parsed.revisions)) arr = parsed.revisions;
  else if (Array.isArray(parsed.pages)) arr = parsed.pages;

  return arr
    .filter(isPlainObject)
    .map((row, index) => ({
      category_id: firstDefined(row, ["category_id"], fileCategory.category_id),
      category_title: firstDefined(row, ["category_title"], fileCategory.category_title),
      ...row,
      source_file: row.source_file || path.relative(process.cwd(), filePath),
      source_revision_index: row.source_revision_index ?? index,
    }));
}

function extractRows(parsed, filePath, inputDir) {
  const mediaWikiRows = extractRowsFromMediaWikiResponse(parsed, filePath, inputDir);

  if (mediaWikiRows.length > 0) {
    return mediaWikiRows;
  }

  return extractRowsFromGenericJson(parsed, filePath, inputDir);
}

function normalizeOne(row, index) {
  const text = firstDefined(
    row,
    [
      "revision_text",
      "text",
      "content",
      "wiki_text",
      "body",
      "*",
    ],
    ""
  );

  const categoryId = firstDefined(
    row,
    [
      "category_id",
      "cat_id",
      "wiki_category_id",
    ],
    null
  );

  const categoryTitle = firstDefined(
    row,
    [
      "category_title",
      "category",
      "category_name",
      "cat_title",
      "wiki_category",
    ],
    ""
  );

  const pageId = firstDefined(
    row,
    [
      "page_id",
      "wiki_page_id",
      "pageid",
    ],
    null
  );

  const pageTitle = firstDefined(
    row,
    [
      "page_title",
      "title",
      "wiki_page_title",
    ],
    ""
  );

  const revisionId = firstDefined(
    row,
    [
      "revision_id",
      "rev_id",
      "revid",
      "wiki_revision_id",
    ],
    null
  );

  const parentId = firstDefined(
    row,
    [
      "parent_id",
      "parentid",
      "revision_parent_id",
    ],
    null
  );

  const revisionTimestamp = firstDefined(
    row,
    [
      "revision_timestamp",
      "timestamp",
      "rev_timestamp",
      "wiki_timestamp",
    ],
    ""
  );

  const revisionUser = firstDefined(
    row,
    [
      "revision_user",
      "user",
      "username",
      "contributor",
      "wiki_user",
    ],
    ""
  );

  const revisionComment = firstDefined(
    row,
    [
      "revision_comment",
      "comment",
      "rev_comment",
      "wiki_comment",
    ],
    ""
  );

  const revisionSize = firstDefined(
    row,
    [
      "revision_size",
      "size",
      "text_size",
      "wiki_text_size",
      "bytes",
    ],
    null
  );

  const revisionSha1 = firstDefined(
    row,
    [
      "revision_sha1",
      "sha1",
      "rev_sha1",
      "wiki_sha1",
    ],
    ""
  );

  const sourceIndex = firstDefined(
    row,
    [
      "source_index",
      "source_revision_index",
    ],
    index
  );

  const normalized = {
    category_id: toStringValue(categoryId, ""),
    category_title: toStringValue(categoryTitle, ""),

    page_id: toInteger(pageId, null),
    page_title: toStringValue(pageTitle, ""),

    revision_id: toInteger(revisionId, null),
    parent_id: toInteger(parentId, null),

    revision_timestamp: normalizeTimestamp(revisionTimestamp),
    revision_user: toStringValue(revisionUser, ""),
    revision_comment: toStringValue(revisionComment, ""),
    revision_size: toInteger(revisionSize, null),

    revision_sha1: toStringValue(revisionSha1 || hashText(text), ""),

    content_format: toStringValue(row.content_format || row.contentformat, ""),
    content_model: toStringValue(row.content_model || row.contentmodel, ""),

    text_hash: hashText(text),
    text_size: Buffer.byteLength(String(text || ""), "utf8"),

    source_file: toStringValue(row.source_file, ""),
    source_index: toInteger(sourceIndex, index),
  };

  if (INCLUDE_TEXT) {
    normalized.revision_text = toStringValue(text, "");
  }

  return normalized;
}

function validateNormalized(row) {
  if (!Number.isInteger(row.page_id)) return false;
  if (!Number.isInteger(row.revision_id)) return false;
  return true;
}

function sortRows(rows) {
  return rows.sort((a, b) => {
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

function limitPagesAndRevisions(rows) {
  const byPage = new Map();

  for (const row of rows) {
    const key = String(row.page_id);

    if (!byPage.has(key)) {
      if (MAX_PAGES > 0 && byPage.size >= MAX_PAGES) {
        continue;
      }

      byPage.set(key, []);
    }

    const list = byPage.get(key);

    if (
      MAX_REVISIONS_PER_PAGE > 0 &&
      list.length >= MAX_REVISIONS_PER_PAGE
    ) {
      continue;
    }

    list.push(row);
  }

  return [...byPage.values()].flat();
}

function summarize(rows, invalidCount, fileCount) {
  const pageSet = new Set();
  const revisionSet = new Set();
  const categorySet = new Set();

  let minRevisionPerPage = Infinity;
  let maxRevisionPerPage = 0;

  const byPage = new Map();

  for (const row of rows) {
    pageSet.add(String(row.page_id));
    revisionSet.add(String(row.revision_id));

    if (row.category_title) {
      categorySet.add(String(row.category_title));
    }

    const key = String(row.page_id);
    byPage.set(key, (byPage.get(key) || 0) + 1);
  }

  for (const count of byPage.values()) {
    minRevisionPerPage = Math.min(minRevisionPerPage, count);
    maxRevisionPerPage = Math.max(maxRevisionPerPage, count);
  }

  return {
    rows: rows.length,
    invalidRowsSkipped: invalidCount,
    files: fileCount,
    pages: pageSet.size,
    revisions: revisionSet.size,
    categories: categorySet.size,
    minRevisionPerPage: minRevisionPerPage === Infinity ? 0 : minRevisionPerPage,
    maxRevisionPerPage,
    maxPagesLimit: MAX_PAGES || null,
    maxRevisionsPerPageLimit: MAX_REVISIONS_PER_PAGE || null,
    includeText: INCLUDE_TEXT,
  };
}

async function main() {
  const inputDir = getInputDir();
  const outputPath = getOutputPath();

  console.log("[normalize-wiki] input dir:", inputDir);
  console.log("[normalize-wiki] output:", outputPath);
  console.log("[normalize-wiki] include text:", INCLUDE_TEXT);

  const files = await walkJsonFiles(inputDir);

  if (files.length === 0) {
    throw new Error(`No JSON files found in input dir: ${inputDir}`);
  }

  console.log("[normalize-wiki] json files:", files.length);

  const rawRows = [];
  let invalidCount = 0;

  for (const filePath of files) {
    try {
      const parsed = await readJsonObject(filePath);
      const rows = extractRows(parsed, filePath, inputDir);
      rawRows.push(...rows);
    } catch (err) {
      invalidCount += 1;
      console.warn("[normalize-wiki] skip file:", filePath, err.message);
    }
  }

  const normalizedRows = [];

  for (let i = 0; i < rawRows.length; i += 1) {
    const raw = rawRows[i];

    if (!isPlainObject(raw)) {
      invalidCount += 1;
      continue;
    }

    const normalized = normalizeOne(raw, i);

    if (!validateNormalized(normalized)) {
      invalidCount += 1;
      continue;
    }

    normalizedRows.push(normalized);
  }

  const sorted = sortRows(normalizedRows);
  const limited = limitPagesAndRevisions(sorted);

  const output = {
    meta: {
      sourceDir: inputDir,
      createdAt: new Date().toISOString(),
      ...summarize(limited, invalidCount, files.length),
    },
    rows: limited,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

  console.log("[normalize-wiki] done");
  console.log(JSON.stringify(output.meta, null, 2));
}

main().catch((err) => {
  console.error("[normalize-wiki] failed:", err);
  process.exit(1);
});