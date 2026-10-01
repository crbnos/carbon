// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Env is validated at import time (getEnv throws on missing required vars), so we
// stub the config module rather than requiring a full environment in the test run.
vi.mock("../../config/env", () => ({
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_INTERNAL_URL: "http://supabase.internal.test",
  SUPABASE_URL: "http://supabase.test"
}));

const { fetchWithRetry } = await import("./client");

const jsonResponse = (status: number) =>
  new Response(JSON.stringify({}), { status });

describe("fetchWithRetry", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // Regression test for the quoteToQuote duplicate-quote incident: retrying a
  // 5xx from a non-idempotent Edge Function re-runs its side effects. See
  // .ai/lessons.md for the incident this pins.
  it("does not retry an Edge Function invocation on a 5xx — one attempt only", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(500));

    const response = await fetchWithRetry(
      "http://supabase.internal.test/functions/v1/get-method",
      { method: "POST", body: "{}" }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
  });

  it("does not retry an Edge Function invocation on a network error — the error propagates", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));

    await expect(
      fetchWithRetry("http://supabase.internal.test/functions/v1/get-method", {
        method: "POST",
        body: "{}"
      })
    ).rejects.toThrow("network down");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("still bypasses retry for a storage upload on a 5xx (existing behavior, unchanged)", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(503));

    const response = await fetchWithRetry(
      "http://supabase.internal.test/storage/v1/object/bucket/file.png",
      { method: "PUT", body: "binary" }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
  });

  it("still retries a normal (non-Edge-Function, non-storage) request on a 5xx", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(500))
      .mockResolvedValueOnce(jsonResponse(200));

    const response = await fetchWithRetry(
      "http://supabase.internal.test/rest/v1/quote?id=eq.1",
      { method: "GET" }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  // PostgREST commits before it answers, so a 5xx or a dropped response says
  // nothing about whether the write landed. Retrying is how one insert becomes
  // several rows. Same rule as the Edge Function carve-out above.
  it.each([
    ["POST (insert / upsert / rpc)", "POST"],
    ["PATCH (update)", "PATCH"],
    ["DELETE (delete)", "DELETE"]
  ])("does not retry a PostgREST write on a 5xx — %s", async (_label, method) => {
    fetchSpy.mockResolvedValue(jsonResponse(503));

    const response = await fetchWithRetry(
      "http://supabase.internal.test/rest/v1/quote",
      { method, body: "{}" }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
  });

  it("does not retry a PostgREST write on a network error — the error propagates", async () => {
    fetchSpy.mockRejectedValue(new Error("connection reset"));

    await expect(
      fetchWithRetry("http://supabase.internal.test/rest/v1/quote", {
        method: "POST",
        body: "{}"
      })
    ).rejects.toThrow("connection reset");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("treats a request with no explicit method as a replayable GET", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(500))
      .mockResolvedValueOnce(jsonResponse(200));

    const response = await fetchWithRetry(
      "http://supabase.internal.test/rest/v1/quote?id=eq.1"
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  it("returns a non-retryable status from a normal request on the first attempt", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(404));

    const response = await fetchWithRetry(
      "http://supabase.internal.test/rest/v1/quote?id=eq.1",
      { method: "GET" }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
  });
});
