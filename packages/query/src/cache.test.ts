// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { QueryClient } from "@tanstack/react-query";
import type { ClientLoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cachedApiQuery,
  cachedClientLoader,
  getClientCache,
  getCompanyId,
  LOADER,
  loaderQueryKey,
  setClientCompanyId
} from "./cache";
import { invalidateLoaderEntries } from "./invalidation";

describe("during server rendering", () => {
  it("has no company and no client cache", () => {
    setClientCompanyId("company-a");
    expect(getCompanyId()).toBeNull();
    expect(getClientCache()).toBeUndefined();
  });
});

describe("cachedClientLoader", () => {
  const args = (url: string, serverLoader: () => Promise<unknown>) =>
    ({
      request: new Request(url),
      serverLoader
    }) as unknown as ClientLoaderFunctionArgs;

  const inBrowser = (companyId: string | null) => {
    const cache = new QueryClient();
    vi.stubGlobal("window", { clientCache: cache });
    setClientCompanyId(companyId);
    return cache;
  };

  afterEach(() => {
    setClientCompanyId(null);
    vi.unstubAllGlobals();
  });

  it("hydrates, so the cache warms on first load", () => {
    expect(cachedClientLoader().hydrate).toBe(true);
  });

  it("loads one URL once for concurrent and repeated reads", async () => {
    inBrowser("company-a");
    const serverLoader = vi.fn(async () => ({ data: [1] }));
    const load = cachedClientLoader();
    const url = "http://localhost/api/sales/customer-types";

    const [first, second] = await Promise.all([
      load(args(url, serverLoader)),
      load(args(url, serverLoader))
    ]);
    await load(args(url, serverLoader));

    expect(first).toEqual({ data: [1] });
    expect(second).toBe(first);
    expect(serverLoader).toHaveBeenCalledTimes(1);
  });

  it("keys by search string and by company", async () => {
    const cache = inBrowser("company-a");
    const serverLoader = vi.fn(async () => ({}));
    const load = cachedClientLoader();

    await load(args("http://localhost/api/x?locationId=1", serverLoader));
    await load(args("http://localhost/api/x?locationId=2", serverLoader));
    setClientCompanyId("company-b");
    await load(args("http://localhost/api/x?locationId=1", serverLoader));

    expect(serverLoader).toHaveBeenCalledTimes(3);
    expect(
      cache.getQueryData(loaderQueryKey("/api/x?locationId=1", "company-b"))
    ).toEqual({});
  });

  it("loads again after the loader entries are invalidated", async () => {
    const cache = inBrowser("company-a");
    const serverLoader = vi.fn(async () => ({}));
    const load = cachedClientLoader();
    const url = "http://localhost/api/x";

    await load(args(url, serverLoader));
    await cache.invalidateQueries({ queryKey: [LOADER] });
    await load(args(url, serverLoader));

    expect(serverLoader).toHaveBeenCalledTimes(2);
  });

  it("goes straight to the server, uncached, with no company", async () => {
    const cache = inBrowser(null);
    const serverLoader = vi.fn(async () => ({}));

    await cachedClientLoader()(args("http://localhost/api/x", serverLoader));
    await cachedClientLoader()(args("http://localhost/api/x", serverLoader));

    expect(serverLoader).toHaveBeenCalledTimes(2);
    expect(cache.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe("who the cache belongs to", () => {
  const install = () => {
    const cache = new QueryClient();
    vi.stubGlobal("window", { clientCache: cache });
    return cache;
  };
  afterEach(() => {
    setClientCompanyId(null, null);
    vi.unstubAllGlobals();
  });

  it("is emptied when another user takes over the tab", () => {
    const cache = install();
    setClientCompanyId("company-a", "user-a");
    cache.setQueryData(["live", "company-a", "customers"], [{ id: "1" }]);
    cache.setQueryData(loaderQueryKey("/api/x"), []);

    setClientCompanyId("company-a", "user-b");

    expect(cache.getQueryCache().getAll()).toHaveLength(0);
  });

  it("drops a company's loader entries on leaving it, and nothing else", () => {
    const cache = install();
    setClientCompanyId("company-a", "user-a");
    cache.setQueryData(loaderQueryKey("/api/x"), []);
    cache.setQueryData(["live", "company-a", "customers"], [{ id: "1" }]);

    setClientCompanyId("company-b", "user-a");

    expect(
      cache.getQueryData(loaderQueryKey("/api/x", "company-a"))
    ).toBeUndefined();
    expect(cache.getQueryData(["live", "company-a", "customers"])).toEqual([
      { id: "1" }
    ]);
  });

  it("keeps a load that finished after an invalidation stale", async () => {
    const cache = install();
    setClientCompanyId("company-a", "user-a");
    let finish = (_rows: string[]): void => undefined;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise((resolve) => {
          finish = (rows) =>
            resolve(
              new Response(JSON.stringify(rows), {
                headers: { "content-type": "application/json" }
              })
            );
        })
    );

    const load = cachedApiQuery<string[]>("/api/x");
    await Promise.resolve();
    invalidateLoaderEntries(cache);
    finish(["before the mutation"]);

    expect(await load).toEqual(["before the mutation"]);
    expect(cache.getQueryState(loaderQueryKey("/api/x"))?.isInvalidated).toBe(
      true
    );
  });
});
