// src/core/rootid-engine.js
// -----------------------------------------------------------------------------
// Root-ID versioned object engine
//
// หลักการ:
// - ทุก table เป็น versioned object
// - ไม่มี _is_active
// - ไม่มี _doc_version
// - current/latest = row ที่ _flag = ''
// - old/history version = _flag = 'u'
// - deleted marker = _flag = 'd'
// - update/upsert = insert version ใหม่ แล้ว mark previous current เป็น _flag='u'
// - delete = insert delete marker _flag='d' แล้ว mark previous current เป็น _flag='u'
// - restore = copy old version เป็น new current version
//
// ใช้ได้กับ table:
// - business
// - data_schema
// - data
// - form
// - tableview
//
// หมายเหตุ:
// - _modify_datetime ใช้รูปแบบ YYYYMMDDHHMMSS เป็น BIGINT
//   เช่น 20260514083045
// -----------------------------------------------------------------------------

const config = require("../config/config");

const ALLOWED_TABLES = new Set([
  "business",
  "data_schema",
  "data",
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

const FLAG_NORMAL = "";
const FLAG_DELETED = "d";
const FLAG_UPDATED = "u";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function nowYmdHmsNumber() {
  const d = new Date();

  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());

  return Number(`${yyyy}${mm}${dd}${hh}${mi}${ss}`);
}

async function queryOne(db, sql, values = []) {
  const result = await db.query(sql, values);
  return result.rows[0] || null;
}

async function queryMany(db, sql, values = []) {
  const result = await db.query(sql, values);
  return result.rows;
}

async function reserveNextIdForTable(db, table) {
  const seqRow = await queryOne(
    db,
    `
      SELECT pg_get_serial_sequence($1, 'id') AS seq
    `,
    [table]
  );

  if (!seqRow || !seqRow.seq) {
    const err = new Error(`Cannot resolve serial sequence for table: ${table}`);
    err.code = "SERIAL_SEQUENCE_NOT_FOUND";
    throw err;
  }

  const nextIdRow = await queryOne(
    db,
    `
      SELECT nextval($1::regclass)::TEXT AS id
    `,
    [seqRow.seq]
  );

  if (!nextIdRow || !nextIdRow.id) {
    const err = new Error(`Cannot reserve next id for table: ${table}`);
    err.code = "SERIAL_NEXTVAL_FAILED";
    throw err;
  }

  return nextIdRow.id;
}

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

function normalizeFlag(flag) {
  if (flag == null) return FLAG_NORMAL;

  if (flag !== FLAG_NORMAL && flag !== FLAG_UPDATED && flag !== FLAG_DELETED) {
    const err = new Error(`Invalid _flag: ${flag}`);
    err.code = "INVALID_FLAG";
    throw err;
  }

  return flag;
}

function normalizeLimit(value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return config.rootid.defaultLimit;
  }

  return Math.min(Math.floor(n), config.rootid.maxLimit);
}

function normalizeOffset(value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }

  return Math.floor(n);
}

function normalizeOrder(value, defaultOrder = "ASC") {
  const s = String(value || defaultOrder).trim().toUpperCase();

  if (s === "ASC") return "ASC";
  if (s === "DESC") return "DESC";

  return defaultOrder === "DESC" ? "DESC" : "ASC";
}

function assertPlainObject(value, label = "value") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const err = new Error(`${label} must be a plain object`);
    err.code = "INVALID_OBJECT";
    throw err;
  }
}

function assertCreateFlagAllowed(input) {
  if (!input || !Object.prototype.hasOwnProperty.call(input, "_flag")) {
    return;
  }

  if (input._flag !== FLAG_NORMAL) {
    const err = new Error("Create does not allow _flag except empty string");
    err.code = "CREATE_FLAG_NOT_ALLOWED";
    throw err;
  }
}

function stripSystemFields(input) {
  const out = {};

  for (const [key, value] of Object.entries(input || {})) {
    if (SYSTEM_FIELDS.has(key)) continue;
    out[key] = value;
  }

  return out;
}

function buildInsert(table, row) {
  const keys = Object.keys(row);

  if (keys.length === 0) {
    const err = new Error("Cannot insert empty row");
    err.code = "EMPTY_INSERT";
    throw err;
  }

  const cols = keys.map(quoteIdent).join(", ");
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
  const values = keys.map((key) => row[key]);

  const sql = `
    INSERT INTO ${tableIdent(table)} (${cols})
    VALUES (${placeholders})
    RETURNING *
  `;

  return { sql, values };
}

