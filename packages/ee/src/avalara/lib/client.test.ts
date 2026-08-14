import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvalaraHttp } from "./client";

type MockResponseInit = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

function mockResponse({ status, body, headers = {} }: MockResponseInit) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        headers[name] ?? headers[name.toLowerCase()] ?? null
    },
    text: async () => (body === undefined ? "" : JSON.stringify(body))
  } as unknown as Response;
}

function makeClient(fetchImpl: typeof fetch) {
  return new AvalaraHttp({
    environment: "sandbox",
    accountId: "1100012345",
    licenseKey: "super-secret-license-key",
    fetchImpl,
    // No-op sleep so retry backoff/Retry-After never actually delays tests.
    sleepImpl: async () => undefined
  });
}

describe("AvalaraHttp", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends Basic auth + X-Avalara-Client on AvaTax calls", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockResponse({ status: 200, body: { ok: true } }));

    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const { data, error } = await client.request(
      "avatax",
      "GET",
      "/api/v2/utilities/ping"
    );

    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://sandbox-rest.avatax.com/api/v2/utilities/ping");
    const headers = (init as RequestInit).headers as Record<string, string>;
    const expectedBasic = `Basic ${Buffer.from(
      "1100012345:super-secret-license-key"
    ).toString("base64")}`;
    expect(headers.Authorization).toBe(expectedBasic);
    expect(headers["X-Avalara-Client"]).toBe("Carbon; 1.0; REST; v2; carbon");
  });

  it("honors Retry-After on 429 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          status: 429,
          body: { error: { message: "slow down" } },
          headers: { "Retry-After": "1" }
        })
      )
      .mockResolvedValueOnce(
        mockResponse({ status: 200, body: { value: [] } })
      );

    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const { data, error } = await client.request(
      "avatax",
      "GET",
      "/api/v2/companies"
    );

    expect(error).toBeNull();
    expect(data).toEqual({ value: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps 400 to validation with parsed details and does not retry", async () => {
    const details = [
      { code: "MissingLine", message: "A line is required", severity: "Error" }
    ];
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse({
        status: 400,
        body: {
          error: { code: "MissingLine", message: "Bad request", details }
        }
      })
    );

    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const { data, error } = await client.request(
      "avatax",
      "POST",
      "/api/v2/transactions/create",
      { body: { type: "SalesOrder" } }
    );

    expect(data).toBeNull();
    expect(error?.kind).toBe("validation");
    expect(error?.status).toBe(400);
    expect(error?.avalaraCode).toBe("MissingLine");
    expect(error?.details).toEqual(details);
    expect(error?.retryable).toBe(false);
    // 4xx is never retried.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 503 then maps to transient after max retries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ status: 503, body: { error: { message: "down" } } })
      );

    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const { data, error } = await client.request(
      "avatax",
      "GET",
      "/api/v2/companies"
    );

    expect(data).toBeNull();
    expect(error?.kind).toBe("transient");
    // initial + 2 retries.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("maps a timeout abort to transient", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "TimeoutError" })
      );

    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const { data, error } = await client.request(
      "avatax",
      "GET",
      "/api/v2/utilities/ping",
      { timeoutMs: 50 }
    );

    expect(data).toBeNull();
    expect(error?.kind).toBe("transient");
    expect(error?.message).toMatch(/timed out/i);
  });

  it("does not retry a non-retryable POST on 503", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockResponse({ status: 503, body: {} }));

    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const { error } = await client.request(
      "avatax",
      "POST",
      "/api/v2/transactions/create",
      { body: { commit: true }, retryable: false }
    );

    expect(error?.kind).toBe("transient");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never includes the license key in an error message", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ status: 401, body: { error: { message: "nope" } } })
      );

    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const { error } = await client.request(
      "avatax",
      "GET",
      "/api/v2/utilities/ping"
    );

    expect(error?.kind).toBe("auth");
    expect(JSON.stringify(error)).not.toContain("super-secret-license-key");
  });
});
