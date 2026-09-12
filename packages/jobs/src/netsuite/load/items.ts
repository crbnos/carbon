import type { PlanItem } from "@carbon/netsuite";

import type { LoadCtx } from "./context";
import { lookupKey } from "./context";

/**
 * Tier 3 — items, supplier parts, bills of material and opening stock.
 *
 * The central fact about `item`: inserting one fires interceptors that create
 * its `itemCost`, `itemReplenishment`, `itemUnitSalePrice` and one `itemPlanning`
 * row per location, and — for Part and Tool only — a Draft `makeMethod`. So cost,
 * price and lead time are applied with UPDATEs. Inserting them instead produces a
 * duplicate that fans out through every view built on those tables, which is the
 * bug the dataset seeder's `assertSingle` guard exists to catch.
 */

/** The unit code to write, falling back to the company's `EA` when NetSuite's is unknown. */
function resolveUnitOfMeasure(
  ctx: LoadCtx,
  code: string | null | undefined
): string {
  if (code && ctx.config.unitOfMeasureByCode.has(lookupKey(code))) return code;
  return "EA";
}

/**
 * The item's type-specific extension row (`part`, `material`, `tool`,
 * `consumable`, `service`), keyed by the item's readableId.
 *
 * Written as a switch rather than a table-name lookup so TypeScript checks each
 * insert against that table's real columns — `service` takes `serviceType` where
 * the others take `approved`, and a dynamic table name would hide that.
 */
async function insertExtensionRow(ctx: LoadCtx, item: PlanItem): Promise<void> {
  // The extension row is keyed by the item's readableId and is SHARED by every
  // revision of that item, so a second revision must not try to insert it again.
  const values = {
    id: item.readableId,
    approved: true,
    companyId: ctx.companyId,
    createdBy: ctx.userId,
    createdAt: ctx.now
  };

  switch (item.type) {
    case "Part":
      await ctx.trx
        .insertInto("part")
        .values(values)
        .onConflict((oc) => oc.doNothing())
        .execute();
      return;
    case "Material":
      await ctx.trx
        .insertInto("material")
        .values(values)
        .onConflict((oc) => oc.doNothing())
        .execute();
      return;
    case "Tool":
      await ctx.trx
        .insertInto("tool")
        .values(values)
        .onConflict((oc) => oc.doNothing())
        .execute();
      return;
    case "Consumable":
      await ctx.trx
        .insertInto("consumable")
        .values(values)
        .onConflict((oc) => oc.doNothing())
        .execute();
      return;
    case "Service":
      await ctx.trx
        .insertInto("service")
        // A service is never stocked, and its type row carries the legacy
        // `serviceType` instead of `approved` — mirroring `upsertService`.
        .values({ ...values, approved: undefined, serviceType: "External" })
        .onConflict((oc) => oc.doNothing())
        .execute();
      return;
    case "Fixture":
      // `Fixture` was dropped from the app's item-type enum and has no list
      // screen, so the mapper never produces one. Guarded rather than silently
      // written to a table nothing surfaces.
      ctx.warn(
        `Item "${item.readableId}" was typed Fixture, which Carbon no longer surfaces`
      );
      return;
  }
}

