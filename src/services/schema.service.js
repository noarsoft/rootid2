// src/services/schema.service.js
// -----------------------------------------------------------------------------
// Schema service
//
// ดูแล:
// - data_schema CRUD แบบ versioned object
// - validate data.payload against data_schema.payload
// - compare schema version กับ current/latest schema
// - compare data row กับ current/latest schema
// - map/migrate payload ไป current/latest schema
//
// data_schema.payload format:
//
// {
//   "field_name": {
//     "type": "string",
//     "label": "Field label",
//     "required": true,
//     "default": "default value",
//     "enum": ["A", "B"]
//   }
// }
//
// Supported field types:
// - string
// - number
// - integer
// - boolean
// - date                 string YYYY-MM-DD
// - datetime             string parseable by Date.parse()
// - yyyymmddhhmmss       compact datetime, e.g. 20260514083045
// - yyyymmdd             compact date, e.g. 20260514
// - hhmmss               compact time, e.g. "083000"
// - object
// - array
// - json
// -----------------------------------------------------------------------------

const BaseVersionedRepository = require("../repositories/base-versioned.repository");

const FIELD_STATUS = {
  OK: "ok",
  MISSING_IN_OLD_SCHEMA: "missing_in_old_schema",
  REMOVED_IN_LATEST_SCHEMA: "removed_in_latest_schema",
  TYPE_CHANGED: "type_changed",
  MISSING_DATA: "missing_data",
};

const WARNING_TEXT = {
  MISSING_DATA: "[ไม่มี data]",
  MISSING_IN_OLD_SCHEMA: "[ไม่มีใน schema version เดิม]",
  REMOVED_IN_LATEST_SCHEMA: "[ไม่มีแล้วใน version ล่าสุด]",
  TYPE_CHANGED: "[ถูกเปลี่ยนแปลงโครงสร้างการจัดเก็บ]",
};

const ALLOWED_FIELD_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",

  "yyyymmddhhmmss",
  "yyyymmdd",
  "hhmmss",

  "object",
  "array",
  "json",

  "select",
  "dropdown",
  "toggle",
  "datepicker",
  "slider",
  "rating",
  "fileupload",
  "singleupload",
  "multipleupload",
  "pagebreak",
  "label",
  "link",
  "image",
  "badge",
  "icon",
  "progress",
  "qrcode",
  "calendargrid",
  "button",
  "buttongroup",
  "form",
  "table",
  "grid",
  "card",
  "accordion",
  "tabs",
  "tree",
  "menu",
  "crud",
  "modal",
  "pagination",
  "alertmodal",
  "confirmmodal",
  "chart",
  "chartsbar",
  "chartsline",
  "chartspie",
  "chartsdoughnut",
  "chartsradar",
  "chartsarea",
  "chartsbubble",
  "chartsmixed",
]);

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

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeSchemaPayload(payload) {
  assertPlainObject(payload, "schema payload");

  const out = {};

  for (const [fieldName, fieldConfig] of Object.entries(payload)) {
    // Meta keys (e.g. _description) are passed through without validation
    if (fieldName.startsWith("_")) {
      out[fieldName] = fieldConfig;
      continue;
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(fieldName)) {
      const err = new Error(`Invalid schema field name: ${fieldName}`);
      err.code = "INVALID_SCHEMA_FIELD_NAME";
      err.field = fieldName;
      throw err;
    }

    if (!isPlainObject(fieldConfig)) {
      const err = new Error(`Schema field config must be object: ${fieldName}`);
      err.code = "INVALID_SCHEMA_FIELD_CONFIG";
      err.field = fieldName;
      throw err;
    }

    const type = String(fieldConfig.type || "").trim();

    if (!ALLOWED_FIELD_TYPES.has(type)) {
      const err = new Error(`Invalid schema field type: ${fieldName}.${type}`);
      err.code = "INVALID_SCHEMA_FIELD_TYPE";
      err.field = fieldName;
      err.type = type;
      throw err;
    }

    out[fieldName] = {
      ...fieldConfig,
      type,
    };
  }

  return out;
}

