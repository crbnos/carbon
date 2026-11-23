// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { refreshAccessToken } from "./auth.server";

// The module reads its configuration once, at import.
vi.hoisted(() => {
  vi.stubEnv("DOMAIN", "localhost");
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  vi.stubEnv("SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
});

// Redis as an in-memory map.
const kv = vi.hoisted(() => ({ entries: new Map<string, string>() }));
vi.mock("@carbon/kv", () => ({
  redis: {
    get: async (key: string) => kv.entries.get(key) ?? null,
    set: async (key: string, value: string) => {
      kv.entries.set(key, value);
      return "OK";
    },
    del: async (key: string) => Number(kv.entries.delete(key))
  }
}));

// GoTrue's token endpoint: each refresh token rotates to `<token>-next`.
const refreshes: string[] = [];
let status = 200;
const fakeGoTrue = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  if (url.pathname !== "/auth/v1/token") {
    return new Response("{}", { status: 404 });
  }
  const { refresh_token } = (await request.json()) as { refresh_token: string };
  refreshes.push(refresh_token);
  if (status !== 200) {
    return new Response(JSON.stringify({ error: "refused" }), { status });
  }
  return new Response(
    JSON.stringify({
      access_token: `access-${refresh_token}`,
      refresh_token: `${refresh_token}-next`,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: 2_000_000_000,
      user: { id: "user-1", email: "user@example.com" }
    }),
    { headers: { "Content-Type": "application/json" } }
  );
};

beforeEach(() => {
  kv.entries.clear();
  refreshes.length = 0;
  status = 200;
  vi.stubGlobal("fetch", fakeGoTrue);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(() => vi.unstubAllEnvs());

describe("refreshAccessToken", () => {
  it("refreshes a token once for every request that sends it at the same time", async () => {
    const sessions = await Promise.all(
      Array.from({ length: 6 }, () =>
        refreshAccessToken("token-a", "company-1", "group-1")
      )
    );

    expect(refreshes).toEqual(["token-a"]);
    for (const session of sessions) {
      expect(session?.refreshToken).toBe("token-a-next");
    }
  });

  it("gives a later request with the same token the session already refreshed", async () => {
    await refreshAccessToken("token-a", "company-1", "group-1");
    const later = await refreshAccessToken("token-a", "company-2", "group-2");

    expect(refreshes).toEqual(["token-a"]);
    expect(later).toMatchObject({
      accessToken: "access-token-a",
      refreshToken: "token-a-next",
      companyId: "company-2"
    });
  });

  it("refreshes each token on its own", async () => {
    await refreshAccessToken("token-a", "company-1", "group-1");
    await refreshAccessToken("token-b", "company-1", "group-1");

    expect(refreshes).toEqual(["token-a", "token-b"]);
  });

  it("tries a token again after sign-in was busy", async () => {
    status = 429;
    const busy = await Promise.allSettled([
      refreshAccessToken("token-a", "company-1", "group-1"),
      refreshAccessToken("token-a", "company-1", "group-1")
    ]);
    for (const result of busy) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(Response);
      expect(
        ((result as PromiseRejectedResult).reason as Response).status
      ).toBe(503);
    }

    status = 200;
    await expect(
      refreshAccessToken("token-a", "company-1", "group-1")
    ).resolves.toMatchObject({ refreshToken: "token-a-next" });
    expect(refreshes.at(-1)).toBe("token-a");
  });

  it("does not share a refused token", async () => {
    status = 400;
    await expect(
      refreshAccessToken("token-a", "company-1", "group-1")
    ).resolves.toBeNull();

    status = 200;
    await expect(
      refreshAccessToken("token-a", "company-1", "group-1")
    ).resolves.toMatchObject({ refreshToken: "token-a-next" });
    expect(refreshes).toEqual(["token-a", "token-a"]);
  });
});
