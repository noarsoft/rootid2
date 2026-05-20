// src/routes/view.route.js

const express = require("express");
const createViewController = require("../controllers/view.controller");

function createViewRoute(db) {
  const router = express.Router();
  const controller = createViewController(db);

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
  router.delete("/root/:rootid", controller.deleteByRootId);

  // migrate view family to latest schema
  router.post("/root/:rootid/migrate-latest-schema", controller.migrateToLatestSchema);

  // fixed version row
  router.get("/:id", controller.getById);

  // editor context uses view.data_schema_id to load original schema
  router.get("/:id/editor-context", controller.getEditorContext);

  // render modes
  router.get("/:id/render-fixed", controller.renderFixedSchemaView);
  router.get("/:id/render-latest-root", controller.renderLatestRootSchemaView);

  router.post("/:id/restore", controller.restoreVersion);

  return router;
}

module.exports = createViewRoute;