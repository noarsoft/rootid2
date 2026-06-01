const express = require("express");
const createUploadController = require("../controllers/upload.controller");

function createUploadRoute(db) {
  const router = express.Router();
  const controller = createUploadController(db);

  router.post("/initiate", controller.initiate);
  router.post("/:uploadId/part", controller.uploadPart);
  router.post("/:uploadId/complete", controller.complete);
  router.delete("/:uploadId", controller.cancel);

  return router;
}

module.exports = createUploadRoute;
