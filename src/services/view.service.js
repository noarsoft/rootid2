// src/services/view.service.js
// -----------------------------------------------------------------------------
// View service
//
// ดูแล:
// - table view/display config แบบ versioned object
// - API ยังเรียกว่า view
// - DB table จริงคือ tableview
// - render fixed schema view
// - render latest root schema view
// - migrate view columns ไป latest schema
//
// Binding modes:
// - data_schema_id      = fixed/edit/replay mode
// - data_schema_rootid  = root/latest schema mode
// -----------------------------------------------------------------------------

const BaseVersionedRepository = require("../repositories/base-versioned.repository");
const SchemaService = require("./schema.service");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getColumns(payload) {
  if (!payload) return [];

  if (Array.isArray(payload.columns)) return payload.columns;
  if (Array.isArray(payload.fields)) return payload.fields;

  return [];
}

function setColumns(payload, columns) {
  const next = {
    ...(payload || {}),
  };

  if (Array.isArray(payload?.columns)) {
    next.columns = columns;
    return next;
  }

  if (Array.isArray(payload?.fields)) {
    next.fields = columns;
    return next;
  }

  next.columns = columns;
  return next;
}

function defaultControlByType(type) {
  switch (type) {
    case "boolean":
      return "checkbox";

    case "number":
    case "integer":
      return "number";

    case "date":
    case "yyyymmdd":
      return "date";

    case "datetime":
    case "yyyymmddhhmmss":
      return "datetime";

    case "hhmmss":
      return "time";

    case "array":
    case "object":
    case "json":
      return "json";

    case "string":
    default:
      return "label";
  }
}

function defaultColumnByField(fieldName, fieldConfig = {}) {
  return {
    databind: fieldName,
    header: fieldConfig.label || fieldName,
    control: defaultControlByType(fieldConfig.type),
    width: 160,
  };
}

function mapViewPayloadToLatestSchema(oldPayload, compare, latestSchemaPayload) {
  const oldColumns = getColumns(oldPayload);
  const nextColumns = [];
  const warnings = [];
  const usedFields = new Set();

  for (const column of oldColumns) {
    const databind = column.databind || column.field || column.name;

    if (!databind) {
      nextColumns.push(column);
      continue;
    }

    usedFields.add(databind);

    const info = compare[databind];

    if (!info) {
      nextColumns.push(column);
      continue;
    }

    if (info.status === "ok") {
      nextColumns.push({
        ...column,
        status: "ok",
        message: null,
      });
      continue;
    }

    if (info.status === "removed_in_latest_schema") {
      warnings.push({
        field: databind,
        status: info.status,
        message: info.message,
      });

      nextColumns.push({
        ...column,
        status: info.status,
        message: info.message,
        disabled: true,
        requiresReview: true,
      });

      continue;
    }

    if (info.status === "type_changed") {
      warnings.push({
        field: databind,
        status: info.status,
        message: info.message,
        oldType: info.oldType,
        latestType: info.latestType,
      });

      nextColumns.push({
        ...column,
        oldType: info.oldType,
        newType: info.latestType,
        status: info.status,
        message: info.message,
        requiresReview: true,
      });

      continue;
    }

    nextColumns.push(column);
  }

  for (const [fieldName, latestField] of Object.entries(latestSchemaPayload || {})) {
    if (usedFields.has(fieldName)) continue;

    nextColumns.push({
      ...defaultColumnByField(fieldName, latestField),
      status: "new_field",
      message: "[field ใหม่ใน schema ล่าสุด]",
    });

    warnings.push({
      field: fieldName,
      status: "new_field",
      message: "[field ใหม่ใน schema ล่าสุด]",
    });
  }

  return {
    payload: setColumns(oldPayload, nextColumns),
    warnings,
  };
}

class ViewService {
  constructor(db) {
    this.db = db;

    // DB table จริงคือ tableview
    // API/Service naming ยังใช้ View เหมือนเดิมได้
    this.repo = new BaseVersionedRepository(db, "tableview");

    this.dataRepo = new BaseVersionedRepository(db, "data");
    this.schemaService = new SchemaService(db);
  }

