// src/services/data.service.js
// -----------------------------------------------------------------------------
// Data service
// -----------------------------------------------------------------------------

const BaseVersionedRepository = require("../repositories/base-versioned.repository");
const SchemaService = require("./schema.service");
const FormService = require("./form.service");

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

class DataService {
  constructor(db) {
    this.db = db;
    this.repo = new BaseVersionedRepository(db, "data");
    this.schemaService = new SchemaService(db);
    this.formService = new FormService(db);
  }

  async createData(input = {}) {
    const dataSchemaId = input.data_schema_id;

    if (!dataSchemaId) {
      const err = new Error("data_schema_id is required");
      err.code = "DATA_SCHEMA_ID_REQUIRED";
      throw err;
    }

    const payload = input.payload || {};

    const validation = await this.schemaService.validatePayloadBySchemaId(
      dataSchemaId,
      payload,
      {
        allowExtraFields: input.allowExtraFields === true,
      }
    );

    if (!validation.ok) {
      const err = new Error("Payload is invalid against schema");
      err.code = "PAYLOAD_SCHEMA_INVALID";
      err.errors = validation.errors;
      throw err;
    }

    return this.repo.create({
      data_schema_id: Number(dataSchemaId),
      payload,
    });
  }

  async updateData(rootid, input = {}) {
    const latest = await this.repo.getLatestOrThrow(rootid);

    const dataSchemaId = input.data_schema_id || latest.data_schema_id;
    const payload =
      input.payload !== undefined
        ? {
            ...(latest.payload || {}),
            ...(input.payload || {}),
          }
        : latest.payload || {};

    const validation = await this.schemaService.validatePayloadBySchemaId(
      dataSchemaId,
      payload,
      {
        allowExtraFields: input.allowExtraFields === true,
      }
    );

    if (!validation.ok) {
      const err = new Error("Payload is invalid against schema");
      err.code = "PAYLOAD_SCHEMA_INVALID";
      err.errors = validation.errors;
      throw err;
    }

    return this.repo.updateByRootId(rootid, {
      data_schema_id: Number(dataSchemaId),
      payload,
    });
  }

  async saveDataAsLatestSchemaVersion(rootid, input = {}, options = {}) {
    const latest = await this.repo.getLatestOrThrow(rootid);

    const sourcePayload =
      input.payload !== undefined
        ? {
            ...(latest.payload || {}),
            ...(input.payload || {}),
          }
        : latest.payload || {};

    const sourceValidation = await this.schemaService.validatePayloadBySchemaId(
      latest.data_schema_id,
      sourcePayload,
      {
        allowExtraFields: input.allowExtraFields === true,
      }
    );

    if (!sourceValidation.ok) {
      const err = new Error("Payload is invalid against source schema");
      err.code = "PAYLOAD_SCHEMA_INVALID";
      err.errors = sourceValidation.errors;
      throw err;
    }

    const mapped = await this.schemaService.mapPayloadToLatestSchema(
      latest.data_schema_id,
      sourcePayload
    );

    const requiresReview = mapped.warnings.some(
      (warning) => warning.status === "type_changed"
    );

    if (requiresReview && options.force !== true) {
      const err = new Error("Data migration requires review");
      err.code = "DATA_MIGRATION_REQUIRES_REVIEW";
      err.details = {
        warnings: mapped.warnings,
        compare: mapped.compare,
      };
      throw err;
    }

    if (!mapped.isLatest) {
      const targetValidation = await this.schemaService.validatePayloadBySchemaId(
        mapped.latestSchema.id,
        mapped.payload,
        {
          allowExtraFields: false,
        }
      );

      if (!targetValidation.ok) {
        const err = new Error("Mapped payload is invalid against latest schema");
        err.code = "PAYLOAD_SCHEMA_INVALID";
        err.errors = targetValidation.errors;
        throw err;
      }
    }

    return this.repo.updateByRootId(rootid, {
      data_schema_id: Number(mapped.latestSchema.id),
      payload: mapped.payload,
    });
  }