export async function loadItems(ctx: LoadCtx): Promise<void> {
  for (const item of ctx.plan.items) {
    const unitOfMeasureCode = resolveUnitOfMeasure(ctx, item.unitOfMeasureCode);
    if (unitOfMeasureCode !== item.unitOfMeasureCode) {
      ctx.warn(
        `Item "${item.readableId}" used unit "${item.unitOfMeasureCode}", which this company does not have — it was set to EA`
      );
    }

    const values = {
      name: item.name,
      description: item.description,
      type: item.type,
      itemTrackingType: item.itemTrackingType,
      replenishmentSystem: item.replenishmentSystem,
      defaultMethodType: item.defaultMethodType,
      unitOfMeasureCode,
      mpn: item.mpn,
      active: item.active
    };

    const existingId = ctx.ids.get("item", item.externalId);
    let itemId: string;

    if (existingId) {
      await ctx.trx
        .updateTable("item")
        .set({ ...values, updatedAt: ctx.now, updatedBy: ctx.userId })
        .where("id", "=", existingId)
        .where("companyId", "=", ctx.companyId)
        .execute();
      itemId = existingId;
      ctx.counts.items.updated += 1;
    } else {
      const inserted = await ctx.trx
        .insertInto("item")
        .values({
          ...values,
          readableId: item.readableId,
          revision: item.revision,
          companyId: ctx.companyId,
          createdBy: ctx.userId,
          createdAt: ctx.now
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      itemId = inserted.id;
      ctx.ids.set("item", item.externalId, itemId);
      ctx.counts.items.inserted += 1;

      await insertExtensionRow(ctx, item);
    }

    // Interceptor-created rows: update in place.
    if (item.standardCost !== null || item.unitCost !== null) {
      await ctx.trx
        .updateTable("itemCost")
        .set({
          ...(item.standardCost !== null
            ? { standardCost: item.standardCost }
            : {}),
          ...(item.unitCost !== null ? { unitCost: item.unitCost } : {}),
          updatedAt: ctx.now,
          updatedBy: ctx.userId
        })
        .where("itemId", "=", itemId)
        .where("companyId", "=", ctx.companyId)
        .execute();
    }

    if (item.unitSalePrice !== null) {
      await ctx.trx
        .updateTable("itemUnitSalePrice")
        .set({
          unitSalePrice: item.unitSalePrice,
          ...(item.salesUnitOfMeasureCode
            ? {
                salesUnitOfMeasureCode: resolveUnitOfMeasure(
                  ctx,
                  item.salesUnitOfMeasureCode
                )
              }
            : {}),
          updatedAt: ctx.now,
          updatedBy: ctx.userId
        })
        .where("itemId", "=", itemId)
        .where("companyId", "=", ctx.companyId)
        .execute();
    }

    if (item.leadTime !== null || item.purchasingUnitOfMeasureCode) {
      await ctx.trx
        .updateTable("itemReplenishment")
        .set({
          ...(item.leadTime !== null ? { leadTime: item.leadTime } : {}),
          ...(item.purchasingUnitOfMeasureCode
            ? {
                purchasingUnitOfMeasureCode: resolveUnitOfMeasure(
                  ctx,
                  item.purchasingUnitOfMeasureCode
                )
              }
            : {}),
          updatedAt: ctx.now,
          updatedBy: ctx.userId
        })
        .where("itemId", "=", itemId)
        .where("companyId", "=", ctx.companyId)
        .execute();
    }
  }
}

export async function loadSupplierParts(ctx: LoadCtx): Promise<void> {
  for (const link of ctx.plan.supplierParts) {
    const itemId = ctx.ids.get("item", link.itemExternalId);
    const supplierId = ctx.ids.get("supplier", link.supplierExternalId);

    if (!itemId || !supplierId) {
      ctx.counts.supplierParts.skipped += 1;
      ctx.warn(
        `Skipped a supplier part: ${!itemId ? "its item" : "its supplier"} was not migrated`
      );
      continue;
    }

    if (ctx.ids.has("supplierPart", link.externalId)) {
      ctx.counts.supplierParts.skipped += 1;
      continue;
    }

    const inserted = await ctx.trx
      .insertInto("supplierPart")
      .values({
        itemId,
        supplierId,
        supplierPartId: link.supplierPartId,
        unitPrice: link.unitPrice,
        conversionFactor: link.conversionFactor,
        minimumOrderQuantity: link.minimumOrderQuantity,
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.ids.set("supplierPart", link.externalId, inserted.id);
    ctx.counts.supplierParts.inserted += 1;

    if (link.unitPrice !== null) {
      await ctx.trx
        .insertInto("supplierPartPrice")
        .values({
          supplierPartId: inserted.id,
          quantity: 1,
          unitPrice: link.unitPrice,
          companyId: ctx.companyId,
          createdBy: ctx.userId,
          createdAt: ctx.now
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  }
}

/**
 * Bills of material land on the Draft `makeMethod` the item interceptor created.
 *
 * A method that ALREADY has lines is left alone rather than replaced: after the
 * first run those lines are the customer's, and a re-run that silently discarded
 * their edits would be the worst kind of "idempotent".
 */
export async function loadBillsOfMaterial(ctx: LoadCtx): Promise<void> {
  for (const bom of ctx.plan.billsOfMaterial) {
    const parentItemId = ctx.ids.get("item", bom.parentItemExternalId);
    if (!parentItemId) {
      ctx.counts.billsOfMaterial.skipped += 1;
      ctx.warn("Skipped a bill of material: its parent item was not migrated");
      continue;
    }

    const makeMethod = await ctx.trx
      .selectFrom("makeMethod")
      .select(["id"])
      .where("itemId", "=", parentItemId)
      .where("companyId", "=", ctx.companyId)
      .orderBy("version")
      .limit(1)
      .executeTakeFirst();

    if (!makeMethod) {
      ctx.counts.billsOfMaterial.skipped += 1;
      ctx.warn(
        `Skipped a bill of material: Carbon creates a method only for Part and Tool items, and this parent is neither`
      );
      continue;
    }

    ctx.ids.set("makeMethod", bom.externalId, makeMethod.id);

    const existingLine = await ctx.trx
      .selectFrom("methodMaterial")
      .select(["id"])
      .where("makeMethodId", "=", makeMethod.id)
      .where("companyId", "=", ctx.companyId)
      .limit(1)
      .executeTakeFirst();

    if (existingLine) {
      ctx.counts.billsOfMaterial.skipped += 1;
      continue;
    }

    let wrote = 0;
    for (const line of bom.lines) {
      const componentItemId = ctx.ids.get("item", line.componentItemExternalId);
      if (!componentItemId) {
        ctx.warn(
          "A bill-of-material line was dropped: its component item was not migrated"
        );
        continue;
      }

      const component = await ctx.trx
        .selectFrom("item")
        .select(["type", "unitOfMeasureCode", "replenishmentSystem"])
        .where("id", "=", componentItemId)
        .where("companyId", "=", ctx.companyId)
        .executeTakeFirst();
      if (!component) continue;

      const isMake = component.replenishmentSystem === "Make";
      // A Make component is a SUBASSEMBLY: without its own method id the BOM
      // renders as one flat level and the Subassembly control never appears.
      const componentMakeMethod = isMake
        ? await ctx.trx
            .selectFrom("makeMethod")
            .select(["id"])
            .where("itemId", "=", componentItemId)
            .where("companyId", "=", ctx.companyId)
            .orderBy("version")
            .limit(1)
            .executeTakeFirst()
        : undefined;

      await ctx.trx
        .insertInto("methodMaterial")
        .values({
          makeMethodId: makeMethod.id,
          itemId: componentItemId,
          itemType: component.type,
          unitOfMeasureCode: component.unitOfMeasureCode ?? "EA",
          methodType: isMake ? "Make to Order" : "Pull from Inventory",
          materialMakeMethodId: componentMakeMethod?.id ?? null,
          quantity: line.quantity,
          order: line.order,
          companyId: ctx.companyId,
          createdBy: ctx.userId,
          createdAt: ctx.now
        })
        .execute();
      wrote += 1;
    }

    if (wrote > 0) ctx.counts.billsOfMaterial.inserted += 1;
    else ctx.counts.billsOfMaterial.skipped += 1;
  }
}

/**
 * Opening stock posts one `itemLedger` positive adjustment per item and location.
 *
 * `itemLedger` has no natural key, so a re-run would double the customer's
 * inventory — the single most damaging thing this migration could do. The guard
 * is `externalDocumentId`: each opening entry carries a deterministic marker and
 * a re-run skips any marker it already sees.
 */
export async function loadOpeningStock(ctx: LoadCtx): Promise<void> {
  if (ctx.plan.openingStock.length === 0) return;

  const markerFor = (
    itemExternalId: string,
    locationExternalId: string | null
  ) => `netsuite:opening:${itemExternalId}:${locationExternalId ?? "default"}`;

  const existingMarkers = new Set(
    (
      await ctx.trx
        .selectFrom("itemLedger")
        .select(["externalDocumentId"])
        .where("companyId", "=", ctx.companyId)
        .where("externalDocumentId", "like", "netsuite:opening:%")
        .execute()
    )
      .map((row) => row.externalDocumentId)
      .filter((value): value is string => value !== null)
  );

  for (const stock of ctx.plan.openingStock) {
    const itemId = ctx.ids.get("item", stock.itemExternalId);
    if (!itemId) {
      ctx.counts.openingStock.skipped += 1;
      continue;
    }
    if (stock.quantity <= 0) {
      ctx.counts.openingStock.skipped += 1;
      continue;
    }

    const marker = markerFor(stock.itemExternalId, stock.locationExternalId);
    if (existingMarkers.has(marker)) {
      ctx.counts.openingStock.skipped += 1;
      continue;
    }

    const locationId =
      (stock.locationExternalId
        ? ctx.ids.get("location", stock.locationExternalId)
        : undefined) ?? ctx.config.defaultLocationId;

    await ctx.trx
      .insertInto("itemLedger")
      .values({
        entryType: "Positive Adjmt.",
        documentType: "Inventory Receipt",
        itemId,
        locationId,
        quantity: stock.quantity,
        externalDocumentId: marker,
        comment: "Opening balance migrated from NetSuite",
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .execute();

    existingMarkers.add(marker);
    ctx.counts.openingStock.inserted += 1;
  }
}
