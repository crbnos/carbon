import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { declaredArgUnused } from "../../../packages/checks/src/conformance/declared-arg-unused";
import { noRawOrFilter } from "../../../packages/checks/src/conformance/no-raw-or-filter";
import { noUnconfirmedWrite } from "../../../packages/checks/src/conformance/no-unconfirmed-write";
import { SERVICE_RULE_ERROR_CODE } from "~/utils/supabase";

// Same module-graph stubs as method-row-reparenting.test.ts: glossary and the
// onboarding content build Lingui `msg` descriptors at module load.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

const {
  deleteFixedAsset,
  deleteJournalEntry,
  getJournalEntries,
  postJournalEntry,
  updateJournalEntry
} = await import("~/modules/accounting/accounting.service");
const { deleteItem, getMethodMaterials } = await import(
  "~/modules/items/items.service"
);
const {
  deleteJob,
  getProductionEvents,
  getProductionQuantities,
  upsertScrapReason
} = await import("~/modules/production/production.service");
const {
  deleteQuote,
  getCustomerItemPriceOverridesList,
  getQuotes,
  getSalesOrders,
  updateCustomerPayment,
  updateQuoteStatus
} = await import("~/modules/sales/sales.service");

// The three chain rules in @carbon/checks close the class for the whole tree
// (baselined hits are burned down per module). This file pins the tools the
// MCP sweep reproduced: their functions must stay clean, so they can never be
// re-baselined, and a stubbed client shows the chain each one now builds.

const MODULES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../app/modules"
);

function serviceFiles() {
  const out: { file: string; contents: string }[] = [];
  for (const module of readdirSync(MODULES_DIR)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(MODULES_DIR, module));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".service.ts")) continue;
      out.push({
        file: `apps/erp/app/modules/${module}/${entry}`,
        contents: readFileSync(join(MODULES_DIR, module, entry), "utf8")
      });
    }
  }
  return out;
}

const REPRODUCED = [
  "updateQuoteStatus",
  "upsertScrapReason",
  "upsertFailureMode",
  "deleteJobMaterial",
  "deleteScrapReason",
  "deleteFailureMode",
  "deleteItem",
  "deleteMethodMaterial",
  "updateCustomerPayment",
  "updateCustomerShipping",
  "upsertCustomerStatus",
  "updateQuoteExchangeRate",
  "deleteQuote",
  "deleteSalesOrder",
  "deleteJournalEntry",
  "updateJournalEntry",
  "deleteJournalEntryLine",
  "deleteJob",
  "deleteMaintenanceDispatchItem",
  "deleteMaintenanceScheduleItem",
  "getProductionEvents",
  "getProductionQuantities",
  "getInspectionDocuments",
  "getQuotes",
  "getSalesOrders",
  "getSalesRFQs",
  "getSalesReturnOrders",
  "getExternalSalesOrderLines",
  "getBaseCatalog",
  "getCustomerItemPriceOverridesList",
  "getMethodMaterials",
  "getMaintenanceDispatches",
  "getMaintenanceDispatchesByLocation"
];

