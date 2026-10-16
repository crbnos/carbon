// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The sales module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in sales.server.ts.

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
  cancelSalesReturnOrder,
  copyQuote,
  createOpportunityDocumentUploadUrl,
  createOpportunityLineDocumentUploadUrl,
  createPricingRule,
  createReplacementSalesOrder,
  createSalesReturnOrderCredit,
  deleteCustomer,
  deleteCustomerBankAccount,
  deleteCustomerContact,
  deleteCustomerItemPriceOverride,
  deleteCustomerItemRentalRate,
  deleteCustomerLocation,
  deleteCustomerStatus,
  deleteCustomerType,
  deleteNoQuoteReason,
  deletePricingRule,
  deleteQuote,
  deleteQuoteLine,
  deleteQuoteOperationParameter,
  deleteQuoteOperationStep,
  deleteQuoteOperationTool,
  deleteRentalAgreement,
  deleteRentalAgreementCharge,
  deleteRentalAgreementLine,
  deleteReturnReason,
  deleteSalesOrder,
  deleteSalesOrderLine,
  deleteSalesReturnOrder,
  deleteSalesReturnOrderLine,
  deleteSalesRFQ,
  deleteSalesRFQLine,
  duplicatePricingRule,
  getBaseCatalog,
  getConfigurationParametersByQuoteLineId,
  getContract,
  getContractAmendments,
  getContractInvoiceSchedule,
  getContractLine,
  getContractLines,
  getContracts,
  getCreditableQuantities,
  getCustomer,
  getCustomerBankAccounts,
  getCustomerContact,
  getCustomerContacts,
  getCustomerContractStatuses,
  getCustomerItemPriceOverride,
  getCustomerItemPriceOverrideById,
  getCustomerItemRentalRate,
  getCustomerItemRentalRates,
  getCustomerLocation,
  getCustomerLocations,
  getCustomerPayment,
  getCustomerShipping,
  getCustomerStatus,
  getCustomerStatuses,
  getCustomerStatusesList,
  getCustomers,
  getCustomersList,
  getCustomerTax,
  getCustomerType,
  getCustomerTypes,
  getCustomerTypesList,
  getDefaultRentalRates,
  getExternalSalesOrderLines,
  getItemRentalRate,
  getModelByQuoteLineId,
  getNoQuoteReason,
  getNoQuoteReasons,
  getOpenSalesOrderLinesForItem,
  getOpportunity,
  getOpportunityDocuments,
  getOpportunityLineDocuments,
  getPricingRule,
  getPricingRules,
  getQuote,
  getQuoteByExternalId,
  getQuoteCustomerDetails,
  getQuoteLine,
  getQuoteLinePrices,
  getQuoteLinePricesByQuoteId,
  getQuoteLinePriceTraces,
  getQuoteLines,
  getQuoteLinesList,
  getQuoteMakeMethod,
  getQuoteMaterialsByMethodId,
  getQuoteMethodTrees,
  getQuoteOperationsByLine,
  getQuoteOperationsByMethodId,
  getQuotePayment,
  getQuoteShipment,
  getQuotes,
  getQuotesList,
  getRelatedPricesForQuoteLine,
  getRentableFleetAssets,
  getRentalAgreement,
  getRentalAgreementCharges,
  getRentalAgreementDeposits,
  getRentalAgreementLine,
  getRentalAgreementLines,
  getRentalAgreementRelatedDocuments,
  getRentalAgreements,
  getRentalBillingPeriods,
  getReturnableLinesForCustomer,
  getReturnReason,
  getReturnReasons,
  getReturnReasonsList,
  getRootQuoteMakeMethod,
  getSalesDocumentsAssignedToMe,
  getSalesOrder,
  getSalesOrderInvoiceLines,
  getSalesOrderInvoicePaymentsByIds,
  getSalesOrderInvoicesByIds,
  getSalesOrderLine,
  getSalesOrderLineShipments,
  getSalesOrderLines,
  getSalesOrderPayment,
  getSalesOrderRelatedItems,
  getSalesOrderShipment,
  getSalesOrders,
  getSalesOrdersList,
  getSalesReturnOrder,
  getSalesReturnOrderCredits,
  getSalesReturnOrderIssues,
  getSalesReturnOrderLine,
  getSalesReturnOrderLines,
  getSalesReturnOrderReceipts,
  getSalesReturnOrders,
  getSalesRFQ,
  getSalesRFQLine,
  getSalesRFQLines,
  getSalesRFQs,
  getSalesTerms,
  getShippedTrackedEntitiesForCustomer,
  insertCustomerContact,
  insertCustomerLocation,
  insertQuote,
  insertSalesOrder,
  insertSalesReturnOrder,
  reopenSalesReturnOrder,
  repriceQuoteLineFromRules,
  resolvePrice,
  resolvePriceList,
  setSalesReturnOrderLineDisposition,
  shortCloseSalesReturnOrderLine,
  updateCustomerContact,
  updateCustomerLocation,
  updateCustomerPayment,
  updateCustomerShipping,
  updateCustomerTax,
  updatePricingRule,
  updateQuoteExchangeRate,
  updateQuoteLineOrder,
  updateQuoteLinePrecision,
  updateQuoteMaterialOrder,
  updateQuoteOperationOrder,
  updateSalesOrderExchangeRate,
  updateSalesOrderLineOrder,
  updateSalesRFQLineOrder,
  upsertContractLine,
  upsertCustomer,
  upsertCustomerBankAccount,
  upsertCustomerItemPriceOverride,
  upsertCustomerItemRentalRate,
  upsertCustomerStatus,
  upsertCustomerType,
  upsertItemRentalRate,
  upsertMakeMethodFromQuoteLine,
  upsertMakeMethodFromQuoteMethod,
  upsertNoQuoteReason,
  upsertQuoteLineAdditionalCharges,
  upsertQuoteLinePrices,
  upsertQuoteOperationParameter,
  upsertQuoteOperationStep,
  upsertQuoteOperationTool,
  upsertQuotePayment,
  upsertQuoteShipment,
  upsertRentalAgreementCharge,
  upsertRentalAgreementLine,
  upsertReturnReason,
  upsertSalesOrderPayment,
  upsertSalesOrderShipment,
  upsertSalesRFQ,
  upsertSalesRFQLine
} from "./sales.service";

/**
 * Copy quote
 *
 * @mcp
 */
export const copyQuoteTool = defineServiceFn({
  input: z.looseObject({ sourceId: z.string(), targetId: z.string() }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await copyQuote(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * Create pricing rule
 *
 * @mcp
 */
export const createPricingRuleTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    name: z.string().min(1),
    ruleType: z.enum(["Discount", "Markup", "Configuration"]),
    amountType: z.enum(["Percentage", "Fixed"]),
    amount: z.number().min(0),
    minQuantity: z.number().min(0).optional(),
    maxQuantity: z.number().min(0).optional(),
    customerIds: z.array(z.string()).default([]),
    customerTypeIds: z.array(z.string()).default([]),
    itemIds: z.array(z.string()).nullable().default([]),
    itemId: z.string().optional(),
    itemPostingGroupId: z.string().optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
    priority: z.number().int().min(0).default(0),
    active: z.boolean().optional(),
    configurationPrices: z
      .array(
        z.looseObject({
          key: z.string().min(1),
          value: z.string().nullable(),
          amount: z.number(),
          label: z.string().optional()
        })
      )
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createPricingRule(
        ctx.asCaller.supabase,
        ctx.company.id,
        ctx.auditUserId,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Delete customer
 *
 * @mcp destructive
 */
export const deleteCustomerTool = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteCustomer(ctx.asCaller.supabase, input.customerId as never)
    );
  }
});

/**
 * Delete customer bank account
 *
 * @mcp destructive
 */
export const deleteCustomerBankAccountTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteCustomerBankAccount(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Lists a customer's bank accounts
 *
 * @mcp read
 */
export const getCustomerBankAccountsTool = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerBankAccounts(
        ctx.asCaller.supabase,
        input.customerId as never
      )
    );
  }
});

/**
 * Create a customer bank account
 *
 * @remarks
 * Upsert customer bank account
 *
 * @mcp
 */
export const upsertCustomerBankAccountCreateTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string().min(1),
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
      await upsertCustomerBankAccount(
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
 * Update a customer bank account
 *
 * @remarks
 * Upsert customer bank account
 *
 * @mcp
 */
export const upsertCustomerBankAccountUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      customerId: z.string().min(1),
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
      await upsertCustomerBankAccount(
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
 * Delete customer contact
 *
 * @mcp destructive
 */
export const deleteCustomerContactTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    customerContactId: z.string()
  }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteCustomerContact(
        ctx.asCaller.supabase,
        input.customerId as never,
        input.customerContactId as never
      )
    );
  }
});

/**
 * Delete customer location
 *
 * @mcp destructive
 */
