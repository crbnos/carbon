import { describe, expect, it } from "vitest";
import { type AuthContext, AuthContextHolder } from "./auth-context.server";

const ctx = (id: string): AuthContext => ({
  client: { tag: id },
  userId: `user-${id}`,
  sessionUserId: `session-${id}`,
  email: `user-${id}@example.com`,
  companyId: `company-${id}`,
  companyGroupId: `group-${id}`
});

describe("AuthContextHolder", () => {
  it("throws (fail closed) when read outside any run() scope", () => {
    expect(() => AuthContextHolder.get()).toThrow(/no auth context in scope/);
    expect(() => AuthContextHolder.userId).toThrow(/no auth context/);
    expect(AuthContextHolder.tryGet()).toBeUndefined();
  });

  it("returns the established context inside run()", () => {
    const c = ctx("a");
    const out = AuthContextHolder.run(c, () => {
      expect(AuthContextHolder.get()).toBe(c);
      expect(AuthContextHolder.userId).toBe("user-a");
      expect(AuthContextHolder.companyId).toBe("company-a");
      return "result";
    });
    expect(out).toBe("result");
    // Scope is torn down after run() returns.
    expect(AuthContextHolder.tryGet()).toBeUndefined();
  });

  it("propagates through awaited continuations", async () => {
    await AuthContextHolder.run(ctx("b"), async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      expect(AuthContextHolder.companyId).toBe("company-b");
    });
  });

  it("does NOT leak context across concurrently interleaved requests", async () => {
    // The core ALS safety property: two requests running at the same time
    // each see only their own identity, even when their awaits interleave.
    const observed: string[] = [];

    const request = (id: string, delay: number) =>
      AuthContextHolder.run(ctx(id), async () => {
        await new Promise((r) => setTimeout(r, delay));
        // After an interleaving await, the context must still be this
        // request's — not whichever request resumed most recently.
        observed.push(AuthContextHolder.companyId);
        await new Promise((r) => setTimeout(r, delay));
        expect(AuthContextHolder.userId).toBe(`user-${id}`);
        return AuthContextHolder.companyId;
      });

    const [a, b, c] = await Promise.all([
      request("x", 5),
      request("y", 1),
      request("z", 3)
    ]);

    expect(a).toBe("company-x");
    expect(b).toBe("company-y");
    expect(c).toBe("company-z");
    expect(new Set(observed)).toEqual(
      new Set(["company-x", "company-y", "company-z"])
    );
  });

  it("restores the outer context after a nested run()", () => {
    AuthContextHolder.run(ctx("outer"), () => {
      AuthContextHolder.run(ctx("inner"), () => {
        expect(AuthContextHolder.companyId).toBe("company-inner");
      });
      expect(AuthContextHolder.companyId).toBe("company-outer");
    });
  });
});
