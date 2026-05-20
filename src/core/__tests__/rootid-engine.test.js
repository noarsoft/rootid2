const {
  FLAG_NORMAL,
  FLAG_DELETED,
  FLAG_UPDATED,
  SYSTEM_FIELDS,
  ALLOWED_TABLES,
  nowYmdHmsNumber,
  newRootId,
  quoteIdent,
  tableIdent,
} = require("../rootid-engine");

describe("rootid-engine", () => {
  describe("constants", () => {
    test("FLAG_NORMAL is empty string", () => {
      expect(FLAG_NORMAL).toBe("");
    });

    test("FLAG_DELETED is 'd'", () => {
      expect(FLAG_DELETED).toBe("d");
    });

    test("FLAG_UPDATED is 'u'", () => {
      expect(FLAG_UPDATED).toBe("u");
    });

    test("SYSTEM_FIELDS contains expected fields", () => {
      const expected = [
        "id", "_rootid", "_prev_id", "_doc_version",
        "_flag", "_transfer_version", "_modify_datetime",
        "created_at", "updated_at",
      ];
      for (const f of expected) {
        expect(SYSTEM_FIELDS.has(f)).toBe(true);
      }
    });

    test("ALLOWED_TABLES has 5 tables", () => {
      expect(ALLOWED_TABLES.size).toBe(5);
      expect(ALLOWED_TABLES.has("business")).toBe(true);
      expect(ALLOWED_TABLES.has("data_schema")).toBe(true);
      expect(ALLOWED_TABLES.has("data")).toBe(true);
      expect(ALLOWED_TABLES.has("form")).toBe(true);
      expect(ALLOWED_TABLES.has("tableview")).toBe(true);
    });
  });

  describe("nowYmdHmsNumber", () => {
    test("returns a 14-digit number", () => {
      const result = nowYmdHmsNumber();
      expect(typeof result).toBe("number");
      expect(String(result)).toMatch(/^\d{14}$/);
    });

    test("returns a plausible timestamp", () => {
      const result = nowYmdHmsNumber();
      const year = Math.floor(result / 10000000000);
      expect(year).toBeGreaterThanOrEqual(2024);
      expect(year).toBeLessThanOrEqual(2100);
    });
  });

  describe("newRootId", () => {
    test("returns a non-empty string", () => {
      const id = newRootId();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    test("generates unique IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => newRootId()));
      expect(ids.size).toBe(100);
    });
  });

  describe("quoteIdent", () => {
    test("wraps valid identifier in double quotes", () => {
      expect(quoteIdent("name")).toBe('"name"');
      expect(quoteIdent("_rootid")).toBe('"_rootid"');
      expect(quoteIdent("data_schema_id")).toBe('"data_schema_id"');
    });

    test("rejects unsafe identifiers", () => {
      expect(() => quoteIdent("DROP TABLE")).toThrow(/Unsafe SQL/);
      expect(() => quoteIdent("1abc")).toThrow(/Unsafe SQL/);
      expect(() => quoteIdent("a;b")).toThrow(/Unsafe SQL/);
      expect(() => quoteIdent("")).toThrow(/Unsafe SQL/);
    });

    test("rejected identifiers have correct error code", () => {
      try {
        quoteIdent("bad identifier");
      } catch (err) {
        expect(err.code).toBe("UNSAFE_SQL_IDENTIFIER");
      }
    });
  });

  describe("tableIdent", () => {
    test("returns quoted table name for allowed tables", () => {
      expect(tableIdent("data_schema")).toBe('"data_schema"');
      expect(tableIdent("data")).toBe('"data"');
      expect(tableIdent("form")).toBe('"form"');
      expect(tableIdent("tableview")).toBe('"tableview"');
    });

    test("rejects disallowed tables", () => {
      expect(() => tableIdent("users")).toThrow(/not allowed/);
      expect(() => tableIdent("admin")).toThrow(/not allowed/);
    });

    test("rejected tables have correct error code", () => {
      try {
        tableIdent("nope");
      } catch (err) {
        expect(err.code).toBe("TABLE_NOT_ALLOWED");
      }
    });
  });
});
