// src/utils/query-options.js
// -----------------------------------------------------------------------------
// Shared query option normalizer
//
// ใช้ใน controller เพื่อแปลง req.query ให้เป็น option object กลาง
// repository/engine ยังต้อง guard ซ้ำอีกชั้นเพื่อความปลอดภัย
// -----------------------------------------------------------------------------

const config = require("../config/config");

function normalizeLimit(value, defaultLimit = config.rootid.defaultLimit) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return defaultLimit;
  }

  return Math.min(Math.floor(n), config.rootid.maxLimit);
}

function normalizeOffset(value, defaultOffset = 0) {
  const n = Number(value);

  if (!Number.isFinite(n) || n < 0) {
    return defaultOffset;
  }

  return Math.floor(n);
}

function normalizeOrder(value, defaultOrder = "ASC") {
  const s = String(value || defaultOrder).trim().toUpperCase();

  if (s === "ASC") return "ASC";
  if (s === "DESC") return "DESC";

  return String(defaultOrder).trim().toUpperCase() === "DESC" ? "DESC" : "ASC";
}

function normalizeBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  if (value === true || value === "true" || value === "1" || value === 1) {
    return true;
  }

  if (value === false || value === "false" || value === "0" || value === 0) {
    return false;
  }

  return defaultValue;
}

function getPaginationOptions(query = {}, defaults = {}) {
  return {
    limit: normalizeLimit(query.limit, defaults.limit || config.rootid.defaultLimit),
    offset: normalizeOffset(query.offset, defaults.offset || 0),
  };
}

function getListOptions(query = {}, defaults = {}) {
  return {
    includeDeleted: normalizeBool(
      query.includeDeleted,
      defaults.includeDeleted || false
    ),
    ...getPaginationOptions(query, defaults),
  };
}

function getHistoryOptions(query = {}, defaults = {}) {
  return {
    ...getPaginationOptions(query, defaults),
    order: normalizeOrder(query.order, defaults.order || "ASC"),
  };
}

module.exports = {
  normalizeLimit,
  normalizeOffset,
  normalizeOrder,
  normalizeBool,
  getPaginationOptions,
  getListOptions,
  getHistoryOptions,
};