  async createView(input = {}) {
    if (!input.data_schema_id && !input.data_schema_rootid) {
      const err = new Error("view requires data_schema_id or data_schema_rootid");
      err.code = "VIEW_BINDING_INVALID";
      throw err;
    }

    if (input.data_schema_id) {
      await this.schemaService.getSchemaById(input.data_schema_id);
    }

    if (input.data_schema_rootid) {
      await this.schemaService.getLatestSchemaByRootId(input.data_schema_rootid);
    }

    if (!isPlainObject(input.payload || {})) {
      const err = new Error("view payload must be object");
      err.code = "INVALID_OBJECT";
      throw err;
    }

    return this.repo.create({
      data_schema_id: input.data_schema_id ? Number(input.data_schema_id) : null,
      data_schema_rootid: input.data_schema_rootid || null,
      payload: input.payload || {},
    });
  }

  async updateView(rootid, input = {}) {
    const latest = await this.repo.getLatestOrThrow(rootid);

    const dataSchemaId =
      input.data_schema_id !== undefined
        ? input.data_schema_id
        : latest.data_schema_id;

    const dataSchemaRootId =
      input.data_schema_rootid !== undefined
        ? input.data_schema_rootid
        : latest.data_schema_rootid;

    if (!dataSchemaId && !dataSchemaRootId) {
      const err = new Error("view requires data_schema_id or data_schema_rootid");
      err.code = "VIEW_BINDING_INVALID";
      throw err;
    }

    if (dataSchemaId) {
      await this.schemaService.getSchemaById(dataSchemaId);
    }

    if (dataSchemaRootId) {
      await this.schemaService.getLatestSchemaByRootId(dataSchemaRootId);
    }

    return this.repo.updateByRootId(rootid, {
      data_schema_id: dataSchemaId ? Number(dataSchemaId) : null,
      data_schema_rootid: dataSchemaRootId || null,
      payload: input.payload !== undefined ? input.payload : latest.payload || {},
    });
  }

  async getViewById(id) {
    const view = await this.repo.findById(id);

    if (!view) {
      const err = new Error(`View not found: ${id}`);
      err.code = "VIEW_NOT_FOUND";
      throw err;
    }

    return view;
  }

  async getLatestViewByRootId(rootid, options = {}) {
    const view = await this.repo.getLatestByRootId(rootid, options);

    if (!view) {
      const err = new Error(`Latest view not found: ${rootid}`);
      err.code = "VIEW_NOT_FOUND";
      throw err;
    }

    return view;
  }

  async listLatestViews(options = {}) {
    if (options.data_schema_id) {
      return this.listLatestViewsBySchemaId(options.data_schema_id, options);
    }

    if (options.data_schema_rootid) {
      return this.listLatestViewsBySchemaRootId(
        options.data_schema_rootid,
        options
      );
    }

    return this.repo.listLatest(options);
  }

  async listLatestViewsBySchemaId(schemaId, options = {}) {
    return this.repo.listLatestBySchemaId(schemaId, options);
  }

  async listLatestViewsBySchemaRootId(schemaRootId, options = {}) {
    return this.repo.listLatestInSchemaFamily(schemaRootId, options);
  }

  async getViewEditorContext(id) {
    const view = await this.getViewById(id);

    if (!view.data_schema_id && !view.data_schema_rootid) {
      const err = new Error("View has no schema binding (both data_schema_id and data_schema_rootid are null)");
      err.code = "VIEW_NO_SCHEMA_BINDING";
      throw err;
    }

    if (!view.data_schema_id) {
      return {
        view,
        mode: "root_latest",
        schema: await this.schemaService.getLatestSchemaByRootId(
          view.data_schema_rootid
        ),
      };
    }

    const schema = await this.schemaService.getSchemaById(view.data_schema_id);

    return {
      view,
      mode: "fixed_schema",
      schema,
    };
  }

  async renderFixedSchemaView(id, options = {}) {
    const view = await this.getViewById(id);

    if (!view.data_schema_id) {
      const err = new Error("Fixed schema view requires data_schema_id");
      err.code = "VIEW_BINDING_INVALID";
      throw err;
    }

    const schema = await this.schemaService.getSchemaById(view.data_schema_id);

    const rows = await this.dataRepo.listLatestBySchemaId(view.data_schema_id, {
      limit: options.limit,
      offset: options.offset,
    });

    const columns = this.resolveColumns(view.payload, schema.payload);

    return {
      mode: "fixed_schema",
      view,
      schema,
      columns,
      rows: rows.map((row) => ({
        row,
        cells: this.renderPlainCells(row.payload || {}, columns),
      })),
    };
  }

