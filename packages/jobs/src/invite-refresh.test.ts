// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type ResentInvite,
  refreshResentInvite,
  resendInvite,
  revocationStands
} from "./invite-refresh";

type Row = Record<string, unknown>;

/**
 * The service-role client over in-memory tables, with the `eq` and `is`
 * filters the refresh uses. `afterRead` runs after a read has its rows: what
 * another request commits in between. `failing` names a table whose reads
 * fail, or `<table>:write` for its writes.
 */
function memoryClient(
  tables: Record<string, Row[]>,
  afterRead: (table: string) => void = () => undefined,
  failing?: string
) {
  return {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let patch: Row | null = null;
      const fails = () =>
        failing === (patch ? `${table}:write` : table)
          ? { data: null, error: { message: "Connection reset" } }
          : null;
      const run = () => {
        const rows = (tables[table] ?? []).filter((row) =>
          filters.every((keep) => keep(row))
        );
        if (patch) for (const row of rows) Object.assign(row, patch);
        const data = rows.map((row) => ({ ...row }));
        if (!patch) afterRead(table);
        return data;
      };
      const query = {
        select: () => query,
        update: (values: Row) => {
          patch = values;
          return query;
        },
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return query;
        },
        is: (column: string, value: null) => {
          filters.push((row) => (row[column] ?? null) === value);
          return query;
        },
        maybeSingle: async () =>
          fails() ?? { data: run()[0] ?? null, error: null },
        single: async () => {
          const rows = run();
          return rows.length === 1
            ? { data: rows[0], error: null }
            : { data: null, error: { message: "Not one row" } };
        }
      };
      return query;
    }
  };
}

const ACCEPTED_EARLIER = "2026-10-01T09:00:00.000000+00:00";
const ACCEPTED_NOW = "2026-11-24T10:00:00.000000+00:00";

const invite = (overrides: Row = {}): Row => ({
  email: "pat@example.com",
  companyId: "cmp_1",
  createdBy: "usr_admin",
  code: "code-sent",
  acceptedAt: null,
  revokedAt: null,
  createdAt: "2026-11-01T00:00:00.000000+00:00",
  ...overrides
});

const REVOKED_EARLIER = "2026-11-20T08:00:00.000000+00:00";
const REVOKED_NOW = "2026-11-24T11:00:00.000000+00:00";

const refresh = (
  tables: Record<string, Row[]>,
  afterRead?: (t: string) => void,
  requested: { revokedAt?: string | null } = {}
) =>
  refreshResentInvite(memoryClient(tables, afterRead) as never, {
    userId: "usr_1",
    email: "pat@example.com",
    companyId: "cmp_1",
    ...requested
  });

