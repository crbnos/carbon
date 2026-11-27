// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { sql, type Transaction } from "kysely";
import { expect } from "vitest";
import { insertProductionQuantityIfCurrent } from "../../../mes/app/services/production-quantity.server";
import { issueMaterial } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  jobFixture,
  seed,
  stockPart,
  USER,
  workCenterFixture,
  type Fixture
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { holdUnits, serialJob } from "./fixtures/job-unit-hold";
import { connectLocalTestDatabase } from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";

async function addInspection(
  trx: Transaction<KyselyDatabase>,
  f: Fixture,
  inspectionId: string,
  jobId: string,
  operationId: string
) {
  await trx
    .insertInto("inspection")
    .values({
      id: inspectionId,
      inspectionId: "INS-1",
      sourceDocument: "Job Operation",
      sourceDocumentId: jobId,
      sourceDocumentLineId: operationId,
      itemId: f.assemblyId,
      lotSize: 2,
      sampleSize: 2,
      samplingStandard: "ANSI_Z1_4",
      samplingPlanType: "All",
      acceptanceNumber: 0,
      rejectionNumber: 1,
      status: "Partial",
      companyId: f.companyId,
      createdBy: USER
    })
    .execute();
}

async function waitForBlockedWriter(
  trx: Transaction<KyselyDatabase>,
  blockingPid?: number
) {
  const {
    rows: [gate]
  } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(trx);
  let blockedPid: number | undefined;
  await expect
    .poll(
      async () => {
        const { rows } = await sql<{ pid: number }>`
      SELECT pid FROM pg_locks
      WHERE NOT granted AND ${blockingPid ?? gate.pid}::int = ANY(pg_blocking_pids(pid))
    `.execute(trx);
        blockedPid = rows[0]?.pid;
        return blockedPid;
      },
      { timeout: 10_000 }
    )
    .toBeTypeOf("number");
  return blockedPid!;
}

for (const first of [
  "inspection Scrap",
  "named Scrap",
  "named Complete"
] as const) {
  const target = first === "named Complete" ? 2 : 1;
  const scrapQuantity = first === "named Complete" ? 0 : 1;
  postgrestTest(
    `overlapping final MES Complete and Scrap preserve serial credit when ${first} posts first`,
    async (client) => {
      const f = await alwaysPostFixture();
      const gate = await connectLocalTestDatabase();
      const scrapDb = await connectLocalTestDatabase();
      let scrap: PromiseLike<{ error: { message: string } | null }> | undefined;
      let production: ReturnType<typeof invokePosting> | undefined;
      try {
        await stockPart(f, 20);
        const { jobId, operationId, materialId } = await serialJob(f, 2);
        await holdUnits(f, true);
        const unit = f.prefix + "-unit-1";
        const sibling = f.prefix + "-unit-2";
        const inspectionId = f.prefix + "-inspection";
        const reason = await f.db
          .insertInto("scrapReason")
          .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
          .returning("id")
          .executeTakeFirstOrThrow();
        // Two available serials, with one planned spare in the Scrap-first cases.
        await seed(f, async (trx) => {
          await trx
            .updateTable("job")
            .set({ quantity: target, scrapQuantity })
            .where("id", "=", jobId)
            .execute();
          await trx
            .updateTable("jobOperation")
            .set({
              quantityComplete: 0,
              quantityScrapped: 0,
              targetQuantity: target,
              operationQuantity: 2,
              status: "In Progress"
            })
            .where("id", "=", operationId)
            .execute();
          await trx
            .updateTable("jobMaterial")
            .set({ estimatedQuantity: 4 })
            .where("id", "=", materialId)
            .execute();
          if (first === "inspection Scrap") {
            await addInspection(trx, f, inspectionId, jobId, operationId);
          }
        });
        for (const db of [f.db, scrapDb]) {
          await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
            db
          );
        }
        const complete = (trackedEntityId: string) =>
          invokePosting(
            handlesOf(f.ctx),
            "issue",
            {
              type: "jobOperationSerialComplete",
              jobOperationId: operationId,
              trackedEntityId,
              quantity: 1
            },
            issueMaterial
          );
        const fields = {
          jobOperationId: operationId,
          quantity: 1,
          scrapReasonId: reason.id
        };
        // The inspection disposition inserts an unnamed Scrap via PostgREST;
        // the Scrap form posts a named serial to the ERP.
        const postScrap = () =>
          first === "inspection Scrap"
            ? Promise.resolve(
                client
                  .from("productionQuantity")
                  .insert({
                    ...fields,
                    type: "Scrap",
                    inspectionId,
                    companyId: f.companyId,
                    createdBy: USER
                  })
                  .select("*")
              )
            : invokePosting(
                handlesOf({ ...f.ctx, db: scrapDb }),
                "issue",
                {
                  type: "jobOperationScrap",
                  ...fields,
                  trackedEntityId: unit
                },
                issueMaterial
              );
        await gate.transaction().execute(async (trx) => {
          await trx
            .selectFrom("jobOperation")
            .select("id")
            .where("id", "=", operationId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          const submitCompletion = () =>
            complete(first === "inspection Scrap" ? sibling : unit);
          if (first === "named Complete") production = submitCompletion();
          else scrap = postScrap();
          const firstPid = await waitForBlockedWriter(trx);
          if (first === "named Complete") scrap = postScrap();
          else production = submitCompletion();
          await waitForBlockedWriter(trx, firstPid);
        });
        const worked = await production;
        const scrapped = await scrap;
        if (first === "named Complete") {
          expect(worked?.error).toBeNull();
          expect(scrapped?.error?.message).toMatch(
            /already complete on this operation/i
          );
          // Pre-upgrade serials may have only the genealogy of their completion.
          await sql`UPDATE "trackedEntity" SET attributes = attributes - ${"Operation " + operationId}::text
            WHERE id = ${unit} AND "companyId" = ${f.companyId}`.execute(f.db);
          expect((await postScrap()).error?.message).toMatch(
            /already complete on this operation/i
          );
        } else {
          expect(scrapped?.error).toBeNull();
          if (first === "named Scrap") {
            expect(worked?.error?.message).toMatch(/already been scrapped/i);
          } else {
            expect(worked?.error).toBeNull();
          }
        }
        if (first !== "inspection Scrap")
          expect((await complete(sibling)).error).toBeNull();
        expect(
          await f.db
            .selectFrom("jobOperation")
            .select(["status", "quantityComplete", "quantityScrapped"])
            .where("id", "=", operationId)
            .executeTakeFirstOrThrow()
        ).toEqual({
          status: "Done",
          quantityComplete: target,
          quantityScrapped: scrapQuantity
        });
        expect(
          await f.db
            .selectFrom("job")
            .select([
              "status",
              "quantityComplete",
              "quantityReceivedToInventory"
            ])
            .where("id", "=", jobId)
            .executeTakeFirstOrThrow()
        ).toEqual({
          status: "Completed",
          quantityComplete: target,
          quantityReceivedToInventory: target
        });
        expect(
          await f.db
            .selectFrom("itemLedger")
            .select(["trackedEntityId", "quantity"])
            .where("documentId", "=", jobId)
            .where("companyId", "=", f.companyId)
            .where("documentType", "=", "Job Receipt")
            .orderBy("trackedEntityId")
            .execute()
        ).toEqual(
          (first === "named Complete" ? [unit, sibling] : [sibling]).map(
            (trackedEntityId) => ({ trackedEntityId, quantity: 1 })
          )
        );
      } finally {
        await Promise.allSettled([scrap, production]);
        await scrapDb.destroy();
        await gate.destroy();
        await f.cleanup();
      }
    }
  );
}

