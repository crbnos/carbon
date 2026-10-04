// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import { createInvalidationMiddleware } from "./invalidation";

const run = async (method: string, url: string) => {
  const invalidateQueries = vi.fn();
  const middleware = createInvalidationMiddleware({
    getCache: () => ({ invalidateQueries }),
    skipPaths: ["/refresh-session"]
  });
  const next = vi.fn(async () => {
    // Nothing is stale until the mutation itself has finished.
    expect(invalidateQueries).not.toHaveBeenCalled();
    return "result";
  });
  const result = await middleware(
    { request: new Request(url, { method }) } as never,
    next as never
  );
  expect(result).toBe("result");
  return invalidateQueries;
};

describe("createInvalidationMiddleware", () => {
  it("leaves the cache alone on a GET", async () => {
    expect(await run("GET", "http://localhost/x/sales")).not.toHaveBeenCalled();
  });

  it("invalidates the loader entries after a mutation", async () => {
    expect(
      await run("POST", "http://localhost/x/sales/customer-types/new")
    ).toHaveBeenCalledWith({ queryKey: ["loader"] });
  });

  it("leaves the cache alone for a skipped path", async () => {
    expect(
      await run("POST", "http://localhost/refresh-session")
    ).not.toHaveBeenCalled();
  });
});
