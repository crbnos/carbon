// Pure validation of a Dataset's internal consistency: every string reference
// must resolve against the dataset's own definitions, so a typo or an
// unbalanced journal fails even when no database is running. DB-free (it
// reads the bundled assembly graph.json sidecars from disk); the drift check
// (`pnpm db:check:datasets`) covers the live schema.
//
// createContext builds every projection once (dataset-index.ts); each rule
// reads them and reports. RULES order is the order violations are listed in.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  accounts,
  changeOrderRequiredActions,
  changeOrderTypes,
  currencies,
  dimensions,
  failureModes,
  gaugeTypes,
  nonConformanceRequiredActions,
  nonConformanceTypes,
  paymentTerms,
  periodCloseTaskDefinitions,
  returnReasons,
  scrapReasons,
  unitOfMeasures
} from "../../supabase/functions/lib/seed.data.ts";
import { EPSILON, round } from "../../supabase/functions/shared/precision.ts";
import { Constants } from "../types.ts";
import { NOT_CLOSED_MIN_OFFSET, OPEN_PERIOD_MIN_OFFSET } from "./dates.ts";
import {
  deriveSampleStatus,
  resolveInspectionPlan
} from "./helpers/inspection.ts";
import {
  isBalanced,
  memoJournal,
  type PostingJournal,
  paymentJournal,
  postingImbalance,
  purchaseInvoiceJournal,
  receiptJournal,
  salesInvoiceJournal,
  scrapJournal,
  shipmentJournal,
  signedNet,
  voidJournal
} from "./helpers/posting-journals.ts";
import { RULE_FIELDS, type RuleValueKind } from "./rule-fields.ts";
import type {
  AccountClass,
  BankAccountSpec,
  BopOperationSpec,
  Dataset,
  EnforcementRuleSpec,
  InspectionFeatureSpec,
  InspectionPlanSpec,
  InstantSpec,
  ItemSpec,
  ItemsData,
  JobSpec,
  JournalEntrySpec,
  JournalLineSpec,
  MakeMethodSpec,
  ReturnCreditSpec,
  RuleConditionValue,
  RuleOperator,
  SalesOpportunitySpec
} from "./types.ts";

// Status groupings, horizons and formats shared by more than one rule module.

export const OPEN_JOB_STATUSES = new Set([
  "Planned",
  "Ready",
  "In Progress",
  "Paused"
]);
export const RELEASED_OPEN_JOB_STATUSES = new Set([
  "Ready",
  "In Progress",
  "Paused"
]);
export const OPEN_NCR_STATUSES = new Set(["Registered", "In Progress"]);
export const OPEN_NCR_TASK_STATUSES = new Set(["Pending", "In Progress"]);

export const HORIZON_DAYS = 48 * 7; // tier 12 seeds a 48-week planning horizon

/** tier 06 opens production.openEvent at this UTC time today. */
export const OPEN_EVENT_TIME = "08:00:00";

export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

/** Seconds since midnight for a UTC "HH:MM:SS", or null when malformed. */
export function secondsOfDay(time: string): number | null {
  if (!TIME_OF_DAY.test(time)) return null;
  const [h, m, sec] = time.split(":").map(Number);
  return h! * 3600 + m! * 60 + sec!;
}

export function checkInstant(
  fail: (message: string) => void,
  where: string,
  instant: InstantSpec
): void {
  if (secondsOfDay(instant.time) === null) {
    fail(`${where}: time "${instant.time}" is not a UTC "HH:MM:SS"`);
  }
}

export const COUNTRY_CODE = /^[A-Z]{2}$/;

// Names the bootstrap seeds (seed.data.ts) that datasets may reference by name.

export const PAYMENT_TERM_NAMES = new Set<string>(
  paymentTerms.map((pt) => pt.name)
);
export const RETURN_REASON_NAMES = new Set<string>(returnReasons);
export const SCRAP_REASON_NAMES = new Set<string>(scrapReasons);
export const NCR_TYPE_NAMES = new Set<string>(
  nonConformanceTypes.map((t) => t.name)
);
export const NCR_ACTION_NAMES = new Set<string>(
  nonConformanceRequiredActions.map((a) => a.name)
);
export const GAUGE_TYPE_NAMES = new Set<string>(gaugeTypes);
export const CO_TYPE_NAMES = new Set<string>(
  changeOrderTypes.map((t) => t.name)
);
export const CO_ACTION_NAMES = new Set<string>(
  changeOrderRequiredActions.map((a) => a.name)
);
export const UOM_CODES = new Set<string>(unitOfMeasures.map((u) => u.code));
export const FAILURE_MODE_NAMES = new Set<string>(failureModes);

// Bootstrap chart of accounts: posting-account number → class.
export const ACCOUNT_CLASS_BY_NUMBER = new Map<string, AccountClass>(
  accounts.flatMap((a) =>
    !a.isGroup && a.number && a.class
      ? [[a.number, a.class as AccountClass] as const]
      : []
  )
);
export const BOOTSTRAP_DIMENSION_NAMES = new Set<string>(
  dimensions.map((d) => d.name)
);
export const CLOSE_TASK_DEFINITION_NAMES = new Set<string>(
  periodCloseTaskDefinitions.map((d) => d.name)
);

/** Settlement decimals money is compared at: USD, every seeded company's base currency. */
export const USD_DECIMALS = currencies.find(
  (c) => c.code === "USD"
)!.decimalPlaces;

// Value sets every dataset must exhibit, so an edit can't silently drop a state
// the docs screenshot. An enum-backed set is the generated DB enum minus its
// `except` entries (each with its reason), so a new enum value fails every
// dataset until one exhibits it or it is excluded here. The rest are sets the
// DB types as free text.

type Enums = typeof Constants.public.Enums;

function enumValues<K extends keyof Enums>(
  name: K,
  except: Partial<Record<Enums[K][number], string>> = {}
): readonly Enums[K][number][] {
  return Constants.public.Enums[name].filter((value) => !(value in except));
}

/** `<scope>: no <what> "<value>" — every dataset must exhibit <tail>` */
const matrix =
  (scope: string, what: string, tail = "the full required set") =>
  (value: string) =>
    `${scope}: no ${what} "${value}" — every dataset must exhibit ${tail}`;

type Coverage = {
  values: readonly string[];
  missing: (value: string) => string;
};

const NOT_AUTHORABLE = "the dataset types cannot author it";
const OPTIONAL = "authorable, not required";

export const COVERAGE = {
  // ── Sales ──
  salesRfq: {
    values: enumValues("salesRfqStatus"),
    missing: matrix("sales status matrix", "salesRfq with status")
  },
  quote: {
    values: enumValues("quoteStatus"),
    missing: matrix("sales status matrix", "quote with status")
  },
  quoteLine: {
    values: enumValues("quoteLineStatus"),
    missing: matrix("sales status matrix", "quoteLine with status")
  },
  salesOrder: {
    values: enumValues("salesOrderStatus"),
    missing: matrix("sales status matrix", "salesOrder with status")
  },
  shipment: {
    values: enumValues("shipmentStatus", {
      Pending: "transient; the seed posts directly"
    }),
    missing: matrix("sales status matrix", "shipment with status")
  },
  salesInvoice: {
    values: enumValues("salesInvoiceStatus", {
      Pending: "transient; the seed posts directly",
      Return: "the return-invoice flow only"
    }),
    missing: matrix("sales status matrix", "salesInvoice with status")
  },
  salesReturn: {
    values: enumValues("salesReturnOrderStatus", { Cancelled: OPTIONAL }),
    missing: matrix("sales status matrix", "salesReturn with status")
  },
  arAgingBucket: {
    // get_ar_aging's default buckets, by days past due as of today.
    values: ["Current", "1-30", "31-60", "61-90"],
    missing: (bucket) =>
      `sales invoices: no open invoice in the "${bucket}" receivables aging bucket`
  },

  // ── Purchasing ──
  purchaseOrder: {
    values: enumValues("purchaseOrderStatus"),
    missing: matrix("purchasing status matrix", "purchaseOrder with status")
  },
  receipt: {
    values: enumValues("receiptStatus", {
      Pending: "transient; the seed posts directly"
    }),
    missing: matrix("purchasing status matrix", "receipt with status")
  },
  purchaseInvoice: {
    values: enumValues("purchaseInvoiceStatus", {
      Pending: "transient; the seed posts directly",
      Return: "the return-invoice flow only"
    }),
    missing: matrix("purchasing status matrix", "purchaseInvoice with status")
  },
  purchaseReturn: {
    values: enumValues("purchaseReturnOrderStatus", { Cancelled: OPTIONAL }),
    missing: matrix(
      "purchasing status matrix",
      "purchaseReturnOrder with status"
    )
  },
  supplierQuote: {
    values: enumValues("supplierQuoteStatus", { Cancelled: OPTIONAL }),
    missing: matrix("purchasing status matrix", "supplierQuote with status")
  },
  purchasingRfq: {
    values: enumValues("purchasingRfqStatus"),
    missing: matrix("purchasing status matrix", "purchasingRfq with status")
  },
  approvalRequestType: {
    values: enumValues("approvalDocumentType", {
      qualityDocument: "the seed requests approval for orders and suppliers"
    }),
    missing: (type) => `purchasing.approvalRequests: no ${type} request`
  },

  // ── Foundation, inventory, production ──
  procedureStatus: {
    values: enumValues("procedureStatus"),
    missing: matrix(
      "foundation status matrix",
      "procedure version with status",
      "all three"
    )
  },
  trackedEntityStatus: {
    values: enumValues("trackedEntityStatus", {
      Available: "opening lots exhibit it",
      Reserved: "job reservations exhibit it",
      Consumed: "genealogy exhibits it"
    }),
    missing: matrix(
      "inventory status matrix",
      "tracked entity with status",
      "it"
    )
  },
  jobDeadlineType: {
    values: enumValues("deadlineType"),
    missing: matrix(
      "production status matrix",
      "job with deadlineType",
      "all four"
    )
  },
  jobOperationOverride: {
    // Only the two mixed-floor states need an operationOverride.
    values: enumValues("jobOperationStatus", {
      Todo: "operationStatusFor derives it",
      Ready: "operationStatusFor derives it",
      Done: "operationStatusFor derives it",
      Canceled: "operationStatusFor derives it",
      Paused: "operationStatusFor derives it"
    }),
    missing: matrix(
      "production status matrix",
      "operationOverride with status",
      "the mixed-floor states"
    )
  },
  productionQuantityType: {
    values: enumValues("productionQuantityType"),
    missing: matrix(
      "production status matrix",
      "productionQuantity spec of type",
      "all three"
    )
  },
  pickingListStatus: {
    values: enumValues("pickingListStatus", {
      Draft: NOT_AUTHORABLE,
      Cancelled: NOT_AUTHORABLE,
      Partial: NOT_AUTHORABLE
    }),
    missing: matrix(
      "production status matrix",
      "picking list with status",
      "both"
    )
  },

  // ── Quality ──
  ncrStatus: {
    values: enumValues("nonConformanceStatus"),
    missing: matrix("quality matrix", "nonConformance status")
  },
  ncrPriority: {
    values: enumValues("nonConformancePriority"),
    missing: matrix("quality matrix", "nonConformance priority")
  },
  ncrSource: {
    values: enumValues("nonConformanceSource"),
    missing: matrix("quality matrix", "nonConformance source")
  },
  ncrTaskStatus: {
    values: enumValues("nonConformanceTaskStatus", {
      Skipped: "nothing in the issue flow requires skipping a task"
    }),
    missing: matrix("quality matrix", "nonConformanceActionTask status")
  },
  qualityDocumentStatus: {
    values: enumValues("qualityDocumentStatus"),
    missing: matrix("quality matrix", "qualityDocument status")
  },
  gaugeStatus: {
    values: enumValues("gaugeStatus"),
    missing: matrix("quality matrix", "gauge status")
  },
  gaugeCalibrationStatus: {
    values: enumValues("gaugeCalibrationStatus"),
    missing: matrix("quality matrix", "gauge calibration status")
  },
  riskStatus: {
    values: enumValues("riskStatus"),
    missing: matrix("quality matrix", "riskRegister status")
  },
  riskSource: {
    values: enumValues("riskSource", {
      "Quote Line": NOT_AUTHORABLE,
      "Work Center": OPTIONAL
    }),
    missing: matrix("quality matrix", "riskRegister source")
  },
  riskType: {
    values: enumValues("riskRegisterType"),
    missing: matrix("quality matrix", "riskRegister type")
  },
  inspectionStatus: {
    values: enumValues("inspectionStatusType", {
      "In Progress": OPTIONAL,
      Failed: NOT_AUTHORABLE
    }),
    missing: matrix("quality status matrix", "inspection lot with status")
  },
  inspectionSource: {
    values: enumValues("inspectionSourceDocument"),
    missing: matrix("quality status matrix", "inspection lot with source")
  },

  // ── Change orders ──
  changeOrderStatus: {
    values: enumValues("changeOrderStatus"),
    missing: matrix("change order matrix", "changeOrder status")
  },
  changeOrderTaskStatus: {
    values: enumValues("changeOrderTaskStatus"),
    missing: matrix("change order matrix", "changeOrderActionTask status")
  },

  // ── Accounting ──
  journalStatus: {
    values: enumValues("journalEntryStatus"),
    missing: (status) => `accounting.journalEntries: no "${status}" entry`
  },
  memoDirection: {
    values: enumValues("memoDirection"),
    missing: (direction) => `accounting.memos: no "${direction}" memo`
  },
  paymentType: {
    values: enumValues("paymentType"),
    missing: (type) => `accounting.payments: no "${type}" payment`
  },
  /** Draft payments render the payment's apply table. */
  draftPaymentType: {
    values: enumValues("paymentType"),
    missing: (type) => `accounting.payments: no Draft "${type}" payment`
  },
  periodCloseTaskStatus: {
    values: ["Open", "Done", "Skipped"],
    missing: (status) => `accounting.closeTasks: no "${status}" task`
  },
  fixedAssetStatus: {
    values: enumValues("fixedAssetStatus"),
    missing: (status) => `accounting.fixedAssets: no "${status}" asset`
  },

  // ── Ops ──
  dispatchStatus: {
    values: enumValues("maintenanceDispatchStatus"),
    missing: matrix("ops matrix", "maintenance dispatch with status")
  },
  dispatchSeverity: {
    values: enumValues("maintenanceSeverity"),
    missing: matrix("ops matrix", "maintenance dispatch with severity")
  },
  dispatchSource: {
    values: enumValues("maintenanceSource"),
    missing: matrix("ops matrix", "maintenance dispatch with source")
  },
  dispatchOeeImpact: {
    values: enumValues("oeeImpact"),
    missing: matrix("ops matrix", "maintenance dispatch with oeeImpact")
  },
  trainingStatus: {
    values: enumValues("trainingStatus", { Archived: OPTIONAL }),
    missing: matrix("ops matrix", "training with status")
  },
  workflowRunStatus: {
    values: ["Succeeded", "Failed", "Skipped"],
    missing: matrix("workflow run matrix", "run with status")
  },

  // ── Settings & people surfaces ──
  userAttributeType: {
    values: ["Date", "List", "User"],
    missing: (type) => `ops.userAttributeCategories: no ${type} attribute`
  },
  /** `<table>|<dataType>` */
  customField: {
    values: ["part|Text", "customer|User", "job|Yes/No"],
    missing: (key) => {
      const [table, dataType] = key.split("|");
      return `ops.customFields: no ${dataType} field on "${table}"`;
    }
  },
  printJobStatus: {
    values: ["completed", "failed", "queued"],
    missing: (status) => `ops.printJobs: no ${status} job`
  },
  printJobOrigin: {
    values: ["auto", "manual", "reprint"],
    missing: (origin) => `ops.printJobs: no ${origin} job`
  },

  // ── Commercial surfaces ──
  /** Every rule shape a screen lists: Sales Rules, Storage Rules, Work Center › Rules. */
  enforcementRuleShape: {
    values: ["sales", "storage:item", "storage:workCenter"] as const,
    missing: (shape) =>
      `items.enforcementRules: no ${shape} rule — every rules screen must list one`
  },
  salesRuleSeverity: {
    values: ["error", "warn"],
    missing: (severity) =>
      `items.enforcementRules: no sales rule with severity "${severity}"`
  }
} satisfies Record<string, Coverage>;

export type CoverageKey = keyof typeof COVERAGE;

/** Every value each named set requires but `exhibited` lacks, in call order. */
export function checkCoverage(
  fail: (message: string) => void,
  exhibited: Partial<Record<CoverageKey, ReadonlySet<string>>>
): void {
  for (const [key, seen] of Object.entries(exhibited)) {
    const { values, missing } = COVERAGE[key as CoverageKey];
    for (const value of values) if (!seen?.has(value)) fail(missing(value));
  }
}

export type RuleShape = (typeof COVERAGE.enforcementRuleShape.values)[number];

export const TRAINING_QUESTION_TYPES = enumValues("trainingQuestionType");

// Journal math for authored (manual) journal entries.

/** Class of a journal line's account, or undefined for an unknown number. */
export function lineClass(line: JournalLineSpec): AccountClass | undefined {
  return line.accountClass ?? ACCOUNT_CLASS_BY_NUMBER.get(line.account ?? "");
}

/** The journalEntries view signs amounts by account class, as posting does. */
export function journalImbalance(entry: JournalEntrySpec): number {
  return signedNet(
    entry.lines.flatMap((line) => {
      const accountClass = lineClass(line);
      // An unknown account is reported separately.
      return accountClass ? [{ accountClass, amount: line.amount }] : [];
    })
  );
}

// The bundled assembly graph.json sidecars, read with node:fs (assets.ts needs
// a bundler, so the validator cannot import them).

type GraphNode = {
  nodeId?: string;
  geometryHash?: string | null;
  isAssembly?: boolean;
  children?: GraphNode[];
};

function collectNodeIds(node: GraphNode, into: Set<string>): void {
  if (node.nodeId) into.add(node.nodeId);
  for (const child of node.children ?? []) collectNodeIds(child, into);
}

/** Leaf geometry hashes — what assemblyComponentMapping keys a component by. */
function collectGeometryHashes(node: GraphNode, into: Set<string>): void {
  if (node.geometryHash && !node.isAssembly) into.add(node.geometryHash);
  for (const child of node.children ?? []) collectGeometryHashes(child, into);
}

export function loadAssemblyGraph(
  industryId: string,
  model: string
): {
  nodeIds: Set<string>;
  geometryHashes: Set<string>;
  componentCount: number;
} | null {
  const datasetsDir = path.dirname(fileURLToPath(import.meta.url));
  const graphPath = path.join(
    datasetsDir,
    "assets",
    industryId,
    "models",
    `${model}.graph.json`
  );
  if (!existsSync(graphPath)) return null;
  const graph = JSON.parse(readFileSync(graphPath, "utf8")) as {
    componentCount: number;
    root: GraphNode;
  };
  const nodeIds = new Set<string>();
  collectNodeIds(graph.root, nodeIds);
  const geometryHashes = new Set<string>();
  collectGeometryHashes(graph.root, geometryHashes);
  return { nodeIds, geometryHashes, componentCount: graph.componentCount };
}

// Method-tree walks over items.methods: what a job of an item copies.

export type BomWalks = {
  methodByItem: Map<string, MakeMethodSpec>;
  /**
   * All components reachable from an item's method tree — the universe a
   * job's jobMaterial rows are copied from, so the universe a picking line
   * may name.
   */
  componentsOf(rootItem: string): Set<string>;
  rootOpCountOf(item: string): number;
  /** Root operations in the order the tier resolves 1-based positions against. */
  rootOpsOf(item: string): BopOperationSpec[];
  /**
   * Every operation copyMethodToJob gives a job of `item` beyond its root:
   * each Make-to-Order subassembly's, recursively.
   */
  subassemblyOpsOf(item: string): BopOperationSpec[];
};

export function bomWalks(
  items: ItemsData,
  makePartIds: ReadonlySet<string>
): BomWalks {
  const methodByItem = new Map(
    items.methods.map((method) => [method.readableId, method])
  );
  const componentsOf = (rootItem: string): Set<string> => {
    const components = new Set<string>();
    const visited = new Set<string>();
    const stack = [rootItem];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const method = methodByItem.get(current);
      if (!method) continue;
      for (const line of method.bom) {
        components.add(line.component);
        stack.push(line.component);
      }
    }
    return components;
  };
  const subassemblyOpsOf = (
    item: string,
    path: ReadonlySet<string> = new Set([item])
  ): BopOperationSpec[] => {
    const out: BopOperationSpec[] = [];
    for (const line of methodByItem.get(item)?.bom ?? []) {
      const madeHere =
        (line.methodType ??
          (makePartIds.has(line.component) ? "Make to Order" : "")) ===
        "Make to Order";
      if (!madeHere || path.has(line.component)) continue;
      out.push(...(methodByItem.get(line.component)?.bop ?? []));
      out.push(
        ...subassemblyOpsOf(line.component, new Set([...path, line.component]))
      );
    }
    return out;
  };
  return {
    methodByItem,
    componentsOf,
    rootOpCountOf: (item) => methodByItem.get(item)?.bop.length ?? 0,
    rootOpsOf: (item) =>
      [...(methodByItem.get(item)?.bop ?? [])].sort(
        (a, b) => a.order - b.order
      ),
    subassemblyOpsOf: (item) => subassemblyOpsOf(item)
  };
}

// Every document ref a spec declares (`quote:novasat`, `job:in-progress`, …),
// registered in tier order, as tier N's ctx.refs.documents holds them.

export type DocumentRefs = {
  /** A ref registered again after its first registration, in walk order. */
  duplicates: Array<{ where: string; ref: string }>;
  /** Whether `ref` is among the first `seen` registrations. */
  has(ref: string, seen: number): boolean;
  /**
   * How many registrations each reader sees — what ctx.refs.documents holds
   * when its tier reaches it: an RMA, job or NCR sees every ref registered up
   * to and including its own; risks see the whole quality slice, and workflow
   * runs everything through accounting.
   */
  seenBy: {
    salesReturns: number[];
    jobs: number[];
    nonConformances: number[];
    risks: number;
    workflowRuns: number;
  };
};

export function documentRefs(dataset: Dataset): DocumentRefs {
  const firstSeen = new Map<string, number>();
  const duplicates: DocumentRefs["duplicates"] = [];
  let count = 0;
  const register = (where: string, ref: string) => {
    if (firstSeen.has(ref)) duplicates.push({ where, ref });
    else firstSeen.set(ref, count);
    count += 1;
  };
  const seenBy: DocumentRefs["seenBy"] = {
    salesReturns: [],
    jobs: [],
    nonConformances: [],
    risks: 0,
    workflowRuns: 0
  };

  const opportunity = (where: string, spec: SalesOpportunitySpec) => {
    register(where, spec.ref);
    if (spec.rfq) register(where, spec.rfq.ref);
    if (spec.quote) {
      register(where, spec.quote.ref);
      for (const line of spec.quote.lines) register(where, line.ref);
      if (spec.quote.externalLink) {
        register(where, spec.quote.externalLink.ref);
      }
    }
    if (spec.order) {
      register(where, spec.order.ref);
      for (const line of spec.order.lines) register(where, line.ref);
    }
    if (spec.shipment) register(where, spec.shipment.ref);
    if (spec.invoice) {
      register(where, spec.invoice.ref);
      if (spec.invoice.key !== undefined) {
        register(where, `sinv:${spec.invoice.key}`);
      }
    }
  };
  const sales = dataset.sales;
  for (const [index, spec] of sales.opportunities.entries()) {
    opportunity(`sales.opportunities[${index}]`, spec);
  }
  for (const spec of sales.statusOrders) {
    const where = `sales.statusOrders "${spec.key}"`;
    register(where, `so:${spec.key}`);
    register(where, `soline:${spec.key}`);
    register(where, `opp:${spec.key}`);
  }
  for (const [index, spec] of sales.releasedOrders.entries()) {
    opportunity(`sales.releasedOrders[${index}]`, spec);
  }
  for (const rma of sales.salesReturns) {
    register(`sales.salesReturns "${rma.key}"`, `rma:${rma.key}`);
    seenBy.salesReturns.push(count);
  }

  const p = dataset.purchasing;
  for (const quote of p.rfqQuotes) {
    register(`purchasing.rfqQuotes "${quote.key}"`, `sq:${quote.key}`);
  }
  register("purchasing.rfqHeader", p.rfqHeader.ref);
  register("purchasing", `po:sq-${p.rfqWinningQuote}`);
  for (const rfq of p.lifecycleRfqs) {
    register(`purchasing.lifecycleRfqs "${rfq.ref}"`, rfq.ref);
  }
  for (const quote of p.standaloneSupplierQuotes) {
    register(
      `purchasing.standaloneSupplierQuotes "${quote.key}"`,
      `sq:${quote.key}`
    );
  }
  for (const [index, po] of p.purchaseOrders.entries()) {
    if (po.source !== "direct") continue;
    const where = `purchasing.purchaseOrders[${index}]`;
    if (po.ref !== undefined) register(where, po.ref);
    if (po.receipt) register(where, po.receipt.ref);
    if (po.invoice) {
      register(where, po.invoice.ref);
      if (po.invoice.key !== undefined) {
        register(where, `pinv:${po.invoice.key}`);
      }
    }
  }
  for (const ret of p.purchaseReturns) {
    register(`purchasing.purchaseReturns "${ret.key}"`, `pret:${ret.key}`);
  }

  for (const job of dataset.production.jobs) {
    register(`production.jobs "${job.key}"`, `job:${job.key}`);
    seenBy.jobs.push(count);
  }
  register(
    "production.genealogyAssembly",
    dataset.production.genealogyAssembly.ref
  );

  for (const insp of dataset.quality.inspections) {
    register(`quality.inspections "${insp.ref}"`, insp.ref);
  }
  for (const ncr of dataset.quality.nonConformances) {
    register(`quality.nonConformances "${ncr.ref}"`, ncr.ref);
    seenBy.nonConformances.push(count);
  }
  seenBy.risks = count;

  for (const co of dataset.changeOrders.changeOrders) {
    register(`changeOrders "${co.ref}"`, co.ref);
  }

  const a = dataset.accounting;
  for (const entry of a.journalEntries) {
    register("accounting.journalEntries", entry.ref);
    if (entry.reversal) {
      register("accounting.journalEntries", entry.reversal.ref);
    }
  }
  for (const memo of a.memos) {
    register(`accounting.memos "${memo.key}"`, `memo:${memo.key}`);
  }
  for (const payment of a.payments) {
    register(`accounting.payments "${payment.key}"`, `payment:${payment.key}`);
  }
  for (const asset of a.fixedAssets) {
    register("accounting.fixedAssets", `fixedAsset:${asset.key}`);
  }
  seenBy.workflowRuns = count;

  register("planning.demandOrder", dataset.planning.demandOrder.ref);

  return {
    duplicates,
    has: (ref, seen) => (firstSeen.get(ref) ?? Number.POSITIVE_INFINITY) < seen,
    seenBy
  };
}

// The shop floor as the MES board sees it: open operations per work center,
// running timers and assignments, derived from the released jobs.

export type FloorState = {
  openByWorkCenter: Map<string, number>;
  running: Set<string>;
  /** Work centers with an operation In Progress, timer or not. */
  active: Set<string>;
  assignedOpen: number;
  openInspection: boolean;
  /** The batch's first member runs the batch timer on an operation with no work center. */
  batchLeadWithoutWorkCenter: boolean;
};

export function floorState(
  dataset: Dataset,
  jobByKey: ReadonlyMap<string, JobSpec>,
  bom: BomWalks
): FloorState {
  const production = dataset.production;
  const { rootOpsOf, subassemblyOpsOf } = bom;
  const released = production.jobs.filter((job) =>
    RELEASED_OPEN_JOB_STATUSES.has(job.status)
  );
  // Open operations per work center, as the MES board filters them: released
  // job, operation not Done / Canceled. Overrides reach root operations only.
  const openByWorkCenter = new Map<string, number>();
  const running = new Set<string>();
  const active = new Set<string>();
  let assignedOpen = 0;
  let openInspection = false;
  const bump = (workCenter: string | undefined) => {
    if (workCenter === undefined) return;
    openByWorkCenter.set(
      workCenter,
      (openByWorkCenter.get(workCenter) ?? 0) + 1
    );
  };
  for (const job of released) {
    const initial = job.status === "Paused" ? "Paused" : "Ready";
    const roots = rootOpsOf(job.item);
    const overrides = new Map(
      (job.operationOverrides ?? []).map((o) => [o.order, o])
    );
    const ops: Array<{
      op: BopOperationSpec;
      status: string;
      root: boolean;
      order: number;
    }> = [
      ...roots.map((op, index) => ({
        op,
        status: overrides.get(index + 1)?.status ?? initial,
        root: true,
        order: index + 1
      })),
      ...subassemblyOpsOf(job.item).map((op) => ({
        op,
        status: initial,
        root: false,
        order: 0
      }))
    ];
    for (const { op, status, root, order } of ops) {
      if (status === "Done" || status === "Canceled") continue;
      bump(op.workCenter);
      if (op.operationType === "Inspection") openInspection = true;
      if (!root) continue;
      const override = overrides.get(order);
      if (override?.assignee === "self") assignedOpen += 1;
      if (override?.running && op.workCenter) running.add(op.workCenter);
      if (status === "In Progress" && op.workCenter) active.add(op.workCenter);
    }
  }
  const eventsJob = jobByKey.get(production.eventsJobKey);
  if (eventsJob) {
    const workCenter = rootOpsOf(eventsJob.item)[
      production.openEvent.operationOrder - 1
    ]?.workCenter;
    if (workCenter) {
      running.add(workCenter);
      active.add(workCenter);
    }
  }
  let batchLeadWithoutWorkCenter = false;
  const batchLead = production.batch.members[0];
  const batchLeadJob = batchLead && jobByKey.get(batchLead.job);
  if (batchLead && batchLeadJob) {
    const workCenter = rootOpsOf(batchLeadJob.item)[batchLead.order - 1]
      ?.workCenter;
    if (workCenter) {
      running.add(workCenter);
      active.add(workCenter);
    } else {
      batchLeadWithoutWorkCenter = true;
    }
  }
  return {
    openByWorkCenter,
    running,
    active,
    assignedOpen,
    openInspection,
    batchLeadWithoutWorkCenter
  };
}

// Net on-hand per (item, shelf) after every authored movement: opening stock,
// scrapped lots, posted count variances, completed stock and warehouse
// transfers, posted shipments, completed RMAs, posted receipts, completed
// purchase returns, completed picking lists and completed maintenance
// dispatches. A movement the slice's rule rejects (unknown shelf, tracked item,
// missing bin) is left out, as the tier would never write it.

export const onHandKey = (item: string, shelf: string) => `${item} @ ${shelf}`;

