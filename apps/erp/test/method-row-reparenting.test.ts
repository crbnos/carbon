import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// The method-row update helpers are called with a service-role client and a
// form payload. The payload carries the row's parent ids (quote, line, job,
// make method) and the tenant id; if those reach the UPDATE, a row can be
// re-parented into another company's quote or job. Pin that they never do.

// Same module-graph stubs as production.service.test.ts: glossary and the
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

const { upsertJobMaterial, upsertJobOperation } = await import(
  "~/modules/production/production.service"
);
const { upsertQuoteMaterial, upsertQuoteOperation } = await import(
  "~/modules/sales/sales.service"
);

// The boundary is PostgREST's HTTP API: a REAL supabase-js client whose fetch
// records the request it would have sent. The service code and supabase-js's
// query building run for real; only the network is stubbed.
type SentRequest = { method: string; url: URL; body: Record<string, unknown> };

function recordingClient() {
  const calls: {
    table: string;
    update: Record<string, unknown>;
    filters: [string, unknown][];
  }[] = [];
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const sent: SentRequest = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      body: init?.body ? JSON.parse(String(init.body)) : {}
    };
    if (sent.method === "PATCH") {
      calls.push({
        table: sent.url.pathname.split("/").pop() ?? "",
        update: sent.body,
        // PostgREST filters: `?id=eq.qm1&companyId=eq.c1` (select is not one).
        filters: [...sent.url.searchParams.entries()]
          .filter(([key]) => key !== "select")
          .map(([key, value]) => [key, value.replace(/^eq\./, "")])
      });
    }
    return new Response(JSON.stringify({ id: "row" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const client = createClient("http://localhost:54321", "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchStub as typeof fetch }
  });
  return { client: client as never, calls };
}

describe("method row updates cannot re-parent a row", () => {
  it("upsertQuoteMaterial strips parent ids and scopes to the company", async () => {
    const { client, calls } = recordingClient();
    await upsertQuoteMaterial(client, {
      id: "qm1",
      quoteId: "victim-quote",
      quoteLineId: "victim-line",
      quoteMakeMethodId: "victim-method",
      companyId: "c1",
      updatedBy: "u1",
      order: 1,
      itemType: "Part",
      methodType: "Pull from Inventory",
      itemId: "item1",
      kit: false,
      description: "Bracket",
      quantity: 1,
      unitCost: 0,
      unitCostSource: "system",
      unitOfMeasureCode: "EA"
    });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    for (const column of [
      "id",
      "quoteId",
      "quoteLineId",
      "quoteMakeMethodId",
      "companyId"
    ]) {
      expect(call.update).not.toHaveProperty(column);
    }
    expect(call.filters).toEqual([
      ["id", "qm1"],
      ["companyId", "c1"]
    ]);
  });

  it("upsertQuoteOperation strips parent ids and scopes to the company", async () => {
    const { client, calls } = recordingClient();
    await upsertQuoteOperation(client, {
      id: "qo1",
      quoteId: "victim-quote",
      quoteLineId: "victim-line",
      quoteMakeMethodId: "victim-method",
      companyId: "c1",
      updatedBy: "u1",
      order: 1,
      operationOrder: "After Previous",
      operationType: "Process",
      processId: "p1",
      description: "Cut"
    });

    const [call] = calls;
    for (const column of [
      "id",
      "quoteId",
      "quoteLineId",
      "quoteMakeMethodId",
      "companyId"
    ]) {
      expect(call.update).not.toHaveProperty(column);
    }
    expect(call.filters).toEqual([
      ["id", "qo1"],
      ["companyId", "c1"]
    ]);
  });

  it("upsertJobMaterial strips parent ids and scopes to the company", async () => {
    const { client, calls } = recordingClient();
    await upsertJobMaterial(client, {
      id: "jm1",
      jobId: "victim-job",
      jobMakeMethodId: "victim-method",
      companyId: "c1",
      updatedBy: "u1",
      description: "Bracket",
      itemType: "Part",
      methodType: "Pull from Inventory",
      itemId: "item1",
      kit: false,
      order: 1,
      quantity: 1,
      requiresBatchTracking: false,
      requiresSerialTracking: false,
      unitCost: 0,
      unitOfMeasureCode: "EA"
    });

    const [call] = calls;
    for (const column of ["id", "jobId", "jobMakeMethodId", "companyId"]) {
      expect(call.update).not.toHaveProperty(column);
    }
    expect(call.filters).toEqual([
      ["id", "jm1"],
      ["companyId", "c1"]
    ]);
  });

  it("upsertJobOperation strips parent ids and scopes to the company", async () => {
    const { client, calls } = recordingClient();
    await upsertJobOperation(client, {
      id: "jo1",
      jobId: "victim-job",
      jobMakeMethodId: "victim-method",
      companyId: "c1",
      updatedBy: "u1",
      order: 1,
      operationOrder: "After Previous",
      operationType: "Process",
      processId: "p1",
      description: "Cut"
    } as never);

    const [call] = calls;
    for (const column of ["id", "jobId", "jobMakeMethodId", "companyId"]) {
      expect(call.update).not.toHaveProperty(column);
    }
    expect(call.filters).toEqual([
      ["id", "jo1"],
      ["companyId", "c1"]
    ]);
  });
});
