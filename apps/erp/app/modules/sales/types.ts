import type { Database } from "@carbon/database";
import type { jobStatus } from "../production/production.models";
import type { QuantityEffect } from "../shared";
import type {
  getCustomer,
  getCustomerContacts,
  getCustomerLocations,
  getCustomers,
  getCustomerStatuses,
  getCustomerTypes,
  getHistoricalQuoteLinePricesByItemId,
  getNoQuoteReasons,
  getOpportunity,
  getQuoteLinePrices,
  getQuoteLines,
  getQuoteMakeMethod,
  getQuoteMaterials,
  getQuoteMethodTrees,
  getQuoteOperation,
  getQuotePayment,
  getQuotes,
  getQuoteShipment,
  getSalesOrderLines,
  getSalesOrderLineShipments,
  getSalesOrderRelatedItems,
  getSalesOrders,
  getSalesRFQLines,
  getSalesRFQs,
} from "./sales.service";

export type Costs = {
  consumableCost: number;
  laborCost: number;
  laborHours: number;
  machineHours: number;
  machineCost: number;
  materialCost: number;
  overheadCost: number;
  outsideCost: number;
  partCost: number;
  serviceCost: number;
  setupHours: number;
  toolCost: number;
};

export type CostEffects = {
  consumableCost: QuantityEffect[];
  laborCost: QuantityEffect[];
  laborHours: QuantityEffect[];
  machineHours: QuantityEffect[];
  machineCost: QuantityEffect[];
  materialCost: QuantityEffect[];
  outsideCost: QuantityEffect[];
  overheadCost: QuantityEffect[];
  partCost: QuantityEffect[];
  serviceCost: QuantityEffect[];
  setupHours: QuantityEffect[];
  toolCost: QuantityEffect[];
};

export type Customer = NonNullable<
  Awaited<ReturnType<typeof getCustomers>>["data"]
>[number];

export type CustomerContact = NonNullable<
  Awaited<ReturnType<typeof getCustomerContacts>>["data"]
>[number];

export type CustomerDetail = NonNullable<
  Awaited<ReturnType<typeof getCustomer>>["data"]
>;

export type CustomerLocation = NonNullable<
  Awaited<ReturnType<typeof getCustomerLocations>>["data"]
>[number];

export type CustomerStatus = NonNullable<
  Awaited<ReturnType<typeof getCustomerStatuses>>["data"]
>[number];

export type CustomerType = NonNullable<
  Awaited<ReturnType<typeof getCustomerTypes>>["data"]
>[number];

export type NoQuoteReason = NonNullable<
  Awaited<ReturnType<typeof getNoQuoteReasons>>["data"]
>[number];

export type Opportunity = NonNullable<
  Awaited<ReturnType<typeof getOpportunity>>["data"]
>;

export type QuoteMethod = NonNullable<
  Awaited<ReturnType<typeof getQuoteMethodTrees>>["data"]
>[number]["data"];

export type QuotationMakeMethod = NonNullable<
  Awaited<ReturnType<typeof getQuoteMakeMethod>>["data"]
>;

export type Quotation = NonNullable<
  Awaited<ReturnType<typeof getQuotes>>["data"]
>[number];

export type QuotationLine = NonNullable<
  Awaited<ReturnType<typeof getQuoteLines>>["data"]
>[number];

export type QuotationMaterial = NonNullable<
  Awaited<ReturnType<typeof getQuoteMaterials>>["data"]
>[number];

export type QuotationOperation = NonNullable<
  Awaited<ReturnType<typeof getQuoteOperation>>["data"]
>;

export type QuotationPrice = NonNullable<
  Awaited<ReturnType<typeof getQuoteLinePrices>>["data"]
>[number];

export type HistoricalQuotationPrice = NonNullable<
  Awaited<ReturnType<typeof getHistoricalQuoteLinePricesByItemId>>["data"]
>[number];

export type QuotationStatusType = Database["public"]["Enums"]["quoteStatus"];

export type QuotationPayment = NonNullable<
  Awaited<ReturnType<typeof getQuotePayment>>["data"]
>;

export type QuotationShipment = NonNullable<
  Awaited<ReturnType<typeof getQuoteShipment>>["data"]
>;

export type SalesOrder = NonNullable<
  Awaited<ReturnType<typeof getSalesOrders>>["data"]
>[number];

export type SalesOrderJob = {
  id: string;
  jobId: string;
  status: (typeof jobStatus)[number];
  dueDate?: string;
  salesOrderLineId: string;
  productionQuantity: number;
  quantityComplete: number;
  assignee: string;
};

export type SalesOrderLine = NonNullable<
  Awaited<ReturnType<typeof getSalesOrderLines>>["data"]
>[number];

export type SalesOrderLineShipment = NonNullable<
  Awaited<ReturnType<typeof getSalesOrderLineShipments>>["data"]
>[number];

export type SalesOrderLineType = Omit<
  Database["public"]["Enums"]["salesOrderLineType"],
  "Service"
>;

export type SalesOrderStatus = Database["public"]["Enums"]["salesOrderStatus"];

export type SalesOrderTransactionType =
  Database["public"]["Enums"]["salesOrderTransactionType"];

export type SalesOrderRelatedItems = Awaited<
  ReturnType<typeof getSalesOrderRelatedItems>
>;

export type SalesRFQ = NonNullable<
  Awaited<ReturnType<typeof getSalesRFQs>>["data"]
>[number];

export type SalesRFQLine = NonNullable<
  Awaited<ReturnType<typeof getSalesRFQLines>>["data"]
>[number];

export type SalesRFQStatusType = Database["public"]["Enums"]["salesRfqStatus"];
