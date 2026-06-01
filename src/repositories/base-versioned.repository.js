// src/repositories/base-versioned.repository.js
// -----------------------------------------------------------------------------
// Base repository สำหรับ Root-ID versioned object
//
// ใช้กับ table:
// - business
// - data_schema
// - data
// - form
// - tableview
//
// หลักการ:
// - ไม่มี _is_active
// - ไม่มี _doc_version
// - current/latest = _flag = ''
// - old/history = _flag = 'u'
// - deleted marker = _flag = 'd'
// - delete/restore/update = insert version ใหม่ ไม่ update row เดิมโดยตรง
//   ยกเว้น engine mark previous current เป็น _flag='u'
// -----------------------------------------------------------------------------

const config = require("../config/config");
const rootidEngine = require("../core/rootid-engine");

const DEFAULT_LIMIT = config.rootid.defaultLimit;
const MAX_LIMIT = config.rootid.maxLimit;

const ALLOWED_TABLES = new Set([
  "business",
  "data_schema",
  "data",
  "form",
  "tableview",
]);

const SCHEMA_BOUND_TABLES = new Set([
  "data",
  "form",
  "tableview",
]);

const TABLES_WITH_DATA_SCHEMA_ROOTID = new Set([
  "form",
  "tableview",
]);

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

const COMMON_ALLOWED_COLUMN_FILTERS = new Set([
  "id",
  "_rootid",
  "_prev_id",
  "_flag",
  "name",
  "user_id",
  "share_mode",
  "data_schema_id",
  "data_schema_rootid",
  "business_id",
]);

function assertAllowedTable(table) {
  if (!ALLOWED_TABLES.has(table)) {
    const err = new Error(`Table is not allowed: ${table}`);
    err.code = "TABLE_NOT_ALLOWED";
    throw err;
  }
}

function quoteIdent(identifier) {
  const s = String(identifier);

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) {
    const err = new Error(`Unsafe SQL identifier: ${identifier}`);
    err.code = "UNSAFE_SQL_IDENTIFIER";
    throw err;
  }

  return `"${s.replace(/"/g, '""')}"`;
}

function tableIdent(table) {
  assertAllowedTable(table);
  return quoteIdent(table);
}

function normalizeLimit(limit) {
  const n = Number(limit);

  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;

  return Math.min(Math.floor(n), MAX_LIMIT);
}

