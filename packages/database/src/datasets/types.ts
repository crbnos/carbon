import type { CalendarDate } from "@internationalized/date";
import type { PoolClient } from "pg";
import { maybeOne, one } from "./sql.ts";

/** Signed days relative to the dataset anchor. Negative = in the past. */
export type DayOffset = number;

/** `time` is a UTC "HH:MM:SS". */
export type InstantSpec = { offset: DayOffset; time: string };

export type ProcedureStepSpec = {
  name: string;
  /** Timestamp / File / Inspection collect their payload in MES at runtime, so the row needs no upload. */
  type:
    | "Task"
    | "Checkbox"
    | "Measurement"
    | "Value"
    | "List"
    | "Person"
    | "Timestamp"
    | "File"
    | "Inspection";
  instruction: string;
  required?: boolean;
  unitOfMeasureCode?: string;
  minValue?: number;
  maxValue?: number;
  listValues?: string[];
  fileTypes?: string[];
};

export type ProcedureSpec = {
  name: string;
  process: string;
  description: string;
  /** Written on every version — a new version copies them. */
  parameters?: { key: string; value: string }[];
  versions: Array<{
    version: number;
    status: "Draft" | "Active" | "Archived";
    steps: ProcedureStepSpec[];
  }>;
};

export type ProcessSpec = {
  name: string;
  /** process.defaultStandardFactor, e.g. "Minutes/Piece". */
  factor: string;
  /** process.processType, e.g. "Process" | "Assembly" | "Inspection". */
  type: string;
};

export type WorkCenterSpec = {
  name: string;
  dept: string;
  ability: string;
  laborRate: number;
  machineRate: number;
};

export type CustomerSpec = {
  name: string;
  type: string;
  status: string;
  phone: string;
  website: string;
  /** Must be a currency bootstrap seeds. Defaults to "USD". */
  currencyCode?: string;
  /** Defaults to Net 30. */
  paymentTerm?: string;
};

export type SupplierSpec = {
  name: string;
  type: string;
  phone: string;
  website: string;
  /** Omitted = Active, written explicitly (the column has no default). */
  status?: "Active" | "Inactive" | "Pending" | "Rejected";
  /** Must be a currency bootstrap seeds. Defaults to "USD". */
  currencyCode?: string;
  /** Defaults to Net 30. */
  paymentTerm?: string;
};

export type ContactSpec = {
  firstName: string;
  lastName: string;
  email: string;
  title: string;
};

export type CustomerContactSpec = ContactSpec & { customer: string };

export type SupplierContactSpec = ContactSpec & { supplier: string };

export type SupplierProcessSpec = {
  supplier: string;
  process: string;
};

export type PartnerSpec = {
  /** A supplier with a supplierContact — its supplierLocation is the partner id. */
  supplier: string;
  ability: string;
  hoursPerWeek: number;
};

export type ContractorSpec = {
  firstName: string;
  lastName: string;
  email: string;
  ability: string;
};

export type ShiftSpec = {
  name: string;
  /** "HH:MM:SS", plant-local wall clock. */
  startTime: string;
  endTime: string;
  monday?: boolean;
  tuesday?: boolean;
  wednesday?: boolean;
  thursday?: boolean;
  friday?: boolean;
  saturday?: boolean;
  sunday?: boolean;
};

export type EmployeeJobSpec = {
  title: string;
  department: string;
  /** Also written as the user's employeeShift. */
  shift: string;
  startDateOffset: DayOffset;
};

export type PlantSpec = {
  name: string;
  addressLine1: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  countryCode: string;
  timezone: string;
};

export type WarehouseSpec = {
  /** ctx.refs.warehouses key, and what ShelfSpec.warehouse references. */
  key: string;
  name: string;
  requiresPick?: boolean;
  requiresPutAway?: boolean;
  requiresBin?: boolean;
};

export type ShelfSpec = {
  /** The exact string openingStock[].shelf and the inventory count reference. */
  name: string;
  /** WarehouseSpec.key this shelf lives in. */
  warehouse: string;
  /** One of FoundationData.storageTypes. */
  storageType: string;
  /** Another ShelfSpec.name this nests under, for racking rows. */
  parent?: string;
};

export type PrinterRouteSpec = {
  name: string;
  format: string;
  printerUrl: string;
};

export type ContractorAgencySpec = {
  name: string;
  /** One of FoundationData.supplierTypes. */
  type: string;
  phone: string;
};

export type HolidaySpec = {
  name: string;
  /** Positive and distinct — holiday is UNIQUE (date, companyId). */
  dateOffset: DayOffset;
};

export type TagSpec = {
  name: string;
  table: string;
};

/** Children name parents in THIS spec, never global rows, so validation needs no database. */
export type MaterialTaxonomySpec = {
  substances: { name: string; code: string }[];
  forms: { name: string; code: string }[];
  types: { name: string; code: string; substance: string; form: string }[];
  grades: { name: string; substance: string }[];
  finishes: { name: string; substance: string }[];
  dimensions: { name: string; form: string; isMetric?: boolean }[];
};

export type FoundationData = {
  departments: string[];
  abilities: string[];
  processes: ProcessSpec[];
  workCenters: WorkCenterSpec[];
  /** Maintenance only (no shift, process or operations) — the ERP's maintenance lists open at HQ. */
  hqWorkCenter: WorkCenterSpec;
  customers: CustomerSpec[];
  customerContacts: CustomerContactSpec[];
  suppliers: SupplierSpec[];
  supplierContacts: SupplierContactSpec[];
  supplierProcesses: SupplierProcessSpec[];
  procedures: ProcedureSpec[];
  shippingMethods: string[];
  shippingTerms: string[];
  itemPostingGroups: string[];
  workCenterProcessLinks: Array<[string, string]>;
  customerTypes: string[];
  supplierTypes: string[];
  costCenters: string[];
  noQuoteReasons: string[];
  contractors: ContractorSpec[];
  partners: PartnerSpec[];
  plant: PlantSpec;
  /** Created at the plant, where every work center lives. */
  shifts: ShiftSpec[];
  /** [work center, shift] — every work center needs at least one. */
  workCenterShifts: Array<[string, string]>;
  employeeJob: EmployeeJobSpec;
  warehouses: WarehouseSpec[];
  storageTypes: string[];
  /** Insertion order matters — a parent shelf must precede its children. */
  shelves: ShelfSpec[];
  printerRoute: PrinterRouteSpec | null;
  holidays: HolidaySpec[];
  tags: TagSpec[];
  materialTaxonomy: MaterialTaxonomySpec;
  /** Must be one of shippingMethods; applied to every customer and supplier. */
  defaultShippingMethod: string;
  contractorAgency: ContractorAgencySpec | null;
  /** Billing address used for every customer and supplier location. */
  partyAddressCity: string;
  partyAddressStateProvince: string;
  partyAddressPostalCode: string;
  partyAddressCountryCode: string;
};

export type ItemType =
  | "Part"
  | "Material"
  | "Tool"
  | "Consumable"
  | "Service"
  | "Fixture";

/** Names resolve against the dataset's own taxonomy, never the global bootstrap rows. */
export type MaterialClassificationSpec = {
  substance?: string;
  form?: string;
  materialType?: string;
  grade?: string;
  finish?: string;
  dimension?: string;
};

export type ItemSpec = {
  readableId: string;
  revision?: string;
  name: string;
  type: ItemType;
  replenishment?: "Buy" | "Make" | "Buy and Make";
  defaultMethodType?:
    | "Pull from Inventory"
    | "Purchase to Order"
    | "Make to Order";
  trackingType?: "Inventory" | "Non-Inventory" | "Serial" | "Batch";
  unitOfMeasureCode?: string;
  standardCost?: number;
  unitSalePrice?: number;
  leadTime?: number;
  description?: string;
  /** Revision ladders seed inactive rungs. */
  active?: boolean;
  revisionStatus?: "Design" | "Prototype" | "Production" | "Obsolete";
  material?: MaterialClassificationSpec;
};

export type MethodType =
  | "Make to Order"
  | "Pull from Inventory"
  | "Purchase to Order";

export type OperationType =
  | "Process"
  | "Assembly"
  | "Inspection"
  | "Outside Processing";

export type SupplierLinkSpec = {
  supplier: string;
  item: string;
  price: number;
  leadTime: number;
};

export type BomLineSpec = {
  /** readableId of the component item; resolved through ctx.refs.items */
  component: string;
  quantity: number;
  order: number;
  methodType?: MethodType;
  kit?: boolean;
};

