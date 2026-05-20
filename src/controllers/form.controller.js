// src/controllers/form.controller.js

const FormService = require("../services/form.service");
const {
  getListOptions,
  getHistoryOptions,
  normalizeBool,
} = require("../utils/query-options");

function createFormController(db) {
  const formService = new FormService(db);

  return {
    async create(req, res, next) {
      try {
        const result = await formService.createForm(req.body);

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

        const result = await formService.updateForm(rootid, req.body);

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

        const result = await formService.getFormById(id);

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

        const result = await formService.getLatestFormByRootId(rootid, {
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

    async getLatestBySchemaRootId(req, res, next) {
      try {
        const { schemaRootId } = req.params;

        const result = await formService.getLatestFormBySchemaRootId(
          schemaRootId,
          getListOptions(req.query)
        );

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
        const result = await formService.listLatestForms({
          ...getListOptions(req.query),
          data_schema_id: req.query.data_schema_id,
          data_schema_rootid: req.query.data_schema_rootid,
        });

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async listBySchemaId(req, res, next) {
      try {
        const { schemaId } = req.params;

        const result = await formService.listLatestFormsBySchemaId(
          schemaId,
          getListOptions(req.query)
        );

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async listBySchemaRootId(req, res, next) {
      try {
        const { schemaRootId } = req.params;

        const result = await formService.listLatestFormsBySchemaRootId(
          schemaRootId,
          getListOptions(req.query)
        );

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async getEditorContext(req, res, next) {
      try {
        const { id } = req.params;

        const result = await formService.getFormEditorContext(id);

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async migrateToLatestSchema(req, res, next) {
      try {
        const { rootid } = req.params;

        const result = await formService.migrateFormToLatestSchema(rootid, {
          force: req.body.force === true,
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

        const result = await formService.getFormHistory(
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

        const result = await formService.deleteForm(rootid);

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

        const result = await formService.restoreForm(id);

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

module.exports = createFormController;