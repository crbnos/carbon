// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { completeJob } from "../../app/modules/production/production.server";
import {
  getReceiptConfirmation,
  getSerialCompleteChoice
} from "../../app/modules/production/ui/Jobs/job-complete-logic";
import { getJobReceiptPreview } from "../../app/modules/production/production.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  stockPart,
  USER
} from "./fixtures/always-post";
import { holdUnits, raiseIssue, serialJob } from "./fixtures/job-unit-hold";
import {
  localServiceRoleClient,
  operationContext,
  postgrestTest
} from "./fixtures/local-supabase";

async function dialogConfirmation(f: Fixture, jobId: string) {
  const preview = await getJobReceiptPreview(f.db, jobId, f.companyId);
  if (!preview) throw new Error("Missing job receipt preview");
  const { tracking } = preview;
  const choice = getSerialCompleteChoice({
    trackedEntities: tracking.trackedEntities,
    hasSerialSequence: Boolean(tracking.sequenceId),
    heldUnitIds: new Set(
      tracking.trackedEntities
        .filter((unit) => unit.held)
        .map((unit) => unit.id)
    ),
    jobQuantity: tracking.quantity,
    receivedEntityIds: new Set(preview.trackedEntityIds),
    issuedEntityIds: new Set(preview.issuedTrackedEntityIds)
  });
  return getReceiptConfirmation(
    preview,
    choice.mode === "serials" ? choice.serials.slice(0, 1) : undefined
  )!;
}

function submit(
  f: Fixture,
  jobId: string,
  confirmation: NonNullable<ReturnType<typeof getReceiptConfirmation>>
) {
  return completeJob(operationContext(f, localServiceRoleClient()!, USER), {
    jobId,
    quantityComplete: 1,
    ...confirmation
  });
}

async function receipts(f: Fixture, jobId: string) {
  return f.db
    .selectFrom("itemLedger")
    .select(["trackedEntityId", "quantity"])
    .where("companyId", "=", f.companyId)
    .where("documentId", "=", jobId)
    .where("documentType", "=", "Job Receipt")
    .execute();
}

