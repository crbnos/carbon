// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { issueMaterial } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  seed,
  stockPart,
  USER
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { holdUnits, serialJob } from "./fixtures/job-unit-hold";
import { connectLocalTestDatabase } from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";

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
          const firstWriter = async () =>
            (
              await sql<{ pid: number }>`
              SELECT pid FROM pg_locks WHERE NOT granted AND pg_backend_pid() = ANY(pg_blocking_pids(pid))
            `.execute(trx)
            ).rows[0]?.pid;
          await expect
            .poll(firstWriter, { timeout: 10_000 })
            .toBeTypeOf("number");
          const firstPid = await firstWriter();
          if (first === "named Complete") scrap = postScrap();
          else production = submitCompletion();
          await expect
            .poll(
              async () => {
                const { rows } = await sql<{ blocked: boolean }>`
              SELECT EXISTS (SELECT 1 FROM pg_locks WHERE NOT granted AND ${firstPid}::int = ANY(pg_blocking_pids(pid))) AS blocked
            `.execute(trx);
                return rows[0]?.blocked;
              },
              { timeout: 10_000 }
            )
            .toBe(true);
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
