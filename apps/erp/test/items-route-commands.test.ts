import { beforeEach, describe, expect, it, vi } from "vitest";

// Items route commands and their MCP tools: the bulk Active edit
// (`setItemActive`, with the unreleased change-notice refusal) and the
// supplier part price-break replacement (`upsertSupplierPartPrices`). Before
// these existed both writes lived only in route files, so MCP had no way to
// set price breaks and `items_updateItem` flipped `active` with no guard.

const m = vi.hoisted(() => ({
  SERVICE_ROLE: null as unknown,
  requireToolPermission: vi.fn()
}));

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => m.SERVICE_ROLE
}));
// items.server's own imports that need a server runtime (session, jobs,
// settings) or the Lingui macro transform (the module barrel); none are used
// by the code under test.
vi.mock("@carbon/auth", () => ({ error: vi.fn() }));
vi.mock("@carbon/auth/session.server", () => ({ flash: vi.fn() }));
vi.mock("@carbon/jobs", () => ({ trigger: vi.fn() }));
vi.mock("@carbon/notifications", () => ({ NotificationEvent: {} }));
vi.mock("~/modules/settings", () => ({ getCompanySettings: vi.fn() }));
vi.mock("~/utils/lockedGuard.server", () => ({ requireUnlockedBulk: vi.fn() }));
vi.mock("~/modules/items", () => ({
  activateMethodVersion: vi.fn(),
  findChangeNoticesForItem: vi.fn(),
  upsertItemSupersession: vi.fn()
}));
vi.mock("~/modules/items/items.models", () => ({
  canEditChangeNoticeEngineering: vi.fn(),
  canEditChangeNoticeWorkflow: vi.fn(),
  changeNoticeLockedMessage: vi.fn(),
  changeNoticeOpenStatuses: [],
  supersessionModes: []
}));
vi.mock("~/services/mcp-guards.server", () => ({
  requireToolPermission: m.requireToolPermission
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({})
}));

const { setItemActive } = await import("~/modules/items/items.server");

/** Answers the change-notice check's two reads; records the item write. */
function makeClient(rows: Record<string, unknown[]>) {
  const writes: { table: string; value: unknown }[] = [];
  return {
    writes,
    from(table: string) {
      const q = {
        select: () => q,
        in: () => q,
        eq: () => q,
        // biome-ignore lint/suspicious/noThenProperty: a thenable query builder
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: rows[table] ?? [], error: null }),
        update: (value: unknown) => {
          writes.push({ table, value });
          return q;
        }
      };
      return q;
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setItemActive (items_setItemActive, the bulk Active edit)", () => {
  it("refuses to activate an item an unreleased change notice created, naming it", async () => {
    m.SERVICE_ROLE = makeClient({
      item: [
        { id: "i1", readableIdWithRevision: "BRKT-100.B", changeOrderId: "co1" }
      ],
      changeOrder: [{ id: "co1", changeOrderId: "CN-0007", status: "Draft" }]
    });
    const client = makeClient({});
    const result = await setItemActive(client as never, {
      itemIds: ["i1"],
      active: true,
      companyId: "c1",
      userId: "u1"
    });
    expect(result.error?.message).toBe(
      "BRKT-100.B was created by change order CN-0007, which has not been released yet. Release the change notice to activate it."
    );
    expect(client.writes).toEqual([]);
  });

  it("deactivating never consults the change notice", async () => {
    m.SERVICE_ROLE = makeClient({
      item: [{ id: "i1", readableIdWithRevision: "X", changeOrderId: "co1" }],
      changeOrder: [{ id: "co1", changeOrderId: "CN-1", status: "Draft" }]
    });
    const client = makeClient({});
    const result = await setItemActive(client as never, {
      itemIds: ["i1"],
      active: false,
      companyId: "c1",
      userId: "u1"
    });
    expect(result.error).toBeNull();
    expect(client.writes[0]).toMatchObject({
      table: "item",
      value: { active: false, updatedBy: "u1" }
    });
  });
});

describe("upsertSupplierPartPrices (items_upsertSupplierPartPrices)", () => {
  it("refuses duplicate quantities before touching the database", async () => {
    const { upsertSupplierPartPrices } = await import(
      "~/modules/items/items.service"
    );
    const db = {
      transaction: vi.fn()
    };
    const result = await upsertSupplierPartPrices(db as never, {
      supplierPartId: "sp1",
      companyId: "c1",
      userId: "u1",
      priceBreaks: [
        { quantity: 10, unitPrice: 2 },
        { quantity: 10, unitPrice: 1.5 }
      ]
    });
    expect(result.error?.message).toBe(
      "Each price break needs a different quantity."
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("the MCP tool checks parts update before its RLS-bypassing write", async () => {
    m.requireToolPermission.mockRejectedValue(new Error("denied"));
    const { upsertSupplierPartPrices } = await import(
      "~/modules/items/items.mcp.server"
    );
    await expect(
      upsertSupplierPartPrices({} as never, "c1", "u1", {
        supplierPartId: "sp1",
        priceBreaks: []
      })
    ).rejects.toThrow("denied");
    expect(m.requireToolPermission).toHaveBeenCalledWith(
      "u1",
      "c1",
      "parts",
      "update",
      "set supplier part price breaks"
    );
  });
});
