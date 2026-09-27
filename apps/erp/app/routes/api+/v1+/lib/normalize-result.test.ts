import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { SERVICE_RULE_ERROR_CODE } from "~/utils/supabase";
import {
  classifyDatabaseFailure,
  isServiceRuleError,
  publicDatabaseError
} from "./database-errors";
import {
  classifyServiceError,
  normalizeServiceResult,
  toWireValue
} from "./normalize-result.server";

// The dispatcher reads a service result by the shape the generator recorded
// (scripts/lib/result-shape.ts), and a returned failure keeps the message the
// service wrote unless it is a real database failure.

function thrown(fn: () => unknown): ORPCError<string, unknown> {
  try {
    fn();
  } catch (err) {
    if (err instanceof ORPCError) return err;
    throw err;
  }
  throw new Error("expected a throw");
}

/** What `callOperation` shows a caller for a thrown service failure. */
function callerMessage(err: ORPCError<string, unknown>): string {
  const supabase = (err.data as { supabase?: unknown }).supabase;
  if (isServiceRuleError(supabase)) return supabase.message;
  return publicDatabaseError(supabase as never);
}

const postgrestNotFound = {
  code: "PGRST116",
  message: "JSON object requested, multiple (or no) rows returned",
  details: "The result contains 0 rows",
  hint: null
};

describe("normalizeServiceResult — envelope", () => {
  const meta = { resultShape: "envelope" as const };

  it("returns data and count", () => {
    expect(
      normalizeServiceResult(meta, {
        data: [{ id: "a" }],
        error: null,
        count: 7
      })
    ).toEqual({ data: [{ id: "a" }], count: 7 });
  });

  it("returns a { data, count } read (no error key) as a list", () => {
    expect(normalizeServiceResult(meta, { data: [1, 2], count: 2 })).toEqual({
      data: [1, 2],
      count: 2
    });
  });

  it("keeps a PostgrestError database-classified", () => {
    const err = thrown(() =>
      normalizeServiceResult(meta, { data: null, error: postgrestNotFound })
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(classifyDatabaseFailure((err.data as any).supabase)).toBe(
      "notFound"
    );
    expect(callerMessage(err)).toBe(
      "Database error: no matching record was found."
    );
  });

  it("keeps a ruleError message as written", () => {
    const err = thrown(() =>
      normalizeServiceResult(meta, {
        data: null,
        error: { code: SERVICE_RULE_ERROR_CODE, message: "Steps already exist" }
      })
    );
    expect(callerMessage(err)).toBe("Steps already exist");
  });

  it("turns a string error into a rule message, not a generic database error", () => {
    const err = thrown(() =>
      normalizeServiceResult(meta, {
        data: null,
        error: "This instruction has no model"
      })
    );
    expect(callerMessage(err)).toBe("This instruction has no model");
    expect(err.message).toBe("This instruction has no model");
  });

  it("turns a code-less { message } into a rule message", () => {
    const err = thrown(() =>
      normalizeServiceResult(meta, {
        data: null,
        error: {
          message: "Select a shipping revenue account distinct from Sales"
        }
      })
    );
    expect(callerMessage(err)).toBe(
      "Select a shipping revenue account distinct from Sales"
    );
  });

  it("keeps a coded pg/Kysely error database-classified", () => {
    const pgError = Object.assign(new Error("insert violates fk"), {
      code: "23503"
    });
    const err = thrown(() =>
      normalizeServiceResult(meta, { data: null, error: pgError })
    );
    expect(callerMessage(err)).toBe(
      "Database error: the operation would violate a reference between records."
    );
  });

  it("keeps a functions/storage error database-classified", () => {
    expect(
      classifyServiceError({
        name: "FunctionsHttpError",
        message: "Edge failed"
      })
    ).toEqual({ name: "FunctionsHttpError", message: "Edge failed" });
    expect(
      isServiceRuleError(
        classifyServiceError({ name: "StorageApiError", message: "denied" })
      )
    ).toBe(false);
  });

  it("drops envelope extras (cta, hasMore) — they never reached callers", () => {
    expect(
      normalizeServiceResult(meta, {
        data: [1],
        error: null,
        count: 1,
        hasMore: false
      })
    ).toEqual({ data: [1], count: 1 });
  });
});

describe("normalizeServiceResult — envelope-array", () => {
  const meta = { resultShape: "envelope-array" as const };

  it("throws when ANY element failed, not only the first", () => {
    const err = thrown(() =>
      normalizeServiceResult(meta, [
        { data: null, error: null, status: 204 },
        { data: null, error: { code: "23503", message: "fk" }, status: 409 }
      ])
    );
    expect(callerMessage(err)).toBe(
      "Database error: the operation would violate a reference between records."
    );
  });

  it("returns each element's data when every element succeeded", () => {
    expect(
      normalizeServiceResult(meta, [
        { data: [{ id: "a" }], error: null, status: 200 },
        { data: null, error: null, status: 204, statusText: "No Content" }
      ])
    ).toEqual({ data: [[{ id: "a" }], null] });
  });
});

describe("normalizeServiceResult — plain, void, unknown", () => {
  it("returns a plain value whole, even when it has a data key", () => {
    const value = { data: 1, total: 2 };
    expect(normalizeServiceResult({ resultShape: "plain" }, value)).toEqual({
      data: value
    });
  });

  it("returns undefined for void", () => {
    expect(normalizeServiceResult({ resultShape: "void" }, undefined)).toEqual({
      data: undefined
    });
  });

  it("falls back to the legacy data-key unwrap for unknown shapes", () => {
    expect(
      normalizeServiceResult({}, { data: { id: "x" }, error: null })
    ).toEqual({ data: { id: "x" }, count: undefined });
    const err = thrown(() =>
      normalizeServiceResult(
        { resultShape: "unknown" },
        { data: null, error: postgrestNotFound }
      )
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(normalizeServiceResult({}, [1, 2])).toEqual({ data: [1, 2] });
  });
});

describe("toWireValue — the HTTP serializer's rules", () => {
  it("serializes a Map as its entries and a Set as an array", () => {
    const value = {
      byItem: new Map([["item_1", { leadTime: 3 }]]),
      tags: new Set(["a", "b"])
    };
    expect(toWireValue(value)).toEqual({
      byItem: [["item_1", { leadTime: 3 }]],
      tags: ["a", "b"]
    });
    expect(JSON.stringify(toWireValue(new Map([["k", 1]])))).toBe('[["k",1]]');
  });

  it("serializes a bigint as its decimal string", () => {
    expect(toWireValue({ numDeletedRows: 3n })).toEqual({
      numDeletedRows: "3"
    });
  });

  it("returns the same reference when nothing needs converting", () => {
    const rows = [{ id: "a", nested: { n: 1 } }];
    expect(toWireValue(rows)).toBe(rows);
  });

  it("applies inside an envelope's data", () => {
    expect(
      normalizeServiceResult(
        { resultShape: "plain" },
        new Map([["item_1", { readableId: "P-1" }]])
      )
    ).toEqual({ data: [["item_1", { readableId: "P-1" }]] });
  });
});