function getFieldType(schemaPayload, fieldName) {
  if (!schemaPayload || !schemaPayload[fieldName]) return null;
  return schemaPayload[fieldName].type || null;
}

function toDigitString(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return String(value);
  }

  return "";
}

function isValidYyyyMmDdParts(yyyy, mm, dd) {
  const year = Number(yyyy);
  const month = Number(mm);
  const day = Number(dd);

  if (!Number.isInteger(year) || year < 1) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;

  const d = new Date(year, month - 1, day);

  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

function isValidYyyyMmDd(value) {
  const s = toDigitString(value);

  if (!/^\d{8}$/.test(s)) return false;

  return isValidYyyyMmDdParts(
    s.slice(0, 4),
    s.slice(4, 6),
    s.slice(6, 8)
  );
}

function isValidHhMmSs(value) {
  const s = toDigitString(value);

  if (!/^\d{6}$/.test(s)) return false;

  const hh = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  const ss = Number(s.slice(4, 6));

  return (
    Number.isInteger(hh) &&
    Number.isInteger(mm) &&
    Number.isInteger(ss) &&
    hh >= 0 &&
    hh <= 23 &&
    mm >= 0 &&
    mm <= 59 &&
    ss >= 0 &&
    ss <= 59
  );
}

function isValidYyyyMmDdHhMmSs(value) {
  const s = toDigitString(value);

  if (!/^\d{14}$/.test(s)) return false;

  return (
    isValidYyyyMmDd(s.slice(0, 8)) &&
    isValidHhMmSs(s.slice(8, 14))
  );
}

function isValueTypeValid(value, type) {
  if (value === null || value === undefined) return true;

  switch (type) {
    case "string":
      return typeof value === "string";

    case "number":
      return typeof value === "number" && Number.isFinite(value);

    case "integer":
      return Number.isInteger(value);

    case "boolean":
      return typeof value === "boolean";

    case "date":
      return (
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value))
      );

    case "datetime":
      return typeof value === "string" && !Number.isNaN(Date.parse(value));

    case "yyyymmddhhmmss":
      return isValidYyyyMmDdHhMmSs(value);

    case "yyyymmdd":
      return isValidYyyyMmDd(value);

    case "hhmmss":
      return isValidHhMmSs(value);

    case "object":
      return isPlainObject(value);

    case "array":
      return Array.isArray(value);

    case "json":
      return true;

    case "password":
    case "email":
    case "searchbox":
    case "file":
    case "singleupload":
    case "multipleupload":
    case "label":
    case "link":
    case "image":
    case "badge":
    case "icon":
    case "qrcode":
    case "button":
    case "datepicker":
    case "calendar":
    case "calendargrid":
      return typeof value === "string";

    case "slider":
    case "rating":
    case "progress":
      return typeof value === "number" && Number.isFinite(value);

    case "toggle":
      return typeof value === "boolean";

    case "select":
    case "dropdown":
    case "buttongroup":
      return typeof value === "string" || typeof value === "number";

    case "checkbox":
      return typeof value === "boolean";

    case "pagebreak":
    case "accordion":
    case "tabs":
    case "card":
    case "tree":
    case "menu":
    case "grid":
    case "table":
    case "form":
    case "crud":
    case "modal":
    case "pagination":
    case "alertmodal":
    case "confirmmodal":
    case "chart":
    case "chartsbar":
    case "chartsline":
    case "chartspie":
    case "chartsdoughnut":
    case "chartsradar":
    case "chartsarea":
    case "chartsbubble":
    case "chartsmixed":
    case "fileupload":
      return true;

    default:
      return false;
  }
}

