// src/services/data.service.js
// -----------------------------------------------------------------------------
// Data service
// -----------------------------------------------------------------------------

const BaseVersionedRepository = require("../repositories/base-versioned.repository");
const SchemaService = require("./schema.service");
const FormService = require("./form.service");

const SHARE_MODE = {
  SELF: "self",
  ALL: "all",
  USERS: "users",
};

const SHARE_PERMISSION = {
  READ: "read",
  WRITE: "write",
};

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

  static getAuthUserId(auth = {}) {
    const userId = auth?.user?.id ?? auth?.user?.user_id ?? null;
    const n = Number(userId);

    return Number.isFinite(n) && n > 0 ? n : null;
  }

  static normalizeShareMode(value, defaultMode = SHARE_MODE.SELF) {
    const mode = String(value || defaultMode).trim().toLowerCase();

    if (Object.values(SHARE_MODE).includes(mode)) {
      return mode;
    }

    const err = new Error(`Invalid share_mode: ${value}`);
    err.code = "INVALID_SHARE_MODE";
    err.status = 400;
    throw err;
  }

  static normalizeShareUserIds(value) {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      const err = new Error("share_user_ids must be an array");
      err.code = "INVALID_SHARE_USER_IDS";
      err.status = 400;
      throw err;
    }

    const ids = [];

    for (const item of value) {
      const n = Number(item);

      if (!Number.isFinite(n) || n <= 0) {
        const err = new Error("share_user_ids contains invalid user id");
        err.code = "INVALID_SHARE_USER_IDS";
        err.status = 400;
        throw err;
      }

      ids.push(Math.floor(n));
    }

    return [...new Set(ids)];
  }

  static isRootidAdmin(auth = {}) {
    if (auth?.isAdmin === true) {
      return true;
    }

    const roles = Array.isArray(auth?.roles) ? auth.roles : [];

    return roles.some(
      (role) =>
        role &&
        role.role_code === "admin" &&
        ["rootidx", "rootid2"].includes(role.system_code)
    );
  }

  static assertAuthenticatedForNonAdmin(auth = {}) {
    if (DataService.isRootidAdmin(auth)) {
      return;
    }

    if (!DataService.getAuthUserId(auth)) {
      const err = new Error("Authentication context is required");
      err.code = "AUTH_CONTEXT_REQUIRED";
      err.status = 401;
      throw err;
    }
  }

  static applyOwnerFilter(options = {}, auth = {}) {
    DataService.assertAuthenticatedForNonAdmin(auth);
    return options;
  }

  async loadSharePermissions(dataRootId, authUserId) {
    if (!authUserId || !dataRootId) {
      return new Set();
    }

    const { rows } = await this.db.query(
      `
        SELECT permission
        FROM data_share_user
        WHERE data_rootid = $1
          AND user_id = $2
      `,
      [Number(dataRootId), Number(authUserId)]
    );

    return new Set(rows.map((row) => row.permission));
  }

  async replaceShareUsers(client, dataRootId, shareUsers = [], createdByUserId = null) {
    const users = Array.isArray(shareUsers) ? shareUsers : [];

    await client.query(
      `
        DELETE FROM data_share_user
        WHERE data_rootid = $1
      `,
      [Number(dataRootId)]
    );

    if (users.length === 0) {
      return;
    }

    for (const item of users) {
      const userId = Number(item.user_id);
      const permission = String(item.permission || SHARE_PERMISSION.READ)
        .trim()
        .toLowerCase();

      if (!Number.isFinite(userId) || userId <= 0) {
        const err = new Error("share_users contains invalid user_id");
        err.code = "INVALID_SHARE_USER_IDS";
        err.status = 400;
        throw err;
      }

      if (![SHARE_PERMISSION.READ, SHARE_PERMISSION.WRITE].includes(permission)) {
        const err = new Error("share_users contains invalid permission");
        err.code = "INVALID_SHARE_PERMISSION";
        err.status = 400;
        throw err;
      }

      await client.query(
        `
          INSERT INTO data_share_user (
            data_rootid,
            user_id,
            permission,
            created_by_user_id
          )
          VALUES ($1, $2, $3, $4)
        `,
        [Number(dataRootId), Math.floor(userId), permission, createdByUserId]
      );
    }
  }

  static normalizeShareUsers(input = {}, defaultPermission = SHARE_PERMISSION.READ) {
    if (input.share_users !== undefined) {
      if (!Array.isArray(input.share_users)) {
        const err = new Error("share_users must be an array");
        err.code = "INVALID_SHARE_USERS";
        err.status = 400;
        throw err;
      }

      return input.share_users;
    }

    if (input.share_user_ids !== undefined) {
      const ids = DataService.normalizeShareUserIds(input.share_user_ids);
      return ids.map((id) => ({
        user_id: id,
        permission: defaultPermission,
      }));
    }

    return null;
  }

  async assertCanReadRow(row, auth = {}) {
    if (DataService.isRootidAdmin(auth)) {
      return;
    }

    const authUserId = DataService.getAuthUserId(auth);

    if (!authUserId) {
      const err = new Error("Authentication context is required");
      err.code = "AUTH_CONTEXT_REQUIRED";
      err.status = 401;
      throw err;
    }

    if (row && Number(row.user_id) === authUserId) {
      return;
    }

    const shareMode = DataService.normalizeShareMode(row?.share_mode, SHARE_MODE.SELF);

    if (shareMode === SHARE_MODE.ALL) {
      return;
    }

    if (shareMode === SHARE_MODE.USERS) {
      const permissions = await this.loadSharePermissions(row?._rootid, authUserId);
      if (permissions.has(SHARE_PERMISSION.READ) || permissions.has(SHARE_PERMISSION.WRITE)) {
        return;
      }
    }

    const err = new Error("Permission denied");
    err.code = "DATA_ACCESS_DENIED";
    err.status = 403;
    throw err;
  }

  async assertCanWriteRow(row, auth = {}) {
    if (DataService.isRootidAdmin(auth)) {
      return;
    }

    const authUserId = DataService.getAuthUserId(auth);

    if (!authUserId) {
      const err = new Error("Authentication context is required");
      err.code = "AUTH_CONTEXT_REQUIRED";
      err.status = 401;
      throw err;
    }

    if (row && Number(row.user_id) === authUserId) {
      return;
    }

    const shareMode = DataService.normalizeShareMode(row?.share_mode, SHARE_MODE.SELF);

    if (shareMode === SHARE_MODE.USERS) {
      const permissions = await this.loadSharePermissions(row?._rootid, authUserId);
      if (permissions.has(SHARE_PERMISSION.WRITE)) {
        return;
      }
    }

    const err = new Error("Permission denied");
    err.code = "DATA_ACCESS_DENIED";
    err.status = 403;
    throw err;
  }

  async filterReadableRows(rows = [], auth = {}) {
    if (DataService.isRootidAdmin(auth)) {
      return rows;
    }

    const authUserId = DataService.getAuthUserId(auth);

    if (!authUserId) {
      const err = new Error("Authentication context is required");
      err.code = "AUTH_CONTEXT_REQUIRED";
      err.status = 401;
      throw err;
    }

    const rootidsNeedLookup = [];

    for (const row of rows) {
      if (Number(row?.user_id) === authUserId) continue;

      const shareMode = DataService.normalizeShareMode(row?.share_mode, SHARE_MODE.SELF);
      if (shareMode === SHARE_MODE.USERS) {
        rootidsNeedLookup.push(Number(row?._rootid));
      }
    }

    const readableSharedRootids = new Set();

    if (rootidsNeedLookup.length > 0) {
      const uniqueRootids = [...new Set(rootidsNeedLookup)];

      const { rows: shareRows } = await this.db.query(
        `
          SELECT DISTINCT data_rootid
          FROM data_share_user
          WHERE user_id = $1
            AND permission IN ('read', 'write')
            AND data_rootid = ANY($2::bigint[])
        `,
        [authUserId, uniqueRootids]
      );

      for (const shareRow of shareRows) {
        readableSharedRootids.add(Number(shareRow.data_rootid));
      }
    }

    return rows.filter((row) => {
      if (Number(row?.user_id) === authUserId) {
        return true;
      }

      const shareMode = DataService.normalizeShareMode(row?.share_mode, SHARE_MODE.SELF);

      if (shareMode === SHARE_MODE.ALL) {
        return true;
      }

      if (shareMode === SHARE_MODE.USERS) {
        return readableSharedRootids.has(Number(row?._rootid));
      }

      return false;
    });
  }

  async createData(input = {}, options = {}) {
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

    const authUserId = DataService.getAuthUserId(options.auth);

    if (!authUserId) {
      const err = new Error("Authentication context is required");
      err.code = "AUTH_CONTEXT_REQUIRED";
      err.status = 401;
      throw err;
    }

    const shareMode = DataService.normalizeShareMode(input.share_mode, SHARE_MODE.SELF);
    const shareUsers = DataService.normalizeShareUsers(input);

    if (shareMode !== SHARE_MODE.USERS && Array.isArray(shareUsers) && shareUsers.length > 0) {
      const err = new Error("share users is allowed only when share_mode is users");
      err.code = "INVALID_SHARE_USERS";
      err.status = 400;
      throw err;
    }

    return withTransaction(this.db, async (client) => {
      const txRepo = new BaseVersionedRepository(client, "data");

      const created = await txRepo.create({
        data_schema_id: Number(dataSchemaId),
        payload,
        user_id: authUserId,
        share_mode: shareMode,
      });

      if (shareMode === SHARE_MODE.USERS) {
        await this.replaceShareUsers(
          client,
          created._rootid,
          shareUsers || [],
          authUserId
        );
      }

      return created;
    });
  }

  async updateData(rootid, input = {}, options = {}) {
    const latest = await this.repo.getLatestOrThrow(rootid);

    await this.assertCanWriteRow(latest, options.auth);

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

    const nextShareMode =
      input.share_mode !== undefined
        ? DataService.normalizeShareMode(input.share_mode)
        : DataService.normalizeShareMode(latest.share_mode, SHARE_MODE.SELF);

    const shareUsers = DataService.normalizeShareUsers(input);

    if (nextShareMode !== SHARE_MODE.USERS && Array.isArray(shareUsers) && shareUsers.length > 0) {
      const err = new Error("share users is allowed only when share_mode is users");
      err.code = "INVALID_SHARE_USERS";
      err.status = 400;
      throw err;
    }

    const authUserId = DataService.getAuthUserId(options.auth);

    return withTransaction(this.db, async (client) => {
      const txRepo = new BaseVersionedRepository(client, "data");

      const updated = await txRepo.updateByRootId(rootid, {
        data_schema_id: Number(dataSchemaId),
        payload,
        share_mode: nextShareMode,
      });

      if (nextShareMode === SHARE_MODE.USERS && Array.isArray(shareUsers)) {
        await this.replaceShareUsers(
          client,
          updated._rootid,
          shareUsers,
          authUserId
        );
      }

      if (nextShareMode !== SHARE_MODE.USERS) {
        await this.replaceShareUsers(client, updated._rootid, [], authUserId);
      }

      return updated;
    });
  }

  async saveDataAsLatestSchemaVersion(rootid, input = {}, options = {}) {
    const latest = await this.repo.getLatestOrThrow(rootid);

    await this.assertCanWriteRow(latest, options.auth);

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

  async getDataById(id, options = {}) {
    const data = await this.repo.findById(id);

    if (!data) {
      const err = new Error(`Data not found: ${id}`);
      err.code = "DATA_NOT_FOUND";
      throw err;
    }

    await this.assertCanReadRow(data, options.auth);

    return data;
  }

  async getDataEditContext(id, options = {}) {
    const data = await this.getDataById(id, options);
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

    await this.assertCanReadRow(data, options.auth);

    return data;
  }

  async listLatestData(options = {}) {
    const auth = options.auth || {};

    if (options.data_schema_id) {
      return this.listLatestDataBySchemaId(options.data_schema_id, options);
    }

    if (options.data_schema_rootid) {
      return this.listLatestDataBySchemaRootId(
        options.data_schema_rootid,
        options
      );
    }

    const rows = await this.repo.listLatest(
      DataService.applyOwnerFilter(options, auth)
    );

    return this.filterReadableRows(rows, auth);
  }

  async listLatestDataBySchemaId(schemaId, options = {}) {
    const rows = await this.repo.listLatestBySchemaId(
      schemaId,
      DataService.applyOwnerFilter(options, options.auth)
    );

    return this.filterReadableRows(rows, options.auth || {});
  }

  async listLatestDataBySchemaRootId(schemaRootId, options = {}) {
    const rows = await this.repo.listLatestInSchemaFamily(
      schemaRootId,
      DataService.applyOwnerFilter(options, options.auth)
    );

    return this.filterReadableRows(rows, options.auth || {});
  }

  async getDataHistory(rootid, options = {}) {
    const latest = await this.repo.getLatestByRootId(rootid, {
      includeDeleted: true,
    });

    if (!latest) {
      const err = new Error(`Data not found: ${rootid}`);
      err.code = "DATA_NOT_FOUND";
      throw err;
    }

    await this.assertCanReadRow(latest, options.auth);

    return this.repo.getHistory(rootid, options);
  }

  async deleteData(rootid, options = {}) {
    const latest = await this.repo.getLatestOrThrow(rootid);

    await this.assertCanWriteRow(latest, options.auth);

    return this.repo.softDeleteByRootId(rootid);
  }

  async restoreData(versionId, options = {}) {
    const source = await this.repo.findById(versionId);

    if (!source) {
      const err = new Error(`Version not found: ${versionId}`);
      err.code = "VERSION_NOT_FOUND";
      throw err;
    }

    await this.assertCanWriteRow(source, options.auth);

    return this.repo.restoreVersion(versionId);
  }

  async compareDataWithLatestSchema(id, options = {}) {
    const data = await this.getDataById(id, options);
    return this.schemaService.compareRowWithLatestSchema(data);
  }

  async migrateDataToLatestSchema(rootid, options = {}) {
    const latestData = await this.getLatestDataByRootId(rootid, {
      includeDeleted: false,
      auth: options.auth,
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