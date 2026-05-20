// src/services/form.service.js
// -----------------------------------------------------------------------------
// Form service
//
// ดูแล:
// - form layout/config แบบ versioned object
// - form binding กับ data_schema
// - editor context
// - migrate form controls ไป latest schema
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

function getControls(payload) {
  if (!payload) return [];

  if (Array.isArray(payload.controls)) return payload.controls;
  if (Array.isArray(payload.fields)) return payload.fields;
  if (Array.isArray(payload.items)) return payload.items;

  return [];
}

function setControls(payload, controls) {
  const next = {
    ...(payload || {}),
  };

  if (Array.isArray(payload?.controls)) {
    next.controls = controls;
    return next;
  }

  if (Array.isArray(payload?.fields)) {
    next.fields = controls;
    return next;
  }

  if (Array.isArray(payload?.items)) {
    next.items = controls;
    return next;
  }

  next.controls = controls;
  return next;
}

function defaultControlByType(type) {
  switch (type) {
    case "boolean":
      return "checkbox";

    case "number":
    case "integer":
      return "numberbox";

    case "date":
    case "yyyymmdd":
      return "datebox";

    case "datetime":
    case "yyyymmddhhmmss":
      return "datetimebox";

    case "hhmmss":
      return "timebox";

    case "array":
    case "object":
    case "json":
      return "jsonbox";

    case "string":
    default:
      return "textbox";
  }
}

function mapFormPayloadToLatestSchema(oldPayload, compare, latestSchemaPayload) {
  const oldControls = getControls(oldPayload);
  const nextControls = [];
  const warnings = [];

  const usedFields = new Set();

  for (const control of oldControls) {
    const databind = control.databind || control.field || control.name;

    if (!databind) {
      nextControls.push(control);
      continue;
    }

    usedFields.add(databind);

    const info = compare[databind];

    if (!info) {
      nextControls.push(control);
      continue;
    }

    if (info.status === "ok") {
      nextControls.push({
        ...control,
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

      nextControls.push({
        ...control,
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

      nextControls.push({
        ...control,
        oldType: info.oldType,
        newType: info.latestType,
        status: info.status,
        message: info.message,
        requiresReview: true,
      });

      continue;
    }

    nextControls.push(control);
  }

  for (const [fieldName, latestField] of Object.entries(latestSchemaPayload || {})) {
    if (usedFields.has(fieldName)) continue;

    nextControls.push({
      databind: fieldName,
      label: latestField.label || fieldName,
      control: defaultControlByType(latestField.type),
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
    payload: setControls(oldPayload, nextControls),
    warnings,
  };
}

class FormService {
  constructor(db) {
    this.db = db;
    this.repo = new BaseVersionedRepository(db, "form");
    this.schemaService = new SchemaService(db);
  }

  async createForm(input = {}) {
    if (!input.data_schema_id && !input.data_schema_rootid) {
      const err = new Error("form requires data_schema_id or data_schema_rootid");
      err.code = "FORM_BINDING_INVALID";
      throw err;
    }

    if (input.data_schema_id) {
      await this.schemaService.getSchemaById(input.data_schema_id);
    }

    if (input.data_schema_rootid) {
      await this.schemaService.getLatestSchemaByRootId(input.data_schema_rootid);
    }

    if (!isPlainObject(input.payload || {})) {
      const err = new Error("form payload must be object");
      err.code = "INVALID_OBJECT";
      throw err;
    }

    return this.repo.create({
      data_schema_id: input.data_schema_id ? Number(input.data_schema_id) : null,
      data_schema_rootid: input.data_schema_rootid || null,
      payload: input.payload || {},
    });
  }

  async updateForm(rootid, input = {}) {
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
      const err = new Error("form requires data_schema_id or data_schema_rootid");
      err.code = "FORM_BINDING_INVALID";
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

  async getFormById(id) {
    const form = await this.repo.findById(id);

    if (!form) {
      const err = new Error(`Form not found: ${id}`);
      err.code = "FORM_NOT_FOUND";
      throw err;
    }

    return form;
  }

  async getLatestFormByRootId(rootid, options = {}) {
    const form = await this.repo.getLatestByRootId(rootid, options);

    if (!form) {
      const err = new Error(`Latest form not found: ${rootid}`);
      err.code = "FORM_NOT_FOUND";
      throw err;
    }

    return form;
  }

  async getLatestFormBySchemaRootId(schemaRootId, options = {}) {
    const forms = await this.listLatestFormsBySchemaRootId(schemaRootId, {
      ...options,
      includeDeleted: false,
      limit: 1,
      offset: 0,
    });

    return forms[0] || null;
  }

  async listLatestForms(options = {}) {
    if (options.data_schema_id) {
      return this.listLatestFormsBySchemaId(options.data_schema_id, options);
    }

    if (options.data_schema_rootid) {
      return this.listLatestFormsBySchemaRootId(
        options.data_schema_rootid,
        options
      );
    }

    return this.repo.listLatest(options);
  }

  async listLatestFormsBySchemaId(schemaId, options = {}) {
    return this.repo.listLatestBySchemaId(schemaId, options);
  }

  async listLatestFormsBySchemaRootId(schemaRootId, options = {}) {
    return this.repo.listLatestInSchemaFamily(schemaRootId, options);
  }

  async getFormEditorContext(id) {
    const form = await this.getFormById(id);

    if (!form.data_schema_id && !form.data_schema_rootid) {
      const err = new Error("Form has no schema binding (both data_schema_id and data_schema_rootid are null)");
      err.code = "FORM_NO_SCHEMA_BINDING";
      throw err;
    }

    if (!form.data_schema_id) {
      return {
        form,
        mode: "root_latest",
        schema: await this.schemaService.getLatestSchemaByRootId(
          form.data_schema_rootid
        ),
      };
    }

    const schema = await this.schemaService.getSchemaById(form.data_schema_id);

    return {
      form,
      mode: "fixed_schema",
      schema,
    };
  }

  async migrateFormToLatestSchema(rootid, options = {}) {
    const form = await this.getLatestFormByRootId(rootid);

    if (!form.data_schema_id) {
      const err = new Error("Form must have data_schema_id to migrate from fixed version");
      err.code = "FORM_BINDING_INVALID";
      throw err;
    }

    const schemaCompare = await this.schemaService.compareSchemaWithLatest(
      form.data_schema_id
    );

    if (schemaCompare.isLatest) {
      return {
        migrated: false,
        reason: "FORM_ALREADY_USES_LATEST_SCHEMA",
        form,
        ...schemaCompare,
      };
    }

    const mapped = mapFormPayloadToLatestSchema(
      form.payload || {},
      schemaCompare.compare,
      schemaCompare.latestSchema.payload || {}
    );

    const requiresReview = mapped.warnings.some(
      (w) => w.status === "type_changed" || w.status === "removed_in_latest_schema"
    );

    if (requiresReview && options.force !== true) {
      const err = new Error("Form migration requires review");
      err.code = "FORM_MIGRATION_REQUIRES_REVIEW";
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
      form: newVersion,
      oldSchema: schemaCompare.oldSchema,
      latestSchema: schemaCompare.latestSchema,
      warnings: mapped.warnings,
      compare: schemaCompare.compare,
    };
  }

  async getFormHistory(rootid, options = {}) {
    return this.repo.getHistory(rootid, options);
  }

  async deleteForm(rootid) {
    return this.repo.softDeleteByRootId(rootid);
  }

  async restoreForm(versionId) {
    return this.repo.restoreVersion(versionId);
  }
}

module.exports = FormService;