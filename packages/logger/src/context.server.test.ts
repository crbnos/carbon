import { createContext, RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";
import {
  getRequestContext,
  getRouterContext,
  oncePerRequest,
  requestMemoSize,
  runInRequestContext
} from "./context.server";

const provider = () => new RouterContextProvider();

describe("request context", () => {
  it("exposes the router context inside a scope and nothing outside", () => {
    const p = provider();
    expect(getRouterContext()).toBeUndefined();
    runInRequestContext(p, () => {
      expect(getRouterContext()).toBe(p);
    });
    expect(getRouterContext()).toBeUndefined();
  });

  it("reads a createContext value set by middleware, without threading it", () => {
    const idContext = createContext<string | null>(null);
    const p = provider();
    p.set(idContext, "req_123");

    // A "service function" deep in the call tree, taking no context argument.
    const service = () => getRequestContext(idContext);

    expect(runInRequestContext(p, service)).toBe("req_123");
    expect(service()).toBeUndefined(); // outside a request
  });
});

describe("oncePerRequest", () => {
  it("computes once per key within a request", () => {
    let calls = 0;
    const compute = () => ({ id: ++calls });

    const [a, b, c] = runInRequestContext(provider(), () => [
      oncePerRequest("claims:u1:c1", compute),
      oncePerRequest("claims:u1:c1", compute),
      oncePerRequest("claims:u1:c1", compute)
    ]);

    expect(calls).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  // The safety property: separate requests never observe each other's values.
  it("never shares a value between requests, even for the same key", () => {
    const a = runInRequestContext(provider(), () =>
      oncePerRequest("claims:u1:c1", () => "TENANT_A")
    );
    const b = runInRequestContext(provider(), () =>
      oncePerRequest("claims:u1:c1", () => "TENANT_B")
    );
    expect(a).toBe("TENANT_A");
    expect(b).toBe("TENANT_B");
  });

  // ALS is the point: loaders are independent async branches of one request.
  it("propagates across awaits and concurrent branches", async () => {
    let calls = 0;
    const lookup = () =>
      new Promise<string>((resolve) => {
        calls++;
        setTimeout(() => resolve("claims"), 5);
      });

    const results = await runInRequestContext(provider(), async () => {
      await new Promise((r) => setTimeout(r, 1));
      return Promise.all([
        oncePerRequest("claims", lookup),
        oncePerRequest("claims", lookup),
        (async () => {
          await new Promise((r) => setTimeout(r, 2));
          return oncePerRequest("claims", lookup);
        })()
      ]);
    });

    expect(calls).toBe(1);
    expect(results).toEqual(["claims", "claims", "claims"]);
  });

  it("keeps concurrent requests isolated", async () => {
    const run = (tenant: string, delay: number) =>
      runInRequestContext(provider(), async () => {
        await new Promise((r) => setTimeout(r, delay));
        return oncePerRequest("claims", () => tenant);
      });

    expect(await Promise.all([run("A", 3), run("B", 1), run("C", 2)])).toEqual([
      "A",
      "B",
      "C"
    ]);
  });

  it("keys distinct values separately", () => {
    const size = runInRequestContext(provider(), () => {
      oncePerRequest("claims:u1:c1", () => 1);
      oncePerRequest("claims:u1:c2", () => 2);
      oncePerRequest("carbon:tokenA", () => 3);
      expect(oncePerRequest("claims:u1:c2", () => 99)).toBe(2);
      return requestMemoSize();
    });
    expect(size).toBe(3);
  });

  it("memoizes a falsy value rather than recomputing", () => {
    let calls = 0;
    runInRequestContext(provider(), () => {
      oncePerRequest("k", () => {
        calls++;
        return null;
      });
      oncePerRequest("k", () => {
        calls++;
        return null;
      });
    });
    expect(calls).toBe(1);
  });

  // Inngest jobs, edge functions and tests run with no middleware around them.
  it("falls back to computing every time outside a request", () => {
    let calls = 0;
    const compute = () => ++calls;
    expect(oncePerRequest("k", compute)).toBe(1);
    expect(oncePerRequest("k", compute)).toBe(2);
    expect(requestMemoSize()).toBe(0);
  });
});
