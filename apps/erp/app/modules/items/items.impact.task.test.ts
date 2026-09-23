import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const {
  createChangeNoticeImpactTask,
  designateChangeNoticeImpactTask,
  linkChangeNoticeImpactTask,
  unlinkChangeNoticeImpactTask
} = await import("./items.service");

const companyId = "company-1";
const changeNoticeId = "change-notice-1";
const decisionId = "decision-1";
const taskId = "task-1";

const sourceAccess = {
  purchaseOrderLine: true,
  job: true,
  jobMaterial: true
};

function baseCreateInput(over: Record<string, unknown> = {}) {
  return {
    companyId,
    userId: "user-1",
    sourceAccess,
    changeNoticeId,
    targetType: "purchaseOrderLine" as const,
    targetId: "purchase-order-line-1",
    decision: {
      decisionId,
      targetType: "purchaseOrderLine" as const,
      targetId: "purchase-order-line-1"
    },
    task: {
      name: "Call supplier",
      notes: { summary: "Confirm old-revision production" },
      assignee: "buyer-1",
      dueDate: "2026-09-01"
    },
    ...over
  };
}

function baseRelationshipInput(over: Record<string, unknown> = {}) {
  return {
    companyId,
    userId: "user-1",
    sourceAccess,
    changeNoticeId,
    decisionId,
    targetType: "purchaseOrderLine" as const,
    targetId: "purchase-order-line-1",
    actionTaskId: taskId,
    ...over
  };
}

type Row = Record<string, unknown>;
type RecordedQuery = {
  table: string;
  values: unknown;
};

type TaskDbOptions = {
  changeNoticeStatus?: string;
  decisionStatus?: string;
  taskOrigin?: string;
  hasLink?: boolean;
  failOnInsertTable?: string;
  failOnUpdateTable?: string;
  failOnDeleteTable?: string;
};

