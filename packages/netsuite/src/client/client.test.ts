import { describe, expect, it } from "vitest";

import { NetSuiteClient } from "./client.ts";
import { NetSuiteError } from "./errors.ts";

const auth = {
  type: "tba" as const,
  accountId: "1234567",
  consumerKey: "ck",
  consumerSecret: "cs",
  tokenId: "tk",
  tokenSecret: "ts"
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
}

/** A fetch stub that replays a scripted list of responses and records calls. */
function scripted(responses: (() => Response)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit
  ) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (!next) throw new Error("no scripted response");
    return next();
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    calls,
    get count() {
      return i;
    }
  };
}

function client(fetchImpl: typeof fetch, overrides = {}) {
  return new NetSuiteClient({
    auth,
    fetch: fetchImpl,
    sleep: async () => {
      /* retries must not actually wait in a test */
    },
    random: () => 0,
    ...overrides
  });
}

describe("NetSuiteClient.request", () => {
  it("signs every request and targets the account host", async () => {
    const s = scripted([() => jsonResponse({ ok: true })]);
    await client(s.fetchImpl).request("GET", "/record/v1/customer");

    expect(s.calls[0]?.url).toBe(
      "https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/customer"
    );
    const headers = s.calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toContain('OAuth realm="1234567"');
  });

  it("retries a 429 and then succeeds", async () => {
    const s = scripted([
      () => jsonResponse({ detail: "limit" }, { status: 429 }),
      () => jsonResponse({ ok: true })
    ]);
    const result = await client(s.fetchImpl).request<{ ok: boolean }>(
      "GET",
      "/x"
    );
    expect(result.ok).toBe(true);
    expect(s.count).toBe(2);
  });

  it("gives up after maxRetries and reports the NetSuite error code", async () => {
    const s = scripted([
      () =>
        jsonResponse(
          {
            "o:errorDetails": [
              {
                detail: "Too many requests",
                "o:errorCode": "SSS_REQUEST_LIMIT_EXCEEDED"
              }
            ]
          },
          { status: 429, headers: { "x-netsuite-operation-id": "op-1" } }
        )
    ]);

    await expect(
      client(s.fetchImpl, { maxRetries: 2 }).request("GET", "/x")
    ).rejects.toMatchObject({
      kind: "rate-limit",
      code: "SSS_REQUEST_LIMIT_EXCEEDED",
      operationId: "op-1",
      retryable: true
    });
    expect(s.count).toBe(3); // initial attempt + 2 retries
  });

  it("does not retry an auth failure", async () => {
    const s = scripted([
      () => jsonResponse({ detail: "Invalid login" }, { status: 401 })
    ]);
    await expect(
      client(s.fetchImpl).request("GET", "/x")
    ).rejects.toMatchObject({ kind: "auth" });
    expect(s.count).toBe(1);
  });

  it("refreshes an OAuth 2.0 token exactly once before failing", async () => {
    let refreshes = 0;
    const s = scripted([
      () => jsonResponse({ detail: "expired" }, { status: 401 })
    ]);
    const oauthClient = new NetSuiteClient({
      auth: {
        type: "oauth2",
        accountId: "1234567",
        accessToken: "old",
        refreshAccessToken: async () => {
          refreshes += 1;
          return "new";
        }
      },
      fetch: s.fetchImpl,
      sleep: async () => {
        /* retries must not actually wait in a test */
      }
    });

    await expect(oauthClient.request("GET", "/x")).rejects.toMatchObject({
      kind: "auth"
    });
    expect(refreshes).toBe(1);
    expect(s.count).toBe(2);
    const headers = s.calls[1]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer new");
  });

  it("returns undefined instead of throwing when a probe 404s", async () => {
    const s = scripted([
      () => jsonResponse({ detail: "no such record type" }, { status: 404 })
    ]);
    const result = await client(s.fetchImpl).request("GET", "/x", {
      throwOnNotFound: false
    });
    expect(result).toBeUndefined();
  });
});

describe("NetSuiteClient.suiteQL", () => {
  it("sends the transient Prefer header and the query in the body", async () => {
    const s = scripted([
      () =>
        jsonResponse({
          items: [{ id: "1" }],
          hasMore: false,
          count: 1,
          totalResults: 1
        })
    ]);
    await client(s.fetchImpl).suiteQL("SELECT id FROM customer");

    const call = s.calls[0];
    expect(call?.url).toContain("/query/v1/suiteql?limit=1000&offset=0");
    expect((call?.init.headers as Record<string, string>).Prefer).toBe(
      "transient"
    );
    expect(JSON.parse(String(call?.init.body))).toEqual({
      q: "SELECT id FROM customer"
    });
  });

  it("caps the page size at NetSuite's 1000-row maximum", async () => {
    const s = scripted([() => jsonResponse({ items: [], hasMore: false })]);
    await client(s.fetchImpl).suiteQL("SELECT 1", { limit: 5000 });
    expect(s.calls[0]?.url).toContain("limit=1000");
  });

  it("walks every page until hasMore is false", async () => {
    const s = scripted([
      () =>
        jsonResponse({
          items: [{ n: 1 }, { n: 2 }],
          hasMore: true,
          count: 2,
          totalResults: 3
        }),
      () =>
        jsonResponse({
          items: [{ n: 3 }],
          hasMore: false,
          count: 1,
          totalResults: 3
        })
    ]);
    const rows = await client(s.fetchImpl).suiteQLRows<{ n: number }>(
      "SELECT 1",
      { pageSize: 2 }
    );
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(s.calls[1]?.url).toContain("offset=2");
  });

  it("stops at maxRows and reports the truncation by returning exactly that many", async () => {
    const s = scripted([
      () => jsonResponse({ items: [{ n: 1 }, { n: 2 }], hasMore: true })
    ]);
    const rows = await client(s.fetchImpl).suiteQLRows<{ n: number }>(
      "SELECT 1",
      {
        pageSize: 2,
        maxRows: 1
      }
    );
    expect(rows).toHaveLength(1);
    expect(s.count).toBe(1);
  });
});

describe("NetSuiteClient.canReadRecordType", () => {
  it("is false for a record type the role or feature set hides", async () => {
    const s = scripted([
      () => jsonResponse({ detail: "not found" }, { status: 404 })
    ]);
    expect(await client(s.fetchImpl).canReadRecordType("assemblyItem")).toBe(
      false
    );
  });

  it("rethrows a failure that is not about availability", async () => {
    const s = scripted([
      () => jsonResponse({ detail: "boom" }, { status: 400 })
    ]);
    await expect(
      client(s.fetchImpl).canReadRecordType("x")
    ).rejects.toBeInstanceOf(NetSuiteError);
  });
});
