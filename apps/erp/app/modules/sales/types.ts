import type { Database } from "@carbon/database";
import type { jobStatus } from "../production/production.models";
import type { QuantityEffect } from "../shared";
import type {
  getCustomer,
  getCustomerContacts,
  getCustomerLocations,
  getCustomerStatuses,
  getCustomers,
  getCustomerTypes,
  getNoQuoteReasons,
  getOpportunity,
  getPricingRule,
  getPricingRules,
  getQuoteLinePrices,
  getQuoteLines,
  getQuoteMakeMethod,
  getQuoteMaterials,
  getQuoteMethodTrees,
  getQuoteOperation,
  getQuotePayment,
  getQuoteShipment,
  getQuotes,
  getRelatedPricesForQuoteLine,
  getSalesOrderLineShipments,
  getSalesOrderLines,
  getSalesOrderRelatedItems,
  getSalesOrders,
  getSalesRFQLines,
  getSalesRFQs,
  priceSourceTypes
} from "./sales.service";

// Pricing types
export type MatchedRule = {
  id: string;
  name: string;
  ruleType: string;
  amountType: string;
  amount: number;
  priority: number;
};

export type PriceOverrideBreak = {
  id?: string;
  quantity: number;
  overridePrice: number;
  active: boolean;
};

export type OverrideEntry = {
  id: string;
  quantity: number;
  overridePrice: number;
  notes: string | null;
  validFrom: string | null;
  validTo: string | null;
  applyRulesOnTop: boolean;
};

export type PriceListRow = {
  itemId: string;
  partId: string;
  itemName: string;
  itemPostingGroupId: string | null;
  thumbnailPath: string | null;
  basePrice: number;
  resolvedPrice: number;
  isOverridden: boolean;
  source: PriceSource;
  trace: PriceTraceStep[];
  overrideId: string | null;
  overrideQuantity: number | null;
  overrideNotes: string | null;
  overrideValidFrom: string | null;
  overrideValidTo: string | null;
};

export type PriceListResult = {
  data: PriceListRow[];
  count: number;
};

export type PriceResolutionInput = {
  customerId?: string;
  customerTypeId?: string;
  itemId: string;
  itemPostingGroupId?: string;
  quantity: number;
  date?: string;
  existingBasePrice?: number;
};

export type PriceResolutionResult = {
  finalPrice: number;
  basePrice: number;
  trace: PriceTraceStep[];
};

export type PriceSource = (typeof priceSourceTypes)[number];

export type PriceTraceStep = {
  step: string;
  source: string;
  amount: number;
  adjustment?: number;
  ruleId?: string;
};

export type PricingRule = NonNullable<
  Awaited<ReturnType<typeof getPricingRules>>["data"]
>[number];

export type PricingRuleDetail = NonNullable<
  Awaited<ReturnType<typeof getPricingRule>>["data"]
>;

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

// The `X`/`XListItem` pairs below are deliberately separate: `X` is the full
// view row that detail screens read, `XListItem` is exactly what the list
// query selects. Defining `X` from the list getter is what broke ~250 call
// sites when the list selects were narrowed.
export type Quotation = Database["public"]["Views"]["quotes"]["Row"];

export type QuotationListItem = NonNullable<
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
  NonNullable<
    Awaited<ReturnType<typeof getRelatedPricesForQuoteLine>>
  >["historicalQuoteLinePrices"]
>[number];

export type QuotationStatusType = Database["public"]["Enums"]["quoteStatus"];

export type QuotationPayment = NonNullable<
  Awaited<ReturnType<typeof getQuotePayment>>["data"]
>;

export type QuotationShipment = NonNullable<
  Awaited<ReturnType<typeof getQuoteShipment>>["data"]
>;

export type SalesOrder = Database["public"]["Views"]["salesOrders"]["Row"];

export type SalesOrderListItem = NonNullable<
  Awaited<ReturnType<typeof getSalesOrders>>["data"]
>[number];

export type SalesOrderJob = {
  id: string;
  jobId: string;
  status: (typeof jobStatus)[number];
  dueDate?: string;
  salesOrderLineId: string;
  quantity: number;
  scrapQuantity: number;
  productionQuantity: number;
  quantityComplete: number;
  quantityShipped: number;
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
