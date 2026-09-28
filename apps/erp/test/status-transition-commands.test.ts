import { beforeEach, describe, expect, it, vi } from "vitest";

// The status transition commands shared by the UI routes and the MCP
// wrappers. Each case is a step the bare status writer skipped over MCP. The
// Supabase client is the stubbed boundary: reads answer from a table map and
// every write is recorded, so the assertions are on what reaches the
// database. Engines behind other boundaries (the NCR close engine, storage
// rules, company settings) answer with fixed values.

const m = vi.hoisted(() => ({
  SERVICE_ROLE: null as unknown,
  closeIssue: vi.fn(),
  notifyIssueStatusChanged: vi.fn(),
  evaluateLinesForSurface: vi.fn(),
  getCompanySettings: vi.fn(),
  cancelSalesOrder: vi.fn(),
  trackWorkEvent: vi.fn()
}));

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => m.SERVICE_ROLE
}));
vi.mock("@carbon/auth", () => ({ ERP_URL: "https://erp.test" }));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));
vi.mock("@carbon/lib/telemetry", () => ({ trackWorkEvent: m.trackWorkEvent }));
vi.mock("@carbon/ee/rules.server", async () => {
  const violations = await import("../../../packages/ee/src/rules/violations");
  return {
    evaluateLinesForSurface: m.evaluateLinesForSurface,
    isBlocked: violations.isBlocked
  };
});
vi.mock("@carbon/ee/notifications", () => ({
  notifyIssueStatusChanged: m.notifyIssueStatusChanged
}));
vi.mock("~/modules/settings/settings.server", () => ({
  getCompanyIntegrations: vi.fn(async () => [])
}));
vi.mock("~/modules/settings/settings.service", () => ({
  getCompanySettings: m.getCompanySettings
}));
vi.mock("~/modules/quality/quality-disposition.server", () => ({
  closeIssue: m.closeIssue
}));
vi.mock("~/utils/path", () => ({
  path: { to: { issue: (id: string) => `/x/issue/${id}` } }
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({})
}));
// Model files pull the Lingui macro graph; the commands only need these.
vi.mock("~/modules/inventory/inventory.models", () => ({
  isPickingListLocked: (status: string | null | undefined) =>
    status === "Completed" || status === "Cancelled" || status === "Partial"
}));
vi.mock("~/modules/sales/sales.models", () => ({
  salesReturnDispositionType: [
    "Pending",
    "Return to Customer",
    "Rework",
    "Scrap",
    "Use As Is"
  ]
}));
vi.mock("~/modules/sales/sales.service", () => ({
  cancelSalesOrder: m.cancelSalesOrder,
  setSalesReturnOrderLineDisposition: vi.fn(async () => ({
    data: { id: "line-1" },
    error: null
  })),
  updateSalesOrderStatus: vi.fn(async () => ({ data: null, error: null }))
}));
vi.mock("~/modules/quality/quality.service", async () => ({
  updateIssueStatus: (client: any, update: any) =>
    client.from("nonConformance").update(update).eq("id", update.id)
}));
vi.mock("~/modules/inventory/inventory.service", async () => ({
  getInventoryCount: (client: any, id: string, companyId: string) =>
    client
      .from("inventoryCount")
      .select("*")
      .eq("id", id)
      .eq("companyId", companyId)
      .single(),
  updateInventoryCountStatus: (client: any, args: any) =>
    client
      .from("inventoryCount")
      .update({ status: args.status, updatedBy: args.updatedBy })
      .eq("id", args.id)
      .eq("status", args.expectedStatus)
      .select("id")
      .single(),
  getUnresolvedPickingListLines: async (client: any, id: string) => {
    const { data } = await client
      .from("pickingListLine")
      .select("*")
      .eq("pickingListId", id);
    const lines = (data ?? []) as {
      status: string;
      quantityToPick: number;
      quantityPicked: number;
      itemName: string;
    }[];
    return {
      unresolved: lines.filter(
        (l) => l.status !== "Short" && l.quantityPicked < l.quantityToPick
      ),
      hasShort: lines.some((l) => l.status === "Short"),
      error: null
    };
  },
  updatePickingListStatus: (
    client: any,
    id: string,
    status: string,
    updatedBy: string
  ) => client.from("pickingList").update({ status, updatedBy }).eq("id", id),
  updateStockTransferStatus: (client: any, args: any) =>
    client
      .from("stockTransfer")
      .update({
        status: args.status,
        assignee: args.assignee,
        completedAt: args.completedAt,
        updatedBy: args.updatedBy
      })
      .eq("id", args.id)
}));

import {
  transitionInventoryCountStatus,
  transitionPickingListStatus,
  transitionStockTransferStatus
} from "~/modules/inventory/inventory-transitions.server";
import { transitionIssueStatus } from "~/modules/quality/quality-transitions.server";
import {
  setReturnLineDispositionFromPicker,
  transitionSalesOrderStatus
} from "~/modules/sales/sales-transitions.server";

