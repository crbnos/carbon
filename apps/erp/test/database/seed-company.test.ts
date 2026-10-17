// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";
import { seedCompany } from "../../app/modules/settings/settings.service";
import { invokePosting } from "../../app/modules/shared/shared.service";

class Rollback extends Error {}

/** `trx`, whose own `transaction()` joins it, so the test can roll back all of it. */
function joined(trx: Kysely<KyselyDatabase>): Kysely<KyselyDatabase> {
  return new Proxy(trx, {
    get(target, key) {
      if (key === "transaction") {
        return () => ({
          execute: (fn: (t: Kysely<KyselyDatabase>) => unknown) => fn(target)
        });
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

databaseTest(
  "seeds a company inserted without a group, as creating a company does",
  async () => {
    const db = await connectLocalTestDatabase();
    // The app's insert and seed run with every interceptor on.
    await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
      db
    );
    const prefix = `seedtest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const companyId = `${prefix}-company`;
    const userId = `${prefix}-user`;
    try {
      await db.transaction().execute(async (trx) => {
        // A signed-up user: the seed adds the company to its permissions.
        await trx
          .insertInto("user")
          .values({
            id: userId,
            email: `${prefix}@example.com`,
            firstName: "Seed",
            lastName: "Test"
          })
          .execute();
        await trx
          .insertInto("userPermission")
          .values({ id: userId, permissions: {} })
          .execute();
        await trx
          .insertInto("company")
          .values({
            id: companyId,
            name: prefix,
            baseCurrencyCode: "USD",
            timezone: "America/New_York"
          })
          .execute();
        const handles = { db: joined(trx), companyId, userId };

        // Any other posting refuses a company with no group, as our bug.
        const other = await invokePosting(
          handles,
          "test-posting",
          {},
          async () => "ran"
        );
        expect(other.error).toMatchObject({ status: 500 });

        const seeded = await invokePosting(
          handles,
          "seed-company",
          { identityOnly: false },
          seedCompany
        );
        expect(seeded).toEqual({ data: { success: true }, error: null });

        const company = await trx
          .selectFrom("company")
          .select("companyGroupId")
          .where("id", "=", companyId)
          .executeTakeFirstOrThrow();
        expect(company.companyGroupId).toEqual(expect.any(String));
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    } finally {
      await db.destroy();
    }
  }
);
