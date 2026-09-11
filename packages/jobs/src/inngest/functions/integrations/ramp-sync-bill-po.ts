import type { KyselyDatabase, KyselyTx } from "@carbon/database/client";
import type { Insertable } from "kysely";
import { getRemainingQuantityToInvoice } from "../../../../../database/supabase/functions/shared/short-close";
import type { RampBillDraft } from "./ramp-sync-bill-stage";

/** Reconcile only the Ramp-covered lines, retaining Carbon's PO lineage/UOM. */
export async function buildRampBillPurchaseOrderLines(
  tx: KyselyTx,
  args: RampBillDraft,
  existingInvoiceId?: string
) {
  const po = await tx
    .selectFrom("purchaseOrder")
    .selectAll()
    .where("id", "=", args.purchaseOrderId!)
    .where("companyId", "=", args.companyId)
    .forUpdate()
    .executeTakeFirst();
  if (
    !po ||
    po.supplierId !== args.supplierId ||
    po.currencyCode !== args.currencyCode
  ) {
    throw new Error(
      "Mapped purchase order supplier or currency does not match the Ramp bill"
    );
  }
  if (
    !["To Receive", "To Receive and Invoice", "To Invoice"].includes(po.status)
  )
    throw new Error(`Cannot invoice a ${po.status} purchase order`);
  const [sourceLines, payment, delivery] = await Promise.all([
    tx
      .selectFrom("purchaseOrderLine")
      .selectAll()
      .where("purchaseOrderId", "=", po.id)
      .where("companyId", "=", args.companyId)
      .execute(),
    tx
      .selectFrom("purchaseOrderPayment")
      .selectAll()
      .where("id", "=", po.id)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst(),
    tx
      .selectFrom("purchaseOrderDelivery")
      .selectAll()
      .where("id", "=", po.id)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst()
  ]);
  const referencedIds = args.lines.flatMap((line) =>
    line.purchaseOrderLineId ? [line.purchaseOrderLineId] : []
  );
  if (referencedIds.length) {
    // PO posting updates quantities only on commit. A second bill must not
    // reserve that same remainder while the first is still Draft/Pending.
    // Lock the PO, not its lines: the posting edge updates lines before its PO.
    let reservations = tx
      .selectFrom("purchaseInvoiceLine as line")
      .innerJoin("purchaseInvoice as invoice", (join) =>
        join
          .onRef("invoice.id", "=", "line.invoiceId")
          .onRef("invoice.companyId", "=", "line.companyId")
      )
      .select("line.id")
      .where("line.companyId", "=", args.companyId)
      .where("line.purchaseOrderLineId", "in", referencedIds)
      .where("invoice.status", "in", ["Draft", "Pending"]);
    if (existingInvoiceId)
      reservations = reservations.where("invoice.id", "!=", existingInvoiceId);
    if (await reservations.executeTakeFirst())
      throw new Error(
        "Ramp bill PO line is already reserved by an unposted invoice"
      );
  }
  const byId = new Map(sourceLines.map((line) => [line.id, line]));
  const used = new Set<string>();
  const lines: Partial<Insertable<KyselyDatabase["purchaseInvoiceLine"]>>[] =
    args.lines.map((line) => {
      if (!line.purchaseOrderLineId) return {};
      const source = byId.get(line.purchaseOrderLineId);
      if (!source || used.has(source.id))
        throw new Error("Ramp bill PO line is missing or duplicated");
      used.add(source.id);
      const remaining = getRemainingQuantityToInvoice(source);
      if (source.invoicedComplete || remaining <= 0)
        throw new Error("Ramp bill PO line has no uninvoiced quantity");
      const quantity =
        line.quantity ??
        (Number(source.supplierUnitPrice) > 0
          ? Math.min(remaining, line.amount / Number(source.supplierUnitPrice))
          : remaining);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining) {
        throw new Error(
          "Ramp bill quantity exceeds the purchase order's billable remainder"
        );
      }
      return {
        invoiceLineType: source.purchaseOrderLineType,
        purchaseOrderId: po.id,
        purchaseOrderLineId: source.id,
        itemId: source.itemId,
        locationId: source.locationId,
        storageUnitId: source.storageUnitId,
        assetId: source.assetId,
        jobOperationId: source.jobOperationId,
        purchaseUnitOfMeasureCode: source.purchaseUnitOfMeasureCode,
        inventoryUnitOfMeasureCode: source.inventoryUnitOfMeasureCode,
        conversionFactor: source.conversionFactor,
        quantity,
        supplierUnitPrice: line.amount / quantity
      };
    });
  return {
    header: {
      invoiceSupplierId: payment?.invoiceSupplierId,
      invoiceSupplierContactId: payment?.invoiceSupplierContactId,
      invoiceSupplierLocationId: payment?.invoiceSupplierLocationId,
      paymentTermId: payment?.paymentTermId,
      locationId: delivery?.locationId
    },
    delivery: {
      locationId: delivery?.locationId,
      shippingMethodId: delivery?.shippingMethodId,
      shippingTermId: delivery?.shippingTermId,
      deliveryDate: delivery?.deliveryDate,
      ...(delivery?.incoterm ? { incoterm: delivery.incoterm } : {}),
      ...(delivery?.incotermLocation
        ? { incotermLocation: delivery.incotermLocation }
        : {})
    },
    lines
  };
}