type Write = { table: string; op: string; payload: unknown };

/** A Supabase client stub: reads answer from `tables`, writes are recorded. */
function makeClient(tables: Record<string, unknown>) {
  const writes: Write[] = [];
  const client = {
    writes,
    from(table: string) {
      const rows = tables[table];
      const one = Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
      const many = Array.isArray(rows) ? rows : rows ? [rows] : [];
      const result = () => ({ data: many, error: null, count: many.length });
      const q: Record<string, any> = {};
      for (const name of ["select", "eq", "in", "limit", "order", "neq"]) {
        q[name] = () => q;
      }
      for (const op of ["update", "insert", "upsert", "delete"]) {
        q[op] = (payload?: unknown) => {
          writes.push({ table, op, payload });
          return q;
        };
      }
      q.single = async () => ({ data: one, error: null });
      q.maybeSingle = async () => ({ data: one, error: null });
      q.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve);
      return q;
    }
  };
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.SERVICE_ROLE = makeClient({});
});

describe("inventory count transitions", () => {
  it("confirming refuses a count that is not Draft and writes nothing", async () => {
    const client = makeClient({ inventoryCount: { status: "Posted" } });
    const result = await transitionInventoryCountStatus(client as any, {
      id: "c1",
      companyId: "co",
      userId: "u",
      status: "Pending"
    });
    expect(result.error?.message).toBe("Only a draft count can be confirmed");
    expect(client.writes).toEqual([]);
  });

  it("reopening a Pending count writes Draft", async () => {
    const client = makeClient({ inventoryCount: { status: "Pending", id: "c1" } });
    const result = await transitionInventoryCountStatus(client as any, {
      id: "c1",
      companyId: "co",
      userId: "u",
      status: "Draft"
    });
    expect(result.error).toBeNull();
    expect(client.writes).toEqual([
      {
        table: "inventoryCount",
        op: "update",
        payload: { status: "Draft", updatedBy: "u" }
      }
    ]);
  });
});

describe("picking list transitions", () => {
  const unpicked = {
    status: "Pending",
    quantityToPick: 5,
    quantityPicked: 2,
    itemName: "Bracket"
  };

  it("finishing under the error policy refuses while lines are unpicked", async () => {
    m.getCompanySettings.mockResolvedValue({
      data: { incompletePickingListPolicy: "error" },
      error: null
    });
    const client = makeClient({
      pickingList: { status: "In Progress" },
      pickingListLine: [unpicked]
    });
    const result = await transitionPickingListStatus(client as any, {
      id: "pl",
      companyId: "co",
      userId: "u",
      status: "Completed",
      requireReopenPermission: vi.fn()
    });
    expect(result.error?.message).toBe("Can't finish — still unpicked: Bracket");
    expect(client.writes).toEqual([]);
  });

  it("finishing under the warn policy needs acknowledgement, then lands on Partial", async () => {
    m.getCompanySettings.mockResolvedValue({
      data: { incompletePickingListPolicy: "warn" },
      error: null
    });
    const tables = {
      pickingList: { status: "In Progress" },
      pickingListLine: [unpicked]
    };
    const first = await transitionPickingListStatus(
      makeClient(tables) as any,
      {
        id: "pl",
        companyId: "co",
        userId: "u",
        status: "Completed",
        requireReopenPermission: vi.fn()
      }
    );
    expect(first).toMatchObject({ needsAcknowledgement: true });

    const client = makeClient(tables);
    const second = await transitionPickingListStatus(client as any, {
      id: "pl",
      companyId: "co",
      userId: "u",
      status: "Completed",
      acknowledged: true,
      requireReopenPermission: vi.fn()
    });
    expect(second.error).toBeNull();
    expect(client.writes[0]?.payload).toEqual({
      status: "Partial",
      updatedBy: "u"
    });
  });

  it("reopening a Completed list asks for the reopen permission first", async () => {
    const requireReopenPermission = vi
      .fn()
      .mockRejectedValue(new Error("no delete"));
    const client = makeClient({ pickingList: { status: "Completed" } });
    await expect(
      transitionPickingListStatus(client as any, {
        id: "pl",
        companyId: "co",
        userId: "u",
        status: "In Progress",
        requireReopenPermission
      })
    ).rejects.toThrow("no delete");
    expect(client.writes).toEqual([]);
  });
});

