// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { issueMaterial } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { handlesOf } from "./fixtures/handles";
import { connectLocalTestDatabase } from "./fixtures/local-database";
import {
  completeJob,
  reopenJob
} from "../../app/modules/production/production.server";
import {
  isSerialReceiptBlockedByHolds,
  getReceiptConfirmation,
  getTrackedReceiptQuantity
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

async function dialogConfirmation(
  f: Fixture,
  jobId: string,
  requestedQuantity = 1
) {
  const preview = await getJobReceiptPreview(f.db, jobId, f.companyId);
  if (!preview) throw new Error("Missing job receipt preview");
  const completion = getTrackedReceiptQuantity(preview);
  if (!completion) throw new Error("Expected a tracked job");
  const { choice } = completion;
  const quantityComplete =
    choice.mode === "locked" ? completion.quantity : requestedQuantity;
  const newUnits = Math.max(
    quantityComplete - preview.quantityReceivedToInventory,
    0
  );
  return {
    quantityComplete,
    ...getReceiptConfirmation(
      preview,
      choice.mode === "serials" ? choice.serials.slice(0, newUnits) : undefined
    )
  };
}

function submit(
  f: Fixture,
  jobId: string,
  confirmation: Awaited<ReturnType<typeof dialogConfirmation>>
) {
  return completeJob(operationContext(f, localServiceRoleClient()!, USER), {
    jobId,
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
  "the serial hold setting leaves an available ten-unit batch lot receivable",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      const { jobId, makeMethodId } = await serialJob(f, 1);
      const id = f.prefix + "-unit-1";
      await holdUnits(f, true);
      await raiseIssue(f, 1);
      const serial = await getJobReceiptPreview(f.db, jobId, f.companyId);
      expect(serial?.tracking.trackedEntities[0]?.held).toBe(true);
      expect((await dialogConfirmation(f, jobId)).quantityComplete).toBe(0);

      await seed(f, async (trx) => {
        await trx
          .updateTable("item")
          .set({ itemTrackingType: "Batch" })
          .where("id", "=", f.assemblyId)
          .execute();
        await trx
          .updateTable("jobMakeMethod")
          .set({ requiresSerialTracking: false, requiresBatchTracking: true })
          .where("id", "=", makeMethodId)
          .execute();
        await trx
          .updateTable("job")
          .set({ quantity: 10 })
          .where("id", "=", jobId)
          .execute();
        await trx
          .updateTable("trackedEntity")
          .set({ quantity: 10 })
          .where("id", "=", id)
          .execute();
      });
      const lot = await getJobReceiptPreview(f.db, jobId, f.companyId);
      expect(lot?.tracking.trackedEntities[0]?.held).toBe(false);
      const payload = await dialogConfirmation(f, jobId);
      expect(payload).toEqual({ quantityComplete: 10 });
      expect((await submit(f, jobId, payload)).error).toBeNull();
      expect(await receipts(f, jobId)).toEqual([
        { trackedEntityId: id, quantity: 10 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "the dialog allows an empty selection with mixed holds and refuses it when every remaining serial is held",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 20);
      const { jobId } = await serialJob(f, 3);
      await holdUnits(f, true);
      const first = await dialogConfirmation(f, jobId);
      expect((await submit(f, jobId, first)).error).toBeNull();
      const reopen = () =>
        reopenJob(operationContext(f, client, USER), { jobId });
      expect((await reopen()).error).toBeNull();

      const submitBlockedByHolds = async () => {
        const preview = await getJobReceiptPreview(f.db, jobId, f.companyId);
        if (!preview) throw new Error("Missing job receipt preview");
        return isSerialReceiptBlockedByHolds(preview.tracking);
      };
      await raiseIssue(f, 2);
      expect(await submitBlockedByHolds()).toBe(false);
      const fresh = await dialogConfirmation(f, jobId);
      expect(fresh.expectedUnitIds).toEqual([]);
      expect((await submit(f, jobId, fresh)).error).toBeNull();
      expect(await receiptStatus(f, jobId)).toEqual({
        status: "Completed",
        quantityReceivedToInventory: 1
      });
      expect(await reopen()).toMatchObject({ error: null });
      await raiseIssue(f, 3);
      expect(await submitBlockedByHolds()).toBe(true);
      const held = await dialogConfirmation(f, jobId);
      expect((await submit(f, jobId, held)).error?.message).toMatch(
        /blocked by a quality issue/
      );
      expect(await receiptStatus(f, jobId)).toEqual({
        status: "In Progress",
        quantityReceivedToInventory: 1
      });
      expect(await receipts(f, jobId)).toEqual([
        { trackedEntityId: f.prefix + "-unit-1", quantity: 1 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "overlapping final MES and manual completions post the selected serial once",
  async () => {
    const f = await alwaysPostFixture();
    const gate = await connectLocalTestDatabase();
    let posting: ReturnType<typeof invokePosting> | undefined;
    let manual: ReturnType<typeof submit> | undefined;
    try {
      await stockPart(f, 20);
      const { jobId, operationId } = await serialJob(f, 1);
      const unitId = f.prefix + "-unit-1";
      await holdUnits(f, true);
      await seed(f, (trx) =>
        trx
          .updateTable("jobOperation")
          .set({
            quantityComplete: 0,
            targetQuantity: 1,
            operationQuantity: 1,
            status: "In Progress"
          })
          .where("id", "=", operationId)
          .execute()
      );
      await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
        f.db
      );
      const preview = await dialogConfirmation(f, jobId);
      const {
        rows: [mes]
      } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
        f.db
      );
      await gate.transaction().execute(async (trx) => {
        // Hold the operation long enough for both real submissions to be in flight.
        await trx
          .selectFrom("jobOperation")
          .select("id")
          .where("id", "=", operationId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        posting = invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type: "jobOperationSerialComplete",
            jobOperationId: operationId,
            trackedEntityId: unitId,
            quantity: 1
          },
          issueMaterial
        );
        await expect
          .poll(
            async () =>
              (
                await sql<{
                  waiting: boolean;
                }>`SELECT pg_backend_pid() = ANY(pg_blocking_pids(${mes!.pid})) AS waiting`.execute(
                  trx
                )
              ).rows[0]?.waiting
          )
          .toBe(true);
        manual = submit(f, jobId, preview);
        await expect
          .poll(
            async () =>
              (
                await sql<{ waiting: boolean }>`
        SELECT EXISTS (SELECT 1 FROM pg_locks l WHERE NOT l.granted AND ${mes!.pid} = ANY(pg_blocking_pids(l.pid))) AS waiting
      `.execute(trx)
              ).rows[0]?.waiting
          )
          .toBe(true);
      });
      expect((await posting)?.error).toBeNull();
      expect((await manual)?.error?.message).toMatch(/reopen/i);
      expect(await receiptStatus(f, jobId)).toEqual({
        status: "Completed",
        quantityReceivedToInventory: 1
      });
      const job = await f.db
        .selectFrom("job")
        .select("quantityComplete")
        .where("id", "=", jobId)
        .executeTakeFirstOrThrow();
      expect(job.quantityComplete).toBe(1);
      expect(await receipts(f, jobId)).toEqual([
        { trackedEntityId: unitId, quantity: 1 }
      ]);
    } finally {
      await Promise.allSettled([posting, manual]);
      await gate.destroy();
      await f.cleanup();
    }
  }
);

postgrestTest(
  "a final MES completion queued behind ERP leaves the receipt and operation quantity intact",
  async (client) => {
    const f = await alwaysPostFixture();
    const gate = await connectLocalTestDatabase();
    let posting: ReturnType<typeof invokePosting> | undefined;
    let manual: ReturnType<typeof submit> | undefined;
    try {
      await stockPart(f, 20);
      const { jobId, operationId } = await serialJob(f, 1);
      const unitId = f.prefix + "-unit-1";
      await holdUnits(f, true);
      await seed(f, (trx) =>
        trx
          .updateTable("jobOperation")
          .set({
            quantityComplete: 0,
            targetQuantity: 1,
            operationQuantity: 1,
            status: "In Progress"
          })
          .where("id", "=", operationId)
          .execute()
      );
      await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
        f.db
      );
      const confirmation = await dialogConfirmation(f, jobId);
      const completeSerial = () =>
        invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type: "jobOperationSerialComplete",
            jobOperationId: operationId,
            trackedEntityId: unitId,
            quantity: 1
          },
          issueMaterial
        );
      const {
        rows: [mes]
      } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
        f.db
      );
      await gate.transaction().execute(async (trx) => {
        // The manual receipt locks the job, then waits here for its unit.
        await trx
          .selectFrom("trackedEntity")
          .select("id")
          .where("id", "=", unitId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        manual = submit(f, jobId, confirmation);
        const manualPid = async () =>
          (
            await sql<{ pid: number }>`
          SELECT pid FROM pg_locks WHERE NOT granted AND pg_backend_pid() = ANY(pg_blocking_pids(pid))
        `.execute(trx)
          ).rows[0]?.pid;
        await expect.poll(manualPid).toBeTypeOf("number");
        const erpPid = await manualPid();
        posting = completeSerial();
        await expect
          .poll(
            async () =>
              (
                await sql<{ waiting: boolean }>`
          SELECT ${erpPid}::int = ANY(pg_blocking_pids(${mes!.pid})) AS waiting
        `.execute(trx)
              ).rows[0]?.waiting
          )
          .toBe(true);
      });
      expect((await manual)?.error).toBeNull();
      expect((await posting)?.error?.message).toMatch(
        /job is already completed/i
      );
      const operation = () =>
        f.db
          .selectFrom("jobOperation")
          .select(["status", "quantityComplete"])
          .where("id", "=", operationId)
          .executeTakeFirstOrThrow();
      expect(await operation()).toEqual({
        status: "Done",
        quantityComplete: 1
      });
      expect(await receiptStatus(f, jobId)).toEqual({
        status: "Completed",
        quantityReceivedToInventory: 1
      });
      expect(
        (await reopenJob(operationContext(f, client, USER), { jobId })).error
      ).toBeNull();
      expect((await completeSerial()).error?.message).toMatch(
        /already been received/i
      );
      expect(
        await f.db
          .selectFrom("productionQuantity")
          .select("id")
          .where("jobOperationId", "=", operationId)
          .execute()
      ).toEqual([]);
      expect(await receipts(f, jobId)).toEqual([
        { trackedEntityId: unitId, quantity: 1 }
      ]);
      expect(
        (
          await f.db
            .selectFrom("job")
            .select("quantityComplete")
            .where("id", "=", jobId)
            .executeTakeFirstOrThrow()
        ).quantityComplete
      ).toBe(1);
    } finally {
      await Promise.allSettled([posting, manual]);
      await gate.destroy();
      await f.cleanup();
    }
  }
);

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
