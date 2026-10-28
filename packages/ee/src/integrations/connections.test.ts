// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountIdentity,
  ConnectionRejectedError,
  connectionsHealthy,
  connectionUsable,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  expiringSoon,
  grantedScopes,
  missingScopes,
  sameAccount,
  usableConnections
} from "./connections";

// The functions that read and write `integrationConnection` and the vault
// (createConnection, resolveConnectionAuth's refresh claim, disconnect) are not
// tested here: faking PostgREST and the vault would test the fake. Their pure
// decisions are below, and the token endpoint is stubbed at `fetch`.

const OAUTH = {
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: "client-id",
  clientSecret: "client-secret"
};

describe("accountIdentity", () => {
  it("names a Slack workspace by its team, whatever it is called", () => {
    expect(accountIdentity("Acme", { team_id: "T1" })).toBe("team:T1");
  });

  it("falls back to the account label, and to nothing", () => {
    expect(accountIdentity("ops@example.com", {})).toBe(
      "label:ops@example.com"
    );
    expect(accountIdentity("ops@example.com", { team_id: "" })).toBe(
      "label:ops@example.com"
    );
    expect(accountIdentity(null, null)).toBeNull();
  });
});

// Without this check every saved workflow on a row silently started acting as
// whoever signed in on Reconnect.
describe("sameAccount", () => {
  it("refuses a consent from a different account", () => {
    expect(
      sameAccount(
        { accountLabel: "ops@example.com", metadata: {} },
        { accountLabel: "someone-else@example.com" }
      )
    ).toBe(false);
  });

  it("accepts a workspace that was renamed but is the same team", () => {
    expect(
      sameAccount(
        { accountLabel: "Old name", metadata: { team_id: "T1" } },
        { accountLabel: "New name", metadata: { team_id: "T1" } }
      )
    ).toBe(true);
  });

  it("accepts any account for a row that was never identified", () => {
    expect(
      sameAccount(
        { accountLabel: null, metadata: {} },
        { accountLabel: "ops@example.com" }
      )
    ).toBe(true);
  });

  // A failed label read must not let another account take over the row.
  it("refuses an unidentified consent on an identified row", () => {
    expect(
      sameAccount(
        { accountLabel: "ops@example.com", metadata: {} },
        { accountLabel: null }
      )
    ).toBe(false);
  });
});

describe("expiringSoon", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never expires a token with no expiry (Slack bot tokens)", () => {
    expect(expiringSoon(null)).toBe(false);
  });

  it("refreshes inside the five-minute window and after expiry", () => {
    expect(expiringSoon("2026-10-21T12:04:00Z")).toBe(true);
    expect(expiringSoon("2026-10-21T12:05:00Z")).toBe(true);
    expect(expiringSoon("2026-10-21T11:00:00Z")).toBe(true);
  });

  it("leaves a token alone outside the window", () => {
    expect(expiringSoon("2026-10-21T12:05:01Z")).toBe(false);
  });
});

describe("the token endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const answer = (body: unknown, status = 200) =>
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(typeof body === "string" ? body : JSON.stringify(body), {
          status
        })
      )
    );

  // Only `invalid_grant` says the grant itself is gone, so only it condemns the
  // connection.
  it("rejects the connection when the vendor says invalid_grant", async () => {
    answer({ error: "invalid_grant" }, 400);
    await expect(exchangeRefreshToken(OAUTH, "rt-1")).rejects.toBeInstanceOf(
      ConnectionRejectedError
    );
  });

  // A wrong client secret on Carbon's side answers every refresh with
  // `invalid_client`. That is ours to fix, not the customer's grant to revoke.
  it("keeps an error about Carbon's own OAuth app retryable", async () => {
    answer({ error: "invalid_client" }, 401);
    const refused = exchangeRefreshToken(OAUTH, "rt-1");
    await expect(refused).rejects.toThrow("401: invalid_client");
    await expect(refused).rejects.not.toBeInstanceOf(ConnectionRejectedError);
  });

  // A wifi blip at the moment the access token expired once flipped a working
  // Google account to Expired for good.
  it("keeps a vendor 5xx and a network failure retryable", async () => {
    answer("<html>Service Unavailable</html>", 503);
    const down = exchangeRefreshToken(OAUTH, "rt-1");
    await expect(down).rejects.toThrow("(503)");
    await expect(down).rejects.not.toBeInstanceOf(ConnectionRejectedError);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    );
    await expect(exchangeRefreshToken(OAUTH, "rt-1")).rejects.toBeInstanceOf(
      TypeError
    );
  });

  // Slack answers a bad exchange with HTTP 200 and `{ ok: false, error }`; the
  // error name must reach the log.
  it("names the vendor's in-body error when a 200 carries no token", async () => {
    answer({ ok: false, error: "invalid_code" });
    await expect(exchangeRefreshToken(OAUTH, "rt-1")).rejects.toThrow(
      "invalid_code"
    );
  });

  it("reads the token pair and its expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    answer({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 });

    const tokens = await exchangeRefreshToken(OAUTH, "rt-1");
    expect(tokens.accessToken).toBe("at-2");
    expect(tokens.refreshToken).toBe("rt-2");
    expect(tokens.expiresAt).toBe("2026-10-21T13:00:00.000Z");
  });

  // Google omits the refresh token on a refresh response; the caller keeps the
  // stored one, so it must come back undefined rather than as a value.
  it("leaves out what the vendor did not send", async () => {
    answer({ access_token: "at-2" });
    const tokens = await exchangeRefreshToken(OAUTH, "rt-1");
    expect(tokens.refreshToken).toBeUndefined();
    expect(tokens.expiresAt).toBeNull();
  });

  it("exposes the parsed token response so a row can pick workspace facts", async () => {
    answer({ access_token: "a", team: { name: "Acme" } });
    const tokens = await exchangeAuthorizationCode(
      { ...OAUTH, redirectUri: "https://erp.test/cb" },
      "code"
    );
    expect(tokens.accessToken).toBe("a");
    expect((tokens.body.team as { name: string }).name).toBe("Acme");
  });
});

