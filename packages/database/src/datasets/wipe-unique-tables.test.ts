// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database, like the drift check:
//   SUPABASE_DB_URL=… pnpm --filter @carbon/database test -- wipe-unique-tables
//
// Every case runs in its own transaction, which is always rolled back, so it
// writes nothing.

import { today } from "@internationalized/date";
import { Client, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { seedCompanyReferenceData } from "./bootstrap.ts";
import { createItem } from "./helpers/items.ts";
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
      () => undefined
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

type OverrideScope = "customer" | "customerType" | "allCustomers";

function seedOverrides(...scopes: OverrideScope[]) {
  return async (ctx: Ctx): Promise<void> => {
    const item = await createItem(ctx, {
      readableId: "PRICE-CHECK-1",
      name: "PRICE-CHECK-1",
      type: "Part"
    });
    for (const [index, scope] of scopes.entries()) {
      const name = `Price Check ${index + 1}`;
      const target =
        scope === "customer"
          ? { customerId: await insertId(ctx, "customer", { name }) }
          : scope === "customerType"
            ? { customerTypeId: await insertId(ctx, "customerType", { name }) }
            : {};
      const overrideId = await insertId(ctx, "customerItemPriceOverride", {
        itemId: item.id,
        ...target
      });
      await insertRow(ctx, "customerItemPriceOverrideBreak", {
        customerItemPriceOverrideId: overrideId,
        quantity: 1,
        overridePrice: 10
      });
    }
  };
}

async function twoShifts(ctx: Ctx): Promise<string[]> {
  return [
    await insertId(ctx, "shift", {
      name: "Day",
      startTime: "06:00",
      endTime: "14:00",
      locationId: ctx.locationId
    }),
    await insertId(ctx, "shift", {
      name: "Evening",
      startTime: "14:00",
      endTime: "22:00",
      locationId: ctx.locationId
    })
  ];
}

async function seedTwoShiftAssignments(ctx: Ctx): Promise<void> {
  const workCenterId = await insertId(ctx, "workCenter", {
    name: "Assembly",
    locationId: ctx.locationId
  });
  for (const shiftId of await twoShifts(ctx)) {
    await insertRow(ctx, "peopleAssignment", {
      locationId: ctx.locationId,
      workCenterId,
      employeeId: ctx.userId,
      date: "2026-01-05",
      shiftId
    });
  }
}

async function seedTwoShiftAbsences(ctx: Ctx): Promise<void> {
  for (const shiftId of await twoShifts(ctx)) {
    await insertRow(ctx, "peopleAbsence", {
      employeeId: ctx.userId,
      date: "2026-01-05",
      shiftId
    });
  }
}

// One scrap of two lots: its rows share the idempotency key.
async function seedScrapOfTwoLots(ctx: Ctx): Promise<void> {
  const item = await createItem(ctx, {
    readableId: "SCRAP-CHECK-1",
    name: "SCRAP-CHECK-1",
    type: "Part",
    trackingType: "Batch"
  });
  const reason = await one<{ id: string }>(
    ctx.client,
    `SELECT id FROM "scrapReason" WHERE "companyId" = $1 ORDER BY id LIMIT 1`,
    [ctx.companyId]
  );
  for (const readableId of ["LOT-1", "LOT-2"]) {
    const trackedEntityId = await insertId(ctx, "trackedEntity", {
      itemId: item.id,
      readableId,
      quantity: 5,
      sourceDocument: "Item",
      sourceDocumentId: item.id
    });
    await insertRow(ctx, "jobMaterialScrap", {
      jobMaterialId: "scrap-check-material",
      jobOperationId: "scrap-check-operation",
      itemId: item.id,
      trackedEntityId,
      quantity: 1,
      scrapReasonId: reason.id,
      replacement: "Shelf",
      idempotencyKey: "scrap-check"
    });
  }
}

describe.skipIf(!url)(
  "re-applying demo data over rows a unique index keys on a foreign key",
  () => {
    // Nulling the foreign key would give these rows the same index key, so they
    // must be deleted before the wipe's FK-nulling pass.
    it.each([
      [
        "two customers' overrides on one item",
        "customerItemPriceOverride",
        seedOverrides("customer", "customer")
      ],
      [
        "a customer's and a customer type's override on one item",
        "customerItemPriceOverride",
        seedOverrides("customer", "customerType")
      ],
      [
        "a customer's and an all-customers override on one item",
        "customerItemPriceOverride",
        seedOverrides("customer", "allCustomers")
      ],
      ["one scrap of two lots", "jobMaterialScrap", seedScrapOfTwoLots],
      [
        "a person's assignments to two shifts on one day",
        "peopleAssignment",
        seedTwoShiftAssignments
      ],
      [
        "a person's absences from two shifts on one day",
        "peopleAbsence",
        seedTwoShiftAbsences
      ]
    ] as const)(
      "clears %s",
      async (_label, table, seed) => {
        await expect(rowsLeftAfterWipe(table, seed)).resolves.toBe(0);
      },
      120_000
    );
  }
);
