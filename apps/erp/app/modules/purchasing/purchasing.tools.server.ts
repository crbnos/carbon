// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The purchasing module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in purchasing.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import {
  envelope,
  envelopes,
  paged,
  plain,
  stamp
} from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  convertSupplierQuoteToOrder,
  createPurchaseReturnOrderCredit,
  createReplacementPurchaseOrder,
  createSupplierInteractionDocumentUploadUrl,
  createSupplierInteractionLineDocumentUploadUrl,
  deleteLease,
  deleteLeaseLine,
  deleteLeasePayment,
  deletePurchaseOrderLine,
  deletePurchaseReturnOrder,
  deletePurchaseReturnOrderLine,
  deletePurchasingRFQ,
  deletePurchasingRFQLine,
  deleteSupplier,
  deleteSupplierBankAccount,
  deleteSupplierContact,
  deleteSupplierLocation,
  deleteSupplierProcess,
  deleteSupplierQuote,
  deleteSupplierQuoteLine,
  deleteSupplierType,
  duplicatePurchaseOrder,
  getCreditableQuantitiesForPurchaseReturn,
  getDefaultAttachmentsForPO,
  getLease,
  getLeaseEvents,
  getLeaseLines,
  getLeasePayments,
  getLeaseRelatedDocuments,
  getLeaseSchedule,
  getLeases,
  getLinkedSupplierQuotes,
  getPurchaseOrder,
  getPurchaseOrderDelivery,
  getPurchaseOrderLine,
  getPurchaseOrderLines,
  getPurchaseOrderPayment,
  getPurchaseOrders,
  getPurchaseReturnOrder,
  getPurchaseReturnOrderCredits,
  getPurchaseReturnOrderIssues,
  getPurchaseReturnOrderLine,
  getPurchaseReturnOrderLines,
  getPurchaseReturnOrderLineTrackedEntities,
  getPurchaseReturnOrderShipments,
  getPurchaseReturnOrders,
  getPurchasingDocumentsAssignedToMe,
  getPurchasingPlanning,
  getPurchasingRFQ,
  getPurchasingRFQLine,
  getPurchasingRFQLines,
  getPurchasingRFQSuppliersWithLinks,
  getPurchasingRFQs,
  getReturnableEntitiesForSupplier,
  getReturnableLinesForSupplier,
  getSiblingQuotesForQuote,
  getSupplier,
  getSupplierBankAccounts,
  getSupplierContact,
  getSupplierContacts,
  getSupplierInteraction,
  getSupplierInteractionDocuments,
  getSupplierInteractionLineDocuments,
  getSupplierLocation,
  getSupplierLocations,
  getSupplierPayment,
  getSupplierProcessesByProcess,
  getSupplierProcessesBySupplier,
  getSupplierQuote,
  getSupplierQuoteByExternalLinkId,
  getSupplierQuoteLine,
  getSupplierQuoteLinePrices,
  getSupplierQuoteLinePricesByQuoteId,
  getSupplierQuoteLines,
  getSupplierQuotes,
  getSupplierQuotesForComparison,
  getSupplierReportContacts,
  getSupplierShipping,
  getSuppliers,
  getSuppliersList,
  getSupplierTax,
  getSupplierType,
  getSupplierTypes,
  getSupplierTypesList,
  insertLease,
  insertPurchaseOrder,
  insertPurchaseReturnOrder,
  insertSupplierContact,
  insertSupplierLocation,
  insertSupplierQuote,
  shortClosePurchaseOrderLine,
  shortClosePurchaseReturnOrderLine,
  updateLeaseDetails,
  updatePurchaseOrder,
  updatePurchaseOrderExchangeRate,
  updatePurchaseOrderFavorite,
  updatePurchaseOrderLineOrder,
  updatePurchasingRFQLineOrder,
  updatePurchasingRFQStatus,
  updateSupplierContact,
  updateSupplierLocation,
  updateSupplierPayment,
  updateSupplierQuote,
  updateSupplierQuoteExchangeRate,
  updateSupplierQuoteLineOrder,
  updateSupplierQuoteStatus,
  updateSupplierShipping,
  updateSupplierTax,
  upsertLeasePayment,
  upsertPurchaseOrderDelivery,
  upsertPurchaseOrderLine,
  upsertPurchaseOrderPayment,
  upsertPurchasingRFQ,
  upsertPurchasingRFQLine,
  upsertPurchasingRFQSuppliers,
  upsertSupplier,
  upsertSupplierBankAccount,
  upsertSupplierProcess,
  upsertSupplierQuoteLine,
  upsertSupplierType
} from "./purchasing.service";

/**
 * Convert supplier quote to order
 *
 * @mcp
 */
export const convertSupplierQuoteToOrderTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    selectedLines: z.record(z.string(), z.unknown())
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await convertSupplierQuoteToOrder(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Delete purchase order line
 *
 * @mcp destructive
 */
export const deletePurchaseOrderLineTool = defineServiceFn({
  input: z.looseObject({ purchaseOrderLineId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deletePurchaseOrderLine(
        ctx.asCaller.supabase,
        input.purchaseOrderLineId as never
      )
    );
  }
});

/**
 * Duplicate purchase order
 *
 * @mcp
 */
export const duplicatePurchaseOrderTool = defineServiceFn({
  input: z.looseObject({ sourcePurchaseOrderId: z.string() }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await duplicatePurchaseOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId",
          "companyGroupId"
        ]) as never
      )
    );
  }
});

/**
 * Delete supplier
 *
 * @mcp destructive
 */
export const deleteSupplierTool = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSupplier(ctx.asCaller.supabase, input.supplierId as never)
    );
  }
});

/**
 * Delete supplier contact
 *
 * @mcp destructive
 */
export const deleteSupplierContactTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    supplierContactId: z.string()
  }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSupplierContact(
        ctx.asCaller.supabase,
        input.supplierId as never,
        input.supplierContactId as never
      )
    );
  }
});

/**
 * Delete supplier location
 *
 * @mcp destructive
 */
export const deleteSupplierLocationTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    supplierLocationId: z.string()
  }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSupplierLocation(
        ctx.asCaller.supabase,
        input.supplierId as never,
        input.supplierLocationId as never
      )
    );
  }
});