export function onHandLedger(
  dataset: Dataset,
  shelves: ReadonlySet<string>,
  isTracked: (item: string) => boolean,
  jobByKey: ReadonlyMap<string, JobSpec>
): Map<string, number> {
  const onHand = new Map<string, number>();
  const add = (item: string, shelf: string, delta: number) => {
    const key = onHandKey(item, shelf);
    onHand.set(key, (onHand.get(key) ?? 0) + delta);
  };
  const inventory = dataset.inventory;

  for (const stock of inventory.openingStock) {
    add(stock.item, stock.shelf, stock.qty);
  }
  for (const tracked of inventory.onHandTracked) {
    for (const entity of tracked.entities) {
      if (entity.scrap) add(tracked.item, entity.scrap.shelf, -entity.quantity);
    }
  }
  for (const count of inventory.inventoryCounts) {
    if (count.status !== "Posted") continue;
    for (const line of count.lines) {
      const delta = line.countedQuantity - line.snapshotQuantity;
      if (delta !== 0) add(line.item, line.shelf, delta);
    }
  }
  for (const transfer of inventory.stockTransfers) {
    if (transfer.status !== "Completed") continue;
    for (const line of transfer.lines) {
      add(line.item, transfer.fromShelf, -line.quantity);
      add(line.item, transfer.toShelf, line.quantity);
    }
  }
  for (const transfer of inventory.warehouseTransfers) {
    if (transfer.status !== "Completed") continue;
    for (const line of transfer.lines) {
      if (line.fromShelf !== undefined) {
        add(line.item, line.fromShelf, -line.quantity);
      }
    }
  }

  const shipped = (spec: SalesOpportunitySpec) => {
    if (spec.shipment?.status !== "Posted") return;
    for (const line of spec.shipment.lines) {
      if (
        line.shippedQuantity > 0 &&
        line.fromShelf !== undefined &&
        !isTracked(line.item) &&
        shelves.has(line.fromShelf)
      ) {
        add(line.item, line.fromShelf, -line.shippedQuantity);
      }
    }
  };
  for (const spec of dataset.sales.opportunities) shipped(spec);
  for (const spec of dataset.sales.releasedOrders) shipped(spec);
  for (const rma of dataset.sales.salesReturns) {
    if (rma.status !== "Completed") continue;
    for (const line of rma.lines) {
      if (line.toShelf !== undefined && shelves.has(line.toShelf)) {
        add(line.item, line.toShelf, line.quantity);
      }
    }
  }

  for (const po of dataset.purchasing.purchaseOrders) {
    if (po.source !== "direct" || po.receipt?.status !== "Posted") continue;
    for (const line of po.receipt.lines) {
      if (
        line.receivedQuantity > 0 &&
        line.toShelf !== undefined &&
        shelves.has(line.toShelf)
      ) {
        add(line.item, line.toShelf, line.receivedQuantity);
      }
    }
  }
  for (const ret of dataset.purchasing.purchaseReturns) {
    if (ret.status !== "Completed") continue;
    for (const line of ret.lines) {
      if (line.fromShelf !== undefined && shelves.has(line.fromShelf)) {
        add(line.item, line.fromShelf, -line.quantity);
      }
    }
  }

  for (const list of dataset.production.pickingLists) {
    if (!jobByKey.has(list.job) || list.status !== "Completed") continue;
    for (const line of list.lines) {
      if (shelves.has(line.fromShelf)) {
        add(line.item, line.fromShelf, -line.quantityPicked);
      }
    }
  }
  for (const dispatch of dataset.ops.maintenanceDispatches) {
    if (dispatch.status !== "Completed") continue;
    for (const part of dispatch.spareParts ?? []) {
      if (shelves.has(part.shelf)) add(part.item, part.shelf, -part.quantity);
    }
  }
  return onHand;
}

// Tracked-entity readableIds the seed mints before production: on-hand lots /
// serials (tier 03) and the lots posted batch receipt lines create (tier 05).

export type LotRegistry = {
  onHandIds: Set<string>;
  receiptLotIds: Set<string>;
  /** receiptLineKey of each posted batch line whose lotNumber was minted. */
  mintedReceiptLines: Set<string>;
};

export const receiptLineKey = (poIndex: number, lineIndex: number) =>
  `${poIndex}:${lineIndex}`;

export function lotRegistry(
  dataset: Dataset,
  trackingByItem: ReadonlyMap<string, string>
): LotRegistry {
  const onHandIds = new Set<string>();
  for (const tracked of dataset.inventory.onHandTracked) {
    for (const entity of tracked.entities) onHandIds.add(entity.readableId);
  }
  const receiptLotIds = new Set<string>();
  const mintedReceiptLines = new Set<string>();
  for (const [poIndex, po] of dataset.purchasing.purchaseOrders.entries()) {
    if (po.source !== "direct" || po.receipt?.status !== "Posted") continue;
    for (const [lineIndex, line] of po.receipt.lines.entries()) {
      if (
        !(line.receivedQuantity > 0) ||
        trackingByItem.get(line.item) !== "Batch" ||
        !line.requiresBatchTracking ||
        line.lotNumber === undefined ||
        onHandIds.has(line.lotNumber) ||
        receiptLotIds.has(line.lotNumber)
      ) {
        continue;
      }
      receiptLotIds.add(line.lotNumber);
      mintedReceiptLines.add(receiptLineKey(poIndex, lineIndex));
    }
  }
  return { onHandIds, receiptLotIds, mintedReceiptLines };
}

// Every projection the rules read, built once from the dataset alone.

/** What `need(kind, …)` calls a missing name: `unknown <label> "<id>"`. */
export const REF_LABELS = {
  item: "item",
  customer: "customer",
  supplier: "supplier",
  process: "process",
  ability: "ability",
  department: "department",
  workCenter: "work center",
  /** Plant work centers plus the HQ one — maintenance may target either. */
  maintainedWorkCenter: "work center",
  warehouse: "warehouse",
  shelf: "shelf",
  shift: "shift",
  storageType: "storageType",
  customerType: "customer type",
  supplierType: "supplier type",
  substance: "material substance",
  form: "material form",
  materialType: "material type",
  grade: "material grade",
  finish: "material finish",
  dimension: "material dimension"
} as const;
export type RefKind = keyof typeof REF_LABELS;

export type DatasetIndex = {
  refs: Record<RefKind, Set<string>>;
  itemBuckets: ReadonlyArray<readonly [string, readonly ItemSpec[]]>;
  makePartIds: Set<string>;
  toolIds: Set<string>;
  trackingByItem: Map<string, string>;
  standardCost: Map<string, number>;
  isTracked(item: string): boolean;
  customersWithContacts: Set<string>;
  suppliersWithContacts: Set<string>;
  /** Pending / Rejected / Inactive suppliers exist for the supplier list only. */
  activeSuppliers: Set<string>;
  bom: BomWalks;
  jobByKey: Map<string, JobSpec>;
  /** Sales order ref → orderDateOffset. */
  orderDateByRef: Map<string, number>;
  documentRefs: DocumentRefs;
  onHand: Map<string, number>;
  lots: LotRegistry;
  ncrRefs: Set<string>;
  floor: FloorState;
};

export function buildIndex(dataset: Dataset): DatasetIndex {
  const f = dataset.foundation;
  const items = dataset.items;
  const itemBuckets = [
    ["items.buyParts", items.buyParts],
    ["items.materials", items.materials],
    ["items.consumables", items.consumables],
    ["items.tools", items.tools],
    ["items.services", items.services],
    ["items.makeParts", items.makeParts]
  ] as const;
  const allItems = itemBuckets.flatMap(([, specs]) => specs);

  const suppliers = new Set(f.suppliers.map((s) => s.name));
  if (f.contractorAgency) suppliers.add(f.contractorAgency.name);
  const processes = new Set(f.processes.map((p) => p.name));
  for (const ability of f.abilities) processes.add(ability); // tier 01 mints a process per ability
  const workCenters = new Set(f.workCenters.map((w) => w.name));
  const taxonomy = f.materialTaxonomy;
  const refs: Record<RefKind, Set<string>> = {
    item: new Set(allItems.map((spec) => spec.readableId)),
    customer: new Set(f.customers.map((c) => c.name)),
    supplier: suppliers,
    process: processes,
    ability: new Set(f.abilities),
    department: new Set(f.departments),
    workCenter: workCenters,
    maintainedWorkCenter: new Set([...workCenters, f.hqWorkCenter.name]),
    warehouse: new Set(f.warehouses.map((w) => w.key)),
    shelf: new Set(f.shelves.map((s) => s.name)),
    shift: new Set(f.shifts.map((shift) => shift.name)),
    storageType: new Set(f.storageTypes),
    customerType: new Set(f.customerTypes),
    supplierType: new Set(f.supplierTypes),
    substance: new Set(taxonomy.substances.map((s) => s.name)),
    form: new Set(taxonomy.forms.map((s) => s.name)),
    materialType: new Set(taxonomy.types.map((t) => t.name)),
    grade: new Set(taxonomy.grades.map((g) => g.name)),
    finish: new Set(taxonomy.finishes.map((fi) => fi.name)),
    dimension: new Set(taxonomy.dimensions.map((d) => d.name))
  };

  const trackingByItem = new Map<string, string>();
  const standardCost = new Map<string, number>();
  for (const spec of allItems) {
    trackingByItem.set(spec.readableId, spec.trackingType ?? "Inventory");
    standardCost.set(spec.readableId, spec.standardCost ?? 0);
  }
  const isTracked = (item: string) => {
    const tracking = trackingByItem.get(item);
    return tracking === "Serial" || tracking === "Batch";
  };

  const activeSuppliers = new Set(
    f.suppliers
      .filter((s) => (s.status ?? "Active") === "Active")
      .map((s) => s.name)
  );
  if (f.contractorAgency) activeSuppliers.add(f.contractorAgency.name);

  const makePartIds = new Set(items.makeParts.map((spec) => spec.readableId));
  const bom = bomWalks(items, makePartIds);
  const jobByKey = new Map(
    dataset.production.jobs.map((job) => [job.key, job])
  );

  const orderDateByRef = new Map<string, number>();
  for (const spec of [
    ...dataset.sales.opportunities,
    ...dataset.sales.releasedOrders
  ]) {
    if (spec.order) {
      orderDateByRef.set(spec.order.ref, spec.order.orderDateOffset);
    }
  }
  for (const spec of dataset.sales.statusOrders) {
    orderDateByRef.set(`so:${spec.key}`, spec.orderDateOffset);
  }

  return {
    refs,
    itemBuckets,
    makePartIds,
    toolIds: new Set(items.tools.map((spec) => spec.readableId)),
    trackingByItem,
    standardCost,
    isTracked,
    customersWithContacts: new Set(f.customerContacts.map((cc) => cc.customer)),
    suppliersWithContacts: new Set(f.supplierContacts.map((sc) => sc.supplier)),
    activeSuppliers,
    bom,
    jobByKey,
    orderDateByRef,
    documentRefs: documentRefs(dataset),
    onHand: onHandLedger(dataset, refs.shelf, isTracked, jobByKey),
    lots: lotRegistry(dataset, trackingByItem),
    ncrRefs: new Set(dataset.quality.nonConformances.map((ncr) => ncr.ref)),
    floor: floorState(dataset, jobByKey, bom)
  };
}

export type ValidationCtx = {
  readonly dataset: Dataset;
  readonly ix: DatasetIndex;
  readonly violations: string[];
  fail(message: string): void;
  /** Fails `${where}: unknown <label> "<id>"` unless the dataset defines `id`. */
  need(kind: RefKind, where: string, id: string): void;
  /** A known customer that also has a contact, which tier 01 seeds its location from. */
  needCustomer(where: string, name: string): void;
};

/** One slice's checks. Rules only read the index, so their order is report order. */
export type Rule = (ctx: ValidationCtx) => void;

export function createContext(dataset: Dataset): ValidationCtx {
  const ix = buildIndex(dataset);
  const violations: string[] = [];
  const fail = (message: string) => {
    violations.push(message);
  };
  return {
    dataset,
    ix,
    violations,
    fail,
    need(kind, where, id) {
      if (!ix.refs[kind].has(id)) {
        fail(`${where}: unknown ${REF_LABELS[kind]} "${id}"`);
      }
    },
    needCustomer(where, name) {
      if (!ix.refs.customer.has(name)) {
        fail(`${where}: unknown customer "${name}"`);
      } else if (!ix.customersWithContacts.has(name)) {
        fail(
          `${where}: customer "${name}" has no customerContact, so no customer location is seeded for it`
        );
      }
    }
  };
}

/** A document ref names one seeded row: tiers key ctx.refs.documents by it. */
export function uniqueDocumentRefs(ctx: ValidationCtx): void {
  for (const { where, ref } of ctx.ix.documentRefs.duplicates) {
    ctx.fail(`${where}: duplicate document ref "${ref}"`);
  }
}

// Foundation: parties, work centers, shifts, shelves, procedures, taxonomy.

const MIN_PROCEDURES_WITH_PARAMETERS = 2;
const MIN_PARTNERS = 2;

export function foundation(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const f = dataset.foundation;

  // ── Foundation internal consistency ────────────────────────────────────────
  const nonEmpty: Array<[string, ReadonlyArray<unknown>]> = [
    ["foundation.departments", f.departments],
    ["foundation.abilities", f.abilities],
    ["foundation.processes", f.processes],
    ["foundation.workCenters", f.workCenters],
    ["foundation.customers", f.customers],
    ["foundation.customerContacts", f.customerContacts],
    ["foundation.suppliers", f.suppliers],
    ["foundation.supplierContacts", f.supplierContacts],
    ["foundation.procedures", f.procedures],
    ["foundation.shippingMethods", f.shippingMethods],
    ["foundation.warehouses", f.warehouses],
    ["foundation.shelves", f.shelves],
    ["foundation.shifts", f.shifts],
    ["foundation.holidays", f.holidays],
    ["foundation.tags", f.tags],
    ["foundation.materialTaxonomy.substances", f.materialTaxonomy.substances],
    ["foundation.materialTaxonomy.forms", f.materialTaxonomy.forms],
    ["foundation.materialTaxonomy.types", f.materialTaxonomy.types],
    ["foundation.materialTaxonomy.grades", f.materialTaxonomy.grades],
    ["foundation.materialTaxonomy.finishes", f.materialTaxonomy.finishes],
    ["foundation.materialTaxonomy.dimensions", f.materialTaxonomy.dimensions],
    ["items.buyParts", dataset.items.buyParts],
    ["items.materials", dataset.items.materials],
    ["items.consumables", dataset.items.consumables],
    ["items.tools", dataset.items.tools],
    ["items.services", dataset.items.services],
    ["items.makeParts", dataset.items.makeParts],
    ["items.methods", dataset.items.methods],
    ["items.supplierLinks", dataset.items.supplierLinks],
    ["items.batchProperties", dataset.items.batchProperties],
    ["items.supersessions", dataset.items.supersessions],
    ["items.customerParts", dataset.items.customerParts],
    ["items.priceOverrides", dataset.items.priceOverrides],
    ["items.pricingRules", dataset.items.pricingRules],
    ["items.revisionLadder", dataset.items.revisionLadder],
    ["inventory.openingStock", dataset.inventory.openingStock],
    ["inventory.onHandTracked", dataset.inventory.onHandTracked],
    ["inventory.kanbanItems", dataset.inventory.kanbanItems],
    ["inventory.inventoryCounts", dataset.inventory.inventoryCounts],
    ["inventory.shelfLives", dataset.inventory.shelfLives],
    ["inventory.stockTransfers", dataset.inventory.stockTransfers],
    ["inventory.warehouseTransfers", dataset.inventory.warehouseTransfers],
    ["sales.opportunities", dataset.sales.opportunities],
    ["sales.statusOrders", dataset.sales.statusOrders],
    ["sales.releasedOrders", dataset.sales.releasedOrders],
    ["sales.salesReturns", dataset.sales.salesReturns],
    ["purchasing.rfqLines", dataset.purchasing.rfqLines],
    ["purchasing.rfqQuotes", dataset.purchasing.rfqQuotes],
    ["purchasing.lifecycleRfqs", dataset.purchasing.lifecycleRfqs],
    ["purchasing.purchaseOrders", dataset.purchasing.purchaseOrders],
    ["production.jobs", dataset.production.jobs],
    ["production.genealogyInputs", dataset.production.genealogyInputs],
    ["production.pickingLists", dataset.production.pickingLists],
    ["quality.workflows", dataset.quality.workflows],
    ["quality.nonConformances", dataset.quality.nonConformances],
    ["quality.inspections", dataset.quality.inspections],
    ["quality.qualityDocuments", dataset.quality.qualityDocuments],
    ["quality.gauges", dataset.quality.gauges],
    ["quality.risks", dataset.quality.risks],
    ["changeOrders.changeOrders", dataset.changeOrders.changeOrders],
    ["accounting.fixedAssets", dataset.accounting.fixedAssets],
    ["accounting.journalEntries", dataset.accounting.journalEntries],
    ["ops.maintenanceSchedules", dataset.ops.maintenanceSchedules],
    ["ops.maintenanceDispatches", dataset.ops.maintenanceDispatches],
    ["ops.replacementParts", dataset.ops.replacementParts],
    ["ops.trainings", dataset.ops.trainings],
    ["ops.timecards", dataset.ops.timecards],
    ["ops.suggestions", dataset.ops.suggestions],
    ["ops.notes", dataset.ops.notes],
    ["workflows.runs", dataset.workflows.runs],
    ["planning.buyItemIds", dataset.planning.buyItemIds],
    ["planning.makeItemIds", dataset.planning.makeItemIds],
    ["planning.demandProjections", dataset.planning.demandProjections]
  ];
  for (const [where, arr] of nonEmpty) {
    if (arr.length === 0) fail(`${where}: must not be empty`);
  }

  if (!f.shippingMethods.includes(f.defaultShippingMethod)) {
    fail(
      `foundation.defaultShippingMethod "${f.defaultShippingMethod}" is not in shippingMethods`
    );
  }
  for (const wc of f.workCenters) {
    need("department", `foundation.workCenters "${wc.name}"`, wc.dept);
    need("ability", `foundation.workCenters "${wc.name}"`, wc.ability);
  }
  {
    const hq = f.hqWorkCenter;
    const where = `foundation.hqWorkCenter "${hq.name}"`;
    if (ix.refs.workCenter.has(hq.name)) {
      fail(`${where}: shares its name with a plant work center`);
    }
    need("department", where, hq.dept);
    need("ability", where, hq.ability);
  }
  // A partner row IS a supplier location, which tier 01 mints per supplier contact.
  const suppliersWithLocations = ix.suppliersWithContacts;
  const partnerKeys = new Set<string>();
  for (const partner of f.partners) {
    const where = `foundation.partners "${partner.supplier}" / "${partner.ability}"`;
    const key = `${partner.supplier}|${partner.ability}`;
    if (partnerKeys.has(key)) fail(`${where}: duplicate partner ability`);
    partnerKeys.add(key);
    if (!suppliersWithLocations.has(partner.supplier)) {
      fail(
        `${where}: supplier has no supplierContact, so no supplier location is seeded for it`
      );
    }
    need("ability", where, partner.ability);
    if (
      !Number.isInteger(partner.hoursPerWeek) ||
      partner.hoursPerWeek <= 0 ||
      partner.hoursPerWeek > 168
    ) {
      fail(`${where}: hoursPerWeek ${partner.hoursPerWeek} must be 1–168`);
    }
  }
  if (f.partners.length < MIN_PARTNERS) {
    fail(
      `foundation.partners: ${f.partners.length} partners, need ≥ ${MIN_PARTNERS} (Resources › Partners)`
    );
  }
  for (const [wcName, processName] of f.workCenterProcessLinks) {
    need("workCenter", "foundation.workCenterProcessLinks", wcName);
    need("process", "foundation.workCenterProcessLinks", processName);
  }
  for (const c of f.customers) {
    need("customerType", `foundation.customers "${c.name}"`, c.type);
  }
  for (const s of f.suppliers) {
    need("supplierType", `foundation.suppliers "${s.name}"`, s.type);
  }

  // ── Party currency + payment terms ─────────────────────────────────────────
  for (const party of [...f.customers, ...f.suppliers]) {
    if (party.currencyCode && !/^[A-Z]{3}$/.test(party.currencyCode)) {
      fail(
        `foundation parties "${party.name}": currencyCode "${party.currencyCode}" is not a 3-letter ISO code`
      );
    }
    if (party.paymentTerm && !PAYMENT_TERM_NAMES.has(party.paymentTerm)) {
      fail(
        `foundation parties "${party.name}": paymentTerm "${party.paymentTerm}" is not a bootstrap payment term`
      );
    }
  }
  // Convention: every dataset showcases at least one EUR supplier so the FX
  // and multi-currency purchasing screens have a party to render.
  if (!f.suppliers.some((s) => s.currencyCode === "EUR")) {
    fail(`foundation.suppliers: no supplier with currencyCode "EUR"`);
  }

  // ── Holidays ───────────────────────────────────────────────────────────────
  const holidayOffsets = new Set<number>();
  for (const holiday of f.holidays) {
    if (!Number.isFinite(holiday.dateOffset)) {
      fail(
        `foundation.holidays "${holiday.name}": dateOffset is not a finite number`
      );
    } else if (holidayOffsets.has(holiday.dateOffset)) {
      // holiday has UNIQUE (date, companyId), so a repeated offset would be
      // silently dropped by insertMaybe.
      fail(
        `foundation.holidays "${holiday.name}": duplicate dateOffset ${holiday.dateOffset}`
      );
    }
    holidayOffsets.add(holiday.dateOffset);
  }

  // ── Tags ───────────────────────────────────────────────────────────────────
  for (const tag of f.tags) {
    if (!tag.name.trim()) fail(`foundation.tags: empty tag name`);
    if (!tag.table.trim()) {
      fail(`foundation.tags "${tag.name}": empty table scope`);
    }
  }

  // ── Material taxonomy internal refs ────────────────────────────────────────
  const taxonomy = f.materialTaxonomy;
  for (const type of taxonomy.types) {
    need(
      "substance",
      `foundation.materialTaxonomy.types "${type.name}"`,
      type.substance
    );
    need("form", `foundation.materialTaxonomy.types "${type.name}"`, type.form);
  }
  for (const grade of taxonomy.grades) {
    need(
      "substance",
      `foundation.materialTaxonomy.grades "${grade.name}"`,
      grade.substance
    );
  }
  for (const finish of taxonomy.finishes) {
    need(
      "substance",
      `foundation.materialTaxonomy.finishes "${finish.name}"`,
      finish.substance
    );
  }
  for (const dimension of taxonomy.dimensions) {
    need(
      "form",
      `foundation.materialTaxonomy.dimensions "${dimension.name}"`,
      dimension.form
    );
  }
  for (const cc of f.customerContacts) {
    need("customer", "foundation.customerContacts", cc.customer);
  }
  for (const sc of f.supplierContacts) {
    need("supplier", "foundation.supplierContacts", sc.supplier);
  }
  for (const sp of f.supplierProcesses) {
    need("supplier", "foundation.supplierProcesses", sp.supplier);
    need("process", "foundation.supplierProcesses", sp.process);
  }
  for (const contractor of f.contractors) {
    need(
      "ability",
      `foundation.contractors "${contractor.lastName}"`,
      contractor.ability
    );
  }
  // ── Shifts: every work center staffed, the user's job resolvable ───────────
  const staffedWorkCenters = new Set<string>();
  const seenWorkCenterShifts = new Set<string>();
  for (const [wcName, shiftName] of f.workCenterShifts) {
    const key = `${wcName}|${shiftName}`;
    if (seenWorkCenterShifts.has(key)) {
      fail(
        `foundation.workCenterShifts: duplicate link "${wcName}" / "${shiftName}"`
      );
    }
    seenWorkCenterShifts.add(key);
    need("workCenter", "foundation.workCenterShifts", wcName);
    need("shift", "foundation.workCenterShifts", shiftName);
    staffedWorkCenters.add(wcName);
  }
  for (const wc of f.workCenters) {
    if (!staffedWorkCenters.has(wc.name)) {
      fail(
        `foundation.workCenterShifts: work center "${wc.name}" has no shift, so its shift picker and the scheduler's calendar are empty`
      );
    }
  }
  const job = f.employeeJob;
  if (!job.title.trim()) fail("foundation.employeeJob: empty title");
  need("department", "foundation.employeeJob", job.department);
  need("shift", "foundation.employeeJob", job.shift);
  if (!(job.startDateOffset < 0)) {
    fail(
      `foundation.employeeJob: startDateOffset ${job.startDateOffset} must be in the past`
    );
  }

  if (f.contractorAgency) {
    need(
      "supplierType",
      "foundation.contractorAgency",
      f.contractorAgency.type
    );
  }
  const seenShelves = new Set<string>();
  for (const shelf of f.shelves) {
    need("warehouse", `foundation.shelves "${shelf.name}"`, shelf.warehouse);
    need(
      "storageType",
      `foundation.shelves "${shelf.name}"`,
      shelf.storageType
    );
    if (shelf.parent !== undefined && !seenShelves.has(shelf.parent)) {
      fail(
        `foundation.shelves "${shelf.name}": parent "${shelf.parent}" is not defined before it (insertion order matters)`
      );
    }
    seenShelves.add(shelf.name);
  }
  const seenProcedureStatuses = new Set<string>();
  for (const proc of f.procedures) {
    need("process", `foundation.procedures "${proc.name}"`, proc.process);
    for (const version of proc.versions) {
      seenProcedureStatuses.add(version.status);
    }
    const parameterKeys = new Set<string>();
    for (const parameter of proc.parameters ?? []) {
      if (!parameter.key.trim() || !parameter.value.trim()) {
        fail(
          `foundation.procedures "${proc.name}": empty parameter key or value`
        );
      }
      if (parameterKeys.has(parameter.key)) {
        fail(
          `foundation.procedures "${proc.name}": duplicate parameter "${parameter.key}"`
        );
      }
      parameterKeys.add(parameter.key);
    }
    // One released version per procedure — Archived is what a release replaced.
    if (proc.versions.filter((v) => v.status === "Active").length > 1) {
      fail(
        `foundation.procedures "${proc.name}": more than one Active version`
      );
    }
  }
  const withParameters = f.procedures.filter(
    (proc) => (proc.parameters ?? []).length > 0
  ).length;
  if (withParameters < MIN_PROCEDURES_WITH_PARAMETERS) {
    fail(
      `foundation.procedures: ${withParameters} procedures carry parameters, need ≥ ${MIN_PROCEDURES_WITH_PARAMETERS} (procedure Parameters tab)`
    );
  }
  checkCoverage(fail, { procedureStatus: seenProcedureStatuses });
}

// Items: methods, inspection plans, taxonomy classification, pricing,
// configuration, revisions, batch properties.

export function itemIdentity(ctx: ValidationCtx): void {
  const itemIds = new Set<string>();
  for (const [bucket, specs] of ctx.ix.itemBuckets) {
    for (const spec of specs) {
      if (itemIds.has(spec.readableId)) {
        ctx.fail(`${bucket}: duplicate item readableId "${spec.readableId}"`);
      }
      itemIds.add(spec.readableId);
    }
  }
}

export function items(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need, needCustomer } = ctx;
  const f = dataset.foundation;
  const { makePartIds, toolIds, itemBuckets } = ix;
  const procedures = new Set(f.procedures.map((p) => p.name));
  const supplierProcessKeys = new Set(
    f.supplierProcesses.map((sp) => `sp:${sp.supplier}:${sp.process}`)
  );

  // ── Items slice ────────────────────────────────────────────────────────────
  for (const method of dataset.items.methods) {
    const where = `items.methods "${method.readableId}"`;
    if (!makePartIds.has(method.readableId)) {
      fail(`${where}: not a makePart readableId`);
    }
    for (const line of method.bom) {
      need("item", `${where} bom`, line.component);
    }
    for (const op of method.bop) {
      need("process", `${where} bop order ${op.order}`, op.process);
      if (op.workCenter !== undefined)
        need("workCenter", `${where} bop order ${op.order}`, op.workCenter);
      if (
        op.supplierProcess !== undefined &&
        !supplierProcessKeys.has(op.supplierProcess)
      ) {
        fail(
          `${where} bop order ${op.order}: unknown supplier process key "${op.supplierProcess}" (expected "sp:<supplier>:<process>" from foundation.supplierProcesses)`
        );
      }
      if (op.procedure !== undefined) {
        const name = op.procedure.replace(/^procedure:/, "");
        if (!op.procedure.startsWith("procedure:") || !procedures.has(name)) {
          fail(
            `${where} bop order ${op.order}: unknown procedure key "${op.procedure}" (expected "procedure:<name>" from foundation.procedures)`
          );
        }
      }
    }
  }
  for (const link of dataset.items.supplierLinks) {
    need("supplier", "items.supplierLinks", link.supplier);
    need("item", "items.supplierLinks", link.item);
  }

  // ── In-process inspection plans ────────────────────────────────────────────
  if (dataset.items.inspectionPlans.length === 0) {
    fail(
      `items.inspectionPlans: empty — the MES inspection view needs an Inspection operation with a plan`
    );
  }
  const inspectionPlanByKey = new Map<string, InspectionPlanSpec>();
  for (const plan of dataset.items.inspectionPlans) {
    const where = `items.inspectionPlans "${plan.key}"`;
    if (inspectionPlanByKey.has(plan.key)) fail(`${where}: duplicate key`);
    inspectionPlanByKey.set(plan.key, plan);
    if (!makePartIds.has(plan.item)) {
      fail(`${where}: "${plan.item}" is not a make part`);
    }
    if (!(plan.aql > 0)) fail(`${where}: aql must be positive`);
    if (plan.features.length === 0) fail(`${where}: no features`);
  }
  const referencedPlans = new Set<string>();
  for (const method of dataset.items.methods) {
    for (const op of method.bop) {
      const where = `items.methods "${method.readableId}" bop order ${op.order}`;
      const isInspection = op.operationType === "Inspection";
      if (isInspection !== (op.inspectionPlan !== undefined)) {
        fail(
          `${where}: an "Inspection" operation and an inspectionPlan go together — the MES inspection view needs both`
        );
      }
      if (op.inspectionPlan === undefined) continue;
      referencedPlans.add(op.inspectionPlan);
      const plan = inspectionPlanByKey.get(op.inspectionPlan);
      if (!plan) {
        fail(`${where}: unknown inspectionPlan "${op.inspectionPlan}"`);
      } else if (plan.item !== method.readableId) {
        fail(
          `${where}: plan "${plan.key}" inspects "${plan.item}" — the BOP picker lists only the item's own plans`
        );
      }
      if (op.workCenter === undefined) {
        fail(`${where}: an Inspection operation needs a work center`);
      }
    }
  }
  for (const key of inspectionPlanByKey.keys()) {
    if (!referencedPlans.has(key)) {
      fail(`items.inspectionPlans "${key}": no BOP operation uses it`);
    }
  }

  // ── Items depth ────────────────────────────────────────────────────────────
  const stockedItems = new Set(
    dataset.inventory.openingStock
      .filter((stock) => stock.qty > 0)
      .map((stock) => stock.item)
  );

  // BOP tools must resolve to Tool-bucket items.
  for (const method of dataset.items.methods) {
    for (const op of method.bop) {
      for (const tool of op.tools ?? []) {
        if (!toolIds.has(tool.tool)) {
          fail(
            `items.methods "${method.readableId}" bop order ${op.order}: tool "${tool.tool}" is not an items.tools readableId`
          );
        }
      }
    }
  }

  // Material taxonomy classification resolves against THIS dataset's taxonomy.
  for (const [bucket, specs] of itemBuckets) {
    for (const spec of specs) {
      const classification = spec.material;
      if (!classification) continue;
      const where = `${bucket} "${spec.readableId}" material`;
      if (spec.type !== "Material") {
        fail(`${where}: taxonomy classification on a non-Material item`);
      }
      if (classification.substance !== undefined) {
        need("substance", where, classification.substance);
      }
      if (classification.form !== undefined)
        need("form", where, classification.form);
      if (classification.materialType !== undefined)
        need("materialType", where, classification.materialType);
      if (classification.grade !== undefined)
        need("grade", where, classification.grade);
      if (classification.finish !== undefined)
        need("finish", where, classification.finish);
      if (classification.dimension !== undefined)
        need("dimension", where, classification.dimension);
    }
  }

  for (const [index, spec] of dataset.items.supersessions.entries()) {
    const where = `items.supersessions[${index}]`;
    need("item", where, spec.predecessor);
    need("item", where, spec.successor);
    if (spec.predecessor === spec.successor) {
      fail(`${where}: predecessor and successor are the same item`);
    }
    if (
      ix.refs.item.has(spec.predecessor) &&
      !stockedItems.has(spec.predecessor)
    ) {
      fail(
        `${where}: predecessor "${spec.predecessor}" has no opening stock, so "Consume First" has nothing to consume`
      );
    }
    for (const method of dataset.items.methods) {
      if (method.bom.some((line) => line.component === spec.successor)) {
        fail(
          `${where}: successor "${spec.successor}" is on the BOM of "${method.readableId}" — the successor must only be reached through the live redirect`
        );
      }
    }
  }

  for (const [index, spec] of dataset.items.customerParts.entries()) {
    const where = `items.customerParts[${index}]`;
    need("item", where, spec.item);
    needCustomer(where, spec.customer);
  }

  for (const [index, spec] of dataset.items.priceOverrides.entries()) {
    const where = `items.priceOverrides[${index}]`;
    need("item", where, spec.item);
    needCustomer(where, spec.customer);
    if (spec.breaks.length === 0) fail(`${where}: no price breaks`);
  }

  const pricingRuleNames = new Set<string>();
  for (const spec of dataset.items.pricingRules) {
    const where = `items.pricingRules "${spec.name}"`;
    if (pricingRuleNames.has(spec.name)) fail(`${where}: duplicate name`);
    pricingRuleNames.add(spec.name);
    if (spec.customer !== undefined) needCustomer(where, spec.customer);
    if (spec.customerType !== undefined)
      need("customerType", where, spec.customerType);
    for (const item of spec.items ?? []) need("item", where, item);
    if (spec.items?.length === 0) fail(`${where}: empty items list`);
    if (spec.amount <= 0) fail(`${where}: amount must be positive`);
    if (spec.amountType === "Percentage" && spec.amount > 100) {
      fail(`${where}: ${spec.amount}% is not a percentage in (0, 100]`);
    }
    if (spec.minQuantity !== undefined && spec.minQuantity <= 0) {
      fail(`${where}: minQuantity must be positive`);
    }
  }
  // The Pricing Rules list shows both rule types and a quantity break.
  for (const ruleType of ["Discount", "Markup"] as const) {
    if (!dataset.items.pricingRules.some((r) => r.ruleType === ruleType)) {
      fail(`items.pricingRules: no ${ruleType} rule`);
    }
  }
  if (!dataset.items.pricingRules.some((r) => r.minQuantity !== undefined)) {
    fail("items.pricingRules: no quantity-break rule (minQuantity)");
  }
  if (dataset.items.pricingRules.length < 3) {
    fail(
      `items.pricingRules: ${dataset.items.pricingRules.length} rules, need ≥ 3`
    );
  }

  // Convention: every dataset showcases one configurable make part.
  if (!dataset.items.configuration) {
    fail(`items.configuration: missing — every dataset showcases one`);
  } else {
    const cfg = dataset.items.configuration;
    const where = `items.configuration "${cfg.item}"`;
    if (!makePartIds.has(cfg.item)) {
      fail(`${where}: not a makePart readableId`);
    }
    for (const parameter of cfg.parameters) {
      if (
        parameter.dataType === "list" &&
        (parameter.listOptions === undefined ||
          parameter.listOptions.length === 0)
      ) {
        fail(`${where}: list parameter "${parameter.key}" has no listOptions`);
      }
    }
  }

  const revisionByItem = new Map(
    itemBuckets.flatMap(([, specs]) =>
      specs.map((spec) => [spec.readableId, spec.revision ?? "0"] as const)
    )
  );
  for (const [index, spec] of dataset.items.revisionLadder.entries()) {
    const where = `items.revisionLadder[${index}]`;
    need("item", where, spec.item);
    const activeRevision = revisionByItem.get(spec.item);
    const rungs = [spec.obsoleteRevision, spec.nextRevision];
    if (new Set(rungs).size !== rungs.length) {
      fail(`${where}: obsolete and next revisions must be distinct`);
    }
    for (const rung of rungs) {
      if (rung === activeRevision) {
        fail(
          `${where}: revision "${rung}" collides with the active revision of "${spec.item}"`
        );
      }
    }
  }
  // Tier 02 promotes each ladder's active revision to Production and every
  // other item keeps the Design default, so Prototype is the one status only
  // a ladder rung can supply.
  if (
    !dataset.items.revisionLadder.some(
      (spec) => spec.nextStatus === "Prototype"
    )
  ) {
    fail(
      `items.revisionLadder: no rung with nextStatus "Prototype" — every itemRevisionStatus must be on screen`
    );
  }
}