async function getById(db, table, id) {
  assertAllowedTable(table);

  return queryOne(
    db,
    `
      SELECT *
      FROM ${tableIdent(table)}
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );
}

async function getCurrentByRootId(db, table, rootid) {
  assertAllowedTable(table);

  return queryOne(
    db,
    `
      SELECT *
      FROM ${tableIdent(table)}
      WHERE _rootid = $1
        AND _flag = $2
      ORDER BY id DESC
      LIMIT 1
    `,
    [rootid, FLAG_NORMAL]
  );
}

async function getLastVersionByRootId(db, table, rootid) {
  assertAllowedTable(table);

  return queryOne(
    db,
    `
      SELECT *
      FROM ${tableIdent(table)}
      WHERE _rootid = $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [rootid]
  );
}

async function getLatestByRootId(db, table, rootid, options = {}) {
  assertAllowedTable(table);

  const includeDeleted = Boolean(options.includeDeleted);

  if (includeDeleted) {
    return getLastVersionByRootId(db, table, rootid);
  }

  return getCurrentByRootId(db, table, rootid);
}

async function getHistory(db, table, rootid, options = {}) {
  assertAllowedTable(table);

  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const orderSql = normalizeOrder(options.order, "ASC");

  return queryMany(
    db,
    `
      SELECT *
      FROM ${tableIdent(table)}
      WHERE _rootid = $1
      ORDER BY id ${orderSql}
      LIMIT $2 OFFSET $3
    `,
    [rootid, limit, offset]
  );
}

