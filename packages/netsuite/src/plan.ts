/**
 * The migration plan — the ONE intermediate representation between NetSuite and
 * Carbon.
 *
 * Extraction produces NetSuite-shaped records; mapping turns them into this;
 * loading writes this into Carbon. Nothing downstream of `map/` ever sees a
 * NetSuite field name, and nothing upstream of the loader ever sees a Kysely
 * client. That split is what makes the whole pipeline unit-testable without a
 * NetSuite account or a database — and it is why the mapping decisions (which
 * NetSuite item type becomes which Carbon item type, which order statuses are
 * in scope) are all in one reviewable place.
 *
 * Every entity carries `externalId`, the NetSuite internal id. The loader writes
 * it to `externalIntegrationMapping` so a re-run updates rather than duplicates,
 * and so a migrated record can be traced back to its NetSuite origin forever.
 *
 * Names, not ids, are how plan entities reference each other's LOOKUPS (payment
 * term, shipping method, unit of measure, item type). Carbon mints its own ids at
 * load time, so a plan that carried Carbon ids would be unloadable; a plan that
 * carried NetSuite ids would force every lookup through the mapping table twice.
 * Entity-to-entity references (an order line's item, an order's customer) use the
 * NetSuite external id, which the loader resolves through the map it is building.
 */

/** Carbon's `itemType` enum. */
export type CarbonItemType =
  | "Part"
  | "Material"
  | "Tool"
  | "Service"
  | "Consumable"
  | "Fixture";

/** Carbon's `itemTrackingType` enum. */
export type CarbonItemTrackingType =
  | "Inventory"
  | "Non-Inventory"
  | "Serial"
  | "Batch";

/** Carbon's `itemReplenishmentSystem` enum. */
export type CarbonReplenishmentSystem = "Buy" | "Make" | "Buy and Make";

/** Carbon's `methodType` enum. */
export type CarbonMethodType =
  | "Purchase to Order"
  | "Pull from Inventory"
  | "Make to Order";

/** Carbon's `glAccountClass` enum. */
export type CarbonAccountClass =
  | "Asset"
  | "Liability"
  | "Equity"
  | "Revenue"
  | "Expense";

/** Carbon's `glIncomeBalance` enum. */
export type CarbonIncomeBalance = "Balance Sheet" | "Income Statement";

/** Carbon's `accountType` enum — the subset a NetSuite account type can become. */
export type CarbonAccountType =
  | "Bank"
  | "Cash"
  | "Accounts Receivable"
  | "Accounts Payable"
  | "Inventory"
  | "Fixed Asset"
  | "Accumulated Depreciation"
  | "Other Current Asset"
  | "Other Asset"
  | "Other Current Liability"
  | "Long Term Liability"
  | "Equity - No Close"
  | "Equity - Close"
  | "Retained Earnings"
  | "Income"
  | "Cost of Goods Sold"
  | "Expense"
  | "Other Income"
  | "Other Expense"
  | "Tax"
  | "Investments";

export type PlanAddress = {
  /** NetSuite `addressbook` line id, when it has one. */
  externalId: string | null;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  /** ISO-3166 alpha-2, upper case. NetSuite's `_unitedStates` forms are normalized in the mapper. */
  countryCode: string | null;
  isDefaultBilling: boolean;
  isDefaultShipping: boolean;
};

export type PlanContact = {
  externalId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  title: string | null;
  workPhone: string | null;
  mobilePhone: string | null;
  /** Matches the `name` of one of the party's addresses, when NetSuite records one. */
  addressName: string | null;
};

export type PlanNamedLookup = {
  externalId: string;
  name: string;
};

export type PlanCurrency = {
  externalId: string;
  code: string;
  name: string;
  /** NetSuite exposes `currencyPrecision`; Carbon stores `decimalPlaces`. */
  decimalPlaces: number;
  active: boolean;
};

export type PlanUnitOfMeasure = {
  externalId: string;
  /** Carbon's `unitOfMeasure.code` — unique per company, so the mapper de-duplicates. */
  code: string;
  name: string;
};

