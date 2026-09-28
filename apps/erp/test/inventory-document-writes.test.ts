import { describe, expect, it, vi } from "vitest";

// Receipt and shipment writes that the MCP/API surface reaches through the
// service file: the header upserts may only write the header form's fields
// (a status or posting column in the payload must never reach the row), and
// the line updates mirror the line grid's single-field save.

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

import {
  updateReceiptLines,
  updateShipmentLines,
  upsertReceipt,
  upsertShipment
} from "~/modules/inventory/inventory.service";
import { SERVICE_RULE_ERROR_CODE } from "~/utils/supabase";

type Call = { table: string; op: string; payload?: unknown; filters: unknown[] };

/** A client that records each write and its filters. */
function recordingClient() {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "", filters: [] };
      calls.push(call);
      const chain = {
        insert(payload: unknown) {
          call.op = "insert";
          call.payload = payload;
          return chain;
        },
        update(payload: unknown) {
          call.op = "update";
          call.payload = payload;
          return chain;
        },
        eq(...args: unknown[]) {
          call.filters.push(["eq", ...args]);
          return chain;
        },
        in(...args: unknown[]) {
          call.filters.push(["in", ...args]);
          return chain;
        },
        select: () => chain,
        single: async () => ({ data: { id: "r1" }, error: null }),
        // biome-ignore lint/suspicious/noThenProperty: awaited like a PostgREST builder
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: null, error: null })
      };
      return chain;
    }
  };
  return { client: client as never, calls };
}

const forged = {
  status: "Posted",
  postingDate: "2026-09-01",
  postedBy: "someone-else",
  invoiced: true
};

describe("upsertReceipt", () => {
  it("writes only the header form's fields on update", async () => {
    const { client, calls } = recordingClient();
    await upsertReceipt(client, {
      id: "r1",
      receiptId: "RE000001",
      externalDocumentId: "PACK-1",
      sourceDocumentId: "po1",
      customFields: { a: 1 },
      updatedBy: "u1",
      ...(forged as object)
    } as never);
    const payload = calls[0].payload as Record<string, unknown>;
    expect(calls[0].op).toBe("update");
    expect(payload).toMatchObject({
      receiptId: "RE000001",
      externalDocumentId: "PACK-1",
      sourceDocumentId: "po1",
      customFields: { a: 1 },
      updatedBy: "u1"
    });
    for (const key of Object.keys(forged)) {
      expect(payload, key).not.toHaveProperty(key);
    }
    expect(payload).not.toHaveProperty("id");
  });

  it("never inserts a posted receipt", async () => {
    const { client, calls } = recordingClient();
    await upsertReceipt(client, {
      receiptId: "RE000002",
      sourceDocumentId: "po1",
      companyId: "c1",
      createdBy: "u1",
      ...(forged as object)
    } as never);
    const [row] = calls[0].payload as Record<string, unknown>[];
    expect(calls[0].op).toBe("insert");
    expect(row).toMatchObject({
      receiptId: "RE000002",
      companyId: "c1",
      createdBy: "u1"
    });
    for (const key of Object.keys(forged)) {
      expect(row, key).not.toHaveProperty(key);
    }
  });
});

describe("upsertShipment", () => {
  it("writes only the header form's fields on update", async () => {
    const { client, calls } = recordingClient();
    await upsertShipment(client, {
      id: "s1",
      shipmentId: "SH000001",
      trackingNumber: "1Z999",
      sourceDocumentId: "so1",
      updatedBy: "u1",
      ...(forged as object)
    } as never);
    const payload = calls[0].payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      shipmentId: "SH000001",
      trackingNumber: "1Z999",
      updatedBy: "u1"
    });
    for (const key of Object.keys(forged)) {
      expect(payload, key).not.toHaveProperty(key);
    }
  });

  it("never inserts a posted shipment", async () => {
    const { client, calls } = recordingClient();
    await upsertShipment(client, {
      shipmentId: "SH000002",
      sourceDocumentId: "so1",
      companyId: "c1",
      createdBy: "u1",
      ...(forged as object)
    } as never);
    const [row] = calls[0].payload as Record<string, unknown>[];
    expect(row).not.toHaveProperty("status");
    expect(row).toMatchObject({ shipmentId: "SH000002", companyId: "c1" });
  });
});

describe("line updates", () => {
  it("sets receivedQuantity on the given receipt lines, company-scoped", async () => {
    const { client, calls } = recordingClient();
    await updateReceiptLines(client, {
      ids: ["l1", "l2"],
      field: "receivedQuantity",
      value: 4,
      companyId: "c1",
      updatedBy: "u1"
    });
    expect(calls[0].table).toBe("receiptLine");
    expect(calls[0].payload).toMatchObject({
      receivedQuantity: 4,
      updatedBy: "u1"
    });
    expect(calls[0].filters).toEqual([
      ["in", "id", ["l1", "l2"]],
      ["eq", "companyId", "c1"]
    ]);
  });

  it("clears a field on an empty value, as the grid does", async () => {
    const { client, calls } = recordingClient();
    await updateShipmentLines(client, {
      ids: ["l1"],
      field: "storageUnitId",
      value: "",
      companyId: "c1",
      updatedBy: "u1"
    });
    expect(calls[0].table).toBe("shipmentLine");
    expect(calls[0].payload).toMatchObject({ storageUnitId: null });
  });

  it("keeps a zero quantity (the grid sends it as the string \"0\")", async () => {
    const { client, calls } = recordingClient();
    await updateShipmentLines(client, {
      ids: ["l1"],
      field: "shippedQuantity",
      value: 0,
      companyId: "c1",
      updatedBy: "u1"
    });
    expect(calls[0].payload).toMatchObject({ shippedQuantity: 0 });
  });

  it("refuses any other column", async () => {
    const { client, calls } = recordingClient();
    const result = await updateReceiptLines(client, {
      ids: ["l1"],
      field: "unitCost" as never,
      value: 1,
      companyId: "c1",
      updatedBy: "u1"
    });
    expect(result.error).toEqual({
      code: SERVICE_RULE_ERROR_CODE,
      message: "Invalid field: unitCost"
    });
    expect(calls).toEqual([]);
  });
});
