// src/middlewares/not-found.js
// -----------------------------------------------------------------------------
// 404 handler
// -----------------------------------------------------------------------------

function notFound(req, res) {
  return res.status(404).json({
    ok: false,
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
  });
}

module.exports = notFound;