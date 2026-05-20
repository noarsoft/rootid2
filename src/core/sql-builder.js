// src/core/sql-builder.js
// -----------------------------------------------------------------------------
// Small SQL builder helpers
//
// ใช้สำหรับ:
// - quote identifier
// - validate orderBy
// - build payload filter
// - build column filter
//
// หมายเหตุ:
// - ไม่มี _is_active
// - ไม่มี _doc_version
// - latest/current = _flag = ''
// - table view ใช้ table ชื่อ tableview ไม่ใช้ view เพื่อเลี่ยง keyword SQL
// -----------------------------------------------------------------------------

const config = require("../config/config");

const DEFAULT_LIMIT = config.rootid.defaultLimit;
const MAX_LIMIT = config.rootid.maxLimit;

const SYSTEM_FIELDS = new Set([
  "id",
  "_rootid",
  "_prev_id",
  "_flag",
  "_transfer_version",
  "_transfer_datetime",
  "_modify_datetime",
  "created_at",
  "updated_at",
]);

const ALLOWED_TABLES = new Set([
  "business",
  "data_schema",
  "data",
  "form",
  "tableview",
]);

const COMMON_ALLOWED_COLUMNS = new Set([
  "id",
  "_rootid",
  "_prev_id",
  "_flag",
  "name",
  "data_schema_id",
  "data_schema_rootid",
  "business_id",
  "_modify_datetime",
  "created_at",
  "updated_at",
]);

function assertSafeIdent(identifier, label = "identifier") {
  const s = String(identifier);

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) {
    const err = new Error(`Unsafe SQL ${label}: ${identifier}`);
    err.code = "UNSAFE_SQL_IDENTIFIER";
    throw err;
  }

  return s;
}

function assertAllowedTable(table) {
  if (!ALLOWED_TABLES.has(table)) {
    const err = new Error(`Table is not allowed: ${table}`);
    err.code = "TABLE_NOT_ALLOWED";
    throw err;
  }
}

function quoteIdent(identifier) {
  const s = assertSafeIdent(identifier);
  return `"${s.replace(/"/g, '""')}"`;
}

function normalizeLimit(limit, defaultLimit = DEFAULT_LIMIT) {
  const n = Number(limit);

  if (!Number.isFinite(n) || n <= 0) {
    return defaultLimit;
  }

  return Math.min(Math.floor(n), MAX_LIMIT);
}

function normalizeOffset(offset) {
  const n = Number(offset);

  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }

  return Math.floor(n);
}

function parseSortDirection(value) {
  const s = String(value || "DESC").trim().toUpperCase();

  if (s === "ASC") return "ASC";
  if (s === "DESC") return "DESC";

  const err = new Error(`Invalid sort direction: ${value}`);
  err.code = "INVALID_SORT_DIRECTION";
  throw err;
}

/**
 * orderBy แบบปลอดภัย
 *
 * ตัวอย่าง:
 *   parseOrderBy("updated_at", "desc")
 */
function parseOrderBy(
  orderBy,
  orderDir = "DESC",
  allowedColumns = COMMON_ALLOWED_COLUMNS
) {
  const field = String(orderBy || "updated_at").trim();

  if (!allowedColumns.has(field)) {
    const err = new Error(`Order by field is not allowed: ${field}`);
    err.code = "ORDER_BY_NOT_ALLOWED";
    err.field = field;
    throw err;
  }

  const dir = parseSortDirection(orderDir);

  return `${quoteIdent(field)} ${dir}`;
}

/**
 * สร้าง WHERE จาก column filter
 *
 * filters:
 *   { data_schema_id: 1, _rootid: "abc" }
 */
function buildColumnWhere(filters = {}, options = {}) {
  const allowedColumns = options.allowedColumns || COMMON_ALLOWED_COLUMNS;
  const startIndex = options.startIndex || 1;
  const alias = options.alias || "";

  const clauses = [];
  const values = [];
  let index = startIndex;

  const prefix = alias ? `${quoteIdent(alias)}.` : "";

  for (const [field, value] of Object.entries(filters || {})) {
    if (value === undefined) continue;

    if (!allowedColumns.has(field)) {
      const err = new Error(`Column filter is not allowed: ${field}`);
      err.code = "COLUMN_FILTER_NOT_ALLOWED";
      err.field = field;
      throw err;
    }

    if (value === null) {
      clauses.push(`${prefix}${quoteIdent(field)} IS NULL`);
      continue;
    }

    clauses.push(`${prefix}${quoteIdent(field)} = $${index}`);
    values.push(value);
    index += 1;
  }

  return {
    clauses,
    values,
    nextIndex: index,
  };
}

