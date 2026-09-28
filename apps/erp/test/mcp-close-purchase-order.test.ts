import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `purchasing_closePurchaseOrder` must do what the purchase order header's
// "Cancel Order" does through x+/purchase-order+/$orderId.status.tsx: gate on
// purchasing delete, cancel pending approvals, then set status Closed with the
// assignee cleared. It used to write a `closed` column the table does not
// have, so every call failed with PGRST204.

type Write = { client: string; table: string; values: unknown; filters: [string, unknown][] };

let writes: Write[] = [];
let permissions: Record<string, string[]> = {};

// purchasing.server imports the approval engine for other helpers; closing
// only uses its own update, so the engine is inert here.
vi.mock("@carbon/ee/approvals.server", () => ({
  canApproveRequest: vi.fn(),
  getLatestApprovalRequestForDocument: vi.fn()
}));
// The service graph reaches @carbon/glossary, whose Lingui `msg` macro only
// compiles under the app's Vite plugin; an inert tag loads it unchanged.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string) =>
    Array.isArray(strings) ? strings.join("") : strings
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: () => null,
  useLingui: () => ({ t: (s: unknown) => String(s) })
}));
vi.mock("@carbon/auth/users.server", () => ({
  getUserClaims: vi.fn(async () => ({ permissions, role: "employee" }))
}));
vi.mock("@carbon/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/auth")>()),
  hasPermission: (
    perms: Record<string, string[]> | undefined,
    module: string,
    action: string,
    companyId: string
  ) => Boolean(perms?.[`${module}_${action}`]?.includes(companyId))
}));

/** A client stub: reads answer `row`, writes are recorded with their filters. */
function makeClient(name: string, row: { id: string; status: string } | null) {
  return {
    from: (table: string) => ({
      select: () => {
        const q = {
          eq: () => q,
          maybeSingle: async () => ({ data: row, error: null })
        };
        return q;
      },
      update: (values: unknown) => {
        const write: Write = { client: name, table, values, filters: [] };
        writes.push(write);
        const q = {
          eq: (column: string, value: unknown) => {
            write.filters.push([column, value]);
            return q;
          },
          select: async () => ({ data: [{ id: "a1" }], error: null }),
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: null, error: null })
        };
        return q;
      }
    })
  } as never;
}

const serviceRole = makeClient("serviceRole", null);
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => serviceRole
}));

const { closePurchaseOrder } = await import(
  "~/modules/purchasing/purchasing.mcp.server"
);

beforeEach(() => {
  writes = [];
  permissions = { purchasing_delete: ["c1"], purchasing_update: ["c1"] };
});

describe("closePurchaseOrder", () => {
  it("cancels pending approvals, then closes the order with the assignee cleared", async () => {
    const client = makeClient("caller", { id: "po1", status: "To Receive" });
    const result = await closePurchaseOrder(client, "c1", "u1", {
      purchaseOrderId: "po1"
    });

    expect(result.error).toBeNull();
    expect(writes.map((w) => `${w.client}:${w.table}`)).toEqual([
      "serviceRole:approvalRequest",
      "caller:purchaseOrder"
    ]);
    expect(writes[0].values).toMatchObject({
      status: "Cancelled",
      updatedBy: "u1"
    });
    expect(writes[0].filters).toEqual([
      ["documentType", "purchaseOrder"],
      ["documentId", "po1"],
      ["companyId", "c1"],
      ["status", "Pending"]
    ]);
    expect(writes[1].values).toEqual({
      id: "po1",
      status: "Closed",
      assignee: null,
      updatedBy: "u1"
    });
  });

  it("requires purchasing delete, as the status route does for Closed", async () => {
    permissions = { purchasing_update: ["c1"] };
    const client = makeClient("caller", { id: "po1", status: "To Receive" });
    await expect(
      closePurchaseOrder(client, "c1", "u1", { purchaseOrderId: "po1" })
    ).rejects.toThrow(/purchasing delete/);
    expect(writes).toEqual([]);
  });

  it.each(["Closed", "Completed"])(
    "refuses an order that is already %s",
    async (status) => {
      const client = makeClient("caller", { id: "po1", status });
      const result = await closePurchaseOrder(client, "c1", "u1", {
        purchaseOrderId: "po1"
      });
      expect(result.error?.message).toMatch(/cannot be closed/);
      expect(writes).toEqual([]);
    }
  );

  it("reports an unknown order instead of writing", async () => {
    const client = makeClient("caller", null);
    const result = await closePurchaseOrder(client, "c1", "u1", {
      purchaseOrderId: "missing"
    });
    expect(result.error?.message).toMatch(/not found/);
    expect(writes).toEqual([]);
  });
});

describe("close tools in the published manifest", () => {
  const digest = fs.readFileSync(
    path.resolve(
      __dirname,
      "../app/routes/api+/mcp+/lib/tool-manifest.digest.json"
    ),
    "utf-8"
  );

  it("no longer publishes sales_closeSalesOrder (the sales order UI has no close action)", () => {
    expect(digest).not.toContain('"sales_closeSalesOrder"');
  });

  it("gates purchasing_closePurchaseOrder on purchasing delete", () => {
    const entry = digest
      .split("\n")
      .find((line) => line.includes('"purchasing_closePurchaseOrder"'));
    expect(entry).toContain('"permission":"purchasing:delete"');
  });
});
