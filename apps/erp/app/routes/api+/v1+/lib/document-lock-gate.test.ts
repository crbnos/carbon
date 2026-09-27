// The document-lock gate's decisions, pinned against REAL manifest entries.
//
// The only stub is the database boundary: an in-memory `LockReader` holding
// the rows a company has. Everything between the manifest entry and that read
// — positional-arg resolution, FK walks, create/update detection, predicates,
// messages, the inline delete rules — runs for real.

import type { ManifestEntry } from "@carbon/api";
import { describe, expect, it, vi } from "vitest";
import toolMetadataJson from "../../mcp+/lib/tool-metadata.json";
import {
  changedFrozenField,
  evaluateDocumentLocks,
  type LockReader,
  purchaseOrderDeleteVerdict,
  type Row
} from "./document-lock-rules";

// The lock predicates come from the modules' `*.models.ts`, whose barrels
// reach catalog code written with lingui's `msg` macro; vitest runs without
// the lingui plugin, so give that macro a stand-in.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    id: String.raw({ raw: strings }, ...values)
  })
}));

const manifest = new Map(
  (toolMetadataJson as unknown as { tools: ManifestEntry[] }).tools.map((t) => [
    t.name,
    t
  ])
);

function entry(name: string): ManifestEntry {
  const meta = manifest.get(name);
  if (!meta) throw new Error(`${name} is not in the manifest`);
  return meta;
}

const CLIENT = { __client: true };

/** Positional args for `name`, filled from `values` by param name. */
function argsFor(name: string, values: Record<string, unknown>): unknown[] {
  return entry(name).serviceParams.map((param) =>
    param === "client" || param === "db" ? CLIENT : values[param]
  );
}

type Tables = Record<string, Row[]>;

/** The company's rows, read the way the production reader reads them. */
function reader(
  tables: Tables,
  extra: Partial<Omit<LockReader, "select">> = {}
): LockReader {
  return {
    async select(table, columns, values, column = "id") {
      return (tables[table] ?? [])
        .filter((row) => values.includes(row[column] as string))
        .map((row) =>
          Object.fromEntries(columns.map((c) => [c, row[c] ?? null]))
        );
    },
    revisionLock: async () => ({ ok: true, warn: false }),
    methodOperationDraftError: async () => null,
    purchaseOrderApproval: async () => null,
    ...extra
  };
}

/** A reader that fails the test if the gate reads anything at all. */
const untouchable: LockReader = {
  select: async () => {
    throw new Error("an ungated operation must not read");
  },
  revisionLock: async () => {
    throw new Error("an ungated operation must not read");
  },
  methodOperationDraftError: async () => {
    throw new Error("an ungated operation must not read");
  },
  purchaseOrderApproval: async () => {
    throw new Error("an ungated operation must not read");
  }
};

async function run(
  name: string,
  values: Record<string, unknown>,
  db: LockReader
): Promise<string | null> {
  return evaluateDocumentLocks(entry(name), argsFor(name, values), db);
}