export type BopOperationSpec = {
  /** key into ctx.refs.processes */
  process: string;
  /** key into ctx.refs.workCenters */
  workCenter?: string;
  description: string;
  order: number;
  laborTime?: number;
  laborUnit?: string;
  setupTime?: number;
  machineTime?: number;
  operationType?: OperationType;
  /** key into ctx.refs.misc, e.g. "sp:AstroMill Machining:Outside Processing" */
  supplierProcess?: string;
  operationLeadTime?: number;
  operationUnitCost?: number;
  /** key into ctx.refs.misc, e.g. "procedure:TVAC Qualification Test" */
  procedure?: string;
  tools?: { tool: string; quantity: number }[];
  parameters?: { key: string; value: string }[];
  /** Required on (and only on) an "Inspection" operation. */
  inspectionPlan?: string;
};

export type MakeMethodSpec = {
  /** readableId of the make part this method belongs to */
  readableId: string;
  bom: BomLineSpec[];
  bop: BopOperationSpec[];
};

/**
 * The predecessor needs opening stock so "Consume First" is demoable; the successor
 * must stay out of every BOM — job creation and picking redirect to it live.
 */
export type SupersessionSpec = {
  predecessor: string;
  successor: string;
  mode: "Consume First" | "Prefer New" | "Stock Only" | "No Stock";
  /** 1 old = N new. Default 1. */
  conversionFactor?: number;
  successorEffectivityOffset?: DayOffset;
  discontinuationOffset?: DayOffset;
};

export type CustomerPartSpec = {
  item: string;
  customer: string;
  customerPartId: string;
  customerRevision?: string;
};

export type PriceOverrideSpec = {
  item: string;
  customer: string;
  breaks: { quantity: number; overridePrice: number }[];
  notes?: string;
};

/** No customer, customer type or item = every sale. */
export type PricingRuleSpec = {
  name: string;
  ruleType: "Discount" | "Markup";
  amountType: "Percentage" | "Fixed";
  /** Percent (0–100] for Percentage; a per-unit amount for Fixed. */
  amount: number;
  customer?: string;
  customerType?: string;
  items?: string[];
  minQuantity?: number;
  priority?: number;
};

export type ConfigurationParameterSpec = {
  key: string;
  label: string;
  dataType: "numeric" | "list" | "boolean";
  /** Required when dataType is "list". */
  listOptions?: string[];
};

/** The app keys a rule `${field}:${methodRowId}`, so the tier resolves the row. */
export type ConfigurationRuleSpec = {
  /** `operation` is a 1-based BOP position. */
  target: { component: string } | { operation: number };
  field: "quantity" | "methodType" | "laborTime" | "setupTime" | "machineTime";
  /** Body of `configure(params)`; reads only this configuration's parameter keys. */
  code: string;
};

export type ConfigurationSpec = {
  item: string;
  group: string;
  parameters: ConfigurationParameterSpec[];
  rules: ConfigurationRuleSpec[];
};

export type RuleOperator =
  | "eq"
  | "neq"
  | "in"
  | "notIn"
  | "isSet"
  | "isNotSet"
  | "gt"
  | "lt";

/** The object forms resolve to ids when the tier runs. */
export type RuleConditionValue =
  | string
  | number
  | boolean
  | string[]
  | { storageType: string }
  | { customerTypes: string[] }
  | { location: "Plant" | "HQ" };

/** Conditions state what must hold: the rule fires when they do NOT (and when a field is unset). */
export type EnforcementRuleSpec = {
  name: string;
  description?: string;
  message: string;
  severity: "error" | "warn";
  match: "all" | "any" | "none";
  conditions: { field: string; op: RuleOperator; value?: RuleConditionValue }[];
} & (
  | {
      family: "sales";
      surfaces: ("quoteLine" | "salesOrderLine" | "salesInvoiceLine")[];
      items: string[];
    }
  | {
      family: "storage";
      targetType: "item";
      surfaces: (
        | "receipt"
        | "shipment"
        | "stockTransfer"
        | "warehouseTransfer"
        | "inventoryAdjustment"
        | "place"
        | "pick"
      )[];
      items: string[];
    }
  | {
      family: "storage";
      targetType: "workCenter";
      surfaces: (
        | "operationStart"
        | "operationFinish"
        | "materialIssue"
        | "materialReceive"
      )[];
      workCenters: string[];
    }
);

/** The new revisions are not registered in ctx.refs.items — later tiers keep the active one. */
export type RevisionLadderSpec = {
  item: string;
  /** Must differ from the active revision. */
  obsoleteRevision: string;
  nextRevision: string;
  nextStatus: "Design" | "Prototype";
};

/**
 * The BOP picker lists only plans whose partId is the item, so the receipt plans
 * of quality.inspections cannot serve an operation.
 */
export type InspectionPlanSpec = {
  key: string;
  item: string;
  drawingNumber: string;
  aql: number;
  features: InspectionFeatureSpec[];
};

export type ItemsData = {
  buyParts: ItemSpec[];
  materials: ItemSpec[];
  consumables: ItemSpec[];
  tools: ItemSpec[];
  services: ItemSpec[];
  makeParts: ItemSpec[];
  methods: MakeMethodSpec[];
  supplierLinks: SupplierLinkSpec[];
  /** Exactly one Consume First pair between two BUY parts per dataset. */
  supersessions: SupersessionSpec[];
  customerParts: CustomerPartSpec[];
  priceOverrides: PriceOverrideSpec[];
  pricingRules: PricingRuleSpec[];
  configuration: ConfigurationSpec;
  revisionLadder: RevisionLadderSpec[];
  inspectionPlans: InspectionPlanSpec[];
  enforcementRules: EnforcementRuleSpec[];
  batchProperties: BatchPropertySpec[];
  /**
   * Animated 3D work instructions built on a bundled CAD assembly, linked to
   * its item's Assembly operation before the method is released. Optional: a
   * dataset with no industryId has nowhere to resolve the model from.
   */
  assembly?: AssemblySpec;
};

/** sortOrder follows the item's authoring order. */
export type BatchPropertySpec = {
  item: string;
  label: string;
  dataType: "text" | "numeric" | "boolean" | "list" | "date";
  /** Required exactly when dataType is "list". */
  listOptions?: string[];
};

export type OpeningStockSpec = {
  item: string;
  qty: number;
  shelf: string;
};

export type TrackedStockSpec = {
  item: string;
  entities: Array<{
    readableId: string;
    quantity: number;
    /** Omitted = "Available". */
    status?: "Available" | "On Hold" | "Rejected" | "Scrapped";
    /**
     * Required iff "Scrapped": books a full-entity scrap (Scrap activity plus a
     * Negative Adjmt. ledger row out of `shelf`); the entity keeps its quantity.
     */
    scrap?: {
      /** Must hold the lot's opening stock. */
      shelf: string;
      reason: string;
      dateOffset: DayOffset;
      comment: string;
    };
    /** Batch items with a shelfLives spec only (validator-enforced). */
    expiresOffset?: DayOffset;
  }>;
};

/** The item must be Batch-tracked (expiry is per lot). */
export type ShelfLifeSpec = {
  item: string;
  days: number;
};

export type KanbanItemSpec = {
  item: string;
  qty: number;
  /** Omitted = "Buy". */
  replenishmentSystem?: "Buy" | "Make" | "Transfer";
  /** Required when Buy. */
  supplier?: string;
  /** Transfer kanbans only, with toShelf. */
  fromShelf?: string;
  toShelf?: string;
};

export type InventoryCountLineSpec = {
  item: string;
  shelf: string;
  /**
   * inventoryCountLine.systemQuantity. On a Posted count it must equal the
   * (item, shelf) openingStock — the snapshot IS the opening balance.
   */
  snapshotQuantity: number;
  countedQuantity: number;
};

export type InventoryCountSpec = {
  /** Registered in ctx.refs.documents as `ic:<key>`. */
  key: string;
  status: "Draft" | "Posted";
  notes: string;
  /**
   * Required when Posted; dates the header and variance ledger rows. Must precede
   * every completed transfer so the snapshot still equals opening stock.
   */
  postedOffset?: DayOffset;
  /**
   * Draft writes bare item/shelf lines (the app snapshots later); Posted writes
   * full lines plus one adjustment ledger row per variance, as post-inventory-count.
   */
  lines: InventoryCountLineSpec[];
};

/** Untracked items only — tracked moves need per-entity splits the seed does not model. */
export type StockTransferSpec = {
  /** Registered in ctx.refs.documents as `st:<key>`. */
  key: string;
  status: "Draft" | "Released" | "Completed";
  fromShelf: string;
  toShelf: string;
  dateOffset: DayOffset;
  lines: { item: string; quantity: number }[];
};

/** Completed writes a shelfless Transfer Receipt — HQ has no bins, and the app does the same. */
export type WarehouseTransferSpec = {
  /** Registered in ctx.refs.documents as `wt:<key>`. */
  key: string;
  status: "Draft" | "To Ship" | "Completed";
  fromLocation: "Plant" | "HQ";
  toLocation: "Plant" | "HQ";
  dateOffset: DayOffset;
  lines: {
    item: string;
    quantity: number;
    /** Required when Completed. */
    fromShelf?: string;
  }[];
};

