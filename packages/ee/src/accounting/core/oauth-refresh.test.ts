import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountingAuthError, createOAuthClient } from "./utils";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });

function makeClient(
  overrides: Partial<Parameters<typeof createOAuthClient>[0]> = {}
) {
  return createOAuthClient({
    clientId: "id",
    clientSecret: "secret",
    tokenUrl: "https://identity.example.com/connect/token",
    accessToken: "at-old",
    refreshToken: "rt-old",
    getAuthUrl: () => "",
    ...overrides
  });
}

describe("createOAuthClient.refresh", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws AccountingAuthError when the token endpoint refuses the grant", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(400, {
        error: "invalid_grant",
        error_description: "Refresh token not found"
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    const error = await client.refresh().catch((e) => e);

    expect(error).toBeInstanceOf(AccountingAuthError);
    expect(error.code).toBe(400);
    expect(error.provider).toBe("identity.example.com");
    expect(error.message).toContain("Refresh token not found");
  });

  it("keeps other failures as plain errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(503, { error: "temporarily_unavailable" }))
    );

    const error = await makeClient()
      .refresh()
      .catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AccountingAuthError);
  });

  it("adopts a pair another runner already rotated instead of refreshing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onTokenRefresh = vi.fn();

    const client = makeClient({
      beforeRefresh: async () => ({
        accessToken: "at-new",
        refreshToken: "rt-new"
      }),
      onTokenRefresh
    });

    const creds = await client.refresh();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onTokenRefresh).not.toHaveBeenCalled();
    expect(creds).toMatchObject({
      accessToken: "at-new",
      refreshToken: "rt-new"
    });
    expect(client.getCredentials()).toMatchObject({ refreshToken: "rt-new" });
  });

  it("refreshes normally when the stored pair is the one it holds", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        access_token: "at-fresh",
        refresh_token: "rt-fresh",
        expires_in: 1800
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const onTokenRefresh = vi.fn();

    const client = makeClient({
      beforeRefresh: async () => ({
        accessToken: "at-old",
        refreshToken: "rt-old"
      }),
      onTokenRefresh
    });

    const creds = await client.refresh();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(creds).toMatchObject({ refreshToken: "rt-fresh" });
    expect(onTokenRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "rt-fresh" })
    );
  });
});
