// benchmark/scripts/inspect-wiki-data.js
// -----------------------------------------------------------------------------
// Inspect Wiki benchmark data
//
// ใช้ตรวจโครงสร้างไฟล์ wiki normalized data ก่อน benchmark
//
// Default input:
//   benchmark/data/wiki-normalized.json
//
// Usage:
//   node benchmark/scripts/inspect-wiki-data.js
//
// With argument:
//   node benchmark/scripts/inspect-wiki-data.js --input=benchmark/data/wiki-normalized.json
//
// PowerShell:
//   $env:WIKI_NORMALIZED_PATH="benchmark/data/wiki-normalized.json";
//   node benchmark/scripts/inspect-wiki-data.js
//
// CMD:
//   set WIKI_NORMALIZED_PATH=benchmark\data\wiki-normalized.json&& node benchmark\scripts\inspect-wiki-data.js
// -----------------------------------------------------------------------------

require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_PATH = "benchmark/data/wiki-normalized.json";

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

const SAMPLE_SIZE = getNumberArg(
  "--sample-size",
  Number(process.env.INSPECT_SAMPLE_SIZE || 5)
);

function getInputPath() {
  return path.resolve(
    process.cwd(),
    process.env.WIKI_NORMALIZED_PATH ||
      process.env.WIKI_JSON_PATH ||
      getArgValue("--input") ||
      DEFAULT_PATH
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);

  // รองรับหลาย format:
  // 1) array ตรง ๆ
  // 2) { rows: [...] }  ← normalized format ปัจจุบัน
  // 3) { data: [...] }
  // 4) { revisions: [...] }
  // 5) { pages: [...] }
  if (Array.isArray(parsed)) {
    return {
      meta: null,
      rows: parsed,
      rawShape: "array",
    };
  }

  if (Array.isArray(parsed.rows)) {
    return {
      meta: isPlainObject(parsed.meta) ? parsed.meta : null,
      rows: parsed.rows,
      rawShape: "object.rows",
    };
  }

  if (Array.isArray(parsed.data)) {
    return {
      meta: isPlainObject(parsed.meta) ? parsed.meta : null,
      rows: parsed.data,
      rawShape: "object.data",
    };
  }

  if (Array.isArray(parsed.revisions)) {
    return {
      meta: isPlainObject(parsed.meta) ? parsed.meta : null,
      rows: parsed.revisions,
      rawShape: "object.revisions",
    };
  }

  if (Array.isArray(parsed.pages)) {
    return {
      meta: isPlainObject(parsed.meta) ? parsed.meta : null,
      rows: parsed.pages,
      rawShape: "object.pages",
    };
  }

  throw new Error(
    "Unsupported JSON shape. Expected array or object with rows/data/revisions/pages array."
  );
}

function detectField(row, candidates) {
  if (!isPlainObject(row)) return null;

  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return key;
    }
  }

  return null;
}

function countByField(rows, field) {
  if (!field) return null;

  const set = new Set();

  for (const row of rows) {
    if (row && row[field] !== undefined && row[field] !== null) {
      set.add(String(row[field]));
    }
  }

  return set.size;
}