describe("stock transfer transitions", () => {
  it("a blocking storage rule refuses Released unless acknowledged (warnings only)", async () => {
    m.evaluateLinesForSurface.mockResolvedValue({
      violations: [{ ruleId: "r1", severity: "warn", message: "Too heavy" }],
      ruleNames: { r1: "Weight" }
    });
    const tables = { stockTransfer: { status: "Draft" } };
    const blocked = await transitionStockTransferStatus(
      makeClient(tables) as any,
      {
        id: "st",
        companyId: "co",
        userId: "u",
        status: "Released",
        requireReopenPermission: vi.fn()
      }
    );
    expect(blocked).toMatchObject({ blocked: { ruleNames: { r1: "Weight" } } });

    const client = makeClient(tables);
    const released = await transitionStockTransferStatus(client as any, {
      id: "st",
      companyId: "co",
      userId: "u",
      status: "Released",
      acknowledged: true,
      requireReopenPermission: vi.fn()
    });
    expect(released.error).toBeNull();
    expect(client.writes[0]?.payload).toMatchObject({
      status: "Released",
      completedAt: null
    });
  });

  it("leaving Completed asks for the reopen permission", async () => {
    const requireReopenPermission = vi.fn();
    await transitionStockTransferStatus(
      makeClient({ stockTransfer: { status: "Completed" } }) as any,
      {
        id: "st",
        companyId: "co",
        userId: "u",
        status: "Draft",
        requireReopenPermission
      }
    );
    expect(requireReopenPermission).toHaveBeenCalledOnce();
  });
});

describe("issue transitions", () => {
  it("Closed runs the close engine instead of writing the status", async () => {
    m.closeIssue.mockResolvedValue({ data: { id: "ncr" }, error: null });
    const client = makeClient({});
    const result = await transitionIssueStatus(client as any, {
      id: "ncr",
      companyId: "co",
      userId: "u",
      status: "Closed"
    });
    expect(result.error).toBeNull();
    expect(m.closeIssue).toHaveBeenCalledWith(m.SERVICE_ROLE, {
      nonConformanceId: "ncr",
      companyId: "co",
      userId: "u"
    });
    expect(client.writes).toEqual([]);
  });

  it("a refused close is reported with the engine's message", async () => {
    m.closeIssue.mockResolvedValue({
      data: null,
      error: { message: "Disposition every item before closing" }
    });
    const result = await transitionIssueStatus(makeClient({}) as any, {
      id: "ncr",
      companyId: "co",
      userId: "u",
      status: "Closed"
    });
    expect(result.error?.message).toBe("Disposition every item before closing");
  });

  it("reopening a Closed NCR that posted inventory is refused", async () => {
    m.SERVICE_ROLE = makeClient({
      nonConformance: { status: "Closed" },
      itemLedger: [{ id: "led1" }]
    });
    const client = makeClient({});
    const result = await transitionIssueStatus(client as any, {
      id: "ncr",
      companyId: "co",
      userId: "u",
      status: "In Progress"
    });
    expect(result.error?.message).toMatch(/can't be reopened/);
    expect(client.writes).toEqual([]);
  });

  it("reopening a Closed NCR that posted nothing clears the close date", async () => {
    m.SERVICE_ROLE = makeClient({ nonConformance: { status: "Closed" } });
    const client = makeClient({});
    const result = await transitionIssueStatus(client as any, {
      id: "ncr",
      companyId: "co",
      userId: "u",
      status: "In Progress"
    });
    expect(result.error).toBeNull();
    expect(client.writes[0]?.payload).toMatchObject({
      status: "In Progress",
      closeDate: null
    });
  });
});

describe("sales transitions", () => {
  it("the disposition picker refuses Scrap and values outside the picker", async () => {
    const scrap = await setReturnLineDispositionFromPicker({} as any, {
      lineId: "line-1",
      companyId: "co",
      userId: "u",
      disposition: "Scrap"
    });
    expect(scrap.error?.message).toBe(
      "Scrap and Rework are set by escalating the line to an Issue"
    );
    const hold = await setReturnLineDispositionFromPicker({} as any, {
      lineId: "line-1",
      companyId: "co",
      userId: "u",
      disposition: "Hold"
    });
    expect(hold.error?.message).toMatch(/not a disposition for a customer return/);
    const ok = await setReturnLineDispositionFromPicker({} as any, {
      lineId: "line-1",
      companyId: "co",
      userId: "u",
      disposition: "Return to Customer"
    });
    expect(ok.error).toBeNull();
  });

  it("a Cancelled sales order runs the cancel flow with the chosen jobs", async () => {
    m.cancelSalesOrder.mockResolvedValue({
      success: true,
      message: "Sales order cancelled",
      cancelledJobIds: ["j1"]
    });
    const result = await transitionSalesOrderStatus({} as any, {
      id: "so",
      userId: "u",
      status: "Cancelled",
      cancelJobIds: ["j1"]
    });
    expect(m.cancelSalesOrder).toHaveBeenCalledWith(
      {},
      { id: "so", userId: "u", jobs: ["j1"] }
    );
    expect(result.data?.cancelledJobIds).toEqual(["j1"]);
  });
});
