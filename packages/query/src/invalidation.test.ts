// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createInvalidationMiddleware, LOADER_QUERY_KEY } from "./invalidation";

const loaderKey = [LOADER_QUERY_KEY, "company-a", "/api/x", ""];
const liveKey = ["live", "company-a", "items"];

// A real cache holding one loader entry and one entry of another kind, run
// through the middleware as React Router would for one request.
const run = async (method: string, url: string) => {
  const cache = new QueryClient();
  cache.setQueryData(loaderKey, []);
  cache.setQueryData(liveKey, []);
  const stale = (key: unknown[]) =>
    cache.getQueryState(key)?.isInvalidated ?? false;

  const middleware = createInvalidationMiddleware({
    getCache: () => cache,
    skipPaths: ["/refresh-session"]
  });
  const result = await middleware(
    { request: new Request(url, { method }) } as never,
    (async () => {
      // Nothing is stale until the mutation itself has finished.
      expect(stale(loaderKey)).toBe(false);
      return "result";
    }) as never
  );

  expect(result).toBe("result");
  return { loader: stale(loaderKey), live: stale(liveKey) };
};

describe("createInvalidationMiddleware", () => {
  it("leaves the cache alone on a GET", async () => {
    expect(await run("GET", "http://localhost/x/sales")).toEqual({
      loader: false,
      live: false
    });
  });

  it("marks the loader entries stale after a mutation, and only those", async () => {
    expect(
      await run("POST", "http://localhost/x/sales/customer-types/new")
    ).toEqual({ loader: true, live: false });
  });

  it("leaves the cache alone for a skipped path", async () => {
    expect(await run("POST", "http://localhost/refresh-session")).toEqual({
      loader: false,
      live: false
    });
  });
});
