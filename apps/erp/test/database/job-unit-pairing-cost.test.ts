// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  issueMaterial,
  postShipment
} from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  stampCutover,
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

async function stockTrackedUnits(
  f: Fixture,
  itemId: string,
  inputs: (Source & { quantity?: number })[]
) {
  const sources = inputs.map((input) => ({
    ...input,
    id: f.prefix + input.serial
  }));
  const common = {
    companyId: f.companyId,
    itemId
  };
  await f.db
    .insertInto("trackedEntity")
    .values(
      sources.map((source) => ({
        ...common,
        quantity: source.quantity ?? 1,
        id: source.id,
        readableId: source.serial,
        status: "Available" as const,
        sourceDocument: "Item",
        sourceDocumentId: itemId,
        createdBy: USER
      }))
    )
    .execute();
  await f.db
    .insertInto("itemLedger")
    .values(
      sources.map((source) => ({
        ...common,
        quantity: source.quantity ?? 1,
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
        quantity: source.quantity ?? 1,
        itemLedgerType: "Positive Adjmt." as const,
        costLedgerType: "Direct Cost" as const,
        adjustment: false,
        trackedEntityId: source.id,
        cost: source.cost,
        postingDate: source.postingDate,
        remainingQuantity: source.quantity ?? 1
      }))
    )
    .execute();
}