  async renderLatestRootSchemaView(id, options = {}) {
    const view = await this.getViewById(id);

    let schemaRootId = view.data_schema_rootid;

    if (!schemaRootId && view.data_schema_id) {
      const schema = await this.schemaService.getSchemaById(view.data_schema_id);
      schemaRootId = schema._rootid;
    }

    if (!schemaRootId) {
      const err = new Error("Latest root schema view requires data_schema_rootid");
      err.code = "VIEW_BINDING_INVALID";
      throw err;
    }

    const latestSchema = await this.schemaService.getLatestSchemaByRootId(
      schemaRootId
    );

    const rows = await this.dataRepo.listLatestInSchemaFamily(schemaRootId, {
      limit: options.limit,
      offset: options.offset,
    });

    const columns = this.resolveColumns(view.payload, latestSchema.payload);

    const renderedRows = [];

    for (const row of rows) {
      const compared = await this.schemaService.compareRowWithLatestSchema(row);

      renderedRows.push({
        row,
        isLatestSchema: compared.isLatest,
        oldSchema: compared.oldSchema,
        latestSchema: compared.latestSchema,
        cells: this.projectCellsToColumns(compared.cells, columns),
        removed: compared.removed,
        compare: compared.compare,
      });
    }

    return {
      mode: "latest_root_schema",
      view,
      latestSchema,
      columns,
      rows: renderedRows,
    };
  }

  resolveColumns(viewPayload, schemaPayload) {
    const columns = getColumns(viewPayload);

    if (columns.length > 0) {
      return columns.map((col) => {
        const databind = col.databind || col.field || col.name;

        return {
          ...col,
          databind,
        };
      });
    }

    return Object.entries(schemaPayload || {}).map(([fieldName, fieldConfig]) =>
      defaultColumnByField(fieldName, fieldConfig)
    );
  }

  renderPlainCells(payload, columns) {
    const cells = {};

    for (const col of columns) {
      const field = col.databind;
      const hasValue = Object.prototype.hasOwnProperty.call(payload || {}, field);

      cells[field] = {
        field,
        value: hasValue ? payload[field] : null,
        displayValue: hasValue ? payload[field] : "[ไม่มี data]",
        status: hasValue ? "ok" : "missing_data",
        message: hasValue ? null : "[ไม่มี data]",
      };
    }

    return cells;
  }

  projectCellsToColumns(cells, columns) {
    const out = {};

    for (const col of columns) {
      const field = col.databind;

      out[field] =
        cells[field] || {
          field,
          value: null,
          displayValue: "[ไม่มี data]",
          status: "missing_data",
          message: "[ไม่มี data]",
        };
    }

    return out;
  }

  async migrateViewToLatestSchema(rootid, options = {}) {
    const view = await this.getLatestViewByRootId(rootid);

    if (!view.data_schema_id) {
      const err = new Error("View must have data_schema_id to migrate from fixed version");
      err.code = "VIEW_BINDING_INVALID";
      throw err;
    }

    const schemaCompare = await this.schemaService.compareSchemaWithLatest(
      view.data_schema_id
    );

    if (schemaCompare.isLatest) {
      return {
        migrated: false,
        reason: "VIEW_ALREADY_USES_LATEST_SCHEMA",
        view,
        ...schemaCompare,
      };
    }

    const mapped = mapViewPayloadToLatestSchema(
      view.payload || {},
      schemaCompare.compare,
      schemaCompare.latestSchema.payload || {}
    );

    const requiresReview = mapped.warnings.some(
      (w) => w.status === "type_changed" || w.status === "removed_in_latest_schema"
    );

    if (requiresReview && options.force !== true) {
      const err = new Error("View migration requires review");
      err.code = "VIEW_MIGRATION_REQUIRES_REVIEW";
      err.details = {
        warnings: mapped.warnings,
        compare: schemaCompare.compare,
      };
      throw err;
    }

    const newVersion = await this.repo.updateByRootId(rootid, {
      data_schema_id: Number(schemaCompare.latestSchema.id),
      data_schema_rootid: schemaCompare.latestSchema._rootid,
      payload: mapped.payload,
    });

    return {
      migrated: true,
      view: newVersion,
      oldSchema: schemaCompare.oldSchema,
      latestSchema: schemaCompare.latestSchema,
      warnings: mapped.warnings,
      compare: schemaCompare.compare,
    };
  }

  async getViewHistory(rootid, options = {}) {
    return this.repo.getHistory(rootid, options);
  }

  async deleteView(rootid) {
    return this.repo.softDeleteByRootId(rootid);
  }

  async restoreView(versionId) {
    return this.repo.restoreVersion(versionId);
  }
}

module.exports = ViewService;