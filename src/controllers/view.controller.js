// src/controllers/view.controller.js

const ViewService = require("../services/view.service");
const {
  getListOptions,
  getHistoryOptions,
  getPaginationOptions,
  normalizeBool,
} = require("../utils/query-options");

function createViewController(db) {
  const viewService = new ViewService(db);

  return {
    async create(req, res, next) {
      try {
        const result = await viewService.createView(req.body);

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

        const result = await viewService.updateView(rootid, req.body);

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

        const result = await viewService.getViewById(id);

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

        const result = await viewService.getLatestViewByRootId(rootid, {
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
        const result = await viewService.listLatestViews({
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

        const result = await viewService.listLatestViewsBySchemaId(
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

        const result = await viewService.listLatestViewsBySchemaRootId(
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

        const result = await viewService.getViewEditorContext(id);

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async renderFixedSchemaView(req, res, next) {
      try {
        const { id } = req.params;

        const result = await viewService.renderFixedSchemaView(
          id,
          getPaginationOptions(req.query)
        );

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async renderLatestRootSchemaView(req, res, next) {
      try {
        const { id } = req.params;

        const result = await viewService.renderLatestRootSchemaView(
          id,
          getPaginationOptions(req.query)
        );

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

        const result = await viewService.migrateViewToLatestSchema(rootid, {
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

        const result = await viewService.getViewHistory(
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

        const result = await viewService.deleteView(rootid);

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

        const result = await viewService.restoreView(id);

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

module.exports = createViewController;