/**
 * Delete supplier bank account
 *
 * @mcp destructive
 */
export const deleteSupplierBankAccountTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSupplierBankAccount(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Lists a supplier's bank accounts
 *
 * @mcp read
 */
export const getSupplierBankAccountsTool = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierBankAccounts(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Create a supplier bank account
 *
 * @remarks
 * Upsert supplier bank account
 *
 * @mcp
 */
export const upsertSupplierBankAccountCreateTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string().min(1),
    name: z.string().min(1),
    accountHolderName: z.string().optional(),
    bankName: z.string().min(1),
    bankAddress: z.string().min(1),
    countryCode: z.string().min(1),
    currencyCode: z.string().optional(),
    accountNumber: z.string().optional(),
    bankCode: z.string().optional(),
    swiftBic: z.string().optional(),
    notes: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return plain(
      ctx,
      await upsertSupplierBankAccount(
        ctx.asSystem.pg,
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
 * Update a supplier bank account
 *
 * @remarks
 * Upsert supplier bank account
 *
 * @mcp
 */
export const upsertSupplierBankAccountUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      supplierId: z.string().min(1),
      name: z.string().min(1),
      accountHolderName: z.string().optional(),
      bankName: z.string().min(1),
      bankAddress: z.string().min(1),
      countryCode: z.string().min(1),
      currencyCode: z.string().optional(),
      accountNumber: z.string().optional(),
      bankCode: z.string().optional(),
      swiftBic: z.string().optional(),
      notes: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return plain(
      ctx,
      await upsertSupplierBankAccount(
        ctx.asSystem.pg,
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
 * Delete supplier process
 *
 * @mcp destructive
 */
export const deleteSupplierProcessTool = defineServiceFn({
  input: z.looseObject({ supplierProcessId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSupplierProcess(
        ctx.asCaller.supabase,
        input.supplierProcessId as never
      )
    );
  }
});

/**
 * Delete supplier quote
 *
 * @mcp destructive
 */
export const deleteSupplierQuoteTool = defineServiceFn({
  input: z.looseObject({ supplierQuoteId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSupplierQuote(
        ctx.asCaller.supabase,
        input.supplierQuoteId as never
      )
    );
  }
});

/**
 * Delete supplier quote line
 *
 * @mcp destructive
 */
export const deleteSupplierQuoteLineTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSupplierQuoteLine(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete supplier type
 *
 * @mcp destructive
 */
export const deleteSupplierTypeTool = defineServiceFn({
  input: z.looseObject({ supplierTypeId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSupplierType(
        ctx.asCaller.supabase,
        input.supplierTypeId as never
      )
    );
  }
});

/**
 * Get purchase order
 *
 * @mcp read
 */
export const getPurchaseOrderTool = defineServiceFn({
  input: z.looseObject({ purchaseOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseOrder(
        ctx.asCaller.supabase,
        input.purchaseOrderId as never
      )
    );
  }
});

/**
 * Get purchase orders
 *
 * @mcp read
 */
export const getPurchaseOrdersTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getPurchaseOrders(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get purchase order delivery
 *
 * @mcp read
 */
export const getPurchaseOrderDeliveryTool = defineServiceFn({
  input: z.looseObject({ purchaseOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseOrderDelivery(
        ctx.asCaller.supabase,
        input.purchaseOrderId as never
      )
    );
  }
});

/**
 * Get purchase order payment
 *
 * @mcp read
 */
export const getPurchaseOrderPaymentTool = defineServiceFn({
  input: z.looseObject({ purchaseOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseOrderPayment(
        ctx.asCaller.supabase,
        input.purchaseOrderId as never
      )
    );
  }
});

/**
 * Get purchase order lines
 *
 * @mcp read
 */
export const getPurchaseOrderLinesTool = defineServiceFn({
  input: z.looseObject({ purchaseOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseOrderLines(
        ctx.asCaller.supabase,
        input.purchaseOrderId as never
      )
    );
  }
});

/**
 * Get purchase order line
 *
 * @mcp read
 */
export const getPurchaseOrderLineTool = defineServiceFn({
  input: z.looseObject({ purchaseOrderLineId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseOrderLine(
        ctx.asCaller.supabase,
        input.purchaseOrderLineId as never
      )
    );
  }
});

/**
 * Get purchasing documents assigned to me
 *
 * @mcp read
 */
export const getPurchasingDocumentsAssignedToMeTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "purchasing" },
  async run(ctx) {
    return plain(
      ctx,
      await getPurchasingDocumentsAssignedToMe(
        ctx.asCaller.supabase,
        ctx.auditUserId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get purchasing planning
 *
 * @mcp read
 */
export const getPurchasingPlanningTool = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    periods: z.array(z.string()),
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional(),
      asOf: z.string(),
      actionTypes: z.array(z.string()).optional(),
      actionAssignees: z.array(z.string()).optional()
    })
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getPurchasingPlanning(
        ctx.asCaller.supabase,
        input.locationId as never,
        ctx.company.id,
        stamp(ctx, input.periods, ["companyId"]) as never,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get supplier
 *
 * @mcp read
 */
export const getSupplierTool = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplier(ctx.asCaller.supabase, input.supplierId as never)
    );
  }
});

/**
 * Get supplier contact
 *
 * @mcp read
 */
export const getSupplierContactTool = defineServiceFn({
  input: z.looseObject({ supplierContactId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierContact(
        ctx.asCaller.supabase,
        input.supplierContactId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get supplier contacts
 *
 * @mcp read
 */
export const getSupplierContactsTool = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierContacts(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Get supplier interaction
 *
 * @mcp read
 */
export const getSupplierInteractionTool = defineServiceFn({
  input: z.looseObject({ opportunityId: z.string().nullable() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierInteraction(
        ctx.asCaller.supabase,
        input.opportunityId as never
      )
    );
  }
});

/**
 * Get supplier interaction documents
 *
 * @mcp read
 */
export const getSupplierInteractionDocumentsTool = defineServiceFn({
  input: z.looseObject({ interactionId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getSupplierInteractionDocuments(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.interactionId as never
      )
    );
  }
});

/**
 * Get supplier interaction line documents
 *
 * @mcp read
 */
export const getSupplierInteractionLineDocumentsTool = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getSupplierInteractionLineDocuments(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.lineId as never
      )
    );
  }
});

/**
 * Get supplier locations
 *
 * @mcp read
 */
export const getSupplierLocationsTool = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierLocations(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Get supplier location
 *
 * @mcp read
 */
export const getSupplierLocationTool = defineServiceFn({
  input: z.looseObject({ supplierContactId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierLocation(
        ctx.asCaller.supabase,
        input.supplierContactId as never
      )
    );
  }
});

/**
 * Get supplier payment
 *
 * @mcp read
 */
export const getSupplierPaymentTool = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierPayment(ctx.asCaller.supabase, input.supplierId as never)
    );
  }
});

/**
 * Get supplier processes by process
 *
 * @mcp read
 */
export const getSupplierProcessesByProcessTool = defineServiceFn({
  input: z.looseObject({ processId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierProcessesByProcess(
        ctx.asCaller.supabase,
        input.processId as never
      )
    );
  }
});

/**
 * Get supplier processes by supplier
 *
 * @mcp read
 */
export const getSupplierProcessesBySupplierTool = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierProcessesBySupplier(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Get supplier quote
 *
 * @mcp read
 */
export const getSupplierQuoteTool = defineServiceFn({
  input: z.looseObject({ supplierQuoteId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierQuote(
        ctx.asCaller.supabase,
        input.supplierQuoteId as never
      )
    );
  }
});

/**
 * Get supplier quote by external link id
 *
 * @mcp read
 */
export const getSupplierQuoteByExternalLinkIdTool = defineServiceFn({
  input: z.looseObject({ externalLinkId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierQuoteByExternalLinkId(
        ctx.asCaller.supabase,
        input.externalLinkId as never
      )
    );
  }
});

/**
 * Get supplier quotes
 *
 * @mcp read
 */
export const getSupplierQuotesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getSupplierQuotes(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get supplier quote line
 *
 * @mcp read
 */
export const getSupplierQuoteLineTool = defineServiceFn({
  input: z.looseObject({ supplierQuoteLineId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierQuoteLine(
        ctx.asCaller.supabase,
        input.supplierQuoteLineId as never
      )
    );
  }
});

/**
 * Get supplier quote lines
 *
 * @mcp read
 */
export const getSupplierQuoteLinesTool = defineServiceFn({
  input: z.looseObject({ supplierQuoteId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierQuoteLines(
        ctx.asCaller.supabase,
        input.supplierQuoteId as never
      )
    );
  }
});

/**
 * Get supplier quote line prices
 *
 * @mcp read
 */
export const getSupplierQuoteLinePricesTool = defineServiceFn({
  input: z.looseObject({ supplierQuoteLineId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierQuoteLinePrices(
        ctx.asCaller.supabase,
        input.supplierQuoteLineId as never
      )
    );
  }
});

/**
 * Get supplier quote line prices by quote id
 *
 * @mcp read
 */
export const getSupplierQuoteLinePricesByQuoteIdTool = defineServiceFn({
  input: z.looseObject({ supplierQuoteId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierQuoteLinePricesByQuoteId(
        ctx.asCaller.supabase,
        input.supplierQuoteId as never
      )
    );
  }
});

/**
 * Get supplier shipping
 *
 * @mcp read
 */
export const getSupplierShippingTool = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierShipping(
        ctx.asCaller.supabase,
        input.supplierId as never
      )
    );
  }
});

/**
 * Get supplier report contacts
 *
 * @mcp read
 */
export const getSupplierReportContactsTool = defineServiceFn({
  input: z.looseObject({ supplierIds: z.array(z.string()) }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelopes(
      ctx,
      await getSupplierReportContacts(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.supplierIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get suppliers
 *
 * @mcp read
 */
export const getSuppliersTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    status: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getSuppliers(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get suppliers list
 *
 * @mcp read
 */
export const getSuppliersListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "purchasing" },
  async run(ctx) {
    return envelope(
      ctx,
      await getSuppliersList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get supplier type
 *
 * @mcp read
 */
export const getSupplierTypeTool = defineServiceFn({
  input: z.looseObject({ supplierTypeId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierType(
        ctx.asCaller.supabase,
        input.supplierTypeId as never
      )
    );
  }
});

/**
 * Get supplier types
 *
 * @mcp read
 */
export const getSupplierTypesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getSupplierTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get supplier types list
 *
 * @mcp read
 */
export const getSupplierTypesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "purchasing" },
  async run(ctx) {
    return envelope(
      ctx,
      await getSupplierTypesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Insert supplier contact
 *
 * @mcp
 */
export const insertSupplierContactTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    contact: z.looseObject({
      id: z.string().optional(),
      contactId: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      title: z.string().optional(),
      email: z.string().min(1),
      mobilePhone: z.string().optional(),
      homePhone: z.string().optional(),
      workPhone: z.string().optional(),
      notes: z.string().optional(),
      supplierLocationId: z.string().optional()
    }),
    supplierLocationId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertSupplierContact(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Insert supplier location
 *
 * @mcp
 */
export const insertSupplierLocationTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    name: z.string(),
    address: z.looseObject({
      addressLine1: z.string().optional(),
      addressLine2: z.string().optional(),
      city: z.string().optional(),
      stateProvince: z.string().optional(),
      postalCode: z.string().optional(),
      countryCode: z.string().optional()
    }),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertSupplierLocation(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update purchase order exchange rate
 *
 * @mcp
 */
export const updatePurchaseOrderExchangeRateTool = defineServiceFn({
  input: z.looseObject({ id: z.string(), exchangeRate: z.number() }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updatePurchaseOrderExchangeRate(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update purchase order favorite
 *
 * @mcp destructive
 */
export const updatePurchaseOrderFavoriteTool = defineServiceFn({
  input: z.looseObject({ id: z.string(), favorite: z.boolean() }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updatePurchaseOrderFavorite(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Update supplier contact
 *
 * @mcp
 */
export const updateSupplierContactTool = defineServiceFn({
  input: z.looseObject({
    contactId: z.string(),
    contact: z.looseObject({
      id: z.string().optional(),
      contactId: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      title: z.string().optional(),
      email: z.string().min(1),
      mobilePhone: z.string().optional(),
      homePhone: z.string().optional(),
      workPhone: z.string().optional(),
      notes: z.string().optional(),
      supplierLocationId: z.string().optional()
    }),
    supplierLocationId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateSupplierContact(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update supplier location
 *
 * @mcp
 */
export const updateSupplierLocationTool = defineServiceFn({
  input: z.looseObject({
    addressId: z.string(),
    name: z.string(),
    address: z.looseObject({
      addressLine1: z.string().optional(),
      addressLine2: z.string().optional(),
      city: z.string().optional(),
      stateProvince: z.string().optional(),
      countryCode: z.string().optional(),
      postalCode: z.string().optional()
    }),
    customFields: z.unknown().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateSupplierLocation(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update supplier payment
 *
 * @mcp
 */
export const updateSupplierPaymentTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string().min(1),
    invoiceSupplierId: z.string().optional(),
    invoiceSupplierLocationId: z.string().optional(),
    invoiceSupplierContactId: z.string().optional(),
    paymentTermId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateSupplierPayment(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update supplier quote exchange rate
 *
 * @mcp
 */
export const updateSupplierQuoteExchangeRateTool = defineServiceFn({
  input: z.looseObject({ id: z.string(), exchangeRate: z.number() }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateSupplierQuoteExchangeRate(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update supplier quote status
 *
 * @mcp
 */
export const updateSupplierQuoteStatusTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    status: z.enum(["Draft", "Active", "Expired", "Declined", "Cancelled"]),
    assignee: z.null().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateSupplierQuoteStatus(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update supplier shipping
 *
 * @mcp
 */
export const updateSupplierShippingTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string().min(1),
    shippingSupplierId: z.string().optional(),
    shippingSupplierLocationId: z.string().optional(),
    shippingSupplierContactId: z.string().optional(),
    shippingMethodId: z.string().optional(),
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
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateSupplierShipping(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Get supplier tax
 *
 * @mcp read
 */
export const getSupplierTaxTool = defineServiceFn({
  input: z.looseObject({ supplierId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierTax(ctx.asCaller.supabase, input.supplierId as never)
    );
  }
});

/**
 * Update supplier tax
 *
 * @mcp
 */
export const updateSupplierTaxTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string().min(1),
    taxId: z.string().optional(),
    vatNumber: z.string().optional(),
    eori: z.string().optional(),
    taxExempt: z.boolean().optional(),
    taxExemptionReason: z
      .enum([
        "Resale",
        "Government",
        "Nonprofit",
        "Agriculture",
        "Industrial",
        "Export",
        "Medical",
        "Educational",
        "Religious",
        "Other"
      ])
      .nullable()
      .optional(),
    taxExemptionCertificateNumber: z.string().optional(),
    taxExemptionCertificatePath: z.string().nullable().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateSupplierTax(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a new purchase order with all business logic - generates sequence, creates supplier interaction, resolves payment/shipping defaults from supplier
 *
 * @remarks
 * Create a new purchase order with all business logic - generates sequence, creates supplier interaction, resolves payment/shipping defaults from supplier. LLM can create a PO with just supplierId.
 *
 * @mcp
 */
export const insertPurchaseOrderTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    purchaseOrderId: z.string().optional(),
    purchaseOrderType: z
      .enum(["Purchase", "Return", "Outside Processing"])
      .optional(),
    locationId: z.string().optional(),
    status: z
      .enum([
        "Draft",
        "Planned",
        "Needs Approval",
        "To Review",
        "To Receive",
        "To Receive and Invoice",
        "To Invoice",
        "Completed",
        "Rejected",
        "Closed"
      ])
      .optional(),
    currencyCode: z.string().optional(),
    orderDate: z.string().optional(),
    supplierContactId: z.string().optional(),
    supplierLocationId: z.string().optional(),
    supplierQuoteId: z.string().optional(),
    receiptRequestedDate: z.string().optional(),
    supplierReference: z.string().optional(),
    notes: z.unknown().optional(),
    externalNotes: z.unknown().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertPurchaseOrder(
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
 * Update an existing purchase order - handles exchange rate updates when currency changes
 *
 * @mcp
 */
export const updatePurchaseOrderTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    status: z
      .enum([
        "Draft",
        "Planned",
        "Needs Approval",
        "To Review",
        "To Receive",
        "To Receive and Invoice",
        "To Invoice",
        "Completed",
        "Rejected",
        "Closed"
      ])
      .optional(),
    currencyCode: z.string().optional(),
    orderDate: z.string().optional(),
    supplierId: z.string().optional(),
    supplierContactId: z.string().nullable().optional(),
    supplierLocationId: z.string().nullable().optional(),
    supplierReference: z.string().optional(),
    purchaseOrderType: z.enum(["Purchase", "Outside Processing"]).optional(),
    notes: z.string().nullable().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updatePurchaseOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Upsert purchase order delivery
 *
 * @mcp
 */
export const upsertPurchaseOrderDeliveryTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    locationId: z.string().optional(),
    shippingMethodId: z.string().optional(),
    trackingNumber: z.string(),
    deliveryDate: z.string().optional(),
    receiptRequestedDate: z.string().optional(),
    receiptPromisedDate: z.string().optional(),
    dropShipment: z.boolean().optional(),
    customerId: z.string().optional(),
    customerLocationId: z.string().optional(),
    supplierShippingCost: z.number().optional(),
    notes: z.string().optional(),
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
  permission: { create: "purchasing", update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPurchaseOrderDelivery(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a purchase order line
 *
 * @remarks
 * Upsert purchase order line
 *
 * @mcp
 */
export const upsertPurchaseOrderLineCreateTool = defineServiceFn({
  input: z.looseObject({
    purchaseOrderId: z.string().min(1),
    purchaseOrderLineType: z.enum([
      "Part",
      "Material",
      "Tool",
      "Consumable",
      "Service",
      "Fixture",
      "G/L Account",
      "Fixed Asset"
    ]),
    itemId: z.string().optional(),
    accountId: z.string().optional(),
    costCenterId: z.string().optional(),
    assetId: z.string().optional(),
    conversionFactor: z.number().optional(),
    description: z.string().optional(),
    exchangeRate: z.number().optional(),
    inventoryUnitOfMeasureCode: z.string().optional(),
    jobId: z.string().optional(),
    jobOperationId: z.string().optional(),
    locationId: z.string().optional(),
    promisedDate: z.string().optional(),
    purchaseQuantity: z.number().optional(),
    purchaseUnitOfMeasureCode: z.string().optional(),
    requiredDate: z.string().optional(),
    storageUnitId: z.string().optional(),
    supplierPartId: z.string().optional(),
    supplierShippingCost: z.number().optional(),
    supplierTaxAmount: z.number().optional(),
    supplierUnitPrice: z.number().optional(),
    taxPercent: z
      .number()
      .min(0)
      .max(1)
      .default(0)
      .describe(
        "Applied when creating; on update a field left out keeps its value."
      ),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPurchaseOrderLine(
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
 * Update a purchase order line
 *
 * @remarks
 * Upsert purchase order line
 *
 * @mcp
 */
export const upsertPurchaseOrderLineUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      purchaseOrderId: z.string().min(1),
      purchaseOrderLineType: z.enum([
        "Part",
        "Material",
        "Tool",
        "Consumable",
        "Service",
        "Fixture",
        "G/L Account",
        "Fixed Asset"
      ]),
      itemId: z.string().optional(),
      accountId: z.string().optional(),
      costCenterId: z.string().optional(),
      assetId: z.string().optional(),
      conversionFactor: z.number().optional(),
      description: z.string().optional(),
      exchangeRate: z.number().optional(),
      inventoryUnitOfMeasureCode: z.string().optional(),
      jobId: z.string().optional(),
      jobOperationId: z.string().optional(),
      locationId: z.string().optional(),
      promisedDate: z.string().optional(),
      purchaseQuantity: z.number().optional(),
      purchaseUnitOfMeasureCode: z.string().optional(),
      requiredDate: z.string().optional(),
      storageUnitId: z.string().optional(),
      supplierPartId: z.string().optional(),
      supplierShippingCost: z.number().optional(),
      supplierTaxAmount: z.number().optional(),
      supplierUnitPrice: z.number().optional(),
      taxPercent: z
        .number()
        .min(0)
        .max(1)
        .describe(
          "Applied when creating; on update a field left out keeps its value."
        )
        .optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPurchaseOrderLine(
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
 * Update purchase order line order
 *
 * @mcp
 */
export const updatePurchaseOrderLineOrderTool = defineServiceFn({
  input: z.looseObject({
    purchaseOrderId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updatePurchaseOrderLineOrder(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        input.purchaseOrderId as never,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Short-close ("stop receiving") or reopen a purchase order line whose remaining quantity will never arrive
 *
 * @mcp
 */
export const shortClosePurchaseOrderLineTool = defineServiceFn({
  input: z.looseObject({
    lineId: z.string(),
    purchaseOrderId: z.string(),
    intent: z.enum(["close", "reopen"])
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await shortClosePurchaseOrderLine(
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Upsert purchase order payment
 *
 * @mcp
 */
export const upsertPurchaseOrderPaymentTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    invoiceSupplierId: z.string().optional(),
    invoiceSupplierLocationId: z.string().optional(),
    invoiceSupplierContactId: z.string().optional(),
    paymentTermId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing", update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPurchaseOrderPayment(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a supplier
 *
 * @remarks
 * Upsert supplier
 *
 * @mcp
 */
export const upsertSupplierCreateTool = defineServiceFn({
  input: z.looseObject({
    readableId: z.string().optional(),
    name: z.string().min(1),
    supplierStatus: z
      .enum(["Active", "Inactive", "Pending", "Rejected"])
      .nullable()
      .optional(),
    supplierTypeId: z.string().optional(),
    accountManagerId: z.string().optional(),
    currencyCode: z.string().optional(),
    purchasingContactId: z.string().optional(),
    website: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSupplier(
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
 * Update a supplier
 *
 * @remarks
 * Upsert supplier
 *
 * @mcp
 */
export const upsertSupplierUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      readableId: z.string().optional(),
      name: z.string().min(1),
      supplierStatus: z
        .enum(["Active", "Inactive", "Pending", "Rejected"])
        .nullable()
        .optional(),
      supplierTypeId: z.string().optional(),
      accountManagerId: z.string().optional(),
      currencyCode: z.string().optional(),
      purchasingContactId: z.string().optional(),
      website: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSupplier(
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
 * Create a supplier process
 *
 * @remarks
 * Upsert supplier process
 *
 * @mcp
 */
export const upsertSupplierProcessCreateTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string().min(1),
    processId: z.string().min(1),
    minimumCost: z.number().min(0),
    leadTime: z.number().min(0),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSupplierProcess(
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
 * Update a supplier process
 *
 * @remarks
 * Upsert supplier process
 *
 * @mcp
 */
export const upsertSupplierProcessUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      supplierId: z.string().min(1),
      processId: z.string().min(1),
      minimumCost: z.number().min(0),
      leadTime: z.number().min(0),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSupplierProcess(
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
 * Create a new supplier quote with all business logic - generates sequence, creates supplier interaction, sets up external link
 *
 * @remarks
 * Create a new supplier quote with all business logic - generates sequence, creates supplier interaction, sets up external link. LLM can create a quote with just supplierId.
 *
 * @mcp
 */
export const insertSupplierQuoteTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    supplierQuoteId: z.string().optional(),
    locationId: z.string().optional(),
    status: z
      .enum(["Draft", "Active", "Expired", "Declined", "Cancelled"])
      .optional(),
    currencyCode: z.string().optional(),
    expirationDate: z.string().optional(),
    supplierContactId: z.string().optional(),
    supplierLocationId: z.string().optional(),
    notes: z.string().optional(),
    customFields: z.unknown().optional(),
    quotedDate: z.string().optional(),
    supplierReference: z.string().optional(),
    supplierQuoteType: z.enum(["Purchase", "Outside Processing"]).optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertSupplierQuote(
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
 * Update an existing supplier quote - handles exchange rate updates when currency changes
 *
 * @mcp
 */
export const updateSupplierQuoteTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    status: z
      .enum(["Draft", "Active", "Expired", "Declined", "Cancelled"])
      .optional(),
    currencyCode: z.string().optional(),
    expirationDate: z.string().nullable().optional(),
    supplierContactId: z.string().nullable().optional(),
    supplierLocationId: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateSupplierQuote(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a supplier quote line
 *
 * @remarks
 * Upsert supplier quote line
 *
 * @mcp
 */
export const upsertSupplierQuoteLineCreateTool = defineServiceFn({
  input: z.looseObject({
    supplierQuoteId: z.string(),
    supplierQuoteLineType: z.enum([
      "Part",
      "Material",
      "Tool",
      "Consumable",
      "Service",
      "G/L Account"
    ]),
    itemId: z.string().optional(),
    accountId: z.string().optional(),
    costCenterId: z.string().optional(),
    description: z.string().optional(),
    supplierPartId: z.string().optional(),
    inventoryUnitOfMeasureCode: z.string().optional(),
    purchaseUnitOfMeasureCode: z.string().optional(),
    conversionFactor: z.number().optional(),
    requiredDate: z.string().optional(),
    quantity: z.array(z.number().min(0.00001)),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSupplierQuoteLine(
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
 * Update a supplier quote line
 *
 * @remarks
 * Upsert supplier quote line
 *
 * @mcp
 */
export const upsertSupplierQuoteLineUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      supplierQuoteId: z.string(),
      supplierQuoteLineType: z.enum([
        "Part",
        "Material",
        "Tool",
        "Consumable",
        "Service",
        "G/L Account"
      ]),
      itemId: z.string().optional(),
      accountId: z.string().optional(),
      costCenterId: z.string().optional(),
      description: z.string().optional(),
      supplierPartId: z.string().optional(),
      inventoryUnitOfMeasureCode: z.string().optional(),
      purchaseUnitOfMeasureCode: z.string().optional(),
      conversionFactor: z.number().optional(),
      requiredDate: z.string().optional(),
      quantity: z.array(z.number().min(0.00001)),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSupplierQuoteLine(
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
 * Update supplier quote line order
 *
 * @mcp
 */
export const updateSupplierQuoteLineOrderTool = defineServiceFn({
  input: z.looseObject({
    supplierQuoteId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updateSupplierQuoteLineOrder(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        input.supplierQuoteId as never,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a supplier type
 *
 * @remarks
 * Upsert supplier type
 *
 * @mcp
 */
export const upsertSupplierTypeCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSupplierType(
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
 * Update a supplier type
 *
 * @remarks
 * Upsert supplier type
 *
 * @mcp
 */
export const upsertSupplierTypeUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSupplierType(
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
 * Delete purchasing r f q
 *
 * @mcp destructive
 */
export const deletePurchasingRFQTool = defineServiceFn({
  input: z.looseObject({ purchasingRfqId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deletePurchasingRFQ(
        ctx.asCaller.supabase,
        input.purchasingRfqId as never
      )
    );
  }
});

/**
 * Delete purchasing r f q line
 *
 * @mcp destructive
 */
export const deletePurchasingRFQLineTool = defineServiceFn({
  input: z.looseObject({ purchasingRfqLineId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deletePurchasingRFQLine(
        ctx.asCaller.supabase,
        input.purchasingRfqLineId as never
      )
    );
  }
});

/**
 * Get purchasing r f q
 *
 * @mcp read
 */
export const getPurchasingRFQTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchasingRFQ(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get purchasing r f qs
 *
 * @mcp read
 */
export const getPurchasingRFQsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getPurchasingRFQs(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get purchasing r f q line
 *
 * @mcp read
 */
export const getPurchasingRFQLineTool = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchasingRFQLine(ctx.asCaller.supabase, input.lineId as never)
    );
  }
});

/**
 * Get purchasing r f q lines
 *
 * @mcp read
 */
export const getPurchasingRFQLinesTool = defineServiceFn({
  input: z.looseObject({ purchasingRfqId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchasingRFQLines(
        ctx.asCaller.supabase,
        input.purchasingRfqId as never
      )
    );
  }
});

/**
 * Upsert purchasing r f q
 *
 * @mcp
 */
export const upsertPurchasingRFQTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    rfqId: z.string(),
    rfqDate: z.string(),
    expirationDate: z.string().optional(),
    locationId: z.string().optional(),
    employeeId: z.string().optional(),
    status: z.enum(["Draft", "Requested", "Closed"]).optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing", update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPurchasingRFQ(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a purchasing rfqline
 *
 * @remarks
 * Upsert purchasing r f q line
 *
 * @mcp
 */
export const upsertPurchasingRFQLineCreateTool = defineServiceFn({
  input: z.looseObject({
    purchasingRfqLine: z.looseObject({
      purchasingRfqId: z.string(),
      itemId: z.string(),
      description: z.string().optional(),
      quantity: z.array(z.number()),
      purchaseUnitOfMeasureCode: z.string(),
      inventoryUnitOfMeasureCode: z.string(),
      conversionFactor: z.number().optional(),
      order: z.number(),
      customFields: z.unknown().optional()
    })
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPurchasingRFQLine(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input.purchasingRfqLine,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a purchasing rfqline
 *
 * @remarks
 * Upsert purchasing r f q line
 *
 * @mcp
 */
export const upsertPurchasingRFQLineUpdateTool = defineServiceFn({
  input: z.looseObject({
    purchasingRfqLine: z.looseObject({
      id: z.string(),
      purchasingRfqId: z.string(),
      itemId: z.string(),
      description: z.string().optional(),
      quantity: z.array(z.number()),
      purchaseUnitOfMeasureCode: z.string(),
      inventoryUnitOfMeasureCode: z.string(),
      conversionFactor: z.number().optional(),
      order: z.number(),
      customFields: z.unknown().optional()
    })
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPurchasingRFQLine(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input.purchasingRfqLine,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Update purchasing r f q line order
 *
 * @mcp
 */
export const updatePurchasingRFQLineOrderTool = defineServiceFn({
  input: z.looseObject({
    purchasingRfqId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updatePurchasingRFQLineOrder(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        input.purchasingRfqId as never,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Upsert purchasing r f q suppliers
 *
 * @mcp destructive
 */
export const upsertPurchasingRFQSuppliersTool = defineServiceFn({
  input: z.looseObject({
    purchasingRfqId: z.string(),
    supplierIds: z.array(z.string())
  }),
  permission: { create: "purchasing", update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPurchasingRFQSuppliers(
        ctx.asCaller.supabase,
        input.purchasingRfqId as never,
        stamp(ctx, input.supplierIds, [
          "companyId",
          "createdBy",
          "updatedBy"
        ]) as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Update purchasing r f q status
 *
 * @mcp
 */
export const updatePurchasingRFQStatusTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    status: z.enum(["Draft", "Requested", "Closed"]),
    assignee: z.string().nullable().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updatePurchasingRFQStatus(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Get linked supplier quotes
 *
 * @mcp read
 */
export const getLinkedSupplierQuotesTool = defineServiceFn({
  input: z.looseObject({ purchasingRfqId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getLinkedSupplierQuotes(
        ctx.asCaller.supabase,
        input.purchasingRfqId as never
      )
    );
  }
});

/**
 * Get sibling quotes for quote
 *
 * @mcp read
 */
export const getSiblingQuotesForQuoteTool = defineServiceFn({
  input: z.looseObject({ supplierQuoteId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSiblingQuotesForQuote(
        ctx.asCaller.supabase,
        input.supplierQuoteId as never
      )
    );
  }
});

/**
 * Get supplier quotes for comparison
 *
 * @mcp read
 */
export const getSupplierQuotesForComparisonTool = defineServiceFn({
  input: z.looseObject({ purchasingRfqId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSupplierQuotesForComparison(
        ctx.asCaller.supabase,
        input.purchasingRfqId as never
      )
    );
  }
});

/**
 * Get purchasing r f q suppliers with links
 *
 * @mcp read
 */
export const getPurchasingRFQSuppliersWithLinksTool = defineServiceFn({
  input: z.looseObject({ purchasingRfqId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchasingRFQSuppliersWithLinks(
        ctx.asCaller.supabase,
        input.purchasingRfqId as never
      )
    );
  }
});

/**
 * Get default attachments for p o
 *
 * @mcp read
 */
export const getDefaultAttachmentsForPOTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string().nullable(),
    itemIds: z.array(z.string())
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getDefaultAttachmentsForPO(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get purchase return orders
 *
 * @mcp read
 */
export const getPurchaseReturnOrdersTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getPurchaseReturnOrders(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get purchase return order
 *
 * @mcp read
 */
export const getPurchaseReturnOrderTool = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseReturnOrder(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never
      )
    );
  }
});

/**
 * Get purchase return order lines
 *
 * @mcp read
 */
export const getPurchaseReturnOrderLinesTool = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseReturnOrderLines(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get purchase return order line
 *
 * @mcp read
 */
export const getPurchaseReturnOrderLineTool = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseReturnOrderLine(
        ctx.asCaller.supabase,
        input.lineId as never
      )
    );
  }
});

/**
 * Get purchase return order line tracked entities
 *
 * @mcp read
 */
export const getPurchaseReturnOrderLineTrackedEntitiesTool = defineServiceFn({
  input: z.looseObject({ lineIds: z.array(z.string()) }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseReturnOrderLineTrackedEntities(
        ctx.asCaller.supabase,
        stamp(ctx, input.lineIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Insert purchase return order
 *
 * @mcp
 */
export const insertPurchaseReturnOrderTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    purchaseReturnOrderId: z.string().optional(),
    orderDate: z.string(),
    supplierLocationId: z.string().optional(),
    supplierContactId: z.string().optional(),
    supplierReference: z.string().optional(),
    locationId: z.string().optional(),
    purchaseOrderId: z.string().optional(),
    currencyCode: z.string().optional(),
    expirationDate: z.string().optional(),
    assignee: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertPurchaseReturnOrder(
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
 * Delete purchase return order
 *
 * @mcp destructive
 */
export const deletePurchaseReturnOrderTool = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deletePurchaseReturnOrder(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never
      )
    );
  }
});

/**
 * Delete purchase return order line
 *
 * @mcp destructive
 */
export const deletePurchaseReturnOrderLineTool = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deletePurchaseReturnOrderLine(
        ctx.asCaller.supabase,
        input.lineId as never
      )
    );
  }
});

/**
 * Get purchase return order shipments
 *
 * @mcp read
 */
export const getPurchaseReturnOrderShipmentsTool = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseReturnOrderShipments(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get purchase return order credits
 *
 * @mcp read
 */
export const getPurchaseReturnOrderCreditsTool = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseReturnOrderCredits(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get purchase return order issues
 *
 * @mcp read
 */
export const getPurchaseReturnOrderIssuesTool = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseReturnOrderIssues(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Short-close ("stop expecting") a supplier return line — the shortClosePurchaseOrderLine mechanic
 *
 * @mcp
 */
export const shortClosePurchaseReturnOrderLineTool = defineServiceFn({
  input: z.looseObject({
    lineId: z.string(),
    purchaseReturnOrderId: z.string(),
    intent: z.enum(["close", "reopen"])
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await shortClosePurchaseReturnOrderLine(
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Returnable receipt lines for a supplier, searched + paginated in the database via the get_returnable_receipt_lines RPC
 *
 * @mcp read
 */
export const getReturnableLinesForSupplierTool = defineServiceFn({
  input: z.looseObject({
    supplierId: z.string(),
    args: z
      .looseObject({
        purchaseOrderId: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional()
      })
      .optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getReturnableLinesForSupplier(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.supplierId as never,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Entity picker source for supplier return lines: serials/batches on hand that were received from this supplier
 *
 * @mcp read
 */
export const getReturnableEntitiesForSupplierTool = defineServiceFn({
  input: z.looseObject({ supplierId: z.string(), itemId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getReturnableEntitiesForSupplier(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.supplierId as never,
        input.itemId as never
      )
    );
  }
});

/**
 * Per-line creditable pool = shipped − already credited
 *
 * @mcp read
 */
export const getCreditableQuantitiesForPurchaseReturnTool = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCreditableQuantitiesForPurchaseReturn(
        ctx.asCaller.supabase,
        input.purchaseReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Issue supplier credit: one AP memo + per-line purchaseReturnOrderCreditLine breakdown
 *
 * @mcp
 */
export const createPurchaseReturnOrderCreditTool = defineServiceFn({
  input: z.looseObject({
    purchaseReturnOrderId: z.string(),
    memoDate: z.string(),
    lines: z.array(
      z.looseObject({
        purchaseReturnOrderLineId: z.string(),
        quantity: z.number()
      })
    )
  }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await createPurchaseReturnOrderCredit(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, [
          "companyId",
          "companyGroupId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * Create Replacement Purchase Order: a draft PO from the return lines, priced from the linked PO line (purchase-UOM price + conversion factor copied) else the su…
 *
 * @mcp
 */
export const createReplacementPurchaseOrderTool = defineServiceFn({
  input: z.looseObject({ purchaseReturnOrderId: z.string() }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createReplacementPurchaseOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId",
          "companyGroupId"
        ]) as never
      )
    );
  }
});

/**
 * Create a presigned upload URL for a supplier interaction (purchase order/supplier quote/RFQ) document
 *
 * @mcp
 */
export const createSupplierInteractionDocumentUploadUrlTool = defineServiceFn({
  input: z.looseObject({ interactionId: z.string(), name: z.string() }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createSupplierInteractionDocumentUploadUrl(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a presigned upload URL for a supplier interaction LINE document
 *
 * @mcp
 */
export const createSupplierInteractionLineDocumentUploadUrlTool =
  defineServiceFn({
    input: z.looseObject({ lineId: z.string(), name: z.string() }),
    permission: { create: "purchasing" },
    async run(ctx, input) {
      return envelope(
        ctx,
        await createSupplierInteractionLineDocumentUploadUrl(
          ctx.asCaller.supabase,
          stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
        )
      );
    }
  });

/**
 * Get leases
 *
 * @mcp read
 */
export const getLeasesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getLeases(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get lease
 *
 * @mcp read
 */
export const getLeaseTool = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getLease(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * `leaseId` (the readable LSE number) comes from the caller — the route draws it from the sequence
 *
 * @mcp
 */
export const insertLeaseTool = defineServiceFn({
  input: z.looseObject({
    leaseId: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    supplierId: z.string().min(1),
    supplierLocationId: z.string().optional(),
    supplierContactId: z.string().optional(),
    locationId: z.string().optional(),
    assignee: z.string().optional(),
    commencementDate: z.string().min(1),
    duration: z
      .enum(["12", "24", "36", "48", "60", "open", "custom"])
      .optional(),
    endDate: z.string().optional(),
    noticeDate: z.string().optional(),
    invoiceFromDate: z.string().optional(),
    paymentFrequency: z.enum(["Monthly", "Quarterly", "Annual"]),
    paymentTiming: z.enum(["Advance", "Arrears"]),
    annualEscalationPercent: z.number().min(0).default(0),
    discountRate: z.number().min(0),
    currencyCode: z.string().min(1),
    customFields: z.unknown().optional()
  }),
  permission: { create: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertLease(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * A lease's details — its name, notes, owner and notice date (`leaseDetailFields`) — which stay editable in every status: nothing was measured from them
 *
 * @mcp
 */
export const updateLeaseDetailsTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    assignee: z.string().nullable().optional(),
    noticeDate: z.string().nullable().optional()
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateLeaseDetails(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Only a Draft lease can be deleted; cancel an active one
 *
 * @mcp destructive
 */
export const deleteLeaseTool = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteLease(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * The lease's assets in their order
 *
 * @mcp read
 */
export const getLeaseLinesTool = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getLeaseLines(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Every payment row of every asset: a long lease of many assets runs past PostgREST's 1,000-row page
 *
 * @mcp read
 */
export const getLeasePaymentsTool = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getLeasePayments(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Removes an asset, and its payment rows with it, from a Draft lease
 *
 * @mcp destructive
 */
export const deleteLeaseLineTool = defineServiceFn({
  input: z.looseObject({ leaseId: z.string(), leaseLineId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteLeaseLine(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Add or change one payment row of a Draft lease's asset (a rent holiday, an irregular step)
 *
 * @mcp
 */
export const upsertLeasePaymentTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    leaseId: z.string().min(1),
    leaseLineId: z.string().min(1),
    paymentType: z
      .enum(["Rent", "Purchase Option", "Termination Penalty"])
      .optional(),
    periodStart: z.string().min(1),
    periodEnd: z.string().min(1),
    dueDate: z.string().min(1),
    amount: z.number().min(0)
  }),
  permission: { update: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertLeasePayment(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Delete lease payment
 *
 * @mcp destructive
 */
export const deleteLeasePaymentTool = defineServiceFn({
  input: z.looseObject({ leaseId: z.string(), paymentId: z.string() }),
  permission: { delete: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteLeasePayment(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * The monthly schedule of every asset, each line with whether its lease run rows have posted: a long lease of many assets runs past PostgREST's 1,000-row page
 *
 * @mcp read
 */
export const getLeaseScheduleTool = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getLeaseSchedule(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get lease events
 *
 * @mcp read
 */
export const getLeaseEventsTool = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getLeaseEvents(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * The purchase invoices that bill the lease, and the journals that name it
 *
 * @mcp read
 */
export const getLeaseRelatedDocumentsTool = defineServiceFn({
  input: z.looseObject({ leaseId: z.string() }),
  permission: { view: "purchasing" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getLeaseRelatedDocuments(
        ctx.asCaller.supabase,
        input.leaseId as never,
        ctx.company.id
      )
    );
  }
});
