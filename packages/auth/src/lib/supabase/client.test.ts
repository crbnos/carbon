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

const waitEnded = vi.fn();
const startSpan = vi.fn((_name: string, _attributes: object) => waitEnded);
vi.mock("@carbon/logger/tracing.server", () => ({ startSpan }));

const { getCarbonAPIKeyClient, getCarbonClient, storageReadFetch } =
  await import("./client");
const { requestFetch } = await import("./client.server");
const { requestContextMiddleware } = await import(
  "@carbon/logger/middleware.server"
);
const { RouterContextProvider } = await import("react-router");

// A loader's client carries its request's signal: once the browser has gone,
// what the loader still wants from the database is not worth fetching.
// A client serving one request is bound to it: a share of PostgREST's
// connections, and on a read, the request's abort signal.
describe("a client bound to a request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    startSpan.mockClear();
    waitEnded.mockClear();
  });

  // Resolves only when its signal aborts, as a slow query would.
  const hangingFetch = () =>
    vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          const fail = () =>
            reject(
              new DOMException("This operation was aborted", "AbortError")
            );
          if (init?.signal?.aborted) return fail();
          init?.signal?.addEventListener("abort", fail);
        })
    );

  const pageLoad = (controller: AbortController, method = "GET") =>
    new Request("http://erp.test/x/part/1", {
      method,
      signal: controller.signal
    });

  it("has at most 8 calls in flight", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const client = getCarbonClient(
      "anon",
      "user-jwt",
      requestFetch(pageLoad(controller))
    );

    const calls = Array.from({ length: 12 }, () =>
      client.from("item").select("id")
    ).map((query) => query.then((result) => result));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fetchMock).toHaveBeenCalledTimes(8);
    // The four that queued each opened a wait span, still open.
    expect(startSpan).toHaveBeenCalledTimes(4);
    expect(startSpan).toHaveBeenLastCalledWith("supabase slot wait", {
      "carbon.request.calls_waiting": 4
    });
    expect(waitEnded).not.toHaveBeenCalled();

    controller.abort();
    await Promise.all(calls);
    expect(waitEnded).toHaveBeenCalledTimes(4);
  });

  it("shares the limit between every client built during the request", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await requestContextMiddleware(
      {
        request: pageLoad(controller),
        context: new RouterContextProvider(),
        params: {},
        unstable_pattern: ""
      } as never,
      async () => {
        // A user client and a service-role client, each built without the
        // request in hand, as a service deep in a loader would.
        const user = getCarbonClient("anon", "user-jwt", requestFetch());
        const service = getCarbonClient("service", undefined, requestFetch());
        const calls = Array.from({ length: 6 }, () => [
          user.from("item").select("id"),
          service.from("item").select("id")
        ])
          .flat()
          .map((query) => query.then((result) => result));
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(fetchMock).toHaveBeenCalledTimes(8);
        controller.abort();
        await Promise.all(calls);
        return new Response();
      }
    );
  });

  it("stops a read in flight when the browser leaves, without retrying, and fails later ones at once", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const client = getCarbonClient(
      "anon",
      "user-jwt",
      requestFetch(pageLoad(controller))
    );

    const pending = client.from("item").select("id");
    setTimeout(() => controller.abort(), 5);
    const first = await pending;
    expect(first.error?.message).toContain("AbortError");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await client.from("job").select("id");
    expect(second.error?.message).toContain("AbortError");
  });

  it("leaves RPCs, table writes, auth and edge function calls alone, and every call of an action", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    const read = getCarbonClient(
      "anon",
      "user-jwt",
      requestFetch(pageLoad(controller))
    );
    const invoked = await read.functions.invoke("create", { body: {} });
    expect(invoked.error).toBeNull();
    const written = await read.from("item").update({ name: "x" }).eq("id", "1");
    expect(written.error).toBeNull();
    const rpc = await read.rpc("get_part_details", { item_id: "x" });
    expect(rpc.error).toBeNull();

    const action = getCarbonClient(
      "anon",
      "user-jwt",
      requestFetch(pageLoad(controller, "POST"))
    );
    const selected = await action.from("item").select("id");
    expect(selected.error).toBeNull();

    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal?.aborted ?? false).toBe(false);
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

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
