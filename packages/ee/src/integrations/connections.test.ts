import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionRevokedError,
  connectionsHealthy,
  connectionUsable,
  createConnection,
  exchangeAuthorizationCode,
  grantedScopes,
  missingScopes,
  readConnectionAccessToken,
  resolveConnectionAuth,
  usableConnections
} from "./connections";

const COMPANY = "cmp_1";
const CONNECTION = "icn_1";
const OAUTH = {
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: "client-id",
  clientSecret: "client-secret"
};

interface Row {
  id: string;
  companyId: string;
  pieceName: string;
  name: string;
  authType: string;
  accountLabel: string | null;
  metadata: Record<string, unknown>;
  expiresAt: string | null;
  refreshingAt: string | null;
  status: string;
  lastError: string | null;
  secretRef: string | null;
}

/** A hand-rolled stand-in for the slice of supabase-js these functions touch. */
function makeClient(initial?: Partial<Row>) {
  const rows = new Map<string, Row>();
  const vault = new Map<string, Record<string, unknown>>();
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

  if (initial !== undefined) {
    rows.set(CONNECTION, {
      id: CONNECTION,
      companyId: COMPANY,
      pieceName: "google-calendar",
      name: "Ops calendar",
      authType: "OAUTH2",
      accountLabel: null,
      metadata: {},
      expiresAt: null,
      refreshingAt: null,
      status: "Active",
      lastError: null,
      secretRef: "ref",
      ...initial
    });
  }

  const matching = (filters: Record<string, unknown>) =>
    [...rows.values()].filter((row) =>
      Object.entries(filters).every(
        ([key, value]) => row[key as keyof Row] === value
      )
    );

  function builder(operation: "select" | "update", patch?: object) {
    const filters: Record<string, unknown> = {};
    const ltFilters: Record<string, string> = {};
    let orClause: string | undefined;

    const self = {
      eq(column: string, value: unknown) {
        filters[column] = value;
        return self;
      },
      or(clause: string) {
        orClause = clause;
        return self;
      },
      is(column: string, value: unknown) {
        filters[column] = value;
        return self;
      },
      lt(column: string, value: string) {
        ltFilters[column] = value;
        return self;
      },
      order() {
        return Promise.resolve({ data: matching(filters), error: null });
      },
      select() {
        return self;
      },
      maybeSingle() {
        return Promise.resolve({
          data: matching(filters)[0] ?? null,
          error: null
        });
      },
      single() {
        const row = matching(filters)[0];
        return Promise.resolve(
          row === undefined
            ? { data: null, error: new Error("not found") }
            : { data: row, error: null }
        );
      },
      then(
        resolve: (value: {
          data: unknown;
          error: { message: string } | null;
        }) => unknown
      ) {
        // What the REAL PostgREST does (13.0.8): the or-tree of a mutation is
        // built with an unquoted table qualifier, so on this camelCase table
        // every `.or(...)` UPDATE fails with 42703. The fake used to honour the
        // filter instead — which is exactly how a claim that never once
        // succeeded in production stayed green in here.
        if (operation === "update" && orClause !== undefined) {
          return resolve({
            data: null,
            error: {
              message:
                "column integrationConnection.refreshingAt does not exist"
            }
          });
        }
        let targets = matching(filters).filter((row) =>
          Object.entries(ltFilters).every(([key, value]) => {
            const held = row[key as keyof Row];
            return typeof held === "string" && held < value;
          })
        );
        if (operation === "update") {
          for (const row of targets) Object.assign(row, patch);
        }
        return resolve({ data: targets, error: null });
      }
    };
    return self;
  }

  const client = {
    from() {
      return {
        select: () => builder("select"),
        update: (patch: object) => builder("update", patch),
        insert: (patch: object) => ({
          select: () => ({
            single: () => {
              const row = {
                ...(patch as Row),
                id: CONNECTION,
                refreshingAt: null,
                secretRef: null
              };
              rows.set(row.id, row);
              return Promise.resolve({ data: row, error: null });
            }
          })
        })
      };
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "upsert_connection_secret") {
        vault.set(
          args.p_connection_id as string,
          args.p_secret as Record<string, unknown>
        );
        return Promise.resolve({ data: "ref", error: null });
      }
      if (name === "get_connection_secret") {
        return Promise.resolve({
          data: vault.get(args.p_connection_id as string) ?? null,
          error: null
        });
      }
      if (name === "delete_connection_secret") {
        vault.delete(args.p_connection_id as string);
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }
  } as unknown as SupabaseClient<Database>;

  return { client, rows, vault, rpcCalls };
}

