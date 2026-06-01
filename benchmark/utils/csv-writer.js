// benchmark/utils/csv-writer.js
// -----------------------------------------------------------------------------
// Simple CSV writer for benchmark results
//
// ใช้สำหรับ export benchmark results เป็น CSV
//
// Example:
//
// const { writeCsv, rowsToCsv } = require("./utils/csv-writer");
//
// await writeCsv("benchmark/results/result.csv", [
//   { name: "create_data", ms: 123.45, rows: 1000 },
//   { name: "update_data", ms: 456.78, updates: 5000 },
// ]);
// -----------------------------------------------------------------------------

const fs = require("node:fs/promises");
const path = require("node:path");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value) || isPlainObject(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

function escapeCsvCell(value) {
  const text = normalizeCell(value);

  // ป้องกัน CSV injection เวลาเปิดใน Excel/Google Sheets
  // เช่น cell เริ่มด้วย = + - @ อาจถูกมองเป็น formula
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;

  if (
    safeText.includes(",") ||
    safeText.includes('"') ||
    safeText.includes("\n") ||
    safeText.includes("\r")
  ) {
    return `"${safeText.replace(/"/g, '""')}"`;
  }

  return safeText;
}

function collectHeaders(rows, preferredHeaders = []) {
  const headers = [];
  const seen = new Set();

  for (const key of preferredHeaders || []) {
    if (!seen.has(key)) {
      seen.add(key);
      headers.push(key);
    }
  }

  for (const row of rows || []) {
    if (!isPlainObject(row)) continue;

    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  return headers;
}

function rowsToCsv(rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];

  const headers = collectHeaders(list, options.headers || []);

  const includeBom = options.bom === true;
  const delimiter = options.delimiter || ",";

  const lines = [];

  lines.push(headers.map(escapeCsvCell).join(delimiter));

  for (const row of list) {
    const line = headers
      .map((header) => escapeCsvCell(isPlainObject(row) ? row[header] : ""))
      .join(delimiter);

    lines.push(line);
  }

  const csv = lines.join("\n");

  return includeBom ? `\uFEFF${csv}` : csv;
}

async function writeCsv(filePath, rows, options = {}) {
  const outputPath = path.resolve(process.cwd(), filePath);
  const csv = rowsToCsv(rows, options);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, csv, "utf8");

  return outputPath;
}

function flattenObject(obj, options = {}) {
  const prefix = options.prefix || "";
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 2;

  function walk(value, currentPrefix, depth) {
    const out = {};

    if (!isPlainObject(value) || depth >= maxDepth) {
      out[currentPrefix] = value;
      return out;
    }

    for (const [key, child] of Object.entries(value)) {
      const nextKey = currentPrefix ? `${currentPrefix}.${key}` : key;

      if (isPlainObject(child) && depth + 1 < maxDepth) {
        Object.assign(out, walk(child, nextKey, depth + 1));
      } else {
        out[nextKey] = child;
      }
    }

    return out;
  }

  return walk(obj, prefix, 0);
}

function flattenRows(rows, options = {}) {
  return (rows || []).map((row) => {
    if (!isPlainObject(row)) return row;
    return flattenObject(row, options);
  });
}

async function writeFlattenedCsv(filePath, rows, options = {}) {
  const flattened = flattenRows(rows, {
    maxDepth: options.maxDepth || 2,
  });

  return writeCsv(filePath, flattened, options);
}

module.exports = {
  escapeCsvCell,
  rowsToCsv,
  writeCsv,
  flattenObject,
  flattenRows,
  writeFlattenedCsv,
};