export type InventoryData = {
  openingStock: OpeningStockSpec[];
  onHandTracked: TrackedStockSpec[];
  kanbanItems: KanbanItemSpec[];
  inventoryCounts: InventoryCountSpec[];
  /** One Fixed Duration shelf life per dataset, paired with an expiring lot. */
  shelfLives: ShelfLifeSpec[];
  stockTransfers: StockTransferSpec[];
  warehouseTransfers: WarehouseTransferSpec[];
};

// The stored columns on quoteLinePrice — every net* and converted* column is
// GENERATED ALWAYS from these.
export type PriceBreak = {
  quantity: number;
  unitPrice: number;
  leadTime: number;
  discountPercent?: number;
  shippingCost?: number;
};

export type SalesRfqLineSpec = {
  /** ctx.refs.items key. */
  item: string;
  customerPartId: string;
  quantity: number[];
  order: number;
};

export type SalesRfqSpec = {
  /** ctx.refs.documents key this RFQ is stored under. */
  ref: string;
  status: string;
  rfqDateOffset: DayOffset;
  expirationOffset?: DayOffset;
  externalNotes: string;
  /** The column lives on the RFQ. Pair with "Closed". */
  noQuoteReason?: string;
  assignee?: "self";
  lines: SalesRfqLineSpec[];
};

export type SalesQuoteLineSpec = {
  /** ctx.refs.documents key this quote line is stored under. */
  ref: string;
  item: string;
  status: string;
  sortOrder: number;
  /** Also supplies quoteLine.quantity — the two have to stay in step. */
  priceBreaks: readonly PriceBreak[];
  configuration?: Record<string, string | number | boolean>;
};

export type SalesQuoteExternalLinkSpec = {
  /** ctx.refs.documents key this link is stored under. */
  ref: string;
  expiresOffset: DayOffset;
};

export type SalesQuoteSpec = {
  /** ctx.refs.documents key this quote is stored under. */
  ref: string;
  status: string;
  /** quote.createdAt (09:30 UTC); the KPI chart buckets quotes by it. */
  createdOffset?: DayOffset;
  expirationOffset?: DayOffset;
  externalNotes?: string;
  assignee?: "self";
  lines: SalesQuoteLineSpec[];
  externalLink?: SalesQuoteExternalLinkSpec;
};

export type SalesOrderLineSpec = {
  /** ctx.refs.documents key this order line is stored under. */
  ref: string;
  item: string;
  saleQuantity: number;
  unitPrice: number;
  status: string;
  promisedDateOffset?: DayOffset;
  sortOrder?: number;
  /** Extra seed log line, for orders whose lines are the interesting part. */
  log?: string;
};

export type SalesOrderSpec = {
  /** ctx.refs.documents key this order is stored under. */
  ref: string;
  status: string;
  orderDateOffset: DayOffset;
  assignee?: "self";
  lines: SalesOrderLineSpec[];
};

export type ShipmentSpec = {
  /** ctx.refs.documents key this shipment is stored under. */
  ref: string;
  status: string;
  /**
   * Required when Posted; dates the header and ledger. Posted mirrors post-shipment:
   * one Sales Shipment ledger row per line from its fromShelf. Voided writes none.
   */
  postedOffset?: DayOffset;
  lines: {
    /** ctx.refs.items key — also selects which order line the shipment covers. */
    item: string;
    orderQuantity: number;
    outstandingQuantity: number;
    shippedQuantity: number;
    unitPrice: number;
    /** Required (untracked, stocked item) on a Posted line with shippedQuantity > 0. */
    fromShelf?: string;
  }[];
};

export type SalesInvoiceSpec = {
  /** ctx.refs.documents key this invoice is stored under. */
  ref: string;
  /** Registered in ctx.refs.misc as `sinv:<key>` so payments can settle it. */
  key?: string;
  status: string;
  subtotal: number;
  totalAmount: number;
  dateIssuedOffset: DayOffset;
  dueDateOffset?: DayOffset;
  lines: {
    /** ctx.refs.items key — also selects which order line the invoice covers. */
    item: string;
    quantity: number;
    unitPrice: number;
  }[];
};

export type SalesOpportunitySpec = {
  log: string;
  /** ctx.refs.documents key this opportunity is stored under. */
  ref: string;
  /** ctx.refs.customers key; the location is ctx.refs.misc[`cloc:${customer}`]. */
  customer: string;
  rfq?: SalesRfqSpec;
  quote?: SalesQuoteSpec;
  order?: SalesOrderSpec;
  shipment?: ShipmentSpec;
  invoice?: SalesInvoiceSpec;
};

export type SalesStatusOrderSpec = {
  key: string;
  customer: string;
  item: string;
  status: string;
  lineStatus: string;
  orderDateOffset: DayOffset;
  unitPrice: number;
};

export type StaggeredDeliverySpec = {
  key: string;
  promisedDateOffset: DayOffset;
  sortOrder: number;
};

export type SalesReturnLineSpec = {
  item: string;
  quantity: number;
  unitPrice: number;
  /** Required when Completed — the receipt books stock back onto it. */
  toShelf?: string;
};

/**
 * Mirrors "Issue Credit": amount = Σ qty × unit price (no restock fee). Completed
 * returns only — the app caps credit at what was received / shipped.
 */
export type ReturnCreditSpec = {
  /** Draft is what Issue Credit leaves; Posted adds post-memo's stamps. */
  status: "Draft" | "Posted";
  /** On/after the return's dateOffset. */
  dateOffset: DayOffset;
  /** `line` is the 1-based return line number. */
  lines: { line: number; quantity: number }[];
};

/**
 * RMA. Completed mirrors post-receipt's Sales Return Order branch (Posted receipt
 * plus one ledger row per line). Line ids are registered as `rmaline:<key>:<n>`.
 */
export type SalesReturnSpec = {
  /** Registered in ctx.refs.documents as `rma:<key>`. */
  key: string;
  status: "Draft" | "To Receive" | "Completed";
  customer: string;
  /** Applied to every line (the column is per-line). */
  returnReason: string;
  /** Order date; also the receipt date when Completed. */
  dateOffset: DayOffset;
  salesOrder?: string;
  lines: SalesReturnLineSpec[];
  credit?: ReturnCreditSpec;
};

export type BankAccountSpec = {
  name: string;
  bankName: string;
  accountHolderName: string;
  countryCode: string;
  currencyCode: string;
  /** Must start with "DEMO-" — never a real account number. */
  accountNumber: string;
  bankCode?: string;
  swiftBic?: string;
  isPrimary: boolean;
};

export type SalesData = {
  opportunities: SalesOpportunitySpec[];
  statusOrders: SalesStatusOrderSpec[];
  // Written AFTER the status orders — salesOrder readable ids depend on it.
  releasedOrders: SalesOpportunitySpec[];
  salesReturns: SalesReturnSpec[];
  /** Customers with a portal (externalLink documentType Customer), as the portal form writes it. */
  customerPortals: string[];
  customerBankAccounts: (BankAccountSpec & { customer: string })[];
};

export type RfqLineSpec = {
  item: string;
  description: string;
};

export type RfqQuoteSpec = {
  key: string;
  supplier: string;
  supplierReference: string;
  shippingCost: number;
  /** Omitted = "Active", which keeps the RFQ trio open for Compare Quotes. */
  status?: "Draft" | "Active" | "Expired" | "Declined";
  assignee?: "self";
  lines: {
    item: string;
    supplierPartId: string;
    // [supplier unit price, lead time in days] per rfqQuantityBreaks entry
    breaks: [number, number][];
  }[];
};

/** The supplier needs a supplierContact — the quote takes the contact and location refs foundation seeds from it. */
export type StandaloneSupplierQuoteSpec = {
  /** Registered in ctx.refs.documents as `sq:<key>` (shared with RfqQuoteSpec keys). */
  key: string;
  supplier: string;
  status: "Draft" | "Active" | "Expired" | "Declined";
  supplierReference: string;
  quotedOffset: DayOffset;
  assignee?: "self";
  expirationOffset: DayOffset;
  lines: {
    item: string;
    supplierPartId: string;
    prices: { quantity: number; unitPrice: number; leadTime: number }[];
  }[];
};

export type RfqHeaderSpec = {
  /** ctx.refs.documents key this RFQ is stored under. */
  ref: string;
  status: string;
  rfqDateOffset: DayOffset;
  expirationOffset: DayOffset;
  notes: string;
  internalNotes: string;
  assignee?: "self";
};

/** Closed mirrors the app's Cancel RFQ action taken before quotes were requested. */
export type LifecycleRfqSpec = {
  /** ctx.refs.documents key this RFQ is stored under. */
  ref: string;
  status: "Draft" | "Closed";
  rfqDateOffset: DayOffset;
  expirationOffset: DayOffset;
  notes: string;
  internalNotes: string;
  quantities: number[];
  lines: RfqLineSpec[];
  suppliers: string[];
};

