// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database, like the drift check:
//   SUPABASE_DB_URL=… pnpm --filter @carbon/database test -- wipe-check-tables
//
// Every case runs in its own transaction, which is always rolled back, so it
// writes nothing.

import { today } from "@internationalized/date";
import { Client, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { seedCompanyReferenceData } from "./bootstrap.ts";
import { applyDatasetTiers, DATASETS } from "./index.ts";
import { ensureSequences, insertId, insertRow, one, quote } from "./sql.ts";
import { buildCtx, type Ctx, resolveCompanyTimeZone } from "./types.ts";
import { resolveCheckUserId } from "./verify.ts";

const url = process.env.SUPABASE_DB_URL;
const dataset = DATASETS.satellite;

/**
 * Seeds `seed`'s rows into a fresh company, runs the wipe Settings → Demo Data
 * runs before its tiers, and returns how many rows of `table` are left.
 */
async function rowsLeftAfterWipe(
  table: string,
  seed: (ctx: Ctx) => Promise<void>
): Promise<number> {
  const client = new Client({ connectionString: url });
  await client.connect();
  const pg = client as unknown as PoolClient;
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL "app.sync_in_progress" = 'true'`);
    const userId = await resolveCheckUserId(pg);
    if (!userId) throw new Error("The local database has no user");
    const { companyId } = await seedCompanyReferenceData(pg, {
      userId,
      companyName: "Wipe Check"
    });
    const timeZone = await resolveCompanyTimeZone(pg, companyId);
    await ensureSequences(pg, companyId);
    const ctx = await buildCtx(
      pg,
      companyId,
      userId,
      dataset,
      today(timeZone),
      timeZone,
      () => {
        // The tier log is for the CLI; a test has nothing to print.
      }
    );
    await seed(ctx);

    await applyDatasetTiers(pg, {
      companyId,
      userId,
      dataset,
      timeZone,
      tiers: [],
      wipeFirst: true
    });

    const left = await one<{ count: number }>(
      pg,
      `SELECT count(*)::int AS count FROM ${quote(table)} WHERE "companyId" = $1`,
      [companyId]
    );
    return left.count;
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

// An activated lessee lease: one month of its schedule, posted by a lease run.
async function seedPostedLeaseMonth(ctx: Ctx): Promise<void> {
  const account = await one<{ id: string }>(
    ctx.client,
    `SELECT id FROM account
     WHERE "companyGroupId" = $1 AND NOT "isGroup"
     ORDER BY number LIMIT 1`,
    [ctx.companyGroupId]
  );
  const supplierId = await insertId(ctx, "supplier", { name: "Lessor" });
  const leaseId = await insertId(ctx, "lease", {
    leaseId: "LS-CHECK-1",
    status: "Active",
    supplierId,
    commencementDate: "2026-01-01",
    invoiceFromDate: "2026-01-01",
    discountRate: 6,
    currencyCode: "USD"
  });
  const leaseLineId = await insertId(ctx, "leaseLine", {
    leaseId,
    description: "Office space",
    paymentAmount: 100
  });
  const leaseScheduleLineId = await insertId(ctx, "leaseScheduleLine", {
    leaseId,
    leaseLineId,
    periodDate: "2026-01-31",
    openingLiability: 1000,
    paymentAmount: 100,
    interestAmount: 5,
    principalAmount: 95,
    closingLiability: 905,
    leaseCost: 100,
    rouAmortization: 90,
    closingRouAsset: 910
  });
  const scheduleId = await insertId(ctx, "revenueRecognitionSchedule", {
    type: "Amortization",
    status: "Posted",
    leaseId,
    leaseScheduleLineId,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    scheduledDate: "2026-01-31",
    amount: 90,
    debitAccountId: account.id,
    creditAccountId: account.id
  });
  const runId = await insertId(ctx, "revenueRecognitionRun", {
    runId: "LR-CHECK-1",
    type: "Lease",
    status: "Posted",
    periodEnd: "2026-01-31"
  });
  await insertRow(ctx, "revenueRecognitionRunLine", {
    runId,
    scheduleId,
    amount: 90
  });
}

describe.skipIf(!url)(
  "re-applying demo data over rows a CHECK protects",
  () => {
    // revenueRecognitionSchedule_lease_pairing_check needs leaseId and
    // leaseScheduleLineId set together, and the FK-nulling pass nulls them one
    // at a time; the run line's RESTRICT reference then blocks deleting the row.
    it("clears a lessee lease's schedule rows once a lease run has posted them", async () => {
      await expect(
        rowsLeftAfterWipe("revenueRecognitionSchedule", seedPostedLeaseMonth)
      ).resolves.toBe(0);
    }, 120_000);
  }
);
