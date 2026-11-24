// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. The person page saves another person's
// avatar only for an active employee of the caller's company.

import { sql } from "kysely";
import { expect, it } from "vitest";
import { updatePersonAvatar } from "../../app/modules/users/users.server";
import {
  connectLocalTestDatabase,
  hasLocalDatabase
} from "./fixtures/local-database";
import {
  localServiceRoleClient,
  operationContext
} from "./fixtures/local-supabase";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const test = (name: string, fn: () => Promise<void>) =>
  it.skipIf(!client)(name, fn, 60_000);

const GENERATED = "dicebear:voxel-art:3f2b8c4e-6a1d-4f7e-9b2c:1e3a8a";

// Two companies; an active and an inactive employee of the first, and an
// active employee of the second only.
async function fixture() {
  const db = await connectLocalTestDatabase();
  const p = `patest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const own = { companyId: `${p}-own`, groupId: `${p}-own-group` };
  const other = { companyId: `${p}-other`, groupId: `${p}-other-group` };
  const people = {
    active: crypto.randomUUID(),
    inactive: crypto.randomUUID(),
    elsewhere: crypto.randomUUID()
  };
  const employees = [
    { id: people.active, company: own, active: true },
    { id: people.inactive, company: own, active: false },
    { id: people.elsewhere, company: other, active: true }
  ];

  // Rows only: the company and employee type interceptors would also build
  // groups and memberships, which these cases do not read.
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL session_replication_role = 'replica'`.execute(trx);
    for (const c of [own, other]) {
      await sql`
        INSERT INTO "companyGroup" (id, name, "createdBy") VALUES (${c.groupId}, ${c.companyId}, 'system')
      `.execute(trx);
      await sql`
        INSERT INTO "company" (id, name, "companyGroupId", "baseCurrencyCode")
        VALUES (${c.companyId}, ${c.companyId}, ${c.groupId}, 'USD')
      `.execute(trx);
      await sql`
        INSERT INTO "employeeType" (id, name, "companyId") VALUES (${`${c.companyId}-type`}, 'Staff', ${c.companyId})
      `.execute(trx);
    }
    for (const e of employees) {
      await sql`
        INSERT INTO "user" (id, email) VALUES (${e.id}, ${`${e.id}@avatars.invalid`})
      `.execute(trx);
      await sql`
        INSERT INTO "employee" (id, "companyId", "employeeTypeId", active)
        VALUES (${e.id}, ${e.company.companyId}, ${`${e.company.companyId}-type`}, ${e.active})
      `.execute(trx);
    }
  });

  const save = (userId: string) =>
    updatePersonAvatar(
      operationContext({ db, ...own }, client!, people.active),
      { userId, path: GENERATED }
    );
  const avatarOf = async (userId: string) =>
    (
      await sql<{ avatarUrl: string | null }>`
        SELECT "avatarUrl" FROM "user" WHERE id = ${userId}
      `.execute(db)
    ).rows[0]?.avatarUrl ?? null;

  return { db, people, save, avatarOf };
}

test("saves the avatar of an active employee of the company", async () => {
  const f = await fixture();
  try {
    const result = await f.save(f.people.active);
    expect(result).toEqual({ data: { avatarUrl: GENERATED }, error: null });
    expect(await f.avatarOf(f.people.active)).toBe(GENERATED);
  } finally {
    await f.db.destroy();
  }
});

it.skipIf(!client).each([
  ["an inactive employee of the company", "inactive"],
  ["an employee of another company only", "elsewhere"]
] as const)(
  "refuses %s and leaves the avatar alone",
  async (_, who) => {
    const f = await fixture();
    try {
      const result = await f.save(f.people[who]);
      expect(result.error?.category).toBe("notFound");
      expect(await f.avatarOf(f.people[who])).toBeNull();
    } finally {
      await f.db.destroy();
    }
  },
  60_000
);