function makeTaskDb(options: TaskDbOptions = {}) {
  const rows: Record<string, Row[]> = {
    changeOrder: [
      {
        id: changeNoticeId,
        companyId,
        status: options.changeNoticeStatus ?? "Implementation"
      }
    ],
    changeOrderImpactDecision: [
      {
        id: decisionId,
        companyId,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "purchase-order-line-1",
        decisionStatus: options.decisionStatus ?? "Action required",
        noActionReasonCode: null,
        rationale: "Supplier confirmation is required.",
        resolutionNote: null,
        assessmentSnapshot: { schema: "po-line-impact-v1" }
      }
    ],
    changeOrderActionTask: [
      {
        id: taskId,
        companyId,
        changeOrderId: changeNoticeId,
        taskOrigin: options.taskOrigin ?? "Manual",
        actionTypeId: "action-type-1",
        sortOrder: 2
      }
    ],
    changeOrderImpactDecisionActionTask: options.hasLink
      ? [
          {
            decisionId,
            actionTaskId: taskId,
            companyId
          }
        ]
      : [],
    changeOrderImpactDecisionHistory: [],
    purchaseOrderLine: [
      {
        id: "purchase-order-line-1",
        companyId,
        purchaseOrderId: "purchase-order-1",
        itemId: "item-1",
        purchaseOrderLineType: "Part",
        purchaseQuantity: 10,
        quantityReceived: 2,
        quantityToReceive: 8,
        receivedComplete: false,
        purchaseUnitOfMeasureCode: "BOX",
        inventoryUnitOfMeasureCode: "EA",
        conversionFactor: 2,
        requiredDate: "2026-08-25",
        promisedDate: null
      }
    ],
    purchaseOrder: [
      {
        id: "purchase-order-1",
        companyId,
        supplierId: "supplier-1",
        status: "To Receive"
      }
    ],
    purchaseOrderDelivery: [
      {
        id: "purchase-order-1",
        companyId,
        receiptPromisedDate: null
      }
    ],
    item: [
      {
        id: "item-1",
        companyId,
        readableId: "PART-1",
        readableIdWithRevision: "PART-1 Rev A",
        name: "Part",
        revision: "A"
      }
    ],
    changeOrderAffectedItem: [
      {
        id: "affected-item-1",
        companyId,
        changeOrderId: changeNoticeId,
        itemId: "item-1"
      }
    ]
  };

  const inserts: RecordedQuery[] = [];
  const updates: RecordedQuery[] = [];
  const deletes: RecordedQuery[] = [];
  const lockedTables: string[] = [];
  let committed = false;
  let rolledBack = false;

  const matches = (
    row: Row,
    predicates: Array<{ column: string; operator: string; value: unknown }>
  ) =>
    predicates.every(({ column, operator, value }) => {
      if (operator === "=") return row[column] === value;
      if (operator === "in") {
        return Array.isArray(value) && value.includes(row[column]);
      }
      if (operator === "is") return row[column] === value;
      return false;
    });

  const makeBuilder = (
    table: string,
    kind: "select" | "insert" | "update" | "delete"
  ) => {
    const predicates: Array<{
      column: string;
      operator: string;
      value: unknown;
    }> = [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      where: (column: string, operator: string, value: unknown) => {
        predicates.push({ column, operator, value });
        return builder;
      },
      orderBy: () => builder,
      forUpdate: () => {
        lockedTables.push(table);
        return builder;
      },
      returning: () => builder,
      values: (values: unknown) => {
        inserts.push({ table, values });
        return builder;
      },
      set: (values: unknown) => {
        updates.push({ table, values });
        return builder;
      },
      executeTakeFirst: async () => {
        if (kind === "insert") {
          if (options.failOnInsertTable === table) {
            throw new Error(`insert failed: ${table}`);
          }
          return insertResult(table);
        }
        if (kind === "update") {
          if (options.failOnUpdateTable === table) {
            throw new Error(`update failed: ${table}`);
          }
          const result = updateRows(table, predicates, updates.at(-1)?.values);
          return result ? { numUpdatedRows: 1 } : null;
        }
        if (kind === "delete") {
          if (options.failOnDeleteTable === table) {
            throw new Error(`delete failed: ${table}`);
          }
          return deleteRows(table, predicates);
        }
        const row = rows[table]?.find((candidate) =>
          matches(candidate, predicates)
        );
        return row ? { ...row } : null;
      },
      executeTakeFirstOrThrow: async () => {
        if (options.failOnInsertTable === table) {
          throw new Error(`insert failed: ${table}`);
        }
        return insertResult(table);
      },
      execute: async () => {
        if (kind === "insert") {
          if (options.failOnInsertTable === table) {
            throw new Error(`insert failed: ${table}`);
          }
          persistInsertedRows(table, inserts.at(-1)?.values);
          return { numInsertedOrUpdatedRows: 1 };
        }
        if (kind === "update") {
          if (options.failOnUpdateTable === table) {
            throw new Error(`update failed: ${table}`);
          }
          const result = updateRows(table, predicates, updates.at(-1)?.values);
          return result ? { numUpdatedRows: 1 } : { numUpdatedRows: 0 };
        }
        if (kind === "delete") {
          if (options.failOnDeleteTable === table) {
            throw new Error(`delete failed: ${table}`);
          }
          const result = deleteRows(table, predicates);
          return { numDeletedRows: result?.numDeletedRows ?? 0 };
        }
        return rows[table]?.filter((row) => matches(row, predicates)) ?? [];
      }
    };
    return builder;
  };

  function insertResult(table: string): Row {
    if (table === "changeOrderActionTask") {
      return {
        id: "task-new",
        status: "Pending",
        taskOrigin: "Impact follow-up"
      };
    }
    if (table === "changeOrderImpactDecision") {
      return { id: "decision-new" };
    }
    return { id: `${table}-new` };
  }

  function persistInsertedRows(table: string, values: unknown) {
    const inserted = Array.isArray(values) ? values : [values];
    const tableRows = rows[table] ?? (rows[table] = []);
    for (const value of inserted) {
      if (value && typeof value === "object") {
        tableRows.push(value as Row);
      }
    }
  }

  function updateRows(
    table: string,
    predicates: Array<{ column: string; operator: string; value: unknown }>,
    values: unknown
  ): Row | null {
    const row = rows[table]?.find((candidate) =>
      matches(candidate, predicates)
    );
    if (!row) return null;
    if (values && typeof values === "object") Object.assign(row, values);
    return { id: row.id };
  }

  function deleteRows(
    table: string,
    predicates: Array<{ column: string; operator: string; value: unknown }>
  ): { numDeletedRows: number } | null {
    const tableRows = rows[table] ?? [];
    const index = tableRows.findIndex((row) => matches(row, predicates));
    if (index < 0) return { numDeletedRows: 0 };
    tableRows.splice(index, 1);
    return { numDeletedRows: 1 };
  }

  const transaction = {
    selectFrom: (table: string) => makeBuilder(table, "select"),
    insertInto: (table: string) => makeBuilder(table, "insert"),
    updateTable: (table: string) => makeBuilder(table, "update"),
    deleteFrom: (table: string) => makeBuilder(table, "delete")
  };

  const db = {
    transaction: () => ({
      execute: async (
        callback: (trx: typeof transaction) => Promise<unknown>
      ) => {
        const rowSnapshot = structuredClone(rows);
        const insertCount = inserts.length;
        const updateCount = updates.length;
        const deleteCount = deletes.length;
        try {
          const result = await callback(transaction);
          committed = true;
          return result;
        } catch (cause) {
          for (const table of Object.keys(rows)) delete rows[table];
          Object.assign(rows, structuredClone(rowSnapshot));
          inserts.splice(insertCount);
          updates.splice(updateCount);
          deletes.splice(deleteCount);
          rolledBack = true;
          throw cause;
        }
      }
    })
  };

  return {
    db: db as unknown as Kysely<KyselyDatabase>,
    rows,
    inserts,
    updates,
    deletes,
    lockedTables,
    get committed() {
      return committed;
    },
    get rolledBack() {
      return rolledBack;
    }
  };
}

