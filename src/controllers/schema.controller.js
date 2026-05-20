// src/controllers/schema.controller.js

const SchemaService = require("../services/schema.service");
const {
  getListOptions,
  getHistoryOptions,
  normalizeBool,
} = require("../utils/query-options");

function createSchemaController(db) {
  const schemaService = new SchemaService(db);

  return {
    async create(req, res, next) {
      try {
        const result = await schemaService.createSchema(req.body);

        return res.status(201).json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async updateByRootId(req, res, next) {
      try {
        const { rootid } = req.params;

        const result = await schemaService.updateSchema(rootid, req.body);

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async getById(req, res, next) {
      try {
        const { id } = req.params;

        const result = await schemaService.getSchemaById(id);

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async getLatestByRootId(req, res, next) {
      try {
        const { rootid } = req.params;

        const result = await schemaService.getLatestSchemaByRootId(rootid, {
          includeDeleted: normalizeBool(req.query.includeDeleted),
        });

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async listLatest(req, res, next) {
      try {
        const result = await schemaService.listLatestSchemas({
          ...getListOptions(req.query),
          business_id: req.query.business_id,
        });

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async getHistory(req, res, next) {
      try {
        const { rootid } = req.params;

        const result = await schemaService.getSchemaHistory(
          rootid,
          getHistoryOptions(req.query)
        );

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async deleteByRootId(req, res, next) {
      try {
        const { rootid } = req.params;

        const result = await schemaService.deleteSchema(rootid);

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async restoreVersion(req, res, next) {
      try {
        const { id } = req.params;

        const result = await schemaService.restoreSchema(id);

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async validatePayload(req, res, next) {
      try {
        const { id } = req.params;

        const result = await schemaService.validatePayloadBySchemaId(
          id,
          req.body.payload || req.body,
          {
            allowExtraFields: req.body.allowExtraFields === true,
          }
        );

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async compareWithLatest(req, res, next) {
      try {
        const { id } = req.params;

        const result = await schemaService.compareSchemaWithLatest(id);

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },
  };
}

module.exports = createSchemaController;