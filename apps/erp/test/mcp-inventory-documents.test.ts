import { beforeEach, describe, expect, it, vi } from "vitest";

// The receipt/shipment commands (inventory.server.ts) and their MCP tools
// (inventory.mcp.server.ts): the refusals the screens enforce must fire before
// any status flip or edge-function call, a failed posting must put the
// document back to Draft, and a rule block must reach an MCP caller as an
// actionable error. Stubs sit at the boundaries: the Supabase client (HTTP,
// including functions.invoke), `getUserClaims` (redis / get_claims), the rule
// evaluators (database reads behind a plan gate) and the job/telemetry
// transports.

const claims = vi.hoisted(() => ({
  current: {
    permissions: {} as Record<string, Record<string, string[]>>,
    role: "employee" as string | null
  }
}));
const boundary = vi.hoisted(() => ({
  serviceRole: null as unknown,
  violations: [] as { ruleId: string; severity: string; message: string }[],
  raiseMoment: null as unknown as import("vitest").Mock<(...args: unknown[]) => unknown>
}));

vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));
vi.mock("@carbon/auth/users.server", () => ({
  getUserClaims: async () => claims.current
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => {
    if (!boundary.serviceRole) {
      throw new Error("the service role must not be reached in this test");
    }
    return boundary.serviceRole;
  }
}));
vi.mock("@carbon/ee/rules.server", async () => {
  const violations = await import("../../../packages/ee/src/rules/violations");
  return {
    ...violations,
    evaluateLinesForSurface: async () => ({
      violations: boundary.violations,
      ruleNames: {}
    }),
    evaluateSalesRuleLines: async () => ({ violations: [], ruleNames: {} }),
    resolveSalesOrderShipTo: async () => ({
      customerId: null,
      customerLocationId: null
    })
  };
});
vi.mock("@carbon/jobs", () => ({ trigger: vi.fn() }));
vi.mock("@carbon/lib/telemetry", () => ({ trackWorkEvent: vi.fn() }));
vi.mock("@carbon/lib/workflows", () => ({
  raiseMoment: (...args: unknown[]) => boundary.raiseMoment(...args)
}));
vi.mock("@carbon/printing/printing.server", () => ({
  getCachedPrinterConfig: async () => ({ autoPrint: false })
}));
vi.mock("~/modules/sales/sales.server", () => ({
  recordSalesRuleOutcome: vi.fn()
}));
vi.mock("~/modules/shared/timezone.server", () => ({
  getCompanyTimeZone: async () => "UTC",
  getLocationTimeZone: async () => "UTC"
}));

// Load sales.models before anything that reaches the accounting barrel: under
// vitest's module runner the accounting ↔ sales barrel cycle otherwise leaves
// `currencyCodes` undefined when sales.models evaluates.
import "~/modules/sales/sales.models";
import {
  createShipment,
  postReceipt,
  postShipment,
  voidReceipt
} from "~/modules/inventory/inventory.mcp.server";
import { createReceipt } from "~/modules/inventory/inventory.server";
import { SERVICE_RULE_ERROR_CODE } from "~/utils/supabase";

type Row = Record<string, unknown>;
type Write = { table: string; op: "update"; payload: Row; filters: unknown[] };

/**
 * A Supabase client answering reads from `tables` (every read of a table
 * returns its rows; `single`/`maybeSingle` the first) and recording writes and
 * edge-function calls. `invoke` answers from `functions`.
 */
function fakeClient(
  tables: Record<string, Row[]>,
  functions: Record<string, { data: unknown; error: unknown }> = {}
) {
  const writes: Write[] = [];
  const invokes: { name: string; body: Row }[] = [];
  const client = {
    from(table: string) {
      let write: Write | null = null;
      const rows = () => tables[table] ?? [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (...args: unknown[]) => {
          write?.filters.push(["eq", ...args]);
          return chain;
        },
        neq: (...args: unknown[]) => {
          write?.filters.push(["neq", ...args]);
          return chain;
        },
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        update: (payload: Row) => {
          write = { table, op: "update", payload, filters: [] };
          writes.push(write);
          return chain;
        },
        single: async () => ({
          data: rows()[0] ?? null,
          error: rows()[0] ? null : { message: "not found" }
        }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        // biome-ignore lint/suspicious/noThenProperty: awaited like a PostgREST builder
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: write ? [{ id: "x" }] : rows(), error: null })
      };
      return chain;
    },
    functions: {
      invoke: async (name: string, { body }: { body: Row }) => {
        invokes.push({ name, body });
        return functions[name] ?? { data: { id: "new1" }, error: null };
      }
    }
  };
  return { client: client as never, writes, invokes };
}

