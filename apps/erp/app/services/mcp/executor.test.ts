import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AuthContextHolder } from "./auth-context";
import { type ExecutorContext, ToolExecutor } from "./executor";
import { mcpTool } from "./mcpTool";
import { McpToolRegistry } from "./registry";

// Each test gets a fresh registry so registration side effects don't bleed.
function freshRegistry(): McpToolRegistry {
  return new McpToolRegistry({ warn: () => undefined });
}

const ctx: ExecutorContext = {
  client: { tag: "fake-client" },
  companyId: "company-1",
  userId: "user-1"
};

describe("ToolExecutor", () => {
  let registry: McpToolRegistry;

  beforeEach(() => {
    registry = freshRegistry();
  });

  it("returns TOOL_NOT_FOUND for an unregistered id", async () => {
    const exec = new ToolExecutor(registry);
    const result = await exec.execute("nope_missing", ctx, {});
    expect(result).toEqual({
      ok: false,
      code: "TOOL_NOT_FOUND",
      message: expect.stringContaining("nope_missing")
    });
  });

  it("blocks ids in BLOCKED_TOOL_IDS even if somehow registered", async () => {
    const exec = new ToolExecutor(registry);
    const result = await exec.execute("settings_seedCompany", ctx, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("establishes the AuthContextHolder scope for the duration of the tool call", async () => {
    let seen: ExecutorContext | undefined;
    registry.register(
      {
        module: "sales",
        name: "whoAmI",
        classification: "READ",
        description: "who am i",
        injectAuth: [],
        argOrder: ["payload"],
        paramSchema: z.unknown()
      },
      async (_payload: Record<string, unknown>) => {
        // Service functions now read identity ambiently, not from params.
        seen = AuthContextHolder.get() as ExecutorContext;
        return { ok: true };
      }
    );

    const exec = new ToolExecutor(registry);
    const result = await exec.execute("sales_whoAmI", ctx, {
      payload: { q: 1 }
    });

    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(seen).toEqual({
      client: ctx.client,
      userId: "user-1",
      // executor defaults these until the MCP route runs under the auth
      // middleware (Step 2): sessionUserId := userId, companyGroupId := "".
      sessionUserId: "user-1",
      companyId: "company-1",
      companyGroupId: ""
    });
    // Scope is torn down once execute() resolves.
    expect(AuthContextHolder.tryGet()).toBeUndefined();
  });

  it("strips caller-supplied identity from the payload (anti-spoofing)", async () => {
    let seenPayload: Record<string, unknown> = {};
    registry.register(
      {
        module: "sales",
        name: "copyQuote",
        classification: "WRITE",
        description: "copy quote",
        injectAuth: [],
        argOrder: ["payload"],
        paramSchema: z.unknown()
      },
      async (payload: Record<string, unknown>) => {
        seenPayload = payload;
        return { ok: true };
      }
    );

    const exec = new ToolExecutor(registry);
    const result = await exec.execute("sales_copyQuote", ctx, {
      payload: {
        sourceQuoteId: "q-1",
        // Caller attempts to smuggle identity into the payload object.
        companyId: "SPOOFED",
        createdBy: "EVIL",
        userId: "EVIL"
      }
    });

    expect(result).toEqual({ ok: true, data: { ok: true } });
    // Identity is NOT injected into the payload anymore (it flows via ALS);
    // the spoofed keys are stripped, leaving only the real caller data.
    expect(seenPayload).toEqual({ sourceQuoteId: "q-1" });
  });

  it("returns MISSING_REQUIRED_PARAM when a required positional arg has no source", async () => {
    registry.register(
      {
        module: "sales",
        name: "getCustomer",
        classification: "READ",
        description: "get customer",
        injectAuth: [],
        argOrder: ["customerId"],
        paramSchema: z.unknown()
      },
      async (_id: string) => null
    );

    const exec = new ToolExecutor(registry);
    const result = await exec.execute("sales_getCustomer", ctx, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("MISSING_REQUIRED_PARAM");
      expect(result.message).toContain("customerId");
    }
  });

  // BUG 1 regression: when the (possibly stale) manifest still lists
  // context params in argOrder, the executor must fill them from the
  // server context — NOT demand them from the caller payload (callers
  // never send identity). Previously this failed MISSING_REQUIRED_PARAM
  // for "client" and broke every MCP tool call.
  it("fills CONTEXT_KEYS (client/userId/companyId) from context, not payload", async () => {
    const seen: unknown[] = [];
    registry.register(
      {
        module: "sales",
        name: "legacyShaped",
        classification: "READ",
        description: "legacy argOrder still has context params",
        injectAuth: [],
        argOrder: ["client", "userId", "companyId", "customerId"],
        paramSchema: z.unknown()
      },
      async (c: unknown, u: unknown, co: unknown, id: unknown) => {
        seen.push(c, u, co, id);
        return "ok";
      }
    );

    const exec = new ToolExecutor(registry);
    // Caller sends ONLY the real payload param — no identity.
    const result = await exec.execute("sales_legacyShaped", ctx, {
      customerId: "cust-1"
    });

    expect(result.ok).toBe(true);
    // client/userId/companyId came from ctx; customerId from payload.
    expect(seen).toEqual([ctx.client, ctx.userId, ctx.companyId, "cust-1"]);
  });

  it("treats trailing optional params (suffix '?') as undefined when absent", async () => {
    let lastArg: unknown = "untouched";
    registry.register(
      {
        module: "items",
        name: "listItems",
        classification: "READ",
        description: "list items",
        injectAuth: [],
        argOrder: ["limit?"],
        paramSchema: z.unknown()
      },
      async (limit?: number) => {
        lastArg = limit;
        return [];
      }
    );

    const exec = new ToolExecutor(registry);
    const result = await exec.execute("items_listItems", ctx, {});
    expect(result.ok).toBe(true);
    expect(lastArg).toBeUndefined();
  });

  it("unwraps the legacy `{ args: {...} }` envelope only when the tool has no `args` param", async () => {
    let seenPayload: Record<string, unknown> = {};
    registry.register(
      {
        module: "sales",
        name: "fooNoArgsParam",
        classification: "READ",
        description: "no args param",
        injectAuth: [],
        argOrder: ["payload"],
        paramSchema: z.unknown()
      },
      async (payload: Record<string, unknown>) => {
        seenPayload = payload;
        return null;
      }
    );

    const exec = new ToolExecutor(registry);
    await exec.execute("sales_fooNoArgsParam", ctx, {
      args: { payload: { x: 1 } }
    });
    expect(seenPayload).toEqual({ x: 1 });
  });

  it("does NOT unwrap when the tool declares an `args` param", async () => {
    let seenArgs: Record<string, unknown> = {};
    registry.register(
      {
        module: "users",
        name: "fooHasArgsParam",
        classification: "WRITE",
        description: "has args param",
        injectAuth: [],
        argOrder: ["args"],
        paramSchema: z.unknown()
      },
      async (args: Record<string, unknown>) => {
        seenArgs = args;
        return null;
      }
    );

    const exec = new ToolExecutor(registry);
    await exec.execute("users_fooHasArgsParam", ctx, { args: { k: "v" } });
    // Identity is no longer injected into the payload; it flows via ALS.
    expect(seenArgs).toEqual({ k: "v" });
  });

  it("returns EXECUTION_FAILED with the error message when the tool throws", async () => {
    registry.register(
      {
        module: "sales",
        name: "boom",
        classification: "WRITE",
        description: "boom",
        injectAuth: [],
        argOrder: [],
        paramSchema: z.unknown()
      },
      async () => {
        throw new Error("row not found");
      }
    );

    const exec = new ToolExecutor(
      registry,
      { error: () => undefined } // silence
    );
    const result = await exec.execute("sales_boom", ctx, {});
    expect(result).toEqual({
      ok: false,
      code: "EXECUTION_FAILED",
      message: "row not found"
    });
  });

  it("honours the authorize hook", async () => {
    registry.register(
      {
        module: "sales",
        name: "wipe",
        classification: "DESTRUCTIVE",
        description: "wipe",
        injectAuth: [],
        argOrder: [],
        paramSchema: z.unknown()
      },
      async () => null
    );

    const exec = new ToolExecutor(registry, undefined, (classification) =>
      classification === "DESTRUCTIVE" ? "destructive ops disabled" : null
    );
    const result = await exec.execute("sales_wipe", ctx, {});
    expect(result).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "destructive ops disabled"
    });
  });

  it("rejects invalid JSON string arguments", async () => {
    const exec = new ToolExecutor(registry);
    const result = await exec.execute("anything", ctx, "{not json");
    expect(result).toEqual({
      ok: false,
      code: "INVALID_JSON",
      message: expect.stringContaining("Invalid JSON")
    });
  });
});

describe("McpToolRegistry", () => {
  it("infers injectInto when argOrder has one non-context object key and injectAuth is set", () => {
    const r = freshRegistry();
    r.register(
      {
        module: "m",
        name: "t",
        classification: "WRITE",
        description: "t",
        injectAuth: ["companyId"],
        argOrder: ["client", "payload"],
        paramSchema: z.unknown()
      },
      async () => null
    );
    expect(r.get("m_t")?.injectInto).toBe("payload");
  });

  it("does NOT infer injectInto when injectAuth is empty", () => {
    const r = freshRegistry();
    r.register(
      {
        module: "m",
        name: "t",
        classification: "READ",
        description: "t",
        injectAuth: [],
        argOrder: ["client", "filter"],
        paramSchema: z.unknown()
      },
      async () => null
    );
    expect(r.get("m_t")?.injectInto).toBeUndefined();
  });

  it("does NOT infer injectInto when there are multiple non-context keys (ambiguous)", () => {
    const r = freshRegistry();
    r.register(
      {
        module: "m",
        name: "t",
        classification: "WRITE",
        description: "t",
        injectAuth: ["companyId"],
        argOrder: ["client", "id", "payload"],
        paramSchema: z.unknown()
      },
      async () => null
    );
    expect(r.get("m_t")?.injectInto).toBeUndefined();
  });

  it("throws when injectInto references a key not in argOrder", () => {
    const r = freshRegistry();
    expect(() =>
      r.register(
        {
          module: "m",
          name: "t",
          classification: "WRITE",
          description: "t",
          injectAuth: ["companyId"],
          argOrder: ["client", "payload"],
          injectInto: "doesNotExist",
          paramSchema: z.unknown()
        },
        async () => null
      )
    ).toThrow(/injectInto/);
  });

  it("rejects registration with no paramSchema", () => {
    const r = freshRegistry();
    expect(() =>
      r.register(
        {
          module: "m",
          name: "t",
          classification: "READ",
          description: "t",
          injectAuth: [],
          argOrder: ["client"],
          // @ts-expect-error intentionally missing
          paramSchema: undefined
        },
        async () => null
      )
    ).toThrow(/paramSchema/);
  });

  it("rejects when fn.length exceeds argOrder.length", () => {
    const r = freshRegistry();
    expect(() =>
      r.register(
        {
          module: "m",
          name: "t",
          classification: "READ",
          description: "t",
          injectAuth: [],
          argOrder: ["client"],
          paramSchema: z.unknown()
        },
        // arity 3 vs argOrder 1
        async (_a: unknown, _b: unknown, _c: unknown) => null
      )
    ).toThrow(/fn\.length/);
  });

  // --- unified `inject` list (replaces injectAuth + injectInto) ---

  it("does NOT inject identity into payload objects; strips caller spoof and exposes identity via ALS", async () => {
    // New contract: identity is no longer stamped into payload params.
    // It is available ambiently through AuthContextHolder, and any
    // caller-supplied identity in the payload is stripped (anti-spoof).
    const registry = freshRegistry();
    let seenPayload: Record<string, unknown> = {};
    let seenCompanyId = "";
    registry.register(
      {
        module: "sales",
        name: "upsertViaAls",
        classification: "WRITE",
        description: "upsert via als",
        argOrder: ["salesOrder"],
        paramSchema: z.unknown(),
        injectAuth: []
      },
      async (salesOrder: Record<string, unknown>) => {
        seenPayload = salesOrder;
        seenCompanyId = AuthContextHolder.companyId;
        return { ok: true };
      }
    );

    const exec = new ToolExecutor(registry);
    const result = await exec.execute("sales_upsertViaAls", ctx, {
      salesOrder: {
        name: "SO-1",
        companyId: "SPOOFED",
        createdBy: "EVIL",
        updatedBy: "EVIL"
      }
    });

    expect(result).toEqual({ ok: true, data: { ok: true } });
    // Caller-supplied identity stripped from the payload (not re-injected).
    expect(seenPayload).toEqual({ name: "SO-1" });
    // The real identity is reachable via the ambient holder.
    expect(seenCompanyId).toBe("company-1");
  });

  it("rejects an inject list that targets more than one param (registry models a single target)", () => {
    const r = freshRegistry();
    expect(() =>
      r.register(
        {
          module: "m",
          name: "multiTarget",
          classification: "WRITE",
          description: "multi target",
          argOrder: ["client", "a", "b"],
          paramSchema: z.unknown(),
          injectAuth: [],
          inject: [
            { param: "a", as: "companyId" },
            { param: "b", as: "userId" }
          ]
        },
        async (_client: unknown, _a: unknown, _b: unknown) => null
      )
    ).toThrow(/multiple params/);
  });

  it("runtime guard: registry rejects an inject target that is not a real param", () => {
    const r = freshRegistry();
    expect(() =>
      r.register(
        {
          module: "m",
          name: "badTarget",
          classification: "WRITE",
          description: "bad target",
          argOrder: ["client", "payload"],
          paramSchema: z.unknown(),
          injectAuth: [],
          inject: [{ param: "doesNotExist", as: "companyId" }]
        },
        async (_client: unknown, _payload: unknown) => null
      )
    ).toThrow(/not in argOrder/);
  });
});

// End-to-end regression for the slim-annotation runtime path. The bug:
// registerParsed() spread a SLIM annotation (no description, no identity
// set) into the strict registration, so `registration.description.trim()`
// threw at boot and `auth` was empty — silently dropping server identity
// injection on every tool. The fix carries description + resolved inject
// through McpToolParsed (build-derived). This exercises the real chain:
// mcpTool() slim literal -> registerParsed(build metadata) -> execute().
describe("registerParsed -> execute (slim-annotation runtime path)", () => {
  it("registers with build-derived description and runs under the ALS scope end-to-end", async () => {
    const registry = freshRegistry();
    let seen: Record<string, unknown> = {};
    let seenCompanyId = "";
    // Slim literal exactly as the codemod leaves it: classification only.
    // Post-rewrite signature: no `client` param — identity is ambient.
    const fn = mcpTool(
      { classification: "WRITE" },
      async function upsertThing(payload: Record<string, unknown>) {
        seen = payload;
        seenCompanyId = AuthContextHolder.companyId;
        return { ok: true };
      }
    );
    // Metadata the manifest generator derives and emits into
    // mcp-tools.generated.ts (no `client` positional anymore).
    registry.registerParsed(fn, {
      module: "things",
      name: "upsertThing",
      argOrder: ["payload"],
      description: "upsert thing",
      inject: []
    });

    const tool = registry.get("things_upsertThing");
    expect(tool).toBeDefined();
    // Would have been undefined -> .trim() crash before the fix.
    expect(tool!.description).toBe("upsert thing");

    const exec = new ToolExecutor(registry);
    const result = await exec.execute("things_upsertThing", ctx, {
      payload: { name: "X", companyId: "SPOOFED" }
    });

    expect(result).toEqual({ ok: true, data: { ok: true } });
    // Caller-supplied companyId stripped; real identity reached via ALS.
    expect(seen).toEqual({ name: "X" });
    expect(seenCompanyId).toBe("company-1");
  });
});