export type PlanPaymentTerm = {
  externalId: string;
  name: string;
  daysDue: number;
  daysDiscount: number;
  discountPercentage: number;
  /**
   * Carbon's `paymentTermCalculationMethod`. NetSuite's "Due on the Nth of the
   * month" terms become `Day of Month`; its net terms become `Net`.
   */
  calculationMethod: "Net" | "End of Month" | "Day of Month";
};

export type PlanShippingMethod = {
  externalId: string;
  name: string;
  /** Carbon's `shippingCarrier`; anything unrecognized lands on `Other`. */
  carrier: "UPS" | "FedEx" | "USPS" | "DHL" | "Other";
};

export type PlanLocation = {
  externalId: string;
  name: string;
  code: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvince: string | null;
  postalCode: string;
  countryCode: string | null;
};

export type PlanDepartment = {
  externalId: string;
  name: string;
  parentExternalId: string | null;
};

export type PlanAccount = {
  externalId: string;
  /** NetSuite `acctnumber`. Null for accounts the customer never numbered. */
  number: string | null;
  name: string;
  class: CarbonAccountClass;
  incomeBalance: CarbonIncomeBalance;
  accountType: CarbonAccountType | null;
  isGroup: boolean;
  parentExternalId: string | null;
  active: boolean;
};

export type PlanCustomer = {
  externalId: string;
  name: string;
  /** NetSuite `entityid` — preserved as Carbon's `readableId` so the number the customer knows survives. */
  readableId: string | null;
  phone: string | null;
  fax: string | null;
  website: string | null;
  currencyCode: string | null;
  taxPercent: number;
  taxId: string | null;
  typeName: string | null;
  /** One of Carbon's seeded `customerStatus` names. */
  statusName: string | null;
  paymentTermName: string | null;
  shippingMethodName: string | null;
  addresses: PlanAddress[];
  contacts: PlanContact[];
};

export type PlanSupplier = {
  externalId: string;
  name: string;
  readableId: string | null;
  phone: string | null;
  fax: string | null;
  website: string | null;
  currencyCode: string | null;
  taxId: string | null;
  typeName: string | null;
  /** Carbon's `supplierStatusType` enum. */
  status: "Active" | "Inactive" | "Pending" | "Rejected";
  paymentTermName: string | null;
  shippingMethodName: string | null;
  addresses: PlanAddress[];
  contacts: PlanContact[];
};

export type PlanItem = {
  externalId: string;
  /** Carbon's `readableId` — NetSuite's `itemid`. */
  readableId: string;
  revision: string;
  name: string;
  description: string | null;
  type: CarbonItemType;
  itemTrackingType: CarbonItemTrackingType;
  replenishmentSystem: CarbonReplenishmentSystem;
  defaultMethodType: CarbonMethodType;
  unitOfMeasureCode: string;
  purchasingUnitOfMeasureCode: string | null;
  salesUnitOfMeasureCode: string | null;
  /** NetSuite `cost` / `averagecost` / `lastpurchaseprice`, whichever the mapper chose. */
  unitCost: number | null;
  standardCost: number | null;
  /** Base-price-level price. */
  unitSalePrice: number | null;
  leadTime: number | null;
  mpn: string | null;
  active: boolean;
  /** NetSuite's source record type, e.g. `assemblyItem` — kept for the run report. */
  sourceRecordType: string;
};

export type PlanSupplierPart = {
  externalId: string;
  itemExternalId: string;
  supplierExternalId: string;
  supplierPartId: string | null;
  unitPrice: number | null;
  conversionFactor: number;
  minimumOrderQuantity: number | null;
};

export type PlanBillOfMaterialLine = {
  componentItemExternalId: string;
  quantity: number;
  order: number;
  /** NetSuite's component scrap rate, as a 0–1 fraction. */
  scrapPercentage: number | null;
};

export type PlanBillOfMaterial = {
  /** The NetSuite `bom` / `bomRevision` internal id, for traceability. */
  externalId: string;
  parentItemExternalId: string;
  lines: PlanBillOfMaterialLine[];
};

export type PlanOpeningStock = {
  itemExternalId: string;
  locationExternalId: string | null;
  quantity: number;
  /** NetSuite's per-location average cost, used only in the run report. */
  unitCost: number | null;
};