export function batchProperties(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const trackingByItem = ix.trackingByItem;
  // Batch properties: every Batch-tracked item records at least one per-lot attribute.
  const batchPropertyLabels = new Set<string>();
  for (const property of dataset.items.batchProperties) {
    const where = `items.batchProperties "${property.item}" "${property.label}"`;
    need("item", where, property.item);
    if (trackingByItem.get(property.item) !== "Batch") {
      fail(`${where}: batch property on a non-Batch-tracked item`);
    }
    const key = `${property.item}\u0000${property.label}`;
    if (batchPropertyLabels.has(key)) fail(`${where}: label listed twice`);
    batchPropertyLabels.add(key);
    const isList = property.dataType === "list";
    if (isList !== (property.listOptions !== undefined)) {
      fail(`${where}: listOptions are required exactly for a "list" property`);
    }
    if (isList && (property.listOptions ?? []).length < 2) {
      fail(`${where}: a list property needs ≥ 2 options`);
    }
  }
  for (const [item, tracking] of trackingByItem) {
    if (
      tracking === "Batch" &&
      !dataset.items.batchProperties.some((p) => p.item === item)
    ) {
      fail(
        `items.batchProperties: Batch-tracked "${item}" has no batch property (item › Purchasing tab)`
      );
    }
  }
}

// Inventory: opening and tracked stock, kanbans, counts, transfers, and the
// net on-hand balance every slice's movements leave behind.

export function openingStock(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const { trackingByItem } = ix;
  for (const stock of dataset.inventory.openingStock) {
    need("item", "inventory.openingStock", stock.item);
    need("shelf", `inventory.openingStock "${stock.item}"`, stock.shelf);
  }

  for (const shelfLife of dataset.inventory.shelfLives) {
    const where = `inventory.shelfLives "${shelfLife.item}"`;
    need("item", where, shelfLife.item);
    if (trackingByItem.get(shelfLife.item) !== "Batch") {
      fail(`${where}: shelf life on a non-Batch-tracked item`);
    }
    if (shelfLife.days <= 0) fail(`${where}: days must be positive`);
  }
}

export function trackedStockAndMovements(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const { makePartIds, isTracked } = ix;
  const shelfLifeItems = new Set(
    dataset.inventory.shelfLives.map((sl) => sl.item)
  );
  const trackedEntityQty = new Map<string, number>();
  const trackedStatuses = new Set<string>();
  for (const tracked of dataset.inventory.onHandTracked) {
    need("item", "inventory.onHandTracked", tracked.item);
    for (const entity of tracked.entities) {
      if (trackedEntityQty.has(entity.readableId)) {
        fail(
          `inventory.onHandTracked: duplicate tracked entity readableId "${entity.readableId}"`
        );
      }
      trackedEntityQty.set(entity.readableId, entity.quantity);
      trackedStatuses.add(entity.status ?? "Available");
      if (
        entity.status !== undefined &&
        !["Available", "On Hold", "Rejected", "Scrapped"].includes(
          entity.status
        )
      ) {
        fail(
          `inventory.onHandTracked "${entity.readableId}": unsupported status "${entity.status}"`
        );
      }
      // A Scrapped lot carries the scrap posting (tier 03 scrapLot): its
      // quantity leaves the shelf, so it draws on the net on-hand balance.
      if ((entity.status === "Scrapped") !== (entity.scrap !== undefined)) {
        fail(
          `inventory.onHandTracked "${entity.readableId}": a scrap spec is required on, and only on, a Scrapped lot`
        );
      }
      if (entity.scrap) {
        const where = `inventory.onHandTracked "${entity.readableId}" scrap`;
        need("shelf", where, entity.scrap.shelf);
        if (!SCRAP_REASON_NAMES.has(entity.scrap.reason)) {
          fail(
            `${where}: reason "${entity.scrap.reason}" is not a bootstrap scrap reason`
          );
        }
        if (entity.scrap.dateOffset >= 0) {
          fail(`${where}: dateOffset must be in the past`);
        }
      }
      if (
        entity.expiresOffset !== undefined &&
        !shelfLifeItems.has(tracked.item)
      ) {
        fail(
          `inventory.onHandTracked "${entity.readableId}": expiresOffset on "${tracked.item}", which has no inventory.shelfLives spec`
        );
      }
    }
  }

  checkCoverage(fail, { trackedEntityStatus: trackedStatuses });

  for (const kanban of dataset.inventory.kanbanItems) {
    const where = `inventory.kanbanItems "${kanban.item}"`;
    need("item", where, kanban.item);
    const system = kanban.replenishmentSystem ?? "Buy";
    if (system === "Buy") {
      if (kanban.supplier === undefined) {
        fail(`${where}: Buy kanban has no supplier`);
      } else {
        need("supplier", where, kanban.supplier);
      }
    }
    if (system === "Make" && !makePartIds.has(kanban.item)) {
      fail(`${where}: Make kanban on an item that is not a makePart`);
    }
    if (system === "Transfer") {
      if (!kanban.fromShelf || !kanban.toShelf) {
        fail(`${where}: Transfer kanban needs fromShelf and toShelf`);
      } else {
        need("shelf", where, kanban.fromShelf);
        need("shelf", where, kanban.toShelf);
        if (kanban.fromShelf === kanban.toShelf) {
          fail(`${where}: Transfer kanban's shelves must differ`);
        }
      }
    }
  }

  // ── Inventory counts ───────────────────────────────────────────────────────
  const inventoryKeys = new Set<string>();
  const uniqueKey = (where: string, key: string) => {
    if (inventoryKeys.has(key)) fail(`${where}: duplicate key "${key}"`);
    inventoryKeys.add(key);
  };
  const openingQty = new Map<string, number>();
  for (const stock of dataset.inventory.openingStock) {
    openingQty.set(onHandKey(stock.item, stock.shelf), stock.qty);
  }
  for (const count of dataset.inventory.inventoryCounts) {
    const where = `inventory.inventoryCounts "${count.key}"`;
    uniqueKey(where, count.key);
    if (count.status === "Posted" && count.postedOffset === undefined) {
      fail(`${where}: Posted count has no postedOffset`);
    }
    let variances = 0;
    for (const line of count.lines) {
      need("item", where, line.item);
      need("shelf", where, line.shelf);
      if (count.status !== "Posted") continue;
      // A posted count's snapshot IS the opening balance — the seed has no
      // other movement dated before it (completed transfers are authored
      // later on the timeline), so any other snapshot is variance dishonesty.
      const opening = openingQty.get(onHandKey(line.item, line.shelf)) ?? 0;
      if (line.snapshotQuantity !== opening) {
        fail(
          `${where} line "${line.item}": snapshotQuantity ${line.snapshotQuantity} != opening stock ${opening} at "${line.shelf}"`
        );
      }
      const delta = line.countedQuantity - line.snapshotQuantity;
      if (delta !== 0) {
        variances += 1;
      }
    }
    if (count.status === "Posted" && variances === 0) {
      fail(`${where}: Posted count has no non-zero variance line`);
    }
  }

  // ── Stock transfers ────────────────────────────────────────────────────────
  for (const transfer of dataset.inventory.stockTransfers) {
    const where = `inventory.stockTransfers "${transfer.key}"`;
    uniqueKey(where, transfer.key);
    for (const shelf of [transfer.fromShelf, transfer.toShelf]) {
      need("shelf", where, shelf);
    }
    if (transfer.fromShelf === transfer.toShelf) {
      fail(`${where}: fromShelf and toShelf must differ`);
    }
    for (const line of transfer.lines) {
      need("item", where, line.item);
      if (line.quantity <= 0) {
        fail(`${where} line "${line.item}": quantity must be positive`);
      }
      if (isTracked(line.item)) {
        fail(
          `${where} line "${line.item}": tracked items need per-entity moves the seed does not model`
        );
      }
    }
  }

  // ── Warehouse transfers ────────────────────────────────────────────────────
  for (const transfer of dataset.inventory.warehouseTransfers) {
    const where = `inventory.warehouseTransfers "${transfer.key}"`;
    uniqueKey(where, transfer.key);
    if (transfer.fromLocation === transfer.toLocation) {
      fail(`${where}: fromLocation and toLocation must differ`);
    }
    if (transfer.status === "Completed" && transfer.fromLocation !== "Plant") {
      fail(
        `${where}: Completed transfer must ship from Plant — the datasets stock no other location`
      );
    }
    for (const line of transfer.lines) {
      need("item", where, line.item);
      if (line.quantity <= 0) {
        fail(`${where} line "${line.item}": quantity must be positive`);
      }
      if (isTracked(line.item)) {
        fail(
          `${where} line "${line.item}": tracked items need per-entity moves the seed does not model`
        );
      }
      if (line.fromShelf !== undefined) need("shelf", where, line.fromShelf);
      if (transfer.status === "Completed" && line.fromShelf === undefined) {
        fail(
          `${where} line "${line.item}": Completed transfer line needs a fromShelf`
        );
      }
    }
  }
}

export function netOnHand(ctx: ValidationCtx): void {
  // ── Net on-hand ≥ 0 per (item, shelf), across every slice ──────────────────
  for (const [key, net] of ctx.ix.onHand) {
    if (net < 0) {
      ctx.fail(
        `inventory: net on-hand for ${key} is ${net} — count variances, completed transfers, posted shipments, completed purchase returns, completed picking lists and completed maintenance dispatches drain more than the opening stock and posted receipts provide`
      );
    }
  }
}

// Sales: opportunities (RFQ → quote → order → shipment → invoice), status
// orders, RMAs, and the sales status matrix.

export function sales(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need, needCustomer } = ctx;
  const f = dataset.foundation;
  const { isTracked } = ix;

  // Statuses actually exhibited by this dataset's sales slice, checked against
  // COVERAGE (required.ts) after every spec has been walked.
  const seenStatuses = {
    salesRfq: new Set<string>(),
    quote: new Set<string>(),
    quoteLine: new Set<string>(),
    salesOrder: new Set<string>(),
    shipment: new Set<string>(),
    salesInvoice: new Set<string>(),
    salesReturn: new Set<string>()
  };
  const noQuoteReasons = new Set(f.noQuoteReasons);

  const checkOpportunity = (
    where: string,
    spec: SalesOpportunitySpec
  ): void => {
    needCustomer(where, spec.customer);
    if (spec.rfq) {
      seenStatuses.salesRfq.add(spec.rfq.status);
      if (
        spec.rfq.noQuoteReason !== undefined &&
        !noQuoteReasons.has(spec.rfq.noQuoteReason)
      ) {
        fail(
          `${where} rfq: noQuoteReason "${spec.rfq.noQuoteReason}" is not in foundation.noQuoteReasons`
        );
      }
      for (const line of spec.rfq.lines)
        need("item", `${where} rfq`, line.item);
    }
    if (spec.quote) {
      seenStatuses.quote.add(spec.quote.status);
      for (const line of spec.quote.lines) {
        need("item", `${where} quote`, line.item);
        seenStatuses.quoteLine.add(line.status);
        // A "No Quote" line was declined — it never got priced, so it is the
        // one line status allowed to carry no breaks.
        if (line.priceBreaks.length === 0 && line.status !== "No Quote") {
          fail(`${where} quote line "${line.ref}": no price breaks`);
        }
      }
    }
    if (spec.order) {
      seenStatuses.salesOrder.add(spec.order.status);
      for (const line of spec.order.lines) {
        need("item", `${where} order`, line.item);
        if (
          line.promisedDateOffset !== undefined &&
          (line.promisedDateOffset < 0 ||
            line.promisedDateOffset >= HORIZON_DAYS)
        ) {
          fail(
            `${where} order line "${line.ref}": promisedDateOffset ${line.promisedDateOffset} outside the ${HORIZON_DAYS}-day planning horizon`
          );
        }
      }
    }
    if (spec.shipment) {
      if (!spec.order) fail(`${where}: shipment without an order`);
      seenStatuses.shipment.add(spec.shipment.status);
      const posted = spec.shipment.status === "Posted";
      if (posted && spec.shipment.postedOffset === undefined) {
        fail(`${where} shipment: Posted shipment has no postedOffset`);
      }
      if (
        posted &&
        spec.order &&
        spec.shipment.postedOffset !== undefined &&
        spec.shipment.postedOffset < spec.order.orderDateOffset
      ) {
        fail(
          `${where} shipment: postedOffset ${spec.shipment.postedOffset} is before the order's orderDateOffset ${spec.order.orderDateOffset}`
        );
      }
      const orderItems = new Set(spec.order?.lines.map((l) => l.item) ?? []);
      for (const line of spec.shipment.lines) {
        need("item", `${where} shipment`, line.item);
        if (spec.order && !orderItems.has(line.item)) {
          fail(
            `${where} shipment: item "${line.item}" is not a line on the opportunity's order`
          );
        }
        if (line.shippedQuantity > line.orderQuantity) {
          fail(
            `${where} shipment: shippedQuantity ${line.shippedQuantity} exceeds orderQuantity ${line.orderQuantity} for "${line.item}"`
          );
        }
        if (line.fromShelf !== undefined)
          need("shelf", `${where} shipment`, line.fromShelf);
        if (posted && line.shippedQuantity > 0) {
          if (line.fromShelf === undefined) {
            fail(
              `${where} shipment: Posted line "${line.item}" needs a fromShelf`
            );
          } else if (isTracked(line.item)) {
            fail(
              `${where} shipment: tracked item "${line.item}" needs per-entity shipping the seed does not model`
            );
          }
        }
      }
    }
    if (spec.invoice) {
      if (!spec.order) fail(`${where}: invoice without an order`);
      seenStatuses.salesInvoice.add(spec.invoice.status);
      if (
        spec.order &&
        spec.invoice.dateIssuedOffset < spec.order.orderDateOffset
      ) {
        fail(
          `${where} invoice "${spec.invoice.ref}": dateIssuedOffset ${spec.invoice.dateIssuedOffset} is before the order's orderDateOffset ${spec.order.orderDateOffset}`
        );
      }
      const orderItems = new Set(spec.order?.lines.map((l) => l.item) ?? []);
      for (const line of spec.invoice.lines) {
        need("item", `${where} invoice`, line.item);
        if (spec.order && !orderItems.has(line.item)) {
          fail(
            `${where} invoice: item "${line.item}" is not a line on the opportunity's order`
          );
        }
      }
      const lineTotal = spec.invoice.lines.reduce(
        (sum, line) => sum + line.quantity * line.unitPrice,
        0
      );
      if (Math.abs(lineTotal - spec.invoice.subtotal) > 0.01) {
        fail(
          `${where} invoice "${spec.invoice.ref}": subtotal ${spec.invoice.subtotal} does not equal its lines' total ${lineTotal}`
        );
      }
    }
  };

  for (const [index, spec] of dataset.sales.opportunities.entries()) {
    checkOpportunity(`sales.opportunities[${index}]`, spec);
  }
  for (const spec of dataset.sales.statusOrders) {
    const where = `sales.statusOrders "${spec.key}"`;
    needCustomer(where, spec.customer);
    need("item", where, spec.item);
    seenStatuses.salesOrder.add(spec.status);
  }
  for (const [index, spec] of dataset.sales.releasedOrders.entries()) {
    checkOpportunity(`sales.releasedOrders[${index}]`, spec);
  }

  // ── Sales returns (RMAs) ───────────────────────────────────────────────────
  const { documentRefs } = ix;
  for (const [rmaIndex, rma] of dataset.sales.salesReturns.entries()) {
    const where = `sales.salesReturns "${rma.key}"`;
    needCustomer(where, rma.customer);
    seenStatuses.salesReturn.add(rma.status);
    if (!RETURN_REASON_NAMES.has(rma.returnReason)) {
      fail(
        `${where}: returnReason "${rma.returnReason}" is not a bootstrap return reason`
      );
    }
    if (
      rma.salesOrder !== undefined &&
      !documentRefs.has(
        rma.salesOrder,
        documentRefs.seenBy.salesReturns[rmaIndex]!
      )
    ) {
      fail(`${where}: unknown sales order ref "${rma.salesOrder}"`);
    }
    if (rma.lines.length === 0) fail(`${where}: no lines`);
    for (const line of rma.lines) {
      need("item", where, line.item);
      if (line.quantity <= 0) {
        fail(`${where} line "${line.item}": quantity must be positive`);
      }
      if (isTracked(line.item)) {
        fail(
          `${where} line "${line.item}": tracked items need per-entity returns the seed does not model`
        );
      }
      if (line.toShelf !== undefined) need("shelf", where, line.toShelf);
      if (rma.status === "Completed") {
        if (line.toShelf === undefined) {
          fail(
            `${where} line "${line.item}": Completed return line needs a toShelf`
          );
        }
      }
    }
  }

  // ── Status matrix — every required sales status must be exhibited ─────────
  checkCoverage(fail, seenStatuses);
}

// The sales and purchasing screens beyond status coverage: the configurator,
// "Assigned to me", quote creation dates, customer portals, bank accounts and
// approvals.

/** Sales/purchasing dashboards' "Assigned to me" needs a few of each. */
const MIN_ASSIGNED_OPEN_DOCUMENTS = 2;
const MIN_CUSTOMER_PORTALS = 2;
/** The KPI charts' default window; quotes created in it keep them from being one spike. */
const KPI_WINDOW_DAYS = 30;

// The dashboards' own "open" status lists (sales+/_index.tsx, purchasing+/_index.tsx).
const OPEN_QUOTE_STATUSES = new Set(["Draft", "Sent", "Partial"]);
const OPEN_SALES_RFQ_STATUSES = new Set(["Draft", "Ready for Quote"]);
const OPEN_SALES_ORDER_STATUSES = new Set([
  "Draft",
  "Needs Approval",
  "Confirmed",
  "In Progress",
  "To Ship and Invoice",
  "To Ship",
  "To Invoice"
]);
const OPEN_PURCHASE_ORDER_STATUSES = new Set([
  "Planned",
  "Draft",
  "To Review",
  "Needs Approval",
  "To Receive",
  "To Receive and Invoice",
  "To Invoice"
]);
const OPEN_PURCHASING_RFQ_STATUSES = new Set(["Draft", "Requested"]);
const OPEN_SUPPLIER_QUOTE_STATUSES = new Set(["Draft", "Active"]);
const CURRENCY_CODE = /^[A-Z]{3}$/;

function checkBankAccount(
  where: string,
  spec: BankAccountSpec,
  fail: (message: string) => void
): void {
  // Visibly fake: a real-looking number in a demo is a credential-shaped leak.
  if (!spec.accountNumber.startsWith("DEMO-")) {
    fail(`${where}: accountNumber must start with "DEMO-"`);
  }
  if (spec.bankCode !== undefined && !spec.bankCode.startsWith("DEMO-")) {
    fail(`${where}: bankCode must start with "DEMO-"`);
  }
  if (spec.swiftBic !== undefined && !spec.swiftBic.startsWith("DEMO")) {
    fail(`${where}: swiftBic must start with "DEMO"`);
  }
  if (!COUNTRY_CODE.test(spec.countryCode)) {
    fail(`${where}: countryCode "${spec.countryCode}" is not ISO alpha-2`);
  }
  if (!CURRENCY_CODE.test(spec.currencyCode)) {
    fail(`${where}: currencyCode "${spec.currencyCode}" is not ISO 4217`);
  }
}

export function commercial(ctx: ValidationCtx): void {
  const { dataset, fail, need, needCustomer } = ctx;
  const f = dataset.foundation;
  // ── Configurator ──────────────────────────────────────────────────────────
  const cfg = dataset.items.configuration;
  const cfgWhere = `items.configuration "${cfg.item}"`;
  const method = dataset.items.methods.find((m) => m.readableId === cfg.item);
  const parameterByKey = new Map(cfg.parameters.map((p) => [p.key, p]));
  if (cfg.rules.length === 0) {
    fail(`${cfgWhere}: no rules — the configurator would change nothing`);
  }
  if (!method) fail(`${cfgWhere}: the configurable item has no method`);
  const ruleTargets = new Set<string>();
  for (const rule of cfg.rules) {
    const target =
      "component" in rule.target
        ? `component ${rule.target.component}`
        : `operation ${rule.target.operation}`;
    const where = `${cfgWhere} rule ${rule.field}:${target}`;
    if (ruleTargets.has(`${rule.field}:${target}`)) {
      fail(`${where}: duplicate rule`);
    }
    ruleTargets.add(`${rule.field}:${target}`);
    if ("component" in rule.target) {
      const component = rule.target.component;
      if (method && !method.bom.some((line) => line.component === component)) {
        fail(`${where}: "${component}" is not on the item's BOM`);
      }
      if (rule.field !== "quantity" && rule.field !== "methodType") {
        fail(`${where}: a BOM line takes quantity or methodType rules`);
      }
    } else {
      const position = rule.target.operation;
      if (method && (position < 1 || position > method.bop.length)) {
        fail(`${where}: the BOP has ${method.bop.length} operations`);
      }
      if (rule.field === "quantity" || rule.field === "methodType") {
        fail(`${where}: an operation takes time rules`);
      }
    }
    if (!/\breturn\b/.test(rule.code)) {
      fail(`${where}: code never returns a value`);
    }
    for (const match of rule.code.matchAll(/params\.(\w+)/g)) {
      if (!parameterByKey.has(match[1] ?? "")) {
        fail(`${where}: code reads unknown parameter "${match[1]}"`);
      }
    }
  }

  // Tier 04 copies the method as authored — the seed cannot run rule code the
  // way get-method does — so a configured line must pick parameter values
  // whose rule results equal the method's own numbers, or the quote's BoM/BoP
  // would disagree with its configuration.
  const checkConfiguredDefaults = (
    where: string,
    configuration: Record<string, string | number | boolean>
  ) => {
    if (!method) return;
    for (const rule of cfg.rules) {
      let expected: number | undefined;
      if ("component" in rule.target) {
        const component = rule.target.component;
        const bomLine = method.bom.find((l) => l.component === component);
        expected = rule.field === "quantity" ? bomLine?.quantity : undefined;
      } else {
        const op = method.bop[rule.target.operation - 1];
        expected =
          rule.field === "laborTime"
            ? (op?.laborTime ?? 0)
            : rule.field === "setupTime"
              ? (op?.setupTime ?? 0)
              : rule.field === "machineTime"
                ? (op?.machineTime ?? 0)
                : undefined;
      }
      if (expected === undefined) continue;
      let actual: unknown;
      try {
        // Authored rule bodies from this repository, evaluated like the
        // configurator's own preview does.
        actual = new Function("params", rule.code)(configuration);
      } catch (error) {
        fail(`${where}: rule ${rule.field} throws: ${String(error)}`);
        continue;
      }
      if (actual !== expected) {
        fail(
          `${where}: rule ${rule.field} yields ${String(actual)} but the copied method has ${expected} — pick values that keep the method's defaults`
        );
      }
    }
  };

  // ── Quotes: creation dates, configured lines; assignees on open documents ─
  let configuredLines = 0;
  let recentQuotes = 0;
  const assigned = {
    quote: 0,
    salesRfq: 0,
    salesOrder: 0,
    purchaseOrder: 0,
    purchasingRfq: 0,
    supplierQuote: 0
  };
  const checkAssignee = (
    where: string,
    assignee: "self" | undefined,
    status: string,
    open: Set<string>,
    kind: keyof typeof assigned
  ) => {
    if (assignee === undefined) return;
    if (!open.has(status)) {
      fail(
        `${where}: assignee on a ${status} document — only open work is assigned`
      );
    } else {
      assigned[kind] += 1;
    }
  };
  for (const spec of [
    ...dataset.sales.opportunities,
    ...dataset.sales.releasedOrders
  ]) {
    const where = `sales "${spec.ref}"`;
    if (spec.rfq) {
      checkAssignee(
        `${where} rfq`,
        spec.rfq.assignee,
        spec.rfq.status,
        OPEN_SALES_RFQ_STATUSES,
        "salesRfq"
      );
    }
    if (spec.order) {
      checkAssignee(
        `${where} order`,
        spec.order.assignee,
        spec.order.status,
        OPEN_SALES_ORDER_STATUSES,
        "salesOrder"
      );
    }
    const quote = spec.quote;
    if (!quote) continue;
    const quoteWhere = `${where} quote "${quote.ref}"`;
    checkAssignee(
      quoteWhere,
      quote.assignee,
      quote.status,
      OPEN_QUOTE_STATUSES,
      "quote"
    );
    if (quote.createdOffset === undefined) {
      fail(
        `${quoteWhere}: no createdOffset — every quote would share the seed's timestamp`
      );
    } else {
      const created = quote.createdOffset;
      if (created > 0) fail(`${quoteWhere}: createdOffset is in the future`);
      if (created >= -KPI_WINDOW_DAYS) recentQuotes += 1;
      if (spec.rfq && created < spec.rfq.rfqDateOffset) {
        fail(`${quoteWhere}: created before its RFQ`);
      }
      if (spec.order && created > spec.order.orderDateOffset) {
        fail(`${quoteWhere}: created after its order`);
      }
      if (
        quote.expirationOffset !== undefined &&
        quote.expirationOffset <= created
      ) {
        fail(`${quoteWhere}: expires before it was created`);
      }
    }
    for (const line of quote.lines) {
      if (!line.configuration) continue;
      configuredLines += 1;
      const lineWhere = `${quoteWhere} line "${line.ref}"`;
      checkConfiguredDefaults(lineWhere, line.configuration);
      if (line.item !== cfg.item) {
        fail(
          `${lineWhere}: configured, but "${line.item}" is not configurable`
        );
      }
      for (const key of Object.keys(line.configuration)) {
        if (!parameterByKey.has(key)) {
          fail(`${lineWhere}: unknown configuration parameter "${key}"`);
        }
      }
      for (const parameter of cfg.parameters) {
        const value = line.configuration[parameter.key];
        const ok =
          parameter.dataType === "numeric"
            ? typeof value === "number"
            : parameter.dataType === "boolean"
              ? typeof value === "boolean"
              : typeof value === "string" &&
                (parameter.listOptions ?? []).includes(value);
        if (!ok) {
          fail(
            `${lineWhere}: "${parameter.key}" is not a valid ${parameter.dataType} value`
          );
        }
      }
    }
  }
  if (configuredLines === 0) {
    fail(
      "sales: no configured quote line — the configurator never shows a result"
    );
  }
  if (recentQuotes < 2) {
    fail(
      `sales: ${recentQuotes} quote(s) created in the last ${KPI_WINDOW_DAYS} days, need ≥ 2 for the KPI chart`
    );
  }

  const p = dataset.purchasing;
  checkAssignee(
    `purchasing.rfqHeader "${p.rfqHeader.ref}"`,
    p.rfqHeader.assignee,
    p.rfqHeader.status,
    OPEN_PURCHASING_RFQ_STATUSES,
    "purchasingRfq"
  );
  // Tier 05 assigns every Draft lifecycle RFQ to the applying user.
  assigned.purchasingRfq += p.lifecycleRfqs.filter(
    (rfq) => rfq.status === "Draft"
  ).length;
  for (const quote of p.rfqQuotes) {
    checkAssignee(
      `purchasing.rfqQuotes "${quote.key}"`,
      quote.assignee,
      quote.status ?? "Active",
      OPEN_SUPPLIER_QUOTE_STATUSES,
      "supplierQuote"
    );
  }
  for (const quote of p.standaloneSupplierQuotes) {
    checkAssignee(
      `purchasing.standaloneSupplierQuotes "${quote.key}"`,
      quote.assignee,
      quote.status,
      OPEN_SUPPLIER_QUOTE_STATUSES,
      "supplierQuote"
    );
  }
  for (const [index, po] of p.purchaseOrders.entries()) {
    if (po.source !== "direct") continue;
    checkAssignee(
      `purchasing.purchaseOrders[${index}]`,
      po.assignee,
      po.status,
      OPEN_PURCHASE_ORDER_STATUSES,
      "purchaseOrder"
    );
  }
  for (const [kind, count] of Object.entries(assigned)) {
    if (count < MIN_ASSIGNED_OPEN_DOCUMENTS) {
      fail(
        `assignees: ${count} open ${kind}(s) assigned to the applying user, need ≥ ${MIN_ASSIGNED_OPEN_DOCUMENTS}`
      );
    }
  }

  // ── Customer portals + bank accounts ──────────────────────────────────────
  const portals = dataset.sales.customerPortals;
  if (portals.length < MIN_CUSTOMER_PORTALS) {
    fail(
      `sales.customerPortals: ${portals.length}, need ≥ ${MIN_CUSTOMER_PORTALS}`
    );
  }
  if (new Set(portals).size !== portals.length) {
    // externalLink is unique on (documentId, documentType).
    fail("sales.customerPortals: a customer can have only one portal");
  }
  for (const customer of portals) {
    needCustomer("sales.customerPortals", customer);
  }
  const primaryParties = new Set<string>();
  for (const spec of dataset.sales.customerBankAccounts) {
    const where = `sales.customerBankAccounts "${spec.name}"`;
    needCustomer(where, spec.customer);
    checkBankAccount(where, spec, fail);
    if (spec.isPrimary) {
      if (primaryParties.has(`c:${spec.customer}`)) {
        fail(`${where}: "${spec.customer}" already has a primary account`);
      }
      primaryParties.add(`c:${spec.customer}`);
    }
  }
  for (const spec of p.supplierBankAccounts) {
    const where = `purchasing.supplierBankAccounts "${spec.name}"`;
    need("supplier", where, spec.supplier);
    checkBankAccount(where, spec, fail);
    if (spec.isPrimary) {
      if (primaryParties.has(`s:${spec.supplier}`)) {
        fail(`${where}: "${spec.supplier}" already has a primary account`);
      }
      primaryParties.add(`s:${spec.supplier}`);
    }
  }
  if (dataset.sales.customerBankAccounts.length === 0) {
    fail("sales.customerBankAccounts: must not be empty");
  }
  if (p.supplierBankAccounts.length === 0) {
    fail("purchasing.supplierBankAccounts: must not be empty");
  }

  // ── Approvals ─────────────────────────────────────────────────────────────
  const poFloors = p.approvalRules
    .filter((rule) => rule.documentType === "purchaseOrder")
    .map((rule) => rule.lowerBoundAmount);
  const supplierRules = p.approvalRules.filter(
    (rule) => rule.documentType === "supplier"
  );
  if (poFloors.length < 2) {
    fail(
      "purchasing.approvalRules: need ≥ 2 purchaseOrder tiers — the rules screen shows a ladder"
    );
  }
  if (new Set(poFloors).size !== poFloors.length) {
    fail("purchasing.approvalRules: two purchaseOrder tiers share a floor");
  }
  // Supplier requests carry no amount, so only a 0-floor rule ever matches them.
  if (!supplierRules.some((rule) => rule.lowerBoundAmount === 0)) {
    fail("purchasing.approvalRules: no supplier rule with lowerBoundAmount 0");
  }
  for (const rule of p.approvalRules) {
    if (rule.lowerBoundAmount < 0) {
      fail(`purchasing.approvalRules: negative floor ${rule.lowerBoundAmount}`);
    }
    if (rule.documentType === "supplier" && rule.lowerBoundAmount !== 0) {
      fail(
        "purchasing.approvalRules: a supplier rule is amount-less (floor 0)"
      );
    }
  }
  const lowestPoFloor = poFloors.length > 0 ? Math.min(...poFloors) : 0;
  const needsApproval = new Map<
    string,
    { total: number; orderDateOffset: number; foreign: boolean }
  >();
  for (const po of p.purchaseOrders) {
    if (po.source !== "direct" || po.status !== "Needs Approval") continue;
    if (po.ref === undefined) {
      fail(
        `purchasing: Needs Approval order "${po.log}" has no ref for its approval request`
      );
      continue;
    }
    needsApproval.set(po.ref, {
      total: po.lines.reduce(
        (sum, line) => sum + line.purchaseQuantity * line.supplierUnitPrice,
        0
      ),
      orderDateOffset: po.orderDateOffset,
      foreign: po.currencyCode !== undefined
    });
  }
  const pendingSuppliers = new Set(
    f.suppliers.filter((s) => s.status === "Pending").map((s) => s.name)
  );
  const requested = new Set<string>();
  const requestTypes = new Set<string>();
  for (const request of p.approvalRequests) {
    if (request.requestedOffset > 0) {
      fail("purchasing.approvalRequests: requestedOffset is in the future");
    }
    if ("purchaseOrder" in request) {
      requestTypes.add("purchaseOrder");
      const where = `purchasing.approvalRequests "${request.purchaseOrder}"`;
      const po = needsApproval.get(request.purchaseOrder);
      if (!po) {
        fail(`${where}: not a Needs Approval purchase order`);
        continue;
      }
      if (requested.has(request.purchaseOrder)) {
        fail(`${where}: a document has one Pending request`);
      }
      requested.add(request.purchaseOrder);
      if (request.requestedOffset < po.orderDateOffset) {
        fail(`${where}: requested before the order was placed`);
      }
      if (po.foreign) {
        fail(`${where}: the request amount is in base currency — keep it USD`);
      }
      if (po.total < lowestPoFloor) {
        fail(
          `${where}: order total ${po.total} is below the lowest approval tier ${lowestPoFloor}, so finalize would not have asked for approval`
        );
      }
    } else {
      requestTypes.add("supplier");
      const where = `purchasing.approvalRequests "${request.supplier}"`;
      if (!pendingSuppliers.has(request.supplier)) {
        fail(`${where}: not a Pending supplier`);
      }
      if (requested.has(request.supplier)) {
        fail(`${where}: a document has one Pending request`);
      }
      requested.add(request.supplier);
    }
  }
  for (const ref of needsApproval.keys()) {
    if (!requested.has(ref)) {
      fail(`purchasing: Needs Approval order "${ref}" has no approval request`);
    }
  }
  for (const name of pendingSuppliers) {
    if (!requested.has(name)) {
      fail(`purchasing: Pending supplier "${name}" has no approval request`);
    }
  }
  checkCoverage(fail, { approvalRequestType: requestTypes });
}

