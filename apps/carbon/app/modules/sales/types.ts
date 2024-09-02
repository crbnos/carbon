import type { Database } from "@carbon/database";
import type { QuantityEffect } from "../shared";
import type {
  getCustomer,
  getCustomerContacts,
  getCustomerLocations,
  getCustomers,
  getCustomerStatuses,
  getCustomerTypes,
  getQuoteDocuments,
  getQuoteLinePrices,
  getQuoteLines,
  getQuoteMakeMethod,
  getQuoteMaterials,
  getQuoteMethodTrees,
  getQuoteOperation,
  getQuotePayment,
  getQuotes,
  getQuoteShipment,
  getSalesOrderExternalDocuments,
  getSalesOrderLines,
  getSalesOrders,
  getSalesRFQLines,
  getSalesRFQs,
} from "./sales.service";

export type Costs = {
  consumableCost: number;
  fixtureCost: number;
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
  fixtureCost: QuantityEffect[];
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

export type QuoteMethod = NonNullable<
  Awaited<ReturnType<typeof getQuoteMethodTrees>>["data"]
>[number]["data"];

export type QuotationMakeMethod = NonNullable<
  Awaited<ReturnType<typeof getQuoteMakeMethod>>["data"]
>;

export type QuotationAttachment = NonNullable<
  Awaited<ReturnType<typeof getQuoteDocuments>>["data"]
>[number];

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

// TODO: we should just use the FileObject type from supabase
export type SalesOrderAttachment = NonNullable<
  Awaited<ReturnType<typeof getSalesOrderExternalDocuments>>["data"]
>[number];

export type SalesOrderLine = NonNullable<
  Awaited<ReturnType<typeof getSalesOrderLines>>["data"]
>[number];

export type SalesOrderLineType =
  Database["public"]["Enums"]["salesOrderLineType"];

export type SalesOrderStatus = Database["public"]["Enums"]["salesOrderStatus"];

export type SalesOrderTransactionType =
  Database["public"]["Enums"]["salesOrderTransactionType"];

export type SalesRFQ = NonNullable<
  Awaited<ReturnType<typeof getSalesRFQs>>["data"]
>[number];

export type SalesRFQLine = NonNullable<
  Awaited<ReturnType<typeof getSalesRFQLines>>["data"]
>[number];

export type SalesRFQStatusType = Database["public"]["Enums"]["salesRfqStatus"];
