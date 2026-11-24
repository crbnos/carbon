// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { expect } from "vitest";
import { assignSerialNumbers } from "../../app/modules/production/production.service";
import { closeIssue } from "../../app/modules/quality/quality.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";
import { systemServiceOf } from "./fixtures/handles";
import { holdUnits, raiseIssueOnUnit } from "./fixtures/job-unit-hold";
import { postgrestTest } from "./fixtures/local-supabase";

async function reject(
  f: Fixture,
  client: SupabaseClient<Database>,
  unit: string,
  issueNumber: number,
  disposition: "Scrap" | "Return to Supplier"
) {
  const issue = await raiseIssueOnUnit(f, unit, issueNumber);
  await seed(f, async (trx) => {
    await trx
      .updateTable("nonConformance")
      .set({ status: "In Progress" })
      .where("id", "=", issue)
      .where("companyId", "=", f.companyId)
      .execute();
    const row = await trx
      .insertInto("nonConformanceItem")
      .values({
        nonConformanceId: issue,
        itemId: f.assemblyId,
        quantity: 1,
        disposition,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("nonConformanceItemTrackedEntity")
      .values({
        nonConformanceId: issue,
        trackedEntityId: unit,
        nonConformanceItemId: row.id,
        quantity: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  expect(
    (
      await closeIssue(client, f.db, {
        nonConformanceId: issue,
        companyId: f.companyId,
        userId: USER
      })
    ).error
  ).toBeNull();
  expect(
    await f.db
      .selectFrom("trackedEntity")
      .select("status")
      .where("id", "=", unit)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow()
  ).toEqual({ status: "Rejected" });
}

for (const disposition of ["Scrap", "Return to Supplier"] as const) {
  for (const holdsEnabled of [false, true]) {
    postgrestTest(
      `${disposition} on real job WIP and stocked output, holds ${holdsEnabled}`,
      async (client) => {
        const f = await alwaysPostFixture();
        try {
          await holdUnits(f, holdsEnabled);
          await seed(f, async (trx) => {
            await trx
              .updateTable("item")
              .set({ itemTrackingType: "Serial" })
              .where("id", "=", f.assemblyId)
              .where("companyId", "=", f.companyId)
              .execute();
            await trx
              .insertInto("itemSerialSequence")
              .values({
                itemId: f.assemblyId,
                next: 0,
                size: 3,
                step: 1,
                prefix: "SN-",
                suffix: "",
                serialNumberTiming: "jobCreation",
                companyId: f.companyId,
                createdBy: USER
              })
              .execute();
          });
          const job = await jobFixture(f, "wip", 2);
          expect(
            await assignSerialNumbers(systemServiceOf(f.ctx, f.groupId), {
              jobId: job.jobId,
              at: "jobCreation"
            })
          ).toEqual({ assigned: 2 });
          const units = await f.db
            .selectFrom("trackedEntity")
            .select(["id", "sourceDocument", "sourceDocumentId", "attributes"])
            .where("companyId", "=", f.companyId)
            .where("itemId", "=", f.assemblyId)
            .orderBy("readableId")
            .execute();
          expect(units).toHaveLength(2);
          const [bad, good] = units;
          expect(bad.sourceDocument).toBe("Item");
          await reject(f, client, bad.id, 1, disposition);

          const replacement = await f.db
            .insertInto("trackedEntity")
            .values({
              sourceDocument: good.sourceDocument,
              sourceDocumentId: good.sourceDocumentId,
              itemId: f.assemblyId,
              attributes: good.attributes,
              readableId: "SN-003",
              status: "Reserved",
              quantity: 1,
              companyId: f.companyId,
              createdBy: USER
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          await sql`select complete_job_to_inventory(p_job_id := ${job.jobId},
          p_quantity_complete := 2, p_company_id := ${f.companyId}, p_user_id := ${USER})`.execute(
            f.db
          );
          const movements = () =>
            f.db
              .selectFrom("itemLedger")
              .select(["trackedEntityId", "quantity"])
              .where("companyId", "=", f.companyId)
              .where("itemId", "=", f.assemblyId)
              .execute();
          const receipts = await movements();
          expect(receipts).toEqual(
            expect.arrayContaining([
              { trackedEntityId: good.id, quantity: 1 },
              { trackedEntityId: replacement.id, quantity: 1 }
            ])
          );
          expect(
            receipts.filter((row) => row.trackedEntityId === bad.id)
          ).toEqual([]);
          expect(
            receipts.reduce((sum, row) => sum + Number(row.quantity), 0)
          ).toBe(2);

          // The same disposition of a received job serial must relieve its stock once.
          await reject(f, client, good.id, 2, disposition);
          const after = await movements();
          expect(
            after
              .filter((row) => row.trackedEntityId === good.id)
              .map((row) => row.quantity)
              .sort()
          ).toEqual([-1, 1]);
          expect(
            after.reduce((sum, row) => sum + Number(row.quantity), 0)
          ).toBe(1);
        } finally {
          await f.cleanup();
        }
      }
    );
  }
}
