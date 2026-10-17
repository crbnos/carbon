// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Saving a tax code never rewrites another code's component: an id the code
// does not own is inserted as a new component. Live database: the upsert is
// one Kysely transaction, so it cannot be faked.

import { readFileSync } from "node:fs";
import { sql } from "kysely";
import { expect, it, vi } from "vitest";

// accounting.service reaches the settings barrel and the glossary, whose
// Lingui `msg` macros vitest does not transform. Nothing under test uses them.
vi.mock("~/modules/settings", () => ({ getNextSequence: vi.fn() }));
vi.mock("@carbon/content/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: () => [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: (t: string) => t,
  terms: {}
}));

import { connectLocalTestDatabase } from "../../../../../packages/server-functions/src/local-database-test-fixture";
import { upsertTaxCode } from "./accounting.service";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const USER = "system";

// vitest.config.ts stubs SUPABASE_DB_URL for every ERP test, so the local
// database is read from the repository's .env.local. Without one, the test
// skips, as lease-run-posting.test.ts does.
const localDatabaseUrl = (() => {
  try {
    const env = readFileSync(
      new URL("../../../../../.env.local", import.meta.url),
      "utf8"
    );
    const url = env.match(/^SUPABASE_DB_URL=(.+)$/m)?.[1]?.trim();
    return url && LOCAL_HOSTS.includes(new URL(url).hostname) ? url : null;
  } catch {
    return null;
  }
})();

const taxCode = (id: string | undefined, name: string) => ({
  id,
  name,
  calculationType: "Normal" as const,
  reportingCategory: "Standard" as const,
  taxesShipping: false,
  active: true
});

const component = (
  id: string | undefined,
  name: string,
  taxPercent: number
) => ({
  id,
  name,
  taxPercent,
  recoverablePercent: 0,
  sequence: 1,
  isCompound: false
});

it.skipIf(!localDatabaseUrl)(
  "saving a code with another code's component id inserts a new component",
  async (context) => {
    process.env.SUPABASE_DB_URL = localDatabaseUrl!;
    let db: Awaited<ReturnType<typeof connectLocalTestDatabase>>;
    try {
      db = await connectLocalTestDatabase();
      await sql`SELECT 1`.execute(db);
    } catch (error) {
      // .env.local exists in every worktree; the stack may simply be down.
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ECONNREFUSED"
      ) {
        context.skip();
      }
      throw error;
    }

    const prefix = `taxfx-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const companyId = `${prefix}-company`;
    const companyGroupId = `${prefix}-group`;
    try {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("companyGroup")
          .values({ id: companyGroupId, name: prefix, createdBy: USER })
          .execute();
        await trx
          .insertInto("company")
          .values({
            id: companyId,
            name: prefix,
            companyGroupId,
            baseCurrencyCode: "USD",
            timezone: "America/New_York"
          })
          .execute();
      });
      const args = { companyId, companyGroupId, userId: USER };

      const a = await upsertTaxCode(db, {
        ...args,
        taxCode: taxCode(undefined, `${prefix} A`),
        components: [component(undefined, "A state", 0.05)]
      });
      const b = await upsertTaxCode(db, {
        ...args,
        taxCode: taxCode(undefined, `${prefix} B`),
        components: [component(undefined, "B state", 0.07)]
      });
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();
      const components = (taxCodeId: string) =>
        db
          .selectFrom("taxCodeComponent")
          .select(["id", "taxCodeId", "name", "taxPercent"])
          .where("companyId", "=", companyId)
          .where("taxCodeId", "=", taxCodeId)
          .orderBy("name")
          .execute();
      const [aComponent] = await components(a.data!.id);
      const [bComponent] = await components(b.data!.id);

      // Save A, keeping its own component and naming B's.
      const saved = await upsertTaxCode(db, {
        ...args,
        taxCode: taxCode(a.data!.id, `${prefix} A`),
        components: [
          component(aComponent!.id, "A state", 0.06),
          component(bComponent!.id, "A city", 0.01)
        ]
      });
      expect(saved.error).toBeNull();

      // B's component is untouched.
      expect(await components(b.data!.id)).toEqual([bComponent]);
      // A updated its own and inserted the other as new.
      const aAfter = await components(a.data!.id);
      expect(aAfter.map((c) => [c.name, Number(c.taxPercent)])).toEqual([
        ["A city", 0.01],
        ["A state", 0.06]
      ]);
      expect(aAfter.find((c) => c.name === "A state")?.id).toBe(aComponent!.id);
      expect(aAfter.find((c) => c.name === "A city")?.id).not.toBe(
        bComponent!.id
      );
    } finally {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", companyGroupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  },
  60_000
);
