import { describe, expect, it, vi } from "vitest";
import {
  AuthClientScope,
  AuthContextHolder,
  getAuthClient,
  runWithSystemClient,
  runWithSystemContext
} from "./auth-context.server";

describe("lazy request-scoped client (getAuthClient / AuthClientScope)", () => {
  it("throws (fail closed) when called outside any client scope", () => {
    expect(() => getAuthClient()).toThrow(/no client scope/);
  });

  it("throws when the scope is open but requirePermissions never set a factory", () => {
    AuthClientScope.run(() => {
      // middleware opened the cell, but no factory written → fail closed,
      // must NOT default to a client (and never serviceRole).
      expect(() => getAuthClient()).toThrow(/client not resolved/);
    });
  });

  it("builds lazily: factory not invoked until first getAuthClient()", () => {
    const factory = vi.fn(() => ({ tag: "rls" }));
    AuthClientScope.run(() => {
      AuthClientScope.setFactory(factory);
      expect(factory).not.toHaveBeenCalled(); // lazy
      const c = getAuthClient();
      expect(factory).toHaveBeenCalledTimes(1);
      expect(c).toEqual({ tag: "rls" });
    });
  });

  it("memoizes: repeated calls return the same instance, factory runs once", () => {
    let n = 0;
    AuthClientScope.run(() => {
      AuthClientScope.setFactory(() => ({ n: ++n }));
      const a = getAuthClient();
      const b = getAuthClient();
      expect(a).toBe(b);
      expect(n).toBe(1);
    });
  });

  it("setFactory after build replaces the client (last writer wins)", () => {
    // Required so a child loader requesting `bypassRls` overrides a parent
    // layout's RLS-bound factory: RR-7 v8_middleware shares one ALS cell
    // across a request's parallel loaders, so the second setFactory MUST
    // win. Already-issued client references (held by in-flight service
    // calls) are unaffected; only subsequent getAuthClient() calls see the
    // new factory. Matches main, where `client` was a value bound at call
    // time, not a shared mutable cell.
    AuthClientScope.run(() => {
      AuthClientScope.setFactory(() => "first");
      expect(getAuthClient()).toBe("first");
      AuthClientScope.setFactory(() => "second");
      expect(getAuthClient()).toBe("second");
    });
  });

  it("isolates client per request (no cross-request leakage)", async () => {
    const results: string[] = [];
    const req = (id: string, delay: number) =>
      AuthClientScope.run(async () => {
        AuthClientScope.setFactory(() => id);
        await new Promise((r) => setTimeout(r, delay));
        results.push(getAuthClient<string>());
      });
    await Promise.all([req("A", 5), req("B", 1), req("C", 3)]);
    expect(new Set(results)).toEqual(new Set(["A", "B", "C"]));
  });

  it("setFactory throws if no scope is open (wiring bug surfaces loudly)", () => {
    expect(() => AuthClientScope.setFactory(() => 1)).toThrow(
      /no client scope/
    );
  });
});

describe("system-context helpers (runWithSystemClient / runWithSystemContext)", () => {
  it("runWithSystemClient: getAuthClient resolves to the passed client; identity reads still fail closed", () => {
    const client = { tag: "service-role" };
    runWithSystemClient(client, () => {
      expect(getAuthClient()).toBe(client);
      // No identity scope was opened — get() must still throw fail-closed
      // so a route that wires only the client (e.g. for a discovery read)
      // does not silently let identity-reading service code through.
      expect(() => AuthContextHolder.get()).toThrow(/no auth context/);
    });
  });

  it("runWithSystemContext: opens both scopes and exposes identity + client", () => {
    const client = { tag: "service-role" };
    const result = runWithSystemContext(
      { companyId: "co-1", userId: "u-1" },
      client,
      () => {
        const ctx = AuthContextHolder.get();
        return {
          companyId: ctx.companyId,
          userId: ctx.userId,
          sessionUserId: ctx.sessionUserId,
          email: ctx.email,
          companyGroupId: ctx.companyGroupId,
          client: getAuthClient()
        };
      }
    );
    expect(result).toEqual({
      companyId: "co-1",
      userId: "u-1",
      // Defaults: sessionUserId falls back to userId, the rest to "".
      sessionUserId: "u-1",
      email: "",
      companyGroupId: "",
      client
    });
  });

  it("runWithSystemContext returns the inner function's value (so callers can compose)", async () => {
    const v = await runWithSystemContext(
      { companyId: "co-1" },
      {},
      async () => "ok"
    );
    expect(v).toBe("ok");
  });

  it("nested scopes do not leak: outer identity is restored after inner runs", () => {
    runWithSystemContext({ companyId: "outer" }, {}, () => {
      runWithSystemContext({ companyId: "inner" }, {}, () => {
        expect(AuthContextHolder.get().companyId).toBe("inner");
      });
      expect(AuthContextHolder.get().companyId).toBe("outer");
    });
  });
});