  async getDataById(id) {
    const data = await this.repo.findById(id);

    if (!data) {
      const err = new Error(`Data not found: ${id}`);
      err.code = "DATA_NOT_FOUND";
      throw err;
    }

    return data;
  }

  async getDataEditContext(id) {
    const data = await this.getDataById(id);
    const compared = await this.schemaService.compareRowWithLatestSchema(data);

    const latestForm = await this.formService.getLatestFormBySchemaRootId(
      compared.latestSchema._rootid,
      {
        includeDeleted: false,
        limit: 1,
        offset: 0,
      }
    );

    return {
      mode: "edit_data_version_with_latest_form",
      data,
      oldSchema: compared.oldSchema,
      latestSchema: compared.latestSchema,
      latestForm,
      isLatestSchema: compared.isLatest,
      cells: compared.cells,
      removed: compared.removed,
      compare: compared.compare,
    };
  }

  async getLatestDataByRootId(rootid, options = {}) {
    const data = await this.repo.getLatestByRootId(rootid, options);

    if (!data) {
      const err = new Error(`Latest data not found: ${rootid}`);
      err.code = "DATA_NOT_FOUND";
      throw err;
    }

    return data;
  }

  async listLatestData(options = {}) {
    if (options.data_schema_id) {
      return this.listLatestDataBySchemaId(options.data_schema_id, options);
    }

    if (options.data_schema_rootid) {
      return this.listLatestDataBySchemaRootId(
        options.data_schema_rootid,
        options
      );
    }

    return this.repo.listLatest(options);
  }

  async listLatestDataBySchemaId(schemaId, options = {}) {
    return this.repo.listLatestBySchemaId(schemaId, options);
  }

  async listLatestDataBySchemaRootId(schemaRootId, options = {}) {
    return this.repo.listLatestInSchemaFamily(schemaRootId, options);
  }

  async getDataHistory(rootid, options = {}) {
    return this.repo.getHistory(rootid, options);
  }

  async deleteData(rootid) {
    return this.repo.softDeleteByRootId(rootid);
  }

  async restoreData(versionId) {
    return this.repo.restoreVersion(versionId);
  }

  async compareDataWithLatestSchema(id) {
    const data = await this.getDataById(id);
    return this.schemaService.compareRowWithLatestSchema(data);
  }

  async migrateDataToLatestSchema(rootid, options = {}) {
    const latestData = await this.getLatestDataByRootId(rootid, {
      includeDeleted: false,
    });

    const mapped = await this.schemaService.mapPayloadToLatestSchema(
      latestData.data_schema_id,
      latestData.payload || {}
    );

    if (mapped.isLatest) {
      return {
        migrated: false,
        reason: "DATA_ALREADY_USES_LATEST_SCHEMA",
        data: latestData,
        ...mapped,
      };
    }

    const requiresReview = mapped.warnings.some(
      (w) => w.status === "type_changed"
    );

    if (requiresReview && options.force !== true) {
      const err = new Error("Data migration requires review");
      err.code = "DATA_MIGRATION_REQUIRES_REVIEW";
      err.details = {
        warnings: mapped.warnings,
        compare: mapped.compare,
      };
      throw err;
    }

    const newVersion = await withTransaction(this.db, async (client) => {
      const txRepo = new BaseVersionedRepository(client, "data");

      await txRepo.updateByRootId(rootid, {}, { flag: "u" });

      return txRepo.updateByRootId(rootid, {
        data_schema_id: Number(mapped.latestSchema.id),
        payload: mapped.payload,
      });
    });

    return {
      migrated: true,
      data: newVersion,
      oldSchema: mapped.oldSchema,
      latestSchema: mapped.latestSchema,
      warnings: mapped.warnings,
      compare: mapped.compare,
    };
  }
}

module.exports = DataService;