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
import { claimsFor, type PageGate, pageById } from "@carbon/database/access";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";
import { ForbiddenError } from "@carbon/api/errors";
import {
  authorizePostingCaller,
  type PostingCredential,
  postingCredential
} from "~/modules/shared/shared.service";

vi.mock("@carbon/env", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key"
}));

const jwt = (payload: object) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

type Caller = Parameters<typeof authorizePostingCaller>[0] & {
  caller: PostingCredential;
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
    expect(postingCredential(clientWith("service-role-key"), fields.userId)).toEqual(
      { type: "system" }
    );
  });

  it("binds a user's client to its own userId", async () => {
    const own = clientWith("anon-key", {
      Authorization: `Bearer ${jwt({ sub: "u1", role: "authenticated" })}`
    });
    expect(postingCredential(own, fields.userId)).toEqual({ type: "user" });

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
   * Runs `fn` with a context for a real `apiKey` row, then deletes it. The key
   * is committed: the caller check reads it the way `authorize` does, through
   * its own client.
   */
  async function withApiKey(
    row: { expiresAt: string | null; grant?: { module: string; level: string } },
    fn: (ctx: Caller, companyId: string) => Promise<void>
  ) {
    const db = await connectLocalTestDatabase();
    const owner = await sql<{ companyId: string; userId: string }>`
      SELECT "companyId", "userId" FROM "userToCompany" LIMIT 1
    `.execute(db);
    const { companyId, userId } = owner.rows[0]!;
    const rawKey = `crbn_test_${Date.now()}`;
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
    try {
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
      await sql`DELETE FROM "permission" WHERE "apiKeyId" = ${key.id}`.execute(
        db
      );
      await db.deleteFrom("apiKey").where("id", "=", key.id).execute();
      await db.destroy();
    }
  }

  databaseTest("refuses a key with no grant in the company, even for {}", () =>
    withApiKey({ expiresAt: null }, async (ctx) => {
      await expect(authorize(ctx, {})).rejects.toMatchObject({ status: 403 });
      await expect(authorize(ctx, "employee")).rejects.toMatchObject({
        status: 403
      });
      // The creator of a real company holds this; the key does not.
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
        const held = Object.entries(
          claimsFor(claims, companyId).permissions
        ).find(
          ([page, permission]) =>
            pageById(page) && permission.update.includes(companyId)
        );
        if (held) {
          return await fn({ db, companyId, userId }, held[0]);
        }
      }
      throw new Error("No employee with Edit on a page to test with");
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
          authorize({ ...fields, caller: { type: "user" } }, gate)
        ).resolves.toBeUndefined();
        await expect(
          authorize(
            { ...fields, companyId: "not-theirs", caller: { type: "user" } },
            gate
          )
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          authorize({ ...fields, caller: { type: "user" } }, {
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