export const deleteCustomerLocationTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    customerLocationId: z.string()
  }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteCustomerLocation(
        ctx.asCaller.supabase,
        input.customerId as never,
        input.customerLocationId as never
      )
    );
  }
});

/**
 * Delete customer status
 *
 * @mcp destructive
 */
export const deleteCustomerStatusTool = defineServiceFn({
  input: z.looseObject({ customerStatusId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteCustomerStatus(
        ctx.asCaller.supabase,
        input.customerStatusId as never
      )
    );
  }
});

/**
 * Delete customer type
 *
 * @mcp destructive
 */
export const deleteCustomerTypeTool = defineServiceFn({
  input: z.looseObject({ customerTypeId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteCustomerType(
        ctx.asCaller.supabase,
        input.customerTypeId as never
      )
    );
  }
});

/**
 * Delete no quote reason
 *
 * @mcp destructive
 */
export const deleteNoQuoteReasonTool = defineServiceFn({
  input: z.looseObject({ noQuoteReasonId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteNoQuoteReason(
        ctx.asCaller.supabase,
        input.noQuoteReasonId as never
      )
    );
  }
});

/**
 * Delete pricing rule
 *
 * @mcp destructive
 */
export const deletePricingRuleTool = defineServiceFn({
  input: z.looseObject({ pricingRuleId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deletePricingRule(
        ctx.asCaller.supabase,
        input.pricingRuleId as never
      )
    );
  }
});

/**
 * Delete quote
 *
 * @mcp destructive
 */
export const deleteQuoteTool = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteQuote(ctx.asCaller.supabase, input.quoteId as never)
    );
  }
});

/**
 * Delete quote line
 *
 * @mcp destructive
 */
export const deleteQuoteLineTool = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteQuoteLine(ctx.asCaller.supabase, input.quoteLineId as never)
    );
  }
});

/**
 * Delete quote operation step
 *
 * @mcp destructive
 */
export const deleteQuoteOperationStepTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteQuoteOperationStep(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete quote operation parameter
 *
 * @mcp destructive
 */
export const deleteQuoteOperationParameterTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteQuoteOperationParameter(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete quote operation tool
 *
 * @mcp destructive
 */
export const deleteQuoteOperationToolTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteQuoteOperationTool(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete sales order
 *
 * @mcp destructive
 */
export const deleteSalesOrderTool = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSalesOrder(ctx.asCaller.supabase, input.salesOrderId as never)
    );
  }
});

/**
 * Delete sales order line
 *
 * @mcp destructive
 */
export const deleteSalesOrderLineTool = defineServiceFn({
  input: z.looseObject({ salesOrderLineId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSalesOrderLine(
        ctx.asCaller.supabase,
        input.salesOrderLineId as never
      )
    );
  }
});

/**
 * Delete sales r f q
 *
 * @mcp destructive
 */
export const deleteSalesRFQTool = defineServiceFn({
  input: z.looseObject({ salesRfqId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSalesRFQ(ctx.asCaller.supabase, input.salesRfqId as never)
    );
  }
});

/**
 * Delete sales r f q line
 *
 * @mcp destructive
 */
export const deleteSalesRFQLineTool = defineServiceFn({
  input: z.looseObject({ salesRFQLineId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSalesRFQLine(
        ctx.asCaller.supabase,
        input.salesRFQLineId as never
      )
    );
  }
});

/**
 * Duplicate pricing rule
 *
 * @mcp
 */
export const duplicatePricingRuleTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await duplicatePricingRule(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Get configuration parameters by quote line id
 *
 * @mcp read
 */
export const getConfigurationParametersByQuoteLineIdTool = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getConfigurationParametersByQuoteLineId(
        ctx.asCaller.supabase,
        input.quoteLineId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer
 *
 * @mcp read
 */
export const getCustomerTool = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomer(
        ctx.asCaller.supabase,
        input.customerId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer contact
 *
 * @mcp read
 */
export const getCustomerContactTool = defineServiceFn({
  input: z.looseObject({ customerContactId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerContact(
        ctx.asCaller.supabase,
        input.customerContactId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer contacts
 *
 * @mcp read
 */
export const getCustomerContactsTool = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerContacts(
        ctx.asCaller.supabase,
        input.customerId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer item price override
 *
 * @mcp read
 */
export const getCustomerItemPriceOverrideTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    itemId: z.string(),
    quantity: z.number().optional(),
    date: z.string().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerItemPriceOverride(
        ctx.asCaller.supabase,
        input.customerId as never,
        input.itemId as never,
        ctx.company.id,
        input.quantity as never,
        input.date as never
      )
    );
  }
});

/**
 * Get customer location
 *
 * @mcp read
 */
export const getCustomerLocationTool = defineServiceFn({
  input: z.looseObject({ customerLocationId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerLocation(
        ctx.asCaller.supabase,
        input.customerLocationId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer locations
 *
 * @mcp read
 */
export const getCustomerLocationsTool = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerLocations(
        ctx.asCaller.supabase,
        input.customerId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer payment
 *
 * @mcp read
 */
export const getCustomerPaymentTool = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerPayment(
        ctx.asCaller.supabase,
        input.customerId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer shipping
 *
 * @mcp read
 */
export const getCustomerShippingTool = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerShipping(
        ctx.asCaller.supabase,
        input.customerId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer tax
 *
 * @mcp read
 */
export const getCustomerTaxTool = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerTax(
        ctx.asCaller.supabase,
        input.customerId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customers
 *
 * @mcp read
 */
export const getCustomersTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getCustomers(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get customers list
 *
 * @mcp read
 */
export const getCustomersListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return envelope(
      ctx,
      await getCustomersList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get customer status
 *
 * @mcp read
 */
export const getCustomerStatusTool = defineServiceFn({
  input: z.looseObject({ customerStatusId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerStatus(
        ctx.asCaller.supabase,
        input.customerStatusId as never
      )
    );
  }
});

/**
 * Get customer statuses
 *
 * @mcp read
 */
export const getCustomerStatusesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getCustomerStatuses(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get customer statuses list
 *
 * @mcp read
 */
export const getCustomerStatusesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return envelope(
      ctx,
      await getCustomerStatusesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get customer type
 *
 * @mcp read
 */
export const getCustomerTypeTool = defineServiceFn({
  input: z.looseObject({ customerTypeId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerType(
        ctx.asCaller.supabase,
        input.customerTypeId as never
      )
    );
  }
});

/**
 * Get customer types
 *
 * @mcp read
 */
export const getCustomerTypesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getCustomerTypes(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get customer types list
 *
 * @mcp read
 */
export const getCustomerTypesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return envelope(
      ctx,
      await getCustomerTypesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get external sales order lines
 *
 * @mcp read
 */
export const getExternalSalesOrderLinesTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    args: z.looseObject({
      limit: z
        .number()
        .int()
        .describe("Rows per page. Left out, the read is not paged.")
        .optional(),
      offset: z.number().int().default(0),
      search: z.string().nullable().optional()
    })
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getExternalSalesOrderLines(
        ctx.asCaller.supabase,
        input.customerId as never,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get model by quote line id
 *
 * @mcp read
 */
export const getModelByQuoteLineIdTool = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getModelByQuoteLineId(
        ctx.asCaller.supabase,
        input.quoteLineId as never
      )
    );
  }
});

/**
 * Get no quote reason
 *
 * @mcp read
 */
export const getNoQuoteReasonTool = defineServiceFn({
  input: z.looseObject({ noQuoteReasonId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getNoQuoteReason(
        ctx.asCaller.supabase,
        input.noQuoteReasonId as never
      )
    );
  }
});

/**
 * Get no quote reasons
 *
 * @mcp read
 */
export const getNoQuoteReasonsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getNoQuoteReasons(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get opportunity
 *
 * @mcp read
 */
export const getOpportunityTool = defineServiceFn({
  input: z.looseObject({ opportunityId: z.string().nullable() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getOpportunity(ctx.asCaller.supabase, input.opportunityId as never)
    );
  }
});

/**
 * Get opportunity documents
 *
 * @mcp read
 */
export const getOpportunityDocumentsTool = defineServiceFn({
  input: z.looseObject({ opportunityId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getOpportunityDocuments(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.opportunityId as never
      )
    );
  }
});

/**
 * Get opportunity line documents
 *
 * @mcp read
 */
export const getOpportunityLineDocumentsTool = defineServiceFn({
  input: z.looseObject({
    lineId: z.string(),
    itemId: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getOpportunityLineDocuments(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.lineId as never,
        input.itemId as never
      )
    );
  }
});

/**
 * Get pricing rule
 *
 * @mcp read
 */
export const getPricingRuleTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPricingRule(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get pricing rules
 *
 * @mcp read
 */
export const getPricingRulesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getPricingRules(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get quote
 *
 * @mcp read
 */
export const getQuoteTool = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuote(ctx.asCaller.supabase, input.quoteId as never)
    );
  }
});

/**
 * Get quotes
 *
 * @mcp read
 */
export const getQuotesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getQuotes(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get quotes list
 *
 * @mcp read
 */
export const getQuotesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return envelope(
      ctx,
      await getQuotesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get quote customer details
 *
 * @mcp read
 */
export const getQuoteCustomerDetailsTool = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteCustomerDetails(
        ctx.asCaller.supabase,
        input.quoteId as never
      )
    );
  }
});

/**
 * Get quote line
 *
 * @mcp read
 */
export const getQuoteLineTool = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteLine(ctx.asCaller.supabase, input.quoteLineId as never)
    );
  }
});

/**
 * Get quote lines list
 *
 * @mcp read
 */
export const getQuoteLinesListTool = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteLinesList(ctx.asCaller.supabase, input.quoteId as never)
    );
  }
});

/**
 * Get quote make method
 *
 * @mcp read
 */
export const getQuoteMakeMethodTool = defineServiceFn({
  input: z.looseObject({ quoteMakeMethodId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteMakeMethod(
        ctx.asCaller.supabase,
        input.quoteMakeMethodId as never
      )
    );
  }
});

/**
 * Get root quote make method
 *
 * @mcp read
 */
export const getRootQuoteMakeMethodTool = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRootQuoteMakeMethod(
        ctx.asCaller.supabase,
        input.quoteLineId as never
      )
    );
  }
});

/**
 * Get quote method trees
 *
 * @mcp read
 */
export const getQuoteMethodTreesTool = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteMethodTrees(ctx.asCaller.supabase, input.quoteId as never)
    );
  }
});

