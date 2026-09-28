import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

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

const { expandStorageUnitIdsWithDescendants } = await import(
  "~/modules/inventory/inventory.service"
);
const { lookupBuyPrice } = await import("~/modules/items/items.service");
const { calculateJobPriority } = await import(
  "~/modules/production/production.service"
);
const { getNextSequence } = await import("~/modules/settings/settings.service");

// Behavioural check behind the manifest's classification of representative
// tools: run each service function against a recording client stub and compare
// what it DID with what the manifest says. A READ tool must issue no write
// verb; a tool that issues one must not be READ. The effect checker
// (scripts/lib/effect-summary.ts) proves this statically for every export;
// these pin it at runtime for the tools the sweep reported.

// The boundary is PostgREST's HTTP API: a REAL supabase-js client whose fetch
// records every request and answers from `rows`. The service code and
// supabase-js's query building run for real; only the network is stubbed.
// A read is a GET; a write is a POST/PATCH/DELETE (an rpc is a POST to /rpc/).
type SentRequest = { method: string; path: string };

function recordingClient(rows: Record<string, unknown> = {}) {
  const sent: SentRequest[] = [];
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    sent.push({ method: init?.method ?? "GET", path });
    return new Response(JSON.stringify(rows[path] ?? []), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const client = createClient("http://localhost:54321", "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchStub as typeof fetch }
  });
  return { client: client as never, sent };
}

const classification = (name: string) =>
  metadata.tools.find((t) => t.name === name)?.classification;

const wrote = (sent: SentRequest[]) =>
  sent.some((r) => r.method !== "GET" && r.method !== "HEAD");

describe("classification matches behaviour", () => {
  it("settings_getNextSequence consumes a number, so it is not READ", async () => {
    const { client, sent } = recordingClient({
      "rpc/get_next_sequence": "SO000011"
    });
    await getNextSequence(client, "salesOrder", "c1");
    expect(sent).toEqual([{ method: "POST", path: "rpc/get_next_sequence" }]);
    expect(classification("settings_getNextSequence")).toBe("WRITE");
  });

  it("items_lookupBuyPrice only reads price breaks, so it is READ", async () => {
    const { client, sent } = recordingClient({
      supplierPart: [{ id: "sp1", itemId: "item1", unitPrice: 3 }],
      supplierPartPrice: [{ supplierPartId: "sp1", quantity: 1, unitPrice: 7 }]
    });
    await expect(lookupBuyPrice(client, "item1", 5, 3)).resolves.toBe(7);
    expect(sent.map((r) => r.path)).toEqual(["supplierPart", "supplierPartPrice"]);
    expect(wrote(sent)).toBe(false);
    expect(classification("items_lookupBuyPrice")).toBe("READ");
  });

  it("production_calculateJobPriority only reads sibling jobs, so it is READ", async () => {
    const { client, sent } = recordingClient({
      job: [{ id: "j1", priority: 0, deadlineType: "Hard Deadline" }]
    });
    const priority = await calculateJobPriority(client, {
      dueDate: "2026-10-01",
      deadlineType: "ASAP",
      companyId: "c1",
      locationId: "l1"
    });
    expect(typeof priority).toBe("number");
    expect(sent.length).toBeGreaterThan(0);
    expect(wrote(sent)).toBe(false);
    expect(classification("production_calculateJobPriority")).toBe("READ");
  });

  it("inventory_expandStorageUnitIdsWithDescendants only reads the subtree, so it is READ", async () => {
    const { client, sent } = recordingClient({
      storageUnits_recursive: [{ id: "su2" }]
    });
    await expect(
      expandStorageUnitIdsWithDescendants(client, ["su1"])
    ).resolves.toEqual(["su1", "su2"]);
    expect(wrote(sent)).toBe(false);
    expect(
      classification("inventory_expandStorageUnitIdsWithDescendants")
    ).toBe("READ");
  });
});
