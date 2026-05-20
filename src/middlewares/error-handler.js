// src/middlewares/error-handler.js
// -----------------------------------------------------------------------------
// Central error handler
// -----------------------------------------------------------------------------

function getStatusFromErrorCode(code) {
  switch (code) {
    // 400 Bad Request
    case "INVALID_OBJECT":
    case "INVALID_FLAG":
    case "INVALID_SCHEMA_FIELD_NAME":
    case "INVALID_SCHEMA_FIELD_CONFIG":
    case "INVALID_SCHEMA_FIELD_TYPE":
    case "INVALID_FIELD_TYPE":
    case "INVALID_ENUM_VALUE":
    case "REQUIRED_FIELD_MISSING":
    case "EXTRA_FIELD_NOT_IN_SCHEMA":
    case "PAYLOAD_SCHEMA_INVALID":
    case "SCHEMA_NAME_REQUIRED":
    case "DATA_SCHEMA_ID_REQUIRED":
    case "DATA_SCHEMA_ROOTID_REQUIRED":
    case "ROOTID_REQUIRED":
    case "ID_REQUIRED":
    case "CREATE_FLAG_NOT_ALLOWED":
    case "IMMUTABLE_FIELD":
    case "ORDER_BY_NOT_ALLOWED":
    case "COLUMN_FILTER_NOT_ALLOWED":
    case "UNSAFE_PAYLOAD_FIELD":
    case "INVALID_SORT_DIRECTION":
    case "INVALID_REPOSITORY_METHOD":
      return 400;

    // 403 Forbidden
    case "TABLE_NOT_ALLOWED":
    case "UNSAFE_SQL_IDENTIFIER":
      return 403;

    // 404 Not Found
    case "OBJECT_NOT_FOUND":
    case "LATEST_NOT_FOUND":
    case "VERSION_NOT_FOUND":
    case "RESTORE_SOURCE_NOT_FOUND":
    case "SCHEMA_NOT_FOUND":
    case "DATA_NOT_FOUND":
    case "FORM_NOT_FOUND":
    case "VIEW_NOT_FOUND":
      return 404;

    // 409 Conflict
    case "OBJECT_ALREADY_DELETED":
    case "CANNOT_UPDATE_DELETED_OBJECT":
    case "CANNOT_EDIT_DELETED_OBJECT":
    case "CANNOT_RESTORE_FROM_DELETED_VERSION":
    case "CANNOT_MIGRATE_DELETED_SCHEMA":
    case "VIEW_BINDING_INVALID":
    case "FORM_BINDING_INVALID":
    case "FIELD_REMOVED_IN_LATEST_SCHEMA":
    case "FIELD_NOT_IN_OLD_SCHEMA":
    case "FIELD_TYPE_CHANGED":
      return 409;

    // 422 Unprocessable Entity
    case "SCHEMA_COMPARE_FAILED":
    case "MIGRATION_REQUIRES_REVIEW":
    case "DATA_MIGRATION_REQUIRES_REVIEW":
    case "FORM_MIGRATION_REQUIRES_REVIEW":
    case "VIEW_MIGRATION_REQUIRES_REVIEW":
      return 422;

    default:
      return 500;
  }
}

function normalizePgError(err) {
  // PostgreSQL error codes:
  // 23503 = foreign_key_violation
  // 23505 = unique_violation
  // 23514 = check_violation
  // 22P02 = invalid_text_representation
  // 42703 = undefined_column
  // 42P01 = undefined_table

  if (!err || !err.code) return null;

  switch (err.code) {
    case "23503":
      return {
        status: 400,
        code: "FOREIGN_KEY_VIOLATION",
        message: "Referenced record does not exist",
      };

    case "23505":
      return {
        status: 409,
        code: "UNIQUE_VIOLATION",
        message: "Duplicate record",
      };

    case "23514":
      return {
        status: 400,
        code: "CHECK_VIOLATION",
        message: "Database check constraint failed",
      };

    case "22P02":
      return {
        status: 400,
        code: "INVALID_INPUT_SYNTAX",
        message: "Invalid input syntax",
      };

    case "42703":
      return {
        status: 500,
        code: "UNDEFINED_COLUMN",
        message: "Database column is missing",
      };

    case "42P01":
      return {
        status: 500,
        code: "UNDEFINED_TABLE",
        message: "Database table is missing",
      };

    default:
      return null;
  }
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const pgError = normalizePgError(err);

  const status =
    err.status ||
    err.statusCode ||
    (pgError ? pgError.status : null) ||
    getStatusFromErrorCode(err.code);

  const code =
    err.appCode ||
    (pgError ? pgError.code : null) ||
    err.code ||
    "INTERNAL_ERROR";

  const message =
    err.publicMessage ||
    (pgError ? pgError.message : null) ||
    err.message ||
    "Internal server error";

  const response = {
    ok: false,
    error: {
      code,
      message,
    },
  };

  if (err.field) {
    response.error.field = err.field;
  }

  if (err.details) {
    response.error.details = err.details;
  }

  if (err.errors) {
    response.error.errors = err.errors;
  }

  if (process.env.NODE_ENV !== "production") {
    response.error.debug = {
      originalCode: err.code,
      stack: err.stack,
    };
  }

  if (status >= 500) {
    console.error("[error-handler]", err);
  }

  return res.status(status).json(response);
}

module.exports = errorHandler;