function insertedRows(recorder: ReturnType<typeof makeTaskDb>, table: string) {
  return recorder.inserts
    .filter((entry) => entry.table === table)
    .flatMap((entry) =>
      Array.isArray(entry.values) ? entry.values : [entry.values]
    );
}

describe("Change Notice Impact task mutations", () => {
  it("creates an Impact task with server-owned origin and exact link history", async () => {
    const recorder = makeTaskDb();

    const result = await createChangeNoticeImpactTask(
      recorder.db,
      baseCreateInput()
    );

    expect(result).toEqual({
      data: {
        decisionId,
        actionTaskId: "task-new",
        decisionCreated: false,
        taskOrigin: "Impact follow-up",
        status: "Pending"
      },
      error: null
    });
    expect(recorder.committed).toBe(true);
    expect(recorder.rolledBack).toBe(false);
    expect(recorder.inserts[0]).toMatchObject({
      table: "changeOrderActionTask",
      values: {
        changeOrderId: changeNoticeId,
        name: "Call supplier",
        status: "Pending",
        actionTypeId: null,
        sortOrder: 3,
        companyId,
        createdBy: "user-1",
        taskOrigin: "Impact follow-up"
      }
    });
    expect(
      insertedRows(recorder, "changeOrderImpactDecisionActionTask")
    ).toEqual([
      {
        decisionId,
        actionTaskId: "task-new",
        companyId,
        createdBy: "user-1",
        createdAt: expect.any(String)
      }
    ]);
    expect(insertedRows(recorder, "changeOrderImpactDecisionHistory")).toEqual([
      expect.objectContaining({
        decisionId,
        targetType: "purchaseOrderLine",
        targetId: "purchase-order-line-1",
        eventType: "Task linked",
        previousStatus: null,
        newStatus: null,
        previousReasonCode: null,
        newReasonCode: null,
        previousSnapshot: null,
        newSnapshot: null,
        rationale: null,
        resolutionNote: null,
        relatedActionTaskId: "task-new",
        relatedAffectedItemId: null,
        priorAssessmentWasChanged: false,
        createdBy: "user-1"
      })
    ]);
  });

  it("rolls back task creation when the link write fails", async () => {
    const recorder = makeTaskDb({
      failOnInsertTable: "changeOrderImpactDecisionActionTask"
    });

    const result = await createChangeNoticeImpactTask(
      recorder.db,
      baseCreateInput()
    );

    expect(result).toEqual({
      data: null,
      error: { message: "insert failed: changeOrderImpactDecisionActionTask" }
    });
    expect(recorder.committed).toBe(false);
    expect(recorder.rolledBack).toBe(true);
    expect(recorder.inserts).toEqual([]);
  });

  it.each([
    "No action required",
    "Resolved"
  ])("does not attach a task to a %s decision", async (decisionStatus) => {
    const recorder = makeTaskDb({ decisionStatus });

    const result = await createChangeNoticeImpactTask(
      recorder.db,
      baseCreateInput()
    );

    expect(result).toEqual({
      data: null,
      error: {
        message:
          "Only Action required Impact decisions can receive follow-up tasks."
      }
    });
    expect(recorder.inserts).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("rejects client-supplied task lifecycle fields", async () => {
    const recorder = makeTaskDb();

    const result = await createChangeNoticeImpactTask(
      recorder.db,
      baseCreateInput({ task: { name: "Follow-up", status: "Pending" } })
    );

    expect(result).toEqual({
      data: null,
      error: { message: "Impact task lifecycle fields are server-derived." }
    });
    expect(recorder.committed).toBe(false);
    expect(recorder.rolledBack).toBe(false);
  });

  it.each([
    "Implementation",
    "Done"
  ] as const)("bootstraps the Action required decision, provenance, task, link, and history atomically on %s", async (changeNoticeStatus) => {
    const recorder = makeTaskDb({ changeNoticeStatus });
    recorder.rows.changeOrderImpactDecision = [];
    recorder.rows.changeOrderActionTask = [];

    const result = await createChangeNoticeImpactTask(
      recorder.db,
      baseCreateInput({
        decision: undefined,
        bootstrapDecision: {
          decisionStatus: "Action required",
          rationale: "Supplier confirmation is required."
        }
      })
    );

    expect(result).toEqual({
      data: {
        decisionId: "decision-new",
        actionTaskId: "task-new",
        decisionCreated: true,
        taskOrigin: "Impact follow-up",
        status: "Pending"
      },
      error: null
    });
    expect(recorder.committed).toBe(true);
    expect(
      insertedRows(recorder, "changeOrderImpactDecisionAffectedItem")
    ).toEqual([
      expect.objectContaining({
        decisionId: "decision-new",
        affectedItemId: "affected-item-1",
        affectedItemSourceId: "item-1"
      })
    ]);
    expect(insertedRows(recorder, "changeOrderImpactDecisionHistory")).toEqual([
      expect.objectContaining({ eventType: "Decision created" }),
      expect.objectContaining({ eventType: "Provenance started" }),
      expect.objectContaining({
        eventType: "Task linked",
        relatedActionTaskId: "task-new",
        previousStatus: null,
        newStatus: null,
        previousReasonCode: null,
        newReasonCode: null,
        previousSnapshot: null,
        newSnapshot: null,
        rationale: null,
        resolutionNote: null
      })
    ]);
  });

  it.each([
    "Done",
    "Cancelled"
  ])("allows an existing Action required task cleanup on %s", async (changeNoticeStatus) => {
    const recorder = makeTaskDb({ changeNoticeStatus });

    const result = await createChangeNoticeImpactTask(
      recorder.db,
      baseCreateInput()
    );

    expect(result).toEqual({
      data: {
        decisionId,
        actionTaskId: "task-new",
        decisionCreated: false,
        taskOrigin: "Impact follow-up",
        status: "Pending"
      },
      error: null
    });
    expect(recorder.committed).toBe(true);
  });

  it("rejects bootstrap on Cancelled without writing any rows", async () => {
    const recorder = makeTaskDb({ changeNoticeStatus: "Cancelled" });

    const result = await createChangeNoticeImpactTask(
      recorder.db,
      baseCreateInput({
        decision: undefined,
        bootstrapDecision: {
          decisionStatus: "Action required",
          rationale: "Supplier confirmation is required."
        }
      })
    );

    expect(result).toEqual({
      data: null,
      error: {
        message: "Cancelled Change Notices cannot bootstrap an Impact decision."
      }
    });
    expect(recorder.inserts).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("links ordinary tasks without changing origin or decision conclusion", async () => {
    const recorder = makeTaskDb({ taskOrigin: "Manual" });

    const result = await linkChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: { decisionId, actionTaskId: taskId, changed: true },
      error: null
    });
    expect(recorder.rows.changeOrderActionTask[0]?.taskOrigin).toBe("Manual");
    expect(recorder.updates).toEqual([]);
    expect(recorder.lockedTables).toEqual([
      "changeOrder",
      "changeOrderImpactDecision",
      "changeOrderActionTask",
      "changeOrderImpactDecisionActionTask"
    ]);
    expect(insertedRows(recorder, "changeOrderImpactDecisionHistory")).toEqual([
      expect.objectContaining({
        eventType: "Task linked",
        relatedActionTaskId: taskId,
        previousStatus: null,
        newStatus: null,
        previousReasonCode: null,
        newReasonCode: null,
        previousSnapshot: null,
        newSnapshot: null,
        rationale: null,
        resolutionNote: null
      })
    ]);
  });

  it.each([
    "No action required",
    "Resolved"
  ] as const)("links a task to a %s decision without changing its conclusion", async (decisionStatus) => {
    const recorder = makeTaskDb({ decisionStatus });

    const result = await linkChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: { decisionId, actionTaskId: taskId, changed: true },
      error: null
    });
    expect(recorder.rows.changeOrderActionTask[0]?.taskOrigin).toBe("Manual");
    expect(insertedRows(recorder, "changeOrderImpactDecisionHistory")).toEqual([
      expect.objectContaining({
        eventType: "Task linked",
        relatedActionTaskId: taskId,
        previousStatus: null,
        newStatus: null,
        previousReasonCode: null,
        newReasonCode: null,
        previousSnapshot: null,
        newSnapshot: null,
        rationale: null,
        resolutionNote: null
      })
    ]);
  });

  it("rolls back a link when its feature history write fails", async () => {
    const recorder = makeTaskDb({
      failOnInsertTable: "changeOrderImpactDecisionHistory"
    });

    const result = await linkChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: null,
      error: { message: "insert failed: changeOrderImpactDecisionHistory" }
    });
    expect(recorder.rows.changeOrderImpactDecisionActionTask).toEqual([]);
    expect(recorder.inserts).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("treats duplicate link as a no-op without history", async () => {
    const recorder = makeTaskDb({ hasLink: true });

    const result = await linkChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: { decisionId, actionTaskId: taskId, changed: false },
      error: null
    });
    expect(recorder.inserts).toEqual([]);
    expect(recorder.updates).toEqual([]);
  });

  it.each([
    "No action required",
    "Resolved"
  ])("allows unlink cleanup for an existing link after the decision becomes %s", async (decisionStatus) => {
    const recorder = makeTaskDb({
      hasLink: true,
      decisionStatus,
      taskOrigin: "Impact follow-up"
    });

    const result = await unlinkChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: { decisionId, actionTaskId: taskId, changed: true },
      error: null
    });
    expect(recorder.rows.changeOrderImpactDecisionActionTask).toEqual([]);
    expect(insertedRows(recorder, "changeOrderImpactDecisionHistory")).toEqual([
      expect.objectContaining({
        eventType: "Task unlinked",
        previousStatus: null,
        newStatus: null,
        previousReasonCode: null,
        newReasonCode: null,
        previousSnapshot: null,
        newSnapshot: null,
        rationale: null,
        resolutionNote: null
      })
    ]);
  });

  it("unlinks only an existing link and leaves the decision conclusion untouched", async () => {
    const recorder = makeTaskDb({ hasLink: true });

    const result = await unlinkChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: { decisionId, actionTaskId: taskId, changed: true },
      error: null
    });
    expect(recorder.rows.changeOrderImpactDecisionActionTask).toEqual([]);
    expect(recorder.updates).toEqual([]);
    expect(insertedRows(recorder, "changeOrderImpactDecisionHistory")).toEqual([
      expect.objectContaining({
        eventType: "Task unlinked",
        relatedActionTaskId: taskId,
        relatedAffectedItemId: null,
        priorAssessmentWasChanged: false,
        previousStatus: null,
        newStatus: null,
        previousReasonCode: null,
        newReasonCode: null,
        previousSnapshot: null,
        newSnapshot: null,
        rationale: null,
        resolutionNote: null
      })
    ]);
  });

  it("rolls back an unlink when its feature history write fails", async () => {
    const recorder = makeTaskDb({
      hasLink: true,
      failOnInsertTable: "changeOrderImpactDecisionHistory"
    });

    const result = await unlinkChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: null,
      error: { message: "insert failed: changeOrderImpactDecisionHistory" }
    });
    expect(recorder.rows.changeOrderImpactDecisionActionTask).toHaveLength(1);
    expect(recorder.inserts).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("treats duplicate unlink as a no-op without history", async () => {
    const recorder = makeTaskDb();

    const result = await unlinkChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: { decisionId, actionTaskId: taskId, changed: false },
      error: null
    });
    expect(recorder.inserts).toEqual([]);
    expect(recorder.rows.changeOrderImpactDecisionActionTask).toEqual([]);
  });

  it("designates a linked ordinary task before Done and records the designation event", async () => {
    const recorder = makeTaskDb({
      hasLink: true,
      taskOrigin: "Template-owned"
    });

    const result = await designateChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: {
        decisionId,
        actionTaskId: taskId,
        previousTaskOrigin: "Template-owned",
        taskOrigin: "Impact follow-up",
        changed: true
      },
      error: null
    });
    expect(recorder.rows.changeOrderActionTask[0]?.taskOrigin).toBe(
      "Impact follow-up"
    );
    expect(insertedRows(recorder, "changeOrderImpactDecisionHistory")).toEqual([
      expect.objectContaining({
        eventType: "Task designated as Impact follow-up",
        relatedActionTaskId: taskId,
        previousStatus: null,
        newStatus: null,
        previousReasonCode: null,
        newReasonCode: null,
        previousSnapshot: null,
        newSnapshot: null,
        rationale:
          "Task origin changed from Template-owned to Impact follow-up",
        resolutionNote: null
      })
    ]);
  });

  it.each([
    "Manual",
    "Template-owned"
  ] as const)("designates a %s task and creates the missing relationship atomically", async (taskOrigin) => {
    const recorder = makeTaskDb({ taskOrigin });

    const result = await designateChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: {
        decisionId,
        actionTaskId: taskId,
        previousTaskOrigin: taskOrigin,
        taskOrigin: "Impact follow-up",
        changed: true
      },
      error: null
    });
    expect(recorder.rows.changeOrderActionTask[0]?.taskOrigin).toBe(
      "Impact follow-up"
    );
    expect(recorder.rows.changeOrderActionTask[0]?.actionTypeId).toBe(
      "action-type-1"
    );
    expect(recorder.rows.changeOrderImpactDecisionActionTask).toEqual([
      expect.objectContaining({ decisionId, actionTaskId: taskId, companyId })
    ]);
    expect(insertedRows(recorder, "changeOrderImpactDecisionHistory")).toEqual([
      expect.objectContaining({
        eventType: "Task linked",
        relatedActionTaskId: taskId,
        previousStatus: null,
        newStatus: null,
        previousReasonCode: null,
        newReasonCode: null,
        previousSnapshot: null,
        newSnapshot: null,
        rationale: null,
        resolutionNote: null
      }),
      expect.objectContaining({
        eventType: "Task designated as Impact follow-up",
        relatedActionTaskId: taskId,
        previousStatus: null,
        newStatus: null,
        previousReasonCode: null,
        newReasonCode: null,
        previousSnapshot: null,
        newSnapshot: null,
        rationale: `Task origin changed from ${taskOrigin} to Impact follow-up`,
        resolutionNote: null
      })
    ]);
  });

  it("repairs a missing link for an already Impact-origin task without duplicating designation history", async () => {
    const recorder = makeTaskDb({ taskOrigin: "Impact follow-up" });

    const result = await designateChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: {
        decisionId,
        actionTaskId: taskId,
        previousTaskOrigin: "Impact follow-up",
        taskOrigin: "Impact follow-up",
        changed: true
      },
      error: null
    });
    expect(recorder.rows.changeOrderImpactDecisionActionTask).toEqual([
      expect.objectContaining({ decisionId, actionTaskId: taskId, companyId })
    ]);
    expect(insertedRows(recorder, "changeOrderImpactDecisionHistory")).toEqual([
      expect.objectContaining({
        eventType: "Task linked",
        previousStatus: null,
        newStatus: null,
        previousReasonCode: null,
        newReasonCode: null,
        previousSnapshot: null,
        newSnapshot: null,
        rationale: null,
        resolutionNote: null
      })
    ]);
  });

  it("rolls back task designation when its feature history write fails", async () => {
    const recorder = makeTaskDb({
      hasLink: true,
      taskOrigin: "Manual",
      failOnInsertTable: "changeOrderImpactDecisionHistory"
    });

    const result = await designateChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: null,
      error: { message: "insert failed: changeOrderImpactDecisionHistory" }
    });
    expect(recorder.rows.changeOrderActionTask[0]?.taskOrigin).toBe("Manual");
    expect(recorder.updates).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("treats already designated tasks as a no-op", async () => {
    const recorder = makeTaskDb({
      hasLink: true,
      taskOrigin: "Impact follow-up"
    });

    const result = await designateChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: {
        decisionId,
        actionTaskId: taskId,
        previousTaskOrigin: "Impact follow-up",
        taskOrigin: "Impact follow-up",
        changed: false
      },
      error: null
    });
    expect(recorder.inserts).toEqual([]);
    expect(recorder.updates).toEqual([]);
  });

  it.each([
    ["Done", "Manual", null],
    ["Done", "Impact follow-up", null],
    [
      "Cancelled",
      "Manual",
      "Cancelled Change Notices only allow cleanup of Impact follow-up tasks."
    ],
    ["Cancelled", "Impact follow-up", null],
    [
      "Cancelled",
      "Impact follow-up",
      "Cancelled Change Notices only allow cleanup of Impact follow-up tasks.",
      "Resolved"
    ],
    [
      "Cancelled",
      "Impact follow-up",
      "Cancelled Change Notices only allow cleanup of Impact follow-up tasks.",
      "No action required"
    ]
  ])("applies the Done/Cancelled lifecycle guard for links", async (status, origin, message, decisionStatus = "Action required") => {
    const recorder = makeTaskDb({
      changeNoticeStatus: status,
      taskOrigin: origin,
      decisionStatus
    });

    const result = await linkChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    if (message) {
      expect(result).toEqual({ data: null, error: { message } });
      expect(recorder.rolledBack).toBe(true);
      expect(recorder.inserts).toEqual([]);
    } else {
      expect(result.error).toBeNull();
      expect(recorder.committed).toBe(true);
    }
  });

  it.each([
    ["Done", "Manual", null],
    ["Cancelled", "Impact follow-up", null],
    [
      "Cancelled",
      "Manual",
      "Cancelled Change Notices only allow cleanup of Impact follow-up tasks."
    ],
    [
      "Cancelled",
      "Impact follow-up",
      "Cancelled Change Notices only allow cleanup of Impact follow-up tasks.",
      "Resolved"
    ],
    [
      "Cancelled",
      "Impact follow-up",
      "Cancelled Change Notices only allow cleanup of Impact follow-up tasks.",
      "No action required"
    ]
  ])("applies the Done/Cancelled lifecycle guard for unlinking", async (status, origin, message, decisionStatus = "Action required") => {
    const recorder = makeTaskDb({
      changeNoticeStatus: status,
      hasLink: true,
      taskOrigin: origin,
      decisionStatus
    });

    const result = await unlinkChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    if (message) {
      expect(result).toEqual({ data: null, error: { message } });
      expect(recorder.rolledBack).toBe(true);
      expect(recorder.rows.changeOrderImpactDecisionActionTask).toHaveLength(1);
    } else {
      expect(result.error).toBeNull();
      expect(recorder.rows.changeOrderImpactDecisionActionTask).toEqual([]);
    }
  });

  it("allows unlinking an ordinary task after Done without changing its origin", async () => {
    const recorder = makeTaskDb({
      changeNoticeStatus: "Done",
      hasLink: true,
      taskOrigin: "Manual"
    });

    const result = await unlinkChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: { decisionId, actionTaskId: taskId, changed: true },
      error: null
    });
    expect(recorder.rows.changeOrderImpactDecisionActionTask).toEqual([]);
    expect(recorder.rows.changeOrderActionTask[0]?.taskOrigin).toBe("Manual");
  });

  it.each([
    "Done",
    "Cancelled"
  ])("rejects designation after the Change Notice reaches %s", async (status) => {
    const recorder = makeTaskDb({
      changeNoticeStatus: status,
      hasLink: true,
      taskOrigin: "Manual"
    });

    const result = await designateChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: null,
      error: {
        message:
          "Impact task designation is only allowed before the Change Notice is Done."
      }
    });
    expect(recorder.updates).toEqual([]);
    expect(recorder.inserts).toEqual([]);
  });

  it("rejects cross-company designation before any write", async () => {
    const recorder = makeTaskDb({ hasLink: true });

    const result = await designateChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput({ companyId: "company-2" })
    );

    expect(result).toEqual({
      data: null,
      error: { message: "Change notice not found." }
    });
    expect(recorder.updates).toEqual([]);
    expect(recorder.inserts).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("rejects a cross-Change-Notice decision before any designation write", async () => {
    const recorder = makeTaskDb({ hasLink: true });

    const result = await designateChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput({ decisionId: "other-decision" })
    );

    expect(result).toEqual({
      data: null,
      error: { message: "Impact decision not found." }
    });
    expect(recorder.updates).toEqual([]);
    expect(recorder.inserts).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("rejects cross-company task mutations before any write", async () => {
    const recorder = makeTaskDb();

    const result = await linkChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput({ companyId: "company-2" })
    );

    expect(result).toEqual({
      data: null,
      error: { message: "Change notice not found." }
    });
    expect(recorder.inserts).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("rejects a task from another Change Notice before any write", async () => {
    const recorder = makeTaskDb();
    recorder.rows.changeOrderActionTask[0].changeOrderId =
      "other-change-notice";

    const result = await linkChangeNoticeImpactTask(
      recorder.db,
      baseRelationshipInput()
    );

    expect(result).toEqual({
      data: null,
      error: { message: "Action task not found." }
    });
    expect(recorder.inserts).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });
});
