const {
  assertSafeIdent,
  quoteIdent,
  normalizeLimit,
  normalizeOffset,
  parseSortDirection,
  parseOrderBy,
  buildColumnWhere,
  buildPayloadWhere,
  joinWhere,
  buildInsert,
  buildLatestCte,
  normalizeListOptions,
  COMMON_ALLOWED_COLUMNS,
} = require("../sql-builder");

describe("sql-builder", () => {
  describe("assertSafeIdent", () => {
    test("accepts valid identifiers", () => {
      expect(assertSafeIdent("name")).toBe("name");
      expect(assertSafeIdent("_rootid")).toBe("_rootid");
      expect(assertSafeIdent("A1")).toBe("A1");
    });

    test("rejects SQL injection attempts", () => {
      expect(() => assertSafeIdent("DROP TABLE")).toThrow();
      expect(() => assertSafeIdent("a; --")).toThrow();
      expect(() => assertSafeIdent("1abc")).toThrow();
      expect(() => assertSafeIdent("")).toThrow();
    });
  });

  describe("quoteIdent", () => {
    test("wraps in double quotes", () => {
      expect(quoteIdent("field_name")).toBe('"field_name"');
    });
  });

  describe("normalizeLimit", () => {
    test("returns default for invalid input", () => {
      expect(normalizeLimit(undefined)).toBe(100);
      expect(normalizeLimit(null)).toBe(100);
      expect(normalizeLimit("abc")).toBe(100);
      expect(normalizeLimit(-5)).toBe(100);
      expect(normalizeLimit(0)).toBe(100);
    });

    test("clamps to MAX_LIMIT", () => {
      expect(normalizeLimit(5000)).toBe(1000);
      expect(normalizeLimit(1001)).toBe(1000);
    });

    test("passes valid values", () => {
      expect(normalizeLimit(50)).toBe(50);
      expect(normalizeLimit(1)).toBe(1);
      expect(normalizeLimit(1000)).toBe(1000);
    });

    test("floors decimals", () => {
      expect(normalizeLimit(50.9)).toBe(50);
    });

    test("accepts custom default", () => {
      expect(normalizeLimit(undefined, 25)).toBe(25);
    });
  });

  describe("normalizeOffset", () => {
    test("returns 0 for invalid input", () => {
      expect(normalizeOffset(undefined)).toBe(0);
      expect(normalizeOffset(null)).toBe(0);
      expect(normalizeOffset("abc")).toBe(0);
      expect(normalizeOffset(-5)).toBe(0);
    });

    test("passes valid values", () => {
      expect(normalizeOffset(0)).toBe(0);
      expect(normalizeOffset(10)).toBe(10);
      expect(normalizeOffset(100)).toBe(100);
    });
  });

  describe("parseSortDirection", () => {
    test("accepts ASC and DESC", () => {
      expect(parseSortDirection("ASC")).toBe("ASC");
      expect(parseSortDirection("DESC")).toBe("DESC");
      expect(parseSortDirection("asc")).toBe("ASC");
      expect(parseSortDirection("desc")).toBe("DESC");
    });

    test("defaults to DESC", () => {
      expect(parseSortDirection(null)).toBe("DESC");
      expect(parseSortDirection(undefined)).toBe("DESC");
    });

    test("rejects invalid directions", () => {
      expect(() => parseSortDirection("RANDOM")).toThrow(/Invalid sort/);
    });
  });

  describe("parseOrderBy", () => {
    test("allows common columns", () => {
      const result = parseOrderBy("updated_at", "DESC");
      expect(result).toBe('"updated_at" DESC');
    });

    test("defaults to updated_at DESC", () => {
      const result = parseOrderBy(undefined, undefined);
      expect(result).toBe('"updated_at" DESC');
    });

    test("rejects disallowed columns", () => {
      expect(() => parseOrderBy("payload")).toThrow(/not allowed/);
      expect(() => parseOrderBy("evil_col")).toThrow(/not allowed/);
    });
  });

  describe("buildColumnWhere", () => {
    test("builds single equality clause", () => {
      const result = buildColumnWhere({ data_schema_id: 1 });
      expect(result.clauses).toHaveLength(1);
      expect(result.clauses[0]).toContain("$1");
      expect(result.values).toEqual([1]);
    });

    test("builds IS NULL for null values", () => {
      const result = buildColumnWhere({ _prev_id: null }, {
        allowedColumns: COMMON_ALLOWED_COLUMNS,
      });
      expect(result.clauses[0]).toContain("IS NULL");
      expect(result.values).toHaveLength(0);
    });

    test("skips undefined values", () => {
      const result = buildColumnWhere({ data_schema_id: undefined });
      expect(result.clauses).toHaveLength(0);
      expect(result.values).toHaveLength(0);
    });

    test("rejects disallowed columns", () => {
      expect(() => buildColumnWhere({ evil: "x" })).toThrow(/not allowed/);
    });

    test("startIndex offsets placeholders", () => {
      const result = buildColumnWhere({ data_schema_id: 1 }, { startIndex: 3 });
      expect(result.clauses[0]).toContain("$3");
      expect(result.nextIndex).toBe(4);
    });
  });

  describe("buildPayloadWhere", () => {
    test("builds JSONB text equality", () => {
      const result = buildPayloadWhere({ fname: "Test" });
      expect(result.clauses).toHaveLength(1);
      expect(result.clauses[0]).toContain("payload");
      expect(result.values).toEqual(["fname", "Test"]);
    });

    test("handles null payload filter", () => {
      const result = buildPayloadWhere({ fname: null });
      expect(result.clauses).toHaveLength(1);
      expect(result.clauses[0]).toContain("IS NULL");
      expect(result.values).toEqual(["fname"]);
    });

    test("rejects unsafe payload field names", () => {
      expect(() => buildPayloadWhere({ "DROP TABLE": "x" })).toThrow();
    });
  });

  describe("joinWhere", () => {
    test("returns empty string for no clauses", () => {
      expect(joinWhere([])).toBe("");
      expect(joinWhere(null)).toBe("");
    });

    test("joins multiple clauses with AND", () => {
      const result = joinWhere(["a = $1", "b = $2"]);
      expect(result).toBe("WHERE a = $1 AND b = $2");
    });

    test("filters falsy values", () => {
      const result = joinWhere(["a = $1", null, "", "b = $2"]);
      expect(result).toBe("WHERE a = $1 AND b = $2");
    });
  });

  describe("buildInsert", () => {
    test("builds INSERT with RETURNING", () => {
      const result = buildInsert("data", { _rootid: "abc", _doc_version: 1 });
      expect(result.sql).toContain("INSERT INTO");
      expect(result.sql).toContain("RETURNING *");
      expect(result.values).toEqual(["abc", 1]);
    });

    test("rejects empty row", () => {
      expect(() => buildInsert("data", {})).toThrow(/empty row/);
    });

    test("rejects disallowed table", () => {
      expect(() => buildInsert("users", { a: 1 })).toThrow(/not allowed/);
    });
  });

  describe("buildLatestCte", () => {
    test("builds DISTINCT ON _rootid CTE", () => {
      const result = buildLatestCte("data_schema");
      expect(result).toContain("DISTINCT ON (_rootid)");
      expect(result).toContain('"data_schema"');
      expect(result).toContain("_doc_version DESC");
    });

    test("rejects disallowed table", () => {
      expect(() => buildLatestCte("evil")).toThrow(/not allowed/);
    });
  });

  describe("normalizeListOptions", () => {
    test("defaults", () => {
      const result = normalizeListOptions({});
      expect(result.includeDeleted).toBe(false);
      expect(result.limit).toBe(100);
      expect(result.offset).toBe(0);
      expect(result.orderBy).toBe("updated_at");
      expect(result.orderDir).toBe("DESC");
    });

    test("parses includeDeleted string", () => {
      expect(normalizeListOptions({ includeDeleted: "true" }).includeDeleted).toBe(true);
      expect(normalizeListOptions({ includeDeleted: "false" }).includeDeleted).toBe(false);
    });

    test("applies limit and offset", () => {
      const result = normalizeListOptions({ limit: 50, offset: 10 });
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(10);
    });
  });
});