describe("refreshResentInvite", () => {
  it("gives a pending invite a new code and restarts it", async () => {
    const tables = { invite: [invite()], userToCompany: [] };

    const result = await refresh(tables);

    expect(result).toEqual({
      code: tables.invite[0]!.code,
      createdBy: "usr_admin"
    });
    expect(tables.invite[0]!.code).not.toBe("code-sent");
    expect(tables.invite[0]!.createdAt).not.toBe(
      "2026-11-01T00:00:00.000000+00:00"
    );
  });

  // A deactivated account keeps its old acceptance: sending again clears it.
  it("clears a deactivated person's acceptance and revocation", async () => {
    const tables = {
      invite: [
        invite({ acceptedAt: ACCEPTED_EARLIER, revokedAt: ACCEPTED_NOW })
      ],
      userToCompany: []
    };

    const result = await refresh(tables);

    expect(result).toHaveProperty("code");
    expect(tables.invite[0]).toMatchObject({
      acceptedAt: null,
      revokedAt: null
    });
  });

  it("refuses a person with an account in the company", async () => {
    const tables = {
      invite: [invite({ acceptedAt: ACCEPTED_NOW })],
      userToCompany: [{ userId: "usr_1", companyId: "cmp_1" }]
    };

    const result = await refresh(tables);

    expect(result).toHaveProperty("failure", "accepted");
    expect(tables.invite[0]).toMatchObject({
      code: "code-sent",
      acceptedAt: ACCEPTED_NOW
    });
  });

  // The acceptance commits after the membership read: only the write sees it.
  it("refuses an invite accepted between its checks and its write", async () => {
    const tables: Record<string, Row[]> = {
      invite: [invite()],
      userToCompany: []
    };
    const accept = (table: string) => {
      if (table !== "userToCompany") return;
      tables.invite![0]!.acceptedAt = ACCEPTED_NOW;
      tables.userToCompany = [{ userId: "usr_1", companyId: "cmp_1" }];
    };

    const result = await refresh(tables, accept);

    expect(result).toHaveProperty("failure", "accepted");
    expect(tables.invite![0]).toMatchObject({
      code: "code-sent",
      acceptedAt: ACCEPTED_NOW
    });
  });

  // The revocation the resend was asked to clear is cleared: an admin's
  // resend of a revoked invite restores it.
  it("clears the revocation the resend was requested over", async () => {
    const tables = {
      invite: [invite({ revokedAt: REVOKED_EARLIER })],
      userToCompany: []
    };

    const result = await refresh(tables, undefined, {
      revokedAt: REVOKED_EARLIER
    });

    expect(result).toHaveProperty("code");
    expect(tables.invite[0]).toMatchObject({ revokedAt: null });
  });

  // A revoke saved while the resend waited in the queue stays in effect.
  it("refuses an invite revoked after the resend was requested", async () => {
    const tables = {
      invite: [invite({ revokedAt: REVOKED_NOW })],
      userToCompany: []
    };

    const result = await refresh(tables, undefined, { revokedAt: null });

    expect(result).toHaveProperty("failure", "revoked");
    expect(tables.invite[0]).toMatchObject({
      code: "code-sent",
      revokedAt: REVOKED_NOW
    });
  });

  it("refuses an invite revoked again after the resend was requested", async () => {
    const tables = {
      invite: [invite({ revokedAt: REVOKED_NOW })],
      userToCompany: []
    };

    const result = await refresh(tables, undefined, {
      revokedAt: REVOKED_EARLIER
    });

    expect(result).toHaveProperty("failure", "revoked");
    expect(tables.invite[0]).toMatchObject({
      code: "code-sent",
      revokedAt: REVOKED_NOW
    });
  });

  // The revoke commits after the membership read: only the write sees it.
  it("refuses an invite revoked between its checks and its write", async () => {
    const tables: Record<string, Row[]> = {
      invite: [invite()],
      userToCompany: []
    };
    const revoke = (table: string) => {
      if (table === "userToCompany") tables.invite![0]!.revokedAt = REVOKED_NOW;
    };

    const result = await refresh(tables, revoke);

    expect(result).toHaveProperty("failure", "revoked");
    expect(tables.invite![0]).toMatchObject({
      code: "code-sent",
      revokedAt: REVOKED_NOW
    });
  });

  it("refuses a person with no invite in the company", async () => {
    expect(await refresh({ invite: [], userToCompany: [] })).toEqual({
      failure: "noInvite",
      message: "No invite record found for user"
    });
  });

  // A failed read is not an outcome: it throws, so the job's step retries.
  it.each([
    ["the invite", "invite", "Failed to read the invite"],
    ["the membership", "userToCompany", "Failed to read the membership"]
  ])("throws when reading %s fails", async (_label, table, message) => {
    const tables = { invite: [invite()], userToCompany: [] };

    await expect(
      refreshResentInvite(memoryClient(tables, undefined, table) as never, {
        userId: "usr_1",
        email: "pat@example.com",
        companyId: "cmp_1"
      })
    ).rejects.toThrow(message);
    expect(tables.invite[0]).toMatchObject({ code: "code-sent" });
  });

  it("throws when the write fails", async () => {
    const tables = { invite: [invite()], userToCompany: [] };

    await expect(
      refreshResentInvite(
        memoryClient(tables, undefined, "invite:write") as never,
        {
          userId: "usr_1",
          email: "pat@example.com",
          companyId: "cmp_1"
        }
      )
    ).rejects.toThrow("Failed to refresh invite");
  });
});

/**
 * Inngest's memo of a run's steps: a finished step's output is kept as JSON
 * and returned on the run's retry; a step that threw runs again.
 */
function inngestSteps() {
  const done = new Map<string, unknown>();
  return {
    run: async (id: string, fn: () => unknown) => {
      if (done.has(id)) return done.get(id);
      const output = JSON.parse(JSON.stringify(await fn()));
      done.set(id, output);
      return output;
    }
  };
}

