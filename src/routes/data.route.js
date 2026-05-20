// src/routes/data.route.js

const express = require("express");
const createDataController = require("../controllers/data.controller");

function createDataRoute(db) {
  const router = express.Router();
  const controller = createDataController(db);

  // list/create
  router.get("/", controller.listLatest);
  router.post("/", controller.create);

  // list by schema
  router.get("/schema/:schemaId", controller.listBySchemaId);
  router.get("/schema-root/:schemaRootId", controller.listBySchemaRootId);

  // rootid operations
  router.get("/root/:rootid/latest", controller.getLatestByRootId);
  router.get("/root/:rootid/history", controller.getHistory);
  router.patch("/root/:rootid", controller.updateByRootId);
  router.post("/root/:rootid/save-latest-schema-version", controller.saveAsLatestSchemaVersion);
  router.delete("/root/:rootid", controller.deleteByRootId);

  // migrate latest data row to latest schema
  router.post("/root/:rootid/migrate-latest-schema", controller.migrateToLatestSchema);

  // fixed version row
  router.get("/:id/edit-context", controller.getEditContext);
  router.get("/:id", controller.getById);
  router.get("/:id/compare-latest-schema", controller.compareWithLatestSchema);
  router.post("/:id/restore", controller.restoreVersion);

  return router;
}

module.exports = createDataRoute;