async function receiptStatus(f: Fixture, jobId: string) {
  return f.db
    .selectFrom("job")
    .select(["status", "quantityReceivedToInventory"])
    .where("id", "=", jobId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
}

postgrestTest(
  "holds off: stale named preview cannot replace a rejected serial with its peer",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      const { jobId } = await serialJob(f, 2);
      await holdUnits(f, false);
      const originalJob = await receiptStatus(f, jobId);
      const before = await dialogConfirmation(f, jobId);
      expect(before.expectedUnitIds).toEqual([`${f.prefix}-unit-1`]);
      await seed(f, async (trx) => {
        await trx
          .updateTable("trackedEntity")
          .set({ status: "Rejected" })
          .where("id", "=", `${f.prefix}-unit-1`)
          .execute();
      });
      const stale = await submit(f, jobId, before);
      expect(await receipts(f, jobId)).toEqual([]);
      expect(stale.error?.message).toMatch(/reopen/i);
      expect(await receiptStatus(f, jobId)).toEqual(originalJob);
      const fresh = await dialogConfirmation(f, jobId);
      expect((await submit(f, jobId, fresh)).error).toBeNull();
      expect(await receipts(f, jobId)).toEqual([
        { trackedEntityId: `${f.prefix}-unit-2`, quantity: 1 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "deferred preview binds excluded serials, the seed identity and its quantity",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      const { jobId } = await serialJob(f, 2);
      const seedId = `${f.prefix}-unit-2`;
      await seed(f, async (trx) => {
        await trx
          .updateTable("job")
          .set({ quantity: 3 })
          .where("id", "=", jobId)
          .execute();
        await trx
          .updateTable("trackedEntity")
          .set({ status: "Reserved", readableId: null, quantity: 2 })
          .where("id", "=", seedId)
          .execute();
        await trx
          .insertInto("itemSerialSequence")
          .values({
            itemId: f.assemblyId,
            prefix: "DEFER-",
            suffix: "",
            size: 3,
            next: 0,
            step: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      await holdUnits(f, true);
      const issue = await raiseIssue(f, 1);
      const originalJob = await receiptStatus(f, jobId);
      const before = await dialogConfirmation(f, jobId);
      expect(before.expectedUnitIds).toBeUndefined();
      expect(before.expectedReceiptPreview).toMatch(/^[a-f0-9]{32}$/);
      await seed(f, async (trx) => {
        await trx
          .updateTable("nonConformance")
          .set({ status: "Closed" })
          .where("id", "=", issue)
          .execute();
      });
      const stale = await submit(f, jobId, before);
      expect(await receipts(f, jobId)).toEqual([]);
      expect(stale.error?.message).toMatch(/reopen/i);
      expect(await receiptStatus(f, jobId)).toEqual(originalJob);

      // Each open reads the new state. A quantity edit and exchanging the seed
      // for an otherwise identical row must both invalidate that confirmation.
      const afterRelease = await dialogConfirmation(f, jobId);
      await seed(f, async (trx) => {
        await trx
          .updateTable("trackedEntity")
          .set({ quantity: 3 })
          .where("id", "=", seedId)
          .execute();
      });
      expect((await submit(f, jobId, afterRelease)).error?.message).toMatch(
        /reopen/i
      );
      const afterResize = await dialogConfirmation(f, jobId);
      await seed(f, async (trx) => {
        await trx
          .updateTable("trackedEntity")
          .set({ id: `${seedId}-replacement` })
          .where("id", "=", seedId)
          .execute();
      });
      expect((await submit(f, jobId, afterResize)).error?.message).toMatch(
        /reopen/i
      );
      expect(await receipts(f, jobId)).toEqual([]);
      const sequence = await f.db
        .selectFrom("itemSerialSequence")
        .select("next")
        .where("itemId", "=", f.assemblyId)
        .executeTakeFirstOrThrow();
      expect(Number(sequence.next)).toBe(0);
      const fresh = await dialogConfirmation(f, jobId);
      expect((await submit(f, jobId, fresh)).error).toBeNull();
      expect(await receipts(f, jobId)).toEqual([
        { trackedEntityId: `${f.prefix}-unit-1`, quantity: 1 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

for (const mode of ["consumed to project", "Non-Inventory"] as const) {
  postgrestTest(
    `a serial preview ${mode} cannot silently receive stock after a destination change`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        await stockPart(f, 20);
        const { jobId } = await serialJob(f, 2);
        async function switchDestination(receives: boolean) {
          await seed(f, async (trx) => {
            if (mode === "consumed to project") {
              const projectId = `${f.prefix}-project`;
              if (!receives) {
                await trx
                  .insertInto("project")
                  .values({
                    id: projectId,
                    name: "Project output",
                    identifier: "PO",
                    companyId: f.companyId,
                    createdBy: USER
                  })
                  .execute();
              }
              await trx
                .updateTable("job")
                .set({
                  consumeToProject: !receives,
                  projectId: receives ? null : projectId
                })
                .where("id", "=", jobId)
                .execute();
            } else {
              await trx
                .updateTable("item")
                .set({
                  itemTrackingType: receives ? "Serial" : "Non-Inventory"
                })
                .where("id", "=", f.assemblyId)
                .execute();
            }
          });
        }
        await switchDestination(false);
        const original = await receiptStatus(f, jobId);
        const before = await dialogConfirmation(f, jobId);
        await switchDestination(true);
        const stale = await submit(f, jobId, before);
        expect(await receipts(f, jobId)).toEqual([]);
        expect(await receiptStatus(f, jobId)).toEqual(original);
        expect(stale.error?.message).toMatch(/reopen/i);
        expect(before.expectedUnitIds).toBeUndefined();
        expect(before.expectedReceiptPreview).toMatch(/^[0-9a-f]{32}$/);
        const fresh = await dialogConfirmation(f, jobId);
        expect(fresh.expectedUnitIds).toEqual([`${f.prefix}-unit-1`]);
        expect((await submit(f, jobId, fresh)).error).toBeNull();
      } finally {
        await f.cleanup();
      }
    }
  );
}
