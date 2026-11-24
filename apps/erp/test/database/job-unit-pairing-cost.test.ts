// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { issueMaterial } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  stockPart,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";
import { shipPackedUnit } from "./fixtures/packout-shipment";
import { confirmPackoutCommand, createPairedJob } from "./fixtures/paired-job";

type Source = { serial: string; cost: number; postingDate: string };
const cheap = { serial: "Z-first", cost: 12, postingDate: "2026-01-01" };
const rich = { serial: "A-second", cost: 30, postingDate: "2026-01-02" };
const damaged = { serial: "S-scrap", cost: 18, postingDate: "2026-01-03" };

async function pricedPackout(
  f: Fixture,
  target: number,
  inputs: Source[],
  withCartons = true
) {
  const sources = inputs.map((input) => ({
    ...input,
    id: f.prefix + input.serial
  }));
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

  const job = await createPairedJob(f, f.assemblyId, target);
  if (withCartons) {
    await stockPart(f, target);
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
        estimatedQuantity: target,
        unitOfMeasureCode: "EA",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  }
  const post = async (input: Parameters<typeof issueMaterial>[1]) =>
    invokePosting(
      handlesOf(f.ctx),
      "issue",
      await confirmPackoutCommand(f, input),
      issueMaterial
    ).then(unwrap);
  const log = async (id: string) =>
    post({
      type: "jobOperationSerialComplete",
      jobOperationId: job.operationId,
      trackedEntityId: id,
      quantity: 1
    });
  const issue = async (source: Source) => {
    const output = await f.db
      .selectFrom("trackedEntity")
      .select("id")
      .where("itemId", "=", job.salesItemId)
      .where("companyId", "=", f.companyId)
      .where("readableId", "is", null)
      .where(sql<boolean>`attributes->>'Job' = ${job.jobId}`)
      .executeTakeFirstOrThrow();
    await post({
      type: "trackedEntitiesToOperation",
      materialId: job.materialId,
      jobOperationId: job.operationId,
      parentTrackedEntityId: output.id!,
      children: [{ trackedEntityId: f.prefix + source.serial, quantity: 1 }]
    });
    return output.id!;
  };
  const scrap = async (id: string) => {
    const reason = await f.db
      .insertInto("scrapReason")
      .values({
        name: "Damaged",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await post({
      type: "jobOperationScrap",
      jobOperationId: job.operationId,
      quantity: 1,
      trackedEntityId: id,
      scrapReasonId: reason.id
    });
  };
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
      .select(["cost", "remainingQuantity", "trackedEntityId"])
      .where("companyId", "=", f.companyId)
      .where("documentType", "=", "Job Receipt")
      .where("documentId", "=", job.jobId)
      .orderBy("entryNumber")
      .execute();

  const ship = async (id: string, cost: number) => {
    const { shipmentId } = await shipPackedUnit(f, job.salesItemId, id);
    const journal = await f.db
      .selectFrom("journalLine")
      .select("amount")
      .where("companyId", "=", f.companyId)
      .where("documentId", "=", shipmentId)
      .where("accountId", "=", f.account("cogs"))
      .execute();
    expect(
      journal.reduce((total, line) => total + Number(line.amount), 0)
    ).toBe(cost);
  };
  return {
    job,
    issue,
    log,
    receive,
    wip,
    cartonIssues,
    layerCosts,
    ship,
    scrap
  };
}

for (const together of [false, true]) {
  databaseTest(
    `shipping in reverse order relieves each selected serial after ${together ? "one combined receipt" : "two separate receipts"}`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        const pack = await pricedPackout(f, 2, [cheap, rich]);
        const second = await pack.issue(cheap);
        const first = await pack.issue(rich);
        await pack.log(first);
        const firstLayer = {
          trackedEntityId: first,
          cost: 40,
          remainingQuantity: 1
        };
        const secondLayer = {
          trackedEntityId: second,
          cost: 22,
          remainingQuantity: 1
        };
        if (!together) {
          await pack.receive(1);
          await pack.receive(1);
          expect(await pack.layerCosts()).toEqual([firstLayer]);
          expect(await pack.wip()).toBe(12);
          expect(await pack.cartonIssues()).toEqual([{ quantity: -1 }]);
        }
        await pack.log(second);
        await pack.receive(2);
        expect(await pack.layerCosts()).toEqual([firstLayer, secondLayer]);
        expect(await pack.wip()).toBe(0);
        expect(await pack.cartonIssues()).toEqual(
          together ? [{ quantity: -2 }] : [{ quantity: -1 }, { quantity: -1 }]
        );
        await pack.ship(second, 22);
        expect(await pack.layerCosts()).toEqual([
          firstLayer,
          { ...secondLayer, remainingQuantity: 0 }
        ]);
        await pack.ship(first, 40);
        expect(await pack.layerCosts()).toEqual([
          { ...firstLayer, remainingQuantity: 0 },
          { ...secondLayer, remainingQuantity: 0 }
        ]);
      } finally {
        await f.cleanup();
      }
    }
  );
}

for (const replacement of [false, true]) {
  databaseTest(
    replacement
      ? "a started replacement keeps its job open and its source cost in WIP"
      : "a scrapped packed unit leaves its remaining WIP to both good units",
    async () => {
      const f = await alwaysPostFixture();
      try {
        const pack = await pricedPackout(f, replacement ? 2 : 3, [
          cheap,
          rich,
          damaged
        ]);
        await pack.scrap(await pack.issue(damaged));
        const first = await pack.issue(rich);
        await pack.log(first);
        const second = await pack.issue(cheap);
        await pack.receive(1);
        const state = await f.db
          .selectFrom("job")
          .select(["status", "quantityReceivedToInventory"])
          .where("companyId", "=", f.companyId)
          .where("id", "=", pack.job.jobId)
          .executeTakeFirstOrThrow();
        expect(["Ready", "In Progress"]).toContain(state.status);
        expect(state.quantityReceivedToInventory).toBe(1);
        expect(await pack.wip()).toBe(21);
        expect(await pack.layerCosts()).toEqual([
          { trackedEntityId: first, remainingQuantity: 1, cost: 49 }
        ]);
        await pack.log(second);
        await pack.receive(2);
        expect(await pack.layerCosts()).toEqual([
          { trackedEntityId: first, remainingQuantity: 1, cost: 49 },
          { trackedEntityId: second, remainingQuantity: 1, cost: 31 }
        ]);
        expect(await pack.wip()).toBe(0);
        expect(await pack.cartonIssues()).toEqual([
          { quantity: -1 },
          { quantity: -1 }
        ]);
      } finally {
        await f.cleanup();
      }
    }
  );
}

databaseTest(
  "a free packed serial consumes its own zero-value layer on shipment",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const free = { ...cheap, cost: 0 };
      const pack = await pricedPackout(f, 2, [rich, free], false);
      const first = await pack.issue(rich);
      await pack.log(first);
      await pack.receive(1);
      const second = await pack.issue(free);
      await pack.log(second);
      await pack.ship(second, 0);
      expect(await pack.layerCosts()).toEqual([
        { trackedEntityId: first, remainingQuantity: 1, cost: 30 },
        { trackedEntityId: second, remainingQuantity: 0, cost: 0 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
