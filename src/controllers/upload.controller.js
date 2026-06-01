const UploadService = require("../services/upload.service");

function createUploadController(db) {
  const uploadService = new UploadService(db);

  return {
    async initiate(req, res, next) {
      try {
        const result = await uploadService.initiateUpload(req.body, {
          auth: req.auth,
        });

        return res.status(201).json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async uploadPart(req, res, next) {
      try {
        const { uploadId } = req.params;

        const result = await uploadService.uploadPart(uploadId, req.body, {
          auth: req.auth,
        });

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async complete(req, res, next) {
      try {
        const { uploadId } = req.params;

        const result = await uploadService.completeUpload(uploadId, req.body, {
          auth: req.auth,
        });

        return res.json({
          ok: true,
          data: result,
        });
      } catch (err) {
        return next(err);
      }
    },

    async cancel(req, res, next) {
      try {
        const { uploadId } = req.params;

        const result = await uploadService.cancelUpload(uploadId, {
          auth: req.auth,
        });

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

module.exports = createUploadController;
