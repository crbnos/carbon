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

describe("RampClient OAuth (authorization code + refresh)", () => {
  const oauthApp = {
    clientId: "carbon-app",
    clientSecret: "carbon-app-secret"
  };

  it("exchanges an authorization code with the app's Basic auth", async () => {
    let tokenInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (isTokenRequest(url)) {
        tokenInit = init;
        return mockResponse({
          access_token: "acc-1",
          refresh_token: "ref-1",
          expires_in: 3600
        });
      }
      return mockResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new RampClient(
      { type: "oauth2", accessToken: "", environment: "production" },
      { oauthApp }
    );
    const tokens = await client.exchangeAuthorizationCode(
      "the-code",
      "https://erp.example.test/api/integrations/ramp/oauth"
    );

    expect(tokens.accessToken).toBe("acc-1");
    expect(tokens.refreshToken).toBe("ref-1");
    expect(tokens.expiresAt).toBeTypeOf("string");
    // Basic auth uses the OAuth APP credentials, not the (empty) oauth2 creds.
    const expectedBasic = Buffer.from(
      `${oauthApp.clientId}:${oauthApp.clientSecret}`
    ).toString("base64");
    expect((tokenInit?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${expectedBasic}`
    );
    expect(String(tokenInit?.body)).toContain("grant_type=authorization_code");
    expect(String(tokenInit?.body)).toContain("code=the-code");
  });

  it("refreshes an expired oauth2 token and persists the new access token", async () => {
    const refreshed: Array<{ accessToken: string; expiresAt: string }> = [];
    let tokenBody = "";
    let apiAuth: string | undefined;
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (isTokenRequest(url)) {
        tokenBody = String(init?.body);
        return mockResponse({ access_token: "fresh-access", expires_in: 3600 });
      }
      apiAuth = (init?.headers as Record<string, string>).Authorization;
      return mockResponse({ data: [], page: { next: null } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new RampClient(
      {
        type: "oauth2",
        accessToken: "stale-access",
        refreshToken: "the-refresh",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        environment: "production"
      },
      {
        oauthApp,
        onTokensRefreshed: async (tokens) => {
          refreshed.push(tokens);
        }
      }
    );

    await drain(client.listTransactions());

    // A refresh_token grant ran, the persist callback fired, and the API call
    // used the freshly-minted access token.
    expect(tokenBody).toContain("grant_type=refresh_token");
    expect(tokenBody).toContain("refresh_token=the-refresh");
    expect(refreshed).toEqual([
      { accessToken: "fresh-access", expiresAt: expect.any(String) }
    ]);
    expect(apiAuth).toBe("Bearer fresh-access");
  });

  it("uses a still-valid oauth2 token without refreshing", async () => {
    let tokenCalls = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      if (isTokenRequest(url)) {
        tokenCalls++;
        return mockResponse({ access_token: "should-not-be-used" });
      }
      return mockResponse({ data: [], page: { next: null } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new RampClient(
      {
        type: "oauth2",
        accessToken: "valid-access",
        refreshToken: "the-refresh",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        environment: "production"
      },
      { oauthApp }
    );
    await drain(client.listTransactions());

    expect(tokenCalls).toBe(0);
  });

  it("throws when an oauth2 token is expired and there is no refresh token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockResponse({ data: [], page: { next: null } }))
    );
    const client = new RampClient({
      type: "oauth2",
      accessToken: "stale",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      environment: "production"
    });

    await expect(drain(client.listTransactions())).rejects.toThrow(
      /reconnect/i
    );
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