const inMinutes = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

describe("createConnection", () => {
  it("writes tokens to the vault and never into metadata", async () => {
    const { client, rows, vault } = makeClient();

    await createConnection(client, {
      companyId: COMPANY,
      pieceName: "google-calendar",
      name: "Ops calendar",
      metadata: { calendarSummary: "Ops" },
      tokens: { accessToken: "at-1", refreshToken: "rt-1" },
      expiresAt: inMinutes(60),
      createdBy: "usr_1"
    });

    expect(vault.get(CONNECTION)).toEqual({
      accessToken: "at-1",
      refreshToken: "rt-1"
    });
    const stored = JSON.stringify(rows.get(CONNECTION)!.metadata);
    expect(stored).not.toContain("at-1");
    expect(stored).not.toContain("rt-1");
    expect(stored).not.toContain("accessToken");
    expect(stored).not.toContain("refreshToken");
  });
});

describe("resolveConnectionAuth", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the stored token when it is far from expiry", async () => {
    const { client } = makeClient({ expiresAt: inMinutes(60) });
    await client.rpc("upsert_connection_secret", {
      p_company_id: COMPANY,
      p_connection_id: CONNECTION,
      p_secret: { accessToken: "at-1", refreshToken: "rt-1" } as never
    });

    const { accessToken } = await resolveConnectionAuth(
      client,
      COMPANY,
      CONNECTION,
      OAUTH
    );
    expect(accessToken).toBe("at-1");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes exactly once when two callers race, and the loser sees the new token", async () => {
    const { client } = makeClient({ expiresAt: inMinutes(1) });
    await client.rpc("upsert_connection_secret", {
      p_company_id: COMPANY,
      p_connection_id: CONNECTION,
      p_secret: { accessToken: "at-1", refreshToken: "rt-1" } as never
    });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at-2", expires_in: 3600 })
    } as Response);

    const [first, second] = await Promise.all([
      resolveConnectionAuth(client, COMPANY, CONNECTION, OAUTH),
      resolveConnectionAuth(client, COMPANY, CONNECTION, OAUTH)
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first.accessToken).toBe("at-2");
    expect(second.accessToken).toBe("at-2");
  });

  // A crashed refresher must not hold the claim forever: a claim past the stale
  // window is abandoned, and the next caller takes it over instead of polling
  // out the clock behind it.
  it("takes over a claim whose holder has been gone too long", async () => {
    const { client, rows } = makeClient({ expiresAt: inMinutes(1) });
    rows.get(CONNECTION)!.refreshingAt = new Date(
      Date.now() - 60 * 1000
    ).toISOString();
    await client.rpc("upsert_connection_secret", {
      p_company_id: COMPANY,
      p_connection_id: CONNECTION,
      p_secret: { accessToken: "at-1", refreshToken: "rt-1" } as never
    });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at-2", expires_in: 3600 })
    } as Response);

    const { accessToken } = await resolveConnectionAuth(
      client,
      COMPANY,
      CONNECTION,
      OAUTH
    );

    expect(accessToken).toBe("at-2");
    expect(rows.get(CONNECTION)!.refreshingAt).toBeNull();
  });

  it("keeps the stored refresh token when the vendor omits one", async () => {
    const { client, vault } = makeClient({ expiresAt: inMinutes(1) });
    await client.rpc("upsert_connection_secret", {
      p_company_id: COMPANY,
      p_connection_id: CONNECTION,
      p_secret: { accessToken: "at-1", refreshToken: "rt-1" } as never
    });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at-2", expires_in: 3600 })
    } as Response);

    await resolveConnectionAuth(client, COMPANY, CONNECTION, OAUTH);
    expect(vault.get(CONNECTION)).toEqual({
      accessToken: "at-2",
      refreshToken: "rt-1"
    });
  });

  it("refuses a revoked connection", async () => {
    const { client } = makeClient({ status: "Revoked" });
    await expect(
      resolveConnectionAuth(client, COMPANY, CONNECTION, OAUTH)
    ).rejects.toBeInstanceOf(ConnectionRevokedError);
  });

  it("marks the connection Expired when the vendor rejects the refresh", async () => {
    const { client, rows } = makeClient({ expiresAt: inMinutes(1) });
    await client.rpc("upsert_connection_secret", {
      p_company_id: COMPANY,
      p_connection_id: CONNECTION,
      p_secret: { accessToken: "at-1", refreshToken: "rt-1" } as never
    });

    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400 } as Response);

    await expect(
      resolveConnectionAuth(client, COMPANY, CONNECTION, OAUTH)
    ).rejects.toBeInstanceOf(ConnectionRevokedError);
    expect(rows.get(CONNECTION)!.status).toBe("Expired");
    expect(rows.get(CONNECTION)!.lastError).toContain("400");
  });

  // A wifi blip at the moment the access token expired flipped a working Google
  // account to Expired for good: every throw from the refresh — including undici's
  // `fetch failed` — was read as the vendor revoking us.
  it.each([
    ["the network fails", () => Promise.reject(new TypeError("fetch failed"))],
    [
      "the vendor returns a 5xx",
      () => Promise.resolve({ ok: false, status: 503 } as Response)
    ]
  ])("keeps the connection Active when %s during a refresh", async (_, impl) => {
    const { client, rows } = makeClient({ expiresAt: inMinutes(1) });
    await client.rpc("upsert_connection_secret", {
      p_company_id: COMPANY,
      p_connection_id: CONNECTION,
      p_secret: { accessToken: "at-1", refreshToken: "rt-1" } as never
    });

    vi.mocked(fetch).mockImplementation(impl as typeof fetch);

    await expect(
      resolveConnectionAuth(client, COMPANY, CONNECTION, OAUTH)
    ).rejects.not.toBeInstanceOf(ConnectionRevokedError);
    expect(rows.get(CONNECTION)!.status).toBe("Active");
    expect(rows.get(CONNECTION)!.lastError).toBeNull();
    // The claim is released so the retry does not wait out a phantom refresh.
    expect(rows.get(CONNECTION)!.refreshingAt).toBeNull();
  });

  // Slack answers a bad refresh with HTTP 200 and `{ ok: false, error }`. That is not
  // a 4xx, so it is not a definitive rejection — but the error name must reach the log.
  it("names the vendor's in-body error when a 200 carries no token", async () => {
    const { client, rows } = makeClient({ expiresAt: inMinutes(1) });
    await client.rpc("upsert_connection_secret", {
      p_company_id: COMPANY,
      p_connection_id: CONNECTION,
      p_secret: { accessToken: "at-1", refreshToken: "rt-1" } as never
    });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: "invalid_code" })
    } as Response);

    await expect(
      resolveConnectionAuth(client, COMPANY, CONNECTION, OAUTH)
    ).rejects.toThrow("invalid_code");
    expect(rows.get(CONNECTION)!.status).toBe("Active");
    expect(rows.get(CONNECTION)!.refreshingAt).toBeNull();
  });

  // A connection that has gone bad is exactly the one a customer wants to re-add —
  // and `disconnectConnection` keeps the row (a saved workflow node references its
  // id), while the name is unique per piece. So re-consenting under the same name
  // hit the unique constraint and failed with "save-failed", leaving no way back.
  it("revives an existing connection instead of colliding with its name", async () => {
    const { client, rows } = makeClient({ expiresAt: inMinutes(60) });
    const row = rows.get(CONNECTION)!;
    row.status = "Revoked";
    row.lastError = "The connection was rejected (400).";

    const { id } = await createConnection(client, {
      companyId: COMPANY,
      pieceName: row.pieceName,
      name: row.name,
      tokens: { accessToken: "at-new", refreshToken: "rt-new" },
      expiresAt: inMinutes(60),
      createdBy: "u1"
    });

    // The SAME row, so every workflow node still pointing at it keeps working.
    expect(id).toBe(CONNECTION);
    expect(rows.size).toBe(1);
    expect(rows.get(CONNECTION)!.status).toBe("Active");
    expect(rows.get(CONNECTION)!.lastError).toBeNull();

    // And the new credentials really landed, not just the status.
    const { data } = await client.rpc("get_connection_secret", {
      p_company_id: COMPANY,
      p_connection_id: CONNECTION
    });
    expect(data).toMatchObject({ accessToken: "at-new" });
  });

  // The bug behind a constantly-failing calendar dropdown: `claimRefresh` writes a
  // fresh `refreshingAt` when it wins, and only the token EXCHANGE was guarded. A
  // throw while storing the new token left that claim standing, so every later
  // request lost the claim and polled the full 5 seconds before timing out — with
  // the connection still reading Active, so nothing pointed at the cause.
  it("releases the refresh claim when storing the new token fails", async () => {
    const { client, rows } = makeClient({ expiresAt: inMinutes(1) });
    await client.rpc("upsert_connection_secret", {
      p_company_id: COMPANY,
      p_connection_id: CONNECTION,
      p_secret: { accessToken: "at-1", refreshToken: "rt-1" } as never
    });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at-2", expires_in: 3600 })
    } as Response);

    // The vault write fails — the token is fine, storing it is not.
    const rpc = client.rpc.bind(client);
    client.rpc = ((name: string, args: unknown) =>
      name === "upsert_connection_secret"
        ? Promise.reject(new Error("vault unavailable"))
        : rpc(name as never, args as never)) as unknown as typeof client.rpc;

    await expect(
      resolveConnectionAuth(client, COMPANY, CONNECTION, OAUTH)
    ).rejects.toThrow("vault unavailable");

    // The claim must not survive the failure, or the next attempt waits 5s for a
    // refresh that already gave up.
    expect(rows.get(CONNECTION)!.refreshingAt).toBeNull();
    // And the connection is NOT condemned — the token itself was never rejected.
    expect(rows.get(CONNECTION)!.status).toBe("Active");
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
 * connected yet" — the exact contradiction a customer reported.
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