// Return orders: the Credits tab (memo) and the Issues tab (NCR link).

export function returnOrders(ctx: ValidationCtx): void {
  const { dataset, fail } = ctx;
  const p = dataset.purchasing;
  // ── Return orders: Credits tab (memo) and Issues tab (NCR link) ──────────
  const checkCredit = (
    where: string,
    ret: {
      status: string;
      dateOffset: number;
      lines: { quantity: number }[];
      credit?: ReturnCreditSpec;
    }
  ): boolean => {
    const credit = ret.credit;
    if (!credit) return false;
    // Issue Credit caps each line at what was received / shipped.
    if (ret.status !== "Completed") {
      fail(`${where}: credit on a ${ret.status} return — nothing received yet`);
    }
    if (credit.dateOffset < ret.dateOffset || credit.dateOffset > 0) {
      fail(
        `${where}: credit dateOffset ${credit.dateOffset} outside [${ret.dateOffset}, 0]`
      );
    }
    if (
      credit.status === "Posted" &&
      credit.dateOffset < OPEN_PERIOD_MIN_OFFSET
    ) {
      fail(`${where}: a Posted credit must fall in an open period`);
    }
    if (credit.lines.length === 0) fail(`${where}: credit has no lines`);
    const seen = new Set<number>();
    for (const line of credit.lines) {
      const returnLine = ret.lines[line.line - 1];
      if (!returnLine) {
        fail(`${where}: credit names line ${line.line}, which does not exist`);
        continue;
      }
      if (seen.has(line.line))
        fail(`${where}: line ${line.line} credited twice`);
      seen.add(line.line);
      if (line.quantity <= 0 || line.quantity > returnLine.quantity) {
        fail(
          `${where}: line ${line.line} credits ${line.quantity} of ${returnLine.quantity}`
        );
      }
    }
    return true;
  };
  let salesCredits = 0;
  for (const rma of dataset.sales.salesReturns) {
    if (checkCredit(`sales.salesReturns "${rma.key}"`, rma)) salesCredits += 1;
  }
  let purchaseCredits = 0;
  for (const ret of p.purchaseReturns) {
    if (checkCredit(`purchasing.purchaseReturns "${ret.key}"`, ret)) {
      purchaseCredits += 1;
    }
  }
  if (salesCredits === 0) {
    fail("sales.salesReturns: no credited RMA — its Credits tab is empty");
  }
  if (purchaseCredits === 0) {
    fail(
      "purchasing.purchaseReturns: no credited return — its Credits tab is empty"
    );
  }

  const rmaByKey = new Map(dataset.sales.salesReturns.map((r) => [r.key, r]));
  const returnByKey = new Map(p.purchaseReturns.map((r) => [r.key, r]));
  let salesIssues = 0;
  let purchaseIssues = 0;
  for (const ncr of dataset.quality.nonConformances) {
    const where = `quality.nonConformances "${ncr.ref}"`;
    if (ncr.salesReturnLine) {
      salesIssues += 1;
      const { salesReturn, line } = ncr.salesReturnLine;
      const rma = rmaByKey.get(salesReturn);
      if (!rma) {
        fail(`${where}: unknown sales return "${salesReturn}"`);
      } else {
        if (!rma.lines[line - 1]) {
          fail(`${where}: sales return "${salesReturn}" has no line ${line}`);
        }
        if (ncr.customer !== rma.customer) {
          fail(
            `${where}: sales return "${salesReturn}" belongs to "${rma.customer}", not the NCR's customer`
          );
        }
      }
    }
    if (ncr.purchaseReturnLine) {
      purchaseIssues += 1;
      const { purchaseReturn, line, quantity } = ncr.purchaseReturnLine;
      const ret = returnByKey.get(purchaseReturn);
      if (!ret) {
        fail(`${where}: unknown purchase return "${purchaseReturn}"`);
        continue;
      }
      const returnLine = ret.lines[line - 1];
      if (!returnLine) {
        fail(
          `${where}: purchase return "${purchaseReturn}" has no line ${line}`
        );
        continue;
      }
      if (ncr.supplier !== ret.supplier) {
        fail(
          `${where}: purchase return "${purchaseReturn}" goes to "${ret.supplier}", not the NCR's supplier`
        );
      }
      if (quantity <= 0 || quantity > returnLine.quantity) {
        fail(
          `${where}: covers ${quantity} of the return line's ${returnLine.quantity}`
        );
      }
      const ncrItems = new Set([
        ...(ncr.items ?? []).map((i) => i.item),
        ...(ncr.purchaseOrderLine ? [ncr.purchaseOrderLine.item] : [])
      ]);
      if (ncrItems.size > 0 && !ncrItems.has(returnLine.item)) {
        fail(
          `${where}: return line item "${returnLine.item}" is not an item of the issue`
        );
      }
      // closeIssue refuses while a linked return is still open.
      if (ncr.status === "Closed" && ret.status !== "Completed") {
        fail(`${where}: Closed, but its linked return is still ${ret.status}`);
      }
      if (ret.dateOffset < ncr.openDateOffset) {
        fail(`${where}: linked return predates the issue`);
      }
    }
  }
  if (salesIssues === 0) {
    fail("quality: no NCR linked to an RMA line — the RMA Issues tab is empty");
  }
  if (purchaseIssues === 0) {
    fail(
      "quality: no NCR linked to a supplier-return line — its Issues tab is empty"
    );
  }
}

// Purchasing: RFQs and supplier quotes, purchase orders with their receipts
// and invoices, purchase returns, and the purchasing status matrix.

export function purchasing(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const f = dataset.foundation;
  const { trackingByItem, isTracked } = ix;
  const suppliers = ix.refs.supplier;

  const p = dataset.purchasing;
  const breakCount = p.rfqQuantityBreaks.length;
  const rfqItems = new Set(p.rfqLines.map((line) => line.item));
  for (const line of p.rfqLines) need("item", "purchasing.rfqLines", line.item);

  // Statuses exhibited by the purchasing slice, checked against
  // COVERAGE (required.ts) once every spec has been walked.
  const seenPurchasing = {
    purchaseOrder: new Set<string>(),
    receipt: new Set<string>(),
    purchaseInvoice: new Set<string>(),
    purchaseReturn: new Set<string>(),
    supplierQuote: new Set<string>(),
    purchasingRfq: new Set<string>([p.rfqHeader.status])
  };
  // Pending / Rejected / Inactive suppliers exist for the supplier list only,
  // never for order flow.
  const { activeSuppliers, suppliersWithContacts } = ix;
  const needActiveSupplier = (where: string, name: string) => {
    need("supplier", where, name);
    if (suppliers.has(name) && !activeSuppliers.has(name)) {
      fail(`${where}: supplier "${name}" is not Active`);
    }
  };
  const supplierProcessSuppliers = new Set(
    f.supplierProcesses.map((sp) => sp.supplier)
  );
  const eurSuppliers = new Set(
    f.suppliers.filter((s) => s.currencyCode === "EUR").map((s) => s.name)
  );

  const quoteKeys = new Set<string>();
  for (const quote of p.rfqQuotes) {
    const where = `purchasing.rfqQuotes "${quote.key}"`;
    quoteKeys.add(quote.key);
    needActiveSupplier(where, quote.supplier);
    if (
      suppliers.has(quote.supplier) &&
      !suppliersWithContacts.has(quote.supplier)
    ) {
      fail(
        `${where}: supplier "${quote.supplier}" has no supplierContact, which the quote row requires`
      );
    }
    seenPurchasing.supplierQuote.add(quote.status ?? "Active");
    for (const line of quote.lines) {
      need("item", where, line.item);
      if (!rfqItems.has(line.item)) {
        fail(`${where}: item "${line.item}" is not an rfqLine item`);
      }
      if (line.breaks.length !== breakCount) {
        fail(
          `${where} item "${line.item}": ${line.breaks.length} price breaks but rfqQuantityBreaks has ${breakCount}`
        );
      }
    }
  }
  if (!quoteKeys.has(p.rfqWinningQuote)) {
    fail(
      `purchasing.rfqWinningQuote "${p.rfqWinningQuote}" is not an rfqQuotes key`
    );
  }
  if (!p.rfqQuantityBreaks.includes(p.rfqOrderQuantity)) {
    fail(
      `purchasing.rfqOrderQuantity ${p.rfqOrderQuantity} is not one of rfqQuantityBreaks [${p.rfqQuantityBreaks.join(", ")}]`
    );
  }
  const winningQuote = p.rfqQuotes.find((q) => q.key === p.rfqWinningQuote);
  if (winningQuote && (winningQuote.status ?? "Active") !== "Active") {
    fail(
      `purchasing.rfqWinningQuote "${p.rfqWinningQuote}": the winning quote must stay Active`
    );
  }

  // ── Draft / Closed RFQs ────────────────────────────────────────────────────
  for (const rfq of p.lifecycleRfqs) {
    const where = `purchasing.lifecycleRfqs "${rfq.ref}"`;
    seenPurchasing.purchasingRfq.add(rfq.status);
    if (rfq.lines.length === 0) fail(`${where}: has no lines`);
    for (const line of rfq.lines) need("item", where, line.item);
    if (new Set(rfq.lines.map((line) => line.item)).size !== rfq.lines.length) {
      fail(`${where}: an item appears on two lines`);
    }
    if (
      rfq.quantities.length === 0 ||
      rfq.quantities.some(
        (qty, index) =>
          qty <= 0 || (index > 0 && qty <= rfq.quantities[index - 1]!)
      )
    ) {
      fail(`${where}: quantities must be positive and strictly ascending`);
    }
    if (rfq.suppliers.length === 0) fail(`${where}: has no suppliers`);
    if (new Set(rfq.suppliers).size !== rfq.suppliers.length) {
      fail(`${where}: a supplier is listed twice`);
    }
    for (const supplier of rfq.suppliers) needActiveSupplier(where, supplier);
    if (rfq.rfqDateOffset > 0) fail(`${where}: rfqDateOffset is in the future`);
    if (rfq.expirationOffset <= rfq.rfqDateOffset) {
      fail(`${where}: expires on or before its RFQ date`);
    }
  }

  // ── Standalone supplier quotes ─────────────────────────────────────────────
  for (const quote of p.standaloneSupplierQuotes) {
    const where = `purchasing.standaloneSupplierQuotes "${quote.key}"`;
    needActiveSupplier(where, quote.supplier);
    if (
      suppliers.has(quote.supplier) &&
      !suppliersWithContacts.has(quote.supplier)
    ) {
      fail(
        `${where}: supplier "${quote.supplier}" has no supplierContact, which the quote row requires`
      );
    }
    seenPurchasing.supplierQuote.add(quote.status);
    if (quote.status === "Expired" && quote.expirationOffset >= 0) {
      fail(
        `${where}: Expired quote's expirationOffset ${quote.expirationOffset} is not in the past`
      );
    }
    if (quote.lines.length === 0) fail(`${where}: no lines`);
    for (const line of quote.lines) {
      need("item", where, line.item);
      if (line.prices.length === 0) {
        fail(`${where} line "${line.item}": no prices`);
      }
    }
  }

  // ── Purchase orders ────────────────────────────────────────────────────────
  let eurPoCount = 0;
  let ospPoCount = 0;
  for (const [index, po] of p.purchaseOrders.entries()) {
    const where = `purchasing.purchaseOrders[${index}]`;
    seenPurchasing.purchaseOrder.add(po.status);
    if (po.source !== "direct") continue;

    needActiveSupplier(where, po.supplier);
    const poItems = new Set(po.lines.map((line) => line.item));
    for (const line of po.lines) need("item", where, line.item);

    if (po.purchaseOrderType === "Outside Processing") {
      ospPoCount += 1;
      if (!supplierProcessSuppliers.has(po.supplier)) {
        fail(
          `${where}: Outside Processing order on "${po.supplier}", which has no foundation.supplierProcesses entry`
        );
      }
    }

    // FX discipline: EUR belongs to exactly one childless, unpaid order on
    // the EUR supplier; everything else stays in base currency.
    if (po.currencyCode !== undefined && po.currencyCode !== "USD") {
      if (po.currencyCode !== "EUR") {
        fail(`${where}: unsupported currencyCode "${po.currencyCode}"`);
      } else {
        eurPoCount += 1;
        if (!eurSuppliers.has(po.supplier)) {
          fail(
            `${where}: EUR order on "${po.supplier}", which is not the EUR supplier`
          );
        }
        if (po.exchangeRate === undefined) {
          fail(`${where}: EUR order has no exchangeRate`);
        }
        if (po.receipt || po.invoice) {
          fail(
            `${where}: the EUR order must stay childless — receipts and invoices are settled in base currency by design`
          );
        }
        if (po.status !== "To Invoice" && po.status !== "Draft") {
          fail(
            `${where}: the EUR order must be unpaid ("To Invoice" or "Draft"), got "${po.status}"`
          );
        }
      }
    }

    if (po.receipt) {
      seenPurchasing.receipt.add(po.receipt.status);
      const posted = po.receipt.status === "Posted";
      if (posted && po.receipt.postedOffset === undefined) {
        fail(`${where} receipt: Posted receipt has no postedOffset`);
      }
      if (
        posted &&
        po.receipt.postedOffset !== undefined &&
        po.receipt.postedOffset < po.orderDateOffset
      ) {
        fail(
          `${where} receipt: postedOffset ${po.receipt.postedOffset} is before the order's orderDateOffset ${po.orderDateOffset}`
        );
      }
      for (const [lineIndex, line] of po.receipt.lines.entries()) {
        need("item", `${where} receipt`, line.item);
        if (!poItems.has(line.item)) {
          fail(`${where} receipt: item "${line.item}" is not a PO line`);
        }
        if (line.receivedQuantity > line.orderQuantity) {
          fail(
            `${where} receipt: receivedQuantity ${line.receivedQuantity} exceeds orderQuantity ${line.orderQuantity} for "${line.item}"`
          );
        }
        if (line.toShelf !== undefined)
          need("shelf", `${where} receipt`, line.toShelf);
        const tracking = trackingByItem.get(line.item);
        if (line.lotNumber !== undefined && tracking !== "Batch") {
          fail(
            `${where} receipt: lotNumber on "${line.item}", which is not Batch-tracked`
          );
        }
        if (posted && line.receivedQuantity > 0) {
          if (line.toShelf === undefined) {
            fail(
              `${where} receipt: Posted line "${line.item}" needs a toShelf`
            );
          }
          if (tracking === "Serial") {
            fail(
              `${where} receipt: serial item "${line.item}" needs per-unit receiving the seed does not model`
            );
          } else if (tracking === "Batch") {
            if (!line.requiresBatchTracking || line.lotNumber === undefined) {
              fail(
                `${where} receipt: Posted batch line "${line.item}" needs requiresBatchTracking and a lotNumber`
              );
            } else if (
              !ix.lots.mintedReceiptLines.has(receiptLineKey(index, lineIndex))
            ) {
              fail(
                `${where} receipt: lotNumber "${line.lotNumber}" collides with another tracked entity readableId`
              );
            }
          }
        }
      }
    }

    if (po.invoice) {
      seenPurchasing.purchaseInvoice.add(po.invoice.status);
      if (po.invoice.dateIssuedOffset < po.orderDateOffset) {
        fail(
          `${where} invoice "${po.invoice.ref}": dateIssuedOffset ${po.invoice.dateIssuedOffset} is before the order's orderDateOffset ${po.orderDateOffset}`
        );
      }
      if (
        po.receipt?.postedOffset !== undefined &&
        po.invoice.dateIssuedOffset < po.receipt.postedOffset
      ) {
        fail(
          `${where} invoice "${po.invoice.ref}": dateIssuedOffset ${po.invoice.dateIssuedOffset} is before the receipt's postedOffset ${po.receipt.postedOffset}`
        );
      }
      for (const line of po.invoice.lines) {
        need("item", `${where} invoice`, line.item);
        if (!poItems.has(line.item)) {
          fail(`${where} invoice: item "${line.item}" is not a PO line`);
        }
      }
      const lineTotal = po.invoice.lines.reduce(
        (sum, line) => sum + line.quantity * line.supplierUnitPrice,
        0
      );
      if (Math.abs(lineTotal - po.invoice.subtotal) > 0.01) {
        fail(
          `${where} invoice "${po.invoice.ref}": subtotal ${po.invoice.subtotal} does not equal its lines' total ${lineTotal}`
        );
      }
    }
  }
  if (ospPoCount === 0) {
    fail(
      `purchasing.purchaseOrders: no "Outside Processing" order — every dataset showcases one`
    );
  }
  if (eurPoCount !== 1) {
    fail(
      `purchasing.purchaseOrders: expected exactly 1 EUR order (the FX showcase), found ${eurPoCount}`
    );
  }

  // ── Purchase returns ───────────────────────────────────────────────────────
  for (const ret of p.purchaseReturns) {
    const where = `purchasing.purchaseReturns "${ret.key}"`;
    needActiveSupplier(where, ret.supplier);
    seenPurchasing.purchaseReturn.add(ret.status);
    if (ret.lines.length === 0) fail(`${where}: no lines`);
    for (const line of ret.lines) {
      need("item", where, line.item);
      if (line.quantity <= 0) {
        fail(`${where} line "${line.item}": quantity must be positive`);
      }
      if (isTracked(line.item)) {
        fail(
          `${where} line "${line.item}": tracked items need per-entity returns the seed does not model`
        );
      }
      if (line.fromShelf !== undefined) need("shelf", where, line.fromShelf);
      if (ret.status === "Completed") {
        if (line.fromShelf === undefined) {
          fail(
            `${where} line "${line.item}": Completed return line needs a fromShelf`
          );
        }
      }
    }
  }

  // ── Status matrix — every required purchasing status must be exhibited ────
  checkCoverage(fail, seenPurchasing);
}

// Production: jobs and their timelines, the events job, picking lists, and
// the genealogy lots tier 06 creates.

/** Open jobs are due inside this window, so Priorities' week and month show them. */
const OPEN_JOB_DUE_WINDOW = { min: -3, max: 21 } as const;
const RELEASED_JOB_STATUSES = new Set([
  "Ready",
  "In Progress",
  "Paused",
  "Completed",
  "Closed",
  "Cancelled"
]);

export function jobs(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need, needCustomer } = ctx;
  const { orderDateByRef } = ix;
  const { rootOpCountOf, rootOpsOf } = ix.bom;
  // Order → release → completion, none of it after today; open work due in the
  // Priorities window.
  const checkJobTimeline = (where: string, job: JobSpec) => {
    const released = job.releasedDateOffset;
    const completed = job.completedDateOffset;
    if (RELEASED_JOB_STATUSES.has(job.status) && released === undefined) {
      fail(`${where}: a ${job.status} job has no releasedDateOffset`);
    }
    if (!RELEASED_JOB_STATUSES.has(job.status) && released !== undefined) {
      fail(`${where}: a ${job.status} job has not been released`);
    }
    const finished = job.status === "Completed" || job.status === "Closed";
    if (finished !== (completed !== undefined)) {
      fail(
        `${where}: completedDateOffset belongs on (and only on) Completed / Closed jobs`
      );
    }
    if (released !== undefined && released > 0) {
      fail(`${where}: releasedDateOffset ${released} is in the future`);
    }
    if (completed !== undefined && completed > 0) {
      fail(`${where}: completedDateOffset ${completed} is in the future`);
    }
    if (
      released !== undefined &&
      completed !== undefined &&
      completed < released
    ) {
      fail(
        `${where}: completedDateOffset ${completed} is before releasedDateOffset ${released}`
      );
    }
    const ordered =
      job.salesOrder === undefined
        ? undefined
        : orderDateByRef.get(job.salesOrder);
    if (released !== undefined && ordered !== undefined && released < ordered) {
      fail(
        `${where}: releasedDateOffset ${released} is before its sales order's orderDateOffset ${ordered}`
      );
    }
    if (
      OPEN_JOB_STATUSES.has(job.status) &&
      job.dueDateOffset !== undefined &&
      (job.dueDateOffset < OPEN_JOB_DUE_WINDOW.min ||
        job.dueDateOffset > OPEN_JOB_DUE_WINDOW.max)
    ) {
      fail(
        `${where}: open job due at ${job.dueDateOffset}, outside ${OPEN_JOB_DUE_WINDOW.min}…+${OPEN_JOB_DUE_WINDOW.max}`
      );
    }
    if (
      job.priority !== undefined &&
      !(Number.isInteger(job.priority) && job.priority > 0)
    ) {
      fail(`${where}: priority ${job.priority} is not a positive integer`);
    }
    if (
      RELEASED_OPEN_JOB_STATUSES.has(job.status) &&
      job.priority === undefined
    ) {
      fail(`${where}: a released job needs a priority`);
    }
    const logged = job.loggedTime;
    if (logged) {
      if (job.status !== "Completed" || completed === undefined) {
        fail(`${where}: loggedTime belongs on Completed jobs`);
      } else if (
        (released !== undefined && logged.startOffset < released) ||
        logged.startOffset >= completed
      ) {
        fail(
          `${where}: loggedTime starts at ${logged.startOffset}, outside release ${released} … the day before completion ${completed}`
        );
      }
      if (!(logged.efficiency >= 0.5 && logged.efficiency <= 2)) {
        fail(
          `${where}: loggedTime efficiency ${logged.efficiency} outside 0.5…2`
        );
      }
    }
  };

  const jobKeys = new Set<string>();
  const seenDeadlineTypes = new Set<string>();
  const seenOperationStatuses = new Set<string>();
  const seenQuantityTypes = new Set<string>();
  const { documentRefs } = ix;
  for (const [jobIndex, job] of dataset.production.jobs.entries()) {
    const seen = documentRefs.seenBy.jobs[jobIndex]!;
    const where = `production.jobs "${job.key}"`;
    if (jobKeys.has(job.key)) fail(`${where}: duplicate job key`);
    jobKeys.add(job.key);
    need("item", where, job.item);
    const orderRefs = [job.salesOrder, job.salesOrderLine, job.customer];
    const orderRefCount = orderRefs.filter((r) => r !== undefined).length;
    if (orderRefCount !== 0 && orderRefCount !== 3) {
      fail(
        `${where}: salesOrder, salesOrderLine and customer go together — all three (made to order) or none (made to stock)`
      );
    }
    if (job.customer !== undefined) needCustomer(where, job.customer);
    if (
      job.salesOrder !== undefined &&
      !documentRefs.has(job.salesOrder, seen)
    ) {
      fail(`${where}: unknown sales order ref "${job.salesOrder}"`);
    }
    if (
      job.salesOrderLine !== undefined &&
      !documentRefs.has(job.salesOrderLine, seen)
    ) {
      fail(`${where}: unknown sales order line ref "${job.salesOrderLine}"`);
    }
    checkJobTimeline(where, job);
    if (
      job.quantityComplete !== undefined &&
      job.quantityComplete > job.quantity
    ) {
      fail(
        `${where}: quantityComplete ${job.quantityComplete} exceeds quantity ${job.quantity}`
      );
    }

    // Deadline discipline: "No Deadline" means exactly that — no due date;
    // every other deadline type needs one.
    const deadlineType = job.deadlineType ?? "Hard Deadline";
    seenDeadlineTypes.add(deadlineType);
    if (deadlineType === "No Deadline" && job.dueDateOffset !== undefined) {
      fail(`${where}: a "No Deadline" job must not carry a dueDateOffset`);
    }
    if (deadlineType !== "No Deadline" && job.dueDateOffset === undefined) {
      fail(`${where}: "${deadlineType}" job has no dueDateOffset`);
    }

    const opCount = rootOpCountOf(job.item);
    const checkOrder = (label: string, order: number) => {
      if (!Number.isInteger(order) || order < 1) {
        fail(`${where} ${label}: order ${order} is not a positive integer`);
      } else if (order > opCount) {
        fail(
          `${where} ${label}: order ${order} exceeds the ${opCount} root operations of "${job.item}"`
        );
      }
    };

    const overrideOrders = new Set<number>();
    for (const override of job.operationOverrides ?? []) {
      checkOrder("operationOverrides", override.order);
      if (overrideOrders.has(override.order)) {
        fail(`${where} operationOverrides: duplicate order ${override.order}`);
      }
      overrideOrders.add(override.order);
      if (override.status) seenOperationStatuses.add(override.status);
      if (!override.status && !override.assignee && !override.running) {
        fail(
          `${where} operationOverrides order ${override.order}: sets nothing`
        );
      }
      if (override.running) {
        if (override.status !== "In Progress") {
          fail(
            `${where} operationOverrides order ${override.order}: a running operation must be "In Progress"`
          );
        }
        if (!TIME_OF_DAY.test(override.running.startTimeOfDay)) {
          fail(
            `${where} operationOverrides order ${override.order}: startTimeOfDay "${override.running.startTimeOfDay}" is not HH:MM:SS`
          );
        }
        const workCenter = rootOpsOf(job.item)[override.order - 1]?.workCenter;
        if (workCenter === undefined) {
          fail(
            `${where} operationOverrides order ${override.order}: a running operation needs a work center`
          );
        }
      }
    }

    for (const quantity of job.quantities ?? []) {
      checkOrder("quantities", quantity.order);
      seenQuantityTypes.add(quantity.type);
      if (quantity.quantity <= 0) {
        fail(`${where} quantities: quantity must be positive`);
      }
      if (quantity.type === "Scrap") {
        if (quantity.scrapReason === undefined) {
          fail(`${where} quantities: Scrap row has no scrapReason`);
        } else if (!SCRAP_REASON_NAMES.has(quantity.scrapReason)) {
          fail(
            `${where} quantities: scrapReason "${quantity.scrapReason}" is not a bootstrap scrap reason`
          );
        }
      } else if (quantity.scrapReason !== undefined) {
        fail(
          `${where} quantities: scrapReason on a ${quantity.type} row — only Scrap rows carry one`
        );
      }
    }

    for (const note of job.operationNotes ?? []) {
      checkOrder("operationNotes", note.order);
      if (!note.note.trim()) fail(`${where} operationNotes: empty note`);
    }
  }
  checkCoverage(fail, {
    jobDeadlineType: seenDeadlineTypes,
    jobOperationOverride: seenOperationStatuses,
    productionQuantityType: seenQuantityTypes
  });
  if (!jobKeys.has(dataset.production.eventsJobKey)) {
    fail(
      `production.eventsJobKey "${dataset.production.eventsJobKey}" is not a job key`
    );
  }
  if (!jobKeys.has(dataset.production.genealogyJobKey)) {
    fail(
      `production.genealogyJobKey "${dataset.production.genealogyJobKey}" is not a job key`
    );
  }
}