/**
 * Get quote lines
 *
 * @mcp read
 */
export const getQuoteLinesTool = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteLines(ctx.asCaller.supabase, input.quoteId as never)
    );
  }
});

/**
 * Get quote by external id
 *
 * @mcp read
 */
export const getQuoteByExternalIdTool = defineServiceFn({
  input: z.looseObject({ externalId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteByExternalId(
        ctx.asCaller.supabase,
        input.externalId as never
      )
    );
  }
});

/**
 * Get quote line prices
 *
 * @mcp read
 */
export const getQuoteLinePricesTool = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteLinePrices(
        ctx.asCaller.supabase,
        input.quoteLineId as never
      )
    );
  }
});

/**
 * Get quote line prices by quote id
 *
 * @mcp read
 */
export const getQuoteLinePricesByQuoteIdTool = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteLinePricesByQuoteId(
        ctx.asCaller.supabase,
        input.quoteId as never
      )
    );
  }
});

/**
 * Get quote materials by method id
 *
 * @mcp read
 */
export const getQuoteMaterialsByMethodIdTool = defineServiceFn({
  input: z.looseObject({ quoteMakeMethodId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteMaterialsByMethodId(
        ctx.asCaller.supabase,
        input.quoteMakeMethodId as never
      )
    );
  }
});

/**
 * Get quote operations by line
 *
 * @mcp read
 */
export const getQuoteOperationsByLineTool = defineServiceFn({
  input: z.looseObject({ quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteOperationsByLine(
        ctx.asCaller.supabase,
        input.quoteLineId as never
      )
    );
  }
});

/**
 * Get quote operations by method id
 *
 * @mcp read
 */
export const getQuoteOperationsByMethodIdTool = defineServiceFn({
  input: z.looseObject({ quoteMakeMethodId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteOperationsByMethodId(
        ctx.asCaller.supabase,
        input.quoteMakeMethodId as never
      )
    );
  }
});

/**
 * Get quote payment
 *
 * @mcp read
 */
export const getQuotePaymentTool = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuotePayment(ctx.asCaller.supabase, input.quoteId as never)
    );
  }
});

/**
 * Get quote shipment
 *
 * @mcp read
 */
export const getQuoteShipmentTool = defineServiceFn({
  input: z.looseObject({ quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteShipment(ctx.asCaller.supabase, input.quoteId as never)
    );
  }
});

/**
 * Get related prices for quote line
 *
 * @mcp read
 */
export const getRelatedPricesForQuoteLineTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), quoteId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getRelatedPricesForQuoteLine(
        ctx.asCaller.supabase,
        input.itemId as never,
        input.quoteId as never
      )
    );
  }
});

/**
 * Get sales documents assigned to me
 *
 * @mcp read
 */
export const getSalesDocumentsAssignedToMeTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return plain(
      ctx,
      await getSalesDocumentsAssignedToMe(
        ctx.asCaller.supabase,
        ctx.auditUserId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get sales order
 *
 * @mcp read
 */
export const getSalesOrderTool = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesOrder(ctx.asCaller.supabase, input.salesOrderId as never)
    );
  }
});

/**
 * Get sales order related items
 *
 * @mcp read
 */
export const getSalesOrderRelatedItemsTool = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string(), opportunityId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getSalesOrderRelatedItems(
        ctx.asCaller.supabase,
        input.salesOrderId as never,
        input.opportunityId as never
      )
    );
  }
});

/**
 * Get sales orders
 *
 * @mcp read
 */
export const getSalesOrdersTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    customerId: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getSalesOrders(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get sales orders list
 *
 * @mcp read
 */
export const getSalesOrdersListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return envelope(
      ctx,
      await getSalesOrdersList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get sales order payment
 *
 * @mcp read
 */
export const getSalesOrderPaymentTool = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesOrderPayment(
        ctx.asCaller.supabase,
        input.salesOrderId as never
      )
    );
  }
});

/**
 * Get sales terms
 *
 * @mcp read
 */
export const getSalesTermsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return envelope(
      ctx,
      await getSalesTerms(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get sales order shipment
 *
 * @mcp read
 */
export const getSalesOrderShipmentTool = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesOrderShipment(
        ctx.asCaller.supabase,
        input.salesOrderId as never
      )
    );
  }
});

/**
 * Get sales order lines
 *
 * @mcp read
 */
export const getSalesOrderLinesTool = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesOrderLines(
        ctx.asCaller.supabase,
        input.salesOrderId as never
      )
    );
  }
});

/**
 * Get sales order invoice lines
 *
 * @mcp read
 */
export const getSalesOrderInvoiceLinesTool = defineServiceFn({
  input: z.looseObject({ salesOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesOrderInvoiceLines(
        ctx.asCaller.supabase,
        input.salesOrderId as never
      )
    );
  }
});

/**
 * Get sales order invoices by ids
 *
 * @mcp read
 */