async function listLatest(db, table, options = {}) {
  assertAllowedTable(table);

  const includeDeleted = Boolean(options.includeDeleted);
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);

  if (includeDeleted) {
    return queryMany(
      db,
      `
        WITH latest AS (
          SELECT DISTINCT ON (_rootid) *
          FROM ${tableIdent(table)}
          ORDER BY _rootid, id DESC
        )
        SELECT *
        FROM latest
        ORDER BY updated_at DESC, id DESC
        LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );
  }

  return queryMany(
    db,
    `
      SELECT *
      FROM ${tableIdent(table)}
      WHERE _flag = $1
      ORDER BY updated_at DESC, id DESC
      LIMIT $2 OFFSET $3
    `,
    [FLAG_NORMAL, limit, offset]
  );
}

async function createRoot(db, table, input = {}) {
  assertAllowedTable(table);
  assertPlainObject(input, "input");
  assertCreateFlagAllowed(input);

  const clean = stripSystemFields(input);
  const rootId = await reserveNextIdForTable(db, table);

  const row = {
    id: rootId,
    _rootid: rootId,
    _prev_id: null,
    _flag: FLAG_NORMAL,
    ...clean,
    _modify_datetime: nowYmdHmsNumber(),
  };

  const { sql, values } = buildInsert(table, row);
  return queryOne(db, sql, values);
}

async function markCurrentAsUpdated(db, table, id) {
  if (!id) return null;

  return db.query(
    `
      UPDATE ${tableIdent(table)}
      SET _flag = $1,
          _modify_datetime = $2,
          updated_at = NOW()
      WHERE id = $3
        AND _flag = $4
    `,
    [FLAG_UPDATED, nowYmdHmsNumber(), id, FLAG_NORMAL]
  );
}

async function createNextVersion(db, table, rootid, patch = {}, options = {}) {
  assertAllowedTable(table);
  assertPlainObject(patch, "patch");

  const latest = await getLatestByRootId(db, table, rootid, {
    includeDeleted: Boolean(options.allowFromDeleted),
  });

  if (!latest) {
    const err = new Error(`Latest object not found: ${rootid}`);
    err.code = "LATEST_NOT_FOUND";
    throw err;
  }

  if (latest._flag === FLAG_DELETED && !options.allowFromDeleted) {
    const err = new Error(`Cannot update deleted object: ${rootid}`);
    err.code = "CANNOT_UPDATE_DELETED_OBJECT";
    throw err;
  }

  const cleanPatch = stripSystemFields(patch);

  const nextFlag = normalizeFlag(
    Object.prototype.hasOwnProperty.call(options, "flag")
      ? options.flag
      : FLAG_NORMAL
  );

  const base = stripSystemFields(latest);

  const row = {
    ...base,
    ...cleanPatch,

    _rootid: latest._rootid,
    _prev_id: latest.id,
    _flag: nextFlag,
    _modify_datetime: nowYmdHmsNumber(),
  };

  const { sql, values } = buildInsert(table, row);
  const inserted = await queryOne(db, sql, values);

  // new current ถูก insert แล้ว
  // previous current ต้องกลายเป็น historical row
  if (latest._flag === FLAG_NORMAL) {
    await markCurrentAsUpdated(db, table, latest.id);
  }

  return inserted;
}

async function softDeleteByRootId(db, table, rootid) {
  assertAllowedTable(table);

  const current = await getCurrentByRootId(db, table, rootid);

  if (!current) {
    const lastVersion = await getLastVersionByRootId(db, table, rootid);

    if (!lastVersion) {
      const err = new Error(`Object not found: ${rootid}`);
      err.code = "OBJECT_NOT_FOUND";
      throw err;
    }

    if (lastVersion._flag === FLAG_DELETED) {
      const err = new Error(`Object already deleted: ${rootid}`);
      err.code = "OBJECT_ALREADY_DELETED";
      throw err;
    }

    const err = new Error(`Current object not found: ${rootid}`);
    err.code = "LATEST_NOT_FOUND";
    throw err;
  }

  const base = stripSystemFields(current);

  const row = {
    ...base,

    _rootid: current._rootid,
    _prev_id: current.id,
    _flag: FLAG_DELETED,
    _modify_datetime: nowYmdHmsNumber(),
  };

  const { sql, values } = buildInsert(table, row);
  const inserted = await queryOne(db, sql, values);

  await markCurrentAsUpdated(db, table, current.id);

  return inserted;
}

async function restoreVersion(db, table, restoreId) {
  assertAllowedTable(table);

  const source = await getById(db, table, restoreId);

  if (!source) {
    const err = new Error(`Restore source not found: ${restoreId}`);
    err.code = "RESTORE_SOURCE_NOT_FOUND";
    throw err;
  }

  if (source._flag === FLAG_DELETED) {
    const err = new Error("Cannot restore from deleted version");
    err.code = "CANNOT_RESTORE_FROM_DELETED_VERSION";
    throw err;
  }

  const lastVersion = await getLastVersionByRootId(db, table, source._rootid);

  if (!lastVersion) {
    const err = new Error(`Latest object not found: ${source._rootid}`);
    err.code = "LATEST_NOT_FOUND";
    throw err;
  }

  const current = await getCurrentByRootId(db, table, source._rootid);

  const base = stripSystemFields(source);

  const row = {
    ...base,

    _rootid: source._rootid,
    _prev_id: lastVersion.id,
    _flag: FLAG_NORMAL,
    _modify_datetime: nowYmdHmsNumber(),
  };

  const { sql, values } = buildInsert(table, row);
  const inserted = await queryOne(db, sql, values);

  // ถ้ามี current เดิม ให้ mark เป็น historical
  // ถ้าก่อนหน้าเป็น deleted marker จะไม่มี current ให้ mark
  if (current) {
    await markCurrentAsUpdated(db, table, current.id);
  }

  return inserted;
}

async function isDeleted(db, table, rootid) {
  const current = await getCurrentByRootId(db, table, rootid);

  if (current) return false;

  const lastVersion = await getLastVersionByRootId(db, table, rootid);

  if (!lastVersion) return false;

  return lastVersion._flag === FLAG_DELETED;
}

async function getLatestSchemaByRootId(db, schemaRootId, options = {}) {
  return getLatestByRootId(db, "data_schema", schemaRootId, options);
}

async function getSchemaRootIdBySchemaId(db, dataSchemaId) {
  const schema = await getById(db, "data_schema", dataSchemaId);

  if (!schema) {
    const err = new Error(`Schema not found: ${dataSchemaId}`);
    err.code = "SCHEMA_NOT_FOUND";
    throw err;
  }

  return schema._rootid;
}

async function getLatestSchemaFromSchemaId(db, dataSchemaId, options = {}) {
  const schemaRootId = await getSchemaRootIdBySchemaId(db, dataSchemaId);
  return getLatestSchemaByRootId(db, schemaRootId, options);
}

module.exports = {
  FLAG_NORMAL,
  FLAG_DELETED,
  FLAG_UPDATED,

  SYSTEM_FIELDS,
  ALLOWED_TABLES,

  nowYmdHmsNumber,
  quoteIdent,
  tableIdent,

  getById,
  getCurrentByRootId,
  getLastVersionByRootId,
  getLatestByRootId,
  getHistory,
  listLatest,

  createRoot,
  createNextVersion,
  softDeleteByRootId,
  restoreVersion,
  isDeleted,

  getLatestSchemaByRootId,
  getSchemaRootIdBySchemaId,
  getLatestSchemaFromSchemaId,
};