// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, describe, expect, it, vi } from "vitest";

// Env is validated at import time (getEnv throws on missing required vars), so we
// stub the config module rather than requiring a full environment in the test run.
vi.mock("../../config/env", () => ({
  SUPABASE_ANON_KEY: "sb_publishable_anon",
  SUPABASE_INTERNAL_URL: "http://supabase.internal.test",
  SUPABASE_URL: "http://supabase.test"
}));

const { getCarbonAPIKeyClient, getCarbonClient, storageReadFetch } =
  await import("./client");

// Edge functions recognise a service-role caller by the Authorization bearer.
// supabase-js stops sending a new-format key as that bearer on function calls,
// so the client must set it itself for either key format.
describe("Edge Function calls carry the Authorization bearer", () => {
  const sent = () => {
    const [input, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(
      input instanceof Request ? input.headers : init?.headers
    );
    return headers.get("Authorization");
  };

  const stubFetch = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 }))
    );

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["a legacy JWT key", "eyJhbGciOiJIUzI1NiJ9.e30.signature"],
    ["a new-format secret key", "sb_secret_abc123"]
  ])("service-role client with %s", async (_, key) => {
    stubFetch();
    await getCarbonClient(key).functions.invoke("create", { body: {} });
    expect(sent()).toBe(`Bearer ${key}`);
  });

  it("a user's token wins over the key", async () => {
    stubFetch();
    await getCarbonClient("sb_secret_abc123", "user-jwt").functions.invoke(
      "create",
      { body: {} }
    );
    expect(sent()).toBe("Bearer user-jwt");
  });

  it("API-key client", async () => {
    stubFetch();
    await getCarbonAPIKeyClient("crbn_key").functions.invoke("create", {
      body: {}
    });
    expect(sent()).toBe("Bearer sb_publishable_anon");
  });
});

describe("storage reads are retried, everything else passes through", () => {
  const storage = "http://supabase.internal.test/storage/v1";

  const respond = (...statuses: number[]) => {
    const fetchMock = vi.fn();
    for (const status of statuses) {
      fetchMock.mockResolvedValueOnce(new Response("{}", { status }));
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  const settle = async <T>(promise: Promise<T>) => {
    await vi.runAllTimersAsync();
    return promise;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries a download after a 5xx", async () => {
    vi.useFakeTimers();
    const fetchMock = respond(503, 200);
    const response = await settle(
      storageReadFetch(`${storage}/object/co_1/a.pdf`, { method: "GET" })
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a listing, which is a POST", async () => {
    vi.useFakeTimers();
    const fetchMock = respond(502, 502, 200);
    const response = await settle(
      storageReadFetch(`${storage}/object/list-v2/co_1`, { method: "POST" })
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after two retries and returns the last answer", async () => {
    vi.useFakeTimers();
    const fetchMock = respond(500, 500, 500);
    const response = await settle(
      storageReadFetch(`${storage}/object/co_1/a.pdf`)
    );
    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never replays an upload", async () => {
    const fetchMock = respond(500);
    const response = await storageReadFetch(`${storage}/object/co_1/a.pdf`, {
      method: "POST",
      body: "bytes"
    });
    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves database reads to supabase-js", async () => {
    const fetchMock = respond(503);
    await storageReadFetch("http://supabase.internal.test/rest/v1/item", {
      method: "GET"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
