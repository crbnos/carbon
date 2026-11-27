// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { resolvePermissions } from "@carbon/api/permissions";
import { claimsFor, type PageGate, pageById } from "@carbon/database/access";
import {
  connectLocalTestDatabase,
  databaseTest,
  removeTestRows
} from "./fixtures/local-database";
import { ForbiddenError } from "@carbon/api/errors";
import { SUPABASE_SERVICE_ROLE_KEY } from "@carbon/env";
import {
  authorizePostingCaller,
  type PostingCredential,
  postingCredential
} from "~/modules/shared/shared.service";

// An API key is authenticated through the auth package's service-role
// client, so that client reads the local stack.
vi.mock("@carbon/env", async (importOriginal) => {
  const { localSupabaseEnv } = await import("./fixtures/local-supabase");
  return {
    ...(await importOriginal<object>()),
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    ...localSupabaseEnv()
  };
});

const jwt = (payload: object) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

type Caller = Parameters<typeof authorizePostingCaller>[0] & {
  caller: PostingCredential;
};
const authorize = (
  ctx: Caller,
  required: Parameters<typeof authorizePostingCaller>[2]
) => authorizePostingCaller(ctx, ctx.caller, required);

class Rollback extends Error {}

/**
 * A member of a company of their own. Built here rather than read from
 * whatever the database holds: a freshly migrated one has no users.
 */
const newMember = () => {
  const prefix = `posting-caller-${crypto.randomUUID()}`;
  return { prefix, companyId: `${prefix}-company`, userId: `${prefix}-user` };
};

async function insertMember(
  db: Kysely<KyselyDatabase>,
  member: { prefix: string; companyId: string; userId: string }
) {
  const { prefix, companyId, userId } = member;
  await sql`SET LOCAL session_replication_role = replica`.execute(db);
  await db
    .insertInto("user")
    .values({ id: userId, email: `${prefix}@example.com` })
    .execute();
  await db
    .insertInto("companyGroup")
    .values({ id: `${prefix}-group`, name: prefix, createdBy: userId })
    .execute();
  await db
    .insertInto("company")
    .values({
      id: companyId,
      name: prefix,
      companyGroupId: `${prefix}-group`,
      baseCurrencyCode: "USD"
    })
    .execute();
  await db
    .insertInto("userToCompany")
    .values({ userId, companyId, role: "employee" })
    .execute();
  await sql`SET LOCAL session_replication_role = origin`.execute(db);
}

/** Deletes a committed member and every row the test wrote for it. */
async function deleteMember(
  db: Kysely<KyselyDatabase>,
  member: { prefix: string; companyId: string; userId: string }
) {
  await removeTestRows(db, async (trx) => {
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await sql`DELETE FROM "permission" WHERE "companyId" = ${member.companyId}`.execute(trx);
    await sql`DELETE FROM "apiKey" WHERE "companyId" = ${member.companyId}`.execute(trx);
    await sql`DELETE FROM "userToCompany" WHERE "companyId" = ${member.companyId}`.execute(trx);
    await sql`DELETE FROM "company" WHERE "id" = ${member.companyId}`.execute(trx);
    await sql`DELETE FROM "companyGroup" WHERE "id" = ${`${member.prefix}-group`}`.execute(trx);
    await sql`DELETE FROM "user" WHERE "id" = ${member.userId}`.execute(trx);
  });
}

const fields = {
  db: {} as Kysely<KyselyDatabase>,
  companyId: "co1",
  userId: "u1"
};

describe("authorizePostingCaller", () => {
  it("lets the system through without reading claims", async () => {
    await expect(
      authorize(
        { ...fields, caller: { type: "system" } },
        { "inventory.receipts": "Edit" }
      )
    ).resolves.toBeUndefined();
  });
});

describe("postingCredential", () => {
  const clientWith = (key: string, headers: Record<string, string> = {}) =>
    createClient<Database>("http://localhost:54321", key, {
      global: { headers }
    });

  it("makes a carbon-key client an API key, whatever user it names", async () => {
    expect(
      postingCredential(
        clientWith("anon-key", { "carbon-key": "crbn_k" }),
        fields.userId
      )
    ).toEqual({ type: "apiKey", apiKey: "crbn_k" });
  });

  it("makes the service-role client the system", async () => {
    expect(postingCredential(clientWith(SUPABASE_SERVICE_ROLE_KEY!), fields.userId)).toEqual(
      { type: "system" }
    );
  });

  it("binds a user's client to its own userId", async () => {
    const own = clientWith("anon-key", {
      Authorization: `Bearer ${jwt({ sub: "u1", role: "authenticated" })}`
    });
    expect(postingCredential(own, fields.userId)).toEqual({
      type: "user",
      client: own
    });

    const other = clientWith("anon-key", {
      Authorization: `Bearer ${jwt({ sub: "u2", role: "authenticated" })}`
    });
    expect(() => postingCredential(other, fields.userId)).toThrow(ForbiddenError);
    expect(() => postingCredential(clientWith("anon-key"), fields.userId)).toThrow(
      ForbiddenError
    );
  });
});

