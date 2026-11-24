// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { refreshResentInvite } from "./invite-refresh";

type Row = Record<string, unknown>;

/**
 * The service-role client over in-memory tables, with the `eq` and `is`
 * filters the refresh uses. `afterRead` runs after a read has its rows: what
 * another request commits in between.
 */
function memoryClient(
  tables: Record<string, Row[]>,
  afterRead: (table: string) => void = () => undefined
) {
  return {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let patch: Row | null = null;
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
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null })
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

const refresh = (
  tables: Record<string, Row[]>,
  afterRead?: (t: string) => void
) =>
  refreshResentInvite(memoryClient(tables, afterRead) as never, {
    userId: "usr_1",
    email: "pat@example.com",
    companyId: "cmp_1"
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

  it("refuses a person with no invite in the company", async () => {
    expect(await refresh({ invite: [], userToCompany: [] })).toEqual({
      failure: "notFound",
      message: "No invite record found for user"
    });
  });
});
