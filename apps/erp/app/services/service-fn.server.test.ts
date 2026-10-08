// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn() })
}));

import {
  CarbonError,
  createServiceContext,
  defineServiceFn
} from "./service-fn.server";

// Stands in for Kysely's transaction: it commits when the body resolves and
// rolls back when it throws, which is all `ctx.transaction` relies on.
function database() {
  const outcomes: ("commit" | "rollback")[] = [];
  const trx = { isTransaction: true };
  const pg = {
    isTransaction: false,
    transaction: () => ({
      execute: async (body: (trx: unknown) => Promise<unknown>) => {
        try {
          const value = await body(trx);
          outcomes.push("commit");
          return value;
        } catch (err) {
          outcomes.push("rollback");
          throw err;
        }
      }
    })
  };
  return { pg, trx, outcomes };
}

const contextWith = (pg: unknown) =>
  createServiceContext({
    actor: { type: "apiKey", createdBy: "user-1" },
    company: { id: "company-1", groupId: "group-1" },
    caller: {} as never,
    system: () => ({}) as never,
    pg: () => pg as never,
    kv: () => ({}) as never
  });

const ctx = contextWith({});

describe("defineServiceFn", () => {
  const divide = defineServiceFn({
    input: z.object({ by: z.number().default(2) }),
    permission: { view: "production" },
    async run(ctx, { by }) {
      if (by === 0) return ctx.error("rule", "Cannot divide by zero");
      if (by < 0) throw new Error("negative");
      return { result: 10 / by };
    }
  });

  it("returns the value as data, with the input's defaults applied", async () => {
    await expect(divide(ctx, {})).resolves.toEqual({
      data: { result: 5 },
      error: null
    });
  });

  it("returns a refusal as the error, with its category and status", async () => {
    const { data, error } = await divide(ctx, { by: 0 });
    expect(data).toBeNull();
    expect(error).toMatchObject({
      category: "rule",
      status: 422,
      message: "Cannot divide by zero"
    });
  });

  it("turns a throw into an internal error and withholds its message", async () => {
    const { error } = await divide(ctx, { by: -1 });
    expect(error).toMatchObject({
      category: "internal",
      message: "Something went wrong"
    });
  });

  it("refuses input the schema rejects without running", async () => {
    const { error } = await divide(ctx, { by: "two" as never });
    expect(error?.category).toBe("validation");
  });

  it("records a key's creator as the audit user", () => {
    expect(ctx.auditUserId).toBe("user-1");
  });
});

describe("ctx.transaction", () => {
  it("commits a value and hands the body the transaction", async () => {
    const { pg, trx, outcomes } = database();
    const result = await contextWith(pg).transaction(async (tx) => {
      expect(tx.asSystem.pg).toBe(trx);
      return "done";
    });
    expect(result).toEqual({ data: "done", error: null });
    expect(outcomes).toEqual(["commit"]);
  });

  it("rolls back when the body returns an error, and returns that error", async () => {
    const { pg, outcomes } = database();
    const refused = new CarbonError("conflict", "Job unavailable");
    const result = await contextWith(pg).transaction(async () => refused);
    expect(result).toEqual({ data: null, error: refused });
    expect(outcomes).toEqual(["rollback"]);
  });

  it("rolls back and rethrows when the body throws", async () => {
    const { pg, outcomes } = database();
    await expect(
      contextWith(pg).transaction(async () => {
        throw new Error("connection lost");
      })
    ).rejects.toThrow("connection lost");
    expect(outcomes).toEqual(["rollback"]);
  });

  it("joins a transaction that is already open", async () => {
    const { pg, outcomes } = database();
    const result = await contextWith(pg).transaction((tx) =>
      tx.transaction(async () => "inner")
    );
    expect(result).toEqual({
      data: { data: "inner", error: null },
      error: null
    });
    expect(outcomes).toEqual(["commit"]);
  });
});
