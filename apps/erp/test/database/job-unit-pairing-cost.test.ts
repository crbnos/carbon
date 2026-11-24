// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { issueMaterial } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  stockPart,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";
import { createPairedJob } from "./fixtures/paired-job";

for (const scrapLast of [false, true]) {
  databaseTest(
    scrapLast
      ? "a scrapped packed unit leaves its remaining WIP to both good units"
      : "a partial receipt carries its own source cost and carton, leaving the other source in WIP",
    async () => {
      const f = await alwaysPostFixture();
      try {
        const common = {
          companyId: f.companyId,
          itemId: f.assemblyId,
          quantity: 1
        };
        await f.db
          .updateTable("item")
          .set({ itemTrackingType: "Serial" })
          .where("id", "=", f.assemblyId)
          .where("companyId", "=", f.companyId)
          .execute();

        // The second source sorts first by its serial. FIFO issues these layers
        // at $12 then $30. Receiving the selected unit must respect that choice.
        const sources = [
          {
            id: f.prefix + "-z",
            serial: "Z-first",
            cost: 12,
            postingDate: "2026-01-01"
          },
          {
            id: f.prefix + "-a",
            serial: "A-second",
            cost: 30,
            postingDate: "2026-01-02"
          }
        ];
        if (scrapLast) {
          sources.push({
            id: f.prefix + "-scrap",
            serial: "S-scrap",
            cost: 18,
            postingDate: "2026-01-03"
          });
        }
        await f.db
          .insertInto("trackedEntity")
          .values(
            sources.map((source) => ({
              ...common,
              id: source.id,
              readableId: source.serial,
              status: "Available" as const,
              sourceDocument: "Item",
              sourceDocumentId: f.assemblyId,
              createdBy: USER
            }))
          )
          .execute();
        await f.db
          .insertInto("itemLedger")
          .values(
            sources.map((source) => ({
              ...common,
              trackedEntityId: source.id,
              entryType: "Positive Adjmt." as const,
              locationId: f.locationId,
              postingDate: source.postingDate,
              createdBy: USER
            }))
          )
          .execute();
        await f.db
          .insertInto("costLedger")
          .values(
            sources.map((source) => ({
              ...common,
              itemLedgerType: "Positive Adjmt." as const,
              costLedgerType: "Direct Cost" as const,
              adjustment: false,
              trackedEntityId: source.id,
              cost: source.cost,
              postingDate: source.postingDate,
              remainingQuantity: 1
            }))
          )
          .execute();

        await stockPart(f, sources.length);
        const job = await createPairedJob(f, f.assemblyId, sources.length);
        const material = await f.db
          .selectFrom("jobMaterial")
          .select("jobMakeMethodId")
          .where("id", "=", job.materialId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow();
        await f.db
          .insertInto("jobMaterial")
          .values({
            jobId: job.jobId,
            jobMakeMethodId: material.jobMakeMethodId,
            itemId: f.partId,
            itemType: "Part",
            methodType: "Pull from Inventory",
            description: "Shipping carton",
            quantity: 1,
            estimatedQuantity: sources.length,
            unitOfMeasureCode: "EA",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        let deferredOutput: string | undefined;
        const log = (id: string) =>
          invokePosting(
            handlesOf(f.ctx),
            "issue",
            {
              type: "jobOperationSerialComplete",
              jobOperationId: job.operationId,
              trackedEntityId: id,
              quantity: 1
            },
            issueMaterial
          ).then(unwrap);
        for (const source of sources) {
          const output = await f.db
            .selectFrom("trackedEntity")
            .select("id")
            .where("itemId", "=", job.salesItemId)
            .where("companyId", "=", f.companyId)
            .where("readableId", "is", null)
            .where(sql<boolean>`attributes->>'Job' = ${job.jobId}`)
            .executeTakeFirstOrThrow();
          unwrap(
            await invokePosting(
              handlesOf(f.ctx),
              "issue",
              {
                type: "trackedEntitiesToOperation",
                materialId: job.materialId,
                jobOperationId: job.operationId,
                parentTrackedEntityId: output.id!,
                children: [{ trackedEntityId: source.id, quantity: 1 }]
              },
              issueMaterial
            )
          );
          if (source.serial === "S-scrap") {
            const reason = await f.db
              .insertInto("scrapReason")
              .values({
                name: "Damaged",
                companyId: f.companyId,
                createdBy: USER
              })
              .returning("id")
              .executeTakeFirstOrThrow();
            unwrap(
              await invokePosting(
                handlesOf(f.ctx),
                "issue",
                {
                  type: "jobOperationScrap",
                  jobOperationId: job.operationId,
                  quantity: 1,
                  trackedEntityId: output.id!,
                  scrapReasonId: reason.id
                },
                issueMaterial
              )
            );
            continue;
          }
          if (source.serial === "Z-first") {
            deferredOutput = output.id!;
          } else {
            await log(output.id!);
          }
        }
        const receive = (cumulative: number) =>
          sql`SELECT complete_job_to_inventory(
          ${job.jobId}, ${cumulative}::numeric, NULL, ${f.locationId}, ${f.companyId}, ${USER}
        )`.execute(f.db);
        const wip = async () => {
          const { rows } = await sql<{ value: number }>`
          SELECT job_wip_balance(${job.jobId}, ${f.companyId}) AS value
        `.execute(f.db);
          return Number(rows[0]!.value);
        };
        const cartonIssues = () =>
          f.db
            .selectFrom("itemLedger")
            .select("quantity")
            .where("companyId", "=", f.companyId)
            .where("documentId", "=", job.jobId)
            .where("documentType", "=", "Job Consumption")
            .where("itemId", "=", f.partId)
            .orderBy("entryNumber")
            .execute();
        const layerCosts = () =>
          f.db
            .selectFrom("costLedger")
            .select(["cost", "quantity"])
            .where("companyId", "=", f.companyId)
            .where("documentType", "=", "Job Receipt")
            .where("documentId", "=", job.jobId)
            .orderBy("entryNumber")
            .execute();
        // The $18 already issued for a scrapped source remains in job WIP.
        // The two surviving units absorb $9 each.
        const scrapShare = scrapLast ? 9 : 0;
        await receive(1);
        expect(await layerCosts()).toEqual([
          { cost: 40 + scrapShare, quantity: 1 }
        ]);
        await receive(1);
        expect(await layerCosts()).toEqual([
          { cost: 40 + scrapShare, quantity: 1 }
        ]);
        expect(await wip()).toBe(12 + scrapShare);
        expect(await cartonIssues()).toEqual([{ quantity: -1 }]);
        // On a released job reaching the good target by MES Log also posts
        // the final receipt. The explicit retry covers both Finish modes.
        await log(deferredOutput!);
        await receive(2);
        expect(await layerCosts()).toEqual([
          { cost: 40 + scrapShare, quantity: 1 },
          { cost: 22 + scrapShare, quantity: 1 }
        ]);
        expect(await wip()).toBe(0);
        expect(await cartonIssues()).toEqual([
          { quantity: -1 },
          { quantity: -1 }
        ]);
      } finally {
        await f.cleanup();
      }
    }
  );
}