function compareSchemaFields(oldPayload, latestPayload) {
  assertPlainObject(oldPayload, "old schema payload");
  assertPlainObject(latestPayload, "latest schema payload");

  const fieldNames = new Set([
    ...Object.keys(oldPayload),
    ...Object.keys(latestPayload),
  ]);

  const result = {};

  for (const fieldName of fieldNames) {
    const oldField = oldPayload[fieldName] || null;
    const latestField = latestPayload[fieldName] || null;

    if (oldField && latestField) {
      const oldType = oldField.type || null;
      const latestType = latestField.type || null;

      if (oldType === latestType) {
        result[fieldName] = {
          field: fieldName,
          status: FIELD_STATUS.OK,
          oldType,
          latestType,
          message: null,
          oldField,
          latestField,
        };
      } else {
        result[fieldName] = {
          field: fieldName,
          status: FIELD_STATUS.TYPE_CHANGED,
          oldType,
          latestType,
          message: WARNING_TEXT.TYPE_CHANGED,
          oldField,
          latestField,
        };
      }

      continue;
    }

    if (!oldField && latestField) {
      result[fieldName] = {
        field: fieldName,
        status: FIELD_STATUS.MISSING_IN_OLD_SCHEMA,
        oldType: null,
        latestType: latestField.type || null,
        message: WARNING_TEXT.MISSING_IN_OLD_SCHEMA,
        oldField: null,
        latestField,
      };

      continue;
    }

    if (oldField && !latestField) {
      result[fieldName] = {
        field: fieldName,
        status: FIELD_STATUS.REMOVED_IN_LATEST_SCHEMA,
        oldType: oldField.type || null,
        latestType: null,
        message: WARNING_TEXT.REMOVED_IN_LATEST_SCHEMA,
        oldField,
        latestField: null,
      };
    }
  }

  return result;
}

function compareRowWithLatestSchema(rowPayload, rowSchemaPayload, latestSchemaPayload) {
  assertPlainObject(rowPayload || {}, "row payload");
  assertPlainObject(rowSchemaPayload, "row schema payload");
  assertPlainObject(latestSchemaPayload, "latest schema payload");

  const compare = compareSchemaFields(rowSchemaPayload, latestSchemaPayload);
  const cells = {};
  const removed = {};

  for (const fieldName of Object.keys(latestSchemaPayload)) {
    const info = compare[fieldName];

    if (!info || info.status === FIELD_STATUS.MISSING_IN_OLD_SCHEMA) {
      cells[fieldName] = {
        field: fieldName,
        status: FIELD_STATUS.MISSING_IN_OLD_SCHEMA,
        value: null,
        displayValue: WARNING_TEXT.MISSING_IN_OLD_SCHEMA,
        message: WARNING_TEXT.MISSING_IN_OLD_SCHEMA,
        compare: info,
      };
      continue;
    }

    if (info.status === FIELD_STATUS.TYPE_CHANGED) {
      cells[fieldName] = {
        field: fieldName,
        status: FIELD_STATUS.TYPE_CHANGED,
        value: hasOwn(rowPayload, fieldName) ? rowPayload[fieldName] : null,
        displayValue: WARNING_TEXT.TYPE_CHANGED,
        message: WARNING_TEXT.TYPE_CHANGED,
        compare: info,
      };
      continue;
    }

    if (!hasOwn(rowPayload, fieldName)) {
      cells[fieldName] = {
        field: fieldName,
        status: FIELD_STATUS.MISSING_DATA,
        value: null,
        displayValue: WARNING_TEXT.MISSING_DATA,
        message: WARNING_TEXT.MISSING_DATA,
        compare: info,
      };
      continue;
    }

    cells[fieldName] = {
      field: fieldName,
      status: FIELD_STATUS.OK,
      value: rowPayload[fieldName],
      displayValue: rowPayload[fieldName],
      message: null,
      compare: info,
    };
  }

  for (const fieldName of Object.keys(rowSchemaPayload)) {
    if (latestSchemaPayload[fieldName]) continue;

    removed[fieldName] = {
      field: fieldName,
      status: FIELD_STATUS.REMOVED_IN_LATEST_SCHEMA,
      value: hasOwn(rowPayload, fieldName) ? rowPayload[fieldName] : null,
      displayValue: WARNING_TEXT.REMOVED_IN_LATEST_SCHEMA,
      message: WARNING_TEXT.REMOVED_IN_LATEST_SCHEMA,
      compare: compare[fieldName],
    };
  }

  return {
    cells,
    removed,
    compare,
  };
}

