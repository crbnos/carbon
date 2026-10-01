// Recurrence guard for the document-lock gate
// (`app/routes/api+/v1+/lib/document-lock-rules.ts`).
//
// The ERP enforces document locks in route actions, which the dispatch path
// (HTTP v1, MCP, agent, workflows) never runs. The gate copies those guards
// into per-tool tables. This test keeps the tables honest in both directions:
//
// 1. Every registry write a GUARDED route calls is gated, or exempted here
//    with a reason — so a new guarded route cannot ship an MCP bypass.
// 2. Every route a gate entry cites exists and carries a guard — so the gate
//    cannot invent a lock the UI does not have.
// 3. Siblings: a WRITE/DESTRUCTIVE tool that writes a table a gated tool
//    writes is gated, or exempted here with a reason — so a second tool doing
//    the same write (a deprecated upsert, a `production_` re-export) cannot
//    slip past. Every exemption must still be needed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import toolMetadataJson from "../app/routes/api+/mcp+/lib/tool-metadata.json";
import {
  createSensitiveToolNames,
  gateRoutesByTool,
  gatedToolNames,
  INLINE_GUARDS,
  INSERT_TESTS,
  type InsertTest,
  LOCK_OPERATIONS,
  METHOD_LOCK_OPERATIONS,
  type Ref
} from "../app/routes/api+/v1+/lib/document-lock-rules";

// The rules import the modules' lock predicates from their `*.models.ts`,
// whose barrels reach catalog code (`@carbon/glossary`, `@carbon/onboarding`)
// written with the `msg` macro, which is untransformed under vitest (no lingui
// plugin here). A descriptor-building stand-in is all those modules need at
// import time.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    id: String.raw({ raw: strings }, ...values)
  })
}));

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "../app");
const ROUTES_DIR = join(APP_DIR, "routes/x+");
const MODULES_DIR = join(APP_DIR, "modules");

interface Tool {
  name: string;
  module: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  serviceParams: string[];
}
const tools = (toolMetadataJson as unknown as { tools: Tool[] }).tools;
const toolByName = new Map(tools.map((t) => [t.name, t]));
const isWrite = (name: string) =>
  toolByName.get(name)?.classification !== "READ" && toolByName.has(name);

