import type { LoadCtx } from "./context";
import { lookupKey } from "./context";

/**
 * Tier 4 — open sales and purchase orders.
 *
 * Both carry their NetSuite transaction number as Carbon's document number, so
 * the number a customer service rep or a buyer already knows still finds the
 * order. `advanceDocumentSequences` then pushes Carbon's own numbering past the
 * highest migrated number, which is what stops the next order created in Carbon
 * from colliding with a migrated one.
 */

function resolveCurrency(ctx: LoadCtx, code: string | null): string {
  if (code && ctx.config.currencyByCode.has(lookupKey(code))) return code;
  return ctx.config.baseCurrencyCode;
}

export async function loadSalesOrders(ctx: LoadCtx): Promise<void> {
  for (const order of ctx.plan.salesOrders) {
    if (ctx.ids.has("salesOrder", order.externalId)) {
      ctx.counts.salesOrders.skipped += 1;
      continue;
    }

    const customerId = ctx.ids.get("customer", order.customerExternalId);
    if (!customerId) {
      ctx.counts.salesOrders.skipped += 1;
      ctx.warn(
        `Sales order ${order.salesOrderId} was skipped: its customer was not migrated`
      );
      continue;
    }

    if (ctx.config.salesOrderIds.has(lookupKey(order.salesOrderId))) {
      ctx.counts.salesOrders.skipped += 1;
      ctx.warn(
        `Sales order ${order.salesOrderId} was skipped: Carbon already has an order with that number`
      );
      continue;
    }

    const locationId =
      (order.locationExternalId
        ? ctx.ids.get("location", order.locationExternalId)
        : undefined) ?? ctx.config.defaultLocationId;

    const inserted = await ctx.trx
      .insertInto("salesOrder")
      .values({
        salesOrderId: order.salesOrderId,
        customerId,
        customerReference: order.customerReference,
        currencyCode: resolveCurrency(ctx, order.currencyCode),
        exchangeRate: order.exchangeRate,
        orderDate: order.orderDate,
        locationId,
        // Every migrated order lands Confirmed: it is a commitment the customer
        // already made in NetSuite, and importing it as a Draft would hide it
        // from planning and from the shop floor.
        status: "Confirmed",
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.ids.set("salesOrder", order.externalId, inserted.id);
    ctx.config.salesOrderIds.add(lookupKey(order.salesOrderId));
    ctx.counts.salesOrders.inserted += 1;

    // Unlike customer/supplier, a sales order has no interceptor — its payment
    // and shipment rows are ours to insert, keyed by the order's own id.
    await ctx.trx
      .insertInto("salesOrderPayment")
      .values({
        id: inserted.id,
        paymentTermId: order.paymentTermName
          ? (ctx.config.paymentTermByName.get(
              lookupKey(order.paymentTermName)
            ) ?? null)
          : null,
        companyId: ctx.companyId
      })
      .execute();

    await ctx.trx
      .insertInto("salesOrderShipment")
      .values({
        id: inserted.id,
        locationId,
        customerId,
        shippingMethodId: order.shippingMethodName
          ? (ctx.config.shippingMethodByName.get(
              lookupKey(order.shippingMethodName)
            ) ?? null)
          : null,
        companyId: ctx.companyId
      })
      .execute();

    let sortOrder = 1;
    for (const line of order.lines) {
      const itemId = line.itemExternalId
        ? ctx.ids.get("item", line.itemExternalId)
        : undefined;

      if (!itemId && !line.isComment) {
        ctx.warn(
          `A line on sales order ${order.salesOrderId} became a comment: its item was not migrated`
        );
      }

      const lineRow = await ctx.trx
        .insertInto("salesOrderLine")
        .values({
          salesOrderId: inserted.id,
          salesOrderLineType: itemId ? "Part" : "Comment",
          itemId: itemId ?? null,
          description: line.description,
          // The REMAINING quantity is what Carbon has to ship. Importing the
          // original quantity would re-promise what NetSuite already shipped.
          saleQuantity: Math.max(line.quantity - line.quantityShipped, 0),
          unitPrice: line.unitPrice,
          unitOfMeasureCode: line.unitOfMeasureCode,
          locationId,
          methodType: "Pull from Inventory",
          promisedDate: line.promisedDate,
          taxPercent: line.taxPercent,
          sortOrder,
          companyId: ctx.companyId,
          createdBy: ctx.userId,
          createdAt: ctx.now
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      ctx.ids.set("salesOrderLine", line.externalId, lineRow.id);
      sortOrder += 1;
    }
  }
}

export async function loadPurchaseOrders(ctx: LoadCtx): Promise<void> {
  for (const order of ctx.plan.purchaseOrders) {
    if (ctx.ids.has("purchaseOrder", order.externalId)) {
      ctx.counts.purchaseOrders.skipped += 1;
      continue;
    }

    const supplierId = ctx.ids.get("supplier", order.supplierExternalId);
    if (!supplierId) {
      ctx.counts.purchaseOrders.skipped += 1;
      ctx.warn(
        `Purchase order ${order.purchaseOrderId} was skipped: its supplier was not migrated`
      );
      continue;
    }

    if (ctx.config.purchaseOrderIds.has(lookupKey(order.purchaseOrderId))) {
      ctx.counts.purchaseOrders.skipped += 1;
      ctx.warn(
        `Purchase order ${order.purchaseOrderId} was skipped: Carbon already has an order with that number`
      );
      continue;
    }

    const locationId =
      (order.locationExternalId
        ? ctx.ids.get("location", order.locationExternalId)
        : undefined) ?? ctx.config.defaultLocationId;

    // `purchaseOrder.supplierInteractionId` is NOT NULL with no default — every
    // purchase order belongs to an interaction, so one is created per order.
    const interaction = await ctx.trx
      .insertInto("supplierInteraction")
      .values({ supplierId, companyId: ctx.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();

    const inserted = await ctx.trx
      .insertInto("purchaseOrder")
      .values({
        purchaseOrderId: order.purchaseOrderId,
        supplierId,
        supplierInteractionId: interaction.id,
        supplierReference: order.supplierReference,
        currencyCode: resolveCurrency(ctx, order.currencyCode),
        exchangeRate: order.exchangeRate,
        orderDate: order.orderDate,
        purchaseOrderType: "Purchase",
        status: "To Receive and Invoice",
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.ids.set("purchaseOrder", order.externalId, inserted.id);
    ctx.config.purchaseOrderIds.add(lookupKey(order.purchaseOrderId));
    ctx.counts.purchaseOrders.inserted += 1;

    await ctx.trx
      .insertInto("purchaseOrderDelivery")
      .values({
        id: inserted.id,
        locationId,
        shippingMethodId: order.shippingMethodName
          ? (ctx.config.shippingMethodByName.get(
              lookupKey(order.shippingMethodName)
            ) ?? null)
          : null,
        companyId: ctx.companyId
      })
      .execute();

    await ctx.trx
      .insertInto("purchaseOrderPayment")
      .values({
        id: inserted.id,
        paymentTermId: order.paymentTermName
          ? (ctx.config.paymentTermByName.get(
              lookupKey(order.paymentTermName)
            ) ?? null)
          : null,
        companyId: ctx.companyId
      })
      .execute();

    for (const line of order.lines) {
      const itemId = line.itemExternalId
        ? ctx.ids.get("item", line.itemExternalId)
        : undefined;

      if (!itemId && !line.isComment) {
        ctx.warn(
          `A line on purchase order ${order.purchaseOrderId} became a comment: its item was not migrated`
        );
      }

      const unitCode = line.unitOfMeasureCode ?? "EA";
      const lineRow = await ctx.trx
        .insertInto("purchaseOrderLine")
        .values({
          purchaseOrderId: inserted.id,
          purchaseOrderLineType: itemId ? "Part" : "Comment",
          itemId: itemId ?? null,
          description: line.description,
          purchaseQuantity: Math.max(line.quantity - line.quantityReceived, 0),
          supplierUnitPrice: line.unitPrice,
          purchaseUnitOfMeasureCode: unitCode,
          inventoryUnitOfMeasureCode: unitCode,
          locationId,
          companyId: ctx.companyId,
          createdBy: ctx.userId,
          createdAt: ctx.now
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      ctx.ids.set("purchaseOrderLine", line.externalId, lineRow.id);
    }
  }
}

/** The trailing digits of a document number, e.g. `SO-001234` → 1234. */
export function numericSuffix(documentNumber: string): number | null {
  const match = /(\d+)\s*$/.exec(documentNumber.trim());
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Push Carbon's own document numbering past the highest migrated number.
 *
 * Without this the first sales order created after a migration reuses a number
 * a migrated order already has, and the insert fails on
 * `salesOrder_salesOrderId_key` — with a unique-violation error the user cannot
 * act on. The sequence only ever moves FORWARD: a migration must not rewind
 * numbering the company already used.
 */
export async function advanceDocumentSequences(ctx: LoadCtx): Promise<void> {
  const targets: {
    table: "salesOrder" | "purchaseOrder";
    numbers: string[];
  }[] = [
    {
      table: "salesOrder",
      numbers: ctx.plan.salesOrders.map((order) => order.salesOrderId)
    },
    {
      table: "purchaseOrder",
      numbers: ctx.plan.purchaseOrders.map((order) => order.purchaseOrderId)
    }
  ];

  for (const target of targets) {
    if (target.numbers.length === 0) continue;

    let highest = 0;
    let unparsed = 0;
    for (const number of target.numbers) {
      const suffix = numericSuffix(number);
      if (suffix === null) {
        unparsed += 1;
        continue;
      }
      if (suffix > highest) highest = suffix;
    }

    if (unparsed > 0) {
      ctx.warn(
        `${unparsed} migrated ${target.table} numbers had no numeric part, so they could not advance Carbon's numbering — check Settings → Sequences`
      );
    }
    if (highest === 0) continue;

    const sequence = await ctx.trx
      .selectFrom("sequence")
      .select(["next"])
      .where("table", "=", target.table)
      .where("companyId", "=", ctx.companyId)
      .executeTakeFirst();

    if (!sequence) continue;
    if (sequence.next > highest) continue;

    await ctx.trx
      .updateTable("sequence")
      .set({ next: highest + 1, updatedAt: ctx.now, updatedBy: ctx.userId })
      .where("table", "=", target.table)
      .where("companyId", "=", ctx.companyId)
      .execute();

    ctx.log(`Advanced the ${target.table} number sequence to ${highest + 1}`);
  }
}
