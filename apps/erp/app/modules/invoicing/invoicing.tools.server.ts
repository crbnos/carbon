// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The invoicing module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in invoicing.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import {
  envelope,
  paged,
  plain,
  stamp
} from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  applyCreditsToInvoices,
  createPurchaseInvoiceFromPurchaseOrder,
  createSalesInvoiceFromSalesOrder,
  createSalesInvoiceFromShipment,
  deletePayment,
  getApAging,
  getApOpenBySupplier,
  getApTieOut,
  getArAging,
  getArOpenByCustomer,
  getArTieOut,
  getAvailableCreditsForParty,
  getAvailableOnAccountCreditSources,
  getCharge,
  getCharges,
  getCompanyHasOpenCredits,
  getInvoiceSettlements,
  getInvoiceSettlementsForInvoice,
  getMemo,
  getMemoApplications,
  getMemos,
  getOpenPurchaseInvoicesForSupplier,
  getOpenReimbursementsForEmployee,
  getOpenSalesInvoicesForCustomer,
  getPayment,
  getPaymentCurrencyConfiguration,
  getPayments,
  getPurchaseInvoice,
  getPurchaseInvoiceDelivery,
  getPurchaseInvoiceLine,
  getPurchaseInvoiceLines,
  getPurchaseInvoices,
  getReimbursement,
  getReimbursementRelatedItems,
  getReimbursements,
  getSalesInvoice,
  getSalesInvoiceLine,
  getSalesInvoiceLines,
  getSalesInvoiceShipment,
  getSalesInvoices,
  getStagedCreditsForPayment,
  insertSalesInvoice,
  replaceInvoiceSettlements,
  updatePurchaseInvoice,
  updatePurchaseInvoiceExchangeRate,
  updatePurchaseInvoiceLineOrder,
  updateSalesInvoiceExchangeRate,
  updateSalesInvoiceLineOrder,
  upsertMemo,
  upsertPayment,
  upsertPurchaseInvoiceDelivery,
  upsertPurchaseInvoiceLine,
  upsertSalesInvoiceShipment
} from "./invoicing.service";

/**
 * Create purchase invoice from purchase order
 *
 * @mcp
 */