export function eventsJobAndPicking(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const { jobByKey, isTracked } = ix;
  const { componentsOf, rootOpCountOf } = ix.bom;
  // ── Events-job depth: open event, rework ───────────────────────────────────
  const eventsJob = jobByKey.get(dataset.production.eventsJobKey);
  if (eventsJob) {
    const eventsOpCount = rootOpCountOf(eventsJob.item);
    const checkEventsOrder = (label: string, order: number) => {
      if (!Number.isInteger(order) || order < 1 || order > eventsOpCount) {
        fail(
          `production.${label}: operation order ${order} is not within the ${eventsOpCount} root operations of "${eventsJob.item}"`
        );
      }
    };
    checkEventsOrder("openEvent", dataset.production.openEvent.operationOrder);
    // The open timer belongs on the operation the floor is actually running.
    const openEventOverride = (eventsJob.operationOverrides ?? []).find(
      (override) =>
        override.order === dataset.production.openEvent.operationOrder
    );
    if (openEventOverride?.status !== "In Progress") {
      fail(
        `production.openEvent: operation ${dataset.production.openEvent.operationOrder} is not overridden to "In Progress" on job "${eventsJob.key}"`
      );
    }
    const rework = dataset.production.rework;
    checkEventsOrder("rework target", rework.targetOperationOrder);
    checkEventsOrder("rework triggeredAt", rework.triggeredAtOperationOrder);
    if (rework.targetOperationOrder > rework.triggeredAtOperationOrder) {
      fail(
        `production.rework: target operation ${rework.targetOperationOrder} is downstream of the triggering operation ${rework.triggeredAtOperationOrder} — rework sends units BACK`
      );
    }
    if (rework.quantity <= 0) {
      fail(`production.rework: quantity must be positive`);
    }
    if (!rework.reason.trim()) fail(`production.rework: empty reason`);
  }

  // ── Picking lists ──────────────────────────────────────────────────────────
  const seenPickingStatuses = new Set<string>();
  const pickingKeys = new Set<string>();
  for (const list of dataset.production.pickingLists) {
    const where = `production.pickingLists "${list.key}"`;
    if (pickingKeys.has(list.key)) fail(`${where}: duplicate key`);
    pickingKeys.add(list.key);
    seenPickingStatuses.add(list.status);
    const job = jobByKey.get(list.job);
    if (!job) {
      fail(`${where}: unknown job key "${list.job}"`);
      continue;
    }
    // Material is staged for a job the floor has — picking before release is
    // a timeline lie.
    if (job.releasedDateOffset === undefined) {
      fail(`${where}: job "${list.job}" was never released`);
    } else if (list.dateOffset < job.releasedDateOffset) {
      fail(
        `${where}: dateOffset ${list.dateOffset} is before the job's releasedDateOffset ${job.releasedDateOffset}`
      );
    }
    if (list.lines.length === 0) fail(`${where}: no lines`);
    const jobComponents = componentsOf(job.item);
    for (const line of list.lines) {
      need("item", where, line.item);
      if (!jobComponents.has(line.item)) {
        fail(
          `${where} line "${line.item}": not a component of "${job.item}"'s BOM tree, so the job has no jobMaterial row to pick against`
        );
      }
      need("shelf", `${where} line "${line.item}"`, line.fromShelf);
      if (isTracked(line.item)) {
        fail(
          `${where} line "${line.item}": tracked items need per-entity picks the seed does not model`
        );
      }
      if (line.quantityRequired <= 0) {
        fail(`${where} line "${line.item}": quantityRequired must be positive`);
      }
      if (list.status === "Completed") {
        if (line.status !== "Picked") {
          fail(
            `${where} line "${line.item}": a Completed list's lines must all be Picked`
          );
        }
        if (line.quantityPicked !== line.quantityRequired) {
          fail(
            `${where} line "${line.item}": Picked line must have quantityPicked ${line.quantityRequired}, got ${line.quantityPicked}`
          );
        }
      } else {
        if (line.status === "Picked") {
          fail(
            `${where} line "${line.item}": an In Progress list holds only Pending or Short lines`
          );
        }
        if (line.quantityPicked !== 0) {
          fail(
            `${where} line "${line.item}": an unpicked line must have quantityPicked 0 — partial picks would need ledger rows the seed does not model here`
          );
        }
      }
    }
  }
  checkCoverage(fail, { pickingListStatus: seenPickingStatuses });
}

export function genealogy(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const { lots } = ix;
  // Genealogy inputs are historical lots/serials that tier 06 CREATES as
  // consumed entities — they must not collide with an on-hand entity's
  // readableId, or the UI shows two entities under one id.
  const genealogyIds = new Set<string>();
  for (const input of dataset.production.genealogyInputs) {
    const where = `production.genealogyInputs "${input.readableId}"`;
    need("item", where, input.item);
    if (lots.onHandIds.has(input.readableId)) {
      fail(
        `${where}: readableId collides with an inventory.onHandTracked entity`
      );
    }
    if (lots.receiptLotIds.has(input.readableId)) {
      fail(`${where}: readableId collides with a purchasing receipt lotNumber`);
    }
    if (genealogyIds.has(input.readableId)) {
      fail(`${where}: duplicate genealogy input readableId`);
    }
    genealogyIds.add(input.readableId);
  }
  need(
    "item",
    "production.genealogyAssembly",
    dataset.production.genealogyAssembly.item
  );
  const assemblySerialId =
    dataset.production.genealogyAssembly.serial.readableId;
  if (
    lots.onHandIds.has(assemblySerialId) ||
    lots.receiptLotIds.has(assemblySerialId) ||
    genealogyIds.has(assemblySerialId)
  ) {
    fail(
      `production.genealogyAssembly: serial readableId "${assemblySerialId}" collides with another tracked entity readableId`
    );
  }
}

// The floor-level contract: volume, open work on every work center, running
// timers, assignments, make-to-stock and recent completions, the batch, and
// a reachable Inspection operation.

// A floor worth demoing: volume, open work on every work center, running
// timers, assignments, and recent completions for the production KPIs.
export const MIN_JOBS = 18;
const MIN_OPEN_OPERATIONS_PER_WORK_CENTER = 2;
const MIN_RUNNING_WORK_CENTERS = 4;
const MIN_ASSIGNED_OPEN_OPERATIONS = 6;
const MIN_MAKE_TO_STOCK_JOBS = 2;
const MIN_RECENTLY_COMPLETED_JOBS = 3;
const MIN_OPERATIONS_WITH_TOOLS = 3;
const MIN_OPERATIONS_WITH_PARAMETERS = 3;
/** Completed jobs the completion-time KPI's default month window picks up. */
const RECENT_COMPLETION_WINDOW = { min: -25, max: -3 } as const;
const UNSTARTED_OPERATION_STATUSES = new Set(["Todo", "Ready", "Waiting"]);

export function floor(ctx: ValidationCtx): void {
  const { dataset, ix, fail } = ctx;
  const { jobByKey } = ix;
  const { rootOpsOf, subassemblyOpsOf } = ix.bom;
  const production = dataset.production;
  const jobs = production.jobs;
  if (jobs.length < MIN_JOBS) {
    fail(`production.jobs: ${jobs.length} jobs, need ≥ ${MIN_JOBS}`);
  }

  const priorities = new Map<number, string>();
  for (const job of jobs) {
    if (job.priority === undefined) continue;
    const other = priorities.get(job.priority);
    if (other) {
      fail(
        `production.jobs "${job.key}": priority ${job.priority} is also "${other}"'s — priorities are distinct`
      );
    }
    priorities.set(job.priority, job.key);
  }

  const open = jobs.filter((job) => OPEN_JOB_STATUSES.has(job.status));
  const released = jobs.filter((job) =>
    RELEASED_OPEN_JOB_STATUSES.has(job.status)
  );
  if (
    !open.some(
      (job) =>
        job.dueDateOffset !== undefined &&
        job.dueDateOffset >= 0 &&
        job.dueDateOffset <= 7
    )
  ) {
    fail(`production.jobs: no open job due within 0…+7 (Priorities' week)`);
  }
  if (!released.some((job) => job.dueDateOffset === undefined)) {
    fail(
      `production.jobs: no released job without a due date (Priorities › Unscheduled)`
    );
  }
  const madeToStock = open.filter((job) => job.salesOrder === undefined);
  if (madeToStock.length < MIN_MAKE_TO_STOCK_JOBS) {
    fail(
      `production.jobs: ${madeToStock.length} open make-to-stock jobs, need ≥ ${MIN_MAKE_TO_STOCK_JOBS} (openProductionOrders)`
    );
  }
  const recentlyCompleted = jobs.filter(
    (job) =>
      job.status === "Completed" &&
      job.loggedTime !== undefined &&
      job.completedDateOffset !== undefined &&
      job.completedDateOffset >= RECENT_COMPLETION_WINDOW.min &&
      job.completedDateOffset <= RECENT_COMPLETION_WINDOW.max
  );
  if (recentlyCompleted.length < MIN_RECENTLY_COMPLETED_JOBS) {
    fail(
      `production.jobs: ${recentlyCompleted.length} Completed jobs with loggedTime finished ${RECENT_COMPLETION_WINDOW.min}…${RECENT_COMPLETION_WINDOW.max}, need ≥ ${MIN_RECENTLY_COMPLETED_JOBS}`
    );
  }
  // Logged time is sized from estimates, so Setup / Machine events exist only
  // where the completed jobs' operations carry those estimates.
  const loggedOps = recentlyCompleted
    .flatMap((job) => [...rootOpsOf(job.item), ...subassemblyOpsOf(job.item)])
    .filter((op) => op.workCenter !== undefined);
  if (
    !loggedOps.some((op) => (op.setupTime ?? 0) > 0) ||
    !loggedOps.some((op) => (op.machineTime ?? 0) > 0)
  ) {
    fail(
      `production.jobs: the recently completed jobs need a staffed operation with setupTime and one with machineTime, or no Setup / Machine events are logged`
    );
  }
  if (!jobs.some((job) => job.assignee === "self")) {
    fail(`production.jobs: no job assigned to the applying user`);
  }

  const {
    openByWorkCenter,
    running,
    assignedOpen,
    openInspection,
    batchLeadWithoutWorkCenter
  } = ix.floor;
  if (batchLeadWithoutWorkCenter) {
    fail(
      `production.batch: the first member runs the batch timer, so it needs a work center`
    );
  }
  for (const workCenter of dataset.foundation.workCenters) {
    const count = openByWorkCenter.get(workCenter.name) ?? 0;
    if (count < MIN_OPEN_OPERATIONS_PER_WORK_CENTER) {
      fail(
        `production floor: work center "${workCenter.name}" has ${count} open operations, need ≥ ${MIN_OPEN_OPERATIONS_PER_WORK_CENTER} (MES board column)`
      );
    }
  }
  if (running.size < MIN_RUNNING_WORK_CENTERS) {
    fail(
      `production floor: running operations on ${running.size} work centers, need ≥ ${MIN_RUNNING_WORK_CENTERS} (work-center displays)`
    );
  }
  if (assignedOpen < MIN_ASSIGNED_OPEN_OPERATIONS) {
    fail(
      `production floor: ${assignedOpen} open operations assigned to the applying user, need ≥ ${MIN_ASSIGNED_OPEN_OPERATIONS} (MES Assigned)`
    );
  }
  if (!openInspection) {
    fail(
      `production floor: no open Inspection operation on a released job — the MES inspection view is unreachable`
    );
  }

  // Tools ride every job copy of an operation; parameters come from its
  // procedure when it has one, else from the method (get-method's rule).
  const procedureParameterCount = new Map(
    dataset.foundation.procedures.map((proc) => [
      `procedure:${proc.name}`,
      (proc.parameters ?? []).length
    ])
  );
  let withTools = 0;
  let withParameters = 0;
  for (const job of jobs) {
    for (const op of [...rootOpsOf(job.item), ...subassemblyOpsOf(job.item)]) {
      if ((op.tools ?? []).length > 0) withTools += 1;
      const parameters = op.procedure
        ? (procedureParameterCount.get(op.procedure) ?? 0)
        : (op.parameters ?? []).length;
      if (parameters > 0) withParameters += 1;
    }
  }
  if (withTools < MIN_OPERATIONS_WITH_TOOLS) {
    fail(
      `production.jobs: ${withTools} job operations carry tools, need ≥ ${MIN_OPERATIONS_WITH_TOOLS}`
    );
  }
  if (withParameters < MIN_OPERATIONS_WITH_PARAMETERS) {
    fail(
      `production.jobs: ${withParameters} job operations carry parameters, need ≥ ${MIN_OPERATIONS_WITH_PARAMETERS}`
    );
  }

  // The batch, as batch-operations' create would accept it.
  const members = production.batch.members;
  if (members.length < 2) {
    fail(`production.batch: ${members.length} members, need ≥ 2`);
  }
  const memberJobs = new Set<string>();
  const memberProcesses = new Set<string>();
  for (const member of members) {
    const where = `production.batch member "${member.job}"`;
    if (memberJobs.has(member.job)) {
      fail(`${where}: members come from different jobs`);
    }
    memberJobs.add(member.job);
    const job = jobByKey.get(member.job);
    if (!job) {
      fail(`${where}: unknown job key`);
      continue;
    }
    if (!RELEASED_OPEN_JOB_STATUSES.has(job.status)) {
      fail(`${where}: job is ${job.status}, not released`);
    }
    if (member.job === production.eventsJobKey) {
      fail(`${where}: the events job's operations carry production events`);
    }
    const op = rootOpsOf(job.item)[member.order - 1];
    if (!op) {
      fail(`${where}: no root operation at position ${member.order}`);
      continue;
    }
    memberProcesses.add(op.process);
    const override = (job.operationOverrides ?? []).find(
      (o) => o.order === member.order
    );
    if (
      (override?.status &&
        !UNSTARTED_OPERATION_STATUSES.has(override.status)) ||
      override?.running
    ) {
      fail(`${where}: operation ${member.order} has already started`);
    }
    // The running batch timer puts every member on the floor.
    if (job.status !== "In Progress") {
      fail(`${where}: the batch is running, so its job is "In Progress"`);
    }
    for (let order = 1; order < member.order; order += 1) {
      const earlier = (job.operationOverrides ?? []).find(
        (o) => o.order === order
      );
      if (earlier?.status !== "Done") {
        fail(
          `${where}: operation ${order} runs before the batched operation ${member.order}, so it must be Done`
        );
      }
    }
  }
  if (!TIME_OF_DAY.test(production.batch.running.startTimeOfDay)) {
    fail(
      `production.batch.running: startTimeOfDay "${production.batch.running.startTimeOfDay}" is not HH:MM:SS`
    );
  }
  if (memberProcesses.size > 1) {
    fail(
      `production.batch: members span processes ${[...memberProcesses].join(", ")} — a batch runs one`
    );
  }

  // The 3D instruction plays on the item's Assembly operation.
  const assembly = dataset.items.assembly;
  if (assembly) {
    if (!assembly.item) {
      fail(
        `items.assembly: an instruction linked to an operation needs an item`
      );
    } else {
      const op = rootOpsOf(assembly.item)[assembly.operation - 1];
      if (op?.operationType !== "Assembly") {
        fail(
          `items.assembly: operation ${assembly.operation} of "${assembly.item}" is not an "Assembly" operation`
        );
      }
      const playable = jobs.some((job) => {
        if (
          job.item !== assembly.item ||
          !RELEASED_OPEN_JOB_STATUSES.has(job.status)
        ) {
          return false;
        }
        const status = (job.operationOverrides ?? []).find(
          (o) => o.order === assembly.operation
        )?.status;
        return status !== "Done" && status !== "Canceled";
      });
      if (!playable) {
        fail(
          `items.assembly: no released "${assembly.item}" job with its Assembly operation still open (MES 3D playback)`
        );
      }
    }
  }

  // get_action_tasks_by_item_and_process: the MES operation screen lists an
  // open issue's task only on an open operation of a linked process that
  // builds one of the issue's items.
  const openRootOps = released.flatMap((job) =>
    rootOpsOf(job.item)
      .map((op, index) => ({ job, op, order: index + 1 }))
      .filter(({ order }) => {
        const status = (job.operationOverrides ?? []).find(
          (o) => o.order === order
        )?.status;
        return status !== "Done" && status !== "Canceled";
      })
  );
  const taskReachesFloor = dataset.quality.nonConformances.some(
    (ncr) =>
      OPEN_NCR_STATUSES.has(ncr.status) &&
      (ncr.actionTasks ?? []).some(
        (task) =>
          OPEN_NCR_TASK_STATUSES.has(task.status) &&
          (task.processes ?? []).some((process) =>
            openRootOps.some(
              ({ job, op }) =>
                op.process === process &&
                ncr.items.some((line) => line.item === job.item)
            )
          )
      )
  );
  if (!taskReachesFloor) {
    fail(
      "quality.nonConformances: no open action task whose process runs on an open operation building one of the issue's items (MES operation › issue actions)"
    );
  }
}

// The 3D assembly: its bundled graph, step materials / tools, and mappings.

// The assembly detail's step panels and BOM tree.
const MIN_ASSEMBLY_STEP_MATERIALS = 2;
const MIN_ASSEMBLY_COMPONENT_MAPPINGS = 2;

export function assembly(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const { toolIds } = ix;
  const { componentsOf } = ix.bom;
  const assembly = dataset.items.assembly;
  if (assembly && dataset.industryId) {
    const graph = loadAssemblyGraph(dataset.industryId, assembly.model);
    if (!graph) {
      fail(
        `items.assembly: no bundled graph at assets/${dataset.industryId}/models/${assembly.model}.graph.json`
      );
    } else {
      if (assembly.componentCount !== graph.componentCount) {
        fail(
          `items.assembly "${assembly.model}": componentCount ${assembly.componentCount} != graph's ${graph.componentCount}`
        );
      }
      if (assembly.item !== undefined)
        need("item", "items.assembly", assembly.item);
      for (const step of assembly.steps) {
        for (const nodeId of step.componentNodeIds) {
          if (!graph.nodeIds.has(nodeId)) {
            fail(
              `items.assembly step "${step.title}": node id "${nodeId}" is not in the bundled graph`
            );
          }
        }
      }
      // Step materials / tools and the BOM tree's component mappings.
      const bom =
        assembly.item === undefined
          ? new Set<string>()
          : componentsOf(assembly.item);
      let stepMaterials = 0;
      let stepTools = 0;
      for (const step of assembly.steps) {
        const where = `items.assembly step "${step.title}"`;
        const seen = new Set<string>();
        for (const material of step.materials ?? []) {
          stepMaterials += 1;
          if (!bom.has(material.item)) {
            fail(
              `${where}: material "${material.item}" is not on "${assembly.item}"'s BOM`
            );
          }
          if (seen.has(material.item)) {
            fail(`${where}: material "${material.item}" listed twice`);
          }
          seen.add(material.item);
          if (material.quantity <= 0) {
            fail(
              `${where}: material "${material.item}" quantity must be positive`
            );
          }
        }
        const seenTools = new Set<string>();
        for (const tool of step.tools ?? []) {
          stepTools += 1;
          if (!toolIds.has(tool.item)) {
            fail(`${where}: tool "${tool.item}" is not a Tool item`);
          }
          if (seenTools.has(tool.item)) {
            fail(`${where}: tool "${tool.item}" listed twice`);
          }
          seenTools.add(tool.item);
          if (!Number.isInteger(tool.quantity) || tool.quantity <= 0) {
            fail(
              `${where}: tool "${tool.item}" quantity must be a positive integer`
            );
          }
        }
      }
      if (stepMaterials < MIN_ASSEMBLY_STEP_MATERIALS) {
        fail(
          `items.assembly: ${stepMaterials} step materials, need ≥ ${MIN_ASSEMBLY_STEP_MATERIALS}`
        );
      }
      if (stepTools < 1) {
        fail("items.assembly: no step names a tool");
      }
      const mappedHashes = new Set<string>();
      for (const mapping of assembly.componentMappings) {
        const where = `items.assembly componentMappings "${mapping.geometryHash}"`;
        if (!graph.geometryHashes.has(mapping.geometryHash)) {
          fail(`${where}: not a leaf geometryHash of the bundled graph`);
        }
        if (mappedHashes.has(mapping.geometryHash)) {
          fail(`${where}: mapped twice`);
        }
        mappedHashes.add(mapping.geometryHash);
        if (!bom.has(mapping.item)) {
          fail(
            `${where}: "${mapping.item}" is not on "${assembly.item}"'s BOM`
          );
        }
      }
      if (mappedHashes.size < MIN_ASSEMBLY_COMPONENT_MAPPINGS) {
        fail(
          `items.assembly: ${mappedHashes.size} component mappings, need ≥ ${MIN_ASSEMBLY_COMPONENT_MAPPINGS}`
        );
      }
    }
  }
}

// Inspection lots and their samples.

export function inspections(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const { jobByKey, isTracked } = ix;
  const { rootOpsOf } = ix.bom;
  const q = dataset.quality;
  const p = dataset.purchasing;
  // Inspection lots — each mirrors the path that creates it (post-receipt, or
  // the MES opening a job's Inspection operation), and every authored sample
  // is exactly what the engine would have derived from its readings.
  const seenInspection = {
    status: new Set<string>(),
    source: new Set<string>()
  };
  const receiptPlanByItem = new Map<string, string>();
  const receiptLines = new Set<string>();
  const inspectedJobs = new Set<string>();
  for (const insp of q.inspections) {
    const where = `quality.inspections "${insp.ref}"`;
    seenInspection.status.add(insp.status);
    seenInspection.source.add(insp.source);

    let features: InspectionFeatureSpec[] = [];
    let lotSize: number | undefined;
    let aql: number | undefined;
    let earliest = Number.NEGATIVE_INFINITY;
    if (insp.source === "Receipt") {
      need("item", where, insp.item);
      features = insp.features;
      aql = insp.aql;
      const lineKey = `${insp.receipt}|${insp.item}`;
      if (receiptLines.has(lineKey)) {
        fail(`${where}: a second lot on the same receipt line`);
      }
      receiptLines.add(lineKey);
      const plan = JSON.stringify([
        insp.drawingNumber,
        insp.aql,
        insp.features
      ]);
      const other = receiptPlanByItem.get(insp.item);
      if (other !== undefined && other !== plan) {
        fail(
          `${where}: "${insp.item}" has one Receipt-usage plan — every lot of it carries the same drawing, aql and features`
        );
      }
      receiptPlanByItem.set(insp.item, plan);
      const receipt = p.purchaseOrders
        .map((po) => (po.source === "direct" ? po.receipt : undefined))
        .find((r) => r?.ref === insp.receipt);
      const line = receipt?.lines.find((l) => l.item === insp.item);
      if (!receipt) {
        fail(`${where}: unknown purchasing receipt ref "${insp.receipt}"`);
      } else if (receipt.status !== "Posted") {
        fail(
          `${where}: receipt "${insp.receipt}" is ${receipt.status}, not Posted`
        );
      } else if (!line || line.receivedQuantity <= 0) {
        fail(`${where}: receipt "${insp.receipt}" received no "${insp.item}"`);
      } else {
        if (line.requiresBatchTracking || isTracked(insp.item)) {
          fail(
            `${where}: "${insp.item}" is tracked — the seeded lot has no per-entity samples`
          );
        }
        lotSize = line.receivedQuantity;
        earliest = receipt.postedOffset ?? 0;
      }
      const labels = new Set<string>();
      for (const feature of insp.features) {
        if (labels.has(feature.label)) {
          fail(`${where}: duplicate feature label "${feature.label}"`);
        }
        labels.add(feature.label);
      }
      if (insp.features.length < 2) {
        fail(`${where}: needs at least 2 features`);
      }
    } else {
      if (inspectedJobs.has(insp.job)) {
        fail(
          `${where}: a second lot on job "${insp.job}"'s Inspection operation`
        );
      }
      inspectedJobs.add(insp.job);
      const job = jobByKey.get(insp.job);
      if (!job) {
        fail(`${where}: unknown job key "${insp.job}"`);
      } else {
        if (!RELEASED_OPEN_JOB_STATUSES.has(job.status)) {
          fail(
            `${where}: job "${insp.job}" is ${job.status}, not released and open`
          );
        }
        const roots = rootOpsOf(job.item);
        const index = roots.findIndex(
          (op) => op.operationType === "Inspection"
        );
        const op = roots[index];
        const plan = dataset.items.inspectionPlans.find(
          (candidate) => candidate.key === op?.inspectionPlan
        );
        if (!op || !plan) {
          fail(
            `${where}: "${job.item}" has no root Inspection operation with an inspection plan`
          );
        } else {
          features = plan.features;
          aql = plan.aql;
          lotSize = job.quantity;
          earliest = job.releasedDateOffset ?? 0;
          const override = (job.operationOverrides ?? []).find(
            (o) => o.order === index + 1
          );
          const opStatus =
            override?.status ?? (job.status === "Paused" ? "Paused" : "Ready");
          if (opStatus === "Done" || opStatus === "Canceled") {
            fail(`${where}: the Inspection operation is ${opStatus}`);
          }
          if (insp.status === "In Progress" && opStatus !== "In Progress") {
            fail(
              `${where}: samples are being recorded, so the Inspection operation must be In Progress, not ${opStatus}`
            );
          }
        }
      }
      if (insp.status === "Passed" || insp.status === "Partial") {
        fail(
          `${where}: a dispositioned job-operation lot posts production quantities the seed does not author`
        );
      }
    }

    const dispositioned = insp.status === "Passed" || insp.status === "Partial";
    if (dispositioned !== (insp.dispositionOffset !== undefined)) {
      fail(
        `${where}: dispositionOffset is required exactly when dispositioned`
      );
    }
    if (insp.dispositionOffset !== undefined && insp.dispositionOffset > 0) {
      fail(`${where}: dispositionOffset is in the future`);
    }
    if (lotSize !== undefined && aql !== undefined) {
      const plan = resolveInspectionPlan({ aql }, lotSize);
      if (plan.sampleSize > 5) {
        fail(
          `${where}: lot of ${lotSize} resolves to n=${plan.sampleSize} — pick a lot whose sample size is ≤ 5`
        );
      }
      const n = insp.samples.length;
      if (dispositioned && n !== plan.sampleSize) {
        fail(
          `${where}: ${n} samples authored but the plan resolves to n=${plan.sampleSize}`
        );
      }
      if (insp.status === "Pending" && n !== 0) {
        fail(`${where}: a Pending lot has no recorded samples`);
      }
      if (insp.status === "In Progress" && (n === 0 || n >= plan.sampleSize)) {
        fail(
          `${where}: an In Progress lot has 1…${plan.sampleSize - 1} recorded samples, not ${n}`
        );
      }
    }
    const latest = insp.dispositionOffset ?? -1;
    for (const [index, sample] of insp.samples.entries()) {
      if (
        sample.inspectedOffset < earliest ||
        sample.inspectedOffset > latest
      ) {
        fail(
          `${where} sample ${index + 1}: inspectedOffset ${sample.inspectedOffset} outside [${earliest}, ${latest}]`
        );
      }
      const labels = new Set(features.map((f) => f.label));
      const read = new Set<string>();
      for (const reading of sample.measurements) {
        if (!labels.has(reading.feature)) {
          fail(
            `${where} sample ${index + 1}: unknown feature "${reading.feature}"`
          );
        }
        if (read.has(reading.feature)) {
          fail(
            `${where} sample ${index + 1}: feature "${reading.feature}" read twice`
          );
        }
        read.add(reading.feature);
      }
      const derived = deriveSampleStatus(features, sample);
      if (derived !== sample.status) {
        fail(
          `${where} sample ${index + 1}: status "${sample.status}" but its readings derive "${derived}"`
        );
      }
    }
    const passed = insp.samples.filter((s) => s.status === "Passed").length;
    const failed = insp.samples.filter((s) => s.status === "Failed").length;
    if (insp.status === "Partial" && (passed === 0 || failed === 0)) {
      fail(`${where}: Partial needs at least one Passed and one Failed sample`);
    }
    if (insp.status === "Passed" && failed > 0) {
      fail(`${where}: Passed lot has a Failed sample`);
    }
  }
  checkCoverage(fail, {
    inspectionStatus: seenInspection.status,
    inspectionSource: seenInspection.source
  });
}

// Quality: issue workflows, non-conformances, quality documents, gauges,
// risks, and the quality matrix. Inspection lots are rules/inspections.ts.

const MIN_NCR_WORKFLOWS = 3;
const MIN_WORKFLOW_LINKED_NCRS = 2;
/** The quality dashboard's supplier KPI reads issues opened in the last month. */
const SUPPLIER_QUALITY_WINDOW_DAYS = 28;
/** Dispositions the closeIssue path accepts without posting inventory value. */
const CLOSED_NCR_DISPOSITIONS = new Set(["Use As Is", "Rework"]);

// A completed task/approval carries its completion day, on/after the NCR
// opened and never in the future.
export function checkCompletion(
  fail: (message: string) => void,
  where: string,
  status: string,
  openDateOffset: number,
  completedOffset: number | undefined
): void {
  if (status === "Completed" && completedOffset === undefined) {
    fail(`${where}: Completed but has no completedOffset`);
  }
  if (status !== "Completed" && completedOffset !== undefined) {
    fail(`${where}: completedOffset on a task that is "${status}"`);
  }
  if (
    completedOffset !== undefined &&
    (completedOffset < openDateOffset || completedOffset > 0)
  ) {
    fail(
      `${where}: completedOffset ${completedOffset} outside [${openDateOffset}, 0]`
    );
  }
}

