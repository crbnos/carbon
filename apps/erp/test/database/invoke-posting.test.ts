// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

import { createHash } from "node:crypto";
import type { ServiceContext } from "@carbon/api/service-fn.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";
import { createClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { invokePosting } from "../../app/modules/shared/shared.service";

class Rollback extends Error {}

type Scratch = {
  db: Kysely<KyselyDatabase>;
  companyId: string;
  groupId: string;
  /** A client authenticated by a real API key of the company. */
  keyClient: ReturnType<typeof createClient<Database>>;
};

/** A company, its group and an API key holding `scopes`, all rolled back. */
async function withScratch(
  scopes: (companyId: string) => Record<string, string[]>,
  fn: (s: Scratch) => Promise<void>
) {
  const db = await connectLocalTestDatabase();
  const prefix = `ivtest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const rawKey = `crbn_${prefix}`;
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto("companyGroup")
        .values({ id: groupId, name: prefix, createdBy: "system" })
        .execute();
      await trx
        .insertInto("company")
        .values({
          id: companyId,
          name: prefix,
          companyGroupId: groupId,
          baseCurrencyCode: "USD",
          timezone: "America/New_York"
        })
        .execute();
      await trx
        .insertInto("apiKey")
        .values({
          name: prefix,
          companyId,
          createdBy: "system",
          keyHash: createHash("sha256").update(rawKey).digest("hex"),
          scopes: JSON.stringify(scopes(companyId))
        })
        .execute();
      await fn({
        db: trx,
        companyId,
        groupId,
        keyClient: createClient<Database>("http://localhost:54321", "anon", {
          global: { headers: { "carbon-key": rawKey } }
        })
      });
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  } finally {
    await db.destroy();
  }
}

/** What the body ran as, and the company group it was given. */
const whoRan = async (ctx: ServiceContext) => ({
  actor: ctx.actor.type,
  groupId: ctx.company.groupId
});

databaseTest("refuses a caller whose key lacks the posting's permission", () =>
  withScratch(
    () => ({}),
    async ({ db, companyId, keyClient }) => {
      const result = await invokePosting(
        { db, companyId, userId: "system", client: keyClient },
        "test-posting",
        {},
        whoRan,
        { as: { update: "inventory" } }
      );
      expect(result.data).toBeNull();
      expect(result.error).toMatchObject({ status: 403 });
    }
  )
);

databaseTest("runs as the system once the caller holds the permission", () =>
  withScratch(
    (companyId) => ({ inventory_update: [companyId] }),
    async ({ db, companyId, groupId, keyClient }) => {
      const result = await invokePosting(
        { db, companyId, userId: "system", client: keyClient },
        "test-posting",
        {},
        whoRan,
        { as: { update: "inventory" } }
      );
      // The group is read from the company when the handles carry none.
      expect(result).toEqual({ data: { actor: "system", groupId }, error: null });
    }
  )
);

databaseTest("refuses a keyed value with no rule as invalid input", () =>
  withScratch(
    (companyId) => ({ inventory_create: [companyId] }),
    async ({ db, companyId, keyClient }) => {
      const result = await invokePosting(
        { db, companyId, userId: "system", client: keyClient },
        "test-posting",
        { mode: "constructor" },
        whoRan,
        { as: { by: "mode", rules: { scan: { create: "inventory" } } } }
      );
      expect(result.error).toMatchObject({
        status: 400,
        message: "Invalid input — mode: expected one of scan"
      });
    }
  )
);

databaseTest("runs handles without a client as the system", () =>
  withScratch(
    () => ({}),
    async ({ db, companyId, groupId }) => {
      const result = await invokePosting(
        { db, companyId, userId: "system" },
        "test-posting",
        {},
        whoRan
      );
      expect(result).toEqual({ data: { actor: "system", groupId }, error: null });
    }
  )
);

databaseTest("refuses to run a caller's client with no permission to check", () =>
  withScratch(
    () => ({}),
    async ({ db, companyId, keyClient }) => {
      await expect(
        invokePosting(
          // @ts-expect-error handles with a client require `as`
          { db, companyId, userId: "system", client: keyClient },
          "test-posting",
          {},
          whoRan
        )
      ).rejects.toThrow("need `as`");
    }
  )
);
