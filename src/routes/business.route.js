// src/routes/business.route.js

const express = require("express");
const createBusinessController = require("../controllers/business.controller");

function createBusinessRoute(db) {
  const router = express.Router();
  const controller = createBusinessController(db);

  router.get("/", controller.listLatest);
  router.post("/", controller.create);

  router.get("/root/:rootid/latest", controller.getLatestByRootId);
  router.get("/root/:rootid/history", controller.getHistory);
  router.patch("/root/:rootid", controller.updateByRootId);
  router.delete("/root/:rootid", controller.deleteByRootId);

  router.get("/:id", controller.getById);

  return router;
}

module.exports = createBusinessRoute;