describe("authorizePostingCaller (API key)", () => {
  /**
   * Runs `fn` with a context for a real `apiKey` row of a member's own
   * company, then deletes them both. They are committed: the caller check
   * reads the key the way `authorize` does, through its own client.
   */
  async function withApiKey(
    row: { expiresAt: string | null; grant?: { module: string; level: string } },
    fn: (ctx: Caller, companyId: string) => Promise<void>
  ) {
    const db = await connectLocalTestDatabase();
    const { companyId, userId, prefix } = newMember();
    const rawKey = `crbn_test_${crypto.randomUUID()}`;
    try {
      await db.transaction().execute(async (trx) => {
        await insertMember(trx, { companyId, userId, prefix });
      });
      const key = await db
        .insertInto("apiKey")
        .values({
          name: "authorize test",
          companyId,
          createdBy: userId,
          keyHash: createHash("sha256").update(rawKey).digest("hex"),
          scopes: JSON.stringify({}),
          expiresAt: row.expiresAt
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      if (row.grant) {
        await sql`
          INSERT INTO "permission" ("companyId", "apiKeyId", "module", "level", "createdBy")
          VALUES (${companyId}, ${key.id}, ${row.grant.module}, ${row.grant.level}, ${userId})
        `.execute(db);
      }
      await fn(
        {
          db,
          companyId,
          userId,
          caller: postingCredential(
            createClient<Database>("http://localhost:54321", "anon-key", {
              global: { headers: { "carbon-key": rawKey } }
            }),
            userId
          )
        },
        companyId
      );
    } finally {
      await deleteMember(db, { companyId, userId, prefix });
      await db.destroy();
    }
  }

  databaseTest("refuses a key with no grant in the company, even for {}", () =>
    withApiKey({ expiresAt: null }, async (ctx) => {
      await expect(authorize(ctx, {})).rejects.toMatchObject({ status: 403 });
      await expect(authorize(ctx, "employee")).rejects.toMatchObject({
        status: 403
      });
      // The key's creator could hold this; the key does not.
      await expect(
        authorize(ctx, { "inventory.receipts": "View" })
      ).rejects.toMatchObject({ status: 403 });
    })
  );

  databaseTest("passes a key whose grants cover the requirement", () =>
    withApiKey(
      { expiresAt: null, grant: { module: "Inventory", level: "Edit" } },
      async (ctx) => {
        await expect(authorize(ctx, {})).resolves.toBeUndefined();
        // A module grant covers every page of the module, at its level.
        await expect(
          authorize(ctx, { "inventory.receipts": "Edit" })
        ).resolves.toBeUndefined();
        await expect(
          authorize(ctx, { "inventory.shipments": "Edit" })
        ).resolves.toBeUndefined();
        await expect(
          authorize(ctx, { "inventory.receipts": "Full" })
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          authorize(ctx, { "invoicing.payments": "Edit" })
        ).rejects.toMatchObject({ status: 403 });
      }
    )
  );

  databaseTest("refuses an expired key", () =>
    withApiKey(
      {
        expiresAt: "2000-01-01T00:00:00Z",
        grant: { module: "Inventory", level: "Edit" }
      },
      async (ctx) => {
        await expect(authorize(ctx, {})).rejects.toMatchObject({
          status: 403
        });
      }
    )
  );
});

describe("authorizePostingCaller (user)", () => {
  /** The caller's client as far as the claims read goes: `get_claims`, answered by the test database. */
  const claimsClient = (db: Kysely<KyselyDatabase>) =>
    ({
      rpc: async (_fn: string, args: { uid: string; company: string }) => {
        const { rows } = await sql<{ claims: unknown }>`
          SELECT get_claims(${args.uid}, ${args.company}) AS claims
        `.execute(db);
        return { data: rows[0]?.claims ?? null, error: null };
      }
    }) as unknown as SupabaseClient<Database>;

  /**
   * Runs `fn` with an employee of a company of their own who holds Edit on
   * the Inventory module, and rolls it all back. `held` is a page that grant
   * covers.
   */
  async function withEmployee(
    fn: (
      fields: { db: Kysely<KyselyDatabase>; companyId: string; userId: string },
      held: string
    ) => Promise<void>
  ) {
    const db = await connectLocalTestDatabase();
    const member = newMember();
    try {
      await db.transaction().execute(async (trx) => {
        await insertMember(trx, member);
        await sql`
          INSERT INTO "permission" ("companyId", "userId", "module", "level", "createdBy")
          VALUES (${member.companyId}, ${member.userId}, 'Inventory', 'Edit', ${member.userId})
        `.execute(trx);
        const held = "inventory.receipts";
        expect(pageById(held)).toBeTruthy();
        await fn(
          { db: trx, companyId: member.companyId, userId: member.userId },
          held
        );
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    } finally {
      await db.destroy();
    }
  }

  databaseTest(
    "admits a permission the user holds, in their company only",
    () =>
      withEmployee(async (fields, held) => {
        const gate = { [held]: "Edit" } as PageGate;
        await expect(
          authorize({ ...fields, caller: { type: "user", client: claimsClient(fields.db) } }, gate)
        ).resolves.toBeUndefined();
        await expect(
          authorize(
            { ...fields, companyId: "not-theirs", caller: { type: "user", client: claimsClient(fields.db) } },
            gate
          )
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          authorize({ ...fields, caller: { type: "user", client: claimsClient(fields.db) } }, {
            "no-such-page": "Edit"
          } as PageGate)
        ).rejects.toMatchObject({ status: 403 });
      })
  );

  databaseTest("applies the rule the input's type selects", () =>
    withEmployee(async (fields, held) => {
      const rule = {
        by: "type",
        rules: {
          internal: "system",
          open: { [held]: "Edit" } as PageGate
        }
      } as const;
      const user: Caller = { ...fields, caller: { type: "user", client: claimsClient(fields.db) } };
      await expect(
        authorize(user, resolvePermissions(rule, { type: "internal" }))
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        authorize(user, resolvePermissions(rule, { type: "open" }))
      ).resolves.toBeUndefined();
    })
  );
});
