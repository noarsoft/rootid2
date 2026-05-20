// src/routes/schema.route.js

const express = require("express");
const createSchemaController = require("../controllers/schema.controller");

function createSchemaRoute(db) {
  const router = express.Router();
  const controller = createSchemaController(db);

  router.get("/", controller.listLatest);
  router.post("/", controller.create);

  // rootid operations ต้องมาก่อน /:id
  router.get("/root/:rootid/latest", controller.getLatestByRootId);
  router.get("/root/:rootid/history", controller.getHistory);
  router.patch("/root/:rootid", controller.updateByRootId);
  router.delete("/root/:rootid", controller.deleteByRootId);

  // schema version row
  router.get("/:id", controller.getById);
  router.post("/:id/validate", controller.validatePayload);
  router.get("/:id/compare-latest", controller.compareWithLatest);
  router.post("/:id/restore", controller.restoreVersion);

  return router;
}

module.exports = createSchemaRoute;