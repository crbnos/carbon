// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { QueryClient } from "@tanstack/react-query";
import type { ClientLoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cachedClientLoader,
  getClientCache,
  getCompanyId,
  LOADER,
  loaderQueryKey,
  setClientCompanyId
} from "./react-query";

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
      cache.getQueryData(loaderQueryKey("/api/x?locationId=1", "company-a"))
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