const inventoryPermissions = (actions: ("create" | "update")[]) => ({
  inventory: {
    view: ["c1"],
    create: actions.includes("create") ? ["c1"] : [],
    update: actions.includes("update") ? ["c1"] : [],
    delete: []
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  boundary.serviceRole = null;
  boundary.violations = [];
  boundary.raiseMoment = vi.fn();
  claims.current = {
    permissions: inventoryPermissions(["create", "update"]),
    role: "employee"
  };
});

describe("permission gate", () => {
  it("refuses a post without inventory update before touching the service role", async () => {
    claims.current.permissions = inventoryPermissions(["create"]);
    const { client } = fakeClient({});
    await expect(
      postReceipt(client, "c1", "u1", { receiptId: "r1" })
    ).rejects.toThrow(
      "You do not have permission to post receipts (inventory update)."
    );
  });

  it("refuses a create without inventory create", async () => {
    claims.current.permissions = inventoryPermissions(["update"]);
    const { client } = fakeClient({});
    await expect(
      createShipment(client, "c1", "u1", {
        sourceDocument: "Sales Order",
        sourceDocumentId: "so1"
      })
    ).rejects.toThrow("(inventory create)");
  });
});

describe("inventory_postReceipt", () => {
  it("refuses a voided receipt with no write and no posting", async () => {
    const service = fakeClient({
      receiptLine: [],
      receipt: [{ sourceDocument: "Purchase Order", status: "Voided" }]
    });
    boundary.serviceRole = service.client;
    const caller = fakeClient({});
    const result = await postReceipt(caller.client, "c1", "u1", {
      receiptId: "r1"
    });
    expect(result.error).toEqual({
      code: SERVICE_RULE_ERROR_CODE,
      message: "Cannot post a voided receipt"
    });
    expect(caller.writes).toEqual([]);
    expect(service.invokes).toEqual([]);
  });

  it("returns warnings as an error that says how to acknowledge them, then posts when acknowledged", async () => {
    boundary.violations = [
      { ruleId: "rule1", severity: "warn", message: "Bin is over capacity" }
    ];
    const tables = {
      receiptLine: [],
      receipt: [{ sourceDocument: "Purchase Order", status: "Draft" }]
    };
    const service = fakeClient(tables);
    boundary.serviceRole = service.client;
    const caller = fakeClient({});

    const blocked = await postReceipt(caller.client, "c1", "u1", {
      receiptId: "r1"
    });
    expect(blocked.error?.message).toContain("[warn] Bin is over capacity");
    expect(blocked.error?.message).toContain("acknowledged: true");
    expect(caller.writes).toEqual([]);
    expect(service.invokes).toEqual([]);

    const posted = await postReceipt(caller.client, "c1", "u1", {
      receiptId: "r1",
      acknowledged: true
    });
    expect(posted).toEqual({
      data: { status: "posted", warning: null },
      error: null
    });
    expect(caller.writes[0].payload).toEqual({ status: "Pending" });
    expect(service.invokes.map((i) => i.name)).toEqual(["post-receipt"]);
    expect(service.invokes[0].body).toEqual({
      receiptId: "r1",
      userId: "u1",
      companyId: "c1"
    });
  });

  it("does not let acknowledged override a rule error", async () => {
    boundary.violations = [
      { ruleId: "rule1", severity: "error", message: "Wrong bin" }
    ];
    boundary.serviceRole = fakeClient({
      receipt: [{ sourceDocument: "Purchase Order", status: "Draft" }]
    }).client;
    const result = await postReceipt(fakeClient({}).client, "c1", "u1", {
      receiptId: "r1",
      acknowledged: true
    });
    expect(result.error?.message).toContain("Resolve the errors");
  });

  it("puts the receipt back to Draft and reports the edge function's reason when posting fails", async () => {
    const failure = {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(
        JSON.stringify({ message: "Accounting period is closed" }),
        { status: 400 }
      )
    };
    const service = fakeClient(
      { receipt: [{ sourceDocument: "Purchase Order", status: "Draft" }] },
      { "post-receipt": { data: null, error: failure } }
    );
    boundary.serviceRole = service.client;
    const caller = fakeClient({});
    const result = await postReceipt(caller.client, "c1", "u1", {
      receiptId: "r1"
    });
    expect(result.error?.message).toBe(
      "Failed to post receipt: Accounting period is closed"
    );
    expect(caller.writes.map((w) => w.payload.status)).toEqual([
      "Pending",
      "Draft"
    ]);
    // A posting that never happened fires no workflow moment.
    expect(boundary.raiseMoment).not.toHaveBeenCalled();
  });
});

describe("inventory_voidReceipt", () => {
  it.each([
    [{ status: "Draft", invoiced: false }, "Can only void posted receipts"],
    [
      { status: "Posted", invoiced: true },
      "Cannot void a receipt created by a purchase invoice. Void the invoice instead."
    ]
  ])("refuses %o", async (receipt, reason) => {
    const service = fakeClient({});
    boundary.serviceRole = service.client;
    const result = await voidReceipt(
      fakeClient({ receipt: [receipt] }).client,
      "c1",
      "u1",
      { receiptId: "r1" }
    );
    expect(result.error?.message).toBe(`Failed to void receipt: ${reason}`);
    expect(service.invokes).toEqual([]);
  });

  it("voids a Posted receipt through post-receipt", async () => {
    const service = fakeClient({});
    boundary.serviceRole = service.client;
    const result = await voidReceipt(
      fakeClient({ receipt: [{ status: "Posted", invoiced: false }] }).client,
      "c1",
      "u1",
      { receiptId: "r1" }
    );
    expect(result).toEqual({ data: { id: "r1" }, error: null });
    expect(service.invokes).toEqual([
      {
        name: "post-receipt",
        body: { type: "void", receiptId: "r1", userId: "u1", companyId: "c1" }
      }
    ]);
  });
});

describe("create from source", () => {
  it("refuses a sales order shipment without a default location, as the Ship button does", async () => {
    const service = fakeClient({});
    boundary.serviceRole = service.client;
    const result = await createShipment(
      fakeClient({ userDefaults: [] }).client,
      "c1",
      "u1",
      { sourceDocument: "Sales Order", sourceDocumentId: "so1" }
    );
    expect(result.error?.message).toBe(
      "Set a default location in your settings before creating a shipment"
    );
    expect(service.invokes).toEqual([]);
  });

  it("creates a sales order shipment at the default location", async () => {
    const service = fakeClient({});
    boundary.serviceRole = service.client;
    const result = await createShipment(
      fakeClient({ userDefaults: [{ locationId: "loc1" }] }).client,
      "c1",
      "u1",
      { sourceDocument: "Sales Order", sourceDocumentId: "so1" }
    );
    expect(result).toEqual({
      data: { id: "new1", existing: false },
      error: null
    });
    expect(service.invokes[0]).toEqual({
      name: "create",
      body: {
        type: "shipmentFromSalesOrder",
        companyId: "c1",
        locationId: "loc1",
        salesOrderId: "so1",
        shipmentId: undefined,
        userId: "u1"
      }
    });
  });

  it("returns the open Draft receipt of a sales return order instead of a second one", async () => {
    const service = fakeClient({});
    boundary.serviceRole = service.client;
    const result = await createReceipt(
      fakeClient({ userDefaults: [], receipt: [{ id: "r-open" }] }).client,
      {
        companyId: "c1",
        userId: "u1",
        sourceDocument: "Sales Return Order",
        sourceDocumentId: "sro1"
      }
    );
    expect(result).toEqual({
      data: { id: "r-open", existing: true },
      error: null
    });
    expect(service.invokes).toEqual([]);
  });
});

describe("inventory_postShipment", () => {
  it("refuses expired batches under the Block policy before the Pending flip", async () => {
    const service = fakeClient({
      shipmentLine: [],
      shipment: [
        { sourceDocument: "Sales Order", sourceDocumentId: null, locationId: null }
      ],
      companySettings: [{ inventoryShelfLife: { expiredEntityPolicy: "Block" } }],
      trackedEntity: [
        { id: "te1", readableId: "LOT-7", expirationDate: "2020-01-01" }
      ]
    });
    boundary.serviceRole = service.client;
    const caller = fakeClient({});
    const result = await postShipment(caller.client, "c1", "u1", {
      shipmentId: "s1"
    });
    expect(result.error?.message).toBe(
      "Cannot post shipment with expired batch: LOT-7"
    );
    expect(caller.writes).toEqual([]);
    expect(service.invokes).toEqual([]);
  });

  it("posts under the Warn policy and names the expired batch", async () => {
    const service = fakeClient({
      shipmentLine: [],
      shipment: [
        { sourceDocument: "Sales Order", sourceDocumentId: null, locationId: null }
      ],
      companySettings: [{ inventoryShelfLife: { expiredEntityPolicy: "Warn" } }],
      trackedEntity: [
        { id: "te1", readableId: "LOT-7", expirationDate: "2020-01-01" }
      ]
    });
    boundary.serviceRole = service.client;
    const result = await postShipment(fakeClient({}).client, "c1", "u1", {
      shipmentId: "s1"
    });
    expect(result).toEqual({
      data: {
        status: "posted",
        warning: "Posted shipment with expired batch: LOT-7"
      },
      error: null
    });
    expect(service.invokes.map((i) => i.body.type)).toEqual(["post"]);
  });
});
