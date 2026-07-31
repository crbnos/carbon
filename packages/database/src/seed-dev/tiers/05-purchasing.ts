import { insertId, insertRow, nextSequence } from "../sql.ts";
import type { Ctx } from "../types.ts";

export async function runTier5(ctx: Ctx): Promise<void> {
  const { companyId, locationId } = ctx;
  const plantId = ctx.refs.locations.Plant ?? locationId;
  const shippingMethodId = ctx.refs.shippingMethods["UPS Ground"];
  const paymentTermId = ctx.refs.misc.paymentTermId;

  const suppProp = ctx.refs.suppliers["PropTech Solutions"];
  const suppFasten = ctx.refs.suppliers["SpaceGrade Fasteners"];
  const suppCelex = ctx.refs.suppliers.CelestialElex;

  const batItem = ctx.refs.items["BAT-LIION-48V"]!;
  const rwItem = ctx.refs.items["RW-010"]!;
  const fstItem = ctx.refs.items["FST-M4-TI"]!;
  const pcbItem = ctx.refs.items["PCB-BARE-REV3"]!;

  // ── PO 1: PropTech — To Receive (batteries + reaction wheels) ──────────────
  ctx.log("purchase order 1 — To Receive (PropTech)");
  const si1 = await insertId(ctx, "supplierInteraction", {
    supplierId: suppProp
  });
  const po1Id = await nextSequence(ctx, "purchaseOrder");
  const po1 = await insertId(ctx, "purchaseOrder", {
    purchaseOrderId: po1Id,
    purchaseOrderType: "Purchase",
    status: "To Receive",
    supplierId: suppProp,
    supplierInteractionId: si1,
    orderDate: "2025-09-01"
  });
  await insertRow(ctx, "purchaseOrderDelivery", {
    id: po1,
    locationId: plantId,
    shippingMethodId,
    companyId
  });
  await insertRow(ctx, "purchaseOrderPayment", {
    id: po1,
    paymentTermId,
    companyId
  });
  const pol1 = await insertId(ctx, "purchaseOrderLine", {
    purchaseOrderId: po1,
    purchaseOrderLineType: "Part",
    itemId: batItem.id,
    description: batItem.name,
    purchaseQuantity: 6,
    supplierUnitPrice: 2200,
    inventoryUnitOfMeasureCode: "EA",
    purchaseUnitOfMeasureCode: "EA",
    locationId: plantId
  });
  await insertId(ctx, "purchaseOrderLine", {
    purchaseOrderId: po1,
    purchaseOrderLineType: "Part",
    itemId: rwItem.id,
    description: rwItem.name,
    purchaseQuantity: 4,
    supplierUnitPrice: 14200,
    inventoryUnitOfMeasureCode: "EA",
    purchaseUnitOfMeasureCode: "EA",
    locationId: plantId
  });

  // Receipt (Draft) for PO 1
  const rec1Id = await nextSequence(ctx, "receipt");
  const rec1 = await insertId(ctx, "receipt", {
    receiptId: rec1Id,
    status: "Draft",
    locationId: plantId,
    sourceDocument: "Purchase Order",
    sourceDocumentId: po1,
    sourceDocumentReadableId: po1Id,
    supplierId: suppProp
  });
  await insertId(ctx, "receiptLine", {
    receiptId: rec1,
    lineId: pol1,
    itemId: batItem.id,
    orderQuantity: 6,
    outstandingQuantity: 6,
    receivedQuantity: 0,
    locationId: plantId,
    unitOfMeasure: "EA",
    unitPrice: 2200
  });
  ctx.refs.documents["receipt:rocket"] = rec1;

  // ── PO 2: SpaceGrade Fasteners — To Invoice (fasteners already received) ─
  ctx.log("purchase order 2 — To Invoice (SpaceGrade)");
  const si2 = await insertId(ctx, "supplierInteraction", {
    supplierId: suppFasten
  });
  const po2Id = await nextSequence(ctx, "purchaseOrder");
  const po2 = await insertId(ctx, "purchaseOrder", {
    purchaseOrderId: po2Id,
    purchaseOrderType: "Purchase",
    status: "To Invoice",
    supplierId: suppFasten,
    supplierInteractionId: si2,
    orderDate: "2025-08-15"
  });
  await insertRow(ctx, "purchaseOrderDelivery", {
    id: po2,
    locationId: plantId,
    shippingMethodId,
    companyId
  });
  await insertRow(ctx, "purchaseOrderPayment", {
    id: po2,
    paymentTermId,
    companyId
  });
  await insertId(ctx, "purchaseOrderLine", {
    purchaseOrderId: po2,
    purchaseOrderLineType: "Part",
    itemId: fstItem.id,
    description: fstItem.name,
    purchaseQuantity: 500,
    supplierUnitPrice: 2.5,
    inventoryUnitOfMeasureCode: "EA",
    purchaseUnitOfMeasureCode: "EA",
    locationId: plantId
  });

  // Purchase invoice (Draft) for PO 2
  const inv2Id = await nextSequence(ctx, "purchaseInvoice");
  const inv2 = await insertId(ctx, "purchaseInvoice", {
    invoiceId: inv2Id,
    status: "Draft",
    supplierId: suppFasten,
    supplierInteractionId: si2,
    currencyCode: "USD",
    paymentTermId,
    subtotal: 1250,
    totalAmount: 1250,
    dateIssued: "2025-09-01"
  });
  await insertRow(ctx, "purchaseInvoiceDelivery", {
    id: inv2,
    locationId: plantId,
    shippingMethodId,
    companyId
  });
  await insertId(ctx, "purchaseInvoiceLine", {
    invoiceId: inv2,
    invoiceLineType: "Part",
    purchaseOrderId: po2,
    itemId: fstItem.id,
    description: fstItem.name,
    quantity: 500,
    supplierUnitPrice: 2.5,
    inventoryUnitOfMeasureCode: "EA",
    purchaseUnitOfMeasureCode: "EA"
  });
  ctx.refs.documents["pinvoice:fasten"] = inv2;

  // ── PO 3: CelestialElex — Draft (PCBs, not yet sent) ────────────────────
  ctx.log("purchase order 3 — Draft (CelestialElex)");
  const si3 = await insertId(ctx, "supplierInteraction", {
    supplierId: suppCelex
  });
  const po3Id = await nextSequence(ctx, "purchaseOrder");
  const po3 = await insertId(ctx, "purchaseOrder", {
    purchaseOrderId: po3Id,
    purchaseOrderType: "Purchase",
    status: "Draft",
    supplierId: suppCelex,
    supplierInteractionId: si3,
    orderDate: "2025-10-01"
  });
  await insertRow(ctx, "purchaseOrderDelivery", {
    id: po3,
    locationId: plantId,
    shippingMethodId,
    companyId
  });
  await insertRow(ctx, "purchaseOrderPayment", {
    id: po3,
    paymentTermId,
    companyId
  });
  await insertId(ctx, "purchaseOrderLine", {
    purchaseOrderId: po3,
    purchaseOrderLineType: "Part",
    itemId: pcbItem.id,
    description: pcbItem.name,
    purchaseQuantity: 20,
    supplierUnitPrice: 90,
    inventoryUnitOfMeasureCode: "EA",
    purchaseUnitOfMeasureCode: "EA",
    locationId: plantId
  });
  ctx.refs.documents["po:celex"] = po3;
}