function normalizeOffset(offset) {
  const n = Number(offset);

  if (!Number.isFinite(n) || n < 0) return 0;

  return Math.floor(n);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertPlainObject(value, label = "value") {
  if (!isPlainObject(value)) {
    const err = new Error(`${label} must be a plain object`);
    err.code = "INVALID_OBJECT";
    throw err;
  }
}

function stripUndefined(obj) {
  const out = {};

  for (const [key, value] of Object.entries(obj || {})) {
    if (value !== undefined) {
      out[key] = value;
    }
  }

  return out;
}

function stripSystemFields(obj) {
  const out = {};

  for (const [key, value] of Object.entries(obj || {})) {
    if (SYSTEM_FIELDS.has(key)) continue;
    out[key] = value;
  }

  return out;
}

function assertNoForbiddenSystemFields(obj, options = {}) {
  const allowEmptyFlag = Boolean(options.allowEmptyFlag);

  for (const key of Object.keys(obj || {})) {
    if (!SYSTEM_FIELDS.has(key)) continue;

    if (key === "_flag" && allowEmptyFlag && obj[key] === "") {
      continue;
    }

    const err = new Error(`Field is immutable: ${key}`);
    err.code = "IMMUTABLE_FIELD";
    err.field = key;
    throw err;
  }
}

function buildColumnWhere(filters, allowedColumns, startIndex = 1, alias = "") {
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

function buildPayloadWhere(filters, startIndex = 1, alias = "") {
  const clauses = [];
  const values = [];
  let index = startIndex;

  const prefix = alias ? `${quoteIdent(alias)}.` : "";

  for (const [field, value] of Object.entries(filters || {})) {
    if (value === undefined) continue;

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
      const err = new Error(`Unsafe payload field: ${field}`);
      err.code = "UNSAFE_PAYLOAD_FIELD";
      err.field = field;
      throw err;
    }

    if (value === null) {
      clauses.push(
        `NOT (${prefix}payload ? $${index}) OR ${prefix}payload->>$${index} IS NULL`
      );
      values.push(field);
      index += 1;
      continue;
    }

    clauses.push(`${prefix}payload->>$${index} = $${index + 1}`);
    values.push(field, String(value));
    index += 2;
  }

  return {
    clauses,
    values,
    nextIndex: index,
  };
}

class BaseVersionedRepository {
  constructor(db, table) {
    if (!db || typeof db.query !== "function") {
      const err = new Error("db must provide query(sql, values)");
      err.code = "INVALID_DB_CLIENT";
      throw err;
    }

    assertAllowedTable(table);

    this.db = db;
    this.table = table;
    this.tableSql = tableIdent(table);
  }

  async queryOne(sql, values = []) {
    const result = await this.db.query(sql, values);
    return result.rows[0] || null;
  }

  async queryMany(sql, values = []) {
    const result = await this.db.query(sql, values);
    return result.rows;
  }

  async create(input = {}) {
    assertPlainObject(input, "input");
    assertNoForbiddenSystemFields(input, { allowEmptyFlag: true });

    const clean = stripUndefined(input);

    return rootidEngine.createRoot(this.db, this.table, clean);
  }

  async updateByRootId(rootid, patch = {}, options = {}) {
    if (!rootid) {
      const err = new Error("_rootid is required");
      err.code = "ROOTID_REQUIRED";
      throw err;
    }

    assertPlainObject(patch, "patch");
    assertNoForbiddenSystemFields(patch);

    const cleanPatch = stripUndefined(stripSystemFields(patch));

    return rootidEngine.createNextVersion(
      this.db,
      this.table,
      rootid,
      cleanPatch,
      options
    );
  }

  async updateFromVersionId(id, patch = {}) {
    const source = await this.findById(id);

    if (!source) {
      const err = new Error(`Version not found: ${id}`);
      err.code = "VERSION_NOT_FOUND";
      throw err;
    }

    return this.updateByRootId(source._rootid, patch);
  }

  async findById(id) {
    if (!id) {
      const err = new Error("id is required");
      err.code = "ID_REQUIRED";
      throw err;
    }

    return rootidEngine.getById(this.db, this.table, id);
  }

  async getLatestByRootId(rootid, options = {}) {
    if (!rootid) {
      const err = new Error("_rootid is required");
      err.code = "ROOTID_REQUIRED";
      throw err;
    }

    return rootidEngine.getLatestByRootId(
      this.db,
      this.table,
      rootid,
      options
    );
  }

  async getLatestOrThrow(rootid, options = {}) {
    const row = await this.getLatestByRootId(rootid, options);

    if (!row) {
      const err = new Error(`Latest object not found: ${rootid}`);
      err.code = "LATEST_NOT_FOUND";
      throw err;
    }

    return row;
  }

  async getHistory(rootid, options = {}) {
    if (!rootid) {
      const err = new Error("_rootid is required");
      err.code = "ROOTID_REQUIRED";
      throw err;
    }

    return rootidEngine.getHistory(this.db, this.table, rootid, options);
  }

  async listLatest(options = {}) {
    const includeDeleted = Boolean(options.includeDeleted);
    const limit = normalizeLimit(options.limit);
    const offset = normalizeOffset(options.offset);

    const columnFilters = options.columnFilters || {};
    const payloadFilters = options.payloadFilters || {};

    const columnWhere = buildColumnWhere(
      columnFilters,
      COMMON_ALLOWED_COLUMN_FILTERS,
      1
    );

    const payloadWhere = buildPayloadWhere(
      payloadFilters,
      columnWhere.nextIndex
    );

    const clauses = [];

    if (!includeDeleted) {
      clauses.push(`_flag = ''`);
    }

    clauses.push(...columnWhere.clauses);
    clauses.push(...payloadWhere.clauses);

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const values = [...columnWhere.values, ...payloadWhere.values];

    const limitIndex = values.length + 1;
    const offsetIndex = values.length + 2;

    values.push(limit, offset);

    if (includeDeleted) {
      return this.queryMany(
        `
          WITH latest AS (
            SELECT DISTINCT ON (_rootid) *
            FROM ${this.tableSql}
            ORDER BY _rootid, id DESC
          )
          SELECT *
          FROM latest
          ${whereSql}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${limitIndex} OFFSET $${offsetIndex}
        `,
        values
      );
    }

    return this.queryMany(
      `
        SELECT *
        FROM ${this.tableSql}
        ${whereSql}
        ORDER BY updated_at DESC, id DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      values
    );
  }

  async listLatestBySchemaId(dataSchemaId, options = {}) {
    if (!dataSchemaId) {
      const err = new Error("data_schema_id is required");
      err.code = "DATA_SCHEMA_ID_REQUIRED";
      throw err;
    }

    return this.listLatest({
      ...options,
      columnFilters: {
        ...(options.columnFilters || {}),
        data_schema_id: Number(dataSchemaId),
      },
    });
  }

  async listLatestBySchemaRootId(schemaRootId, options = {}) {
    if (!schemaRootId) {
      const err = new Error("data_schema_rootid is required");
      err.code = "DATA_SCHEMA_ROOTID_REQUIRED";
      throw err;
    }

    if (!TABLES_WITH_DATA_SCHEMA_ROOTID.has(this.table)) {
      const err = new Error(
        `Table does not support data_schema_rootid: ${this.table}`
      );
      err.code = "INVALID_REPOSITORY_METHOD";
      throw err;
    }

    return this.listLatest({
      ...options,
      columnFilters: {
        ...(options.columnFilters || {}),
        data_schema_rootid: schemaRootId,
      },
    });
  }

  async listLatestInSchemaFamily(schemaRootId, options = {}) {
    if (!schemaRootId) {
      const err = new Error("schemaRootId is required");
      err.code = "DATA_SCHEMA_ROOTID_REQUIRED";
      throw err;
    }

    if (!SCHEMA_BOUND_TABLES.has(this.table)) {
      const err = new Error(
        `listLatestInSchemaFamily is not for table: ${this.table}`
      );
      err.code = "INVALID_REPOSITORY_METHOD";
      throw err;
    }

    const includeDeleted = Boolean(options.includeDeleted);
    const limit = normalizeLimit(options.limit);
    const offset = normalizeOffset(options.offset);
    const hasSchemaRootColumn = TABLES_WITH_DATA_SCHEMA_ROOTID.has(this.table);

    /**
     * รองรับ schema binding 2 แบบ:
     *
     * 1. fixed/edit/replay mode:
     *    object.data_schema_id -> data_schema.id
     *
     * 2. root/latest mode:
     *    object.data_schema_rootid -> data_schema._rootid
     *
     * หมายเหตุ:
     * - data table ไม่มี data_schema_rootid จึง match ผ่าน data_schema_id เท่านั้น
     * - form/tableview มี data_schema_rootid จึง match ได้ทั้ง 2 ทาง
     */

    const schemaFamilyCondition = hasSchemaRootColumn
      ? `(ds._rootid = $1 OR o.data_schema_rootid = $1)`
      : `ds._rootid = $1`;

    if (includeDeleted) {
      return this.queryMany(
        `
          WITH latest_object AS (
            SELECT DISTINCT ON (_rootid) *
            FROM ${this.tableSql}
            ORDER BY _rootid, id DESC
          )
          SELECT o.*
          FROM latest_object o
          LEFT JOIN data_schema ds
            ON ds.id = o.data_schema_id
          WHERE ${schemaFamilyCondition}
          ORDER BY o.updated_at DESC, o.id DESC
          LIMIT $2 OFFSET $3
        `,
        [schemaRootId, limit, offset]
      );
    }

    return this.queryMany(
      `
        SELECT o.*
        FROM ${this.tableSql} o
        LEFT JOIN data_schema ds
          ON ds.id = o.data_schema_id
        WHERE o._flag = ''
          AND ${schemaFamilyCondition}
        ORDER BY o.updated_at DESC, o.id DESC
        LIMIT $2 OFFSET $3
      `,
      [schemaRootId, limit, offset]
    );
  }

  async softDeleteByRootId(rootid) {
    if (!rootid) {
      const err = new Error("_rootid is required");
      err.code = "ROOTID_REQUIRED";
      throw err;
    }

    return rootidEngine.softDeleteByRootId(this.db, this.table, rootid);
  }

  async restoreVersion(versionId) {
    if (!versionId) {
      const err = new Error("version id is required");
      err.code = "ID_REQUIRED";
      throw err;
    }

    return rootidEngine.restoreVersion(this.db, this.table, versionId);
  }

  async isDeleted(rootid) {
    if (!rootid) {
      const err = new Error("_rootid is required");
      err.code = "ROOTID_REQUIRED";
      throw err;
    }

    return rootidEngine.isDeleted(this.db, this.table, rootid);
  }

  async countLatest(options = {}) {
    const includeDeleted = Boolean(options.includeDeleted);

    if (includeDeleted) {
      const row = await this.queryOne(
        `
          WITH latest AS (
            SELECT DISTINCT ON (_rootid) *
            FROM ${this.tableSql}
            ORDER BY _rootid, id DESC
          )
          SELECT COUNT(*)::INTEGER AS count
          FROM latest
        `
      );

      return row ? row.count : 0;
    }

    const row = await this.queryOne(
      `
        SELECT COUNT(*)::INTEGER AS count
        FROM ${this.tableSql}
        WHERE _flag = ''
      `
    );

    return row ? row.count : 0;
  }
}

module.exports = BaseVersionedRepository;