describe("connectionsHealthy", () => {
  const at = (status: string) => ({ status }) as never;

  // The card reports health from this. Without a check of its own, `resolveHealth`
  // defaults every integration to "healthy" — so a revoked Google account showed a
  // green HEALTHY badge while every workflow step using it failed.
  it("is unhealthy when every account has gone bad", () => {
    expect(connectionsHealthy([at("Revoked")])).toBe(false);
    expect(connectionsHealthy([at("Revoked"), at("Expired")])).toBe(false);
  });

  it("is healthy while at least one account still works", () => {
    expect(connectionsHealthy([at("Revoked"), at("Active")])).toBe(true);
    expect(connectionsHealthy([at("Active")])).toBe(true);
  });

  // Not yet connected is not broken: the card is Installed and both it and the
  // builder already offer a Connect button, so red here would be noise.
  it("is healthy with no accounts at all", () => {
    expect(connectionsHealthy([])).toBe(true);
  });

  /**
   * An expired token is the NORMAL state — the next use refreshes it. Judging
   * usability by expiry instead of by status hid a working account from the
   * builder's dropdown while Settings still listed it, which is the mismatch that
   * replaced the original bug. Status is the only signal; the refresh path is what
   * writes it.
   */
  it("is healthy for an Active account whose token has expired", () => {
    const longDead = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(
      connectionsHealthy([{ status: "Active", expiresAt: longDead } as never])
    ).toBe(true);
  });
});

/**
 * Settings and the builder each decided "is this app connected?" for themselves,
 * and disagreed: the card read `companyIntegration.active` (written once, at
 * install) while the node counted `integrationConnection` rows. Disconnecting the
 * last account left Settings saying Installed/Healthy and the node saying "isn't
 * connected yet" at the same time.
 *
 * `connectionUsable` is now the single answer both derive from, so these pin the
 * one definition rather than each surface's copy of it.
 */
describe("connectionUsable is the one definition of a usable account", () => {
  const at = (status: string) => ({ status }) as never;

  it("counts only an Active account", () => {
    expect(connectionUsable(at("Active"))).toBe(true);
    expect(connectionUsable(at("Revoked"))).toBe(false);
    expect(connectionUsable(at("Expired"))).toBe(false);
  });

  // A revoked account in the builder's dropdown is a trap: picking it builds a
  // workflow that cannot run, and the author gets a vendor error at run time
  // rather than a "reconnect this" they could act on while editing.
  it("filters a broken account out of the list a workflow can pick from", () => {
    const rows = [
      { id: "a", status: "Revoked" },
      { id: "b", status: "Active" },
      { id: "c", status: "Expired" }
    ] as never[];
    expect(
      usableConnections(rows).map((row) => (row as { id: string }).id)
    ).toEqual(["b"]);
  });

  // The health badge and the builder must not be able to disagree. If a piece has
  // accounts, "healthy" and "the builder offers something" are the same question.
  it("agrees with the health badge whenever accounts exist", () => {
    for (const statuses of [
      ["Active"],
      ["Revoked"],
      ["Revoked", "Active"],
      ["Expired", "Revoked"]
    ]) {
      const rows = statuses.map(at);
      expect(usableConnections(rows).length > 0).toBe(connectionsHealthy(rows));
    }
  });
});

describe("scopes", () => {
  // Slack's token response separates with commas; the v2 backfill wrote spaces.
  it("parses either separator and treats nothing recorded as unknown", () => {
    expect(grantedScopes({ metadata: { scopes: "a,b" } })).toEqual(["a", "b"]);
    expect(grantedScopes({ metadata: { scopes: "a b" } })).toEqual(["a", "b"]);
    expect(grantedScopes({ metadata: {} })).toBeNull();
    expect(grantedScopes({ metadata: { scopes: "" } })).toBeNull();
  });

  it("names what is missing, and nothing when grants are unknown", () => {
    expect(missingScopes({ metadata: { scopes: "a" } }, ["a", "c"])).toEqual([
      "c"
    ]);
    expect(missingScopes({ metadata: {} }, ["a", "c"])).toEqual([]);
  });
});