async function pricedPackout(
  f: Fixture,
  target: number,
  inputs: Source[],
  withCartons = true
) {
  await f.db
    .updateTable("item")
    .set({ itemTrackingType: "Serial" })
    .where("id", "=", f.assemblyId)
    .where("companyId", "=", f.companyId)
    .execute();

  await stockTrackedUnits(f, f.assemblyId, inputs);
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
  const blankOutput = () =>
    f.db
      .selectFrom("trackedEntity")
      .select("id")
      .where("itemId", "=", job.salesItemId)
      .where("companyId", "=", f.companyId)
      .where("readableId", "is", null)
      .where(sql<boolean>`attributes->>'Job' = ${job.jobId}`)
      .where("status", "in", ["Available", "Reserved"])
      .executeTakeFirstOrThrow();
  const fit = (source: Source, outputId: string, materialId: string) =>
    post({
      type: "trackedEntitiesToOperation",
      materialId,
      jobOperationId: job.operationId,
      parentTrackedEntityId: outputId,
      children: [{ trackedEntityId: f.prefix + source.serial, quantity: 1 }]
    });
  const issue = async (source: Source, outputId?: string) => {
    const id = outputId ?? (await blankOutput()).id!;
    await fit(source, id, job.materialId);
    return id;
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
  const receive = (cumulative: number, serials: string[]) =>
    sql`SELECT receive_job_to_inventory(
      ${job.jobId}, ${cumulative}::numeric, ${f.companyId}, ${USER},
      ${f.locationId}, NULL, ${serials}::text[]
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
    post,
    issue,
    fit,
    blankOutput,
    log,
    receive,
    wip,
    cartonIssues,
    layerCosts,
    ship,
    scrap
  };
}

async function trackedCartons(
  f: Fixture,
  pack: Awaited<ReturnType<typeof pricedPackout>>,
  lots: { cost: number; quantity: number }[]
) {
  const { jobMakeMethodId } = await f.db
    .selectFrom("jobMaterial")
    .select("jobMakeMethodId")
    .where("id", "=", pack.job.materialId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  await f.db
    .updateTable("item")
    .set({ itemTrackingType: "Batch" })
    .where("id", "=", f.partId)
    .where("companyId", "=", f.companyId)
    .execute();
  const material = await f.db
    .insertInto("jobMaterial")
    .values({
      itemId: f.partId,
      itemType: "Part",
      methodType: "Pull from Inventory",
      description: "Tracked carton",
      requiresBatchTracking: true,
      jobId: pack.job.jobId,
      jobMakeMethodId,
      jobOperationId: pack.job.operationId,
      quantity: 1,
      estimatedQuantity: lots.length,
      unitOfMeasureCode: "EA",
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const cartons = lots.map((lot, index) => ({
    ...lot,
    serial: `carton-${index}`,
    postingDate: cheap.postingDate
  }));
  await stockTrackedUnits(f, f.partId, cartons);
  return {
    fit: async (index: number, outputId: string) => {
      const result = await pack.fit(cartons[index]!, outputId, material.id!);
      return (
        (Array.isArray(result.splitEntities) &&
          result.splitEntities[0]?.newId) ||
        f.prefix + cartons[index]!.serial
      );
    },
    returnToStock: (componentId: string, outputId: string) =>
      pack.post({
        type: "unconsumeTrackedEntities",
        materialId: material.id!,
        parentTrackedEntityId: outputId,
        children: [{ trackedEntityId: componentId, quantity: 1 }]
      })
  };
}

databaseTest(
  "replacement packaging stays in WIP before its serial is fitted",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const inputs = [damaged, rich, cheap].map((source) => ({
        ...source,
        cost: 20
      }));
      const pack = await pricedPackout(f, 2, inputs, false);
      const carton = await trackedCartons(f, pack, [{ cost: 3, quantity: 1 }]);
      await pack.scrap(await pack.issue(inputs[0]!));
      const first = await pack.issue(inputs[1]!);
      await pack.log(first);
      const replacement = (await pack.blankOutput()).id!;
      await carton.fit(0, replacement);
      expect(await pack.wip()).toBe(43);
      await pack.receive(1, [rich.serial]);
      const jobState = () =>
        f.db
          .selectFrom("job")
          .select(["status", "quantityReceivedToInventory"])
          .where("companyId", "=", f.companyId)
          .where("id", "=", pack.job.jobId)
          .executeTakeFirstOrThrow();
      const partial = await jobState();
      expect(["Ready", "In Progress"]).toContain(partial.status);
      expect(partial.quantityReceivedToInventory).toBe(1);
      // Half the scrapped unit plus the replacement's own carton remains.
      expect(await pack.wip()).toBe(13);
      expect(await pack.layerCosts()).toEqual([
        { trackedEntityId: first, remainingQuantity: 1, cost: 30 }
      ]);
      await pack.issue(inputs[2]!, replacement);
      await pack.log(replacement);
      await pack.receive(2, [cheap.serial]);
      expect(await jobState()).toEqual({
        status: "Completed",
        quantityReceivedToInventory: 2
      });
      expect(await pack.wip()).toBe(0);
      expect(await pack.layerCosts()).toEqual([
        { trackedEntityId: first, remainingQuantity: 1, cost: 30 },
        { trackedEntityId: replacement, remainingQuantity: 1, cost: 33 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a split carton can be returned at its issued cost only before its output is logged",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const inputs = [rich, cheap].map((source) => ({ ...source, cost: 20 }));
      const pack = await pricedPackout(f, 2, inputs, false);
      const carton = await trackedCartons(f, pack, [
        { cost: 3, quantity: 1 },
        { cost: 26, quantity: 2 }
      ]);
      const first = await pack.issue(inputs[0]!);
      const second = await pack.issue(inputs[1]!);
      // Correct the first carton before Log. The return restores its $13
      // issue cost even though the current master cost is $10.
      const drawnCarton = await carton.fit(1, first);
      expect(await pack.wip()).toBe(53);
      await expect(carton.returnToStock(drawnCarton, second)).rejects.toThrow(
        "fitted to this sales unit"
      );
      await carton.returnToStock(drawnCarton, first);
      expect(await pack.wip()).toBe(40);
      const firstCarton = await carton.fit(0, first);
      await carton.fit(1, second);
      const remainingCartons = await f.db
        .selectFrom("costLedger")
        .select(["trackedEntityId", "cost", "remainingQuantity"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", f.partId)
        .where("remainingQuantity", ">", 0)
        .execute();
      expect(remainingCartons).toEqual([
        { trackedEntityId: drawnCarton, cost: 13, remainingQuantity: 1 }
      ]);
      await pack.log(first);
      await expect(carton.returnToStock(firstCarton, first)).rejects.toThrow(
        "logged complete"
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "joint receipt carries each fitted carton into its serial's FIFO layer and posted COGS",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stampCutover(f);
      const inputs = [rich, cheap].map((source) => ({ ...source, cost: 20 }));
      const pack = await pricedPackout(f, 2, inputs, false);
      const carton = await trackedCartons(f, pack, [
        { cost: 3, quantity: 1 },
        { cost: 13, quantity: 1 }
      ]);
      const first = await pack.issue(inputs[0]!);
      const second = await pack.issue(inputs[1]!);
      await carton.fit(0, first);
      await carton.fit(1, second);
      await pack.log(first);
      await pack.log(second);
      await pack.receive(2, [rich.serial, cheap.serial]);
      const firstLayer = {
        trackedEntityId: first,
        remainingQuantity: 1,
        cost: 23
      };
      const secondLayer = {
        trackedEntityId: second,
        remainingQuantity: 1,
        cost: 33
      };
      expect(await pack.layerCosts()).toEqual([firstLayer, secondLayer]);
      expect(await pack.wip()).toBe(0);
      const { shipmentId } = await shipPackedUnit(
        f,
        pack.job.salesItemId,
        second
      );
      const journal = await f.db
        .selectFrom("journalLine as line")
        .innerJoin("journal", "journal.id", "line.journalId")
        .select(["journal.status", "line.amount"])
        .where("line.companyId", "=", f.companyId)
        .where("line.documentId", "=", shipmentId)
        .where("line.accountId", "=", f.account("cogs"))
        .execute();
      expect(journal).toEqual([{ status: "Posted", amount: 33 }]);
      expect(await pack.layerCosts()).toEqual([
        firstLayer,
        { ...secondLayer, remainingQuantity: 0 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

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
          await pack.receive(1, [rich.serial]);
          await pack.receive(1, [rich.serial]);
          expect(await pack.layerCosts()).toEqual([firstLayer]);
          expect(await pack.wip()).toBe(12);
          expect(await pack.cartonIssues()).toEqual([{ quantity: -1 }]);
        }
        await pack.log(second);
        await pack.receive(
          2,
          together ? [rich.serial, cheap.serial] : [cheap.serial]
        );
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
        await pack.receive(1, [rich.serial]);
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
        await pack.receive(2, [cheap.serial]);
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
      await pack.receive(1, [rich.serial]);
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

for (const voidFirstSale of [false, true]) {
  databaseTest(
    voidFirstSale
      ? "Average blends a voided sale's booked value with intervening receipts"
      : "Average includes the quantity of a free packed receipt",
    async () => {
      const f = await alwaysPostFixture();
      try {
        await stampCutover(f);
        const a = { ...rich, cost: 40 };
        const b = { ...cheap, cost: voidFirstSale ? 22 : 0 };
        const pack = await pricedPackout(f, 2, [a, b], false);
        const itemId = pack.job.salesItemId;
        await f.db
          .updateTable("itemCost")
          .set({ costingMethod: "Average" })
          .where("companyId", "=", f.companyId)
          .where("itemId", "=", itemId)
          .execute();
        const valuation = async () => {
          const result = await sql`
            SELECT "quantityOnHand", "unitCost", "totalValue"
            FROM get_inventory_valuation(${f.companyId}) WHERE "itemId" = ${itemId}
          `.execute(f.db);
          return result.rows;
        };
        const posted = (shipmentId: string) =>
          f.db
            .selectFrom("journalLine as l")
            .innerJoin("journal as j", "j.id", "l.journalId")
            .select(["l.amount", "j.status"])
            .where("l.companyId", "=", f.companyId)
            .where("l.documentType", "=", "Sales Shipment")
            .where("l.documentId", "=", shipmentId)
            .where("l.accountId", "=", f.account("cogs"))
            .orderBy("l.amount")
            .execute();
        const first = await pack.issue(a);
        await pack.log(first);
        await pack.receive(1, [a.serial]);
        expect(await valuation()).toEqual([
          { quantityOnHand: 1, unitCost: 40, totalValue: 40 }
        ]);
        const initial = voidFirstSale
          ? await shipPackedUnit(f, itemId, first)
          : null;
        if (initial)
          expect(await posted(initial.shipmentId)).toEqual([
            { amount: 40, status: "Posted" }
          ]);
        const second = await pack.issue(b);
        await pack.log(second); // Terminal MES Finish receives this piece.
        expect(await pack.wip()).toBe(0);
        if (initial) {
          expect(await valuation()).toEqual([
            { quantityOnHand: 1, unitCost: 22, totalValue: 22 }
          ]);
          unwrap(
            await invokePosting(
              handlesOf(f.ctx),
              "post-shipment",
              { type: "void", shipmentId: initial.shipmentId },
              postShipment
            )
          );
          expect(await posted(initial.shipmentId)).toEqual([
            { amount: -40, status: "Posted" },
            { amount: 40, status: "Posted" }
          ]);
        }
        const expectedAverage = (a.cost + b.cost) / 2;
        expect.soft(await valuation()).toEqual([
          {
            quantityOnHand: 2,
            unitCost: expectedAverage,
            totalValue: a.cost + b.cost
          }
        ]);
        for (const id of [first, second]) {
          const sale = await shipPackedUnit(f, itemId, id, "-after");
          expect
            .soft(await posted(sale.shipmentId))
            .toEqual([{ amount: expectedAverage, status: "Posted" }]);
        }
        const sales = await f.db
          .selectFrom("costLedger")
          .select(["trackedEntityId", "quantity", "cost", "remainingQuantity"])
          .where("companyId", "=", f.companyId)
          .where("documentType", "=", "Sales Shipment")
          .where("itemId", "=", itemId)
          .orderBy("entryNumber")
          .execute();
        expect(sales).toEqual([
          ...(initial
            ? [
                {
                  trackedEntityId: first,
                  quantity: -1,
                  cost: -40,
                  remainingQuantity: 0
                },
                {
                  trackedEntityId: first,
                  quantity: 1,
                  cost: 40,
                  remainingQuantity: 0
                }
              ]
            : []),
          ...[first, second].map((trackedEntityId) => ({
            trackedEntityId,
            quantity: -1,
            cost: -expectedAverage,
            remainingQuantity: 0
          }))
        ]);
        expect(await pack.layerCosts()).toEqual([
          { trackedEntityId: first, cost: a.cost, remainingQuantity: 1 },
          { trackedEntityId: second, cost: b.cost, remainingQuantity: 1 }
        ]);
        expect(await valuation()).toEqual([]);
        // Only the receipts and sales concern the sales SKU. The source
        // material also hits Finished Goods when it is issued to this job.
        const finishedGoods = await f.db
          .selectFrom("journalLine as l")
          .innerJoin("journal as j", "j.id", "l.journalId")
          .select((eb) => eb.fn.sum<number>("l.amount").as("balance"))
          .where("l.companyId", "=", f.companyId)
          .where("l.accountId", "=", f.account("finished-goods"))
          .where("l.documentType", "in", ["Sales Shipment", "Job Receipt"])
          .where("j.status", "=", "Posted")
          .executeTakeFirstOrThrow();
        expect.soft(finishedGoods.balance).toBe(0);
      } finally {
        await f.cleanup();
      }
    }
  );
}
