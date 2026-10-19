// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

export const SALES_PAGES = [
  {
    id: "sales.customers",
    label: "Customers",
    maxLevel: "Full",
    // ponytail: address has no column that tells a customer's row from a
    // supplier's, so Customers owns it and Suppliers reads it.
    tables: [
      "customer",
      "customerAccount",
      "customerContact",
      "customerLocation",
      "customerPayment",
      "customerShipping",
      "customerTax",
      "address",
      "contact"
    ],
    where: { table: "contact", column: "isCustomer", value: "true" },
    readers: ["paymentTerm"],
    paths: ["/x/sales/customers", "/x/customer/"]
  },
  {
    id: "sales.portals",
    label: "Portals",
    maxLevel: "Full",
    tables: ["externalLink"],
    paths: ["/x/sales/customer-portals"]
  },
  {
    id: "sales.rfqs",
    label: "RFQs",
    maxLevel: "Full",
    tables: ["salesRfq", "salesRfqLine"],
    paths: ["/x/sales/rfqs", "/x/sales-rfq/"]
  },
  {
    id: "sales.quotes",
    label: "Quotes",
    maxLevel: "Full",
    tables: [
      "quote",
      "quoteLine",
      "quoteLinePrice",
      "quoteMakeMethod",
      "quoteMaterial",
      "quoteMaterialStep",
      "quoteOperation",
      "quoteOperationParameter",
      "quoteOperationStep",
      "quoteOperationStepSlide",
      "quoteOperationTool",
      "quoteOperationToolStep",
      "quotePayment",
      "quoteShipment",
      "opportunity"
    ],
    readers: [
      "customer",
      "customerPartToItem",
      "itemCost",
      "itemUnitSalePrice",
      "paymentTerm",
      "supplierProcess",
      "terms"
    ],
    paths: ["/x/sales/quotes", "/x/quote/"]
  },
  {
    id: "sales.salesOrders",
    label: "Sales Orders",
    maxLevel: "Full",
    tables: [
      "salesOrder",
      "salesOrderLine",
      "salesOrderPayment",
      "salesOrderShipment",
      "salesOrderStatusHistory",
      "salesOrderTransaction",
      "fulfillment"
    ],
    readers: [
      "customer",
      "customerPartToItem",
      "itemCost",
      "itemUnitSalePrice",
      "opportunity",
      "paymentTerm",
      "quote",
      "shipment",
      "shipmentLine",
      "terms"
    ],
    paths: ["/x/sales/orders", "/x/sales-order/"]
  },
  {
    id: "sales.returns",
    label: "Returns",
    maxLevel: "Full",
    tables: [
      "salesReturnOrder",
      "salesReturnOrderLine",
      "salesReturnOrderLineTrackedEntity"
    ],
    paths: ["/x/sales/rmas", "/x/sales-return-order/"]
  },
  {
    id: "sales.serviceContracts",
    label: "Service Contracts",
    maxLevel: "Full",
    tables: [
      "customerContract",
      "customerContractAmendment",
      "customerContractInvoice",
      "customerContractInvoiceLine",
      "customerContractLedgerEntry",
      "customerContractLine",
      "customerContractRevenue"
    ],
    paths: ["/x/sales/contracts", "/x/contract/"]
  },
  {
    id: "sales.rentalAgreements",
    label: "Rental Agreements",
    maxLevel: "Full",
    tables: [
      "rentalAgreement",
      "rentalAgreementCharge",
      "rentalAgreementLine",
      "rentalBillingPeriod",
      "rentalLeaseScheduleLine",
      "itemRentalRate",
      "customerItemRentalRate"
    ],
    paths: ["/x/sales/rental-agreements", "/x/rental-agreement/"]
  },
  {
    id: "sales.priceLists",
    label: "Price Lists",
    maxLevel: "Full",
    tables: ["customerItemPriceOverride", "customerItemPriceOverrideBreak"],
    readers: ["itemUnitSalePrice"],
    paths: ["/x/sales/price-list"]
  },
  {
    id: "sales.pricingRules",
    label: "Pricing Rules",
    maxLevel: "Full",
    tables: ["pricingRule"],
    paths: ["/x/sales/pricing-rules"]
  },
  {
    id: "sales.salesRules",
    label: "Sales Rules",
    maxLevel: "Full",
    tables: ["enforcementRule"],
    where: { table: "enforcementRule", column: "family", value: "sales" },
    children: [
      { table: "enforcementRuleItemAssignment", via: "ruleId" },
      { table: "enforcementRuleAcknowledgment", via: "ruleId" }
    ],
    paths: ["/x/sales/sales-rules"]
  },
  {
    id: "sales.noQuoteReasons",
    label: "No Quote Reasons",
    maxLevel: "Full",
    tables: ["noQuoteReason"],
    paths: ["/x/sales/no-quote-reasons"]
  },
  {
    id: "sales.returnReasons",
    label: "Return Reasons",
    maxLevel: "Full",
    tables: ["returnReason"],
    paths: ["/x/sales/return-reasons"]
  },
  {
    id: "sales.statuses",
    label: "Statuses",
    maxLevel: "Full",
    tables: ["customerStatus"],
    paths: ["/x/sales/customer-statuses"]
  },
  {
    id: "sales.types",
    label: "Types",
    maxLevel: "Full",
    tables: ["customerType"],
    paths: ["/x/sales/customer-types"]
  }
] as const satisfies readonly Page[];