export type PurchaseOrderLineSpec = {
  /** ctx.refs.items key. */
  item: string;
  purchaseQuantity: number;
  supplierUnitPrice: number;
};

export type ReceiptSpec = {
  /** ctx.refs.documents key this receipt is stored under. */
  ref: string;
  status: string;
  /**
   * Required when Posted; dates the header and ledger. Posted mirrors post-receipt:
   * one Purchase Receipt ledger row per line into its toShelf. Voided writes none.
   */
  postedOffset?: DayOffset;
  lines: {
    /** ctx.refs.items key — also selects which PO line the receipt line covers. */
    item: string;
    orderQuantity: number;
    outstandingQuantity: number;
    receivedQuantity: number;
    unitPrice: number;
    requiresBatchTracking?: boolean;
    /** Required on a Posted line with receivedQuantity > 0. */
    toShelf?: string;
    /**
     * Lot minted for a Posted batch-tracked line, as update_receipt_line_batch_tracking
     * does. Must not collide with any onHandTracked or genealogy readableId.
     */
    lotNumber?: string;
    lotExpiresOffset?: DayOffset;
    /**
     * Supplier certificate attached to this receipt line (a `certificate` row).
     * Only on a Posted line with receivedQuantity > 0.
     */
    certificate?: {
      type: "Material" | "Special Process" | "Functional Test" | "Other";
      certificateNumber: string;
      specification?: string;
    };
  }[];
};

export type PurchaseInvoiceSpec = {
  /** ctx.refs.documents key this invoice is stored under. */
  ref: string;
  /** Registered in ctx.refs.misc as `pinv:<key>` so payments can settle it. */
  key?: string;
  status: string;
  currencyCode: string;
  subtotal: number;
  totalAmount: number;
  dateIssuedOffset: DayOffset;
  dueDateOffset?: DayOffset;
  lines: {
    item: string;
    quantity: number;
    supplierUnitPrice: number;
  }[];
};

// `direct` orders are written before the RFQ; `winningQuote` orders are written
// after it, from the quote that won — the array order is the insertion order.
export type PurchaseOrderSpec =
  | {
      source: "direct";
      log: string;
      /** ctx.refs.documents key, when this PO is stored under one. */
      ref?: string;
      supplier: string;
      purchaseOrderType: string;
      status: string;
      orderDateOffset: DayOffset;
      /** Omitted = base. EUR is pinned to exactly one direct, childless, unpaid PO. */
      currencyCode?: string;
      /** Foreign units per base unit; required when currencyCode is set. */
      exchangeRate?: number;
      assignee?: "self";
      lines: PurchaseOrderLineSpec[];
      receipt?: ReceiptSpec;
      invoice?: PurchaseInvoiceSpec;
    }
  | {
      source: "winningQuote";
      log: string;
      purchaseOrderType: string;
      status: string;
      orderDateOffset: DayOffset;
      currencyCode: string;
      exchangeRate: number;
    };

/**
 * Return to vendor. Completed mirrors post-shipment's Purchase Return Order
 * branch (Posted shipment plus one ledger row per line out of its fromShelf).
 * Line ids are registered as `pretline:<key>:<n>`.
 */
export type PurchaseReturnSpec = {
  /** Registered in ctx.refs.documents as `pret:<key>`. */
  key: string;
  status: "Draft" | "To Ship" | "Completed";
  supplier: string;
  /** Order date; also the shipment date when Completed. */
  dateOffset: DayOffset;
  lines: {
    item: string;
    quantity: number;
    unitPrice: number;
    /** Required when Completed. */
    fromShelf?: string;
  }[];
  /** A Debit memo — the app's supplier-credit direction. */
  credit?: ReturnCreditSpec;
};

/** Approvers are the company's Admin employee-type group plus the applying user as default approver. */
export type ApprovalRuleSpec = {
  documentType: "purchaseOrder" | "supplier";
  /** A supplier rule is amount-less, so 0. */
  lowerBoundAmount: number;
  escalationDays?: number;
};

/**
 * A Pending `approvalRequest`, as PO finalize / supplier "Request approval"
 * write it. A PO request's amount is the order total (purchaseOrders view).
 */
export type ApprovalRequestSpec = { requestedOffset: DayOffset } & (
  | { purchaseOrder: string /** a direct PO's ref, status "Needs Approval" */ }
  | { supplier: string /** status "Pending" */ }
);

export type PurchasingData = {
  rfqQuantityBreaks: number[];
  rfqLines: RfqLineSpec[];
  rfqQuotes: RfqQuoteSpec[];
  rfqWinningQuote: string;
  rfqOrderQuantity: number;
  rfqHeader: RfqHeaderSpec;
  lifecycleRfqs: LifecycleRfqSpec[];
  purchaseOrders: PurchaseOrderSpec[];
  standaloneSupplierQuotes: StandaloneSupplierQuoteSpec[];
  purchaseReturns: PurchaseReturnSpec[];
  approvalRules: ApprovalRuleSpec[];
  approvalRequests: ApprovalRequestSpec[];
  supplierBankAccounts: (BankAccountSpec & { supplier: string })[];
};

// Every non-deprecated jobStatus, each one hanging off a real salesOrderLine, so
// the sales order → job link is exercised at every stage of the lifecycle.
// "Overdue" / "Due Today" are deliberately absent: they are deprecated stored
// statuses that the UI derives from dueDate instead.
export type JobDeadlineType =
  | "No Deadline"
  | "ASAP"
  | "Soft Deadline"
  | "Hard Deadline";

/**
 * Applied after copyMethodToJob. `order` is the 1-based POSITION among root
 * operations sorted by "order" — not the raw value (methods number 10/20/30).
 */
export type JobOperationOverrideSpec = {
  order: number;
  status?:
    | "Todo"
    | "Ready"
    | "Waiting"
    | "In Progress"
    | "Paused"
    | "Done"
    | "Canceled";
  assignee?: "self";
  /** An open productionEvent (no endTime) started today; status must be "In Progress". */
  running?: { type: "Setup" | "Labor" | "Machine"; startTimeOfDay: string };
};

/** Authoring any of these on a job replaces the tier's default Production-1 rows. */
export type ProductionQuantitySpec = {
  order: number;
  type: "Production" | "Scrap" | "Rework";
  quantity: number;
  /** Required on Scrap rows. */
  scrapReason?: string;
};

/** Plain text, not TipTap. */
export type OperationNoteSpec = {
  order: number;
  note: string;
};

export type JobSpec = {
  key: string;
  item: string;
  status: string;
  quantity: number;
  quantityComplete?: number;
  // Ref keys written by tier 4. All three or none — none is a make-to-stock job.
  salesOrder?: string;
  salesOrderLine?: string;
  customer?: string;
  /** Distinct across the dataset; required on released jobs. */
  priority?: number;
  assignee?: "self";
  /** Omitted = "Hard Deadline". */
  deadlineType?: JobDeadlineType;
  /** Required unless "No Deadline", where it must be absent. */
  dueDateOffset?: DayOffset;
  releasedDateOffset?: DayOffset;
  completedDateOffset?: DayOffset;
  operationOverrides?: JobOperationOverrideSpec[];
  quantities?: ProductionQuantitySpec[];
  operationNotes?: OperationNoteSpec[];
  /**
   * Completed jobs only: Setup/Labor/Machine events on every staffed operation,
   * each sized from the operation's own estimate × `efficiency`, run back to back
   * from `startOffset` 07:00 — the estimates-vs-actuals KPI compares the two.
   */
  loggedTime?: { startOffset: DayOffset; efficiency: number };
};

export type ShiftEventSpec = {
  /** productionEvent.type — "Setup" | "Labor" | "Machine". */
  type: string;
  startOffset: DayOffset;
  /** "HH:MM:SS", UTC. */
  startTimeOfDay: string;
  endOffset: DayOffset;
  endTimeOfDay: string;
};

/** Tracked component consumed into the parent: item, lot/serial id, quantity. */
export type GenealogyInputSpec = {
  item: string;
  readableId: string;
  quantity: number;
};

export type GenealogyAssemblySpec = {
  /** ctx.refs.items key for the unit the job builds. */
  item: string;
  /** ctx.refs.documents key the finished serial is stored under. */
  ref: string;
  serial: {
    readableId: string;
    quantity: number;
    status: string;
    sourceDocument: string;
    sourceDocumentReadableId: string;
  };
  produce: {
    type: string;
    sourceDocument: string;
    sourceDocumentReadableId: string;
    quantity: number;
  };
  consume: {
    type: string;
    sourceDocument: string;
    /** trackedEntity fields for each consumed component. */
    entityStatus: string;
    entitySourceDocument: string;
    /** trackedActivityOutput quantity — the parent unit each consume feeds. */
    parentQuantity: number;
  };
};