export const createPurchaseInvoiceFromPurchaseOrderTool = defineServiceFn({
  input: z.looseObject({ purchaseOrderId: z.string() }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createPurchaseInvoiceFromPurchaseOrder(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.purchaseOrderId as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Create sales invoice from sales order
 *
 * @mcp
 */
export const createSalesInvoiceFromSalesOrderTool = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createSalesInvoiceFromSalesOrder(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.salesOrderId as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Create sales invoice from shipment
 *
 * @mcp
 */
export const createSalesInvoiceFromShipmentTool = defineServiceFn({
  input: z.looseObject({ shipmentId: z.string() }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createSalesInvoiceFromShipment(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.shipmentId as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Get purchase invoice
 *
 * @mcp read
 */
export const getPurchaseInvoiceTool = defineServiceFn({
  input: z.looseObject({ purchaseInvoiceId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseInvoice(
        ctx.asCaller.supabase,
        input.purchaseInvoiceId as never
      )
    );
  }
});

/**
 * Get purchase invoices
 *
 * @mcp read
 */
export const getPurchaseInvoicesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getPurchaseInvoices(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get purchase invoice delivery
 *
 * @mcp read
 */
export const getPurchaseInvoiceDeliveryTool = defineServiceFn({
  input: z.looseObject({ purchaseInvoiceId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseInvoiceDelivery(
        ctx.asCaller.supabase,
        input.purchaseInvoiceId as never
      )
    );
  }
});

/**
 * Get purchase invoice lines
 *
 * @mcp read
 */
export const getPurchaseInvoiceLinesTool = defineServiceFn({
  input: z.looseObject({ purchaseInvoiceId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseInvoiceLines(
        ctx.asCaller.supabase,
        input.purchaseInvoiceId as never
      )
    );
  }
});

/**
 * Get purchase invoice line
 *
 * @mcp read
 */
export const getPurchaseInvoiceLineTool = defineServiceFn({
  input: z.looseObject({ purchaseInvoiceLineId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseInvoiceLine(
        ctx.asCaller.supabase,
        input.purchaseInvoiceLineId as never
      )
    );
  }
});

/**
 * Get sales invoice
 *
 * @mcp read
 */
export const getSalesInvoiceTool = defineServiceFn({
  input: z.looseObject({ salesInvoiceId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesInvoice(
        ctx.asCaller.supabase,
        input.salesInvoiceId as never
      )
    );
  }
});

/**
 * Get sales invoices
 *
 * @mcp read
 */
export const getSalesInvoicesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    customerId: z.string().nullable().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getSalesInvoices(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get sales invoice shipment
 *
 * @mcp read
 */
export const getSalesInvoiceShipmentTool = defineServiceFn({
  input: z.looseObject({ salesInvoiceId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesInvoiceShipment(
        ctx.asCaller.supabase,
        input.salesInvoiceId as never
      )
    );
  }
});

/**
 * Get sales invoice lines
 *
 * @mcp read
 */
export const getSalesInvoiceLinesTool = defineServiceFn({
  input: z.looseObject({ salesInvoiceId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesInvoiceLines(
        ctx.asCaller.supabase,
        input.salesInvoiceId as never
      )
    );
  }
});

/**
 * Get sales invoice line
 *
 * @mcp read
 */
export const getSalesInvoiceLineTool = defineServiceFn({
  input: z.looseObject({ salesInvoiceLineId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesInvoiceLine(
        ctx.asCaller.supabase,
        input.salesInvoiceLineId as never
      )
    );
  }
});

/**
 * Update purchase invoice exchange rate
 *
 * @mcp
 */
export const updatePurchaseInvoiceExchangeRateTool = defineServiceFn({
  input: z.looseObject({ id: z.string(), exchangeRate: z.number() }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updatePurchaseInvoiceExchangeRate(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update sales invoice exchange rate
 *
 * @mcp
 */
export const updateSalesInvoiceExchangeRateTool = defineServiceFn({
  input: z.looseObject({ id: z.string(), exchangeRate: z.number() }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateSalesInvoiceExchangeRate(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update purchase invoice
 *
 * @mcp
 */
export const updatePurchaseInvoiceTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    invoiceId: z.string().optional(),
    supplierId: z.string().optional(),
    supplierReference: z.string().nullable().optional(),
    paymentTermId: z.string().nullable().optional(),
    currencyCode: z.string().optional(),
    locationId: z.string().optional(),
    invoiceSupplierId: z.string().nullable().optional(),
    invoiceSupplierContactId: z.string().nullable().optional(),
    invoiceSupplierLocationId: z.string().nullable().optional(),
    dateIssued: z.string().nullable().optional(),
    dateDue: z.string().nullable().optional(),
    exchangeRate: z.number().optional(),
    exchangeRateUpdatedAt: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updatePurchaseInvoice(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Updates an invoice's delivery
 *
 * @mcp
 */
export const upsertPurchaseInvoiceDeliveryTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    locationId: z.string().optional(),
    shippingMethodId: z.string().optional(),
    shippingTermId: z.string().optional(),
    supplierShippingCost: z.number().optional(),
    incoterm: z
      .enum([
        "EXW",
        "FCA",
        "FAS",
        "FOB",
        "CPT",
        "CIP",
        "CFR",
        "CIF",
        "DAP",
        "DPU",
        "DDP"
      ])
      .optional(),
    incotermLocation: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPurchaseInvoiceDelivery(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a purchase invoice line
 *
 * @remarks
 * Upsert purchase invoice line
 *
 * @mcp
 */
export const upsertPurchaseInvoiceLineCreateTool = defineServiceFn({
  input: z.looseObject({
    invoiceId: z.string().min(1),
    invoiceLineType: z.enum([
      "Part",
      "Material",
      "Tool",
      "Consumable",
      "Service",
      "Fixture",
      "G/L Account",
      "Fixed Asset",
      "Lease",
      "Comment"
    ]),
    purchaseOrderId: z.string().optional(),
    purchaseOrderLineId: z.string().optional(),
    itemId: z.string().optional(),
    accountId: z.string().optional(),
    costCenterId: z.string().optional(),
    assetId: z.string().optional(),
    leaseId: z.string().optional(),
    leasePaymentId: z.string().optional(),
    description: z.string().optional(),
    quantity: z.number().optional(),
    purchaseUnitOfMeasureCode: z.string().optional(),
    inventoryUnitOfMeasureCode: z.string().optional(),
    conversionFactor: z.number().optional(),
    supplierUnitPrice: z.number().optional(),
    supplierShippingCost: z
      .number()
      .default(0)
      .describe(
        "Applied when creating; on update a field left out keeps its value."
      ),
    supplierTaxAmount: z
      .number()
      .default(0)
      .describe(
        "Applied when creating; on update a field left out keeps its value."
      ),
    taxPercent: z
      .number()
      .min(0)
      .max(1)
      .default(0)
      .describe(
        "Applied when creating; on update a field left out keeps its value."
      ),
    requiredDate: z.string().optional(),
    locationId: z.string().optional(),
    storageUnitId: z.string().optional(),
    exchangeRate: z.number().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPurchaseInvoiceLine(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a purchase invoice line
 *
 * @remarks
 * Upsert purchase invoice line
 *
 * @mcp
 */
export const upsertPurchaseInvoiceLineUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      invoiceId: z.string().min(1),
      invoiceLineType: z.enum([
        "Part",
        "Material",
        "Tool",
        "Consumable",
        "Service",
        "Fixture",
        "G/L Account",
        "Fixed Asset",
        "Lease",
        "Comment"
      ]),
      purchaseOrderId: z.string().optional(),
      purchaseOrderLineId: z.string().optional(),
      itemId: z.string().optional(),
      accountId: z.string().optional(),
      costCenterId: z.string().optional(),
      assetId: z.string().optional(),
      leaseId: z.string().optional(),
      leasePaymentId: z.string().optional(),
      description: z.string().optional(),
      quantity: z.number().optional(),
      purchaseUnitOfMeasureCode: z.string().optional(),
      inventoryUnitOfMeasureCode: z.string().optional(),
      conversionFactor: z.number().optional(),
      supplierUnitPrice: z.number().optional(),
      supplierShippingCost: z
        .number()
        .describe(
          "Applied when creating; on update a field left out keeps its value."
        )
        .optional(),
      supplierTaxAmount: z
        .number()
        .describe(
          "Applied when creating; on update a field left out keeps its value."
        )
        .optional(),
      taxPercent: z
        .number()
        .min(0)
        .max(1)
        .describe(
          "Applied when creating; on update a field left out keeps its value."
        )
        .optional(),
      requiredDate: z.string().optional(),
      locationId: z.string().optional(),
      storageUnitId: z.string().optional(),
      exchangeRate: z.number().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPurchaseInvoiceLine(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Update purchase invoice line order
 *
 * @mcp
 */
export const updatePurchaseInvoiceLineOrderTool = defineServiceFn({
  input: z.looseObject({
    invoiceId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updatePurchaseInvoiceLineOrder(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        input.invoiceId as never,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Insert sales invoice
 *
 * @mcp destructive
 */
export const insertSalesInvoiceTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    invoiceId: z.string().optional(),
    customerReference: z.string().optional(),
    paymentTermId: z.string().optional(),
    currencyCode: z.string().optional(),
    locationId: z.string().optional(),
    invoiceCustomerId: z.string().optional(),
    invoiceCustomerContactId: z.string().optional(),
    invoiceCustomerLocationId: z.string().optional(),
    dateIssued: z.string().optional(),
    dateDue: z.string().optional(),
    exchangeRate: z.number().optional(),
    exchangeRateUpdatedAt: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertSalesInvoice(
        ctx.asCaller.supabase,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "companyGroupId"
        ]) as never
      )
    );
  }
});

/**
 * Updates an invoice's shipment
 *
 * @mcp
 */
export const upsertSalesInvoiceShipmentTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    locationId: z.string().optional(),
    customerLocationId: z.string().optional(),
    shippingMethodId: z.string().optional(),
    shippingTermId: z.string().optional(),
    shippingCost: z.number().optional(),
    incoterm: z
      .enum([
        "EXW",
        "FCA",
        "FAS",
        "FOB",
        "CPT",
        "CIP",
        "CFR",
        "CIF",
        "DAP",
        "DPU",
        "DDP"
      ])
      .optional(),
    incotermLocation: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSalesInvoiceShipment(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update sales invoice line order
 *
 * @mcp
 */
export const updateSalesInvoiceLineOrderTool = defineServiceFn({
  input: z.looseObject({
    invoiceId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updateSalesInvoiceLineOrder(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        input.invoiceId as never,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Get payment
 *
 * @mcp read
 */
export const getPaymentTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPayment(ctx.asCaller.supabase, input.id as never, ctx.company.id)
    );
  }
});

/**
 * Get payments
 *
 * @mcp read
 */
export const getPaymentsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    paymentType: z.enum(["Receipt", "Disbursement"]).nullable().optional(),
    status: z.enum(["Draft", "Posted", "Voided"]).nullable().optional(),
    customerId: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional(),
    counterpartyIds: z.array(z.string()).nullable().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getPayments(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get charge
 *
 * @mcp read
 */
export const getChargeTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCharge(ctx.asCaller.supabase, ctx.company.id, input.id as never)
    );
  }
});

/**
 * Get charges
 *
 * @mcp read
 */
export const getChargesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    type: z
      .enum(["Charge", "Credit", "Payment", "Cashback", "Repayment"])
      .nullable()
      .optional(),
    status: z.enum(["Draft", "Posted", "Voided"]).nullable().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getCharges(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get reimbursement
 *
 * @mcp read
 */
export const getReimbursementTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getReimbursement(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.id as never
      )
    );
  }
});

/**
 * Get reimbursements
 *
 * @mcp read
 */
export const getReimbursementsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.enum(["Draft", "Posted", "Voided"]).nullable().optional(),
    employeeId: z.string().nullable().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getReimbursements(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * The payments that settle a reimbursement, for its Documents panel
 *
 * @mcp read
 */
export const getReimbursementRelatedItemsTool = defineServiceFn({
  input: z.looseObject({ reimbursementId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getReimbursementRelatedItems(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.reimbursementId as never
      )
    );
  }
});

/**
 * Get invoice settlements
 *
 * @mcp read
 */
export const getInvoiceSettlementsTool = defineServiceFn({
  input: z.looseObject({ paymentId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInvoiceSettlements(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.paymentId as never
      )
    );
  }
});

/**
 * Get invoice settlements for invoice
 *
 * @mcp read
 */
export const getInvoiceSettlementsForInvoiceTool = defineServiceFn({
  input: z.looseObject({
    side: z.enum(["sales", "purchase"]),
    invoiceId: z.string()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getInvoiceSettlementsForInvoice(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.side as never,
        input.invoiceId as never
      )
    );
  }
});

/**
 * Get memo applications
 *
 * @mcp read
 */
export const getMemoApplicationsTool = defineServiceFn({
  input: z.looseObject({ memoId: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMemoApplications(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.memoId as never
      )
    );
  }
});

/**
 * Get open sales invoices for customer
 *
 * @mcp read
 */
export const getOpenSalesInvoicesForCustomerTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    currencyCode: z.string().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getOpenSalesInvoicesForCustomer(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.customerId as never,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Get open purchase invoices for supplier
 *
 * @mcp read
 */
export const getOpenPurchaseInvoicesForSupplierTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    currencyCode: z.string().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getOpenPurchaseInvoicesForSupplier(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.supplierId as never,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Posted reimbursements an employee is still owed money on — the apply table's target list when a payment's payee is an employee, and the source of the balance t…
 *
 * @mcp read
 */
export const getOpenReimbursementsForEmployeeTool = defineServiceFn({
  input: z.looseObject({
    employeeId: z.string(),
    currencyCode: z.string().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getOpenReimbursementsForEmployee(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.employeeId as never,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Get payment currency configuration
 *
 * @mcp read
 */
export const getPaymentCurrencyConfigurationTool = defineServiceFn({
  input: z.looseObject({ currencyCode: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getPaymentCurrencyConfiguration(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Get available on account credit sources
 *
 * @mcp read
 */
export const getAvailableOnAccountCreditSourcesTool = defineServiceFn({
  input: z.looseObject({
    party: z.union([
      z.looseObject({
        paymentType: z.literal("Receipt"),
        customerId: z.string()
      }),
      z.looseObject({
        paymentType: z.literal("Disbursement"),
        supplierId: z.string()
      })
    ]),
    currencyCode: z.string()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAvailableOnAccountCreditSources(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.party, ["companyId"]) as never,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Update a payment
 *
 * @remarks
 * Upsert payment
 *
 * @mcp
 */
export const upsertPaymentUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      paymentType: z.enum(["Receipt", "Disbursement"]),
      customerId: z.string().optional(),
      supplierId: z.string().optional(),
      employeeId: z.string().optional(),
      paymentDate: z.string().min(1),
      currencyCode: z.string().min(1),
      exchangeRate: z
        .number()
        .gt(0)
        .describe(
          "Applied when creating; on update a field left out keeps its value."
        )
        .optional(),
      totalAmount: z.number().min(0),
      bankAccount: z.string().min(1),
      reference: z.string().optional(),
      memo: z.string().optional(),
      salesOrderId: z.string().optional(),
      rentalAgreementId: z.string().optional(),
      paymentId: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPayment(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Delete payment
 *
 * @mcp destructive
 */
export const deletePaymentTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deletePayment(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Replace invoice settlements
 *
 * @mcp destructive
 */
export const replaceInvoiceSettlementsTool = defineServiceFn({
  input: z.looseObject({
    paymentId: z.string(),
    applications: z.array(
      z.looseObject({
        memoId: z.string().optional(),
        targetSalesInvoiceId: z.string().optional(),
        targetPurchaseInvoiceId: z.string().optional(),
        targetMemoId: z.string().optional(),
        targetReimbursementId: z.string().optional(),
        sourceAmount: z.number().min(0).optional(),
        appliedAmount: z.number().min(0).default(0),
        discountAmount: z.number().min(0).default(0),
        writeOffAmount: z.number().min(0).default(0),
        targetExchangeRate: z.number().gt(0),
        sourceExchangeRate: z.number().gt(0),
        appliedDate: z.string().min(1)
      })
    )
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await replaceInvoiceSettlements(
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "createdBy"]) as never
      )
    );
  }
});

/**
 * Get memo
 *
 * @mcp read
 */
export const getMemoTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getMemo(ctx.asCaller.supabase, input.id as never, ctx.company.id)
    );
  }
});

/**
 * Get memos
 *
 * @mcp read
 */
export const getMemosTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    direction: z.enum(["Credit", "Debit"]).nullable().optional(),
    status: z.enum(["Draft", "Posted", "Voided"]).nullable().optional(),
    counterpartyIds: z.array(z.string()).nullable().optional(),
    party: z.enum(["customer", "supplier"]).nullable().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getMemos(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Create a memo
 *
 * @remarks
 * Upsert memo
 *
 * @mcp
 */
export const upsertMemoCreateTool = defineServiceFn({
  input: z.looseObject({
    direction: z.enum(["Credit", "Debit"]),
    customerId: z.string().optional(),
    supplierId: z.string().optional(),
    memoDate: z.string().min(1),
    currencyCode: z.string().min(1),
    exchangeRate: z
      .number()
      .gt(0)
      .default(1)
      .describe(
        "Applied when creating; on update a field left out keeps its value."
      ),
    amount: z.number().gt(0),
    reference: z.string().optional(),
    notes: z.string().optional(),
    memoId: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMemo(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a memo
 *
 * @remarks
 * Upsert memo
 *
 * @mcp
 */
export const upsertMemoUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      direction: z.enum(["Credit", "Debit"]),
      customerId: z.string().optional(),
      supplierId: z.string().optional(),
      memoDate: z.string().min(1),
      currencyCode: z.string().min(1),
      exchangeRate: z
        .number()
        .gt(0)
        .describe(
          "Applied when creating; on update a field left out keeps its value."
        )
        .optional(),
      amount: z.number().gt(0),
      reference: z.string().optional(),
      notes: z.string().optional(),
      memoId: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMemo(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Get available credits for party
 *
 * @mcp read
 */
export const getAvailableCreditsForPartyTool = defineServiceFn({
  input: z.looseObject({
    party: z.union([
      z.looseObject({ side: z.literal("sales"), customerId: z.string() }),
      z.looseObject({ side: z.literal("purchase"), supplierId: z.string() })
    ]),
    excludePaymentId: z.string().optional(),
    currencyCode: z.string().optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAvailableCreditsForParty(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.party, ["companyId"]) as never,
        input.excludePaymentId as never,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Get company has open credits
 *
 * @mcp read
 */
export const getCompanyHasOpenCreditsTool = defineServiceFn({
  input: z.looseObject({ side: z.enum(["sales", "purchase"]) }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getCompanyHasOpenCredits(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.side as never
      )
    );
  }
});

/**
 * Get staged credits for payment
 *
 * @mcp read
 */
export const getStagedCreditsForPaymentTool = defineServiceFn({
  input: z.looseObject({
    paymentId: z.string(),
    side: z.enum(["sales", "purchase"])
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getStagedCreditsForPayment(
        ctx.asCaller.supabase,
        input.paymentId as never,
        input.side as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Apply credits to invoices
 *
 * @mcp destructive
 */
export const applyCreditsToInvoicesTool = defineServiceFn({
  input: z.looseObject({
    paymentId: z.string(),
    appliedDate: z.string(),
    side: z.enum(["sales", "purchase"]),
    applications: z.array(
      z.looseObject({
        memoId: z.string(),
        invoiceId: z.string(),
        amount: z.number(),
        sourceAmount: z.number().optional()
      })
    )
  }),
  permission: { update: "invoicing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await applyCreditsToInvoices(
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "createdBy"]) as never
      )
    );
  }
});

/**
 * Get ar tie out
 *
 * @mcp read
 */
export const getArTieOutTool = defineServiceFn({
  input: z.looseObject({ asOfDate: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getArTieOut(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never
      )
    );
  }
});

/**
 * Get ap tie out
 *
 * @mcp read
 */
export const getApTieOutTool = defineServiceFn({
  input: z.looseObject({ asOfDate: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getApTieOut(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never
      )
    );
  }
});

/**
 * Get ar open by customer
 *
 * @mcp read
 */
export const getArOpenByCustomerTool = defineServiceFn({
  input: z.looseObject({ asOfDate: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getArOpenByCustomer(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never
      )
    );
  }
});

/**
 * Get ap open by supplier
 *
 * @mcp read
 */
export const getApOpenBySupplierTool = defineServiceFn({
  input: z.looseObject({ asOfDate: z.string() }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getApOpenBySupplier(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never
      )
    );
  }
});

/**
 * Get ar aging
 *
 * @mcp read
 */
export const getArAgingTool = defineServiceFn({
  input: z.looseObject({
    asOfDate: z.string(),
    options: z
      .looseObject({
        agingMethod: z.enum(["dueDate", "documentDate"]).optional(),
        bucketDays: z.array(z.number()).nullable().optional()
      })
      .optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getArAging(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never,
        stamp(ctx, input.options, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get ap aging
 *
 * @mcp read
 */
export const getApAgingTool = defineServiceFn({
  input: z.looseObject({
    asOfDate: z.string(),
    options: z
      .looseObject({
        agingMethod: z.enum(["dueDate", "documentDate"]).optional(),
        bucketDays: z.array(z.number()).nullable().optional()
      })
      .optional()
  }),
  permission: { view: "invoicing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getApAging(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.asOfDate as never,
        stamp(ctx, input.options, ["companyId"]) as never
      )
    );
  }
});
