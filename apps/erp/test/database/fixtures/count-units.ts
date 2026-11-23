// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A serial item and a batch item with units in 2 storage units at the
// always-post fixture's location, for the inventory count tests.

import { type Fixture, seed, USER } from "./always-post";

export type CountUnits = Awaited<ReturnType<typeof countUnits>>;

export async function countUnits(f: Fixture) {
  const serialItemId = `${f.prefix}-serial`;
  const batchItemId = `${f.prefix}-batch`;
  const binA = `${f.prefix}-A1`;
  const binB = `${f.prefix}-B2`;
  const entity = (key: string) => `${f.prefix}-te-${key}`;

  await seed(f, async (trx) => {
    await trx
      .insertInto("item")
      .values([
        {
          id: serialItemId,
          readableId: `${f.prefix}-SER`,
          name: "Swing arm",
          type: "Part",
          itemTrackingType: "Serial",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        },
        {
          id: batchItemId,
          readableId: `${f.prefix}-BAT`,
          name: "Resin",
          type: "Part",
          itemTrackingType: "Batch",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        }
      ])
      .execute();
    await trx
      .insertInto("itemCost")
      .values([serialItemId, batchItemId].map((itemId) => ({
        itemId,
        costingMethod: "FIFO" as const,
        unitCost: 10,
        companyId: f.companyId,
        createdBy: USER
      })))
      .onConflict((oc) => oc.doNothing())
      .execute();
    await trx
      .insertInto("storageUnit")
      .values([
        { id: binA, name: "A1", locationId: f.locationId },
        { id: binB, name: "B2", locationId: f.locationId }
      ].map((unit) => ({ ...unit, companyId: f.companyId, createdBy: USER })))
      .execute();

    const units = [
      { key: "SN-1", itemId: serialItemId, bin: binA, quantity: 1 },
      { key: "SN-2", itemId: serialItemId, bin: binA, quantity: 1 },
      { key: "SN-3", itemId: serialItemId, bin: binB, quantity: 1 },
      { key: "LOT-1", itemId: batchItemId, bin: binA, quantity: 10 }
    ];
    await trx
      .insertInto("trackedEntity")
      .values(
        units.map((unit) => ({
          id: entity(unit.key),
          readableId: `${f.prefix}-${unit.key}`,
          itemId: unit.itemId,
          quantity: unit.quantity,
          status: "Available" as const,
          sourceDocument: "Item",
          sourceDocumentId: unit.itemId,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("itemLedger")
      .values(
        units.map((unit) => ({
          postingDate: f.today,
          entryType: "Positive Adjmt." as const,
          itemId: unit.itemId,
          locationId: f.locationId,
          storageUnitId: unit.bin,
          trackedEntityId: entity(unit.key),
          quantity: unit.quantity,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });

  return {
    serialItemId,
    batchItemId,
    binA,
    binB,
    entity,
    number: (key: string) => `${f.prefix}-${key}`
  };
}

/** A Draft count of the fixture's location, with its snapshot taken. */
export async function draftCount(
  f: Fixture,
  key: string,
  generate: (args: {
    inventoryCountId: string;
    companyId: string;
    locationId: string;
    createdBy: string;
  }) => Promise<unknown>
): Promise<string> {
  const id = `${f.prefix}-count-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("inventoryCount")
      .values({
        id,
        inventoryCountId: `IC-${key}`,
        locationId: f.locationId,
        status: "Draft",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  await generate({
    inventoryCountId: id,
    companyId: f.companyId,
    locationId: f.locationId,
    createdBy: USER
  });
  return id;
}