export function quality(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const p = dataset.purchasing;
  const q = dataset.quality;
  const seenQuality = {
    ncrStatus: new Set<string>(),
    ncrPriority: new Set<string>(),
    ncrSource: new Set<string>(),
    ncrTaskStatus: new Set<string>(),
    documentStatus: new Set<string>(),
    gaugeStatus: new Set<string>(),
    gaugeCalibration: new Set<string>(),
    riskStatus: new Set<string>(),
    riskSource: new Set<string>(),
    riskType: new Set<string>()
  };

  // Direct POs by ref (supplier + line items) and sales order LINE refs by
  // customer — what an NCR's PO-line / SO-line associations resolve against.
  const directPoByRef = new Map<
    string,
    { supplier: string; items: Set<string> }
  >();
  for (const po of p.purchaseOrders) {
    if (po.source !== "direct" || po.ref === undefined) continue;
    directPoByRef.set(po.ref, {
      supplier: po.supplier,
      items: new Set(po.lines.map((line) => line.item))
    });
  }
  const salesOrderLineCustomer = new Map<string, string>();
  for (const spec of [
    ...dataset.sales.opportunities,
    ...dataset.sales.releasedOrders
  ]) {
    for (const line of spec.order?.lines ?? []) {
      salesOrderLineCustomer.set(line.ref, spec.customer);
    }
  }
  for (const spec of dataset.sales.statusOrders) {
    salesOrderLineCustomer.set(`soline:${spec.key}`, spec.customer);
  }
  const inspectionRefs = new Set(q.inspections.map((insp) => insp.ref));

  // Issue workflows — the templates the new-issue form copies onto an NCR.
  const workflowByKey = new Map<string, (typeof q.workflows)[number]>();
  const workflowNames = new Set<string>();
  for (const workflow of q.workflows) {
    const where = `quality.workflows "${workflow.key}"`;
    if (workflowByKey.has(workflow.key)) fail(`${where}: duplicate key`);
    workflowByKey.set(workflow.key, workflow);
    if (workflowNames.has(workflow.name)) fail(`${where}: duplicate name`);
    workflowNames.add(workflow.name);
    if (!workflow.description.trim()) fail(`${where}: empty description`);
    if (workflow.requiredActions.length === 0) {
      fail(`${where}: no required actions`);
    }
    const actions = new Set<string>();
    for (const action of workflow.requiredActions) {
      if (!NCR_ACTION_NAMES.has(action)) {
        fail(
          `${where}: "${action}" is not a bootstrap nonConformanceRequiredAction`
        );
      }
      if (actions.has(action)) fail(`${where}: duplicate action "${action}"`);
      actions.add(action);
    }
  }
  if (q.workflows.length < MIN_NCR_WORKFLOWS) {
    fail(
      `quality.workflows: ${q.workflows.length} workflows, need ≥ ${MIN_NCR_WORKFLOWS} (Issue Workflows)`
    );
  }

  const processesInUse = new Set(
    dataset.items.methods.flatMap((method) =>
      method.bop.map((op) => op.process)
    )
  );
  const { documentRefs } = ix;
  for (const [ncrIndex, ncr] of q.nonConformances.entries()) {
    const where = `quality.nonConformances "${ncr.ref}"`;
    seenQuality.ncrStatus.add(ncr.status);
    seenQuality.ncrPriority.add(ncr.priority);
    seenQuality.ncrSource.add(ncr.source);
    if (
      ncr.jobOperation &&
      !documentRefs.has(
        ncr.jobOperation.job,
        documentRefs.seenBy.nonConformances[ncrIndex]!
      )
    ) {
      fail(`${where}: unknown job ref "${ncr.jobOperation.job}"`);
    }
    if (ncr.items.length === 0) {
      fail(
        `${where}: no items — the issue's Items card and Actions list are empty`
      );
    }
    const ncrItems = new Set<string>();
    for (const line of ncr.items) {
      need("item", where, line.item);
      if (ncrItems.has(line.item))
        fail(`${where}: item "${line.item}" listed twice`);
      ncrItems.add(line.item);
      if (line.quantity <= 0) {
        fail(`${where} item "${line.item}": quantity must be positive`);
      }
      const disposition = line.disposition ?? "Pending";
      if (
        ncr.status === "Closed" &&
        !CLOSED_NCR_DISPOSITIONS.has(disposition)
      ) {
        fail(
          `${where} item "${line.item}": a Closed issue's rows are dispositioned Use As Is or Rework (other dispositions post inventory value the seed does not author), not "${disposition}"`
        );
      }
    }
    if (ncr.assignee !== undefined && !OPEN_NCR_STATUSES.has(ncr.status)) {
      fail(
        `${where}: an assignee on a ${ncr.status} issue (closing clears it)`
      );
    }
    if (ncr.workflow !== undefined) {
      const workflow = workflowByKey.get(ncr.workflow);
      if (!workflow) {
        fail(`${where}: unknown workflow "${ncr.workflow}"`);
      } else {
        const actions = (ncr.actionTasks ?? []).map((t) => t.action);
        if (
          workflow.source !== ncr.source ||
          JSON.stringify(workflow.requiredActions) !==
            JSON.stringify(actions) ||
          Boolean(workflow.mrb) !== Boolean(ncr.mrb)
        ) {
          fail(
            `${where}: raised from workflow "${ncr.workflow}" but its source, required actions or MRB differ from the workflow's`
          );
        }
      }
    }

    if (ncr.type !== undefined && !NCR_TYPE_NAMES.has(ncr.type)) {
      fail(
        `${where}: type "${ncr.type}" is not a bootstrap nonConformanceType`
      );
    }
    if (ncr.openDateOffset > 0)
      fail(`${where}: openDateOffset is in the future`);
    if (ncr.status === "Closed") {
      if (ncr.closeDateOffset === undefined) {
        fail(`${where}: Closed but has no closeDateOffset`);
      } else if (
        ncr.closeDateOffset < ncr.openDateOffset ||
        ncr.closeDateOffset > 0
      ) {
        fail(
          `${where}: closeDateOffset ${ncr.closeDateOffset} outside [${ncr.openDateOffset}, 0]`
        );
      }
    } else if (ncr.closeDateOffset !== undefined) {
      fail(`${where}: closeDateOffset on a ${ncr.status} NCR`);
    }

    if (ncr.supplier !== undefined) need("supplier", where, ncr.supplier);
    if (ncr.purchaseOrderLine !== undefined) {
      const { po, item } = ncr.purchaseOrderLine;
      const order = directPoByRef.get(po);
      if (!order) {
        fail(`${where}: unknown direct purchase order ref "${po}"`);
      } else {
        if (!order.items.has(item)) {
          fail(`${where}: purchase order "${po}" has no line for "${item}"`);
        }
        if (order.supplier !== ncr.supplier) {
          fail(
            `${where}: purchase order "${po}" is on "${order.supplier}", not the NCR's supplier "${ncr.supplier ?? "(none)"}"`
          );
        }
      }
    }
    if (ncr.customer !== undefined) need("customer", where, ncr.customer);
    if (ncr.salesOrderLine !== undefined) {
      const owner = salesOrderLineCustomer.get(ncr.salesOrderLine);
      if (owner === undefined) {
        fail(`${where}: unknown sales order line ref "${ncr.salesOrderLine}"`);
      } else if (owner !== ncr.customer) {
        fail(
          `${where}: sales order line "${ncr.salesOrderLine}" belongs to "${owner}", not the NCR's customer "${ncr.customer ?? "(none)"}"`
        );
      }
    }
    if (
      ncr.trackedEntity !== undefined &&
      !ix.lots.onHandIds.has(ncr.trackedEntity) &&
      !ix.lots.receiptLotIds.has(ncr.trackedEntity)
    ) {
      fail(
        `${where}: tracked entity "${ncr.trackedEntity}" is not an on-hand lot/serial or a receipt lotNumber`
      );
    }
    if (ncr.inspection !== undefined && !inspectionRefs.has(ncr.inspection)) {
      fail(`${where}: unknown inspection ref "${ncr.inspection}"`);
    }

    const actions = new Set<string>();
    for (const task of ncr.actionTasks ?? []) {
      const taskWhere = `${where} action "${task.action}"`;
      if (!NCR_ACTION_NAMES.has(task.action)) {
        fail(`${taskWhere}: not a bootstrap nonConformanceRequiredAction`);
      }
      if (actions.has(task.action))
        fail(`${taskWhere}: duplicate required action`);
      actions.add(task.action);
      seenQuality.ncrTaskStatus.add(task.status);
      for (const process of task.processes ?? []) {
        if (!processesInUse.has(process)) {
          fail(
            `${taskWhere}: process "${process}" is not used by any operation`
          );
        }
      }
      if (
        (task.processes ?? []).length > 0 &&
        !OPEN_NCR_TASK_STATUSES.has(task.status)
      ) {
        fail(`${taskWhere}: processes are linked while a task is open`);
      }
      checkCompletion(
        fail,
        taskWhere,
        task.status,
        ncr.openDateOffset,
        task.completedOffset
      );
    }
    const allTasks = [
      ...(ncr.actionTasks ?? []).map((t) => t.status),
      ...(ncr.mrb
        ? [ncr.mrb.status, ...ncr.mrb.reviewers.map((r) => r.status)]
        : [])
    ];
    // Tasks start Pending and working one moves the issue to In Progress; a
    // Closed issue has nothing left open.
    if (ncr.status === "Registered" && allTasks.some((s) => s !== "Pending")) {
      fail(`${where}: a Registered NCR can only have Pending tasks`);
    }
    if (
      ncr.status === "Closed" &&
      allTasks.some((s) => s !== "Completed" && s !== "Skipped")
    ) {
      fail(`${where}: a Closed NCR has open tasks`);
    }
    if (ncr.mrb) {
      checkCompletion(
        fail,
        `${where} MRB approval`,
        ncr.mrb.status,
        ncr.openDateOffset,
        ncr.mrb.completedOffset
      );
      const titles = new Set<string>();
      for (const reviewer of ncr.mrb.reviewers) {
        if (titles.has(reviewer.title)) {
          fail(`${where}: duplicate MRB reviewer "${reviewer.title}"`);
        }
        titles.add(reviewer.title);
        checkCompletion(
          fail,
          `${where} reviewer "${reviewer.title}"`,
          reviewer.status,
          ncr.openDateOffset,
          reviewer.completedOffset
        );
      }
    }
  }

  const linkedNcrs = q.nonConformances.filter((n) => n.workflow !== undefined);
  if (linkedNcrs.length < MIN_WORKFLOW_LINKED_NCRS) {
    fail(
      `quality.nonConformances: ${linkedNcrs.length} issues raised from a workflow, need ≥ ${MIN_WORKFLOW_LINKED_NCRS}`
    );
  }
  if (
    !q.nonConformances.some(
      (n) => n.assignee === "self" && OPEN_NCR_STATUSES.has(n.status)
    )
  ) {
    fail(
      "quality.nonConformances: no open issue assigned to the applying user (dashboard › Assigned to me)"
    );
  }
  if (
    !q.nonConformances.some(
      (n) =>
        n.supplier !== undefined &&
        n.openDateOffset >= -SUPPLIER_QUALITY_WINDOW_DAYS
    )
  ) {
    fail(
      `quality.nonConformances: no supplier issue opened in the last ${SUPPLIER_QUALITY_WINDOW_DAYS} days (dashboard › Supplier quality)`
    );
  }
  if (
    !q.nonConformances.some((n) =>
      (n.actionTasks ?? []).some((t) => (t.processes ?? []).length > 0)
    )
  ) {
    fail(
      "quality.nonConformances: no open action task linked to a process (nonConformanceActionProcess)"
    );
  }

  const documentVersions = new Set<string>();
  for (const doc of q.qualityDocuments) {
    const where = `quality.qualityDocuments "${doc.name}" v${doc.version}`;
    seenQuality.documentStatus.add(doc.status);
    const key = `${doc.name}@${doc.version}`;
    if (documentVersions.has(key)) fail(`${where}: duplicate (name, version)`);
    documentVersions.add(key);
    if (doc.version < 0) fail(`${where}: version must be ≥ 0`);
    if (doc.status === "Active" && doc.steps.length < 2) {
      fail(`${where}: the Active document needs at least 2 steps`);
    }
    for (const step of doc.steps) {
      const stepWhere = `${where} step "${step.name}"`;
      if (step.type === "Measurement") {
        if (step.unitOfMeasureCode === undefined) {
          fail(`${stepWhere}: Measurement step needs a unitOfMeasureCode`);
        } else if (!UOM_CODES.has(step.unitOfMeasureCode)) {
          fail(
            `${stepWhere}: unitOfMeasureCode "${step.unitOfMeasureCode}" is not a bootstrap unit of measure`
          );
        }
      } else if (step.unitOfMeasureCode !== undefined) {
        fail(`${stepWhere}: only Measurement steps take a unitOfMeasureCode`);
      }
      if (step.type === "List" && (step.listValues ?? []).length === 0) {
        fail(`${stepWhere}: List step needs listValues`);
      }
      if (
        step.minValue !== undefined &&
        step.maxValue !== undefined &&
        step.minValue > step.maxValue
      ) {
        fail(`${stepWhere}: minValue > maxValue`);
      }
    }
  }

  const gaugeKeys = new Set<string>();
  let activeMaster = false;
  for (const gauge of q.gauges) {
    const where = `quality.gauges "${gauge.key}"`;
    if (gaugeKeys.has(gauge.key)) fail(`${where}: duplicate gauge key`);
    gaugeKeys.add(gauge.key);
    if (!GAUGE_TYPE_NAMES.has(gauge.gaugeType)) {
      fail(
        `${where}: gaugeType "${gauge.gaugeType}" is not a bootstrap gauge type`
      );
    }
    if (gauge.supplier !== undefined) need("supplier", where, gauge.supplier);
    if (gauge.shelf !== undefined) need("shelf", where, gauge.shelf);
    if (gauge.calibrationIntervalInMonths <= 0) {
      fail(`${where}: calibrationIntervalInMonths must be positive`);
    }
    if (gauge.acquiredOffset > 0)
      fail(`${where}: acquiredOffset is in the future`);
    let previous = gauge.acquiredOffset;
    for (const record of gauge.calibrations) {
      if (record.dateOffset < previous || record.dateOffset > 0) {
        fail(
          `${where}: calibration on ${record.dateOffset} is out of order (after acquisition, oldest first, not in the future)`
        );
      }
      previous = record.dateOffset;
    }
    const latest = gauge.calibrations.at(-1);
    const calibration =
      latest === undefined
        ? "Pending"
        : latest.result === "Pass"
          ? "In-Calibration"
          : "Out-of-Calibration";
    // The gauges view flips an overdue gauge to Out-of-Calibration; an
    // In-Calibration gauge must still be inside its interval (28-day months,
    // conservatively).
    if (
      calibration === "In-Calibration" &&
      latest !== undefined &&
      latest.dateOffset + 28 * gauge.calibrationIntervalInMonths <= 0
    ) {
      fail(`${where}: last Pass calibration is already past its interval`);
    }
    seenQuality.gaugeStatus.add(gauge.status);
    seenQuality.gaugeCalibration.add(calibration);
    if (gauge.role === "Master" && gauge.status === "Active")
      activeMaster = true;
  }
  if (!activeMaster) fail("quality.gauges: needs an Active Master gauge");

  for (const risk of q.risks) {
    const where = `quality.risks "${risk.title}"`;
    seenQuality.riskStatus.add(risk.status);
    seenQuality.riskSource.add(risk.source);
    seenQuality.riskType.add(risk.type);
    for (const [field, value] of [
      ["severity", risk.severity],
      ["likelihood", risk.likelihood]
    ] as const) {
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        fail(`${where}: ${field} ${value} must be an integer 1–5`);
      }
    }
    switch (risk.source) {
      case "Customer":
        need("customer", where, risk.customer);
        break;
      case "Supplier":
        need("supplier", where, risk.supplier);
        break;
      case "Item":
        need("item", where, risk.item);
        break;
      case "Job":
        if (
          !risk.job.startsWith("job:") ||
          !documentRefs.has(risk.job, documentRefs.seenBy.risks)
        ) {
          fail(`${where}: unknown job ref "${risk.job}"`);
        }
        break;
      case "Work Center":
        need("workCenter", where, risk.workCenter);
        break;
      case "General":
        break;
    }
  }

  checkCoverage(fail, {
    ncrStatus: seenQuality.ncrStatus,
    ncrPriority: seenQuality.ncrPriority,
    ncrSource: seenQuality.ncrSource,
    ncrTaskStatus: seenQuality.ncrTaskStatus,
    qualityDocumentStatus: seenQuality.documentStatus,
    gaugeStatus: seenQuality.gaugeStatus,
    gaugeCalibrationStatus: seenQuality.gaugeCalibration,
    riskStatus: seenQuality.riskStatus,
    riskSource: seenQuality.riskSource,
    riskType: seenQuality.riskType
  });
}

// Change orders and their action tasks.

export function changeOrders(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const seenChangeOrderStatus = new Set<string>();
  const seenChangeOrderTaskStatus = new Set<string>();
  for (const co of dataset.changeOrders.changeOrders) {
    const where = `changeOrders "${co.ref}"`;
    seenChangeOrderStatus.add(co.status);
    for (const affected of co.affectedItems) {
      need("item", where, affected.item);
      if (affected.changeType === "Revision" && !affected.revision) {
        fail(`${where}: Revision on "${affected.item}" has no revision spec`);
      }
      for (const edit of affected.revision?.bomEdits ?? []) {
        need("item", `${where} bomEdits`, edit.component);
      }
    }
    if (
      co.changeOrderType !== undefined &&
      !CO_TYPE_NAMES.has(co.changeOrderType)
    ) {
      fail(
        `${where}: changeOrderType "${co.changeOrderType}" is not a bootstrap changeOrderType`
      );
    }
    if (co.nonConformance !== undefined && !ix.ncrRefs.has(co.nonConformance)) {
      fail(`${where}: unknown NCR ref "${co.nonConformance}"`);
    }
    if (
      co.dueDateOffset !== undefined &&
      co.dueDateOffset < co.openDateOffset
    ) {
      fail(`${where}: dueDateOffset before openDateOffset`);
    }
    const actions = new Set<string>();
    for (const task of co.actionTasks ?? []) {
      const taskWhere = `${where} action "${task.action}"`;
      if (!CO_ACTION_NAMES.has(task.action)) {
        fail(`${taskWhere}: not a bootstrap changeOrderRequiredAction`);
      }
      if (actions.has(task.action))
        fail(`${taskWhere}: duplicate required action`);
      actions.add(task.action);
      seenChangeOrderTaskStatus.add(task.status);
      checkCompletion(
        fail,
        taskWhere,
        task.status,
        co.openDateOffset,
        task.completedOffset
      );
    }
  }
  checkCoverage(fail, {
    changeOrderStatus: seenChangeOrderStatus,
    changeOrderTaskStatus: seenChangeOrderTaskStatus
  });
}

// Accounting: projects, the custom dimension, manual journals, memos,
// payments and their settlements, the close checklist, FX rates, fixed assets.

type InvoiceFacts = {
  party: string;
  /** Σ line quantity × price — what the salesInvoices/purchaseInvoices views total. */
  total: number;
  issued: number;
  status: string;
  currencyCode: string;
};

export function accounting(ctx: ValidationCtx): void {
  const { dataset, ix, fail } = ctx;
  const customers = ix.refs.customer;
  const suppliers = ix.refs.supplier;
  const a = dataset.accounting;

  // ── Keyed invoice registry (sinv:/pinv: refs the payments settle) ─────────
  const salesInvoices = new Map<string, InvoiceFacts>();
  for (const opp of [
    ...dataset.sales.opportunities,
    ...dataset.sales.releasedOrders
  ]) {
    const inv = opp.invoice;
    if (inv?.key === undefined) continue;
    salesInvoices.set(inv.key, {
      party: opp.customer,
      total: inv.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
      issued: inv.dateIssuedOffset,
      status: inv.status,
      currencyCode: "USD"
    });
  }
  const purchaseInvoices = new Map<string, InvoiceFacts>();
  for (const po of dataset.purchasing.purchaseOrders) {
    if (po.source !== "direct" || po.invoice?.key === undefined) continue;
    purchaseInvoices.set(po.invoice.key, {
      party: po.supplier,
      total: po.invoice.lines.reduce(
        (s, l) => s + l.quantity * l.supplierUnitPrice,
        0
      ),
      issued: po.invoice.dateIssuedOffset,
      status: po.invoice.status,
      currencyCode: po.invoice.currencyCode
    });
  }
  const invoiceIn = (sales: boolean) =>
    sales ? salesInvoices : purchaseInvoices;
  const invoiceLabel = (sales: boolean, key: string) =>
    `${sales ? "sinv" : "pinv"}:${key}`;
  // Settled principal per invoice label, and who settled it.
  const settled = new Map<string, number>();
  const partialDates = new Map<string, number[]>();
  const settle = (label: string, amount: number, dateOffset: number) => {
    settled.set(label, (settled.get(label) ?? 0) + amount);
    partialDates.set(label, [...(partialDates.get(label) ?? []), dateOffset]);
  };

  // ── Projects ───────────────────────────────────────────────────────────────
  const projectKeys = new Set<string>();
  const projectNames = new Set<string>();
  for (const project of a.projects) {
    const where = `accounting.projects "${project.key}"`;
    if (projectKeys.has(project.key)) fail(`${where}: duplicate key`);
    if (projectNames.has(project.name))
      fail(`${where}: duplicate name "${project.name}" (unique per company)`);
    projectKeys.add(project.key);
    projectNames.add(project.name);
    const link = project.purchaseInvoiceLine;
    if (link) {
      const po = dataset.purchasing.purchaseOrders.find(
        (p) => p.source === "direct" && p.invoice?.key === link.invoiceKey
      );
      if (!po || po.source !== "direct" || !po.invoice) {
        fail(`${where}: unknown purchase invoice key "${link.invoiceKey}"`);
      } else if (
        po.invoice.lines.filter((l) => l.item === link.item).length !== 1
      ) {
        fail(
          `${where}: purchase invoice "${link.invoiceKey}" has no single line for "${link.item}"`
        );
      }
    }
  }
  if (a.projects.length < 2) fail("accounting.projects: expected at least 2");
  if (!a.projects.some((p) => p.purchaseInvoiceLine)) {
    fail("accounting.projects: no project codes a purchase invoice line");
  }

  // ── Custom dimension ───────────────────────────────────────────────────────
  const custom = a.customDimension;
  if (BOOTSTRAP_DIMENSION_NAMES.has(custom.name)) {
    fail(
      `accounting.customDimension: "${custom.name}" collides with a bootstrap dimension`
    );
  }
  if (new Set(custom.values).size !== custom.values.length) {
    fail("accounting.customDimension: duplicate value");
  }
  if (custom.values.length < 2) {
    fail("accounting.customDimension: expected at least 2 values");
  }

  // ── Journal entries ────────────────────────────────────────────────────────
  const journalEntryIds = new Set<string>();
  const seenJournalStatus = new Set<string>();
  let postedDimensionTags = 0;
  const needEntryId = (where: string, id: string) => {
    if (journalEntryIds.has(id))
      fail(`${where}: duplicate journalEntryId "${id}"`);
    journalEntryIds.add(id);
  };
  for (const entry of a.journalEntries) {
    const where = `accounting.journalEntries "${entry.ref}"`;
    needEntryId(where, entry.journalEntryId);
    seenJournalStatus.add(entry.status);
    const net = journalImbalance(entry);
    // Stricter than the app's manual-journal 0.001 (accounting.service.ts):
    // authored amounts are exact, so any residual is an authoring error.
    if (Math.abs(net) > EPSILON) {
      fail(`${where}: entry does not balance (net ${net})`);
    }
    if (entry.lines.length < 2) fail(`${where}: needs at least two lines`);
    // The period-open trigger rejects ANY journal dated in a Closed period;
    // posted work belongs in an Open one.
    const minOffset =
      entry.status === "Draft" ? NOT_CLOSED_MIN_OFFSET : OPEN_PERIOD_MIN_OFFSET;
    if (entry.postingOffset > 0 || entry.postingOffset < minOffset) {
      fail(
        `${where}: postingOffset ${entry.postingOffset} outside [${minOffset}, 0] (seeded period close state)`
      );
    }
    const references = entry.lines.map((l) => l.journalLineReference);
    for (const line of entry.lines) {
      if ((line.accountClass === undefined) === (line.account === undefined)) {
        fail(
          `${where}: a line must name exactly one of accountClass / account`
        );
      } else if (lineClass(line) === undefined) {
        fail(`${where}: unknown GL account "${line.account}"`);
      }
      if (!line.dimensions?.length) continue;
      if (
        references.filter((r) => r === line.journalLineReference).length !== 1
      ) {
        fail(
          `${where}: a dimension-tagged line needs a unique journalLineReference ("${line.journalLineReference}")`
        );
      }
      const dims = new Set<string>();
      for (const tag of line.dimensions) {
        if (dims.has(tag.dimension))
          fail(
            `${where}: dimension "${tag.dimension}" tagged twice on one line`
          );
        dims.add(tag.dimension);
        if (tag.dimension === "Project") {
          if (!projectKeys.has(tag.value))
            fail(`${where}: unknown project "${tag.value}"`);
        } else if (tag.dimension !== custom.name) {
          fail(`${where}: unknown dimension "${tag.dimension}"`);
        } else if (!custom.values.includes(tag.value)) {
          fail(`${where}: "${tag.value}" is not a ${custom.name} value`);
        }
        if (entry.status === "Posted") postedDimensionTags++;
      }
    }
    if ((entry.status === "Reversed") !== (entry.reversal !== undefined)) {
      fail(
        `${where}: a reversal entry is required exactly when status is Reversed`
      );
    }
    if (entry.reversal) {
      needEntryId(where, entry.reversal.journalEntryId);
      if (
        entry.reversal.postingOffset < entry.postingOffset ||
        entry.reversal.postingOffset > 0
      ) {
        fail(
          `${where}: reversal postingOffset ${entry.reversal.postingOffset} must fall between the original's and today`
        );
      }
    }
  }
  checkCoverage(fail, { journalStatus: seenJournalStatus });
  if (postedDimensionTags === 0) {
    fail("accounting.journalEntries: no Posted line carries a dimension tag");
  }

  // ── Memos ──────────────────────────────────────────────────────────────────
  const memos = new Map<
    string,
    { party: string; direction: string; amount: number; dateOffset: number }
  >();
  const seenDirections = new Set<string>();
  for (const memo of a.memos) {
    const where = `accounting.memos "${memo.key}"`;
    seenDirections.add(memo.direction);
    const sales = memo.direction === "Credit";
    const party = sales ? memo.customer : memo.supplier;
    if (!party || (sales ? memo.supplier : memo.customer) !== undefined) {
      fail(
        `${where}: a ${memo.direction} memo names exactly one ${sales ? "customer" : "supplier"}`
      );
      continue;
    }
    if (!(sales ? customers : suppliers).has(party))
      fail(`${where}: unknown ${sales ? "customer" : "supplier"} "${party}"`);
    const invoice = invoiceIn(sales).get(memo.invoiceKey);
    if (!invoice) {
      fail(
        `${where}: unknown invoice key "${invoiceLabel(sales, memo.invoiceKey)}"`
      );
      continue;
    }
    if (invoice.party !== party)
      fail(
        `${where}: party "${party}" does not match the invoice's "${invoice.party}"`
      );
    if (invoice.currencyCode !== "USD")
      fail(`${where}: memos settle base-currency (USD) invoices only`);
    if (
      memo.amount <= 0 ||
      round(memo.amount, USD_DECIMALS) > round(invoice.total, USD_DECIMALS)
    )
      fail(
        `${where}: amount ${memo.amount} outside (0, invoice total ${invoice.total}]`
      );
    if (
      memo.dateOffset < invoice.issued ||
      memo.dateOffset > 0 ||
      memo.dateOffset < OPEN_PERIOD_MIN_OFFSET
    ) {
      fail(
        `${where}: dateOffset ${memo.dateOffset} must fall between the invoice's issue date and today`
      );
    }
    memos.set(memo.key, {
      party,
      direction: memo.direction,
      amount: memo.amount,
      dateOffset: memo.dateOffset
    });
  }
  checkCoverage(fail, { memoDirection: seenDirections });

  // ── Payments + settlements ─────────────────────────────────────────────────
  const seenTypes = new Set<string>();
  const memoConsumed = new Map<string, number>();
  for (const payment of a.payments) {
    const where = `accounting.payments "${payment.key}"`;
    if (payment.status === "Draft") {
      // Checked with the open invoices in rules/postings.ts.
      continue;
    }
    seenTypes.add(payment.type);
    const sales = payment.type === "Receipt";
    const party = sales ? payment.customer : payment.supplier;
    if (!party || (sales ? payment.supplier : payment.customer) !== undefined) {
      fail(
        `${where}: a ${payment.type} names exactly one ${sales ? "customer" : "supplier"}`
      );
      continue;
    }
    if (!(sales ? customers : suppliers).has(party))
      fail(`${where}: unknown ${sales ? "customer" : "supplier"} "${party}"`);
    if (payment.amount < 0) fail(`${where}: negative amount`);
    const applied = payment.applies.reduce((s, x) => s + x.amount, 0);
    if (round(applied, USD_DECIMALS) !== round(payment.amount, USD_DECIMALS)) {
      fail(
        `${where}: applications total ${applied} but the payment is ${payment.amount}`
      );
    }
    if (payment.amount === 0 && !payment.credits?.length) {
      fail(`${where}: a zero-cash payment must carry credit applications`);
    }
    if (payment.dateOffset > 0 || payment.dateOffset < OPEN_PERIOD_MIN_OFFSET) {
      fail(
        `${where}: dateOffset ${payment.dateOffset} outside [${OPEN_PERIOD_MIN_OFFSET}, 0]`
      );
    }
    const checkTarget = (invoiceKey: string, amount: number) => {
      const invoice = invoiceIn(sales).get(invoiceKey);
      const label = invoiceLabel(sales, invoiceKey);
      if (!invoice) {
        fail(`${where}: unknown invoice key "${label}"`);
        return;
      }
      if (invoice.party !== party)
        fail(
          `${where}: party "${party}" does not match ${label}'s "${invoice.party}"`
        );
      if (invoice.currencyCode !== "USD")
        fail(
          `${where}: ${label} is not base currency — seeded settlements are USD only`
        );
      if (amount <= 0) fail(`${where}: non-positive application to ${label}`);
      if (payment.dateOffset < invoice.issued) {
        fail(
          `${where}: dateOffset ${payment.dateOffset} precedes ${label}'s issue date ${invoice.issued}`
        );
      }
      settle(label, amount, payment.dateOffset);
    };
    for (const apply of payment.applies)
      checkTarget(apply.invoiceKey, apply.amount);
    for (const credit of payment.credits ?? []) {
      const memo = memos.get(credit.memoKey);
      if (!memo) {
        fail(`${where}: unknown memo "${credit.memoKey}"`);
        continue;
      }
      if (
        memo.direction !== (sales ? "Credit" : "Debit") ||
        memo.party !== party
      ) {
        fail(
          `${where}: memo "${credit.memoKey}" must be a ${sales ? "Credit" : "Debit"} memo of "${party}"`
        );
      }
      if (payment.dateOffset < memo.dateOffset) {
        fail(`${where}: applies memo "${credit.memoKey}" before it was posted`);
      }
      memoConsumed.set(
        credit.memoKey,
        (memoConsumed.get(credit.memoKey) ?? 0) + credit.amount
      );
      checkTarget(credit.invoiceKey, credit.amount);
    }
  }
  checkCoverage(fail, { paymentType: seenTypes });
  for (const [key, consumed] of memoConsumed) {
    const memo = memos.get(key);
    if (
      memo &&
      round(consumed, USD_DECIMALS) > round(memo.amount, USD_DECIMALS)
    ) {
      fail(
        `accounting.memos "${key}": applied ${consumed} exceeds its amount ${memo.amount}`
      );
    }
  }
  // The invoice views derive status from settlements, so the authored status
  // and the settled total must agree.
  for (const sales of [true, false]) {
    for (const [key, invoice] of invoiceIn(sales)) {
      const label = invoiceLabel(sales, key);
      const paid = round(settled.get(label) ?? 0, USD_DECIMALS);
      const total = round(invoice.total, USD_DECIMALS);
      if (paid > total) {
        fail(
          `accounting: ${label} is over-settled (${paid} of ${invoice.total})`
        );
      }
      const fullyCredited =
        invoice.status === "Credit Note Issued" ||
        invoice.status === "Debit Note Issued";
      if ((invoice.status === "Paid" || fullyCredited) && paid !== total) {
        fail(
          `accounting: ${label} is ${invoice.status} but settled ${paid} of ${invoice.total}`
        );
      } else if (invoice.status === "Partially Paid") {
        if (paid <= 0 || paid >= total) {
          fail(
            `accounting: ${label} is Partially Paid but settled ${paid} of ${invoice.total}`
          );
        }
        if ((partialDates.get(label) ?? []).some((d) => d >= 0)) {
          fail(`accounting: ${label}'s partial payment must predate today`);
        }
      } else if (invoice.status !== "Paid" && !fullyCredited && paid !== 0) {
        fail(
          `accounting: ${label} is ${invoice.status} yet carries settlements (the view would re-derive its status)`
        );
      }
    }
  }

  // ── Period close checklist ─────────────────────────────────────────────────
  const seenTaskStatus = new Set<string>();
  const taskDefinitions = new Set<string>();
  for (const task of a.closeTasks) {
    const where = `accounting.closeTasks "${task.definition}"`;
    if (!CLOSE_TASK_DEFINITION_NAMES.has(task.definition))
      fail(`${where}: not a bootstrap periodCloseTaskDefinition`);
    if (taskDefinitions.has(task.definition))
      fail(`${where}: duplicate (unique per period + definition)`);
    taskDefinitions.add(task.definition);
    seenTaskStatus.add(task.status);
    if ((task.status === "Skipped") !== Boolean(task.skippedReason)) {
      fail(`${where}: skippedReason is required exactly when Skipped`);
    }
  }
  checkCoverage(fail, { periodCloseTaskStatus: seenTaskStatus });

  // ── Exchange-rate overrides ────────────────────────────────────────────────
  const eurPo = dataset.purchasing.purchaseOrders.find(
    (p) => p.source === "direct" && p.currencyCode === "EUR"
  );
  const overrideCodes = new Set<string>();
  for (const override of a.exchangeRateOverrides) {
    const where = `accounting.exchangeRateOverrides "${override.currencyCode}"`;
    if (overrideCodes.has(override.currencyCode))
      fail(`${where}: duplicate (unique per company + currency)`);
    overrideCodes.add(override.currencyCode);
    if (override.currencyCode === "USD")
      fail(`${where}: the base currency needs no rate`);
    if (!(override.rate > 0)) fail(`${where}: rate must be positive`);
    const poRate =
      eurPo?.source === "direct" && override.currencyCode === "EUR"
        ? eurPo.exchangeRate
        : undefined;
    // Same direction as the document snapshot (foreign units per base unit):
    // an inverted rate would be ~1/rate, far outside this band.
    if (poRate !== undefined && Math.abs(override.rate / poRate - 1) > 0.05) {
      fail(
        `${where}: rate ${override.rate} disagrees with the EUR order's ${poRate}`
      );
    }
    // Rates are units of the foreign currency per 1 USD, and a euro is worth
    // more than a dollar — so a EUR rate at or above 1 is the inverted
    // (USD-per-EUR) quote, which halves-and-doubles every converted amount.
    if (
      override.currencyCode === "EUR" &&
      !(override.rate > 0.5 && override.rate < 1)
    ) {
      fail(
        `${where}: rate ${override.rate} is not EUR per 1 USD (expected ~0.9 — is it inverted?)`
      );
    }
  }
  if (
    eurPo?.source === "direct" &&
    eurPo.exchangeRate !== undefined &&
    !(eurPo.exchangeRate > 0.5 && eurPo.exchangeRate < 1)
  ) {
    fail(
      `purchasing EUR order: exchangeRate ${eurPo.exchangeRate} is not EUR per 1 USD (expected ~0.9 — is it inverted?)`
    );
  }
  if (!overrideCodes.has("EUR")) {
    fail("accounting.exchangeRateOverrides: no EUR rate for the FX showcase");
  }

  // ── Fixed assets ───────────────────────────────────────────────────────────
  const seenAssetStatus = new Set<string>();
  for (const asset of a.fixedAssets) {
    const where = `accounting.fixedAssets "${asset.key}"`;
    seenAssetStatus.add(asset.status);
    const base = asset.acquisitionCost * (1 - asset.residualValuePercent / 100);
    if (asset.accumulatedDepreciation > base + 0.005) {
      fail(
        `${where}: accumulatedDepreciation exceeds the depreciable base ${base}`
      );
    }
    if (asset.depreciationCharge !== undefined && asset.status !== "Active") {
      fail(`${where}: only Active assets are in the depreciation run`);
    }
    if ((asset.status === "Disposed") !== (asset.disposal !== undefined)) {
      fail(`${where}: a disposal is required exactly when status is Disposed`);
    }
    if (asset.disposal) {
      const d = asset.disposal;
      if (
        asset.acquisitionOffset === null ||
        d.dateOffset < asset.acquisitionOffset ||
        d.dateOffset > 0 ||
        d.dateOffset < OPEN_PERIOD_MIN_OFFSET
      ) {
        fail(
          `${where}: disposal dateOffset ${d.dateOffset} must fall between acquisition and today`
        );
      }
      if (d.saleProceeds < 0) fail(`${where}: negative sale proceeds`);
    }
    const uop = asset.depreciationMethod === "Units of Production";
    if (uop !== (asset.assetLifetimeUsage !== undefined)) {
      fail(
        `${where}: assetLifetimeUsage is required exactly for Units of Production`
      );
    }
    if (asset.usageLogs && !uop) {
      fail(`${where}: usage logs belong to Units of Production assets`);
    }
    const months = new Set<number>();
    for (const log of asset.usageLogs ?? []) {
      if (log.monthsBack < 1 || months.has(log.monthsBack)) {
        fail(
          `${where}: usage log monthsBack ${log.monthsBack} must be ≥ 1 and unique`
        );
      }
      months.add(log.monthsBack);
      // Month anchor−m starts no earlier than −(30 + 31m).
      if (
        asset.depreciationStartOffset === null ||
        asset.depreciationStartOffset > -(30 + 31 * log.monthsBack)
      ) {
        fail(
          `${where}: usage log ${log.monthsBack} month(s) back predates depreciation start`
        );
      }
      if (log.unitsProduced <= 0) fail(`${where}: non-positive unitsProduced`);
    }
    if (uop && asset.assetLifetimeUsage) {
      // buildDepreciationLines: min(round(base / lifetime × units), remaining),
      // from the log whose periodEnd is the run's (monthsBack 1).
      const runLog = asset.usageLogs?.find((l) => l.monthsBack === 1);
      const expected = runLog
        ? Math.min(
            round(
              (base / asset.assetLifetimeUsage) * runLog.unitsProduced,
              USD_DECIMALS
            ),
            round(base - asset.accumulatedDepreciation, USD_DECIMALS)
          )
        : 0;
      const charge = round(asset.depreciationCharge ?? 0, USD_DECIMALS);
      if (charge !== expected) {
        fail(
          `${where}: depreciationCharge ${asset.depreciationCharge ?? 0} but the app computes ${expected}`
        );
      }
    }
  }
  checkCoverage(fail, { fixedAssetStatus: seenAssetStatus });
}

