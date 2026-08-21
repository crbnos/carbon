import type { CalendarDate } from "@internationalized/date";
import type { PoolClient } from "pg";
import type { DayOffset } from "./dates.ts";
import type { ItemSpec, MethodType, OperationType } from "./helpers/items.ts";
import { maybeOne, one } from "./sql.ts";
import type { SeedWorkflow } from "./tiers/workflow-definitions.ts";

// Must stay in step with DATASETS in index.ts — a key with no dataset is unusable.
export type DatasetKey = "satellite" | "robotics" | "precision" | "motor";

export type { ItemSpec };

// ---------------------------------------------------------------------------
// Slice shapes — the contract every dataset's data files implement.
// ---------------------------------------------------------------------------

export type ProcedureStepSpec = {
  name: string;
  type: "Task" | "Checkbox" | "Measurement" | "Value" | "List" | "Person";
  instruction: string;
  required?: boolean;
  unitOfMeasureCode?: string;
  minValue?: number;
  maxValue?: number;
};

export type ProcedureSpec = {
  name: string;
  process: string;
  description: string;
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
};

export type SupplierSpec = {
  name: string;
  type: string;
  phone: string;
  website: string;
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

export type FoundationData = {
  departments: string[];
  abilities: string[];
  processes: ProcessSpec[];
  workCenters: WorkCenterSpec[];
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
  plant: PlantSpec;
  shifts: ShiftSpec[];
  warehouses: WarehouseSpec[];
  storageTypes: string[];
  /** Insertion order matters — a parent shelf must precede its children. */
  shelves: ShelfSpec[];
  printerRoute: PrinterRouteSpec | null;
  /** Must be one of shippingMethods; applied to every customer and supplier. */
  defaultShippingMethod: string;
  contractorAgency: ContractorAgencySpec | null;
  /** Billing address used for every customer and supplier location. */
  partyAddressCity: string;
  partyAddressStateProvince: string;
  partyAddressPostalCode: string;
  partyAddressCountryCode: string;
};

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
};

export type MakeMethodSpec = {
  /** readableId of the make part this method belongs to */
  readableId: string;
  bom: BomLineSpec[];
  bop: BopOperationSpec[];
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
};

export type OpeningStockSpec = {
  item: string;
  qty: number;
  shelf: string;
};

export type TrackedStockSpec = {
  item: string;
  entities: Array<{ readableId: string; quantity: number }>;
};

export type KanbanItemSpec = {
  item: string;
  qty: number;
  supplier: string;
};

export type InventoryCountSpec = {
  status: string;
  notes: string;
};

export type InventoryData = {
  openingStock: OpeningStockSpec[];
  onHandTracked: TrackedStockSpec[];
  kanbanItems: KanbanItemSpec[];
  inventoryCount: InventoryCountSpec;
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
  expirationOffset?: DayOffset;
  externalNotes?: string;
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
  lines: SalesOrderLineSpec[];
};

export type ShipmentSpec = {
  /** ctx.refs.documents key this shipment is stored under. */
  ref: string;
  status: string;
  lines: {
    /** ctx.refs.items key — also selects which order line the shipment covers. */
    item: string;
    orderQuantity: number;
    outstandingQuantity: number;
    shippedQuantity: number;
    unitPrice: number;
  }[];
};

