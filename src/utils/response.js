// src/utils/response.js
// -----------------------------------------------------------------------------
// Standard API response helpers
// -----------------------------------------------------------------------------

const config = require("../config/config");

function success(res, data = null, options = {}) {
  const status = options.status || 200;

  const body = {
    ok: true,
    data,
  };

  if (options.message) {
    body.message = options.message;
  }

  if (options.meta) {
    body.meta = options.meta;
  }

  return res.status(status).json(body);
}

function created(res, data = null, options = {}) {
  return success(res, data, {
    ...options,
    status: 201,
  });
}

function noContent(res) {
  return res.status(204).send();
}

function fail(res, error = {}, options = {}) {
  const status = options.status || error.status || error.statusCode || 500;

  const body = {
    ok: false,
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: error.message || "Internal server error",
    },
  };

  if (error.field) {
    body.error.field = error.field;
  }

  if (error.details) {
    body.error.details = error.details;
  }

  if (error.errors) {
    body.error.errors = error.errors;
  }

  if (options.meta) {
    body.meta = options.meta;
  }

  return res.status(status).json(body);
}

function paginationMeta(options = {}) {
  const limit = Number(options.limit || config.rootid.defaultLimit);
  const offset = Number(options.offset || 0);
  const count = Number(options.count || 0);

  return {
    limit,
    offset,
    count,
    hasMore: count >= limit,
  };
}

module.exports = {
  success,
  created,
  noContent,
  fail,
  paginationMeta,
};