function collectFieldStats(rows) {
  const fields = new Map();

  for (const row of rows) {
    if (!isPlainObject(row)) continue;

    for (const [key, value] of Object.entries(row)) {
      if (!fields.has(key)) {
        fields.set(key, {
          name: key,
          count: 0,
          nullish: 0,
          types: new Map(),
          examples: [],
        });
      }

      const stat = fields.get(key);
      stat.count += 1;

      if (value === null || value === undefined || value === "") {
        stat.nullish += 1;
      }

      const type = Array.isArray(value) ? "array" : typeof value;
      stat.types.set(type, (stat.types.get(type) || 0) + 1);

      if (
        stat.examples.length < 3 &&
        value !== null &&
        value !== undefined &&
        value !== ""
      ) {
        const text =
          typeof value === "string"
            ? value.slice(0, 160)
            : JSON.stringify(value).slice(0, 160);

        stat.examples.push(text);
      }
    }
  }

  return [...fields.values()]
    .map((field) => ({
      name: field.name,
      count: field.count,
      nullish: field.nullish,
      presentRatio: rows.length > 0 ? field.count / rows.length : 0,
      nullishRatio: field.count > 0 ? field.nullish / field.count : 0,
      types: Object.fromEntries(field.types.entries()),
      examples: field.examples,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getRevisionCountByPage(rows, pageField) {
  if (!pageField) return null;

  const map = new Map();

  for (const row of rows) {
    const pageId = row?.[pageField];

    if (pageId === undefined || pageId === null) continue;

    const key = String(pageId);
    map.set(key, (map.get(key) || 0) + 1);
  }

  const counts = [...map.values()].sort((a, b) => a - b);

  if (counts.length === 0) {
    return {
      pages: 0,
      min: 0,
      max: 0,
      avg: 0,
      median: 0,
    };
  }

  const sum = counts.reduce((a, b) => a + b, 0);
  const mid = Math.floor(counts.length / 2);

  return {
    pages: counts.length,
    min: counts[0],
    max: counts[counts.length - 1],
    avg: sum / counts.length,
    median:
      counts.length % 2 === 0
        ? (counts[mid - 1] + counts[mid]) / 2
        : counts[mid],
  };
}

function findDuplicateValues(rows, field, limit = 20) {
  if (!field) return [];

  const map = new Map();

  for (const row of rows) {
    const value = row?.[field];

    if (value === undefined || value === null || value === "") continue;

    const key = String(value);

    if (!map.has(key)) {
      map.set(key, 0);
    }

    map.set(key, map.get(key) + 1);
  }

  return [...map.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({
      value,
      count,
    }));
}

function findDuplicateComposite(rows, fields, limit = 20) {
  if (!fields || fields.length === 0 || fields.some((field) => !field)) {
    return [];
  }

  const map = new Map();

  for (const row of rows) {
    const values = fields.map((field) => row?.[field]);

    if (values.some((value) => value === undefined || value === null || value === "")) {
      continue;
    }

    const key = values.map(String).join("::");

    if (!map.has(key)) {
      map.set(key, {
        values,
        count: 0,
      });
    }

    map.get(key).count += 1;
  }

  return [...map.values()]
    .filter((item) => item.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((item) => ({
      key: item.values.join("::"),
      values: Object.fromEntries(fields.map((field, index) => [field, item.values[index]])),
      count: item.count,
    }));
}

function collectMissingRequired(rows, requiredFields) {
  const result = {};

  for (const field of requiredFields) {
    result[field] = 0;
  }

  for (const row of rows) {
    for (const field of requiredFields) {
      if (
        row?.[field] === undefined ||
        row?.[field] === null ||
        row?.[field] === ""
      ) {
        result[field] += 1;
      }
    }
  }

  return result;
}

function detectRows(rows) {
  const firstRow = rows.find(isPlainObject) || {};

  const categoryField = detectField(firstRow, [
    "category_title",
    "category",
    "category_name",
    "cat_title",
    "category_id",
  ]);

  const pageIdField = detectField(firstRow, [
    "page_id",
    "wiki_page_id",
    "id",
    "pageid",
  ]);

  const pageTitleField = detectField(firstRow, [
    "page_title",
    "title",
    "wiki_page_title",
  ]);

  const revisionIdField = detectField(firstRow, [
    "revision_id",
    "rev_id",
    "revid",
    "wiki_revision_id",
  ]);

  const parentIdField = detectField(firstRow, [
    "parent_id",
    "parentid",
    "revision_parent_id",
  ]);

  const timestampField = detectField(firstRow, [
    "revision_timestamp",
    "timestamp",
    "rev_timestamp",
    "wiki_timestamp",
  ]);

  const userField = detectField(firstRow, [
    "revision_user",
    "user",
    "username",
    "contributor",
    "wiki_user",
  ]);

  const commentField = detectField(firstRow, [
    "revision_comment",
    "comment",
    "rev_comment",
    "wiki_comment",
  ]);

  const textField = detectField(firstRow, [
    "revision_text",
    "text",
    "content",
    "wiki_text",
    "body",
  ]);

  const sha1Field = detectField(firstRow, [
    "revision_sha1",
    "sha1",
    "rev_sha1",
    "wiki_sha1",
  ]);

  const sizeField = detectField(firstRow, [
    "revision_size",
    "size",
    "text_size",
    "wiki_text_size",
    "bytes",
  ]);

  return {
    categoryField,
    pageIdField,
    pageTitleField,
    revisionIdField,
    parentIdField,
    timestampField,
    userField,
    commentField,
    textField,
    sha1Field,
    sizeField,
  };
}

async function main() {
  const inputPath = getInputPath();

  console.log("[inspect-wiki] input:", inputPath);

  const { meta, rows, rawShape } = await readJsonFile(inputPath);

  if (!Array.isArray(rows)) {
    throw new Error("Input data is not array after parsing");
  }

  const detectedFields = detectRows(rows);
  const fieldStats = collectFieldStats(rows);
  const revisionStats = getRevisionCountByPage(rows, detectedFields.pageIdField);

  const missingRequired = collectMissingRequired(rows, [
    "page_id",
    "revision_id",
    "revision_timestamp",
    "page_title",
  ]);

  const report = {
    inputPath,
    rawShape,
    meta,

    totalRows: rows.length,

    detectedFields,

    uniqueCounts: {
      categories: countByField(rows, detectedFields.categoryField),
      pages: countByField(rows, detectedFields.pageIdField),
      revisions: countByField(rows, detectedFields.revisionIdField),
      pageRevisionPairs:
        detectedFields.pageIdField && detectedFields.revisionIdField
          ? new Set(
              rows
                .filter(
                  (row) =>
                    row?.[detectedFields.pageIdField] !== undefined &&
                    row?.[detectedFields.pageIdField] !== null &&
                    row?.[detectedFields.revisionIdField] !== undefined &&
                    row?.[detectedFields.revisionIdField] !== null
                )
                .map(
                  (row) =>
                    `${row[detectedFields.pageIdField]}::${row[detectedFields.revisionIdField]}`
                )
            ).size
          : null,
    },

    missingRequired,

    duplicateChecks: {
      duplicateRevisionIds: findDuplicateValues(rows, detectedFields.revisionIdField, 20),
      duplicatePageRevisionPairs: findDuplicateComposite(
        rows,
        [detectedFields.pageIdField, detectedFields.revisionIdField],
        20
      ),
    },

    revisionStatsByPage: revisionStats,

    fields: fieldStats,

    sampleRows: rows.slice(0, SAMPLE_SIZE),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("[inspect-wiki] failed:", err);
  process.exit(1);
});