function validatePayloadAgainstSchema(payload, schemaPayload, options = {}) {
  assertPlainObject(payload || {}, "payload");
  assertPlainObject(schemaPayload, "schema payload");

  const allowExtraFields = Boolean(options.allowExtraFields);
  const enumValidatedTypes = new Set(["select", "dropdown"]);
  const errors = [];

  for (const [fieldName, fieldConfig] of Object.entries(schemaPayload)) {
    const required = Boolean(fieldConfig.required);
    const type = fieldConfig.type;

    if (!hasOwn(payload, fieldName)) {
      if (required) {
        errors.push({
          code: "REQUIRED_FIELD_MISSING",
          field: fieldName,
          message: `Required field is missing: ${fieldName}`,
        });
      }

      continue;
    }

    const value = payload[fieldName];

    if (!isValueTypeValid(value, type)) {
      errors.push({
        code: "INVALID_FIELD_TYPE",
        field: fieldName,
        expectedType: type,
        actualType: Array.isArray(value) ? "array" : typeof value,
        message: `Invalid field type: ${fieldName}`,
      });
    }

    if (
      enumValidatedTypes.has(type) &&
      Array.isArray(fieldConfig.enum) &&
      value != null
    ) {
      const enumMatch = fieldConfig.enum.some((e) =>
        e === value || (e && typeof e === "object" && e.value === value)
      );

      if (!enumMatch) {
        errors.push({
          code: "INVALID_ENUM_VALUE",
          field: fieldName,
          allowed: fieldConfig.enum,
          value,
          message: `Invalid enum value: ${fieldName}`,
        });
      }
    }
  }

  if (!allowExtraFields) {
    for (const fieldName of Object.keys(payload)) {
      if (!schemaPayload[fieldName]) {
        errors.push({
          code: "EXTRA_FIELD_NOT_IN_SCHEMA",
          field: fieldName,
          message: `Extra field is not in schema: ${fieldName}`,
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function mapPayloadToLatestSchema(oldPayload, oldSchemaPayload, latestSchemaPayload) {
  assertPlainObject(oldPayload || {}, "old payload");
  assertPlainObject(oldSchemaPayload, "old schema payload");
  assertPlainObject(latestSchemaPayload, "latest schema payload");

  const compare = compareSchemaFields(oldSchemaPayload, latestSchemaPayload);
  const nextPayload = {};
  const warnings = [];

  for (const [fieldName, latestField] of Object.entries(latestSchemaPayload)) {
    const info = compare[fieldName];

    if (!info) continue;

    if (info.status === FIELD_STATUS.OK) {
      if (hasOwn(oldPayload, fieldName)) {
        nextPayload[fieldName] = oldPayload[fieldName];
      }
      continue;
    }

    if (info.status === FIELD_STATUS.MISSING_IN_OLD_SCHEMA) {
      if (hasOwn(latestField, "default")) {
        nextPayload[fieldName] = latestField.default;
      }

      warnings.push({
        field: fieldName,
        status: FIELD_STATUS.MISSING_IN_OLD_SCHEMA,
        message: WARNING_TEXT.MISSING_IN_OLD_SCHEMA,
      });

      continue;
    }

    if (info.status === FIELD_STATUS.TYPE_CHANGED) {
      warnings.push({
        field: fieldName,
        status: FIELD_STATUS.TYPE_CHANGED,
        message: WARNING_TEXT.TYPE_CHANGED,
        oldValue: hasOwn(oldPayload, fieldName) ? oldPayload[fieldName] : null,
        oldType: info.oldType,
        latestType: info.latestType,
      });
    }
  }

  for (const [fieldName, oldField] of Object.entries(oldSchemaPayload)) {
    if (!latestSchemaPayload[fieldName]) {
      warnings.push({
        field: fieldName,
        status: FIELD_STATUS.REMOVED_IN_LATEST_SCHEMA,
        message: WARNING_TEXT.REMOVED_IN_LATEST_SCHEMA,
        oldValue: hasOwn(oldPayload, fieldName) ? oldPayload[fieldName] : null,
        oldType: oldField.type || null,
      });
    }
  }

  return {
    payload: nextPayload,
    warnings,
    compare,
  };
}

class SchemaService {
  constructor(db) {
    this.db = db;
    this.repo = new BaseVersionedRepository(db, "data_schema");
    this.dataRepo = new BaseVersionedRepository(db, "data");
    this.formRepo = new BaseVersionedRepository(db, "form");
    this.viewRepo = new BaseVersionedRepository(db, "tableview");
  }

    /**
   * Deprecated / blocked by design.
   *
   * ห้าม mark data/form/tableview เป็น _flag='u' จาก schema service โดยตรง
   * เพราะจะทำให้ object เหล่านั้นไม่มี current/latest row (_flag='')
   *
   * หลักที่ถูกต้อง:
   * - data/form/tableview เดิมยังเป็น current ของตัวเองได้
   * - ถ้าต้องการ migrate ให้ใช้ migrateDataToLatestSchema,
   *   migrateFormToLatestSchema, migrateViewToLatestSchema
   * - การเปลี่ยน _flag ต้องผ่าน rootid engine/repository เท่านั้น
   */
  async markLatestBySchemaIdAsUpdated(tableName, dataSchemaId) {
    const err = new Error(
      "Directly marking latest rows as updated is not allowed. Use versioned migration/update methods instead."
    );

    err.code = "INVALID_REPOSITORY_METHOD";
    err.details = {
      table: tableName,
      data_schema_id: dataSchemaId,
      reason:
        "Marking rows as _flag='u' without inserting a replacement current row will break latest/current lookup.",
    };

    throw err;
  }

  async markLatestDataBySchemaIdAsUpdated(dataSchemaId) {
    return this.markLatestBySchemaIdAsUpdated("data", dataSchemaId);
  }

  async markLatestFormsBySchemaIdAsUpdated(dataSchemaId) {
    return this.markLatestBySchemaIdAsUpdated("form", dataSchemaId);
  }

  async markLatestViewsBySchemaIdAsUpdated(dataSchemaId) {
    return this.markLatestBySchemaIdAsUpdated("tableview", dataSchemaId);
  }

  async createSchema(input = {}) {
    const name = String(input.name || "").trim();

    if (!name) {
      const err = new Error("Schema name is required");
      err.code = "SCHEMA_NAME_REQUIRED";
      throw err;
    }

    const payload = normalizeSchemaPayload(input.payload || {});

    return this.repo.create({
      name,
      payload,
      business_id: input.business_id ? Number(input.business_id) : null,
    });
  }

  async updateSchema(rootid, input = {}) {
    const patch = {};

    if (input.name !== undefined) {
      const name = String(input.name || "").trim();

      if (!name) {
        const err = new Error("Schema name is required");
        err.code = "SCHEMA_NAME_REQUIRED";
        throw err;
      }

      patch.name = name;
    }

    if (input.payload !== undefined) {
      patch.payload = normalizeSchemaPayload(input.payload);
    }

    const updatedSchema = await this.repo.updateByRootId(rootid, patch);

    return updatedSchema;
  }

  async getSchemaById(id) {
    const schema = await this.repo.findById(id);

    if (!schema) {
      const err = new Error(`Schema not found: ${id}`);
      err.code = "SCHEMA_NOT_FOUND";
      throw err;
    }

    return schema;
  }

  async getLatestSchemaByRootId(rootid, options = {}) {
    const schema = await this.repo.getLatestByRootId(rootid, options);

    if (!schema) {
      const err = new Error(`Latest schema not found: ${rootid}`);
      err.code = "SCHEMA_NOT_FOUND";
      throw err;
    }

    return schema;
  }

  async listLatestSchemas(options = {}) {
    const listOptions = {
      includeDeleted: options.includeDeleted,
      limit: options.limit,
      offset: options.offset,
    };

    if (options.business_id) {
      listOptions.columnFilters = {
        ...(listOptions.columnFilters || {}),
        business_id: Number(options.business_id),
      };
    }

    return this.repo.listLatest(listOptions);
  }

  async getSchemaHistory(rootid, options = {}) {
    return this.repo.getHistory(rootid, options);
  }

  async deleteSchema(rootid) {
    return this.repo.softDeleteByRootId(rootid);
  }

  async restoreSchema(versionId) {
    return this.repo.restoreVersion(versionId);
  }

  async getLatestSchemaFromSchemaId(dataSchemaId, options = {}) {
    const oldSchema = await this.getSchemaById(dataSchemaId);

    const latestSchema = await this.getLatestSchemaByRootId(
      oldSchema._rootid,
      options
    );

    return {
      oldSchema,
      latestSchema,
      isLatest: Number(oldSchema.id) === Number(latestSchema.id),
    };
  }

  async validatePayloadBySchemaId(dataSchemaId, payload, options = {}) {
    const schema = await this.getSchemaById(dataSchemaId);

    const validation = validatePayloadAgainstSchema(
      payload || {},
      schema.payload || {},
      options
    );

    return {
      schema,
      ...validation,
    };
  }

  async compareSchemaById(oldSchemaId, latestSchemaId) {
    const oldSchema = await this.getSchemaById(oldSchemaId);
    const latestSchema = await this.getSchemaById(latestSchemaId);

    return {
      oldSchema,
      latestSchema,
      compare: compareSchemaFields(
        oldSchema.payload || {},
        latestSchema.payload || {}
      ),
    };
  }

  async compareSchemaWithLatest(dataSchemaId) {
    const { oldSchema, latestSchema, isLatest } =
      await this.getLatestSchemaFromSchemaId(dataSchemaId, {
        includeDeleted: false,
      });

    return {
      oldSchema,
      latestSchema,
      isLatest,
      compare: compareSchemaFields(
        oldSchema.payload || {},
        latestSchema.payload || {}
      ),
    };
  }

  async compareRowWithLatestSchema(dataRow) {
    if (!dataRow || !dataRow.data_schema_id) {
      const err = new Error("data row must have data_schema_id");
      err.code = "DATA_SCHEMA_ID_REQUIRED";
      throw err;
    }

    const { oldSchema, latestSchema, isLatest } =
      await this.getLatestSchemaFromSchemaId(dataRow.data_schema_id, {
        includeDeleted: false,
      });

    return {
      row: dataRow,
      oldSchema,
      latestSchema,
      isLatest,
      ...compareRowWithLatestSchema(
        dataRow.payload || {},
        oldSchema.payload || {},
        latestSchema.payload || {}
      ),
    };
  }

  async mapPayloadToLatestSchema(dataSchemaId, payload) {
    const { oldSchema, latestSchema, isLatest } =
      await this.getLatestSchemaFromSchemaId(dataSchemaId, {
        includeDeleted: false,
      });

    if (isLatest) {
      return {
        oldSchema,
        latestSchema,
        isLatest,
        payload: payload || {},
        warnings: [],
        compare: compareSchemaFields(
          oldSchema.payload || {},
          latestSchema.payload || {}
        ),
      };
    }

    const mapped = mapPayloadToLatestSchema(
      payload || {},
      oldSchema.payload || {},
      latestSchema.payload || {}
    );

    return {
      oldSchema,
      latestSchema,
      isLatest,
      ...mapped,
    };
  }
}

module.exports = SchemaService;

module.exports.FIELD_STATUS = FIELD_STATUS;
module.exports.WARNING_TEXT = WARNING_TEXT;
module.exports.ALLOWED_FIELD_TYPES = ALLOWED_FIELD_TYPES;
module.exports.normalizeSchemaPayload = normalizeSchemaPayload;
module.exports.getFieldType = getFieldType;
module.exports.compareSchemaFields = compareSchemaFields;
module.exports.compareRowWithLatestSchema = compareRowWithLatestSchema;
module.exports.validatePayloadAgainstSchema = validatePayloadAgainstSchema;
module.exports.mapPayloadToLatestSchema = mapPayloadToLatestSchema;

module.exports.isValueTypeValid = isValueTypeValid;
module.exports.isValidYyyyMmDd = isValidYyyyMmDd;
module.exports.isValidHhMmSs = isValidHhMmSs;
module.exports.isValidYyyyMmDdHhMmSs = isValidYyyyMmDdHhMmSs;