describe("header status locks", () => {
  const orders = reader({
    salesOrder: [
      { id: "so_open", status: "Draft" },
      { id: "so_locked", status: "To Ship and Invoice" }
    ],
    salesOrderLine: [
      { id: "sol_open", salesOrderId: "so_open" },
      { id: "sol_locked", salesOrderId: "so_locked" }
    ]
  });

  it("refuses a new line on a locked order with the add-line message", async () => {
    expect(
      await run(
        "sales_upsertSalesOrderLine",
        { salesOrderLine: { salesOrderId: "so_locked", itemId: "item_1" } },
        orders
      )
    ).toBe("Cannot add lines to a locked sales order. Reopen it first.");
  });

  it("refuses a line edit resolved through the line's own order", async () => {
    // No salesOrderId in the payload: the header comes from the line row.
    expect(
      await run(
        "sales_upsertSalesOrderLine",
        { salesOrderLine: { id: "sol_locked", description: "edited" } },
        orders
      )
    ).toBe("Cannot modify a locked sales order. Reopen it first.");
  });

  it("refuses moving a line of an open order onto a locked one", async () => {
    expect(
      await run(
        "sales_upsertSalesOrderLine",
        { salesOrderLine: { id: "sol_open", salesOrderId: "so_locked" } },
        orders
      )
    ).not.toBeNull();
  });

  it("lets writes to an unlocked order through", async () => {
    expect(
      await run(
        "sales_upsertSalesOrderLine",
        { salesOrderLine: { id: "sol_open", salesOrderId: "so_open" } },
        orders
      )
    ).toBeNull();
  });

  it("refuses an id-only line delete on a locked quote", async () => {
    const quotes = reader({
      quote: [{ id: "q_sent", status: "Sent" }],
      quoteLine: [{ id: "ql_1", quoteId: "q_sent" }]
    });
    expect(
      await run("sales_deleteQuoteLine", { quoteLineId: "ql_1" }, quotes)
    ).toBe("Cannot modify a locked quote. Reopen it first.");
  });

  it("leaves the writes the UI allows on a locked document ungated", async () => {
    // Status transitions (reopen included) and deleteSalesOrder carry no route
    // guard, so the gate must not read, let alone refuse.
    for (const [name, values] of [
      [
        "sales_updateSalesOrderStatus",
        { update: { id: "so_locked", status: "Draft" } }
      ],
      ["sales_deleteSalesOrder", { salesOrderId: "so_locked" }]
    ] as const) {
      expect(await run(name, values, untouchable)).toBeNull();
    }
  });

  it("refuses a bulk write when ANY touched document is locked", async () => {
    const notices = reader({
      changeOrder: [
        { id: "co_open", status: "Draft" },
        { id: "co_done", status: "Done" }
      ],
      changeOrderActionTask: [
        { id: "task_open", changeOrderId: "co_open" },
        { id: "task_done", changeOrderId: "co_done" }
      ]
    });
    expect(
      await run(
        "items_updateChangeNoticeActionOrder",
        {
          changeNoticeId: "co_open",
          updates: [
            { id: "task_open", sortOrder: 1 },
            { id: "task_done", sortOrder: 2 }
          ]
        },
        notices
      )
    ).toBe("This change notice is closed, so its changes are read-only.");
  });

  it("gates only production-quantity creates, as the ERP routes do", async () => {
    const jobs = reader({
      job: [{ id: "job_closed", status: "Cancelled" }],
      jobOperation: [{ id: "op_1", jobId: "job_closed" }]
    });
    expect(
      await run(
        "production_upsertProductionQuantity",
        {
          productionQuantity: {
            jobOperationId: "op_1",
            type: "Production",
            quantity: 1
          }
        },
        jobs
      )
    ).toBe("Cannot modify a locked job. Reopen it first.");
    // The edit route ($jobId.quantities.$id) carries no guard.
    expect(
      await run(
        "production_upsertProductionQuantity",
        {
          productionQuantity: {
            id: "pq_1",
            jobOperationId: "op_1",
            type: "Production",
            quantity: 5
          }
        },
        jobs
      )
    ).toBeNull();
  });

  it("lets the fields the inline editor changes on a locked invoice through", async () => {
    const invoices = reader({
      purchaseInvoice: [{ id: "pi_1", status: "Open" }]
    });
    expect(
      await run(
        "invoicing_updatePurchaseInvoice",
        { input: { id: "pi_1", dateDue: "2026-10-01" } },
        invoices
      )
    ).toBeNull();
    expect(
      await run(
        "invoicing_updatePurchaseInvoice",
        { input: { id: "pi_1", supplierReference: "INV-9" } },
        invoices
      )
    ).toBe("Cannot modify a confirmed purchase invoice.");
  });

  it("picks the change-notice scope from the fields written", async () => {
    const notices = reader({
      changeOrder: [
        { id: "co_impl", status: "Implementation" },
        { id: "co_done", status: "Done" }
      ]
    });
    // Engineering content is frozen from Implementation onward …
    expect(
      await run(
        "items_updateChangeNotice",
        { input: { id: "co_impl", reasonForChange: { type: "doc" } } },
        notices
      )
    ).toBe(
      "This change notice is being implemented, so its changes are locked. Reopen it to make changes."
    );
    // … header fields only once the notice is closed.
    expect(
      await run(
        "items_updateChangeNotice",
        { input: { id: "co_impl", name: "Renamed" } },
        notices
      )
    ).toBeNull();
    expect(
      await run(
        "items_updateChangeNotice",
        { input: { id: "co_done", name: "Renamed" } },
        notices
      )
    ).toBe("Cannot modify a completed change notice.");
  });

  it("gates only payment edits, never creates", async () => {
    const payments = reader({ payment: [{ id: "pay_1", status: "Posted" }] });
    expect(
      await run(
        "invoicing_upsertPayment",
        { payment: { id: "pay_1", totalAmount: 10 } },
        payments
      )
    ).toBe("Only draft payments can be edited");
    expect(
      await run(
        "invoicing_upsertPayment",
        { payment: { paymentType: "Receipt", totalAmount: 10 } },
        payments
      )
    ).toBeNull();
  });
});

describe("make-method locks", () => {
  const steps = {
    methodOperationStep: [{ id: "step_1", operationId: "mop_1" }]
  };

  it("refuses when checkRevisionLock refuses, with its message", async () => {
    const locked = reader(
      {},
      {
        revisionLock: async (kind, id) =>
          kind === "operation" && id === "mop_1"
            ? {
                ok: false,
                warn: false,
                message:
                  "This change notice is being implemented, so its changes are locked. Reopen it to make changes."
              }
            : { ok: true, warn: false }
      }
    );
    expect(
      await run(
        "items_deleteMethodOperation",
        { methodOperationId: "mop_1" },
        locked
      )
    ).toMatch(/being implemented/);
  });

  it("proceeds on a warn verdict, as the routes proceed and flash", async () => {
    const warn = reader(
      {},
      {
        revisionLock: async () => ({
          ok: true,
          warn: true,
          message: "This revision is released (Production)."
        })
      }
    );
    expect(
      await run(
        "items_deleteMethodOperation",
        { methodOperationId: "mop_1" },
        warn
      )
    ).toBeNull();
  });

  it("applies the Draft-version rule to a step resolved from its id", async () => {
    const active = reader(steps, {
      methodOperationDraftError: async (operationId) =>
        operationId === "mop_1"
          ? 'Cannot modify steps on a method version with status "Active". Only Draft versions can be modified.'
          : null
    });
    expect(
      await run("items_deleteMethodOperationStep", { id: "step_1" }, active)
    ).toMatch(/status "Active"/);
    expect(
      await run(
        "items_upsertMethodOperationStep",
        {
          methodOperationStep: {
            operationId: "mop_1",
            name: "Torque",
            description: "",
            type: "Task"
          }
        },
        active
      )
    ).toMatch(/Only Draft versions/);
  });
});

