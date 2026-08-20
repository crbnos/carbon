import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fromMinorUnits,
  RampClient,
  type RampCredentials,
  RampRateLimitError
} from "../index";

const credentials: RampCredentials = {
  type: "client_credentials",
  clientId: "ramp-client",
  clientSecret: "ramp-secret",
  environment: "sandbox"
};

/** Minimal Response stand-in exercising only the fields RampClient reads. */
function mockResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
) {
  const status = init.status ?? 200;
  const headers = init.headers ?? {};
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "MockStatus",
    headers: {
      get: (key: string) => headers[key] ?? headers[key.toLowerCase()] ?? null
    },
    text: async () => text,
    json: async () => JSON.parse(text)
  } as unknown as Response;
}

function isTokenRequest(url: unknown): boolean {
  return String(url).includes("/developer/v1/token");
}

async function drain<T>(gen: AsyncGenerator<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for await (const page of gen) rows.push(...page);
  return rows;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fromMinorUnits", () => {
  it("converts USD cents to dollars", () => {
    expect(fromMinorUnits(4000, "USD", 2)).toBe(40);
  });

  it("passes through a zero-decimal currency (JPY)", () => {
    expect(fromMinorUnits(63, "JPY", 0)).toBe(63);
  });
});

describe("RampClient token cache", () => {
  it("re-mints the token when it has expired", async () => {
    let tokenCalls = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      if (isTokenRequest(url)) {
        tokenCalls++;
        // 30s < the 60s refresh margin → cache is treated as expired.
        return mockResponse({
          access_token: `tok-${tokenCalls}`,
          expires_in: 30
        });
      }
      return mockResponse({ data: [], page: { next: null } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new RampClient(credentials);
    await drain(client.listTransactions());
    await drain(client.listTransactions());

    expect(tokenCalls).toBe(2);
  });

  it("reuses a still-valid cached token", async () => {
    let tokenCalls = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      if (isTokenRequest(url)) {
        tokenCalls++;
        return mockResponse({ access_token: "tok", expires_in: 3600 });
      }
      return mockResponse({ data: [], page: { next: null } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new RampClient(credentials);
    await drain(client.listTransactions());
    await drain(client.listTransactions());

    expect(tokenCalls).toBe(1);
  });
});

describe("RampClient rate limiting", () => {
  it("throws RampRateLimitError carrying Retry-After on a 429", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (isTokenRequest(url)) {
        return mockResponse({ access_token: "tok", expires_in: 3600 });
      }
      return mockResponse(
        { error_v2: { message: "slow down" } },
        { status: 429, headers: { "Retry-After": "17" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new RampClient(credentials);
    let caught: unknown;
    try {
      await drain(client.listTransactions());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RampRateLimitError);
    expect((caught as RampRateLimitError).retryAfterSeconds).toBe(17);
  });
});

describe("RampClient pagination", () => {
  it("follows page.next twice then stops", async () => {
    const nextUrl =
      "https://demo-api.ramp.com/developer/v1/transactions?start=cursor&page_size=100";
    let dataCalls = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      if (isTokenRequest(url)) {
        return mockResponse({ access_token: "tok", expires_in: 3600 });
      }
      dataCalls++;
      const next = dataCalls < 3 ? nextUrl : null;
      return mockResponse({
        data: [{ id: `tx-${dataCalls}` }],
        page: { next }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new RampClient(credentials);
    const pages: Array<Array<{ id: string }>> = [];
    for await (const page of client.listTransactions()) {
      pages.push(page);
    }

    expect(pages).toHaveLength(3);
    expect(dataCalls).toBe(3);
    expect(pages.flat().map((tx) => tx.id)).toEqual(["tx-1", "tx-2", "tx-3"]);
  });
});
