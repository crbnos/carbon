import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionRevokedError,
  createConnection,
  resolveConnectionAuth
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
      then(resolve: (value: { data: unknown; error: null }) => unknown) {
        let targets = matching(filters);

        if (operation === "update" && orClause !== undefined) {
          // Mirrors `refreshingAt.is.null,refreshingAt.lt.<iso>`.
          const staleBefore = orClause.split("refreshingAt.lt.")[1]!;
          targets = targets.filter(
            (row) => row.refreshingAt === null || row.refreshingAt < staleBefore
          );
        }
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
});
