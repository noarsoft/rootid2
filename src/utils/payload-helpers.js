// utils/payload-helpers.js
// Shared payload utilities for backend services.
// Extracts common patterns from form.service.js and view.service.js
// so new services (e.g. business.service.js) can reuse them.

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertPlainObject(value, label = "value") {
  if (!isPlainObject(value)) {
    const err = new Error(`${label} must be a plain object`);
    err.code = "INVALID_OBJECT";
    throw err;
  }
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function getArrayField(payload, ...keys) {
  if (!isPlainObject(payload)) return [];

  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function getControls(payload) {
  return getArrayField(payload, "controls", "fields", "items");
}

function getColumns(payload) {
  return getArrayField(payload, "columns", "fields", "items");
}

function setControls(payload, controls) {
  if (!isPlainObject(payload)) return { controls };

  return { ...payload, controls };
}

function setColumns(payload, columns) {
  if (!isPlainObject(payload)) return { columns };

  return { ...payload, columns };
}

function defaultControlByTypeForForm(type) {
  switch (type) {
    case "string": return "textbox";
    case "number": return "numberbox";
    case "integer": return "numberbox";
    case "boolean": return "checkbox";
    case "date": return "datepicker";
    case "datetime": return "datepicker";
    case "select": return "select";
    case "dropdown": return "dropdown";
    case "toggle": return "toggle";
    case "slider": return "slider";
    case "rating": return "rating";
    default: return "textbox";
  }
}

function defaultControlByTypeForView(type) {
  switch (type) {
    case "string": return "label";
    case "number": return "number";
    case "integer": return "number";
    case "boolean": return "checkbox";
    case "date": return "label";
    case "datetime": return "label";
    default: return "label";
  }
}

module.exports = {
  isPlainObject,
  assertPlainObject,
  hasOwn,
  getArrayField,
  getControls,
  getColumns,
  setControls,
  setColumns,
  defaultControlByTypeForForm,
  defaultControlByTypeForView,
};