// The GL tier 09 writes for posted documents, re-derived from the literals
// with the same builders (helpers/posting-journals.ts): every journal must
// balance, every posting date must sit in an Open period, and the documents
// the invoicing screens need (aging buckets, Draft payments, one Opening
// Balance, costed stock) must exist.

// defaultReportRange: the current month plus the five before it — never shorter than this.
const SCRAP_REPORT_MIN_OFFSET = -150;

// Invoice statuses whose balance the open-balance RPCs still carry (Paid,
// Voided and fully credited ones net to zero; Draft is not posted).
const OPEN_INVOICE_STATUSES = new Set([
  "Submitted",
  "Open",
  "Overdue",
  "Partially Paid"
]);

function agingBucket(dueDateOffset: number | undefined): string {
  if (dueDateOffset === undefined || dueDateOffset >= 0) return "Current";
  const pastDue = -dueDateOffset;
  if (pastDue <= 30) return "1-30";
  if (pastDue <= 60) return "31-60";
  if (pastDue <= 90) return "61-90";
  return "90+";
}

export function postings(ctx: ValidationCtx): void {
  const { dataset, fail } = ctx;
  const a = dataset.accounting;
  const items = new Map(
    [
      ...dataset.items.buyParts,
      ...dataset.items.materials,
      ...dataset.items.consumables,
      ...dataset.items.tools,
      ...dataset.items.services,
      ...dataset.items.makeParts
    ].map((item) => [item.readableId, item])
  );
  const itemFacts = (readableId: string) => {
    const item = items.get(readableId);
    return {
      replenishmentSystem: item?.replenishment ?? "Buy",
      itemTrackingType: item?.trackingType ?? "Inventory",
      standardCost: item?.standardCost ?? 0
    };
  };
  const check = (where: string, build: () => PostingJournal) => {
    let journal: PostingJournal;
    try {
      journal = build();
    } catch (error) {
      fail(`${where}: ${(error as Error).message}`);
      return;
    }
    if (!isBalanced(journal)) {
      fail(
        `${where}: generated journal does not balance (net ${postingImbalance(journal)})`
      );
    }
  };
  const openPeriod = (where: string, offset: number) => {
    if (offset > 0 || offset < OPEN_PERIOD_MIN_OFFSET) {
      fail(
        `${where}: posting offset ${offset} outside [${OPEN_PERIOD_MIN_OFFSET}, 0] — its journal needs an Open period`
      );
    }
  };

  // ── Stocked items carry a unit cost (valuation, COGS fallback) ────────────
  for (const [readableId, item] of items) {
    if ((item.trackingType ?? "Inventory") === "Non-Inventory") continue;
    if (!((item.standardCost ?? 0) > 0)) {
      fail(
        `items "${readableId}": a stocked item needs standardCost > 0 (itemCost.unitCost)`
      );
    }
  }

  // ── Sales invoices + shipments ─────────────────────────────────────────────
  const openByCustomer = new Set<string>();
  const seenBuckets = new Set<string>();
  for (const opp of [
    ...dataset.sales.opportunities,
    ...dataset.sales.releasedOrders
  ]) {
    const invoice = opp.invoice;
    if (invoice && invoice.status !== "Draft") {
      const where = `sales invoice "${invoice.ref}"`;
      openPeriod(where, invoice.dateIssuedOffset);
      const journal = () =>
        salesInvoiceJournal({
          invoiceReadableId: invoice.ref,
          documentId: invoice.ref,
          lines: invoice.lines.map((line) => ({
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            salesOrderLineId: line.item
          }))
        });
      check(where, journal);
      if (invoice.status === "Voided") {
        check(`${where} void`, () => voidJournal(journal(), invoice.ref));
      }
      if (OPEN_INVOICE_STATUSES.has(invoice.status)) {
        openByCustomer.add(opp.customer);
        seenBuckets.add(agingBucket(invoice.dueDateOffset));
      }
    }
    const shipment = opp.shipment;
    if (shipment?.status === "Posted" && shipment.postedOffset !== undefined) {
      const where = `shipment "${shipment.ref}"`;
      openPeriod(where, shipment.postedOffset);
      check(where, () =>
        shipmentJournal({
          shipmentReadableId: shipment.ref,
          lines: shipment.lines
            .filter(
              (line) =>
                line.shippedQuantity > 0 &&
                itemFacts(line.item).itemTrackingType !== "Non-Inventory"
            )
            .map((line) => {
              const facts = itemFacts(line.item);
              return {
                quantity: line.shippedQuantity,
                cost: line.shippedQuantity * facts.standardCost,
                shipmentLineId: line.item,
                replenishmentSystem: facts.replenishmentSystem,
                itemTrackingType: facts.itemTrackingType
              };
            })
        })
      );
    }
  }
  checkCoverage(fail, { arAgingBucket: seenBuckets });

  // ── Scrap write-offs (tier 03 lots, journaled by tier 09) ─────────────────
  const scrapOffsets = dataset.inventory.onHandTracked.flatMap((tracked) =>
    tracked.entities.flatMap((entity) =>
      entity.scrap ? [entity.scrap.dateOffset] : []
    )
  );
  if (!scrapOffsets.some((offset) => offset >= SCRAP_REPORT_MIN_OFFSET)) {
    fail(
      `inventory.onHandTracked: no scrapped lot in the last ${-SCRAP_REPORT_MIN_OFFSET} days (Reports › Scrap opens on the trailing six months)`
    );
  }
  for (const tracked of dataset.inventory.onHandTracked) {
    for (const entity of tracked.entities) {
      if (!entity.scrap) continue;
      const where = `scrap of "${entity.readableId}"`;
      openPeriod(where, entity.scrap.dateOffset);
      const facts = itemFacts(tracked.item);
      check(where, () =>
        scrapJournal({
          description: `Scrap — ${entity.scrap!.comment}`,
          quantity: entity.quantity,
          cost: entity.quantity * facts.standardCost,
          replenishmentSystem: facts.replenishmentSystem,
          itemTrackingType: facts.itemTrackingType
        })
      );
    }
  }

  // ── Purchase invoices + receipts ───────────────────────────────────────────
  const openBySupplier = new Set<string>();
  for (const po of dataset.purchasing.purchaseOrders) {
    if (po.source !== "direct") continue;
    const receipt = po.receipt;
    const postedReceipt =
      receipt?.status === "Posted" && receipt.postedOffset !== undefined
        ? { ...receipt, postedOffset: receipt.postedOffset }
        : null;
    if (postedReceipt) {
      const where = `receipt "${postedReceipt.ref}"`;
      openPeriod(where, postedReceipt.postedOffset);
      check(where, () =>
        receiptJournal({
          receiptReadableId: postedReceipt.ref,
          lines: postedReceipt.lines
            .filter((line) => line.receivedQuantity > 0)
            .map((line) => ({
              quantity: line.receivedQuantity,
              cost: line.receivedQuantity * line.unitPrice,
              purchaseOrderLineId: line.item,
              ...itemFacts(line.item)
            }))
        })
      );
    }
    const invoice = po.invoice;
    if (!invoice || invoice.status === "Draft") continue;
    const where = `purchase invoice "${invoice.ref}"`;
    openPeriod(where, invoice.dateIssuedOffset);
    if (invoice.currencyCode !== "USD") {
      fail(
        `${where}: a posted purchase invoice must be base currency (USD) — its journal is base-only`
      );
    }
    const journal = () =>
      purchaseInvoiceJournal({
        invoiceReadableId: invoice.ref,
        lines: invoice.lines.map((line) => {
          const received =
            postedReceipt &&
            postedReceipt.postedOffset <= invoice.dateIssuedOffset
              ? postedReceipt.lines.find((r) => r.item === line.item)
              : undefined;
          return {
            quantity: line.quantity,
            unitCost: line.supplierUnitPrice,
            purchaseOrderLineId: line.item,
            receivedQuantity: received?.receivedQuantity ?? 0,
            receiptUnitCost: received?.unitPrice ?? null
          };
        })
      });
    check(where, journal);
    if (invoice.status === "Voided") {
      check(`${where} void`, () => voidJournal(journal(), invoice.ref));
    }
    if (OPEN_INVOICE_STATUSES.has(invoice.status))
      openBySupplier.add(po.supplier);
  }

  // ── Memos: tier 09's (discount reason accounts) and posted RMA credits ────
  for (const memo of a.memos) {
    check(`accounting.memos "${memo.key}"`, () =>
      memoJournal({
        memoReadableId: memo.key,
        documentId: memo.key,
        direction: memo.direction,
        isAR: memo.direction === "Credit",
        amount: memo.amount,
        // salesDiscountAccount / supplierPaymentDiscountAccount
        reasonAccountClass: memo.direction === "Credit" ? "Revenue" : "Expense"
      })
    );
  }
  for (const rma of dataset.sales.salesReturns) {
    const credit = rma.credit;
    if (credit?.status !== "Posted") continue;
    const where = `sales.salesReturns "${rma.key}" credit`;
    openPeriod(where, credit.dateOffset);
    const amount = credit.lines.reduce(
      (sum, line) =>
        sum + line.quantity * (rma.lines[line.line - 1]?.unitPrice ?? 0),
      0
    );
    check(where, () =>
      memoJournal({
        memoReadableId: rma.key,
        documentId: rma.key,
        direction: "Credit",
        isAR: true,
        amount,
        // salesReturnsAccount
        reasonAccountClass: "Revenue"
      })
    );
  }

  // ── Payments: Posted journals; Draft ones wait on an open invoice ─────────
  const seenDraftTypes = new Set<string>();
  for (const payment of a.payments) {
    const where = `accounting.payments "${payment.key}"`;
    const sales = payment.type === "Receipt";
    if (payment.status === "Draft") {
      seenDraftTypes.add(payment.type);
      const party = sales ? payment.customer : payment.supplier;
      if (payment.applies.length > 0 || payment.credits?.length) {
        fail(`${where}: a Draft payment is unapplied (no applies, no credits)`);
      }
      if (!(payment.amount > 0))
        fail(`${where}: a Draft payment needs an amount`);
      if (
        payment.dateOffset > 0 ||
        payment.dateOffset < OPEN_PERIOD_MIN_OFFSET
      ) {
        fail(
          `${where}: dateOffset ${payment.dateOffset} outside [${OPEN_PERIOD_MIN_OFFSET}, 0]`
        );
      }
      if (!party || !(sales ? openByCustomer : openBySupplier).has(party)) {
        fail(
          `${where}: "${party}" has no open posted ${sales ? "sales" : "purchase"} invoice for the apply table to list`
        );
      }
      continue;
    }
    check(where, () =>
      paymentJournal({
        paymentReadableId: payment.key,
        documentId: payment.key,
        type: payment.type,
        amount: payment.amount,
        applies: payment.applies.map((apply) => ({
          targetId: apply.invoiceKey,
          amount: apply.amount
        }))
      })
    );
  }
  checkCoverage(fail, { draftPaymentType: seenDraftTypes });

  // ── Opening balance: exactly one Posted entry (a unique index) ────────────
  const openingBalances = a.journalEntries.filter(
    (entry) => entry.sourceType === "Opening Balance"
  );
  if (openingBalances.length !== 1) {
    fail(
      `accounting.journalEntries: expected exactly one "Opening Balance" entry, found ${openingBalances.length}`
    );
  }
  for (const entry of openingBalances) {
    if (entry.status !== "Posted") {
      fail(
        `accounting.journalEntries "${entry.ref}": an Opening Balance entry is Posted`
      );
    }
  }

  // ── AR / AP billing addresses ──────────────────────────────────────────────
  for (const [side, address] of Object.entries(a.billingAddresses)) {
    const where = `accounting.billingAddresses.${side}`;
    if (!address.addressLine1 || !address.city || !address.postalCode) {
      fail(`${where}: street, city and postal code are required`);
    }
    if (!/^[A-Z]{2}$/.test(address.countryCode)) {
      fail(
        `${where}: countryCode "${address.countryCode}" is not ISO-3166 alpha-2`
      );
    }
    if (!address.email.endsWith(".example")) {
      fail(
        `${where}: email "${address.email}" must use a reserved .example domain`
      );
    }
  }
}

// Ops: trainings, the time clock, suggestions and notes, and the seeded
// workflow run history.

const MIN_TIMECARDS = 5;

export function workforce(ctx: ValidationCtx): void {
  const { dataset, fail } = ctx;
  const ops = dataset.ops;
  // ── Trainings ──────────────────────────────────────────────────────────────
  const trainingNames = new Set<string>();
  const trainingStatuses = new Set<string>();
  let fullyCovered = false;
  let completedAssignments = 0;
  let pendingAssignments = 0;
  for (const training of ops.trainings) {
    const where = `ops.trainings "${training.name}"`;
    if (trainingNames.has(training.name)) fail(`${where}: duplicate name`);
    trainingNames.add(training.name);
    trainingStatuses.add(training.status);
    if (training.questions.length === 0) fail(`${where}: no questions`);

    const types = new Set<string>();
    training.questions.forEach((q, index) => {
      const qWhere = `${where} question ${index + 1}`;
      types.add(q.type);
      switch (q.type) {
        case "MultipleChoice":
          if (!q.options.includes(q.correct)) {
            fail(`${qWhere}: correct answer "${q.correct}" is not an option`);
          }
          break;
        case "MultipleAnswers":
          if (q.correct.length === 0) fail(`${qWhere}: no correct answers`);
          for (const answer of q.correct) {
            if (!q.options.includes(answer)) {
              fail(`${qWhere}: correct answer "${answer}" is not an option`);
            }
          }
          break;
        case "MatchingPairs":
          if (q.pairs.length < 2) fail(`${qWhere}: needs at least 2 pairs`);
          break;
        case "Numerical":
          if (q.tolerance !== undefined && q.tolerance < 0) {
            fail(`${qWhere}: tolerance must not be negative`);
          }
          break;
        case "TrueFalse":
          break;
      }
      if (
        (q.type === "MultipleChoice" || q.type === "MultipleAnswers") &&
        new Set(q.options).size !== q.options.length
      ) {
        fail(`${qWhere}: duplicate options`);
      }
    });
    if (
      training.status === "Active" &&
      TRAINING_QUESTION_TYPES.every((t) => types.has(t))
    ) {
      fullyCovered = true;
    }

    if (training.assignment) {
      if (training.status !== "Active") {
        fail(
          `${where}: only Active trainings are assigned (the status RPC ignores the rest)`
        );
      }
      const { completedOffset } = training.assignment;
      if (completedOffset === undefined) {
        pendingAssignments++;
      } else {
        completedAssignments++;
        if (training.frequency !== "Once") {
          fail(
            `${where}: a completion needs a "Once" training — a recurring one only counts in the current period`
          );
        }
        if (completedOffset >= 0) {
          fail(`${where}: completedOffset must be in the past`);
        }
      }
    }
  }
  checkCoverage(fail, { trainingStatus: trainingStatuses });
  if (!fullyCovered) {
    fail(
      `ops matrix: no Active training covers every trainingQuestionType (${TRAINING_QUESTION_TYPES.join(", ")})`
    );
  }
  if (completedAssignments === 0 || pendingAssignments === 0) {
    fail(
      "ops matrix: training assignments must include at least one Completed and one Pending"
    );
  }

  // ── Time clock: closed entries over the past week, never overlapping ──────
  if (ops.timecards.length < MIN_TIMECARDS) {
    fail(
      `ops.timecards: ${ops.timecards.length} entries — every dataset needs at least ${MIN_TIMECARDS}`
    );
  }
  const spans: { where: string; start: number; end: number }[] = [];
  ops.timecards.forEach((card, index) => {
    const where = `ops.timecards[${index}]`;
    if (card.dayOffset > -1 || card.dayOffset < -7) {
      fail(
        `${where}: dayOffset ${card.dayOffset} is outside the past week (-7…-1)`
      );
    }
    const clockIn = secondsOfDay(card.clockIn);
    const clockOut = secondsOfDay(card.clockOut);
    if (clockIn === null || clockOut === null) {
      fail(`${where}: clockIn/clockOut must be UTC "HH:MM:SS"`);
      return;
    }
    if (clockOut <= clockIn) fail(`${where}: clockOut must be after clockIn`);
    const day = card.dayOffset * 86_400;
    spans.push({ where, start: day + clockIn, end: day + clockOut });
  });
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i]!.start < spans[i - 1]!.end) {
      fail(`${spans[i]!.where}: overlaps ${spans[i - 1]!.where}`);
    }
  }

  // ── Suggestions and person notes ───────────────────────────────────────────
  if (ops.suggestions.length < 2) {
    fail("ops.suggestions: every dataset needs at least 2");
  }
  ops.suggestions.forEach((suggestion, index) => {
    const where = `ops.suggestions[${index}]`;
    if (suggestion.suggestion.trim() === "") fail(`${where}: empty text`);
    if (!suggestion.path.startsWith("/x/")) {
      fail(`${where}: path "${suggestion.path}" is not an ERP page (/x/…)`);
    }
  });
  if (ops.notes.length < 2) fail("ops.notes: every dataset needs at least 2");
  ops.notes.forEach((note, index) => {
    if (note.text.trim() === "") fail(`ops.notes[${index}]: empty text`);
  });
}

export function workflowRuns(ctx: ValidationCtx): void {
  const { dataset, ix, fail } = ctx;
  // ── Workflow run history ───────────────────────────────────────────────────
  // The definitions are a factory over ids the seed mints; placeholders are
  // enough to read their names, node ids and trigger events.
  const published = new Map(
    dataset.workflows
      .build({ ownerId: "validate:owner", issueTypeId: "validate:issueType" })
      .filter((workflow) => workflow.published)
      .map((workflow) => [workflow.name, workflow] as const)
  );

  const runStatuses = new Set<string>();
  dataset.workflows.runs.forEach((run, index) => {
    const where = `workflows.runs[${index}] (${run.status})`;
    runStatuses.add(run.status);
    checkInstant(fail, where, run.at);
    if (run.at.offset >= 0) fail(`${where}: at must be in the past`);

    const workflow = published.get(run.workflow);
    if (!workflow) {
      fail(`${where}: "${run.workflow}" is not a published seed workflow`);
      return;
    }
    const trigger = workflow.nodes.find((node) => node.type === "trigger");
    const event = (trigger?.data.events as string[] | undefined)?.[0];
    if (!trigger || !event) {
      fail(`${where}: workflow "${run.workflow}" has no trigger event`);
    }
    if (event?.startsWith("salesOrder.")) {
      const orderDate = ix.orderDateByRef.get(run.triggerRef);
      if (orderDate === undefined) {
        fail(`${where}: triggerRef "${run.triggerRef}" is not a sales order`);
      } else if (run.at.offset < orderDate) {
        fail(
          `${where}: fired at offset ${run.at.offset}, before its order was placed (${orderDate})`
        );
      }
    } else if (
      !ix.documentRefs.has(run.triggerRef, ix.documentRefs.seenBy.workflowRuns)
    ) {
      fail(`${where}: unknown triggerRef "${run.triggerRef}"`);
    }

    const actionNodeIds = new Set(
      workflow.nodes
        .filter((node) => node.type !== "trigger")
        .map((node) => node.id)
    );
    for (const step of run.steps) {
      if (!actionNodeIds.has(step.nodeId)) {
        fail(
          `${where}: step nodeId "${step.nodeId}" is not an action node of "${run.workflow}"`
        );
      }
      if ((step.status === "Failed") !== (step.error !== undefined)) {
        fail(
          `${where} step "${step.nodeId}": an error is required exactly when the step Failed`
        );
      }
    }
    const skipped = run.status === "Skipped";
    if (skipped !== (run.steps.length === 0)) {
      fail(
        `${where}: a Skipped run settles at load with no steps; every other run walks at least one`
      );
    }
    if (skipped !== (run.statusReason !== undefined)) {
      fail(
        `${where}: statusReason is required exactly when the run is Skipped`
      );
    }
    const anyFailed = run.steps.some((step) => step.status === "Failed");
    if (run.status === "Failed" && !anyFailed) {
      fail(`${where}: a Failed run needs a Failed step`);
    }
    if (run.status === "Succeeded" && anyFailed) {
      fail(`${where}: a Succeeded run cannot contain a Failed step`);
    }
  });
  checkCoverage(fail, { workflowRunStatus: runStatuses });
}

// Maintenance: schedules, dispatches (and the shapes its KPIs need),
// replacement parts, and the dispatch matrix.

const MIN_MAINTENANCE_SCHEDULES = 3;
/** Completed dispatches the maintenance KPIs' previous-period window picks up. */
const BACKDATED_COMPLETION_WINDOW = { min: -55, max: -35 } as const;
const MIN_BACKDATED_COMPLETED_DISPATCHES = 2;
/** A Down dispatch's planned end bounds the scheduler's outage (open-ended = to the horizon). */
const MAX_DOWN_OUTAGE_DAYS = 2;
const MIN_REPLACEMENT_PARTS = 3;
const OPEN_DISPATCH_STATUSES = new Set(["Open", "Assigned", "In Progress"]);

/** A comparable ordinal for an InstantSpec (malformed times sort as midnight). */
function instantOrdinal(instant: InstantSpec): number {
  return instant.offset * 86_400 + (secondsOfDay(instant.time) ?? 0);
}

export function sparePartDrains(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const { isTracked } = ix;
  // ── Ops spare-part drains ──────────────────────────────────────────────────
  // A Completed dispatch issues its spare parts from a shelf (inventory-ledger.ts).
  for (const dispatch of dataset.ops.maintenanceDispatches) {
    for (const part of dispatch.spareParts ?? []) {
      const where = `ops.maintenanceDispatches "${dispatch.key}" spare part "${part.item}"`;
      need("item", where, part.item);
      need("shelf", where, part.shelf);
      if (isTracked(part.item)) {
        fail(
          `${where}: tracked items need per-entity consumption the seed does not model`
        );
      }
      if (part.quantity <= 0) fail(`${where}: quantity must be positive`);
    }
  }
}