export type AssemblyStepSpec = {
  title: string;
  /**
   * The body an operator reads under the title. Falls back to the title, but
   * write one — a step whose instruction repeats its own name reads as generated.
   */
  instruction?: string;
  /**
   * graph.json node ids this step installs. They must exist in the bundled
   * graph — a step naming an absent node renders but animates nothing.
   */
  componentNodeIds: string[];
  materials?: { item: string; quantity: number }[];
  tools?: { item: string; quantity: number }[];
};

export type AssemblyComponentMappingSpec = {
  geometryHash: string;
  item: string;
};

export type AssemblySpec = {
  /**
   * File stem under `assets/<industryId>/models/`, resolving to `<model>.glb`
   * plus its `<model>.graph.json` sidecar. Both ship with the app rather than
   * living in storage — see assets.ts and assets/ATTRIBUTION.md.
   */
  model: string;
  name: string;
  /** ctx.refs.items key this assembly documents, when it maps to a seeded item. */
  item?: string;
  /** Component total from the bundled graph, mirrored onto modelUpload. */
  componentCount: number;
  /** 1-based BOP position of the item's "Assembly" operation. */
  operation: number;
  steps: AssemblyStepSpec[];
  componentMappings: AssemblyComponentMappingSpec[];
};

/** Orders are 1-based root-operation positions (see JobOperationOverrideSpec). */
export type ReworkSpec = {
  quantity: number;
  reason: string;
  targetOperationOrder: number;
  triggeredAtOperationOrder: number;
};

export type PickingListLineSpec = {
  /** Must be a component somewhere on the picked job's BOM tree. */
  item: string;
  quantityRequired: number;
  quantityPicked: number;
  status: "Pending" | "Picked" | "Short";
  fromShelf: string;
};

/**
 * Completed lists write paired Direct Transfer ledger rows fromShelf → the floor
 * storage unit of the job's first root operation's work center.
 */
export type PickingListSpec = {
  key: string;
  status: "In Progress" | "Completed";
  job: string;
  /** Due date of the list, and posting date of the Completed ledger pairs. */
  dateOffset: DayOffset;
  lines: PickingListLineSpec[];
};

export type ProductionData = {
  jobs: JobSpec[];
  /** Production-event blocks, indexed by operation position — not shift rows. */
  shifts: ShiftEventSpec[][];
  genealogyInputs: GenealogyInputSpec[];
  genealogyAssembly: GenealogyAssemblySpec;
  /** JobSpec.key whose operations get production events. */
  eventsJobKey: string;
  /** JobSpec.key the as-built genealogy hangs off. */
  genealogyJobKey: string;
  /** Open Setup event (null endTime) on the events job; use the op overridden to "In Progress". */
  openEvent: { operationOrder: number };
  /**
   * An Active batch; members are unstarted root operations of different
   * released jobs on one process. `running` is its batch timer today, on the
   * first member: the tier moves every member to "In Progress", so each member
   * job is "In Progress" with its earlier root operations Done.
   */
  batch: {
    members: { job: string; order: number }[];
    running: { type: "Setup" | "Labor" | "Machine"; startTimeOfDay: string };
  };
  rework: ReworkSpec;
  pickingLists: PickingListSpec[];
};

export type NonConformanceTaskStatus =
  | "Pending"
  | "In Progress"
  | "Completed"
  | "Skipped";

/** Mirrors the `create` edge function's nonConformanceTasks case; In Progress goes to the applying user. */
export type NonConformanceActionTaskSpec = {
  action: string;
  status: NonConformanceTaskStatus;
  dueDateOffset?: DayOffset;
  /** Required when Completed. */
  completedOffset?: DayOffset;
  processes?: string[];
};

/** The active picker subset of the `disposition` enum (quality.models.ts). */
export type NonConformanceDisposition =
  | "Pending"
  | "Return to Supplier"
  | "Rework"
  | "Scrap"
  | "Use As Is";

/** An issue workflow (template): the new-issue form copies its fields onto the NCR. */
export type NonConformanceWorkflowSpec = {
  key: string;
  name: string;
  /** Also the TipTap `content` body. */
  description: string;
  priority: "Low" | "Medium" | "High" | "Critical";
  source: "Internal" | "External";
  requiredActions: string[];
  /** approvalRequirements = ["MRB"]. */
  mrb?: boolean;
};

export type NonConformanceSpec = {
  /** ctx.refs.documents key this NCR is stored under. */
  ref: string;
  name: string;
  source: string;
  status: string;
  openDateOffset: DayOffset;
  quantity: number;
  priority: string;
  /** Omitted = the first row the DB returns. */
  type?: string;
  /** Also written as the TipTap `content` body. */
  description?: string;
  dueDateOffset?: DayOffset;
  /** Required when "Closed", forbidden otherwise. */
  closeDateOffset?: DayOffset;
  /** `job` is a ctx.refs.documents key; the operation itself is resolved by query. */
  jobOperation?: { job: string };
  items: {
    item: string;
    quantity: number;
    /** Omitted = Pending. A Closed issue has every row dispositioned. */
    disposition?: NonConformanceDisposition;
  }[];
  /** Open issues only (close clears it). */
  assignee?: "self";
  /** The issue carries that workflow's source, actions and approvals. */
  workflow?: string;
  /** An externalLink is minted by the sync interceptor. */
  supplier?: string;
  /** The PO's supplier must be `supplier`. */
  purchaseOrderLine?: { po: string; item: string };
  customer?: string;
  /** A `soline:` ref; its order's customer must be `customer`. */
  salesOrderLine?: string;
  trackedEntity?: string;
  inspection?: string;
  /** The RMA's customer must be `customer`. */
  salesReturnLine?: { salesReturn: string; line: number };
  /** Covers the issue's quantity; its supplier must be `supplier`. */
  purchaseReturnLine?: {
    purchaseReturn: string;
    line: number;
    quantity: number;
  };
  /** In `requiredActionIds` order. */
  actionTasks?: NonConformanceActionTaskSpec[];
  /** One approval task plus Engineering and Quality reviewers, as the edge function seeds. */
  mrb?: {
    status: NonConformanceTaskStatus;
    dueDateOffset?: DayOffset;
    completedOffset?: DayOffset;
    reviewers: {
      title: "Engineering" | "Quality";
      status: NonConformanceTaskStatus;
      /** Required when Completed. */
      completedOffset?: DayOffset;
    }[];
  };
};

export type InspectionFeatureSpec = {
  label: string;
  description: string;
  nominalValue: string;
  tolerancePlus: string;
  toleranceMinus: string;
  unit: string;
};

/** Status must equal the engine's derivation. */
export type InspectionSampleSpec = {
  status: "Passed" | "Failed";
  inspectedOffset: DayOffset;
  measurements: { feature: string; value: number }[];
};

type InspectionLotSpec = {
  ref: string;
  /** "Partial" = some samples passed, some failed. */
  status: "Pending" | "In Progress" | "Passed" | "Partial";
  /** Required iff dispositioned; on/after every sample's inspectedOffset. */
  dispositionOffset?: DayOffset;
  notes?: string;
  /**
   * A dispositioned lot has exactly the resolved sample size; Pending has none;
   * In Progress has at least one and fewer than the sample size.
   */
  samples: InspectionSampleSpec[];
};

/**
 * A lot post-receipt creates for a line whose item has a Receipt-usage plan
 * (file-less document, AQL ANSI Z1.4 level II Normal). Lots of one item share
 * its single plan, so they carry identical drawing / aql / features.
 */
export type ReceiptInspectionSpec = InspectionLotSpec & {
  source: "Receipt";
  receipt: string;
  item: string;
  drawingNumber: string;
  /** Resolved sample size must be ≤ 5 so every sample is authored. */
  aql: number;
  features: InspectionFeatureSpec[];
};

/**
 * The lot getOrCreateJobOperationInspection creates when the MES opens a job's
 * Inspection operation: plan = the operation's items.inspectionPlans document,
 * lot size = the operation quantity.
 */
export type JobOperationInspectionSpec = InspectionLotSpec & {
  source: "Job Operation";
  job: string;
};

export type InspectionSpec = ReceiptInspectionSpec | JobOperationInspectionSpec;

export type QualityDocumentStepType =
  | "Value"
  | "Measurement"
  | "Checkbox"
  | "Timestamp"
  | "Person"
  | "List"
  | "Task";

export type QualityDocumentSpec = {
  name: string;
  /** (name, version) is unique — same-name rows are versions of one document. */
  version: number;
  status: "Draft" | "Active" | "Archived";
  description: string;
  steps: {
    name: string;
    description?: string;
    type: QualityDocumentStepType;
    required?: boolean;
    /** Required for (and only for) Measurement steps. */
    unitOfMeasureCode?: string;
    minValue?: number;
    maxValue?: number;
    listValues?: string[];
  }[];
};