describe("resendInvite", () => {
  const tables = (overrides: Row = {}): Record<string, Row[]> => ({
    user: [{ id: "usr_1", email: "pat@example.com", fullName: "Pat Doe" }],
    invite: [invite({ revokedAt: REVOKED_EARLIER, ...overrides })],
    userToCompany: []
  });

  /** Runs the resend; its first delivery fails, and `between` runs before the retry. */
  async function resendWithRetry(
    db: Record<string, Row[]>,
    between: () => void = () => undefined
  ) {
    const steps = inngestSteps();
    const delivered: ResentInvite[] = [];
    let attempts = 0;
    const deliver = async (sent: ResentInvite) => {
      attempts += 1;
      if (attempts === 1) throw new Error("The mail server timed out");
      delivered.push(sent);
    };
    const run = () =>
      resendInvite(
        memoryClient(db) as never,
        steps,
        { userId: "usr_1", companyId: "cmp_1", revokedAt: REVOKED_EARLIER },
        deliver
      );
    await expect(run()).rejects.toThrow("The mail server timed out");
    between();
    return { result: await run(), delivered };
  }

  // The refresh cleared the revocation; refreshing again on the retry would
  // read it gone, refuse, and send nothing.
  it("delivers the refreshed code when a delivery is retried", async () => {
    const db = tables();

    const { result, delivered } = await resendWithRetry(db);

    expect(result).toEqual({
      outcome: "done",
      message: "Successfully resent invite for usr_1"
    });
    expect(delivered).toEqual([
      {
        email: "pat@example.com",
        name: "Pat Doe",
        code: db.invite![0]!.code,
        createdBy: "usr_admin"
      }
    ]);
    expect(db.invite![0]!.code).not.toBe("code-sent");
    expect(db.invite![0]!.revokedAt).toBeNull();
  });

  it.each([
    ["revoked", { revokedAt: REVOKED_NOW }],
    ["sent again", { code: "code-of-a-later-resend" }],
    ["accepted", { acceptedAt: ACCEPTED_NOW }]
  ])(
    "delivers nothing when the invite was %s before the retry",
    async (_label, change) => {
      const db = tables();

      const { result, delivered } = await resendWithRetry(db, () =>
        Object.assign(db.invite![0]!, change)
      );

      expect(result.outcome).toBe("skipped");
      expect(delivered).toEqual([]);
    }
  );

  it("refreshes nothing and delivers nothing for an invite revoked since the request", async () => {
    const db = tables({ revokedAt: REVOKED_NOW });
    const delivered: ResentInvite[] = [];

    const result = await resendInvite(
      memoryClient(db) as never,
      inngestSteps(),
      { userId: "usr_1", companyId: "cmp_1", revokedAt: REVOKED_EARLIER },
      async (sent) => {
        delivered.push(sent);
      }
    );

    expect(result.outcome).toBe("skipped");
    expect(delivered).toEqual([]);
    expect(db.invite![0]).toMatchObject({
      code: "code-sent",
      revokedAt: REVOKED_NOW
    });
  });
});

describe("revocationStands", () => {
  const stands = (overrides: Row = {}, members: Row[] = []) =>
    revocationStands(
      memoryClient({
        user: [{ id: "usr_1", email: "pat@example.com" }],
        invite: [invite({ revokedAt: REVOKED_EARLIER, ...overrides })],
        userToCompany: members
      }) as never,
      { userId: "usr_1", companyId: "cmp_1", revokedAt: REVOKED_EARLIER }
    );

  it("holds while the invite carries the revocation and the person has no membership", async () => {
    expect(await stands()).toBe(true);
  });

  it.each([
    ["a resend cleared the revocation", { revokedAt: null }],
    ["a later revoke replaced it", { revokedAt: REVOKED_NOW }],
    ["the invite was accepted", { acceptedAt: ACCEPTED_NOW }]
  ])("lapses once %s", async (_label, change) => {
    expect(await stands(change)).toBe(false);
  });

  it("lapses once the person has a membership in the company", async () => {
    expect(await stands({}, [{ userId: "usr_1", companyId: "cmp_1" }])).toBe(
      false
    );
  });
});
