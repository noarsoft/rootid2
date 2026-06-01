const {
  FIELD_STATUS,
  ALLOWED_FIELD_TYPES,
  isValueTypeValid,
  isValidYyyyMmDd,
  isValidHhMmSs,
  isValidYyyyMmDdHhMmSs,
  normalizeSchemaPayload,
  getFieldType,
  compareSchemaFields,
  validatePayloadAgainstSchema,
  mapPayloadToLatestSchema,
} = require("../schema.service");

const SchemaService = require("../schema.service");

describe("schema.service (pure functions)", () => {
  describe("ALLOWED_FIELD_TYPES", () => {
    test("includes storage types", () => {
      for (const t of ["string", "number", "integer", "boolean", "date", "datetime", "json"]) {
        expect(ALLOWED_FIELD_TYPES.has(t)).toBe(true);
      }
    });

    test("includes control types", () => {
      for (const t of ["select", "dropdown", "toggle", "slider", "rating", "crud", "chartsbar"]) {
        expect(ALLOWED_FIELD_TYPES.has(t)).toBe(true);
      }
    });

    test("rejects unknown types", () => {
      expect(ALLOWED_FIELD_TYPES.has("unknown_type")).toBe(false);
      expect(ALLOWED_FIELD_TYPES.has("")).toBe(false);
    });
  });

  describe("isValidYyyyMmDd", () => {
    test("accepts valid integer dates", () => {
      expect(isValidYyyyMmDd(20260514)).toBe(true);
      expect(isValidYyyyMmDd(20240101)).toBe(true);
    });

    test("accepts valid string dates", () => {
      expect(isValidYyyyMmDd("20260514")).toBe(true);
    });

    test("rejects invalid dates", () => {
      expect(isValidYyyyMmDd(20261301)).toBe(false);
      expect(isValidYyyyMmDd(20260532)).toBe(false);
      expect(isValidYyyyMmDd(null)).toBe(false);
    });
  });

  describe("isValidHhMmSs", () => {
    test("accepts valid times", () => {
      expect(isValidHhMmSs("083045")).toBe(true);
      expect(isValidHhMmSs("000000")).toBe(true);
      expect(isValidHhMmSs("235959")).toBe(true);
    });

    test("rejects invalid times", () => {
      expect(isValidHhMmSs("250000")).toBe(false);
      expect(isValidHhMmSs("006100")).toBe(false);
      expect(isValidHhMmSs(null)).toBe(false);
    });
  });

  describe("isValidYyyyMmDdHhMmSs", () => {
    test("accepts valid compact datetime (number)", () => {
      expect(isValidYyyyMmDdHhMmSs(20260514083045)).toBe(true);
    });

    test("accepts valid compact datetime (string)", () => {
      expect(isValidYyyyMmDdHhMmSs("20260514083045")).toBe(true);
    });

    test("rejects invalid compact datetime", () => {
      expect(isValidYyyyMmDdHhMmSs(20261314083045)).toBe(false);
      expect(isValidYyyyMmDdHhMmSs(null)).toBe(false);
    });
  });

  describe("isValueTypeValid", () => {
    test("null/undefined always valid", () => {
      expect(isValueTypeValid(null, "string")).toBe(true);
      expect(isValueTypeValid(undefined, "number")).toBe(true);
    });

    test("string type", () => {
      expect(isValueTypeValid("hello", "string")).toBe(true);
      expect(isValueTypeValid(123, "string")).toBe(false);
    });

    test("number type", () => {
      expect(isValueTypeValid(42, "number")).toBe(true);
      expect(isValueTypeValid(3.14, "number")).toBe(true);
      expect(isValueTypeValid(Infinity, "number")).toBe(false);
      expect(isValueTypeValid("42", "number")).toBe(false);
    });

    test("integer type", () => {
      expect(isValueTypeValid(42, "integer")).toBe(true);
      expect(isValueTypeValid(3.14, "integer")).toBe(false);
    });

    test("boolean type", () => {
      expect(isValueTypeValid(true, "boolean")).toBe(true);
      expect(isValueTypeValid(false, "boolean")).toBe(true);
      expect(isValueTypeValid("true", "boolean")).toBe(false);
    });

    test("date type", () => {
      expect(isValueTypeValid("2026-05-14", "date")).toBe(true);
      expect(isValueTypeValid("2026-13-14", "date")).toBe(false);
      expect(isValueTypeValid("not-a-date", "date")).toBe(false);
    });

    test("toggle stores boolean", () => {
      expect(isValueTypeValid(true, "toggle")).toBe(true);
      expect(isValueTypeValid("on", "toggle")).toBe(false);
    });

    test("checkbox stores boolean", () => {
      expect(isValueTypeValid(true, "checkbox")).toBe(true);
      expect(isValueTypeValid("checked", "checkbox")).toBe(false);
    });

    test("slider stores number", () => {
      expect(isValueTypeValid(50, "slider")).toBe(true);
      expect(isValueTypeValid("50", "slider")).toBe(false);
    });

    test("select/dropdown stores string or number", () => {
      expect(isValueTypeValid("option1", "select")).toBe(true);
      expect(isValueTypeValid(1, "dropdown")).toBe(true);
      expect(isValueTypeValid(true, "select")).toBe(false);
    });

    test("layout/composite controls accept anything", () => {
      for (const type of ["pagebreak", "crud", "modal", "tabs", "chartsbar"]) {
        expect(isValueTypeValid({ complex: "obj" }, type)).toBe(true);
        expect(isValueTypeValid("string", type)).toBe(true);
        expect(isValueTypeValid(42, type)).toBe(true);
      }
    });

    test("unknown type returns false", () => {
      expect(isValueTypeValid("x", "nonexistent_type")).toBe(false);
    });
  });

  describe("normalizeSchemaPayload", () => {
    test("preserves valid field config with type", () => {
      const input = {
        name: { type: "string", label: "Name", required: true },
      };
      const result = normalizeSchemaPayload(input);
      expect(result.name.type).toBe("string");
      expect(result.name.label).toBe("Name");
      expect(result.name.required).toBe(true);
    });

    test("returns empty object for empty input", () => {
      expect(normalizeSchemaPayload({})).toEqual({});
    });

    test("throws for non-object input", () => {
      expect(() => normalizeSchemaPayload("bad")).toThrow();
      expect(() => normalizeSchemaPayload(null)).toThrow();
    });

    test("throws for invalid field name", () => {
      expect(() => normalizeSchemaPayload({ "bad name!": { type: "string" } })).toThrow();
    });

    test("throws for invalid field type", () => {
      expect(() => normalizeSchemaPayload({ name: { type: "invalid_xyz" } })).toThrow();
    });
  });

  describe("getFieldType", () => {
    test("returns type from schema payload by field name", () => {
      const schema = { name: { type: "string" }, age: { type: "number" } };
      expect(getFieldType(schema, "name")).toBe("string");
      expect(getFieldType(schema, "age")).toBe("number");
    });

    test("returns null for missing field", () => {
      expect(getFieldType({}, "missing")).toBeNull();
      expect(getFieldType(null, "x")).toBeNull();
    });
  });

  describe("compareSchemaFields", () => {
    test("detects OK fields (same in both)", () => {
      const old = { name: { type: "string" } };
      const latest = { name: { type: "string" } };
      const result = compareSchemaFields(old, latest);
      expect(result.name.status).toBe(FIELD_STATUS.OK);
    });

    test("detects new field missing in old schema", () => {
      const old = {};
      const latest = { age: { type: "number" } };
      const result = compareSchemaFields(old, latest);
      expect(result.age.status).toBe(FIELD_STATUS.MISSING_IN_OLD_SCHEMA);
    });

    test("detects removed field", () => {
      const old = { old_field: { type: "string" } };
      const latest = {};
      const result = compareSchemaFields(old, latest);
      expect(result.old_field.status).toBe(FIELD_STATUS.REMOVED_IN_LATEST_SCHEMA);
    });

    test("detects type changes", () => {
      const old = { age: { type: "string" } };
      const latest = { age: { type: "number" } };
      const result = compareSchemaFields(old, latest);
      expect(result.age.status).toBe(FIELD_STATUS.TYPE_CHANGED);
    });
  });

  describe("validatePayloadAgainstSchema", () => {
    test("valid payload passes", () => {
      const schema = { name: { type: "string" }, age: { type: "number" } };
      const payload = { name: "Test", age: 30 };
      const result = validatePayloadAgainstSchema(payload, schema);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("wrong type fails", () => {
      const schema = { age: { type: "number" } };
      const payload = { age: "thirty" };
      const result = validatePayloadAgainstSchema(payload, schema);
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("missing required field fails", () => {
      const schema = { name: { type: "string", required: true } };
      const payload = {};
      const result = validatePayloadAgainstSchema(payload, schema);
      expect(result.ok).toBe(false);
    });

    test("extra fields flagged by default", () => {
      const schema = { name: { type: "string" } };
      const payload = { name: "Test", extra: "oops" };
      const result = validatePayloadAgainstSchema(payload, schema);
      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.code === "EXTRA_FIELD_NOT_IN_SCHEMA")).toBe(true);
    });

    test("extra fields allowed with option", () => {
      const schema = { name: { type: "string" } };
      const payload = { name: "Test", extra: "ok" };
      const result = validatePayloadAgainstSchema(payload, schema, { allowExtraFields: true });
      expect(result.ok).toBe(true);
    });

    test("string field ignores leftover enum metadata", () => {
      const schema = { sex: { type: "string", enum: ["M", "F"] } };
      const payload = { sex: "x" };
      const result = validatePayloadAgainstSchema(payload, schema);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("dropdown field still enforces enum values", () => {
      const schema = { sex: { type: "dropdown", enum: ["M", "F"] } };
      const payload = { sex: "x" };
      const result = validatePayloadAgainstSchema(payload, schema);
      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.code === "INVALID_ENUM_VALUE")).toBe(true);
    });
  });

  describe("mapPayloadToLatestSchema", () => {
    test("carries over matching fields", () => {
      const oldSchema = { name: { type: "string" } };
      const latestSchema = { name: { type: "string" }, age: { type: "number" } };
      const payload = { name: "Test" };
      const result = mapPayloadToLatestSchema(payload, oldSchema, latestSchema);
      expect(result.payload.name).toBe("Test");
    });

    test("drops removed fields from payload", () => {
      const oldSchema = { name: { type: "string" }, old: { type: "string" } };
      const latestSchema = { name: { type: "string" } };
      const payload = { name: "Test", old: "gone" };
      const result = mapPayloadToLatestSchema(payload, oldSchema, latestSchema);
      expect(result.payload).not.toHaveProperty("old");
      expect(result.warnings.some(w => w.status === FIELD_STATUS.REMOVED_IN_LATEST_SCHEMA)).toBe(true);
    });

    test("reports warnings for new fields", () => {
      const oldSchema = {};
      const latestSchema = { newField: { type: "string" } };
      const payload = {};
      const result = mapPayloadToLatestSchema(payload, oldSchema, latestSchema);
      expect(result.warnings.some(w => w.status === FIELD_STATUS.MISSING_IN_OLD_SCHEMA)).toBe(true);
    });
  });

  describe("SchemaService.updateSchema", () => {
    test("updates schema without marking related data rows as history", async () => {
      const db = {
        query: jest.fn(async () => ({ rows: [] })),
      };

      const service = new SchemaService(db);

      service.repo = {
        getLatestOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          _rootid: 100,
          payload: { name: { type: "string" } },
        }),
        updateByRootId: jest.fn().mockResolvedValue({
          id: 2,
          _rootid: 100,
          payload: { name: { type: "string" }, age: { type: "number" } },
        }),
      };

      const markLatestSpy = jest.spyOn(
        service,
        "markLatestDataBySchemaIdAsUpdated"
      );

      const result = await service.updateSchema(100, {
        payload: {
          name: { type: "string" },
          age: { type: "number" },
        },
      });

      expect(service.repo.getLatestOrThrow).not.toHaveBeenCalled();
      expect(service.repo.updateByRootId).toHaveBeenCalledWith(100, {
        payload: {
          name: { type: "string" },
          age: { type: "number" },
        },
      });
      expect(markLatestSpy).not.toHaveBeenCalled();
      expect(result.id).toBe(2);
    });
  });
});
