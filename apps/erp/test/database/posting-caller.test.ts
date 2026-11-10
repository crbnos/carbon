// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { createClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { resolvePermissions } from "@carbon/api/permissions";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";
import { ForbiddenError } from "@carbon/api/errors";
import {
  authorizePostingCaller,
  type PostingCaller,
  postingCaller
} from "~/modules/shared/shared.service";

vi.mock("@carbon/env", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key"
}));

const jwt = (payload: object) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

type Caller = Parameters<typeof authorizePostingCaller>[0] & {
  caller: PostingCaller;
};
const authorize = (
  ctx: Caller,
  required: Parameters<typeof authorizePostingCaller>[2]
) => authorizePostingCaller(ctx, ctx.caller, required);

const fields = {
  db: {} as Kysely<KyselyDatabase>,
  companyId: "co1",
  userId: "u1"
};

describe("authorizePostingCaller", () => {
  it("lets the system through without reading claims", async () => {
    await expect(
      authorize({ ...fields, caller: { type: "system" } }, { update: "inventory" })
    ).resolves.toBeUndefined();
  });
});

describe("postingCaller", () => {
  const clientWith = (key: string, headers: Record<string, string> = {}) =>
    createClient<Database>("http://localhost:54321", key, {
      global: { headers }
    });

  it("makes a carbon-key client an API key, whatever user it names", async () => {
    expect(
      postingCaller(
        clientWith("anon-key", { "carbon-key": "crbn_k" }),
        fields.userId
      )
    ).toEqual({ type: "apiKey", apiKey: "crbn_k" });
  });

  it("makes the service-role client the system", async () => {
    expect(postingCaller(clientWith("service-role-key"), fields.userId)).toEqual(
      { type: "system" }
    );
  });

  it("binds a user's client to its own userId", async () => {
    const own = clientWith("anon-key", {
      Authorization: `Bearer ${jwt({ sub: "u1", role: "authenticated" })}`
    });
    expect(postingCaller(own, fields.userId)).toEqual({ type: "user" });

    const other = clientWith("anon-key", {
      Authorization: `Bearer ${jwt({ sub: "u2", role: "authenticated" })}`
    });
    expect(() => postingCaller(other, fields.userId)).toThrow(ForbiddenError);
    expect(() => postingCaller(clientWith("anon-key"), fields.userId)).toThrow(
      ForbiddenError
    );
  });
});

describe("authorizePostingCaller (API key)", () => {
  class Rollback extends Error {}

  /** Runs `fn` with a context for a real `apiKey` row, then rolls back. */
  async function withApiKey(
    row: { scopes: Record<string, string[]>; expiresAt: string | null },
    fn: (ctx: Caller, companyId: string) => Promise<void>
  ) {
    const db = await connectLocalTestDatabase();
    const owner = await sql<{ companyId: string; userId: string }>`
      SELECT "companyId", "userId" FROM "userToCompany" LIMIT 1
    `.execute(db);
    const { companyId, userId } = owner.rows[0]!;
    const rawKey = `crbn_test_${Date.now()}`;
    try {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto("apiKey")
          .values({
            name: "authorize test",
            companyId,
            createdBy: userId,
            keyHash: createHash("sha256").update(rawKey).digest("hex"),
            scopes: JSON.stringify(row.scopes),
            expiresAt: row.expiresAt
          })
          .execute();
        const ctx = {
          db: trx,
          companyId,
          userId,
          caller: postingCaller(
            createClient<Database>("http://localhost:54321", "anon-key", {
              global: { headers: { "carbon-key": rawKey } }
            }),
            userId
          )
        };
        await fn(ctx, companyId);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    } finally {
      await db.destroy();
    }
  }

  databaseTest("checks the key's scopes, not its creator's claims", () =>
    withApiKey({ scopes: {}, expiresAt: null }, async (ctx) => {
      await expect(authorize(ctx, {})).resolves.toBeUndefined();
      // The creator of a real company holds this; the key does not.
      await expect(authorize(ctx, { view: "inventory" })).rejects.toMatchObject(
        { status: 403 }
      );
    })
  );

  databaseTest("passes a key whose scopes cover the requirement", () =>
    withApiKey({ scopes: {}, expiresAt: null }, async (ctx, companyId) => {
      await sql`UPDATE "apiKey" SET scopes = ${JSON.stringify({
        inventory_update: [companyId]
      })}::jsonb WHERE name = 'authorize test'`.execute(ctx.db);
      await expect(
        authorize(ctx, { update: "inventory" })
      ).resolves.toBeUndefined();
      await expect(
        authorize(ctx, { update: "invoicing" })
      ).rejects.toMatchObject({ status: 403 });
    })
  );

  databaseTest("refuses an expired key", () =>
    withApiKey(
      { scopes: {}, expiresAt: "2000-01-01T00:00:00Z" },
      async (ctx) => {
        await expect(authorize(ctx, {})).rejects.toMatchObject({
          status: 403
        });
      }
    )
  );
});

describe("authorizePostingCaller (user)", () => {
  /** Runs `fn` with a real employee of a real company. */
  async function withEmployee(
    fn: (
      fields: { db: Kysely<KyselyDatabase>; companyId: string; userId: string },
      held: string
    ) => Promise<void>
  ) {
    const db = await connectLocalTestDatabase();
    try {
      const { rows } = await sql<{
        companyId: string;
        userId: string;
        claims: Record<string, unknown>;
      }>`
        SELECT "companyId", "userId", get_claims("userId", "companyId") AS claims
        FROM "userToCompany" WHERE "role" = 'employee' LIMIT 20
      `.execute(db);
      for (const { companyId, userId, claims } of rows) {
        const held = Object.entries(claims).find(
          ([key, companies]) =>
            key.endsWith("_update") &&
            Array.isArray(companies) &&
            companies.includes(companyId)
        );
        if (held) {
          return await fn({ db, companyId, userId }, held[0].split("_")[0]!);
        }
      }
      throw new Error("No employee with an update permission to test with");
    } finally {
      await db.destroy();
    }
  }

  databaseTest(
    "admits a permission the user holds, in their company only",
    () =>
      withEmployee(async (fields, held) => {
        await expect(
          authorize({ ...fields, caller: { type: "user" } }, { update: held })
        ).resolves.toBeUndefined();
        await expect(
          authorize(
            { ...fields, companyId: "not-theirs", caller: { type: "user" } },
            {
              update: held
            }
          )
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          authorize({ ...fields, caller: { type: "user" } }, { update: "no-such-module" })
        ).rejects.toMatchObject({ status: 403 });
      })
  );

  databaseTest("applies the rule the input's type selects", () =>
    withEmployee(async (fields, held) => {
      const rule = {
        by: "type",
        rules: { internal: "system", open: { update: held } }
      } as const;
      const user: Caller = { ...fields, caller: { type: "user" } };
      await expect(
        authorize(user, resolvePermissions(rule, { type: "internal" }))
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        authorize(user, resolvePermissions(rule, { type: "open" }))
      ).resolves.toBeUndefined();
    })
  );
});
