// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { createClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineServerFn } from "./define-server-fn";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./local-database-test-fixture";
import { authorize, ServerFnContext } from "./server-fn-context";

vi.mock("@carbon/env", () => ({
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key"
}));

const jwt = (payload: object) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

const fields = {
  db: {} as Kysely<KyselyDatabase>,
  companyId: "co1",
  userId: "u1"
};

describe("authorize", () => {
  it("lets the system through without reading claims", async () => {
    await expect(
      authorize(ServerFnContext.system(fields), { update: "inventory" })
    ).resolves.toBeUndefined();
  });
});

describe("ServerFnContext.fromClient", () => {
  const clientWith = (key: string, headers: Record<string, string> = {}) =>
    createClient<Database>("http://localhost:54321", key, {
      global: { headers }
    });

  it("makes a carbon-key client an API key, whatever user it names", async () => {
    const ctx = await ServerFnContext.fromClient(
      clientWith("anon-key", { "carbon-key": "crbn_k" }),
      fields
    );
    expect(ctx.actor).toBe("apiKey");
    expect(ctx.apiKey).toBe("crbn_k");
  });

  it("makes the service-role client the system", async () => {
    const ctx = await ServerFnContext.fromClient(
      clientWith("service-role-key"),
      fields
    );
    expect(ctx.isSystem).toBe(true);
  });

  it("binds a user's client to its own userId", async () => {
    const own = clientWith("anon-key", {
      Authorization: `Bearer ${jwt({ sub: "u1", role: "authenticated" })}`
    });
    expect((await ServerFnContext.fromClient(own, fields)).actor).toBe("user");

    const other = clientWith("anon-key", {
      Authorization: `Bearer ${jwt({ sub: "u2", role: "authenticated" })}`
    });
    await expect(
      ServerFnContext.fromClient(other, fields)
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      ServerFnContext.fromClient(clientWith("anon-key"), fields)
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("authorize (API key)", () => {
  class Rollback extends Error {}

  /** Runs `fn` with a context for a real `apiKey` row, then rolls back. */
  async function withApiKey(
    row: { scopes: Record<string, string[]>; expiresAt: string | null },
    fn: (ctx: ServerFnContext, companyId: string) => Promise<void>
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
        const ctx = await ServerFnContext.fromClient(
          createClient<Database>("http://localhost:54321", "anon-key", {
            global: { headers: { "carbon-key": rawKey } }
          }),
          { db: trx, companyId, userId }
        );
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

describe("authorize (user)", () => {
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
          authorize(ServerFnContext.user(fields), { update: held })
        ).resolves.toBeUndefined();
        await expect(
          authorize(
            ServerFnContext.user({ ...fields, companyId: "not-theirs" }),
            {
              update: held
            }
          )
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          authorize(ServerFnContext.user(fields), { update: "no-such-module" })
        ).rejects.toMatchObject({ status: 403 });
      })
  );

  databaseTest("applies the rule the input's type selects", () =>
    withEmployee(async (fields, held) => {
      const fn = defineServerFn({
        name: "typed",
        input: z.discriminatedUnion("type", [
          z.object({ type: z.literal("internal") }),
          z.object({ type: z.literal("open") })
        ]),
        permissions: {
          by: "type",
          rules: { internal: "system", open: { update: held } }
        },
        async run(_ctx, { type }) {
          return type;
        }
      });
      const user = ServerFnContext.user(fields);
      expect((await fn(user, { type: "internal" })).error?.status).toBe(403);
      expect((await fn(user, { type: "open" })).data).toBe("open");
    })
  );
});