postgrestTest(
  "ordinary MES Finish with an open timer overlaps inspection Scrap and receives only the worked serial",
  async (client) => {
    const f = await alwaysPostFixture();
    const gate = await connectLocalTestDatabase();
    let finish: PromiseLike<{ error: { message: string } | null }> | undefined;
    let scrap: PromiseLike<{ error: { message: string } | null }> | undefined;
    try {
      await stockPart(f, 20);
      const { jobId, operationId } = await serialJob(f, 2);
      await holdUnits(f, true);
      const inspectionId = f.prefix + "-inspection";
      const workedUnit = f.prefix + "-unit-1";
      const workCenterId = await workCenterFixture(f);
      const reason = await f.db
        .insertInto("scrapReason")
        .values({
          name: "Damaged",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await seed(f, async (trx) => {
        await trx
          .updateTable("jobOperation")
          .set({
            quantityComplete: 0,
            quantityScrapped: 0,
            targetQuantity: 2,
            operationQuantity: 2,
            status: "In Progress"
          })
          .where("id", "=", operationId)
          .execute();
        await addInspection(trx, f, inspectionId, jobId, operationId);
      });
      await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
        f.db
      );
      const worked = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "jobOperationSerialComplete",
          jobOperationId: operationId,
          trackedEntityId: workedUnit,
          quantity: 1
        },
        issueMaterial
      );
      expect(worked.error).toBeNull();
      const timer = await f.db
        .insertInto("productionEvent")
        .values({
          jobOperationId: operationId,
          type: "Labor",
          startTime: sql<string>`now() - interval '1 hour'`,
          workCenterId,
          employeeId: USER,
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const finishArgs = {
        p_job_operation_id: operationId,
        p_company_id: f.companyId,
        p_user_id: USER
      };
      expect(
        await client.rpc("finish_mes_job_operation", {
          ...finishArgs,
          p_company_id: f.prefix + "-foreign"
        })
      ).toMatchObject({ data: [], error: null });
      await gate.transaction().execute(async (trx) => {
        // Pause the Done trigger after it has locked the operation, at the
        // point where it ends the open timer. Then submit the inspection write.
        await trx
          .selectFrom("productionEvent")
          .select("id")
          .where("id", "=", timer.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        finish = Promise.resolve(
          client.rpc("finish_mes_job_operation", finishArgs)
        );
        const finishPid = await waitForBlockedWriter(trx);
        scrap = Promise.resolve(
          client.from("productionQuantity").insert({
            jobOperationId: operationId,
            type: "Scrap",
            quantity: 1,
            scrapReasonId: reason.id,
            inspectionId,
            companyId: f.companyId,
            createdBy: USER
          })
        );
        await waitForBlockedWriter(trx, finishPid);
      });
      expect((await finish)?.error).toBeNull();
      expect((await scrap)?.error).toBeNull();
      expect(
        await f.db
          .selectFrom("productionEvent")
          .select("endTime")
          .where("id", "=", timer.id)
          .executeTakeFirstOrThrow()
      ).toEqual({ endTime: expect.anything() });
      expect(
        await f.db
          .selectFrom("jobOperation")
          .select(["status", "quantityComplete", "quantityScrapped"])
          .where("id", "=", operationId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Done", quantityComplete: 1, quantityScrapped: 1 });
      expect(
        await f.db
          .selectFrom("job")
          .select(["status", "quantityComplete", "quantityReceivedToInventory"])
          .where("id", "=", jobId)
          .executeTakeFirstOrThrow()
      ).toEqual({
        status: "Completed",
        quantityComplete: 1,
        quantityReceivedToInventory: 1
      });
      expect(
        await f.db
          .selectFrom("itemLedger")
          .select(["trackedEntityId", "quantity"])
          .where("documentId", "=", jobId)
          .where("companyId", "=", f.companyId)
          .where("documentType", "=", "Job Receipt")
          .execute()
      ).toEqual([{ trackedEntityId: workedUnit, quantity: 1 }]);
    } finally {
      await Promise.allSettled([finish, scrap]);
      await gate.destroy();
      await f.cleanup();
    }
  }
);

postgrestTest(
  "untracked MES Complete with an expected quantity overlaps inspection Scrap with holds disabled",
  async (client) => {
    const f = await alwaysPostFixture();
    const gate = await connectLocalTestDatabase();
    let produced:
      ReturnType<typeof insertProductionQuantityIfCurrent> | undefined;
    let scrap: PromiseLike<{ error: { message: string } | null }> | undefined;
    try {
      const { jobId, operationId } = await jobFixture(f);
      const inspectionId = f.prefix + "-inspection";
      const reason = await f.db
        .insertInto("scrapReason")
        .values({
          name: "Damaged",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await holdUnits(f, false);
      await seed(f, async (trx) => {
        await trx
          .updateTable("job")
          .set({ status: "In Progress", scrapQuantity: 1 })
          .where("id", "=", jobId)
          .execute();
        await trx
          .updateTable("jobOperation")
          .set({
            status: "In Progress",
            quantityComplete: 0,
            quantityScrapped: 0,
            targetQuantity: 1,
            operationQuantity: 2
          })
          .where("id", "=", operationId)
          .execute();
        await addInspection(trx, f, inspectionId, jobId, operationId);
      });
      await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
        f.db
      );
      const payload = {
        jobOperationId: operationId,
        companyId: f.companyId,
        createdBy: USER,
        quantity: 1
      };
      await gate.transaction().execute(async (trx) => {
        await trx
          .selectFrom("jobOperation")
          .select("id")
          .where("id", "=", operationId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        produced = insertProductionQuantityIfCurrent(f.db, payload, 0);
        const writer = await waitForBlockedWriter(trx);
        scrap = Promise.resolve(
          client
            .from("productionQuantity")
            .insert({
              ...payload,
              type: "Scrap",
              scrapReasonId: reason.id,
              inspectionId
            })
        );
        await waitForBlockedWriter(trx, writer);
      });
      expect(await produced).toEqual({ id: expect.any(String) });
      expect((await scrap)?.error).toBeNull();
      expect(
        await insertProductionQuantityIfCurrent(f.db, payload, 0)
      ).toBeNull();
      expect(
        await f.db
          .selectFrom("jobOperation")
          .select(["status", "quantityComplete", "quantityScrapped"])
          .where("id", "=", operationId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Done", quantityComplete: 1, quantityScrapped: 1 });
      expect(
        await f.db
          .selectFrom("job")
          .select(["status", "quantityComplete", "quantityReceivedToInventory"])
          .where("id", "=", jobId)
          .executeTakeFirstOrThrow()
      ).toEqual({
        status: "Completed",
        quantityComplete: 1,
        quantityReceivedToInventory: 1
      });
      expect(
        await f.db
          .selectFrom("itemLedger")
          .select(["quantity", "trackedEntityId"])
          .where("documentType", "=", "Job Receipt")
          .where("documentId", "=", jobId)
          .where("companyId", "=", f.companyId)
          .execute()
      ).toEqual([{ quantity: 1, trackedEntityId: null }]);
    } finally {
      await Promise.allSettled([produced, scrap]);
      await gate.destroy();
      await f.cleanup();
    }
  }
);