export function maintenance(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const { jobByKey, standardCost } = ix;
  const { rootOpsOf } = ix.bom;
  const activeWorkCenters = ix.floor.active;
  const ops = dataset.ops;
  // Closed production events per day, by work center — what the MTBF KPI
  // divides by that day's reactive failures.
  const eventWorkCentersByDay = new Map<number, Set<string>>();
  const eventsJobSpec = jobByKey.get(dataset.production.eventsJobKey);
  if (eventsJobSpec) {
    rootOpsOf(eventsJobSpec.item)
      .slice(0, 2)
      .forEach((op, index) => {
        const events =
          dataset.production.shifts[index] ??
          dataset.production.shifts[0] ??
          [];
        for (const event of events) {
          if (!op.workCenter) continue;
          const day = eventWorkCentersByDay.get(event.startOffset) ?? new Set();
          day.add(op.workCenter);
          eventWorkCentersByDay.set(event.startOffset, day);
        }
      });
  }
  const hqWorkCenter = dataset.foundation.hqWorkCenter.name;

  // ── Maintenance schedules ──────────────────────────────────────────────────
  if (ops.maintenanceSchedules.length < MIN_MAINTENANCE_SCHEDULES) {
    fail(
      `ops.maintenanceSchedules: ${ops.maintenanceSchedules.length} schedules — every dataset needs at least ${MIN_MAINTENANCE_SCHEDULES}`
    );
  }
  const scheduleWorkCenter = new Map<string, string>();
  const frequencies = new Set<string>();
  for (const schedule of ops.maintenanceSchedules) {
    const where = `ops.maintenanceSchedules "${schedule.key}"`;
    if (scheduleWorkCenter.has(schedule.key)) {
      fail(`${where}: duplicate schedule key`);
    }
    scheduleWorkCenter.set(schedule.key, schedule.workCenter);
    frequencies.add(schedule.frequency);
    need("maintainedWorkCenter", where, schedule.workCenter);
    if (schedule.estimatedDuration <= 0) {
      fail(`${where}: estimatedDuration must be positive`);
    }
    if (schedule.nextDueOffset < 0) {
      fail(`${where}: nextDueOffset ${schedule.nextDueOffset} is in the past`);
    }
    if (schedule.weekends !== undefined && schedule.frequency !== "Daily") {
      fail(`${where}: weekends applies to Daily schedules only`);
    }
    for (const part of schedule.spareParts ?? []) {
      need("item", `${where} spare part`, part.item);
      if (part.quantity <= 0) {
        fail(`${where} spare part "${part.item}": quantity must be positive`);
      }
    }
  }
  if (ops.maintenanceSchedules.length > 0 && frequencies.size < 3) {
    fail(
      `ops.maintenanceSchedules: only ${frequencies.size} distinct frequencies — spread them over at least 3`
    );
  }

  // ── Maintenance dispatches ─────────────────────────────────────────────────
  const seenDispatch = {
    status: new Set<string>(),
    severity: new Set<string>(),
    source: new Set<string>(),
    oeeImpact: new Set<string>()
  };
  const dispatchKeys = new Set<string>();
  for (const dispatch of ops.maintenanceDispatches) {
    const where = `ops.maintenanceDispatches "${dispatch.key}"`;
    if (dispatchKeys.has(dispatch.key))
      fail(`${where}: duplicate dispatch key`);
    dispatchKeys.add(dispatch.key);
    seenDispatch.status.add(dispatch.status);
    seenDispatch.severity.add(dispatch.severity);
    seenDispatch.source.add(dispatch.source);
    seenDispatch.oeeImpact.add(dispatch.oeeImpact);

    need("maintainedWorkCenter", where, dispatch.workCenter);
    if (
      (dispatch.source === "Scheduled") !==
      (dispatch.schedule !== undefined)
    ) {
      fail(`${where}: a schedule is required exactly when source is Scheduled`);
    }
    if (dispatch.schedule !== undefined) {
      const scheduleWc = scheduleWorkCenter.get(dispatch.schedule);
      if (scheduleWc === undefined) {
        fail(`${where}: unknown maintenance schedule "${dispatch.schedule}"`);
      } else if (scheduleWc !== dispatch.workCenter) {
        fail(
          `${where}: schedule "${dispatch.schedule}" is on "${scheduleWc}", not "${dispatch.workCenter}"`
        );
      }
    }
    if (
      (dispatch.source === "Non-Conformance") !==
      (dispatch.nonConformance !== undefined)
    ) {
      fail(
        `${where}: a nonConformance is required exactly when source is Non-Conformance`
      );
    }
    if (
      dispatch.nonConformance !== undefined &&
      !ix.ncrRefs.has(dispatch.nonConformance)
    ) {
      fail(`${where}: unknown NCR ref "${dispatch.nonConformance}"`);
    }
    for (const mode of [
      dispatch.suspectedFailureMode,
      dispatch.actualFailureMode
    ]) {
      if (mode !== undefined && !FAILURE_MODE_NAMES.has(mode)) {
        fail(`${where}: "${mode}" is not a bootstrap maintenanceFailureMode`);
      }
    }
    const started =
      dispatch.status === "In Progress" || dispatch.status === "Completed";
    const completed = dispatch.status === "Completed";
    if (started !== (dispatch.actualStart !== undefined)) {
      fail(
        `${where}: actualStart is required exactly when status is In Progress or Completed`
      );
    }
    if (completed !== (dispatch.actualEnd !== undefined)) {
      fail(`${where}: actualEnd is required exactly when status is Completed`);
    }
    if (!completed && dispatch.actualFailureMode !== undefined) {
      fail(
        `${where}: actualFailureMode is recorded on Completed dispatches only`
      );
    }
    if (!completed && (dispatch.spareParts ?? []).length > 0) {
      fail(`${where}: spare parts are issued on Completed dispatches only`);
    }

    for (const [label, instant] of [
      ["created", dispatch.created],
      ["plannedStart", dispatch.plannedStart],
      ["plannedEnd", dispatch.plannedEnd],
      ["actualStart", dispatch.actualStart],
      ["actualEnd", dispatch.actualEnd]
    ] as const) {
      if (instant) checkInstant(fail, `${where} ${label}`, instant);
    }
    if (dispatch.created.offset >= 0) {
      fail(`${where}: created must be in the past`);
    }
    if (
      instantOrdinal(dispatch.plannedEnd) <=
      instantOrdinal(dispatch.plannedStart)
    ) {
      fail(`${where}: plannedEnd must be after plannedStart`);
    }
    if (dispatch.actualStart) {
      if (dispatch.actualStart.offset >= 0) {
        fail(`${where}: actualStart must be in the past`);
      }
      if (
        instantOrdinal(dispatch.actualStart) < instantOrdinal(dispatch.created)
      ) {
        fail(`${where}: actualStart before the request was created`);
      }
      if (
        dispatch.actualEnd &&
        instantOrdinal(dispatch.actualEnd) <=
          instantOrdinal(dispatch.actualStart)
      ) {
        fail(`${where}: actualEnd must be after actualStart`);
      }
    }
  }
  // ── Dispatch shapes the maintenance screens and KPIs need ─────────────────
  const dispatches = ops.maintenanceDispatches;
  const scheduleByKey = new Map(
    ops.maintenanceSchedules.map((schedule) => [schedule.key, schedule])
  );
  for (const dispatch of dispatches) {
    const where = `ops.maintenanceDispatches "${dispatch.key}"`;
    for (const part of dispatch.spareParts ?? []) {
      if ((standardCost.get(part.item) ?? 0) <= 0) {
        fail(
          `${where} spare part "${part.item}": no standardCost, so the dispatch item's unitCost (spare-part cost KPI) is 0`
        );
      }
    }
    if (
      dispatch.workCenter === hqWorkCenter &&
      (dispatch.spareParts ?? []).length > 0
    ) {
      fail(`${where}: spare parts are drawn from plant shelves, not at HQ`);
    }
    if (dispatch.oeeImpact === "Down" && dispatch.status === "In Progress") {
      if (!dispatch.takesWorkCenterOffline) {
        fail(
          `${where}: an In Progress Down dispatch takes the work center offline`
        );
      }
      if (
        dispatch.plannedEnd.offset < 0 ||
        dispatch.plannedEnd.offset > MAX_DOWN_OUTAGE_DAYS
      ) {
        fail(
          `${where}: plannedEnd offset ${dispatch.plannedEnd.offset} must be 0…${MAX_DOWN_OUTAGE_DAYS} — it bounds the scheduler's outage`
        );
      }
      if (activeWorkCenters.has(dispatch.workCenter)) {
        fail(
          `${where}: "${dispatch.workCenter}" is down but has an operation In Progress`
        );
      }
    }
  }
  if (
    !dispatches.some(
      (d) =>
        d.status === "In Progress" &&
        d.oeeImpact === "Down" &&
        d.takesWorkCenterOffline === true
    )
  ) {
    fail(
      "ops.maintenanceDispatches: no In Progress dispatch with its work center Down (blocked display)"
    );
  }
  if (
    !dispatches.some(
      (d) =>
        d.source === "Reactive" &&
        eventWorkCentersByDay.get(d.created.offset)?.has(d.workCenter) === true
    )
  ) {
    fail(
      "ops.maintenanceDispatches: no Reactive dispatch created on a production-event day at that work center (MTBF KPI)"
    );
  }
  const backdated = dispatches.filter(
    (d) =>
      d.status === "Completed" &&
      d.actualEnd !== undefined &&
      d.actualEnd.offset >= BACKDATED_COMPLETION_WINDOW.min &&
      d.actualEnd.offset <= BACKDATED_COMPLETION_WINDOW.max
  );
  if (backdated.length < MIN_BACKDATED_COMPLETED_DISPATCHES) {
    fail(
      `ops.maintenanceDispatches: ${backdated.length} Completed dispatches finished ${BACKDATED_COMPLETION_WINDOW.min}…${BACKDATED_COMPLETION_WINDOW.max}, need ≥ ${MIN_BACKDATED_COMPLETED_DISPATCHES} (KPI trends)`
    );
  }
  // Due today from a Daily schedule that runs weekends too, so it holds on
  // whatever weekday the anchor falls; the generator has moved nextDue past it.
  const dueToday = dispatches.find(
    (d) =>
      d.source === "Scheduled" &&
      (d.status === "Open" || d.status === "Assigned") &&
      d.plannedStart.offset === 0
  );
  if (!dueToday) {
    fail(
      "ops.maintenanceDispatches: no open Scheduled dispatch planned for today (Open Scheduled tile, MES Today tab)"
    );
  } else {
    const schedule = scheduleByKey.get(dueToday.schedule ?? "");
    if (
      schedule &&
      (schedule.frequency !== "Daily" ||
        schedule.weekends === false ||
        schedule.nextDueOffset !== 1)
    ) {
      fail(
        `ops.maintenanceDispatches "${dueToday.key}": due today from "${schedule.key}", which must be Daily with weekends and next due tomorrow`
      );
    }
  }
  if (!dispatches.some((d) => d.workCenter === hqWorkCenter)) {
    fail(
      `ops.maintenanceDispatches: none at the HQ work center "${hqWorkCenter}" (the ERP list opens on HQ)`
    );
  }
  if (!ops.maintenanceSchedules.some((s) => s.workCenter === hqWorkCenter)) {
    fail(
      `ops.maintenanceSchedules: none at the HQ work center "${hqWorkCenter}" (the ERP list opens on HQ)`
    );
  }

  // ── Replacement parts ──────────────────────────────────────────────────────
  const partKeys = new Set<string>();
  for (const part of ops.replacementParts) {
    const where = `ops.replacementParts "${part.workCenter}" / "${part.item}"`;
    const key = `${part.workCenter}|${part.item}`;
    if (partKeys.has(key)) fail(`${where}: duplicate`);
    partKeys.add(key);
    need("maintainedWorkCenter", where, part.workCenter);
    need("item", where, part.item);
    if (!Number.isInteger(part.quantity) || part.quantity <= 0) {
      fail(`${where}: quantity ${part.quantity} must be a positive integer`);
    }
  }
  const partWorkCenters = new Set(
    ops.replacementParts.map((part) => part.workCenter)
  );
  if (
    ops.replacementParts.length < MIN_REPLACEMENT_PARTS ||
    partWorkCenters.size < 2
  ) {
    fail(
      `ops.replacementParts: ${ops.replacementParts.length} parts on ${partWorkCenters.size} work centers, need ≥ ${MIN_REPLACEMENT_PARTS} on ≥ 2`
    );
  }
  if (
    !dispatches.some(
      (d) =>
        OPEN_DISPATCH_STATUSES.has(d.status) &&
        partWorkCenters.has(d.workCenter)
    )
  ) {
    fail(
      "ops.replacementParts: no open dispatch's work center lists replacement parts (MES dispatch page)"
    );
  }

  checkCoverage(fail, {
    dispatchStatus: seenDispatch.status,
    dispatchSeverity: seenDispatch.severity,
    dispatchSource: seenDispatch.source,
    dispatchOeeImpact: seenDispatch.oeeImpact
  });
}

// The applying user as a floor person: one open clock-in that predates every
// running timer, a week of manning-board stations, and an absence next week.

/**
 * The applying user's manning-board days around today. Today itself is
 * excluded: a today row pre-filters the MES schedule to one work center.
 */
const PEOPLE_ASSIGNMENT_WINDOW = { min: -2, max: 4 } as const;
const MIN_PEOPLE_ASSIGNMENT_DAYS = 5;
const MIN_PEOPLE_ASSIGNMENT_WORK_CENTERS = 3;
/** "Next week": an absence the board shows once the user pages forward. */
const PEOPLE_ABSENCE_WINDOW = { min: 7, max: 13 } as const;

export function peopleAndTime(ctx: ValidationCtx): void {
  const { dataset, fail, need } = ctx;
  const ops = dataset.ops;

  const clockIn = secondsOfDay(ops.openTimecard.clockIn);
  if (clockIn === null) {
    fail(
      `ops.openTimecard: clockIn "${ops.openTimecard.clockIn}" is not a UTC "HH:MM:SS"`
    );
  } else {
    const runningStarts = [
      OPEN_EVENT_TIME,
      dataset.production.batch.running.startTimeOfDay
    ];
    for (const job of dataset.production.jobs) {
      for (const override of job.operationOverrides ?? []) {
        if (override.running) {
          runningStarts.push(override.running.startTimeOfDay);
        }
      }
    }
    const earliest = Math.min(
      ...runningStarts.map((time) => secondsOfDay(time) ?? 0)
    );
    if (clockIn > earliest) {
      fail(
        `ops.openTimecard: clocked in at ${ops.openTimecard.clockIn}, after a production timer already running today`
      );
    }
  }

  const assignmentDays = new Set<number>();
  const assignedWorkCenters = new Set<string>();
  const seenAssignments = new Set<string>();
  ops.peopleAssignments.forEach((spec, index) => {
    const where = `ops.peopleAssignments[${index}]`;
    need("workCenter", where, spec.workCenter);
    need("shift", where, spec.shift);
    if (spec.dayOffset === 0) {
      fail(
        `${where}: an assignment today pre-filters the MES schedule to one work center`
      );
    } else if (
      spec.dayOffset < PEOPLE_ASSIGNMENT_WINDOW.min ||
      spec.dayOffset > PEOPLE_ASSIGNMENT_WINDOW.max
    ) {
      fail(
        `${where}: dayOffset ${spec.dayOffset} is outside the current-week window (${PEOPLE_ASSIGNMENT_WINDOW.min}…${PEOPLE_ASSIGNMENT_WINDOW.max})`
      );
    }
    // peopleAssignment is UNIQUE (companyId, employeeId, date, shiftId).
    const key = `${spec.dayOffset}|${spec.shift}`;
    if (seenAssignments.has(key)) {
      fail(`${where}: a second assignment on the same day and shift`);
    }
    seenAssignments.add(key);
    if (spec.overtimeHours !== undefined && !(spec.overtimeHours >= 0)) {
      fail(`${where}: overtimeHours must be ≥ 0`);
    }
    assignmentDays.add(spec.dayOffset);
    assignedWorkCenters.add(spec.workCenter);
  });
  if (assignmentDays.size < MIN_PEOPLE_ASSIGNMENT_DAYS) {
    fail(
      `ops.peopleAssignments: ${assignmentDays.size} days — every dataset needs at least ${MIN_PEOPLE_ASSIGNMENT_DAYS}`
    );
  }
  if (assignedWorkCenters.size < MIN_PEOPLE_ASSIGNMENT_WORK_CENTERS) {
    fail(
      `ops.peopleAssignments: ${assignedWorkCenters.size} work centers — every dataset needs at least ${MIN_PEOPLE_ASSIGNMENT_WORK_CENTERS}`
    );
  }

  if (ops.peopleAbsences.length === 0) {
    fail("ops.peopleAbsences: must not be empty");
  }
  const seenAbsences = new Set<string>();
  ops.peopleAbsences.forEach((spec, index) => {
    const where = `ops.peopleAbsences[${index}]`;
    if (spec.shift !== undefined) need("shift", where, spec.shift);
    if (
      spec.dayOffset < PEOPLE_ABSENCE_WINDOW.min ||
      spec.dayOffset > PEOPLE_ABSENCE_WINDOW.max
    ) {
      fail(
        `${where}: dayOffset ${spec.dayOffset} is outside next week (${PEOPLE_ABSENCE_WINDOW.min}…${PEOPLE_ABSENCE_WINDOW.max})`
      );
    }
    if (assignmentDays.has(spec.dayOffset)) {
      fail(`${where}: absent on a day the user is assigned to a station`);
    }
    const key = `${spec.dayOffset}|${spec.shift ?? ""}`;
    if (seenAbsences.has(key)) {
      fail(`${where}: a second absence on the same day and shift`);
    }
    seenAbsences.add(key);
    if (!spec.note.trim()) fail(`${where}: empty note`);
  });
}

// Settings & people surfaces: attributes, custom fields, serial sequences,
// print jobs.

/** The cleanup job deletes completed print jobs after 30 days. */
const PRINT_JOB_WINDOW = { min: -20, max: 0 } as const;
const PRINTABLE_JOB_STATUSES = new Set([
  "Ready",
  "In Progress",
  "Paused",
  "Completed",
  "Closed"
]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every string literal in the dataset (workflow builders are functions — skipped). */
function collectStrings(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    into.add(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, into);
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectStrings(entry, into);
  }
}

export function settingsSurfaces(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const { trackingByItem } = ix;
  const ops = dataset.ops;

  // People › Attributes
  const attributeTypes = new Set<string>();
  const categoryNames = new Set<string>();
  ops.userAttributeCategories.forEach((category, index) => {
    const where = `ops.userAttributeCategories[${index}]`;
    if (categoryNames.has(category.name)) {
      fail(`${where}: duplicate category "${category.name}"`);
    }
    categoryNames.add(category.name);
    if (!category.emoji.trim()) fail(`${where}: empty emoji`);
    if (category.attributes.length === 0) fail(`${where}: no attributes`);
    const names = new Set<string>();
    category.attributes.forEach((attribute, attributeIndex) => {
      const at = `${where}.attributes[${attributeIndex}]`;
      if (names.has(attribute.name)) {
        fail(`${at}: duplicate attribute "${attribute.name}"`);
      }
      names.add(attribute.name);
      attributeTypes.add(attribute.dataType);
      if (attribute.dataType === "List") {
        const options = new Set(attribute.listOptions);
        if (
          attribute.listOptions.length === 0 ||
          options.size !== attribute.listOptions.length ||
          attribute.listOptions.some((option) => !option.trim())
        ) {
          fail(`${at}: listOptions must be non-empty, distinct and non-blank`);
        }
        if (!options.has(attribute.value)) {
          fail(
            `${at}: value "${attribute.value}" is not one of its listOptions`
          );
        }
      } else if (attribute.dataType === "Text" && !attribute.value.trim()) {
        fail(`${at}: empty Text value`);
      }
    });
  });
  checkCoverage(fail, { userAttributeType: attributeTypes });

  // Settings › Custom Fields
  const fieldKeys = new Set<string>();
  ops.customFields.forEach((field, index) => {
    const where = `ops.customFields[${index}]`;
    const key = `${field.table}|${field.name}`;
    if (fieldKeys.has(key)) {
      fail(`${where}: duplicate field "${field.name}" on "${field.table}"`);
    }
    fieldKeys.add(key);
    const isList = field.dataType === "List";
    if (isList !== (field.listOptions !== undefined)) {
      fail(`${where}: listOptions are required on a List field and only there`);
    } else if (
      isList &&
      (field.listOptions!.length === 0 ||
        field.listOptions!.some((option) => !option.trim()))
    ) {
      fail(`${where}: listOptions must be non-empty and non-blank`);
    }
  });
  checkCoverage(fail, {
    customField: new Set(
      ops.customFields.map((field) => `${field.table}|${field.dataType}`)
    )
  });

  // Settings › Serial Numbers — one sequence per Serial-tracked item, whose
  // counter is past every serial the dataset already minted in its pattern.
  const datasetStrings = new Set<string>();
  collectStrings(dataset, datasetStrings);
  const sequenced = new Set<string>();
  ops.serialSequences.forEach((spec, index) => {
    const where = `ops.serialSequences[${index}]`;
    need("item", where, spec.item);
    if (sequenced.has(spec.item)) {
      fail(`${where}: a second sequence for "${spec.item}"`);
    }
    sequenced.add(spec.item);
    const tracking = trackingByItem.get(spec.item);
    if (tracking !== undefined && tracking !== "Serial") {
      fail(`${where}: "${spec.item}" is ${tracking}-tracked, not Serial`);
    }
    if (!Number.isInteger(spec.size) || spec.size < 1) {
      fail(`${where}: size must be an integer ≥ 1`);
    }
    if (!Number.isInteger(spec.next) || spec.next < 0) {
      fail(`${where}: next must be an integer ≥ 0`);
    }
    const pattern = new RegExp(
      `^${escapeRegExp(spec.prefix)}(\\d{${spec.size}})${escapeRegExp(spec.suffix ?? "")}$`
    );
    for (const text of datasetStrings) {
      const match = pattern.exec(text);
      if (match && Number(match[1]) > spec.next) {
        fail(
          `${where}: next ${spec.next} would re-issue "${text}", already seeded`
        );
      }
    }
  });
  for (const [item, tracking] of trackingByItem) {
    if (tracking === "Serial" && !sequenced.has(item)) {
      fail(`ops.serialSequences: Serial-tracked "${item}" has no sequence`);
    }
  }

  // Settings › Printing › Print Jobs
  const route = dataset.foundation.printerRoute;
  if (ops.printJobs.length > 0 && (!route || route.format !== "zpl")) {
    fail("ops.printJobs: need a zpl foundation.printerRoute to print against");
  }
  const receipts = new Map(
    dataset.purchasing.purchaseOrders.flatMap((po) =>
      "receipt" in po && po.receipt
        ? [[po.receipt.ref, po.receipt] as const]
        : []
    )
  );
  const jobs = new Map(dataset.production.jobs.map((job) => [job.key, job]));
  const printStatuses = new Set<string>();
  const printOrigins = new Set<string>();
  ops.printJobs.forEach((spec, index) => {
    const where = `ops.printJobs[${index}]`;
    printStatuses.add(spec.status);
    printOrigins.add(spec.origin);
    const { source } = spec;
    if (source.kind === "Receipt") {
      const receipt = receipts.get(source.receipt);
      if (!receipt) {
        fail(`${where}: unknown receipt "${source.receipt}"`);
      } else if (receipt.status !== "Posted") {
        fail(`${where}: receipt "${source.receipt}" is not Posted`);
      } else {
        if (spec.at.offset < (receipt.postedOffset ?? 0)) {
          fail(`${where}: printed before its receipt posted`);
        }
        if (!receipt.lines.some((line) => line.item === spec.item)) {
          fail(`${where}: item "${spec.item}" is not on the receipt`);
        }
      }
    } else if (source.kind === "Job") {
      const job = jobs.get(source.job);
      if (!job) {
        fail(`${where}: unknown job "${source.job}"`);
      } else {
        if (!PRINTABLE_JOB_STATUSES.has(job.status)) {
          fail(`${where}: job "${source.job}" is ${job.status}`);
        }
        if (job.item !== spec.item) {
          fail(`${where}: item "${spec.item}" is not what the job builds`);
        }
      }
    } else {
      need("shelf", where, source.shelf);
      if (spec.item !== undefined) {
        fail(`${where}: a storage-unit label names no item`);
      }
    }
    if (source.kind !== "StorageUnit" && spec.item !== undefined) {
      need("item", where, spec.item);
    }
    if ((spec.status === "failed") !== (spec.error !== undefined)) {
      fail(`${where}: error is required on a failed job and only there`);
    }
    if (spec.status === "queued" ? spec.attempts !== 0 : spec.attempts < 1) {
      fail(`${where}: attempts must be 0 while queued and ≥ 1 once delivered`);
    }
    if (secondsOfDay(spec.at.time) === null) {
      fail(`${where}: time "${spec.at.time}" is not a UTC "HH:MM:SS"`);
    }
    if (
      spec.at.offset < PRINT_JOB_WINDOW.min ||
      spec.at.offset > PRINT_JOB_WINDOW.max
    ) {
      fail(
        `${where}: offset ${spec.at.offset} is outside ${PRINT_JOB_WINDOW.min}…${PRINT_JOB_WINDOW.max} (older completed jobs are cleaned up)`
      );
    }
    // Today's rows must already be in the past at a US plant's morning.
    if (
      spec.at.offset === 0 &&
      (secondsOfDay(spec.at.time) ?? 0) > (secondsOfDay(OPEN_EVENT_TIME) ?? 0)
    ) {
      fail(`${where}: today's print is after ${OPEN_EVENT_TIME} UTC`);
    }
  });
  checkCoverage(fail, {
    printJobStatus: printStatuses,
    printJobOrigin: printOrigins
  });
}

// Sales and storage rules as the rule builder would accept them.

const PRESENCE_OPS = new Set<RuleOperator>(["isSet", "isNotSet"]);
const LIST_OPS = new Set<RuleOperator>(["in", "notIn"]);

function ruleShape(spec: EnforcementRuleSpec): RuleShape {
  return spec.family === "sales" ? "sales" : `storage:${spec.targetType}`;
}

function checkRuleValue(
  where: string,
  kind: RuleValueKind,
  op: RuleOperator,
  value: RuleConditionValue | undefined,
  known: { storageTypes: Set<string>; customerTypes: Set<string> },
  fail: (message: string) => void
): void {
  if (PRESENCE_OPS.has(op)) {
    if (value !== undefined) fail(`${where}: ${op} takes no value`);
    return;
  }
  if (value === undefined) {
    fail(`${where}: ${op} needs a value`);
    return;
  }
  const isList = LIST_OPS.has(op);
  switch (kind) {
    case "number":
      if (typeof value !== "number") fail(`${where}: value must be a number`);
      return;
    case "boolean":
      if (typeof value !== "boolean") fail(`${where}: value must be a boolean`);
      return;
    case "enum":
    case "country": {
      const values = isList ? value : [value];
      if (
        !Array.isArray(values) ||
        values.length === 0 ||
        values.some((v) => typeof v !== "string")
      ) {
        fail(
          `${where}: ${op} needs ${isList ? "a non-empty string list" : "a string"}`
        );
        return;
      }
      if (
        kind === "country" &&
        values.some((v) => !COUNTRY_CODE.test(String(v)))
      ) {
        fail(`${where}: country codes are ISO alpha-2 ("US")`);
      }
      return;
    }
    case "storageType":
      if (
        typeof value !== "object" ||
        Array.isArray(value) ||
        !("storageType" in value)
      ) {
        fail(`${where}: value must be { storageType }`);
      } else if (!known.storageTypes.has(value.storageType)) {
        fail(`${where}: unknown storage type "${value.storageType}"`);
      }
      return;
    case "customerTypes":
      if (
        typeof value !== "object" ||
        Array.isArray(value) ||
        !("customerTypes" in value)
      ) {
        fail(`${where}: value must be { customerTypes }`);
      } else if (value.customerTypes.length === 0) {
        fail(`${where}: customerTypes is empty`);
      } else {
        for (const name of value.customerTypes) {
          if (!known.customerTypes.has(name)) {
            fail(`${where}: unknown customer type "${name}"`);
          }
        }
      }
      return;
    case "location":
      if (
        typeof value !== "object" ||
        Array.isArray(value) ||
        !("location" in value)
      ) {
        fail(`${where}: value must be { location }`);
      }
      return;
  }
}

export function enforcementRules(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need } = ctx;
  const storageTypes = ix.refs.storageType;
  const customerTypes = ix.refs.customerType;

  // ── Enforcement rules ─────────────────────────────────────────────────────
  const shapesSeen = new Set<string>();
  const salesSeverities = new Set<string>();
  const ruleNames = new Set<string>();
  for (const spec of dataset.items.enforcementRules) {
    const shape = ruleShape(spec);
    const where = `items.enforcementRules "${spec.name}"`;
    shapesSeen.add(shape);
    if (spec.family === "sales") salesSeverities.add(spec.severity);
    const nameKey = `${spec.family}:${spec.name}`;
    if (ruleNames.has(nameKey)) {
      fail(`${where}: duplicate name within family "${spec.family}"`);
    }
    ruleNames.add(nameKey);
    if (spec.message.trim() === "") fail(`${where}: empty message`);
    if (spec.surfaces.length === 0) fail(`${where}: no surfaces`);
    if (new Set<string>(spec.surfaces).size !== spec.surfaces.length) {
      fail(`${where}: duplicate surface`);
    }
    if (spec.conditions.length === 0) fail(`${where}: no conditions`);
    for (const [index, condition] of spec.conditions.entries()) {
      const conditionWhere = `${where} condition ${index + 1}`;
      const field = RULE_FIELDS[condition.field];
      if (!field) {
        fail(
          `${conditionWhere}: field "${condition.field}" is not one the seed can author`
        );
        continue;
      }
      if (!field.shapes.includes(shape)) {
        fail(
          `${conditionWhere}: field "${condition.field}" is not available to a ${shape} rule`
        );
      }
      if (!field.ops.includes(condition.op)) {
        fail(
          `${conditionWhere}: operator "${condition.op}" is not allowed on "${condition.field}"`
        );
      }
      checkRuleValue(
        conditionWhere,
        field.value,
        condition.op,
        condition.value,
        { storageTypes, customerTypes },
        fail
      );
    }
    const targets = "workCenters" in spec ? spec.workCenters : spec.items;
    if (targets.length === 0) {
      fail(`${where}: no assignments — the rule applies to nothing`);
    }
    if (new Set(targets).size !== targets.length) {
      fail(`${where}: duplicate assignment`);
    }
    if ("workCenters" in spec) {
      for (const workCenter of spec.workCenters) {
        need("workCenter", where, workCenter);
      }
    } else {
      for (const item of spec.items) need("item", where, item);
    }
  }
  checkCoverage(fail, {
    enforcementRuleShape: shapesSeen,
    salesRuleSeverity: salesSeverities
  });
}

// Planning: MRP demand, the demand order, and HQ's planning rows.

export function planning(ctx: ValidationCtx): void {
  const { dataset, ix, fail, need, needCustomer } = ctx;
  const { makePartIds } = ix;
  for (const id of dataset.planning.buyItemIds) {
    need("item", "planning.buyItemIds", id);
  }
  for (const id of dataset.planning.makeItemIds) {
    need("item", "planning.makeItemIds", id);
  }
  for (const projection of dataset.planning.demandProjections) {
    need("item", "planning.demandProjections", projection.readableId);
  }
  const order = dataset.planning.demandOrder;
  needCustomer("planning.demandOrder", order.customer);
  if (!dataset.foundation.shippingMethods.includes(order.shippingMethod)) {
    fail(
      `planning.demandOrder: unknown shipping method "${order.shippingMethod}"`
    );
  }
  if (
    order.promisedDateOffset < 0 ||
    order.promisedDateOffset >= HORIZON_DAYS
  ) {
    fail(
      `planning.demandOrder: promisedDateOffset ${order.promisedDateOffset} outside the ${HORIZON_DAYS}-day planning horizon`
    );
  }
  for (const line of order.lines)
    need("item", "planning.demandOrder", line.item);

  const hq = dataset.planning.hq;
  const buyPartIds = new Set(dataset.items.buyParts.map((p) => p.readableId));
  for (const id of hq.reorderItemIds)
    need("item", "planning.hq.reorderItemIds", id);
  if (!hq.reorderItemIds.some((id) => makePartIds.has(id))) {
    fail(
      "planning.hq.reorderItemIds: no make part, so production Material Planning at HQ is empty"
    );
  }
  if (!hq.reorderItemIds.some((id) => buyPartIds.has(id))) {
    fail(
      "planning.hq.reorderItemIds: no buy part, so purchasing Material Planning at HQ is empty"
    );
  }
  if (hq.demandProjections.length === 0) {
    fail("planning.hq.demandProjections: must not be empty");
  }
  for (const projection of hq.demandProjections) {
    if (!makePartIds.has(projection.readableId)) {
      fail(
        `planning.hq.demandProjections: "${projection.readableId}" is not a make part`
      );
    }
    if (projection.quantities.length > HORIZON_DAYS / 7) {
      fail(
        `planning.hq.demandProjections "${projection.readableId}": more weeks than the planning horizon`
      );
    }
  }
}

const RULES: Rule[] = [
  itemIdentity,
  foundation,
  items,
  openingStock,
  batchProperties,
  trackedStockAndMovements,
  uniqueDocumentRefs,
  sales,
  purchasing,
  jobs,
  floor,
  eventsJobAndPicking,
  sparePartDrains,
  netOnHand,
  genealogy,
  assembly,
  inspections,
  quality,
  changeOrders,
  accounting,
  postings,
  maintenance,
  workforce,
  workflowRuns,
  peopleAndTime,
  settingsSurfaces,
  enforcementRules,
  commercial,
  returnOrders,
  planning
];

export function validateDataset(dataset: Dataset): string[] {
  const ctx = createContext(dataset);
  for (const rule of RULES) rule(ctx);
  return ctx.violations;
}