export type PlanSalesOrderLine = {
  externalId: string;
  itemExternalId: string | null;
  description: string | null;
  quantity: number;
  quantityShipped: number;
  unitPrice: number | null;
  unitOfMeasureCode: string | null;
  promisedDate: string | null;
  taxPercent: number;
  /** A NetSuite line with no item (a description or discount line) becomes a Comment line. */
  isComment: boolean;
};

export type PlanSalesOrder = {
  externalId: string;
  /** NetSuite `tranid` — kept as Carbon's `salesOrderId`. */
  salesOrderId: string;
  customerExternalId: string;
  customerReference: string | null;
  currencyCode: string | null;
  exchangeRate: number | null;
  orderDate: string | null;
  locationExternalId: string | null;
  shippingMethodName: string | null;
  paymentTermName: string | null;
  lines: PlanSalesOrderLine[];
};

export type PlanPurchaseOrderLine = {
  externalId: string;
  itemExternalId: string | null;
  description: string | null;
  quantity: number;
  quantityReceived: number;
  unitPrice: number | null;
  unitOfMeasureCode: string | null;
  promisedDate: string | null;
  isComment: boolean;
};

export type PlanPurchaseOrder = {
  externalId: string;
  purchaseOrderId: string;
  supplierExternalId: string;
  supplierReference: string | null;
  currencyCode: string | null;
  exchangeRate: number | null;
  orderDate: string | null;
  locationExternalId: string | null;
  shippingMethodName: string | null;
  paymentTermName: string | null;
  lines: PlanPurchaseOrderLine[];
};

/**
 * What a migration will write, in dependency order. The loader walks these
 * fields in exactly the order they are declared here; a field added out of order
 * is a load-time foreign-key failure, so treat the declaration order as the
 * contract it is.
 */
export type MigrationPlan = {
  source: {
    system: "netsuite";
    accountId: string;
    extractedAt: string;
    /** True when the account is a NetSuite sandbox — surfaced in the UI so nobody migrates test data by accident. */
    sandbox: boolean;
  };
  currencies: PlanCurrency[];
  unitsOfMeasure: PlanUnitOfMeasure[];
  paymentTerms: PlanPaymentTerm[];
  shippingMethods: PlanShippingMethod[];
  locations: PlanLocation[];
  departments: PlanDepartment[];
  accounts: PlanAccount[];
  customerTypes: PlanNamedLookup[];
  supplierTypes: PlanNamedLookup[];
  customers: PlanCustomer[];
  suppliers: PlanSupplier[];
  items: PlanItem[];
  supplierParts: PlanSupplierPart[];
  billsOfMaterial: PlanBillOfMaterial[];
  openingStock: PlanOpeningStock[];
  salesOrders: PlanSalesOrder[];
  purchaseOrders: PlanPurchaseOrder[];
};

/** The plan's entity collections, in load order. Shared by the loader and the UI's preview. */
export const PLAN_SECTIONS = [
  "currencies",
  "unitsOfMeasure",
  "paymentTerms",
  "shippingMethods",
  "locations",
  "departments",
  "accounts",
  "customerTypes",
  "supplierTypes",
  "customers",
  "suppliers",
  "items",
  "supplierParts",
  "billsOfMaterial",
  "openingStock",
  "salesOrders",
  "purchaseOrders"
] as const;

export type PlanSection = (typeof PLAN_SECTIONS)[number];

export function emptyPlan(source: MigrationPlan["source"]): MigrationPlan {
  return {
    source,
    currencies: [],
    unitsOfMeasure: [],
    paymentTerms: [],
    shippingMethods: [],
    locations: [],
    departments: [],
    accounts: [],
    customerTypes: [],
    supplierTypes: [],
    customers: [],
    suppliers: [],
    items: [],
    supplierParts: [],
    billsOfMaterial: [],
    openingStock: [],
    salesOrders: [],
    purchaseOrders: []
  };
}

/** Row counts per section — what the preview screen and the run report show. */
export function planCounts(plan: MigrationPlan): Record<PlanSection, number> {
  const counts = {} as Record<PlanSection, number>;
  for (const section of PLAN_SECTIONS) counts[section] = plan[section].length;
  return counts;
}
