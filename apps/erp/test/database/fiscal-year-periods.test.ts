// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Generate Fiscal Year for a caller that may create accounting periods but
// not view settings, where the fiscal year's start month is kept.

import { createHash } from "node:crypto";
import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { expect } from "vitest";
import { createFiscalYearPeriods } from "../../app/modules/accounting/accounting.server";
import { connectLocalTestDatabase } from "./fixtures/local-database";
import { localApiKeyClient, postgrestTest } from "./fixtures/local-supabase";

const USER = "system";

async function companyFixture(startMonth: "July" | null) {
  const db = await connectLocalTestDatabase();
  const prefix = `fiscal-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: USER })
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
    if (startMonth) {
      await trx
        .insertInto("fiscalYearSettings")
        .values({ companyId, startMonth, updatedBy: USER })
        .execute();
    }
  });
  // An API key that may create and view accounting, and nothing else.
  const rawKey = `crbn_fiscal_${crypto.randomUUID()}`;
  await db
    .insertInto("apiKey")
    .values({
      name: "Accounting only",
      companyId,
      createdBy: USER,
      keyHash: createHash("sha256").update(rawKey).digest("hex"),
      scopes: JSON.stringify({
        accounting_view: [companyId],
        accounting_create: [companyId]
      })
    })
    .execute();
  return {
    db,
    companyId,
    groupId,
    caller: localApiKeyClient(rawKey)!,
    async periods() {
      return db
        .selectFrom("accountingPeriod")
        .select([
          sql<string>`"startDate"::text`.as("startDate"),
          sql<string>`"endDate"::text`.as("endDate")
        ])
        .where("companyId", "=", companyId)
        .orderBy("startDate")
        .execute();
    },
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
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
  };
}

function contextOf(
  f: Awaited<ReturnType<typeof companyFixture>>,
  system: unknown
) {
  return createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: f.caller as never,
    system: () => system as never,
    pg: () => f.db as never,
    kv: () => {
      throw new Error("No kv in a database test");
    }
  });
}

postgrestTest(
  "a fiscal year starts in the settings' month for a caller who cannot view settings",
  async (system) => {
    const f = await companyFixture("July");
    try {
      // The caller's own read of the settings finds nothing.
      const hidden = await f.caller
        .from("fiscalYearSettings")
        .select("startMonth")
        .eq("companyId", f.companyId);
      expect(hidden).toMatchObject({ data: [], error: null });

      const created = await createFiscalYearPeriods(contextOf(f, system), {
        fiscalYear: 2027
      });
      expect(created.error).toBeNull();
      expect(created.data!.ids).toHaveLength(12);
      const periods = await f.periods();
      expect([periods[0], periods.at(-1)]).toEqual([
        { startDate: "2026-07-01", endDate: "2026-07-31" },
        { startDate: "2027-06-01", endDate: "2027-06-30" }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "a fiscal year starts in January for a company with no fiscal year settings",
  async (system) => {
    const f = await companyFixture(null);
    try {
      const created = await createFiscalYearPeriods(contextOf(f, system), {
        fiscalYear: 2027
      });
      expect(created.error).toBeNull();
      const periods = await f.periods();
      expect([periods[0], periods.at(-1)]).toEqual([
        { startDate: "2027-01-01", endDate: "2027-01-31" },
        { startDate: "2027-12-01", endDate: "2027-12-31" }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
