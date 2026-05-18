import { describe, expect, it, vi } from "vitest";
import { AuthClientScope, getAuthClient } from "./auth-context";

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

  it("does NOT swap the client once built (setFactory after build is ignored)", () => {
    AuthClientScope.run(() => {
      AuthClientScope.setFactory(() => "first");
      expect(getAuthClient()).toBe("first");
      AuthClientScope.setFactory(() => "second"); // too late, already built
      expect(getAuthClient()).toBe("first");
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