/**
 * Calibration status is derived as upsertGaugeCalibrationRecord does: none ⇒
 * Pending; latest Pass ⇒ In-Calibration; latest Fail ⇒ Out-of-Calibration.
 */
export type GaugeSpec = {
  key: string;
  gaugeType: string;
  description: string;
  modelNumber?: string;
  serialNumber?: string;
  supplier?: string;
  role: "Master" | "Standard";
  status: "Active" | "Inactive";
  calibrationIntervalInMonths: number;
  acquiredOffset: DayOffset;
  shelf?: string;
  /** Oldest first; every dateOffset on/after acquiredOffset and ≤ 0. */
  calibrations: {
    dateOffset: DayOffset;
    result: "Pass" | "Fail";
    requiresAction?: boolean;
    requiresAdjustment?: boolean;
    requiresRepair?: boolean;
    temperature?: number;
    humidity?: number;
    measurementStandard?: string;
    notes?: string;
  }[];
};

export type RiskStatus =
  | "Open"
  | "In Review"
  | "Mitigating"
  | "Closed"
  | "Accepted";

/**
 * `source` picks the entity card; Item/Job risks also carry itemId (a Job's is its
 * item), as each RiskRegisterCard writes them.
 */
export type RiskSpec = {
  title: string;
  description: string;
  type: "Risk" | "Opportunity";
  status: RiskStatus;
  /** 1–5 */
  severity: number;
  /** 1–5 */
  likelihood: number;
} & (
  | { source: "General" }
  | { source: "Customer"; customer: string }
  | { source: "Supplier"; supplier: string }
  | { source: "Item"; item: string }
  | { source: "Job" /** `job:<key>` ref. */; job: string }
  | {
      source: "Work Center";
      workCenter: string;
    }
);

export type QualityData = {
  /** Inserted before the NCRs that link them. */
  workflows: NonConformanceWorkflowSpec[];
  nonConformances: NonConformanceSpec[];
  /** Inserted before NCRs so one can link a lot. */
  inspections: InspectionSpec[];
  qualityDocuments: QualityDocumentSpec[];
  /** Together they cover all three calibration statuses. */
  gauges: GaugeSpec[];
  /** ≥ 5 — every risk status, one Opportunity, sources spread. */
  risks: RiskSpec[];
};

// The change type drives what the tier does to the item's methods, so it is a
// closed union, not a free string.
export type ChangeType = "Version" | "Revision" | "New Part";

// The engineering edits a Revision applies to its draft method, in order.
export type BomLineEditSpec =
  | { op: "delete"; component: string }
  | { op: "setQuantity"; component: string; quantity: number }
  | { op: "add"; component: string; quantity: number; order: number };

export type OperationEditSpec = {
  /** matches the existing operation by its order index */
  order: number;
  description?: string;
  laborTime?: number;
};

export type RevisionSpec = {
  revision: string;
  unitSalePrice: number;
  description: string;
  bomEdits: BomLineEditSpec[];
  operationEdits: OperationEditSpec[];
};

export type AffectedItemSpec = {
  /** ctx.refs.items key. */
  item: string;
  changeType: ChangeType;
  sortOrder: number;
  supersessionMode?: string;
  discontinuationOffset?: DayOffset;
  successorEffectivityOffset?: DayOffset;
  /** Required when changeType is "Revision". */
  revision?: RevisionSpec;
};

export type ChangeOrderTaskStatus =
  | "Pending"
  | "In Progress"
  | "Completed"
  | "Skipped";

/** Instantiated as setChangeNoticeActionTasks does; In Progress goes to the applying user. */
export type ChangeOrderActionTaskSpec = {
  action: string;
  status: ChangeOrderTaskStatus;
  dueDateOffset?: DayOffset;
  /** Required when Completed. */
  completedOffset?: DayOffset;
};

export type ChangeOrderSpec = {
  /** ctx.refs.documents key this change order is stored under. */
  ref: string;
  name: string;
  type: string;
  status: string;
  openDateOffset: DayOffset;
  /** Empty on lifecycle-only notices — every change type spins a method draft. */
  affectedItems: AffectedItemSpec[];
  changeOrderType?: string;
  priority?: "Low" | "Medium" | "High" | "Critical";
  dueDateOffset?: DayOffset;
  /** Plain text → TipTap body. */
  reasonForChange?: string;
  nonConformance?: string;
  actionTasks?: ChangeOrderActionTaskSpec[];
};

export type ChangeOrderData = {
  changeOrders: ChangeOrderSpec[];
};

// Every fixed asset status the UI branches on, so the docs screenshots aren't
// dead ends: Draft is the ONLY status /x/fixed-asset/:id/register accepts
// (the loader redirects away otherwise), and the Sell modal requires Active or
// Fully Depreciated.
export type FixedAssetSpec = {
  key: string;
  className: string;
  location: "Plant" | "HQ";
  name: string;
  description: string;
  serialNumber: string;
  status: "Draft" | "Active" | "Fully Depreciated" | "Disposed";
  depreciationMethod:
    | "Straight Line"
    | "Declining Balance"
    | "Units of Production";
  usefulLifeMonths: number;
  // Whole percent — the app reads residual as cost * (percent / 100).
  residualValuePercent: number;
  acquisitionCost: number;
  acquisitionOffset: DayOffset | null;
  depreciationStartOffset: DayOffset | null;
  accumulatedDepreciation: number;
  // The straight-line charge buildDepreciationLines() computes for the
  // depreciation run's period end with no prior posted run:
  // (cost - residual) / usefulLifeMonths * months since depreciationStartDate.
  // Both dates move with the anchor, so the elapsed month count is stable.
  // Omit to leave the asset out of the seeded run.
  // Units of Production instead uses the run month's usage log:
  // (cost - residual) / assetLifetimeUsage * unitsProduced.
  depreciationCharge?: number;
  /** Required for "Units of Production". */
  assetLifetimeUsage?: number;
  /** One per month; monthsBack 1 is the seeded run's period, the only log it reads. */
  usageLogs?: { monthsBack: number; unitsProduced: number }[];
  /** Required iff "Disposed"; the tier derives NBV and gainLoss as post-sales-invoice does. */
  disposal?: { dateOffset: DayOffset; method: "Sale"; saleProceeds: number };
};

export type AccountClass =
  | "Asset"
  | "Liability"
  | "Equity"
  | "Revenue"
  | "Expense";

/** A class resolves to the group's first posting account of that class. */
export type JournalLineAccount =
  | { accountClass: AccountClass; account?: never }
  | { account: string; accountClass?: never };

export type JournalLineDimensionSpec = {
  /**
   * "Project" = the bootstrap Project dimension (`value` is a projects key);
   * otherwise accounting.customDimension.name, `value` one of its values.
   */
  dimension: string;
  value: string;
};

// amount is the class-signed natural balance the journalEntries view decodes:
// positive on a debit-normal class (Asset/Expense) is a debit, positive on a
// credit-normal class (Liability/Equity/Revenue) is a credit.
export type JournalLineSpec = JournalLineAccount & {
  description: string;
  amount: number;
  quantity: number;
  journalLineReference: string;
  /** The line must carry a unique journalLineReference. */
  dimensions?: JournalLineDimensionSpec[];
};

export type JournalEntrySpec = {
  ref: string;
  journalEntryId: string;
  description: string;
  status: "Draft" | "Posted" | "Reversed";
  /** Omitted = "Manual". A company holds one Posted "Opening Balance" entry (unique index). */
  sourceType?: "Opening Balance";
  postingOffset: DayOffset;
  lines: JournalLineSpec[];
  /** Required iff "Reversed": the tier writes a negated Posted reversal, as reverseJournalEntry does. */
  reversal?: { ref: string; journalEntryId: string; postingOffset: DayOffset };
};

/**
 * Posted = post-payment's shape with its journal (payment.journalId); all USD at
 * rate 1. Draft = entered, unapplied and unposted — the payment's apply table.
 */
export type PaymentSpec = {
  /** Registered in ctx.refs.documents as `payment:<key>`. */
  key: string;
  type: "Receipt" | "Disbursement";
  /** Omitted = "Posted". A Draft carries no applies and no credits. */
  status?: "Draft";
  /** Required for a Receipt. */
  customer?: string;
  /** Required for a Disbursement. */
  supplier?: string;
  dateOffset: DayOffset;
  /** Cash total; 0 = a pure credit application. */
  amount: number;
  reference: string;
  /** Cash applications; Σ amount must equal `amount`. invoiceKey → `sinv:`/`pinv:` by type. */
  applies: { invoiceKey: string; amount: number }[];
  /** applyCreditsToInvoices shape. */
  credits?: { memoKey: string; invoiceKey: string; amount: number }[];
};

