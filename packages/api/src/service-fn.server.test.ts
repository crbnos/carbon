// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn() })
}));

import {
  type Actor,
  CarbonError,
  createServiceContext,
  defineServiceFn,
  type Result,
  type RouteResult,
  toResult
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

const productionView = {
  production: { view: ["company-1"], create: [], update: [], delete: [] }
};

const contextWith = (
  pg: unknown,
  actor: Actor = {
    type: "apiKey",
    createdBy: "user-1",
    scopes: productionView
  }
) =>
  createServiceContext({
    actor,
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

describe("the gate", () => {
  const inner = defineServiceFn({
    input: z.object({}),
    permission: "system",
    async run() {
      return "inner";
    }
  });
  const outer = defineServiceFn({
    input: z.object({}),
    permission: { view: "production" },
    async run(ctx) {
      return inner(ctx, {});
    }
  });
  const accountingDelete = defineServiceFn({
    input: z.object({}),
    permission: { delete: "accounting" },
    async run() {
      return "deleted";
    }
  });
  const outerOfAccounting = defineServiceFn({
    input: z.object({}),
    permission: { view: "production" },
    async run(ctx) {
      return accountingDelete(ctx, {});
    }
  });
  const user = (permissions = {}): Actor => ({
    type: "user",
    userId: "user-1",
    permissions
  });

  it("refuses a caller without the permission, before running", async () => {
    const { error } = await outer(contextWith({}, user()), {});
    expect(error).toMatchObject({ category: "forbidden", status: 403 });
  });

  it("refuses a system-only function to every caller but the system", async () => {
    const asUser = await inner(contextWith({}, user(productionView)), {});
    expect(asUser.error?.category).toBe("forbidden");
    const asSystem = await inner(
      contextWith({}, { type: "system", onBehalfOf: "user-1" }),
      {}
    );
    expect(asSystem.data).toBe("inner");
  });

  it("does not check a call made from inside another service function", async () => {
    const { data } = await outerOfAccounting(
      contextWith({}, user(productionView)),
      {}
    );
    expect(data).toEqual({ data: "deleted", error: null });
  });

  it("still refuses a nested system-only call to every caller but the system", async () => {
    const asUser = await outer(contextWith({}, user(productionView)), {});
    expect(asUser.data?.error?.category).toBe("forbidden");
    const asSystem = await outer(
      contextWith({}, { type: "system", onBehalfOf: "user-1" }),
      {}
    );
    expect(asSystem.data).toEqual({ data: "inner", error: null });
  });

  it("requires company membership when nothing is named", async () => {
    const open = defineServiceFn({
      input: z.object({}),
      permission: {},
      async run() {
        return "ok";
      }
    });
    expect((await open(contextWith({}, user()), {})).error?.category).toBe(
      "forbidden"
    );
    expect((await open(contextWith({}, user(productionView)), {})).data).toBe(
      "ok"
    );
  });

  it("checks a keyed permission against the value sent", async () => {
    const post = defineServiceFn({
      input: z.object({ kind: z.enum(["read", "write"]) }),
      permission: {
        by: "kind",
        rules: { read: { view: "production" }, write: { update: "production" } }
      },
      async run({ actor }) {
        return actor.type;
      }
    });
    const ctx = contextWith({}, user(productionView));
    expect((await post(ctx, { kind: "read" })).data).toBe("user");
    expect((await post(ctx, { kind: "write" })).error?.category).toBe(
      "forbidden"
    );
  });

  it("refuses a keyed value with no rule as invalid input, not forbidden", async () => {
    const post = defineServiceFn({
      input: z.object({ kind: z.string() }),
      permission: {
        by: "kind",
        rules: { read: { view: "production" } } as Record<
          string,
          { view: string }
        >
      },
      async run() {
        return "ran";
      }
    });
    const { error } = await post(contextWith({}, user(productionView)), {
      kind: "constructor"
    });
    expect(error).toMatchObject({
      category: "validation",
      message: "Invalid input — kind: expected one of read"
    });
  });
});

describe("ctx.can", () => {
  it("answers for the actor's own permissions, and yes for the system", () => {
    expect(ctx.can({ view: "production" })).toBe(true);
    expect(ctx.can({ update: "production" })).toBe(false);
    expect(ctx.can("system")).toBe(false);
    const system = contextWith({}, { type: "system", onBehalfOf: "user-1" });
    expect(system.can({ delete: "accounting" })).toBe(true);
  });
});

describe("toResult", () => {
  it("types the error by the categories the function returns", () => {
    type Sent = RouteResult<Result<number, CarbonError<"notFound" | "rule">>>;
    expectTypeOf<
      Extract<Sent, { data: null }>["error"]["category"]
    >().toEqualTypeOf<"notFound" | "rule">();
  });

  it("sends an error as its category, message and status only", () => {
    const cause = new Error("duplicate key");
    const error = new CarbonError("conflict", "Job unavailable", cause);
    expect(toResult({ data: null, error })).toEqual({
      data: null,
      error: { category: "conflict", message: "Job unavailable", status: 409 }
    });
  });

  it("passes a value through", () => {
    expect(toResult({ data: 1, error: null })).toEqual({
      data: 1,
      error: null
    });
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

  it("lets a service function run inside the transaction", async () => {
    const { pg, outcomes } = database();
    const write = defineServiceFn({
      input: z.object({}),
      permission: { view: "production" },
      async run(ctx) {
        return ctx.asSystem.pg;
      }
    });
    const result = await contextWith(pg).transaction((tx) => write(tx, {}));
    expect(result.data?.data).toEqual({ isTransaction: true });
    expect(outcomes).toEqual(["commit"]);
  });

  it("refuses the caller's client inside the transaction", async () => {
    const { pg } = database();
    await expect(
      contextWith(pg).transaction(async (tx) => tx.asCaller.supabase)
    ).rejects.toThrow("not part of the transaction");
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
