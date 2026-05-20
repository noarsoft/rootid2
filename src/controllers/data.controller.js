// src/controllers/data.controller.js

const DataService = require("../services/data.service");
const {
  getListOptions,
  getHistoryOptions,
  normalizeBool,
} = require("../utils/query-options");

function createDataController(db) {
  const dataService = new DataService(db);

  return {
    async create(req, res, next) {
      try {
        const result = await dataService.createData(req.body);

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

        const result = await dataService.updateData(rootid, req.body);

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

        const result = await dataService.getDataById(id);

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async getEditContext(req, res, next) {
      try {
        const { id } = req.params;

        const result = await dataService.getDataEditContext(id);

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

        const result = await dataService.getLatestDataByRootId(rootid, {
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
        const result = await dataService.listLatestData({
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

        const result = await dataService.listLatestDataBySchemaId(
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

        const result = await dataService.listLatestDataBySchemaRootId(
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

    async getHistory(req, res, next) {
      try {
        const { rootid } = req.params;

        const result = await dataService.getDataHistory(
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

        const result = await dataService.deleteData(rootid);

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

        const result = await dataService.restoreData(id);

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async compareWithLatestSchema(req, res, next) {
      try {
        const { id } = req.params;

        const result = await dataService.compareDataWithLatestSchema(id);

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

        const result = await dataService.migrateDataToLatestSchema(rootid, {
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

    async saveAsLatestSchemaVersion(req, res, next) {
      try {
        const { rootid } = req.params;

        const result = await dataService.saveDataAsLatestSchemaVersion(
          rootid,
          req.body,
          {
            force: req.body.force === true,
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
  };
}

module.exports = createDataController;