describe("service query-chain conformance on the reproduced tools", () => {
  const files = serviceFiles();
  const findings = files.flatMap(({ file, contents }) =>
    [noUnconfirmedWrite, noRawOrFilter, declaredArgUnused].flatMap((check) =>
      check.scan(file, contents).map((v) => ({ check: check.id, ...v }))
    )
  );

  it("scans every ERP service file", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it.each(REPRODUCED)("%s has no chain finding", (fn) => {
    const hits = findings.filter((f) => f.snippet.startsWith(`${fn}:`));
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A real supabase-js client whose fetch records each PostgREST request and
// answers with what `respond` returns. Query building runs for real, so the
// assertions are on the HTTP request PostgREST would receive.
// ---------------------------------------------------------------------------

type Sent = {
  method: string;
  table: string;
  params: [string, string][];
  accept: string | null;
  prefer: string | null;
};
type Reply = { status?: number; body?: unknown };

function recordingClient(respond: (sent: Sent) => Reply = () => ({})) {
  const sent: Sent[] = [];
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const request: Sent = {
      method: init?.method ?? "GET",
      table: url.pathname.split("/").pop() ?? "",
      params: [...url.searchParams.entries()],
      accept: headers.get("Accept"),
      prefer: headers.get("Prefer")
    };
    sent.push(request);
    const reply = respond(request);
    const status = reply.status ?? 200;
    return new Response(
      status === 204 ? null : JSON.stringify(reply.body ?? []),
      { status, headers: { "Content-Type": "application/json" } }
    );
  };
  const client = createClient("http://localhost:54321", "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchStub as typeof fetch }
  });
  return { client: client as never, sent };
}

const SINGLE = "application/vnd.pgrst.object+json";
const param = (s: Sent, key: string) =>
  s.params.filter(([k]) => k === key).map(([, v]) => v);
const writes = (sent: Sent[]) =>
  sent.filter((s) => s.method === "PATCH" || s.method === "DELETE");

/** A single-row write: returns the row and asks for exactly one object. */
function expectConfirmed(s: Sent | undefined) {
  expect(s).toBeDefined();
  expect(s!.prefer).toContain("return=representation");
  expect(s!.accept).toBe(SINGLE);
}

describe("single-key writes confirm the row", () => {
  it("deleteQuote asks for exactly one deleted row", async () => {
    const { client, sent } = recordingClient(() => ({ body: { id: "q1" } }));
    const result = await deleteQuote(client, "q1");
    expect(result.error).toBeNull();
    const [del] = writes(sent);
    expectConfirmed(del);
    expect(param(del!, "id")).toEqual(["eq.q1"]);
  });

  it("deleteQuote on a missing id is PostgREST's not-found, not success", async () => {
    const { client } = recordingClient(() => ({
      status: 406,
      body: { code: "PGRST116", message: "0 rows", details: "", hint: "" }
    }));
    const result = await deleteQuote(client, "does-not-exist");
    expect(result.error?.code).toBe("PGRST116");
  });

  it("updateQuoteStatus, updateCustomerPayment and upsertScrapReason confirm the row", async () => {
    const cases: [(c: never, a: never) => Promise<unknown>, unknown][] = [
      [
        updateQuoteStatus as never,
        { id: "q1", status: "Lost", assignee: null, updatedBy: "u1" }
      ],
      [updateCustomerPayment as never, { customerId: "c1", updatedBy: "u1" }],
      [
        upsertScrapReason as never,
        { id: "sr1", name: "Scratched", updatedBy: "u1" }
      ]
    ];
    for (const [fn, arg] of cases) {
      const { client, sent } = recordingClient(() => ({ body: { id: "x" } }));
      await fn(client, arg as never);
      expectConfirmed(writes(sent)[0]);
    }
  });

  it("deleteItem and deleteJob confirm the row", async () => {
    for (const fn of [deleteItem, deleteJob]) {
      const { client, sent } = recordingClient(() => ({ body: { id: "x1" } }));
      await (fn as (c: never, id: string) => Promise<unknown>)(client, "x1");
      expectConfirmed(writes(sent)[0]);
    }
  });
});

describe("status-guarded writes refuse instead of silently matching nothing", () => {
  const withStatus = (status: string) =>
    recordingClient((s) =>
      s.method === "GET" ? { body: { status } } : { body: { id: "row" } }
    );

  it("deleteJournalEntry on a posted entry is a rule error and deletes nothing", async () => {
    const { client, sent } = withStatus("Posted");
    const result = await deleteJournalEntry(client, "je1");
    expect(result.error).toMatchObject({
      code: SERVICE_RULE_ERROR_CODE,
      message: "Journal entry is not in Draft status"
    });
    expect(writes(sent)).toEqual([]);
  });

  it("deleteJournalEntry on a draft deletes it, still guarded, and confirms the row", async () => {
    const { client, sent } = withStatus("Draft");
    const result = await deleteJournalEntry(client, "je1");
    expect(result.error).toBeNull();
    const [del] = writes(sent);
    expectConfirmed(del);
    expect(param(del!, "status")).toEqual(["eq.Draft"]);
  });

  it("deleteJournalEntry on a missing id returns the read's not-found", async () => {
    const { client, sent } = recordingClient(() => ({
      status: 406,
      body: { code: "PGRST116", message: "0 rows", details: "", hint: "" }
    }));
    const result = await deleteJournalEntry(client, "nope");
    expect(result.error?.code).toBe("PGRST116");
    expect(writes(sent)).toEqual([]);
  });

  it("updateJournalEntry and deleteFixedAsset refuse a row past Draft", async () => {
    const posted = withStatus("Posted");
    const update = await updateJournalEntry(posted.client, "je1", {
      description: "x",
      updatedBy: "u1"
    } as never);
    expect(update.error).toMatchObject({ code: SERVICE_RULE_ERROR_CODE });
    expect(writes(posted.sent)).toEqual([]);

    const active = withStatus("Active");
    const asset = await deleteFixedAsset(active.client, "fa1");
    expect(asset.error).toMatchObject({
      code: SERVICE_RULE_ERROR_CODE,
      message: "Fixed asset is not in Draft status"
    });
  });

  it("postJournalEntry's refusal is a rule error, not a masked database error", async () => {
    const { client } = recordingClient(() => ({
      body: { status: "Posted", journalLine: [] }
    }));
    const result = await postJournalEntry(client, "je1", "u1");
    expect(result.error).toMatchObject({ code: SERVICE_RULE_ERROR_CODE });
  });
});

describe("list search goes through setSearchFilter", () => {
  it("getQuotes tokenises a search with a comma instead of breaking the filter", async () => {
    const { client, sent } = recordingClient();
    await getQuotes(client, "c1", {
      search: "Bracket, M8",
      limit: 25,
      offset: 0
    } as never);
    expect(param(sent[0]!, "or")).toEqual([
      "(quoteId.ilike.%Bracket%,customerReference.ilike.%Bracket%)",
      "(quoteId.ilike.%M8%,customerReference.ilike.%M8%)"
    ]);
  });

  it("getProductionEvents and getProductionQuantities search the operation through an !inner embed", async () => {
    for (const fn of [getProductionEvents, getProductionQuantities]) {
      const { client, sent } = recordingClient();
      await (fn as (c: never, ids: string[], a: unknown) => Promise<unknown>)(
        client,
        ["op1"],
        { search: "deburr", limit: 25, offset: 0 }
      );
      const [s] = sent;
      expect(param(s!, "select")[0]).toContain("jobOperation!inner(");
      expect(param(s!, "or")).toEqual([]);
      expect(param(s!, "jobOperation.or")).toEqual([
        "(description.ilike.%deburr%)"
      ]);
    }
  });

  it("getMethodMaterials drops non-matching rows via item!inner", async () => {
    const { client, sent } = recordingClient();
    await getMethodMaterials(client, "c1", {
      search: "BR-100",
      limit: 25,
      offset: 0
    } as never);
    const [s] = sent;
    expect(param(s!, "select")[0]).toContain("item!inner(");
    expect(param(s!, "item.or")).toEqual([
      "(readableIdWithRevision.ilike.%BR-100%)"
    ]);
  });

  it("getCustomerItemPriceOverridesList resolves embedded name matches to ids", async () => {
    const { client, sent } = recordingClient((s) =>
      s.table === "item" ? { body: [{ id: "item-1" }] } : { body: [] }
    );
    await getCustomerItemPriceOverridesList(client, "c1", {
      search: "widget",
      limit: 25,
      offset: 0
    } as never);
    const list = sent.find((s) => s.table === "customerItemPriceOverride")!;
    const [or] = param(list, "or");
    expect(or).toBe('(and(or(notes.ilike.%widget%)),itemId.in.("item-1"))');
    expect(or).not.toMatch(/\b(item|customer)\.name\b/);
  });

  it("a list with no search sends no or filter", async () => {
    const { client, sent } = recordingClient();
    await getJournalEntries(client, "c1", { limit: 25, offset: 0 } as never);
    expect(param(sent[0]!, "or")).toEqual([]);
  });
});

describe("declared filters are applied", () => {
  it("getSalesOrders applies status", async () => {
    const { client, sent } = recordingClient();
    await getSalesOrders(client, "c1", {
      search: null,
      status: "Draft",
      customerId: null,
      limit: 25,
      offset: 0
    });
    expect(param(sent[0]!, "status")).toEqual(["eq.Draft"]);
  });
});
