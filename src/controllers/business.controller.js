// src/controllers/business.controller.js

const BusinessService = require("../services/business.service");
const {
  getListOptions,
  getHistoryOptions,
  normalizeBool,
} = require("../utils/query-options");

function createBusinessController(db) {
  const service = new BusinessService(db);

  return {
    async create(req, res, next) {
      try {
        const result = await service.createBusiness(req.body);
        return res.status(201).json({ ok: true, data: result });
      } catch (err) {
        return next(err);
      }
    },

    async updateByRootId(req, res, next) {
      try {
        const { rootid } = req.params;
        const result = await service.updateBusiness(rootid, req.body);
        return res.json({ ok: true, data: result });
      } catch (err) {
        return next(err);
      }
    },

    async getById(req, res, next) {
      try {
        const { id } = req.params;
        const result = await service.getBusinessById(id);
        if (!result) {
          return res.status(404).json({ ok: false, error: "Business not found" });
        }
        return res.json({ ok: true, data: result });
      } catch (err) {
        return next(err);
      }
    },

    async getLatestByRootId(req, res, next) {
      try {
        const { rootid } = req.params;

        const result = await service.getLatestByRootId(rootid, {
          includeDeleted: normalizeBool(req.query.includeDeleted),
        });

        return res.json({ ok: true, data: result });
      } catch (err) {
        return next(err);
      }
    },

    async listLatest(req, res, next) {
      try {
        const result = await service.listLatest(getListOptions(req.query));
        return res.json({ ok: true, data: result });
      } catch (err) {
        return next(err);
      }
    },

    async getHistory(req, res, next) {
      try {
        const { rootid } = req.params;

        const result = await service.getHistory(
          rootid,
          getHistoryOptions(req.query)
        );

        return res.json({ ok: true, data: result });
      } catch (err) {
        return next(err);
      }
    },

    async deleteByRootId(req, res, next) {
      try {
        const { rootid } = req.params;
        const result = await service.deleteBusiness(rootid);
        return res.json({ ok: true, data: result });
      } catch (err) {
        return next(err);
      }
    },
  };
}

module.exports = createBusinessController;