/**
 * สร้าง WHERE จาก payload JSONB text filter
 *
 * filters:
 *   { fname: "Somchai", sex: "male" }
 *
 * SQL:
 *   payload->>$1 = $2
 */
function buildPayloadWhere(filters = {}, options = {}) {
  const startIndex = options.startIndex || 1;
  const payloadColumn = options.payloadColumn || "payload";
  const alias = options.alias || "";

  const clauses = [];
  const values = [];
  let index = startIndex;

  const prefix = alias ? `${quoteIdent(alias)}.` : "";

  for (const [field, value] of Object.entries(filters || {})) {
    if (value === undefined) continue;

    assertSafeIdent(field, "payload field");

    if (value === null) {
      clauses.push(
        `NOT (${prefix}${quoteIdent(payloadColumn)} ? $${index}) OR ${prefix}${quoteIdent(payloadColumn)}->>$${index} IS NULL`
      );
      values.push(field);
      index += 1;
      continue;
    }

    clauses.push(
      `${prefix}${quoteIdent(payloadColumn)}->>$${index} = $${index + 1}`
    );
    values.push(field, String(value));
    index += 2;
  }

  return {
    clauses,
    values,
    nextIndex: index,
  };
}

/**
 * รวม WHERE clauses
 */
function joinWhere(clauses) {
  const clean = (clauses || []).filter(Boolean);

  if (clean.length === 0) return "";

  return `WHERE ${clean.join(" AND ")}`;
}

/**
 * ใช้ตอน INSERT
 */
function buildInsert(table, row) {
  assertAllowedTable(table);
  assertSafeIdent(table, "table");

  const keys = Object.keys(row || {});

  if (keys.length === 0) {
    const err = new Error("Cannot insert empty row");
    err.code = "EMPTY_INSERT";
    throw err;
  }

  const cols = keys.map(quoteIdent).join(", ");
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
  const values = keys.map((key) => row[key]);

  return {
    sql: `
      INSERT INTO ${quoteIdent(table)} (${cols})
      VALUES (${placeholders})
      RETURNING *
    `,
    values,
  };
}

/**
 * helper สำหรับ current/latest CTE
 *
 * latest/current = _flag = ''
 */
function buildLatestCte(table, cteName = "latest") {
  assertAllowedTable(table);
  assertSafeIdent(table, "table");
  assertSafeIdent(cteName, "cte name");

  return `
    ${quoteIdent(cteName)} AS (
      SELECT *
      FROM ${quoteIdent(table)}
      WHERE _flag = ''
    )
  `;
}

/**
 * helper สำหรับ last version ต่อ _rootid
 *
 * ใช้เมื่อต้อง includeDeleted=true แล้วอยากเห็น delete marker ล่าสุดด้วย
 */
function buildLastVersionCte(table, cteName = "latest") {
  assertAllowedTable(table);
  assertSafeIdent(table, "table");
  assertSafeIdent(cteName, "cte name");

  return `
    ${quoteIdent(cteName)} AS (
      SELECT DISTINCT ON (_rootid) *
      FROM ${quoteIdent(table)}
      ORDER BY _rootid, id DESC
    )
  `;
}

/**
 * normalize query object สำหรับ list endpoint
 *
 * หมายเหตุ:
 * - helper นี้ยังคงไว้เผื่อบาง code path ใช้ sql-builder โดยตรง
 * - controller หลักควรใช้ src/utils/query-options.js
 */
function normalizeListOptions(query = {}) {
  return {
    includeDeleted:
      query.includeDeleted === true ||
      query.includeDeleted === "true" ||
      query.includeDeleted === "1" ||
      query.includeDeleted === 1,
    limit: normalizeLimit(query.limit),
    offset: normalizeOffset(query.offset),
    orderBy: query.orderBy || "updated_at",
    orderDir: query.orderDir || "DESC",
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  SYSTEM_FIELDS,
  ALLOWED_TABLES,
  COMMON_ALLOWED_COLUMNS,

  assertSafeIdent,
  assertAllowedTable,
  quoteIdent,

  normalizeLimit,
  normalizeOffset,
  parseSortDirection,
  parseOrderBy,

  buildColumnWhere,
  buildPayloadWhere,
  joinWhere,
  buildInsert,
  buildLatestCte,
  buildLastVersionCte,

  normalizeListOptions,
};