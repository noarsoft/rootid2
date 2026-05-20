// src/routes/form.route.js

const express = require("express");
const createFormController = require("../controllers/form.controller");

function createFormRoute(db) {
  const router = express.Router();
  const controller = createFormController(db);

  // list/create
  router.get("/", controller.listLatest);
  router.post("/", controller.create);

  // list by schema
  router.get("/schema/:schemaId", controller.listBySchemaId);
  router.get("/schema-root/:schemaRootId/latest", controller.getLatestBySchemaRootId);
  router.get("/schema-root/:schemaRootId", controller.listBySchemaRootId);

  // rootid operations
  router.get("/root/:rootid/latest", controller.getLatestByRootId);
  router.get("/root/:rootid/history", controller.getHistory);
  router.patch("/root/:rootid", controller.updateByRootId);
  router.delete("/root/:rootid", controller.deleteByRootId);

  // migrate form family to latest schema
  router.post("/root/:rootid/migrate-latest-schema", controller.migrateToLatestSchema);

  // fixed version row
  router.get("/:id", controller.getById);

  // editor context uses form.data_schema_id to load original schema
  router.get("/:id/editor-context", controller.getEditorContext);

  router.post("/:id/restore", controller.restoreVersion);

  return router;
}

module.exports = createFormRoute;