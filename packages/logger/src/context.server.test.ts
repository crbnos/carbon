import { createContext, RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";
import {
  getRequestContext,
  getRouterContext,
  oncePerRead,
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

describe("oncePerRead", () => {
  it("memoizes on a read-only request", () => {
    let calls = 0;
    const compute = () => ++calls;
    runInRequestContext(provider(), () => {
      oncePerRead("claims:u1:c1", compute);
      oncePerRead("claims:u1:c1", compute);
    });
    expect(calls).toBe(1);
  });

  // Why this helper exists. React Router runs an action and the loader
  // revalidation that follows it in ONE request. Memoizing database state there
  // would hand the revalidating loaders pre-write data — for permission claims
  // that means a gate passing on permissions the action just revoked.
  it("does NOT memoize on a mutating request", () => {
    let claims = "can:delete";
    const seen: string[] = [];
    runInRequestContext(
      provider(),
      () => {
        seen.push(oncePerRead("claims:u1:c1", () => claims)); // action reads
        claims = "revoked"; // action writes + invalidates the redis key
        seen.push(oncePerRead("claims:u1:c1", () => claims)); // loaders revalidate
      },
      { isRead: false }
    );
    expect(seen).toEqual(["can:delete", "revoked"]);
  });

  it("is a pass-through outside any request scope", () => {
    let calls = 0;
    const compute = () => ++calls;
    expect(oncePerRead("k", compute)).toBe(1);
    expect(oncePerRead("k", compute)).toBe(2);
  });

  // The client memo is intentionally NOT read-gated: a Supabase client is
  // interchangeable regardless of what the request does.
  it("oncePerRequest still memoizes on a mutating request", () => {
    let calls = 0;
    runInRequestContext(
      provider(),
      () => {
        oncePerRequest("carbon:token", () => ++calls);
        oncePerRequest("carbon:token", () => ++calls);
      },
      { isRead: false }
    );
    expect(calls).toBe(1);
  });
});