export type SalesInvoiceSpec = {
  /** ctx.refs.documents key this invoice is stored under. */
  ref: string;
  status: string;
  subtotal: number;
  totalAmount: number;
  dateIssuedOffset: DayOffset;
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

export type SalesData = {
  opportunities: SalesOpportunitySpec[];
  statusOrders: SalesStatusOrderSpec[];
  // Written AFTER the status orders — salesOrder readable ids depend on it.
  releasedOrders: SalesOpportunitySpec[];
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
  lines: {
    item: string;
    supplierPartId: string;
    // [supplier unit price, lead time in days] per rfqQuantityBreaks entry
    breaks: [number, number][];
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
  lines: {
    /** ctx.refs.items key — also selects which PO line the receipt line covers. */
    item: string;
    orderQuantity: number;
    outstandingQuantity: number;
    receivedQuantity: number;
    unitPrice: number;
    requiresBatchTracking?: boolean;
  }[];
};

export type PurchaseInvoiceSpec = {
  /** ctx.refs.documents key this invoice is stored under. */
  ref: string;
  status: string;
  currencyCode: string;
  subtotal: number;
  totalAmount: number;
  dateIssuedOffset: DayOffset;
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

export type PurchasingData = {
  rfqQuantityBreaks: number[];
  rfqLines: RfqLineSpec[];
  rfqQuotes: RfqQuoteSpec[];
  rfqWinningQuote: string;
  rfqOrderQuantity: number;
  rfqHeader: RfqHeaderSpec;
  purchaseOrders: PurchaseOrderSpec[];
};

// Every non-deprecated jobStatus, each one hanging off a real salesOrderLine, so
// the sales order → job link is exercised at every stage of the lifecycle.
// "Overdue" / "Due Today" are deliberately absent: they are deprecated stored
// statuses that the UI derives from dueDate instead.
export type JobSpec = {
  key: string;
  item: string;
  status: string;
  quantity: number;
  quantityComplete?: number;
  // Ref keys written by tier 4.
  salesOrder: string;
  salesOrderLine: string;
  customer: string;
  dueDateOffset: DayOffset;
  releasedDateOffset?: DayOffset;
  completedDateOffset?: DayOffset;
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
  steps: AssemblyStepSpec[];
};

export type ProductionData = {
  jobs: JobSpec[];
  /**
   * Animated 3D work instructions built on a bundled CAD assembly. Optional:
   * a dataset with no industryId has nowhere to resolve the model from.
   */
  assembly?: AssemblySpec;
  /** Production-event blocks, indexed by operation position — not shift rows. */
  shifts: ShiftEventSpec[][];
  genealogyInputs: GenealogyInputSpec[];
  genealogyAssembly: GenealogyAssemblySpec;
  /** JobSpec.key whose operations get production events. */
  eventsJobKey: string;
  /** JobSpec.key the as-built genealogy hangs off. */
  genealogyJobKey: string;
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
  /** `job` is a ctx.refs.documents key; the operation itself is resolved by query. */
  jobOperation?: { job: string };
  /** `item` is a ctx.refs.items key. */
  items?: { item: string; quantity: number }[];
};

export type QualityData = {
  nonConformances: NonConformanceSpec[];
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

export type ChangeOrderSpec = {
  /** ctx.refs.documents key this change order is stored under. */
  ref: string;
  name: string;
  type: string;
  status: string;
  openDateOffset: DayOffset;
  affectedItems: AffectedItemSpec[];
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
  status: "Draft" | "Active" | "Fully Depreciated";
  depreciationMethod: "Straight Line" | "Declining Balance";
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
  depreciationCharge?: number;
};

// The tier resolves one GL account per class, so a line names its class rather
// than an account id.
export type JournalLineSpec = {
  accountClass: "Asset" | "Revenue";
  description: string;
  amount: number;
  quantity: number;
  journalLineReference: string;
};

export type JournalEntrySpec = {
  ref: string;
  journalEntryId: string;
  description: string;
  status: "Draft" | "Posted";
  postingOffset: DayOffset;
  lines: JournalLineSpec[];
};

export type AccountingData = {
  fixedAssets: FixedAssetSpec[];
  journalEntries: JournalEntrySpec[];
};

// A factory, not a constant: the definitions name ids that only exist once the seed has run.
export type WorkflowData = {
  build: (refs: { ownerId: string; issueTypeId: string }) => SeedWorkflow[];
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

export type PlanningData = {
  buyItemIds: string[];
  makeItemIds: string[];
  demandProjections: DemandProjectionSpec[];
  demandOrder: DemandOrderSpec;
};

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

export type ItemType =
  | "Part"
  | "Material"
  | "Tool"
  | "Consumable"
  | "Service"
  | "Fixture";

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