describe("inline route guards", () => {
  it("refuses deleting a posted receipt and allows a draft one", async () => {
    const db = reader({
      receipt: [
        { id: "rc_posted", postingDate: "2026-09-01" },
        { id: "rc_draft", postingDate: null }
      ]
    });
    expect(
      await run("inventory_deleteReceipt", { receiptId: "rc_posted" }, db)
    ).toBe("Cannot delete a posted receipt");
    expect(
      await run("inventory_deleteReceipt", { receiptId: "rc_draft" }, db)
    ).toBeNull();
  });

  it("refuses deleting a posted inventory count", async () => {
    const db = reader({ inventoryCount: [{ id: "ic_1", status: "Posted" }] });
    expect(
      await run("inventory_deleteInventoryCount", { id: "ic_1" }, db)
    ).toBe("Cannot delete a posted count. Roll it back instead.");
  });

  it("allows return-order deletes only for Draft/Cancelled with nothing received", async () => {
    const db = reader({
      salesReturnOrder: [
        { id: "rma_open", status: "To Receive" },
        { id: "rma_cancelled", status: "Cancelled" },
        { id: "rma_draft", status: "Draft" }
      ],
      salesReturnOrderLine: [
        { id: "l1", salesReturnOrderId: "rma_cancelled", quantityReceived: 2 },
        { id: "l2", salesReturnOrderId: "rma_draft", quantityReceived: 0 }
      ]
    });
    const del = (id: string) =>
      run("sales_deleteSalesReturnOrder", { salesReturnOrderId: id }, db);
    expect(await del("rma_open")).toBe(
      "Only draft or cancelled return orders can be deleted. Cancel the order first."
    );
    expect(await del("rma_cancelled")).toBe(
      "Cannot delete a return order with received quantity"
    );
    expect(await del("rma_draft")).toBeNull();
  });

  it("applies the return-line rules after confirmation", async () => {
    const db = reader({
      salesReturnOrder: [{ id: "rma_1", status: "To Receive" }],
      salesReturnOrderLine: [
        {
          id: "line_1",
          salesReturnOrderId: "rma_1",
          quantity: 1,
          itemId: "item_1",
          unitPrice: 10,
          restockFeePercent: 0,
          unitOfMeasureCode: "EA"
        }
      ]
    });
    const upsert = (line: Row) =>
      run("sales_upsertSalesReturnOrderLine", { line }, db);

    expect(
      await upsert({
        salesReturnOrderId: "rma_1",
        itemId: "item_1",
        quantity: 1
      })
    ).toBe("Lines can only be added while the return order is Draft");
    expect(await upsert({ id: "line_1", quantity: 999 })).toBe(
      "Quantity is locked after confirmation"
    );
    // Re-sending the stored values, or editing an unfrozen field, passes.
    expect(
      await upsert({ id: "line_1", quantity: 1, returnReasonId: "rr_1" })
    ).toBeNull();
  });

  it("mirrors the purchase-order delete rules", () => {
    expect(purchaseOrderDeleteVerdict("Draft", null)).toBeNull();
    expect(purchaseOrderDeleteVerdict("To Receive", null)).toMatch(
      /Cannot delete purchase order with status "To Receive"/
    );
    expect(
      purchaseOrderDeleteVerdict("Needs Approval", {
        isRequester: true,
        isApprover: false
      })
    ).toBeNull();
    expect(
      purchaseOrderDeleteVerdict("Needs Approval", {
        isRequester: false,
        isApprover: true
      })
    ).toBe(
      "Approvers cannot delete purchase orders. Please reject the approval request instead."
    );
    expect(
      purchaseOrderDeleteVerdict("Needs Approval", {
        isRequester: false,
        isApprover: false
      })
    ).toBe(
      "Only the requester can delete a purchase order that needs approval"
    );
  });

  it("counts a frozen field as changed only when provided and different", () => {
    const fields = [{ label: "Quantity", key: "quantity", numeric: true }];
    expect(changedFrozenField({}, { quantity: 3 }, fields)).toBeNull();
    expect(
      changedFrozenField({ quantity: "3" }, { quantity: 3 }, fields)
    ).toBeNull();
    expect(changedFrozenField({ quantity: 4 }, { quantity: 3 }, fields)).toBe(
      "Quantity"
    );
  });
});