/**
 * Posted credit/debit memo. The memo table has no invoice column, so the tie is
 * `reference` = the invoice's readable id plus a PaymentSpec.credits application.
 */
export type MemoSpec = {
  /** Registered in ctx.refs.documents as `memo:<key>`. */
  key: string;
  direction: "Credit" | "Debit";
  customer?: string;
  supplier?: string;
  /** Credit → a `sinv:` key; Debit → a `pinv:` key. */
  invoiceKey: string;
  dateOffset: DayOffset;
  amount: number;
  notes: string;
};

export type ProjectSpec = {
  /** Registered in ctx.refs.misc as `project:<key>`. */
  key: string;
  name: string;
  description: string;
  /** job has no projectId, so project coding lives on purchaseInvoiceLine. */
  purchaseInvoiceLine?: { invoiceKey: string; item: string };
};

export type CustomDimensionSpec = {
  name: string;
  values: string[];
};

/** Snapshotted from the bootstrap periodCloseTaskDefinition named `definition`. */
export type PeriodCloseTaskSpec = {
  definition: string;
  status: "Open" | "Done" | "Skipped";
  /** Required iff Skipped (the app's close checklist demands a reason). */
  skippedReason?: string;
  notes?: string;
};

/**
 * Company-scoped rate pin, foreign units per base unit. Never write the global
 * "exchangeRate" table from a tenant template.
 */
export type ExchangeRateOverrideSpec = {
  currencyCode: string;
  rate: number;
};

export type BillingAddressSpec = {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  phone: string;
  /** A reserved `.example` domain — never a real mailbox. */
  email: string;
};

export type AccountingData = {
  fixedAssets: FixedAssetSpec[];
  journalEntries: JournalEntrySpec[];
  payments: PaymentSpec[];
  memos: MemoSpec[];
  projects: ProjectSpec[];
  customDimension: CustomDimensionSpec;
  closeTasks: PeriodCloseTaskSpec[];
  exchangeRateOverrides: ExchangeRateOverrideSpec[];
  billingAddresses: {
    receivable: BillingAddressSpec;
    payable: BillingAddressSpec;
  };
};

export type MaintenanceFrequency =
  | "Daily"
  | "Weekly"
  | "Monthly"
  | "Quarterly"
  | "Annual";
export type MaintenancePriority = "Low" | "Medium" | "High" | "Critical";

/** Shaped as scheduled-maintenance.new writes it (location = the work center's). */
export type MaintenanceScheduleSpec = {
  /** Registered in ctx.refs.misc as `maintenanceSchedule:<key>`. */
  key: string;
  name: string;
  description: string;
  workCenter: string;
  frequency: MaintenanceFrequency;
  priority: MaintenancePriority;
  /** Minutes; > 0 when it takes the work center offline. */
  estimatedDuration: number;
  /** Stored at midnight UTC; must not be in the past. */
  nextDueOffset: DayOffset;
  takesWorkCenterOffline?: boolean;
  /** Daily only: false leaves Saturday/Sunday off. Default true. */
  weekends?: boolean;
  /** Kit the generator copies onto each dispatch it creates. */
  spareParts?: { item: string; quantity: number }[];
};

export type MaintenanceDispatchStatus =
  | "Open"
  | "Assigned"
  | "In Progress"
  | "Completed"
  | "Cancelled";
export type MaintenanceSeverity =
  | "Preventive"
  | "Operator Performed"
  | "Support Required"
  | "OEM Required";
export type MaintenanceSource = "Scheduled" | "Reactive" | "Non-Conformance";
export type OeeImpact = "Down" | "Planned" | "Impact" | "No Impact";

/** The tier assigns ctx.userId for Assigned / In Progress / Completed, no one otherwise. */
export type MaintenanceDispatchSpec = {
  /** Registered in ctx.refs.misc as `maintenanceDispatch:<key>`. */
  key: string;
  status: MaintenanceDispatchStatus;
  priority: MaintenancePriority;
  severity: MaintenanceSeverity;
  source: MaintenanceSource;
  oeeImpact: OeeImpact;
  workCenter: string;
  /** Required iff source is "Scheduled": an ops.maintenanceSchedules key on the same work center. */
  schedule?: string;
  /** Required iff source is "Non-Conformance". */
  nonConformance?: string;
  suspectedFailureMode?: string;
  /** Completed only. */
  actualFailureMode?: string;
  /** Plain text → TipTap body. */
  content: string;
  created: InstantSpec;
  plannedStart: InstantSpec;
  plannedEnd: InstantSpec;
  /** Required iff In Progress or Completed (the Start action stamps it). */
  actualStart?: InstantSpec;
  /** Required iff Completed (also completedAt, as the MES Complete action writes both). */
  actualEnd?: InstantSpec;
  takesWorkCenterOffline?: boolean;
  /**
   * Completed only, untracked items: issued via add-and-issue with a ledger draw
   * from `shelf`, at the item's standard cost (the spare-part cost KPI).
   */
  spareParts?: { item: string; quantity: number; shelf: string }[];
  comments?: string[];
};

type TrainingQuestionBase = { question: string };

/** Mirrors what the training question editor saves per type. */
export type TrainingQuestionSpec = TrainingQuestionBase &
  (
    | { type: "MultipleChoice"; options: string[]; correct: string }
    | { type: "MultipleAnswers"; options: string[]; correct: string[] }
    | { type: "TrueFalse"; answer: boolean }
    | { type: "MatchingPairs"; pairs: { left: string; right: string }[] }
    | { type: "Numerical"; answer: number; tolerance?: number }
  );

/** `assignment` targets ctx.userId's group (a user id is its own group id). */
export type TrainingSpec = {
  name: string;
  description: string;
  status: "Draft" | "Active" | "Archived";
  frequency: "Once" | "Quarterly" | "Annual";
  type: "Mandatory" | "Optional";
  estimatedDuration: string;
  /** Paragraphs → TipTap body. */
  content: string[];
  questions: TrainingQuestionSpec[];
  /**
   * Active trainings only. completedOffset only on "Once": a recurring one's
   * completion must match the current period, which an offset can't guarantee.
   */
  assignment?: { completedOffset?: DayOffset };
};

/** Clock-in and clock-out on the same day. */
export type TimecardSpec = {
  dayOffset: DayOffset;
  /** UTC "HH:MM:SS". */
  clockIn: string;
  /** UTC "HH:MM:SS", after clockIn. */
  clockOut: string;
  note?: string;
};

export type OpenTimecardSpec = {
  /** UTC "HH:MM:SS" today; no later than the earliest running production event. */
  clockIn: string;
  note?: string;
};

/** Never today: a today row pre-filters the MES schedule to that one work center. */
export type PeopleAssignmentSpec = {
  dayOffset: DayOffset;
  workCenter: string;
  shift: string;
  overtimeHours?: number;
  note?: string;
};

export type PeopleAbsenceSpec = {
  dayOffset: DayOffset;
  /** Omitted = the whole day. */
  shift?: string;
  note: string;
};

/** `path` = the page it was sent from. */
export type SuggestionSpec = {
  suggestion: string;
  emoji: string;
  path: string;
  tags?: string[];
};

/** Hangs on ctx.userId — only /x/person/:personId/notes reads the table. */
export type NoteSpec = { text: string };

export type ReplacementPartSpec = {
  workCenter: string;
  item: string;
  /** Whole units (the column is an integer). */
  quantity: number;
};

/** Tiers resolve the attributeDataType id by this label. */
export type AttributeDataTypeLabel =
  | "Yes/No"
  | "Date"
  | "List"
  | "Numeric"
  | "Text"
  | "User"
  | "Customer"
  | "Supplier"
  | "File";

/** The applying user is the only person the seed may name, so a User attribute points at them. */
export type UserAttributeSpec = {
  name: string;
  canSelfManage?: boolean;
} & (
  | { dataType: "Date"; valueOffset: DayOffset }
  | { dataType: "List"; listOptions: string[]; value: string }
  | { dataType: "User" }
  | { dataType: "Text"; value: string }
  | { dataType: "Numeric"; value: number }
  | { dataType: "Yes/No"; value: boolean }
);

/** Adopted by name on a re-apply (the wipe keeps it). */
export type UserAttributeCategorySpec = {
  name: string;
  emoji: string;
  public: boolean;
  attributes: UserAttributeSpec[];
};

/** Adopted by (table, name) on a re-apply (the wipe keeps it). */
export type CustomFieldSpec = {
  table: string;
  name: string;
  dataType: Exclude<AttributeDataTypeLabel, "File">;
  /** Required iff dataType is "List". */
  listOptions?: string[];
};