/** The guard calls a route action makes before writing a locked document. */
const GUARD =
  /requireUnlocked(?:Bulk)?\(|checkRevisionLock\(|requireChangeNoticeEditable\(|requireEditableChangeNoticeRoute\(|requireChangeNoticeChildRoute\(|assertMethodOperationIsDraft\(|\bis[A-Z]\w*Locked\(/;
/** The inline checks the delete / return-line routes make instead. */
const INLINE_GUARD =
  /postingDate|\.status\b|status\s*!==|quantityReceived|quantityShipped/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const routeFiles = walk(ROUTES_DIR).filter((f) => /\.tsx?$/.test(f));
const routeSource = new Map(
  routeFiles.map((f) => [relative(ROUTES_DIR, f), readFileSync(f, "utf8")])
);

/** Registry tools a route source imports from `~/modules/<module>` and calls. */
function calledTools(source: string): string[] {
  const out = new Set<string>();
  const imports =
    /import\s*\{([^}]*)\}\s*from\s*"~\/modules\/([\w-]+)[^"]*"/g;
  for (const match of source.matchAll(imports)) {
    const module = match[2];
    for (const raw of match[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0]?.trim();
      if (!name || name.startsWith("type ")) continue;
      const tool = `${module}_${name}`;
      if (isWrite(tool) && new RegExp(`\\b${name}\\(`).test(source)) {
        out.add(tool);
      }
    }
  }
  return [...out];
}

const SELF_GUARDED =
  "the service refuses a locked job itself (production.service.ts), inside its transaction";

/**
 * Registry writes a guarded route calls that the gate deliberately leaves
 * open. Keyed by tool; the reason names what the UI does.
 */
const ROUTE_CALL_EXEMPTIONS: Record<string, string> = {
  items_copyMakeMethod:
    "DECISION: get/save gate the copy target, but version.new.tsx copies into a new Draft version of a released item with no guard; which one the tool mirrors is open",
  items_assertMethodOperationIsDraft:
    "is the Draft-version check itself (a read that throws)",
  production_recalculateJobRequirements:
    "recompute the route runs after its own guarded write; unguarded routes (status, recalculate, get-method) run it on locked jobs",
  production_calculateJobPriority:
    "computes a priority value; the write is the route's own",
  production_upsertJobMethod:
    "also written by the unguarded job configure / get-method / planning routes",
  production_notifyScheduleInputsChanged:
    "schedule-change notification, not a document write",
  production_runMRP: "planning run, not a document write",
  inventory_updatePickingListStatus:
    "status transition; completion/reopen policy is a transition rule, out of scope for the lock gate",
  purchasing_updatePurchaseOrderStatus:
    "status transition (reopen included); the route's predicate decides reopen, not a lock",
  purchasing_reopenPurchaseOrderAsRevision:
    "reopen path of the status route; allowed on a locked order by design",
  purchasing_upsertPurchasingRFQSuppliers:
    "also written by the unguarded purchasing-rfq+/$rfqId.suppliers.tsx",
  sales_buildMakeToOrderPriceRows: "computes price rows; writes nothing",
  sales_buildPullFromInventoryPriceRows: "computes price rows; writes nothing",
  sales_buildPurchaseToOrderPriceRows: "computes price rows; writes nothing",
  sales_recalculateQuoteLinePrices:
    "also run by the unguarded quote make-method routes (quote+/methods+/*)",
  production_syncAssemblyInstructionToOperation: SELF_GUARDED,
  sales_upsertQuoteLineMethod:
    "also written by the unguarded quote configure / drag / method-get routes"
};

/** Tables a gated tool writes only as a side effect of its guarded action. */
const SIDE_EFFECT_TABLES: Record<string, string> = {
  item: "addChangeNoticeAffectedItem / createChangeNoticeDraftMethod mint a draft part; item edits are not document-locked",
  makeMethod:
    "createChangeNoticeDraftMethod creates the draft method; method-version writes are gated through METHOD_LOCK_OPERATIONS",
  opportunity: "header updates keep the opportunity in sync",
  quoteLinePrice:
    "price rows; the UI's recalculate-price route writes them unguarded"
};

const STATUS =
  "status transition or reopen; the UI's status routes carry no lock guard (transition rules are a separate issue)";
const CREATE = "creates a new document, which starts unlocked";
const HEADER_DELETE =
  "deletes the whole document; the UI delete route carries no lock guard";
const JOB_METHOD =
  "job make-method edit; the UI's job+/methods+ routes carry no lock guard";
const UNGUARDED_UI =
  "the UI route that makes this write carries no lock guard";

/**
 * Tools that write a table a gated tool writes, left open on purpose. The
 * reason is the UI behaviour mirrored; `DECISION:` marks an open product call.
 */
const SIBLING_EXEMPTIONS: Record<string, string> = {
  // Status transitions / reopen / lifecycle.
  sales_updateSalesOrderStatus: STATUS,
  sales_releaseSalesOrder: STATUS,
  sales_closeSalesOrder: STATUS,
  sales_cancelSalesOrder: STATUS,
  sales_updateQuoteStatus: STATUS,
  sales_finalizeQuote: STATUS,
  sales_updateSalesRFQStatus: STATUS,
  sales_confirmSalesReturnOrder: STATUS,
  sales_cancelSalesReturnOrder: STATUS,
  sales_reopenSalesReturnOrder: STATUS,
  purchasing_updatePurchaseOrderStatus: STATUS,
  purchasing_updatePurchaseOrderStatusLegacy: STATUS,
  purchasing_finalizePurchaseOrder: STATUS,
  purchasing_closePurchaseOrder: STATUS,
  purchasing_reopenPurchaseOrderAsRevision: STATUS,
  purchasing_confirmPurchaseReturnOrder: STATUS,
  purchasing_cancelPurchaseReturnOrder: STATUS,
  purchasing_reopenPurchaseReturnOrder: STATUS,
  purchasing_updatePurchasingRFQStatus: STATUS,
  purchasing_updateSupplierQuoteStatus: STATUS,
  purchasing_finalizeSupplierQuote: STATUS,
  purchasing_sendSupplierQuote: STATUS,
  invoicing_updatePurchaseInvoiceStatus: STATUS,
  invoicing_updateSalesInvoiceStatus: STATUS,
  production_updateJobStatus: STATUS,
  production_updateJobOperationStatus: STATUS,
  quality_updateIssueStatus: STATUS,
  items_updateChangeNoticeStatus: STATUS,
  inventory_updateStockTransferStatus: STATUS,
  inventory_updateWarehouseTransferStatus: STATUS,
  inventory_updateInventoryCountStatus: STATUS,
  purchasing_shortClosePurchaseOrderLine:
    "short-close is a receiving transition with its own route rules, out of scope",
  purchasing_shortClosePurchaseReturnOrderLine:
    "short-close is a shipping transition with its own route rules, out of scope",
  sales_shortCloseSalesReturnOrderLine:
    "short-close is a receiving transition with its own route rules, out of scope",
  sales_setSalesReturnOrderLineDisposition:
    "disposition is set on confirmed returns by design; its enum/Scrap rules are a separate issue",

  // Creates.
  sales_insertQuote: CREATE,
  sales_insertSalesOrder: CREATE,
  sales_insertSalesRFQ: CREATE,
  sales_insertSalesReturnOrder: CREATE,
  purchasing_insertPurchaseOrder: CREATE,
  purchasing_insertPurchaseReturnOrder: CREATE,
  purchasing_insertPurchasingRFQ: CREATE,
  purchasing_insertSupplierQuote: CREATE,
  invoicing_insertPurchaseInvoice: CREATE,
  invoicing_insertSalesInvoice: CREATE,
  inventory_insertInventoryCount: CREATE,
  inventory_insertStockTransfer: CREATE,
  inventory_insertWarehouseTransfer: CREATE,
  items_insertChangeNotice: CREATE,
  items_seedDefaultChangeNoticeActions:
    "seeds the actions of a change notice being created",
  production_insertJob: CREATE,
  production_convertSalesOrderLinesToJobs:
    "creates jobs from order lines; the UI's line-to-job route carries no lock guard",
  quality_insertIssue: CREATE,
  resources_insertMaintenanceDispatch: CREATE,
  sales_createReplacementSalesOrder:
    "creates a replacement order from a return (replacement route, unguarded)",
  purchasing_createReplacementPurchaseOrder:
    "creates a replacement order from a return (replacement route, unguarded)",
  purchasing_duplicatePurchaseOrder:
    "copies an order into a new Draft order (duplicate route, unguarded)",
  inventory_upsertReceipt: "receipt drafts; only the delete of a posted receipt is guarded",
  inventory_upsertShipment:
    "shipment drafts; only the delete of a posted shipment is guarded",

  // Whole-document deletes the UI allows (DB interceptors refuse posted invoices).
  sales_deleteQuote: HEADER_DELETE,
  sales_deleteSalesOrder: HEADER_DELETE,
  sales_deleteSalesRFQ: HEADER_DELETE,
  purchasing_deletePurchasingRFQ: HEADER_DELETE,
  purchasing_deleteSupplierQuote: HEADER_DELETE,
  invoicing_deletePurchaseInvoice: HEADER_DELETE,
  invoicing_deleteSalesInvoice: HEADER_DELETE,
  invoicing_deletePayment: HEADER_DELETE,
  inventory_deleteWarehouseTransfer: HEADER_DELETE,
  items_deleteChangeNotice: HEADER_DELETE,
  production_deleteJob: HEADER_DELETE,
  quality_deleteIssue: HEADER_DELETE,
  resources_deleteMaintenanceDispatch: HEADER_DELETE,
  production_deleteMaintenanceDispatch: HEADER_DELETE,

  // Job make-method and production records: unguarded in the UI.
  production_upsertJobOperation: JOB_METHOD,
  production_deleteJobOperation:
    "job-operation delete refuses on production events in the UI, a business rule for the transition-rules issue",
  production_updateJobOperationOrder: JOB_METHOD,
  production_updateJobOperationDueDate: JOB_METHOD,
  production_activateAssemblyInstructionVersion: UNGUARDED_UI,
  production_deleteProductionEvent: UNGUARDED_UI,
  production_deleteProductionQuantity: UNGUARDED_UI,
  production_updateProductionQuantity:
    "DECISION: the ERP quantity edit route ($jobId.quantities.$id) carries no lock guard, only the create route does",

  // Quote line pricing / precision / charges.
  sales_upsertQuoteLinePrices: UNGUARDED_UI,
  sales_upsertQuoteLineAdditionalCharges: UNGUARDED_UI,
  sales_updateQuoteLinePrecision: UNGUARDED_UI,

  // Stock transfers: no UI route edits the header of a released transfer.
  inventory_updateStockTransfer:
    "DECISION: no UI route edits a stock-transfer header, so there is no guard to mirror",
  inventory_upsertStockTransfer:
    "DECISION: no UI route edits a stock-transfer header, so there is no guard to mirror",
  inventory_generateInventoryCountLines:
    "inventory-count snapshot rules (Draft only) are a separate route-only business rule",

  production_syncAssemblyInstructionToOperation: SELF_GUARDED,

  // Items: BOM writes from the item side, unguarded in the UI.
  items_updateItemMethodAndSourcing: UNGUARDED_UI,
  items_updateDefaultRevision: UNGUARDED_UI,
  items_cascadeItemTrackingType: UNGUARDED_UI
};

// --- Service source parsing: which tables each exported function writes ---

function tablesWritten(body: string): Set<string> {
  const tables = new Set<string>();
  for (const m of body.matchAll(
    /\.from\(\s*"(\w+)"\s*\)\s*\.(?:insert|update|upsert|delete)\(/g
  )) {
    tables.add(m[1]);
  }
  for (const m of body.matchAll(
    /\.(?:insertInto|updateTable|deleteFrom)\(\s*"(\w+)"/g
  )) {
    tables.add(m[1]);
  }
  return tables;
}

/** Tables each exported service function writes, including through the
 *  private helpers of its file that it calls (one level deep). */
/** Exported service bodies by tool name (`<module>_<export>`). */
const serviceBodies = new Map<string, string>();

const serviceWrites = (() => {
  const writes = new Map<string, Set<string>>();
  for (const module of readdirSync(MODULES_DIR)) {
    const dir = join(MODULES_DIR, module);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".service.ts") && !file.endsWith(".mcp.server.ts")) {
        continue;
      }
      const source = readFileSync(join(dir, file), "utf8");
      // Split at every top-level function so a private helper's writes are
      // charged to the exports that call it, not to the export above it.
      const parts = source.split(/\n(export )?(?:async )?function (\w+)/);
      const exported: [string, string][] = [];
      const helpers = new Map<string, Set<string>>();
      for (let i = 1; i < parts.length; i += 3) {
        const name = parts[i + 1];
        const body = parts[i + 2] ?? "";
        if (parts[i]) exported.push([name, body]);
        else helpers.set(name, tablesWritten(body));
      }
      for (const [name, body] of exported) {
        serviceBodies.set(`${module}_${name}`, body);
        const tables = tablesWritten(body);
        for (const [helper, helperTables] of helpers) {
          if (new RegExp(`\\b${helper}\\(`).test(body)) {
            for (const t of helperTables) tables.add(t);
          }
        }
        writes.set(`${module}_${name}`, tables);
      }
    }
  }
  return writes;
})();

/** The insert/update test an upsert service applies first, read off its
 *  source, in the vocabulary of `INSERT_TESTS`. */
function serviceInsertTest(body: string): InsertTest | null {
  const tests: [InsertTest, RegExp][] = [
    ["createdByPresent", /if\s*\(\s*"createdBy"\s+in\s+\w+\s*\)/],
    ["updatedByAbsent", /if\s*\(\s*"updatedBy"\s+in\s+\w+\s*\)/],
    ["idKeyAbsent", /if\s*\(\s*"id"\s+in\s+\w+/],
    ["idFalsy", /if\s*\(\s*!?\w+\.id\s*\)/]
  ];
  let best: [InsertTest, number] | null = null;
  for (const [test, pattern] of tests) {
    const index = body.search(pattern);
    if (index >= 0 && (!best || index < best[1])) best = [test, index];
  }
  return best?.[0] ?? null;
}

const gated = new Set(gatedToolNames());
const routesByTool = gateRoutesByTool();

/** Tables whose writes the gate protects: everything a gated tool writes,
 *  less its side-effect tables. */
const protectedTables = new Set<string>();
for (const tool of gated) {
  for (const table of serviceWrites.get(tool) ?? []) {
    if (!SIDE_EFFECT_TABLES[table]) protectedTables.add(table);
  }
}
const writesProtected = (tool: string) =>
  [...(serviceWrites.get(tool) ?? [])].some((t) => protectedTables.has(t));

describe("document-lock gate coverage", () => {
  it("names only tools that exist in the manifest", () => {
    const unknown = [...gated].filter((name) => !toolByName.has(name));
    expect(unknown).toEqual([]);
  });

  it("reads only params the tool's service actually takes", () => {
    const bad: string[] = [];
    const check = (tool: string, refs: Ref[], extra: string[] = []) => {
      const params = toolByName.get(tool)?.serviceParams ?? [];
      for (const param of [...refs.map((r) => r.param), ...extra]) {
        if (!params.includes(param)) bad.push(`${tool}: ${param}`);
      }
    };
    for (const [tool, rules] of Object.entries(LOCK_OPERATIONS)) {
      for (const rule of Array.isArray(rules) ? rules : [rules]) {
        check(tool, rule.refs, rule.writeParam ? [rule.writeParam] : []);
      }
    }
    for (const [tool, rule] of Object.entries(METHOD_LOCK_OPERATIONS)) {
      check(tool, [
        ...(rule.revision ?? []).flatMap((r) => r.refs),
        ...(rule.draftOperation ?? [])
      ]);
    }
    expect(bad).toEqual([]);
  });

  it("gates every registry write a guarded route calls, or exempts it", () => {
    const missing: string[] = [];
    for (const [route, source] of routeSource) {
      if (!GUARD.test(source)) continue;
      for (const tool of calledTools(source)) {
        if (gated.has(tool) || ROUTE_CALL_EXEMPTIONS[tool]) continue;
        missing.push(`${route} calls ${tool}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("cites only routes that exist and carry a guard (no invented locks)", () => {
    const bad: string[] = [];
    for (const [tool, routes] of Object.entries(routesByTool)) {
      const pattern = INLINE_GUARDS[tool] ? INLINE_GUARD : GUARD;
      for (const route of routes) {
        const source = routeSource.get(route);
        if (source === undefined) bad.push(`${tool}: ${route} does not exist`);
        else if (!pattern.test(source)) {
          bad.push(`${tool}: ${route} carries no guard`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("gates or exempts every write sibling of a gated tool", () => {
    const missing: string[] = [];
    for (const [tool, tables] of serviceWrites) {
      if (!isWrite(tool) || gated.has(tool) || SIBLING_EXEMPTIONS[tool]) {
        continue;
      }
      const shared = [...tables].filter((t) => protectedTables.has(t));
      if (shared.length > 0) missing.push(`${tool} writes ${shared.join(", ")}`);
    }
    expect(missing).toEqual([]);
  });

  it("decides create vs update with the service's own test", () => {
    // Dispatch stamps or strips createdBy/updatedBy per `_operation` and never
    // strips `id`, so a gate that guessed from `id` could be told "update"
    // while the service inserts. Each create-sensitive tool must name the
    // test its service applies, and that test must match the code.
    const bad: string[] = [];
    for (const tool of createSensitiveToolNames()) {
      const declared = INSERT_TESTS[tool];
      const body = serviceBodies.get(tool);
      if (!declared) bad.push(`${tool}: no INSERT_TESTS entry`);
      else if (body === undefined) bad.push(`${tool}: service not found`);
      else if (serviceInsertTest(body) !== declared) {
        bad.push(
          `${tool}: declared ${declared}, service uses ${serviceInsertTest(body)}`
        );
      }
    }
    for (const tool of Object.keys(INSERT_TESTS)) {
      if (!createSensitiveToolNames().includes(tool)) {
        bad.push(`${tool}: INSERT_TESTS entry for a tool no rule splits`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("keeps no stale exemption", () => {
    const stale: string[] = [];
    for (const tool of Object.keys(ROUTE_CALL_EXEMPTIONS)) {
      const stillCalled = [...routeSource.values()].some(
        (source) => GUARD.test(source) && calledTools(source).includes(tool)
      );
      if (gated.has(tool) || !stillCalled) stale.push(`route call: ${tool}`);
    }
    for (const tool of Object.keys(SIBLING_EXEMPTIONS)) {
      if (gated.has(tool) || !isWrite(tool) || !writesProtected(tool)) {
        stale.push(`sibling: ${tool}`);
      }
    }
    for (const table of Object.keys(SIDE_EFFECT_TABLES)) {
      const written = [...gated].some((tool) =>
        serviceWrites.get(tool)?.has(table)
      );
      if (!written) stale.push(`side-effect table: ${table}`);
    }
    expect(stale).toEqual([]);
  });
});