describe("readConnectionAccessToken", () => {
  const seed = async (client: ReturnType<typeof makeClient>["client"]) =>
    client.rpc("upsert_connection_secret", {
      p_company_id: COMPANY,
      p_connection_id: CONNECTION,
      p_secret: { accessToken: "at-1" } as never
    });

  // Slack bot tokens never expire, so the Assistant reads them without a refresh.
  it("returns the stored token for an Active connection with no expiry", async () => {
    const { client } = makeClient({ expiresAt: null });
    await seed(client);
    await expect(
      readConnectionAccessToken(client, COMPANY, CONNECTION)
    ).resolves.toBe("at-1");
  });

  it("refuses a connection that is not Active", async () => {
    const { client } = makeClient({ status: "Revoked" });
    await seed(client);
    await expect(
      readConnectionAccessToken(client, COMPANY, CONNECTION)
    ).rejects.toBeInstanceOf(ConnectionRevokedError);
  });

  // A refreshable vendor must go through the refresh claim, never around it.
  it("refuses an expiring token instead of handing out a stale one", async () => {
    const { client } = makeClient({ expiresAt: inMinutes(1) });
    await seed(client);
    await expect(
      readConnectionAccessToken(client, COMPANY, CONNECTION)
    ).rejects.toThrow(/resolveConnectionAuth/);
  });
});

describe("exchangeAuthorizationCode", () => {
  it("exposes the parsed token response so a row can pick workspace facts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "a", team: { name: "Acme" } })
      } as Response)
    );
    const tokens = await exchangeAuthorizationCode(
      { ...OAUTH, redirectUri: "https://erp.test/cb" },
      "code"
    );
    expect(tokens.accessToken).toBe("a");
    expect((tokens.body.team as { name: string }).name).toBe("Acme");
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

  // Reconnecting an account is how "reconnect needed" clears: the fresh consent's
  // grant must replace the recorded one, not sit behind it.
  it("refreshes metadata when an existing account is reconnected", async () => {
    const { client, rows } = makeClient({ status: "Revoked" });
    rows.get(CONNECTION)!.metadata = { scopes: "old" };
    await createConnection(client, {
      companyId: COMPANY,
      pieceName: "google-calendar",
      name: rows.get(CONNECTION)!.name,
      tokens: { accessToken: "at-new" },
      metadata: { scopes: "new" },
      expiresAt: null,
      createdBy: "u1"
    });
    expect(rows.get(CONNECTION)!.metadata).toEqual({ scopes: "new" });
    expect(rows.get(CONNECTION)!.status).toBe("Active");
  });
});