export const getSalesOrderInvoicesByIdsTool = defineServiceFn({
  input: z.looseObject({ invoiceIds: z.array(z.string()) }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesOrderInvoicesByIds(
        ctx.asCaller.supabase,
        stamp(ctx, input.invoiceIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get sales order invoice payments by ids
 *
 * @mcp read
 */
export const getSalesOrderInvoicePaymentsByIdsTool = defineServiceFn({
  input: z.looseObject({ invoiceIds: z.array(z.string()) }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesOrderInvoicePaymentsByIds(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.invoiceIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Sales order lines eligible for a job to link to: lines whose item matches the job's item, on sales orders that are still open (not Completed/Invoiced/ Cancelle…
 *
 * @mcp read
 */
export const getOpenSalesOrderLinesForItemTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getOpenSalesOrderLinesForItem(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.itemId as never
      )
    );
  }
});

/**
 * Get sales order line
 *
 * @mcp read
 */
export const getSalesOrderLineTool = defineServiceFn({
  input: z.looseObject({ salesOrderLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesOrderLine(
        ctx.asCaller.supabase,
        input.salesOrderLineId as never
      )
    );
  }
});

/**
 * Get sales order line shipments
 *
 * @mcp read
 */
export const getSalesOrderLineShipmentsTool = defineServiceFn({
  input: z.looseObject({ salesOrderLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesOrderLineShipments(
        ctx.asCaller.supabase,
        input.salesOrderLineId as never
      )
    );
  }
});

/**
 * Get sales r f q
 *
 * @mcp read
 */
export const getSalesRFQTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesRFQ(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get sales r f qs
 *
 * @mcp read
 */
export const getSalesRFQsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getSalesRFQs(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get sales r f q line
 *
 * @mcp read
 */
export const getSalesRFQLineTool = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesRFQLine(ctx.asCaller.supabase, input.lineId as never)
    );
  }
});

/**
 * Get sales r f q lines
 *
 * @mcp read
 */
export const getSalesRFQLinesTool = defineServiceFn({
  input: z.looseObject({ salesRfqId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesRFQLines(ctx.asCaller.supabase, input.salesRfqId as never)
    );
  }
});

/**
 * Insert customer contact
 *
 * @mcp
 */
export const insertCustomerContactTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    contact: z.looseObject({
      id: z.string().optional(),
      contactId: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      title: z.string().optional(),
      email: z.string().min(1).optional(),
      mobilePhone: z.string().optional(),
      homePhone: z.string().optional(),
      workPhone: z.string().optional(),
      notes: z.string().optional(),
      customerLocationId: z.string().optional()
    }),
    customerLocationId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertCustomerContact(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Insert customer location
 *
 * @mcp
 */
export const insertCustomerLocationTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
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
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertCustomerLocation(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Resolve price
 *
 * @mcp
 */
export const resolvePriceTool = defineServiceFn({
  input: z.looseObject({
    input: z.looseObject({
      customerId: z.string().optional(),
      customerTypeId: z.string().optional(),
      itemId: z.string(),
      itemPostingGroupId: z.string().optional(),
      quantity: z.number(),
      date: z.string().optional(),
      existingBasePrice: z.number().optional(),
      configuration: z.record(z.string(), z.unknown()).nullable().optional()
    })
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await resolvePrice(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input.input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Resolve price list
 *
 * @mcp
 */
export const resolvePriceListTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    customerId: z.string().optional(),
    customerTypeId: z.string().optional(),
    search: z.string().optional(),
    quantity: z.number().optional()
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await resolvePriceList(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get base catalog
 *
 * @mcp read
 */
export const getBaseCatalogTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getBaseCatalog(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Create a customer
 *
 * @remarks
 * Upsert customer
 *
 * @mcp
 */
export const upsertCustomerCreateTool = defineServiceFn({
  input: z.looseObject({
    readableId: z.string().optional(),
    name: z.string().min(1),
    customerStatusId: z.string().optional(),
    customerTypeId: z.string().optional(),
    accountManagerId: z.string().optional(),
    currencyCode: z.string().optional(),
    taxPercent: z.number().min(0).max(1),
    salesContactId: z.string().optional(),
    website: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertCustomer(
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
 * Update a customer
 *
 * @remarks
 * Upsert customer
 *
 * @mcp
 */
export const upsertCustomerUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      readableId: z.string().optional(),
      name: z.string().min(1),
      customerStatusId: z.string().optional(),
      customerTypeId: z.string().optional(),
      accountManagerId: z.string().optional(),
      currencyCode: z.string().optional(),
      taxPercent: z.number().min(0).max(1),
      salesContactId: z.string().optional(),
      website: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertCustomer(
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
 * Upsert customer item price override
 *
 * @mcp destructive
 */
export const upsertCustomerItemPriceOverrideTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    customerId: z.string().optional(),
    customerTypeId: z.string().optional(),
    itemId: z.string(),
    breaks: z.array(
      z.looseObject({
        id: z.string().optional(),
        quantity: z.number(),
        overridePrice: z.number(),
        active: z.boolean()
      })
    ),
    active: z.boolean(),
    applyRulesOnTop: z.boolean(),
    notes: z.string().optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertCustomerItemPriceOverride(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Delete customer item price override
 *
 * @mcp destructive
 */
export const deleteCustomerItemPriceOverrideTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteCustomerItemPriceOverride(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer item price override by id
 *
 * @mcp read
 */
export const getCustomerItemPriceOverrideByIdTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerItemPriceOverrideById(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Update customer contact
 *
 * @mcp
 */
export const updateCustomerContactTool = defineServiceFn({
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
      customerLocationId: z.string().optional()
    }),
    customerLocationId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateCustomerContact(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update customer location
 *
 * @mcp
 */
export const updateCustomerLocationTool = defineServiceFn({
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
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateCustomerLocation(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update customer payment
 *
 * @mcp
 */
export const updateCustomerPaymentTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string().min(1),
    invoiceCustomerId: z.string().optional(),
    invoiceCustomerLocationId: z.string().optional(),
    invoiceCustomerContactId: z.string().optional(),
    paymentTermId: z.string().optional()
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateCustomerPayment(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update customer shipping
 *
 * @mcp
 */
export const updateCustomerShippingTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string().min(1),
    shippingCustomerId: z.string().optional(),
    shippingCustomerLocationId: z.string().optional(),
    shippingCustomerContactId: z.string().optional(),
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
    incotermLocation: z.string().optional()
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateCustomerShipping(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update customer tax
 *
 * @mcp
 */
export const updateCustomerTaxTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string().min(1),
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
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateCustomerTax(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update pricing rule
 *
 * @mcp
 */
export const updatePricingRuleTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    data: z.looseObject({
      id: z.string().optional(),
      name: z.string().min(1).optional(),
      ruleType: z.enum(["Discount", "Markup", "Configuration"]).optional(),
      amountType: z.enum(["Percentage", "Fixed"]).optional(),
      amount: z.number().min(0).optional(),
      minQuantity: z.number().min(0).optional(),
      maxQuantity: z.number().min(0).optional(),
      customerIds: z.array(z.string()).optional(),
      customerTypeIds: z.array(z.string()).optional(),
      itemIds: z.array(z.string()).nullable().optional(),
      itemId: z.string().optional(),
      itemPostingGroupId: z.string().optional(),
      validFrom: z.string().optional(),
      validTo: z.string().optional(),
      priority: z.number().int().min(0).optional(),
      active: z.boolean().optional(),
      configurationPrices: z
        .array(
          z.looseObject({
            key: z.string().min(1),
            value: z.string().nullable(),
            amount: z.number(),
            label: z.string().optional()
          })
        )
        .optional()
    })
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updatePricingRule(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.auditUserId,
        stamp(ctx, input.data, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a customer status
 *
 * @remarks
 * Upsert customer status
 *
 * @mcp
 */
export const upsertCustomerStatusCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertCustomerStatus(
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
 * Update a customer status
 *
 * @remarks
 * Upsert customer status
 *
 * @mcp
 */
export const upsertCustomerStatusUpdateTool = defineServiceFn({
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
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertCustomerStatus(
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
 * Create a customer type
 *
 * @remarks
 * Upsert customer type
 *
 * @mcp
 */
export const upsertCustomerTypeCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertCustomerType(
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
 * Update a customer type
 *
 * @remarks
 * Upsert customer type
 *
 * @mcp
 */
export const upsertCustomerTypeUpdateTool = defineServiceFn({
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
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertCustomerType(
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
 * Create a no quote reason
 *
 * @remarks
 * Upsert no quote reason
 *
 * @mcp
 */
export const upsertNoQuoteReasonCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertNoQuoteReason(
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
 * Update a no quote reason
 *
 * @remarks
 * Upsert no quote reason
 *
 * @mcp
 */
export const upsertNoQuoteReasonUpdateTool = defineServiceFn({
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
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertNoQuoteReason(
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
 * Update quote exchange rate
 *
 * @mcp
 */
export const updateQuoteExchangeRateTool = defineServiceFn({
  input: z.looseObject({ id: z.string(), exchangeRate: z.number() }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateQuoteExchangeRate(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update quote line precision
 *
 * @mcp
 */
export const updateQuoteLinePrecisionTool = defineServiceFn({
  input: z.looseObject({
    quoteId: z.string(),
    lineId: z.string(),
    precision: z.number()
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updateQuoteLinePrecision(
        ctx.asSystem.pg,
        ctx.company.id,
        input.quoteId as never,
        input.lineId as never,
        input.precision as never
      )
    );
  }
});

/**
 * Update sales order exchange rate
 *
 * @mcp
 */
export const updateSalesOrderExchangeRateTool = defineServiceFn({
  input: z.looseObject({ id: z.string(), exchangeRate: z.number() }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateSalesOrderExchangeRate(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update quote material order
 *
 * @mcp
 */
export const updateQuoteMaterialOrderTool = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), order: z.number() }))
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelopes(
      ctx,
      await updateQuoteMaterialOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update quote operation order
 *
 * @mcp
 */
export const updateQuoteOperationOrderTool = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), order: z.number() }))
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelopes(
      ctx,
      await updateQuoteOperationOrder(
        ctx.asCaller.supabase,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Upsert make method from quote line
 *
 * @mcp
 */
export const upsertMakeMethodFromQuoteLineTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    quoteId: z.string(),
    quoteLineId: z.string(),
    parts: z
      .looseObject({
        billOfMaterial: z.boolean(),
        billOfProcess: z.boolean(),
        parameters: z.boolean(),
        tools: z.boolean(),
        steps: z.boolean(),
        workInstructions: z.boolean()
      })
      .optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMakeMethodFromQuoteLine(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * Upsert make method from quote method
 *
 * @mcp
 */
export const upsertMakeMethodFromQuoteMethodTool = defineServiceFn({
  input: z.looseObject({
    sourceId: z.string(),
    targetId: z.string(),
    parts: z
      .looseObject({
        billOfMaterial: z.boolean(),
        billOfProcess: z.boolean(),
        parameters: z.boolean(),
        tools: z.boolean(),
        steps: z.boolean(),
        workInstructions: z.boolean()
      })
      .optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertMakeMethodFromQuoteMethod(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * Create a new quote with all business logic - generates sequence, creates opportunity, resolves payment/shipping defaults from customer
 *
 * @remarks
 * Create a new quote with all business logic - generates sequence, creates opportunity, resolves payment/shipping defaults from customer. LLM can create a quote with just customerId.
 *
 * @mcp
 */
export const insertQuoteTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    quoteId: z.string().optional(),
    locationId: z.string().optional(),
    status: z
      .enum([
        "Draft",
        "Sent",
        "Ordered",
        "Partial",
        "Lost",
        "Cancelled",
        "Expired"
      ])
      .optional(),
    currencyCode: z.string().optional(),
    expirationDate: z.string().optional(),
    customerContactId: z.string().optional(),
    customerLocationId: z.string().optional(),
    customerEngineeringContactId: z.string().optional(),
    customerReference: z.string().optional(),
    salesPersonId: z.string().optional(),
    estimatorId: z.string().optional(),
    dueDate: z.string().optional(),
    opportunityId: z.string().optional(),
    notes: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertQuote(
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
 * Update quote line order
 *
 * @mcp
 */
export const updateQuoteLineOrderTool = defineServiceFn({
  input: z.looseObject({
    quoteId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updateQuoteLineOrder(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        input.quoteId as never,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Upsert quote line additional charges
 *
 * @mcp
 */
export const upsertQuoteLineAdditionalChargesTool = defineServiceFn({
  input: z.looseObject({
    lineId: z.string(),
    update: z.looseObject({
      additionalCharges: z.record(z.string(), z.unknown())
    })
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertQuoteLineAdditionalCharges(
        ctx.asCaller.supabase,
        input.lineId as never,
        stamp(ctx, input.update, [
          "companyId",
          "createdBy",
          "updatedBy"
        ]) as never
      )
    );
  }
});

/**
 * Upsert quote line prices
 *
 * @mcp destructive
 */
export const upsertQuoteLinePricesTool = defineServiceFn({
  input: z.looseObject({
    quoteId: z.string(),
    lineId: z.string(),
    quoteLinePrices: z.array(
      z.looseObject({
        quoteLineId: z.string(),
        unitPrice: z.number(),
        quantity: z.number(),
        leadTime: z.number().optional(),
        discountPercent: z.number().optional(),
        shippingCost: z.number().optional(),
        categoryMarkups: z.record(z.string(), z.unknown()).optional(),
        priceSource: z.enum(["system", "manual"]).optional(),
        priceTrace: z
          .array(
            z.looseObject({
              step: z.string(),
              source: z.string(),
              amount: z.number(),
              adjustment: z.number().optional(),
              ruleId: z.string().optional(),
              label: z.string().optional()
            })
          )
          .nullable()
          .optional()
      })
    )
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await upsertQuoteLinePrices(
        ctx.asSystem.pg,
        ctx.company.id,
        input.quoteId as never,
        input.lineId as never,
        stamp(ctx, input.quoteLinePrices, [
          "companyId",
          "createdBy",
          "updatedBy"
        ]) as never
      )
    );
  }
});

/**
 * Explains each quantity's price on a quote line
 *
 * @mcp read
 */
export const getQuoteLinePriceTracesTool = defineServiceFn({
  input: z.looseObject({ quoteId: z.string(), quoteLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getQuoteLinePriceTraces(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.quoteId as never,
        input.quoteLineId as never
      )
    );
  }
});

/**
 * Reprices a quote line's system rows to what today's rules give — the `currentTrace` getQuoteLinePriceTraces shows — storing that trace with the price
 *
 * @mcp
 */
export const repriceQuoteLineFromRulesTool = defineServiceFn({
  input: z.looseObject({ quoteId: z.string(), quoteLineId: z.string() }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await repriceQuoteLineFromRules(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        ctx.company.id,
        input.quoteId as never,
        input.quoteLineId as never,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Create a quote operation step
 *
 * @remarks
 * Upsert quote operation step
 *
 * @mcp
 */
export const upsertQuoteOperationStepCreateTool = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    type: z.enum([
      "Task",
      "Value",
      "Measurement",
      "Checkbox",
      "Timestamp",
      "Person",
      "List",
      "File",
      "Inspection"
    ]),
    unitOfMeasureCode: z.string().optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
    listValues: z.array(z.string()).optional(),
    sortOrder: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertQuoteOperationStep(
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
 * Update a quote operation step
 *
 * @remarks
 * Upsert quote operation step
 *
 * @mcp
 */
export const upsertQuoteOperationStepUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
      type: z.enum([
        "Task",
        "Value",
        "Measurement",
        "Checkbox",
        "Timestamp",
        "Person",
        "List",
        "File",
        "Inspection"
      ]),
      unitOfMeasureCode: z.string().optional(),
      minValue: z.number().nullable().optional(),
      maxValue: z.number().nullable().optional(),
      listValues: z.array(z.string()).optional(),
      sortOrder: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertQuoteOperationStep(
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
 * Create a quote operation parameter
 *
 * @remarks
 * Upsert quote operation parameter
 *
 * @mcp
 */
export const upsertQuoteOperationParameterCreateTool = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    key: z.string().min(1),
    value: z.string().min(1),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertQuoteOperationParameter(
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
 * Update a quote operation parameter
 *
 * @remarks
 * Upsert quote operation parameter
 *
 * @mcp
 */
export const upsertQuoteOperationParameterUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      key: z.string().min(1),
      value: z.string().min(1),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertQuoteOperationParameter(
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
 * Create a quote operation tool
 *
 * @remarks
 * Upsert quote operation tool
 *
 * @mcp
 */
export const upsertQuoteOperationToolCreateTool = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    toolId: z.string().min(1),
    quantity: z.number().min(0.000001),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertQuoteOperationTool(
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
 * Update a quote operation tool
 *
 * @remarks
 * Upsert quote operation tool
 *
 * @mcp
 */
export const upsertQuoteOperationToolUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      toolId: z.string().min(1),
      quantity: z.number().min(0.000001),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertQuoteOperationTool(
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
 * Upsert quote payment
 *
 * @mcp
 */
export const upsertQuotePaymentTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    invoiceCustomerId: z.string().optional(),
    invoiceCustomerLocationId: z.string().optional(),
    invoiceCustomerContactId: z.string().optional(),
    paymentTermId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertQuotePayment(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Upsert quote shipment
 *
 * @mcp
 */
export const upsertQuoteShipmentTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    locationId: z.string().optional(),
    shippingMethodId: z.string().optional(),
    receiptRequestedDate: z.string().optional(),
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
    incotermLocation: z.string().optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertQuoteShipment(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a new sales order with all business logic - generates sequence, creates opportunity, resolves payment/shipping defaults from customer
 *
 * @remarks
 * Create a new sales order with all business logic - generates sequence, creates opportunity, resolves payment/shipping defaults from customer. LLM can create a sales order with just customerId.
 *
 * @mcp
 */
export const insertSalesOrderTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    salesOrderId: z.string().optional(),
    locationId: z.string().optional(),
    status: z
      .enum([
        "Draft",
        "In Progress",
        "Needs Approval",
        "To Ship and Invoice",
        "To Ship",
        "To Invoice",
        "Completed",
        "Cancelled",
        "Closed"
      ])
      .optional(),
    currencyCode: z.string().optional(),
    orderDate: z.string().optional(),
    customerContactId: z.string().optional(),
    customerLocationId: z.string().optional(),
    quoteId: z.string().optional(),
    opportunityId: z.string().optional(),
    requestedDate: z.string().optional(),
    promisedDate: z.string().optional(),
    notes: z.string().optional(),
    customerReference: z.string().optional(),
    customerEngineeringContactId: z.string().optional(),
    salesPersonId: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertSalesOrder(
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
 * Upsert sales order shipment
 *
 * @mcp
 */
export const upsertSalesOrderShipmentTool = defineServiceFn({
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
    supplierId: z.string().optional(),
    supplierLocationId: z.string().optional(),
    shippingCost: z.number().optional(),
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
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSalesOrderShipment(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update sales order line order
 *
 * @mcp
 */
export const updateSalesOrderLineOrderTool = defineServiceFn({
  input: z.looseObject({
    salesOrderId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updateSalesOrderLineOrder(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        input.salesOrderId as never,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Upsert sales order payment
 *
 * @mcp
 */
export const upsertSalesOrderPaymentTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    invoiceCustomerId: z.string().optional(),
    invoiceCustomerLocationId: z.string().optional(),
    invoiceCustomerContactId: z.string().optional(),
    paymentTermId: z.string().optional(),
    paymentComplete: z.boolean().optional(),
    currencyCode: z
      .enum([
        "AFN",
        "AFA",
        "ALL",
        "ALK",
        "DZD",
        "ADP",
        "AOA",
        "AOK",
        "AON",
        "AOR",
        "ARA",
        "ARS",
        "ARM",
        "ARP",
        "ARL",
        "AMD",
        "AWG",
        "AUD",
        "ATS",
        "AZN",
        "AZM",
        "BSD",
        "BHD",
        "BDT",
        "BBD",
        "BYN",
        "BYB",
        "BYR",
        "BEF",
        "BEC",
        "BEL",
        "BZD",
        "BMD",
        "BTN",
        "BOB",
        "BOL",
        "BOV",
        "BOP",
        "BAM",
        "BAD",
        "BAN",
        "BWP",
        "BRC",
        "BRZ",
        "BRE",
        "BRR",
        "BRN",
        "BRB",
        "BRL",
        "GBP",
        "BND",
        "BGL",
        "BGN",
        "BGO",
        "BGM",
        "BUK",
        "BIF",
        "XPF",
        "KHR",
        "CAD",
        "CVE",
        "KYD",
        "XAF",
        "CLE",
        "CLP",
        "CLF",
        "CNX",
        "CNY",
        "CNH",
        "COP",
        "COU",
        "KMF",
        "CDF",
        "CRC",
        "HRD",
        "HRK",
        "CUC",
        "CUP",
        "CYP",
        "CZK",
        "CSK",
        "DKK",
        "DJF",
        "DOP",
        "NLG",
        "XCD",
        "DDM",
        "ECS",
        "ECV",
        "EGP",
        "GQE",
        "ERN",
        "EEK",
        "ETB",
        "EUR",
        "XBA",
        "XEU",
        "XBB",
        "XBC",
        "XBD",
        "FKP",
        "FJD",
        "FIM",
        "FRF",
        "XFO",
        "XFU",
        "GMD",
        "GEK",
        "GEL",
        "DEM",
        "GHS",
        "GHC",
        "GIP",
        "XAU",
        "GRD",
        "GTQ",
        "GWP",
        "GNF",
        "GNS",
        "GYD",
        "HTG",
        "HNL",
        "HKD",
        "HUF",
        "IMP",
        "ISK",
        "ISJ",
        "INR",
        "IDR",
        "IRR",
        "IQD",
        "IEP",
        "ILS",
        "ILP",
        "ILR",
        "ITL",
        "JMD",
        "JPY",
        "JOD",
        "KZT",
        "KES",
        "KWD",
        "KGS",
        "LAK",
        "LVL",
        "LVR",
        "LBP",
        "LSL",
        "LRD",
        "LYD",
        "LTL",
        "LTT",
        "LUL",
        "LUC",
        "LUF",
        "MOP",
        "MKD",
        "MKN",
        "MGA",
        "MGF",
        "MWK",
        "MYR",
        "MVR",
        "MVP",
        "MLF",
        "MTL",
        "MTP",
        "MRU",
        "MRO",
        "MUR",
        "MXV",
        "MXN",
        "MXP",
        "MDC",
        "MDL",
        "MCF",
        "MNT",
        "MAD",
        "MAF",
        "MZE",
        "MZN",
        "MZM",
        "MMK",
        "NAD",
        "NPR",
        "ANG",
        "TWD",
        "NZD",
        "NIO",
        "NIC",
        "NGN",
        "KPW",
        "NOK",
        "OMR",
        "PKR",
        "XPD",
        "PAB",
        "PGK",
        "PYG",
        "PEI",
        "PEN",
        "PES",
        "PHP",
        "XPT",
        "PLN",
        "PLZ",
        "PTE",
        "GWE",
        "QAR",
        "XRE",
        "RHD",
        "RON",
        "ROL",
        "RUB",
        "RUR",
        "RWF",
        "SVC",
        "WST",
        "SAR",
        "RSD",
        "CSD",
        "SCR",
        "SLL",
        "XAG",
        "SGD",
        "SKK",
        "SIT",
        "SBD",
        "SOS",
        "ZAR",
        "ZAL",
        "KRH",
        "KRW",
        "KRO",
        "SSP",
        "SUR",
        "ESP",
        "ESA",
        "ESB",
        "XDR",
        "LKR",
        "SHP",
        "XSU",
        "SDD",
        "SDG",
        "SDP",
        "SRD",
        "SRG",
        "SZL",
        "SEK",
        "CHF",
        "SYP",
        "STN",
        "STD",
        "TVD",
        "TJR",
        "TJS",
        "TZS",
        "XTS",
        "THB",
        "XXX",
        "TPE",
        "TOP",
        "TTD",
        "TND",
        "TRY",
        "TRL",
        "TMT",
        "TMM",
        "USD",
        "USN",
        "USS",
        "UGX",
        "UGS",
        "UAH",
        "UAK",
        "AED",
        "UYW",
        "UYU",
        "UYP",
        "UYI",
        "UZS",
        "VUV",
        "VES",
        "VEB",
        "VEF",
        "VND",
        "VNN",
        "CHE",
        "CHW",
        "XOF",
        "YDD",
        "YER",
        "YUN",
        "YUD",
        "YUM",
        "YUR",
        "ZWN",
        "ZRN",
        "ZRZ",
        "ZMW",
        "ZMK",
        "ZWD",
        "ZWR",
        "ZWL",
        "XUA"
      ])
      .optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSalesOrderPayment(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a sales rfq
 *
 * @remarks
 * Upsert sales r f q
 *
 * @mcp
 */
export const upsertSalesRFQCreateTool = defineServiceFn({
  input: z.looseObject({
    customerLocationId: z.string().optional(),
    customerContactId: z.string().optional(),
    customerEngineeringContactId: z.string().optional(),
    customerId: z.string().min(1),
    customerReference: z.string().optional(),
    expirationDate: z.string().optional(),
    externalNotes: z.string().optional(),
    internalNotes: z.string().optional(),
    locationId: z.string().optional(),
    rfqDate: z.string().min(1),
    status: z.enum(["Draft", "Ready for Quote", "Quoted", "Closed"]).optional(),
    salesPersonId: z.string().optional(),
    rfqId: z.string(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSalesRFQ(
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
 * Update a sales rfq
 *
 * @remarks
 * Upsert sales r f q
 *
 * @mcp
 */
export const upsertSalesRFQUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      customerLocationId: z.string().optional(),
      customerContactId: z.string().optional(),
      customerEngineeringContactId: z.string().optional(),
      customerId: z.string().min(1),
      customerReference: z.string().optional(),
      expirationDate: z.string().optional(),
      externalNotes: z.string().optional(),
      internalNotes: z.string().optional(),
      locationId: z.string().optional(),
      rfqDate: z.string().min(1),
      status: z
        .enum(["Draft", "Ready for Quote", "Quoted", "Closed"])
        .optional(),
      salesPersonId: z.string().optional(),
      rfqId: z.string(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSalesRFQ(
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
 * Create a sales rfqline
 *
 * @remarks
 * Upsert sales r f q line
 *
 * @mcp
 */
export const upsertSalesRFQLineCreateTool = defineServiceFn({
  input: z.looseObject({
    salesRfqId: z.string().min(1),
    customerPartId: z.string().min(1),
    customerPartRevision: z.string().optional(),
    itemId: z.string().optional(),
    description: z.string().optional(),
    quantity: z.array(z.number().min(0.00001)),
    unitOfMeasureCode: z.string().min(1),
    order: z.number().min(0),
    modelUploadId: z.string().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSalesRFQLine(
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
 * Update a sales rfqline
 *
 * @remarks
 * Upsert sales r f q line
 *
 * @mcp
 */
export const upsertSalesRFQLineUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      salesRfqId: z.string().min(1),
      customerPartId: z.string().min(1),
      customerPartRevision: z.string().optional(),
      itemId: z.string().optional(),
      description: z.string().optional(),
      quantity: z.array(z.number().min(0.00001)),
      unitOfMeasureCode: z.string().min(1),
      order: z.number().min(0),
      modelUploadId: z.string().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertSalesRFQLine(
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
 * Update sales r f q line order
 *
 * @mcp
 */
export const updateSalesRFQLineOrderTool = defineServiceFn({
  input: z.looseObject({
    salesRfqId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await updateSalesRFQLineOrder(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        input.salesRfqId as never,
        stamp(ctx, input.updates, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Get return reasons
 *
 * @mcp read
 */
export const getReturnReasonsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getReturnReasons(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get return reasons list
 *
 * @mcp read
 */
export const getReturnReasonsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return envelope(
      ctx,
      await getReturnReasonsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get return reason
 *
 * @mcp read
 */
export const getReturnReasonTool = defineServiceFn({
  input: z.looseObject({ returnReasonId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getReturnReason(
        ctx.asCaller.supabase,
        input.returnReasonId as never
      )
    );
  }
});

/**
 * Create a return reason
 *
 * @remarks
 * Upsert return reason
 *
 * @mcp
 */
export const upsertReturnReasonCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    inventoryValueZero: z.boolean().optional(),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertReturnReason(
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
 * Update a return reason
 *
 * @remarks
 * Upsert return reason
 *
 * @mcp
 */
export const upsertReturnReasonUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      inventoryValueZero: z.boolean().optional(),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertReturnReason(
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
 * Delete return reason
 *
 * @mcp destructive
 */
export const deleteReturnReasonTool = defineServiceFn({
  input: z.looseObject({ returnReasonId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteReturnReason(
        ctx.asCaller.supabase,
        input.returnReasonId as never
      )
    );
  }
});

/**
 * Get sales return orders
 *
 * @mcp read
 */
export const getSalesReturnOrdersTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    customerId: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getSalesReturnOrders(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get sales return order
 *
 * @mcp read
 */
export const getSalesReturnOrderTool = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesReturnOrder(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never
      )
    );
  }
});

/**
 * Get sales return order lines
 *
 * @mcp read
 */
export const getSalesReturnOrderLinesTool = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesReturnOrderLines(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get sales return order line
 *
 * @mcp read
 */
export const getSalesReturnOrderLineTool = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesReturnOrderLine(
        ctx.asCaller.supabase,
        input.lineId as never
      )
    );
  }
});

/**
 * Insert sales return order
 *
 * @mcp
 */
export const insertSalesReturnOrderTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    salesReturnOrderId: z.string().optional(),
    orderDate: z.string(),
    customerLocationId: z.string().optional(),
    customerContactId: z.string().optional(),
    customerReference: z.string().optional(),
    locationId: z.string().optional(),
    salesOrderId: z.string().optional(),
    currencyCode: z.string().optional(),
    expirationDate: z.string().optional(),
    assignee: z.string().optional(),
    customFields: z.unknown().optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertSalesReturnOrder(
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
 * Delete sales return order
 *
 * @mcp destructive
 */
export const deleteSalesReturnOrderTool = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSalesReturnOrder(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never
      )
    );
  }
});

/**
 * Delete sales return order line
 *
 * @mcp destructive
 */
export const deleteSalesReturnOrderLineTool = defineServiceFn({
  input: z.looseObject({ lineId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteSalesReturnOrderLine(
        ctx.asCaller.supabase,
        input.lineId as never
      )
    );
  }
});

/**
 * Get sales return order receipts
 *
 * @mcp read
 */
export const getSalesReturnOrderReceiptsTool = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesReturnOrderReceipts(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get sales return order credits
 *
 * @mcp read
 */
export const getSalesReturnOrderCreditsTool = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesReturnOrderCredits(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get sales return order issues
 *
 * @mcp read
 */
export const getSalesReturnOrderIssuesTool = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getSalesReturnOrderIssues(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Reopen an RMA to Draft so its lines can be edited again
 *
 * @mcp
 */
export const reopenSalesReturnOrderTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await reopenSalesReturnOrder(
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Cancel sales return order
 *
 * @mcp
 */
export const cancelSalesReturnOrderTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await cancelSalesReturnOrder(
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Short-close ("stop expecting") an RMA line — the shortClosePurchaseOrderLine mechanic
 *
 * @mcp
 */
export const shortCloseSalesReturnOrderLineTool = defineServiceFn({
  input: z.looseObject({
    lineId: z.string(),
    salesReturnOrderId: z.string(),
    intent: z.enum(["close", "reopen"])
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return plain(
      ctx,
      await shortCloseSalesReturnOrderLine(
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Returnable shipment lines for a customer, searched + paginated in the database via the get_returnable_shipment_lines RPC
 *
 * @mcp read
 */
export const getReturnableLinesForCustomerTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    args: z
      .looseObject({
        salesOrderId: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional()
      })
      .optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getReturnableLinesForCustomer(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.customerId as never,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Entity picker source for RMA lines: serials/batches shipped to this customer (Consumed entities tagged with a posted shipment's id — the attributes->>X query p…
 *
 * @mcp read
 */
export const getShippedTrackedEntitiesForCustomerTool = defineServiceFn({
  input: z.looseObject({ customerId: z.string(), itemId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getShippedTrackedEntitiesForCustomer(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.customerId as never,
        input.itemId as never
      )
    );
  }
});

/**
 * Per-line creditable pool = received − already credited
 *
 * @mcp read
 */
export const getCreditableQuantitiesTool = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCreditableQuantities(
        ctx.asCaller.supabase,
        input.salesReturnOrderId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Issue Credit: one AR memo (direction Credit, linked via memo.salesReturnOrderId) + per-line salesReturnOrderCreditLine breakdown
 *
 * @mcp
 */
export const createSalesReturnOrderCreditTool = defineServiceFn({
  input: z.looseObject({
    salesReturnOrderId: z.string(),
    memoDate: z.string(),
    lines: z.array(
      z.looseObject({
        salesReturnOrderLineId: z.string(),
        quantity: z.number()
      })
    )
  }),
  permission: { create: "invoicing" },
  async run(ctx, input) {
    return plain(
      ctx,
      await createSalesReturnOrderCredit(
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
 * Create Replacement Order: a draft sales order pre-filled from the RMA lines, priced via resolvePrice (user adjusts on the draft — e.g
 *
 * @mcp
 */
export const createReplacementSalesOrderTool = defineServiceFn({
  input: z.looseObject({ salesReturnOrderId: z.string() }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createReplacementSalesOrder(
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
 * Set an RMA line's disposition
 *
 * @mcp
 */
export const setSalesReturnOrderLineDispositionTool = defineServiceFn({
  input: z.looseObject({
    lineId: z.string(),
    disposition: z.enum([
      "Conditional Acceptance",
      "Deviation Accepted",
      "Hold",
      "No Action Required",
      "Pending",
      "Quarantine",
      "Repair",
      "Return to Supplier",
      "Rework",
      "Scrap",
      "Use As Is",
      "Return to Customer"
    ])
  }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await setSalesReturnOrderLineDisposition(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "updatedBy", "userId"]) as never
      )
    );
  }
});

/**
 * Create a presigned upload URL for an opportunity (quote/sales order/RFQ/sales invoice) document
 *
 * @mcp
 */
export const createOpportunityDocumentUploadUrlTool = defineServiceFn({
  input: z.looseObject({ opportunityId: z.string(), name: z.string() }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createOpportunityDocumentUploadUrl(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a presigned upload URL for an opportunity LINE document
 *
 * @mcp
 */
export const createOpportunityLineDocumentUploadUrlTool = defineServiceFn({
  input: z.looseObject({ lineId: z.string(), name: z.string() }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createOpportunityLineDocumentUploadUrl(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Get rental agreements
 *
 * @mcp read
 */
export const getRentalAgreementsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getRentalAgreements(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get rental agreement
 *
 * @mcp read
 */
export const getRentalAgreementTool = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRentalAgreement(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Only a Draft agreement can be deleted — an activated one has billing periods and possibly invoices; it is cancelled or closed instead
 *
 * @mcp destructive
 */
export const deleteRentalAgreementTool = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteRentalAgreement(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get rental agreement lines
 *
 * @mcp read
 */
export const getRentalAgreementLinesTool = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRentalAgreementLines(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get rental agreement line
 *
 * @mcp read
 */
export const getRentalAgreementLineTool = defineServiceFn({
  input: z.looseObject({ rentalAgreementLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRentalAgreementLine(
        ctx.asCaller.supabase,
        input.rentalAgreementLineId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Create a rental agreement line
 *
 * @remarks
 * The line's item and serial always come from its fleet unit, never the form, so a line cannot name one unit and bill another's rates
 *
 * @mcp
 */
export const upsertRentalAgreementLineCreateTool = defineServiceFn({
  input: z.looseObject({
    rentalAgreementId: z.string().min(1),
    fixedAssetId: z.string().min(1),
    rateUnit: z.enum(["Day", "Week", "Month"]),
    rate: z.number().min(0).optional(),
    fairValue: z.number().min(0).optional(),
    economicLifeMonths: z.number().int().gt(0).optional(),
    guaranteedResidualValue: z.number().min(0).optional(),
    unguaranteedResidualValue: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertRentalAgreementLine(
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
 * Update a rental agreement line
 *
 * @remarks
 * The line's item and serial always come from its fleet unit, never the form, so a line cannot name one unit and bill another's rates
 *
 * @mcp
 */
export const upsertRentalAgreementLineUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      rentalAgreementId: z.string().min(1),
      fixedAssetId: z.string().min(1),
      rateUnit: z.enum(["Day", "Week", "Month"]),
      rate: z.number().min(0).optional(),
      fairValue: z.number().min(0).optional(),
      economicLifeMonths: z.number().int().gt(0).optional(),
      guaranteedResidualValue: z.number().min(0).optional(),
      unguaranteedResidualValue: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertRentalAgreementLine(
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
 * Only from a Draft agreement — an activated line has billing periods behind it; return the unit or cancel the agreement instead
 *
 * @mcp destructive
 */
export const deleteRentalAgreementLineTool = defineServiceFn({
  input: z.looseObject({ rentalAgreementLineId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteRentalAgreementLine(
        ctx.asCaller.supabase,
        input.rentalAgreementLineId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Every charge on the agreement's lines, with the line's fleet unit
 *
 * @mcp read
 */
export const getRentalAgreementChargesTool = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRentalAgreementCharges(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Create a rental agreement charge
 *
 * @remarks
 * A variable charge (damage, delivery, overage) on one unit of an open agreement
 *
 * @mcp
 */
export const upsertRentalAgreementChargeCreateTool = defineServiceFn({
  input: z.looseObject({
    rentalAgreementLineId: z.string().min(1),
    chargeDate: z.string().min(1),
    description: z.string().min(1),
    amount: z.number(),
    taxPercent: z.number().min(0).max(1),
    invoiceSeparately: z.boolean().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertRentalAgreementCharge(
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
 * Update a rental agreement charge
 *
 * @remarks
 * A variable charge (damage, delivery, overage) on one unit of an open agreement
 *
 * @mcp
 */
export const upsertRentalAgreementChargeUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      rentalAgreementLineId: z.string().min(1),
      chargeDate: z.string().min(1),
      description: z.string().min(1),
      amount: z.number(),
      taxPercent: z.number().min(0).max(1),
      invoiceSeparately: z.boolean().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertRentalAgreementCharge(
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
 * A charge that has been invoiced stays — void or delete the invoice first — and only an open (Draft or Active) agreement's charges can be removed
 *
 * @mcp destructive
 */
export const deleteRentalAgreementChargeTool = defineServiceFn({
  input: z.looseObject({ rentalAgreementChargeId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteRentalAgreementCharge(
        ctx.asCaller.supabase,
        input.rentalAgreementChargeId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Every billing period of the agreement's lines, oldest first
 *
 * @mcp read
 */
export const getRentalBillingPeriodsTool = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRentalBillingPeriods(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Fleet units free to put on a new line
 *
 * @mcp read
 */
export const getRentableFleetAssetsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "sales" },
  async run(ctx) {
    return envelope(
      ctx,
      await getRentableFleetAssets(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get item rental rate
 *
 * @mcp read
 */
export const getItemRentalRateTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string(), currencyCode: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getItemRentalRate(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id,
        input.currencyCode as never
      )
    );
  }
});

/**
 * One ladder per item and currency: an existing row is replaced in place
 *
 * @mcp
 */
export const upsertItemRentalRateTool = defineServiceFn({
  input: z.looseObject({
    itemId: z.string().min(1),
    currencyCode: z.string().min(1),
    dayRate: z.number().min(0).optional(),
    weekRate: z.number().min(0).optional(),
    monthRate: z.number().min(0).optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertItemRentalRate(
        ctx.asCaller.supabase,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * The rate each item starts at on a rental line for this customer, per frequency — the customer's own rate, else its customer type's, else the item's (`defaultRe…
 *
 * @mcp read
 */
export const getDefaultRentalRatesTool = defineServiceFn({
  input: z.looseObject({
    customerId: z.string(),
    currencyCode: z.string(),
    asOf: z.string(),
    itemIds: z.array(z.string())
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getDefaultRentalRates(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get customer item rental rates
 *
 * @mcp read
 */
export const getCustomerItemRentalRatesTool = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerItemRentalRates(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get customer item rental rate
 *
 * @mcp read
 */
export const getCustomerItemRentalRateTool = defineServiceFn({
  input: z.looseObject({ customerItemRentalRateId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerItemRentalRate(
        ctx.asCaller.supabase,
        input.customerItemRentalRateId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * One row per customer (or customer type), item and currency — a second row for the same scope is refused by the unique index (23505)
 *
 * @mcp
 */
export const upsertCustomerItemRentalRateTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    itemId: z.string().min(1),
    currencyCode: z.string().min(1),
    customerId: z.string().optional(),
    customerTypeId: z.string().optional(),
    dayRate: z.number().min(0).optional(),
    weekRate: z.number().min(0).optional(),
    monthRate: z.number().min(0).optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
    notes: z.string().optional()
  }),
  permission: { create: "sales", update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertCustomerItemRentalRate(
        ctx.asCaller.supabase,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * Delete customer item rental rate
 *
 * @mcp destructive
 */
export const deleteCustomerItemRentalRateTool = defineServiceFn({
  input: z.looseObject({ customerItemRentalRateId: z.string() }),
  permission: { delete: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteCustomerItemRentalRate(
        ctx.asCaller.supabase,
        input.customerItemRentalRateId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Customer payments held against the agreement — deposits and refunds
 *
 * @mcp read
 */
export const getRentalAgreementDepositsTool = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRentalAgreementDeposits(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get rental agreement related documents
 *
 * @mcp read
 */
export const getRentalAgreementRelatedDocumentsTool = defineServiceFn({
  input: z.looseObject({ rentalAgreementId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRentalAgreementRelatedDocuments(
        ctx.asCaller.supabase,
        input.rentalAgreementId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Lists contracts with their customer, value invoiced to date and next invoice date
 *
 * @mcp read
 */
export const getContractsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getContracts(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Gets one contract with its customer, value invoiced to date and next invoice date
 *
 * @mcp read
 */
export const getContractTool = defineServiceFn({
  input: z.looseObject({ customerContractId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getContract(
        ctx.asCaller.supabase,
        input.customerContractId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Lists a contract's lines with their service items
 *
 * @mcp read
 */
export const getContractLinesTool = defineServiceFn({
  input: z.looseObject({ customerContractId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getContractLines(
        ctx.asCaller.supabase,
        input.customerContractId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Gets one contract line with its service item
 *
 * @mcp read
 */
export const getContractLineTool = defineServiceFn({
  input: z.looseObject({ customerContractLineId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getContractLine(
        ctx.asCaller.supabase,
        input.customerContractLineId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Gets a contract's persisted invoice schedule: planned invoices with their lines, and the cancellation credits that sit on a memo instead of an invoice
 *
 * @mcp read
 */
export const getContractInvoiceScheduleTool = defineServiceFn({
  input: z.looseObject({ customerContractId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getContractInvoiceSchedule(
        ctx.asCaller.supabase,
        input.customerContractId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Lists a contract's amendments, oldest first, with the lines each one added or replaced
 *
 * @mcp read
 */
export const getContractAmendmentsTool = defineServiceFn({
  input: z.looseObject({ customerContractId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getContractAmendments(
        ctx.asCaller.supabase,
        input.customerContractId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Lists the statuses of a customer's contracts, from which a new contract's type is suggested
 *
 * @mcp read
 */
export const getCustomerContractStatusesTool = defineServiceFn({
  input: z.looseObject({ customerId: z.string() }),
  permission: { view: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCustomerContractStatuses(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.customerId as never
      )
    );
  }
});

/**
 * Create a contract line
 *
 * @remarks
 * Adds or changes a line on a Draft contract; the item must be a Service item
 *
 * @mcp
 */
export const upsertContractLineCreateTool = defineServiceFn({
  input: z.looseObject({
    customerContractId: z.string().min(1),
    revenueType: z.enum(["One-time", "Recurring"]),
    itemId: z.string().min(1),
    description: z.string().optional(),
    quantity: z.number().gt(0),
    rate: z.number().min(0),
    rateUnit: z.enum(["Day", "Week", "Month", "Quarter", "Year"]).optional(),
    discountPercent: z.number().min(0).max(100),
    discountEndsOn: z.string().optional(),
    taxPercent: z.number().min(0).max(100),
    startDate: z.string().min(1),
    endDate: z.string().optional(),
    goLiveDate: z.string().optional(),
    revenueMethod: z.enum(["Daily", "Even Period"]),
    revenueStartDate: z.string().optional(),
    revenueEndDate: z.string().optional(),
    projectId: z.string().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertContractLine(
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
 * Update a contract line
 *
 * @remarks
 * Adds or changes a line on a Draft contract; the item must be a Service item
 *
 * @mcp
 */
export const upsertContractLineUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      customerContractId: z.string().min(1),
      revenueType: z.enum(["One-time", "Recurring"]),
      itemId: z.string().min(1),
      description: z.string().optional(),
      quantity: z.number().gt(0),
      rate: z.number().min(0),
      rateUnit: z.enum(["Day", "Week", "Month", "Quarter", "Year"]).optional(),
      discountPercent: z.number().min(0).max(100),
      discountEndsOn: z.string().optional(),
      taxPercent: z.number().min(0).max(100),
      startDate: z.string().min(1),
      endDate: z.string().optional(),
      goLiveDate: z.string().optional(),
      revenueMethod: z.enum(["Daily", "Even Period"]),
      revenueStartDate: z.string().optional(),
      revenueEndDate: z.string().optional(),
      projectId: z.string().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "sales" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertContractLine(
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