export type SerialSequenceSpec = {
  item: string;
  prefix: string;
  suffix?: string;
  /** Zero-padded counter width. */
  size: number;
  /**
   * The last counter issued (the next serial is next + 1): at least every
   * seeded serial of the item that fits prefix + counter + suffix.
   */
  next: number;
};

/** As the print-job task leaves it. */
export type PrintJobSpec = {
  source:
    | { kind: "Receipt"; receipt: string }
    | { kind: "Job"; job: string }
    | { kind: "StorageUnit"; shelf: string };
  /** Omitted for a storage-unit label. */
  item?: string;
  status: "completed" | "failed" | "queued";
  origin: "auto" | "manual" | "reprint";
  /** createdAt; the cleanup job deletes completed jobs after 30 days. */
  at: InstantSpec;
  attempts: number;
  /** Required iff failed. */
  error?: string;
};

export type OpsData = {
  userAttributeCategories: UserAttributeCategorySpec[];
  customFields: CustomFieldSpec[];
  serialSequences: SerialSequenceSpec[];
  printJobs: PrintJobSpec[];
  maintenanceSchedules: MaintenanceScheduleSpec[];
  maintenanceDispatches: MaintenanceDispatchSpec[];
  replacementParts: ReplacementPartSpec[];
  trainings: TrainingSpec[];
  timecards: TimecardSpec[];
  openTimecard: OpenTimecardSpec;
  peopleAssignments: PeopleAssignmentSpec[];
  peopleAbsences: PeopleAbsenceSpec[];
  suggestions: SuggestionSpec[];
  notes: NoteSpec[];
};

export type Node = {
  id: string;
  name: string;
  type: string;
  position: { x: number; y: number };
  expanded?: boolean;
  data: Record<string, unknown>;
};

export type Edge = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
};

export type SeedWorkflow = {
  name: string;
  description: string;
  /** Only the simplest one ships published; the rest are there to read and publish deliberately. */
  published: boolean;
  nodes: Node[];
  edges: Edge[];
};

/**
 * A finished run in the engine's shape: a Succeeded trigger step (sequence 0),
 * then `steps`. Skipped runs stop at `load` — no steps, startedAt null.
 */
export type WorkflowRunSpec = {
  /** Name of a `published: true` workflow from `build`. */
  workflow: string;
  status: "Succeeded" | "Failed" | "Skipped";
  triggerRef: string;
  /** createdAt; on or after the triggering record's date. */
  at: InstantSpec;
  /** Required iff Skipped: the engine's statusReason. */
  statusReason?: string;
  /** Non-trigger steps, in walk order. Empty iff Skipped. */
  steps: {
    nodeId: string;
    status: "Succeeded" | "Failed";
    /** Required iff Failed — the executor's error string (detail stays null). */
    error?: string;
  }[];
};

// A factory, not a constant: the definitions name ids that only exist once the seed has run.
export type WorkflowData = {
  build: (refs: { ownerId: string; issueTypeId: string }) => SeedWorkflow[];
  runs: WorkflowRunSpec[];
};

export type DemandProjectionSpec = {
  readableId: string;
  quantities: number[];
};

export type DemandOrderLineSpec = {
  item: string;
  salesOrderLineType: string;
  saleQuantity: number;
  /** unitPrice = the item's unitCost multiplied by this. */
  unitPriceMultiplier: number;
  unitOfMeasureCode: string;
  methodType: string;
  status: string;
  sortOrder: number;
};

export type DemandOrderSpec = {
  /** Key the order id is published under in ctx.refs.documents. */
  ref: string;
  status: string;
  customer: string;
  currencyCode: string;
  shippingMethod: string;
  /** Must land inside the seeded 48-week planning horizon. */
  promisedDateOffset: DayOffset;
  lines: DemandOrderLineSpec[];
};

/** Planning at the bootstrap (HQ) location, so its planning screens are not empty. */
export type HqPlanningSpec = {
  /** Fixed Reorder Quantity at HQ; at least one make part and one buy part. */
  reorderItemIds: string[];
  /** Make parts only — the projections screen lists Make items. */
  demandProjections: DemandProjectionSpec[];
};

export type PlanningData = {
  buyItemIds: string[];
  makeItemIds: string[];
  demandProjections: DemandProjectionSpec[];
  demandOrder: DemandOrderSpec;
  hq: HqPlanningSpec;
};

// Must stay in step with DATASETS in index.ts — a key with no dataset is unusable.
export type DatasetKey = "satellite" | "robotics" | "precision" | "motor";

// One industry story's worth of data. The tiers hold the insertion logic; a
// Dataset holds everything that differs between stories.
export type Dataset = {
  key: DatasetKey;
  label: string;
  /** industry.id this dataset backs, or null for dev-only datasets. */
  industryId: string | null;
  foundation: FoundationData;
  items: ItemsData;
  inventory: InventoryData;
  sales: SalesData;
  purchasing: PurchasingData;
  production: ProductionData;
  quality: QualityData;
  changeOrders: ChangeOrderData;
  accounting: AccountingData;
  ops: OpsData;
  workflows: WorkflowData;
  planning: PlanningData;
};

// Ids collected as tiers run, so a later tier can reference an earlier one's
// rows by a stable human key instead of re-querying.
export type SeedRefs = {
  locations: Record<string, string>;
  shelves: Record<string, string>;
  warehouses: Record<string, string>;
  departments: Record<string, string>;
  shifts: Record<string, string>;
  abilities: Record<string, string>;
  processes: Record<string, string>;
  workCenters: Record<string, string>;
  suppliers: Record<string, string>;
  customers: Record<string, string>;
  contacts: Record<string, string>;
  shippingMethods: Record<string, string>;
  items: Record<string, ItemRef>;
  makeMethods: Record<string, string>;
  documents: Record<string, string>;
  misc: Record<string, string>;
};

export type ItemRef = {
  id: string;
  readableId: string;
  revision: string;
  name: string;
  type: ItemType;
  makeMethodId: string | null;
  // Drives the BOM line's methodType — a Make component is a subassembly.
  isMake: boolean;
  unitCost: number;
  unitOfMeasureCode: string;
};

export type Ctx = {
  client: PoolClient;
  companyId: string;
  companyGroupId: string;
  userId: string;
  locationId: string;
  dataset: Dataset;
  /** Today in the company's timezone — every dated row is an offset from this. */
  anchor: CalendarDate;
  refs: SeedRefs;
  log: (message: string) => void;
};

export type Tier = {
  n: number;
  name: string;
  run: (ctx: Ctx) => Promise<void>;
};

export function emptyRefs(): SeedRefs {
  return {
    locations: {},
    shelves: {},
    warehouses: {},
    departments: {},
    shifts: {},
    abilities: {},
    processes: {},
    workCenters: {},
    suppliers: {},
    customers: {},
    contacts: {},
    shippingMethods: {},
    items: {},
    makeMethods: {},
    documents: {},
    misc: {}
  };
}

export type Resolved = { companyId: string; userId: string };

// Returns null when the email is unknown — the caller bootstraps in that case.
export async function resolveCompany(
  client: PoolClient,
  email: string
): Promise<Resolved | null> {
  const row = await maybeOne<{ companyId: string; userId: string }>(
    client,
    `SELECT utc."companyId", utc."userId"
     FROM "userToCompany" utc
     JOIN "user" u ON u.id = utc."userId"
     WHERE u.email = $1 AND utc.role = 'employee'
     ORDER BY utc."companyId"
     LIMIT 1`,
    [email]
  );
  return row ? { companyId: row.companyId, userId: row.userId } : null;
}

// Falls back to UTC when the company has no timezone set.
export async function resolveCompanyTimeZone(
  client: PoolClient,
  companyId: string
): Promise<string> {
  const row = await maybeOne<{ timezone: string | null }>(
    client,
    `SELECT timezone FROM company WHERE id = $1`,
    [companyId]
  );
  return row?.timezone ?? "UTC";
}

// Everything the tiers assume about the company is validated here, before BEGIN.
export async function buildCtx(
  client: PoolClient,
  companyId: string,
  userId: string,
  dataset: Dataset,
  anchor: CalendarDate,
  log: (message: string) => void = (message) => console.log(`  ${message}`)
): Promise<Ctx> {
  const company = await one<{ id: string; companyGroupId: string }>(
    client,
    `SELECT id, "companyGroupId" FROM company WHERE id = $1`,
    [companyId]
  );

  const location = await one<{ id: string }>(
    client,
    `SELECT id FROM location WHERE "companyId" = $1 ORDER BY "createdAt", id LIMIT 1`,
    [companyId]
  );

  await one(
    client,
    `SELECT code FROM "unitOfMeasure" WHERE "companyId" = $1 AND code = 'EA'`,
    [companyId]
  );

  return {
    client,
    companyId,
    companyGroupId: company.companyGroupId,
    userId,
    locationId: location.id,
    dataset,
    anchor,
    refs: emptyRefs(),
    log
  };
}
