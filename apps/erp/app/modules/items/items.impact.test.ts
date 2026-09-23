import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const {
  classifyJobImpactEligibility,
  classifyJobMaterialImpactEligibility,
  classifyPurchaseOrderLineImpactEligibility,
  createChangeNoticeImpactPreviewFingerprint,
  compareChangeNoticeImpactSnapshot,
  deriveChangeNoticeImpactProvenance,
  getChangeNoticeAffectedItems,
  getChangeNoticeImpactCandidates,
  getChangeNoticeImpactWorkspace,
  normalizeJobImpactSnapshot,
  writeChangeNoticeImpactDecisions,
  removeChangeNoticeAffectedItem,
  writeChangeNoticeImpactDecision,
  normalizeJobMaterialImpactSnapshot,
  normalizePurchaseOrderLineImpactSnapshot
} = await import("./items.service");
const {
  ACTIVE_JOB_MATERIAL,
  ACTIVE_PRODUCING_JOB,
  JOB_MATERIAL_SNAPSHOT_V1,
  JOB_SNAPSHOT_V1,
  OPEN_PURCHASING_COMMITMENT,
  PO_LINE_SNAPSHOT_V1,
  changeNoticeImpactDecisionBulkRequestValidator,
  changeNoticeImpactDecisionRequestValidator,
  changeNoticeImpactDecisionStatuses,
  changeNoticeImpactNoActionReasonCodes,
  deriveChangeNoticeImpactDecisionOperation,
  validateChangeNoticeImpactFirstAssessment,
  validateChangeNoticeImpactNoActionReason
} = await import("./items.models");

const companyId = "company-1";
const changeNoticeId = "cn-1";
const sourceAccess = {
  purchaseOrderLine: true,
  job: true,
  jobMaterial: true
};

function basePoInput(over: Record<string, unknown> = {}) {
  return {
    purchaseOrderLineId: "pol-1",
    purchaseOrderId: "po-1",
    supplierId: "supplier-1",
    itemId: "item-1",
    itemRevision: "A",
    purchaseOrderLineType: "Part",
    purchaseOrderStatus: "To Receive",
    receivedComplete: false,
    purchaseQuantity: 10,
    quantityReceived: 2,
    quantityToReceive: 8,
    purchaseUnitOfMeasureCode: "BOX",
    inventoryUnitOfMeasureCode: "EA",
    conversionFactor: 2,
    requiredDate: "2026-08-25",
    promisedDate: null,
    deliveryReceiptPromisedDate: null,
    deliveryRowPresent: true,
    ...over
  };
}

function baseJobInput(over: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    itemId: "item-1",
    itemRevision: "A",
    status: "In Progress",
    quantity: 100,
    productionQuantity: 110,
    quantityComplete: 20,
    quantityShipped: 10,
    quantityReceivedToInventory: 5,
    dueDate: "2026-08-30",
    effectiveMethodId: "job-method-1",
    effectiveMethodVersion: 2,
    unitOfMeasureCode: "EA",
    ...over
  };
}

function baseMaterialInput(over: Record<string, unknown> = {}) {
  return {
    jobMaterialId: "material-1",
    jobId: "job-1",
    itemId: "item-1",
    itemRevision: "A",
    jobStatus: "In Progress",
    estimatedQuantity: 5,
    quantityIssued: 5,
    quantityToIssue: 0,
    unitOfMeasureCode: "EA",
    methodType: "Pull from Inventory",
    jobOperationId: null,
    requiresBatchTracking: true,
    requiresSerialTracking: false,
    ...over
  };
}

function expectUnavailable(result: { sourceAvailability: string }) {
  expect(result.sourceAvailability).toBe("Unavailable");
}

function makeImpactKyselyRecorder(
  options: {
    failInsertTable?: string;
    failInsertError?: unknown;
    failUpdateTable?: string;
    failUpdateError?: unknown;
    updateReturnsNoRow?: boolean;
    changeNoticeStatus?: string;
    existingDecision?: Record<string, unknown>;
    existingProvenance?: Record<string, unknown>[];
    impactTasks?: Record<string, unknown>[];
    impactTaskLinks?: Record<string, unknown>[];
    forbidSelectTables?: string[];
  } = {}
) {
  const existingSnapshot = normalizePurchaseOrderLineImpactSnapshot(
    basePoInput()
  );
  if (existingSnapshot.sourceAvailability !== "Present") {
    throw new Error("Test PO snapshot must be present");
  }
  const existingDecision = options.existingDecision
    ? {
        id: "decision-1",
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        noActionReasonCode: null,
        rationale: "Existing assessment",
        resolutionNote: null,
        assessmentSnapshot: existingSnapshot.snapshot,
        snapshotVersion: 1,
        assessedBy: "user-0",
        assessedAt: "2026-08-24T00:00:00.000Z",
        revision: 1,
        ...options.existingDecision
      }
    : null;
  const firstRows: Record<string, unknown> = {
    changeOrder: {
      id: changeNoticeId,
      companyId,
      status: options.changeNoticeStatus ?? "Done"
    },
    changeOrderImpactDecision: existingDecision,
    purchaseOrderLine: {
      id: "pol-1",
      companyId,
      purchaseOrderId: "po-1",
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
    },
    purchaseOrder: {
      id: "po-1",
      companyId,
      supplierId: "supplier-1",
      status: "To Receive"
    },
    purchaseOrderDelivery: {
      id: "po-1",
      companyId,
      receiptPromisedDate: null
    },
    item: {
      id: "item-1",
      companyId,
      readableId: "PART-1",
      readableIdWithRevision: "PART-1 Rev A",
      name: "Part",
      revision: "A"
    },
    job: {
      id: "job-1",
      companyId,
      itemId: "item-1",
      jobId: "JOB-1",
      status: "In Progress",
      quantity: 100,
      quantityComplete: 20,
      quantityShipped: 10,
      quantityReceivedToInventory: 5,
      dueDate: "2026-08-30",
      unitOfMeasureCode: "EA"
    },
    jobMaterial: {
      id: "material-1",
      companyId,
      jobId: "job-1",
      itemId: "item-1",
      estimatedQuantity: 5,
      quantityIssued: 5,
      quantityToIssue: 0,
      unitOfMeasureCode: "EA",
      methodType: "Pull from Inventory",
      jobOperationId: null,
      requiresBatchTracking: true,
      requiresSerialTracking: false
    }
  };
  const rows: Record<string, unknown[]> = {
    changeOrderAffectedItem: [
      {
        id: "affected-1",
        companyId,
        changeOrderId: changeNoticeId,
        itemId: "item-1"
      }
    ],
    changeOrderImpactDecisionAffectedItem:
      options.existingProvenance?.map((row) => ({
        companyId,
        decisionId: "decision-1",
        ...row
      })) ??
      (existingDecision
        ? [
            {
              id: "provenance-1",
              companyId,
              decisionId: "decision-1",
              affectedItemId: "affected-1",
              affectedItemSourceId: "item-1",
              affectedItemLabel: "PART-1 Rev A",
              startedAt: "2026-08-24T00:00:00.000Z",
              startedBy: "user-0",
              endedAt: null,
              endedBy: null,
              endedReason: null
            }
          ]
        : []),
    jobMakeMethod: [
      {
        id: "job-method-1",
        companyId,
        jobId: "job-1",
        itemId: "item-1",
        version: 2
      }
    ],
    changeOrderActionTask: options.impactTasks ?? [],
    changeOrderImpactDecisionActionTask: options.impactTaskLinks ?? []
  };
  const inserts: { table: string; values: unknown }[] = [];
  const updates: { table: string; values: unknown }[] = [];
  const selects: string[] = [];
  let committed = false;
  let rolledBack = false;

  const makeBuilder = (
    table: string,
    kind: "select" | "insert" | "update" = "select"
  ) => {
    const isInsert = kind === "insert";
    const isUpdate = kind === "update";
    const builder: Record<string, unknown> = {
      select: () => builder,
      values: (values: unknown) => {
        inserts.push({ table, values });
        return builder;
      },
      set: (values: unknown) => {
        updates.push({ table, values });
        return builder;
      },
      where: () => builder,
      orderBy: () => builder,
      forUpdate: () => builder,
      returning: () => builder,
      executeTakeFirst: async () => {
        if (
          !isInsert &&
          !isUpdate &&
          options.forbidSelectTables?.includes(table)
        ) {
          throw new Error(`Unexpected Impact source read: ${table}`);
        }
        if (isUpdate) {
          if (options.failUpdateTable === table) {
            throw options.failUpdateError ?? new Error("update failed");
          }
          return options.updateReturnsNoRow ? null : { id: `${table}-updated` };
        }
        return firstRows[table] ?? null;
      },
      executeTakeFirstOrThrow: async () => {
        if (isInsert && options.failInsertTable === table) {
          throw (
            options.failInsertError ?? {
              code: "23505",
              constraint: "changeOrderImpactDecision_target_key",
              detail: "changeOrderImpactDecision_target_key"
            }
          );
        }
        return { id: `${table}-generated` };
      },
      execute: async () => {
        if (
          !isInsert &&
          !isUpdate &&
          options.forbidSelectTables?.includes(table)
        ) {
          throw new Error(`Unexpected Impact source read: ${table}`);
        }
        if (isInsert && options.failInsertTable === table) {
          throw (
            options.failInsertError ?? {
              code: "23505",
              constraint: "changeOrderImpactDecision_target_key",
              detail: "changeOrderImpactDecision_target_key"
            }
          );
        }
        if (isUpdate && options.failUpdateTable === table) {
          throw options.failUpdateError ?? new Error("update failed");
        }
        if (isUpdate) return { numUpdatedRows: 1 };
        if (rows[table]) return rows[table];
        const firstRow = firstRows[table];
        return firstRow ? [firstRow] : [];
      }
    };
    return builder;
  };

  const tx = {
    selectFrom: (table: string) => {
      selects.push(table);
      return makeBuilder(table, "select");
    },
    insertInto: (table: string) => makeBuilder(table, "insert"),
    updateTable: (table: string) => makeBuilder(table, "update")
  };
  const db = {
    transaction: () => ({
      execute: async (
        callback: (transaction: typeof tx) => Promise<unknown>
      ) => {
        try {
          const result = await callback(tx);
          committed = true;
          return result;
        } catch (cause) {
          rolledBack = true;
          throw cause;
        }
      }
    })
  };

  return {
    db,
    inserts,
    updates,
    selects,
    get committed() {
      return committed;
    },
    get rolledBack() {
      return rolledBack;
    }
  };
}

function makeBulkImpactKyselyRecorder(options: {
  rows: Record<string, unknown[]>;
  failInsertAt?: number;
  failInsertTable?: string;
  failUpdateTable?: string;
  updateReturnsNoRow?: boolean;
  forbidSelectTables?: string[];
}) {
  const inserts: { table: string; values: unknown }[] = [];
  const updates: { table: string; values: unknown }[] = [];
  const selects: string[] = [];
  let committed = false;
  let rolledBack = false;
  let insertCalls = 0;
  let generatedDecisionIds = 0;

  const matches = (
    row: Record<string, unknown>,
    predicates: Array<{ column: string; operator: string; value: unknown }>
  ) =>
    predicates.every(({ column, operator, value }) => {
      if (!(column in row)) return true;
      if (operator === "=") return row[column] === value;
      if (operator === "in") {
        return Array.isArray(value) && value.includes(row[column]);
      }
      if (operator === "is") return row[column] === value;
      return true;
    });

  const makeBuilder = (table: string, kind: "select" | "insert" | "update") => {
    const isInsert = kind === "insert";
    const isUpdate = kind === "update";
    const predicates: Array<{
      column: string;
      operator: string;
      value: unknown;
    }> = [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      values: (values: unknown) => {
        inserts.push({ table, values });
        return builder;
      },
      set: (values: unknown) => {
        updates.push({ table, values });
        return builder;
      },
      where: (column: string, operator: string, value: unknown) => {
        predicates.push({ column, operator, value });
        return builder;
      },
      orderBy: () => builder,
      forUpdate: () => builder,
      returning: () => builder,
      executeTakeFirstOrThrow: async () => {
        insertCalls += 1;
        if (
          options.failInsertTable === table ||
          options.failInsertAt === insertCalls
        ) {
          throw new Error("insert failed");
        }
        generatedDecisionIds += 1;
        return { id: `decision-generated-${generatedDecisionIds}` };
      },
      executeTakeFirst: async () => {
        if (
          !isInsert &&
          !isUpdate &&
          options.forbidSelectTables?.includes(table)
        ) {
          throw new Error(`Unexpected Impact source read: ${table}`);
        }
        if (isUpdate) {
          if (options.failUpdateTable === table) {
            throw new Error("update failed");
          }
          return options.updateReturnsNoRow ? null : { id: `${table}-updated` };
        }
        if (isInsert) {
          insertCalls += 1;
          if (
            options.failInsertTable === table ||
            options.failInsertAt === insertCalls
          ) {
            throw new Error("insert failed");
          }
          generatedDecisionIds += 1;
          return { id: `decision-generated-${generatedDecisionIds}` };
        }
        const row = (options.rows[table] ?? []).find((value) =>
          matches(value as Record<string, unknown>, predicates)
        );
        return row ?? null;
      },
      execute: async () => {
        if (
          !isInsert &&
          !isUpdate &&
          options.forbidSelectTables?.includes(table)
        ) {
          throw new Error(`Unexpected Impact source read: ${table}`);
        }
        if (isInsert) {
          insertCalls += 1;
          if (
            options.failInsertTable === table ||
            options.failInsertAt === insertCalls
          ) {
            throw new Error("insert failed");
          }
          return { numInsertedOrUpdatedRows: 1 };
        }
        if (isUpdate) {
          if (options.failUpdateTable === table) {
            throw new Error("update failed");
          }
          return { numUpdatedRows: 1 };
        }
        return (options.rows[table] ?? []).filter((value) =>
          matches(value as Record<string, unknown>, predicates)
        );
      }
    };
    return builder;
  };

  const tx = {
    selectFrom: (table: string) => {
      selects.push(table);
      return makeBuilder(table, "select");
    },
    insertInto: (table: string) => makeBuilder(table, "insert"),
    updateTable: (table: string) => makeBuilder(table, "update")
  };
  const db = {
    transaction: () => ({
      execute: async (
        callback: (transaction: typeof tx) => Promise<unknown>
      ) => {
        try {
          const result = await callback(tx);
          committed = true;
          return result;
        } catch (cause) {
          rolledBack = true;
          throw cause;
        }
      }
    })
  };

  return {
    db,
    inserts,
    updates,
    selects,
    get committed() {
      return committed;
    },
    get rolledBack() {
      return rolledBack;
    }
  };
}

function makeBulkPurchaseOrderRows(
  existingDecisions: Record<string, unknown>[] = [],
  provenance: Record<string, unknown>[] = [],
  targetCount = 2
): Record<string, unknown[]> {
  const line = (id: string, itemId: string, purchaseOrderId: string) => ({
    id,
    companyId,
    purchaseOrderId,
    itemId,
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
  });
  const parent = (id: string) => ({
    id,
    companyId,
    supplierId: id === "po-1" ? "supplier-1" : `supplier-${id}`,
    status: "To Receive"
  });
  const item = (id: string) => ({
    id,
    companyId,
    readableId: id.toUpperCase(),
    readableIdWithRevision: `${id.toUpperCase()} Rev A`,
    name: "Part",
    revision: "A"
  });
  const targetNumbers = Array.from(
    { length: targetCount },
    (_, index) => index + 1
  );
  return {
    changeOrder: [{ id: changeNoticeId, companyId, status: "Done" }],
    changeOrderImpactDecision: existingDecisions,
    changeOrderImpactDecisionAffectedItem: provenance,
    changeOrderAffectedItem: targetNumbers.map((number) => ({
      id: `affected-${number}`,
      companyId,
      changeOrderId: changeNoticeId,
      itemId: `item-${number}`
    })),
    purchaseOrderLine: targetNumbers.map((number) =>
      line(`pol-${number}`, `item-${number}`, `po-${number}`)
    ),
    purchaseOrder: targetNumbers.map((number) => parent(`po-${number}`)),
    purchaseOrderDelivery: targetNumbers.map((number) => ({
      id: `po-${number}`,
      companyId,
      receiptPromisedDate: null
    })),
    item: targetNumbers.map((number) => item(`item-${number}`)),
    job: [],
    jobMaterial: [],
    jobMakeMethod: []
  };
}

function makeImpactRemovalKyselyRecorder(
  options: { failInsertTable?: string } = {}
) {
  const affectedItem = {
    id: "affected-1",
    changeOrderId: changeNoticeId,
    draftMakeMethodId: null,
    newItemId: null
  };
  const rows: Record<string, unknown[]> = {
    changeOrderImpactDecisionAffectedItem: [
      { id: "provenance-1", decisionId: "decision-1" }
    ],
    changeOrderImpactDecision: [
      {
        id: "decision-1",
        targetType: "job",
        targetId: "job-1",
        decisionStatus: "Action required",
        noActionReasonCode: null,
        rationale: "The producing job still needs a cut-in review.",
        resolutionNote: null,
        assessmentSnapshot: {
          schema: JOB_SNAPSHOT_V1,
          jobId: "job-1",
          itemId: "item-1"
        }
      }
    ],
    changeOrderAffectedItem: [affectedItem]
  };
  const updates: { table: string; values: unknown }[] = [];
  const deletes: string[] = [];
  const inserts: { table: string; values: unknown }[] = [];
  let committed = false;
  let rolledBack = false;

  const makeBuilder = (
    table: string,
    kind: "select" | "insert" | "update" | "delete"
  ) => {
    const baseTable = table.split(" as ")[0];
    const builder: Record<string, unknown> = {
      select: () => builder,
      innerJoin: () => builder,
      values: (values: unknown) => {
        inserts.push({ table: baseTable, values });
        return builder;
      },
      set: (values: unknown) => {
        updates.push({ table: baseTable, values });
        return builder;
      },
      where: () => builder,
      orderBy: () => builder,
      forUpdate: () => builder,
      returning: () => builder,
      executeTakeFirst: async () => {
        if (kind !== "select") return null;
        if (baseTable === "changeOrder") {
          return { id: changeNoticeId, status: "Draft" };
        }
        return rows[baseTable]?.[0] ?? null;
      },
      executeTakeFirstOrThrow: async () => ({ id: "generated-id" }),
      execute: async () => {
        if (kind === "insert" && options.failInsertTable === baseTable) {
          throw new Error("history write failed");
        }
        if (kind === "delete") deletes.push(baseTable);
        return rows[baseTable] ?? [];
      }
    };
    return builder;
  };

  const tx = {
    selectFrom: (table: string) => makeBuilder(table, "select"),
    insertInto: (table: string) => makeBuilder(table, "insert"),
    updateTable: (table: string) => makeBuilder(table, "update"),
    deleteFrom: (table: string) => makeBuilder(table, "delete")
  };
  const db = {
    transaction: () => ({
      execute: async (
        callback: (transaction: typeof tx) => Promise<unknown>
      ) => {
        try {
          const result = await callback(tx);
          committed = true;
          return result;
        } catch (cause) {
          rolledBack = true;
          throw cause;
        }
      }
    })
  };

  return {
    db,
    inserts,
    updates,
    deletes,
    get committed() {
      return committed;
    },
    get rolledBack() {
      return rolledBack;
    }
  };
}

describe("Change Notice Impact contracts", () => {
  it("keeps the exact target and persistent decision unions", () => {
    expect(changeNoticeImpactDecisionStatuses).toEqual([
      "No action required",
      "Action required",
      "Resolved"
    ]);
    expect(changeNoticeImpactNoActionReasonCodes).toEqual([
      "Outside effectivity",
      "Not affected after review",
      "No purchasing intervention remains"
    ]);
  });

  it("keeps the mutation contract server-shaped", () => {
    const valid = changeNoticeImpactDecisionRequestValidator.safeParse({
      changeNoticeId,
      targetType: "job",
      targetId: "job-1",
      decisionStatus: "Action required",
      rationale: "Review the active production order."
    });
    expect(valid.success).toBe(true);

    const clientDerivedFields =
      changeNoticeImpactDecisionRequestValidator.safeParse({
        changeNoticeId,
        targetType: "job",
        targetId: "job-1",
        decisionStatus: "Action required",
        operation: "createDecision",
        assessmentSnapshot: {}
      });
    expect(clientDerivedFields.success).toBe(false);
  });

  it("creates a deterministic opaque preview fingerprint from reviewed facts", async () => {
    const first = normalizePurchaseOrderLineImpactSnapshot(basePoInput());
    const changed = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({ quantityReceived: 1, quantityToReceive: 9 })
    );
    if (
      first.sourceAvailability !== "Present" ||
      changed.sourceAvailability !== "Present"
    ) {
      throw new Error("Test PO snapshots must be present");
    }

    const fingerprint = await createChangeNoticeImpactPreviewFingerprint({
      targetType: "purchaseOrderLine",
      snapshot: first.snapshot,
      affectedItemId: "affected-1",
      affectedItemSourceId: "item-1"
    });
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await createChangeNoticeImpactPreviewFingerprint({
        targetType: "purchaseOrderLine",
        snapshot: first.snapshot,
        affectedItemId: "affected-1",
        affectedItemSourceId: "item-1"
      })
    ).toBe(fingerprint);
    expect(
      await createChangeNoticeImpactPreviewFingerprint({
        targetType: "purchaseOrderLine",
        snapshot: changed.snapshot,
        affectedItemId: "affected-1",
        affectedItemSourceId: "item-1"
      })
    ).not.toBe(fingerprint);
    expect(
      await createChangeNoticeImpactPreviewFingerprint({
        targetType: "purchaseOrderLine",
        snapshot: first.snapshot,
        affectedItemId: "affected-2",
        affectedItemSourceId: "item-1"
      })
    ).not.toBe(fingerprint);
  });

  it("validates explicit bulk targets and rejects duplicates or unknown fields", () => {
    const valid = changeNoticeImpactDecisionBulkRequestValidator.safeParse({
      changeNoticeId,
      targets: [
        {
          targetType: "job",
          targetId: "job-1",
          decisionStatus: "Action required",
          rationale: "The producing job needs review."
        }
      ]
    });
    expect(valid.success).toBe(true);

    const duplicate = changeNoticeImpactDecisionBulkRequestValidator.safeParse({
      changeNoticeId,
      targets: [
        {
          targetType: "job",
          targetId: "job-1",
          decisionStatus: "Action required",
          rationale: "Review the producing job."
        },
        {
          targetType: "job",
          targetId: "job-1",
          decisionStatus: "Action required",
          rationale: "Review the producing job again."
        }
      ]
    });
    expect(duplicate.success).toBe(false);

    const unknownField =
      changeNoticeImpactDecisionBulkRequestValidator.safeParse({
        changeNoticeId,
        targets: [
          {
            targetType: "job",
            targetId: "job-1",
            decisionStatus: "Action required",
            rationale: "The producing job needs review.",
            operation: "createDecision"
          }
        ]
      });
    expect(unknownField.success).toBe(false);
  });

  it("creates mixed explicit bulk decisions with one batched read per source dependency", async () => {
    const recorder = makeBulkImpactKyselyRecorder({
      rows: makeBulkPurchaseOrderRows()
    });
    const result = await writeChangeNoticeImpactDecisions(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targets: [
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-1",
            decisionStatus: "Action required",
            rationale: "Supplier cut-in follow-up remains open."
          },
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-2",
            decisionStatus: "Action required",
            rationale: "The second supplier commitment needs review."
          }
        ]
      }
    );

    expect(result).toEqual({
      data: {
        changeNoticeId,
        selectedCount: 2,
        appliedCount: 2,
        noOpCount: 0
      },
      error: null
    });
    expect(recorder.committed).toBe(true);
    expect(recorder.rolledBack).toBe(false);
    expect(
      recorder.selects.filter((table) => table === "purchaseOrderLine")
    ).toHaveLength(1);
    expect(
      recorder.selects.filter((table) => table === "purchaseOrder")
    ).toHaveLength(1);
    expect(
      recorder.selects.filter((table) => table === "purchaseOrderDelivery")
    ).toHaveLength(1);
    expect(
      recorder.inserts.filter(
        (row) => row.table === "changeOrderImpactDecision"
      )
    ).toHaveLength(2);
    expect(
      recorder.inserts.filter(
        (row) => row.table === "changeOrderImpactDecisionAffectedItem"
      )
    ).toHaveLength(2);
    expect(
      recorder.inserts.filter(
        (row) => row.table === "changeOrderImpactDecisionHistory"
      )
    ).toHaveLength(2);
  });

  it("preflights every target before applying a mixed no-op and create set", async () => {
    const existingSnapshot = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput()
    );
    if (existingSnapshot.sourceAvailability !== "Present") {
      throw new Error("Test PO snapshot must be present");
    }
    const recorder = makeBulkImpactKyselyRecorder({
      rows: makeBulkPurchaseOrderRows(
        [
          {
            id: "decision-1",
            companyId,
            changeNoticeId,
            targetType: "purchaseOrderLine",
            targetId: "pol-1",
            decisionStatus: "Action required",
            noActionReasonCode: null,
            rationale: "Supplier cut-in follow-up remains open.",
            resolutionNote: null,
            assessmentSnapshot: existingSnapshot.snapshot,
            snapshotVersion: 1,
            assessedBy: "user-0",
            assessedAt: "2026-08-24T00:00:00.000Z",
            revision: 1
          }
        ],
        [
          {
            id: "provenance-1",
            companyId,
            decisionId: "decision-1",
            affectedItemId: "affected-1",
            affectedItemSourceId: "item-1",
            affectedItemLabel: "ITEM-1 Rev A",
            startedAt: "2026-08-24T00:00:00.000Z",
            startedBy: "user-0",
            endedAt: null,
            endedBy: null,
            endedReason: null
          }
        ]
      )
    });
    const result = await writeChangeNoticeImpactDecisions(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targets: [
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-1",
            decisionStatus: "Action required",
            expectedRevision: 1
          },
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-2",
            decisionStatus: "Action required",
            rationale: "The second supplier commitment needs review."
          }
        ]
      }
    );

    expect(result.data).toEqual({
      changeNoticeId,
      selectedCount: 2,
      appliedCount: 1,
      noOpCount: 1
    });
    expect(result.error).toBeNull();
    expect(
      recorder.inserts.filter(
        (row) => row.table === "changeOrderImpactDecision"
      )
    ).toHaveLength(1);
    expect(recorder.committed).toBe(true);
  });

  it("reassesses changed same-state evidence while keeping a true no-op untouched", async () => {
    const current = normalizePurchaseOrderLineImpactSnapshot(basePoInput());
    const currentSecond = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({
        purchaseOrderLineId: "pol-2",
        purchaseOrderId: "po-2",
        itemId: "item-2",
        supplierId: "supplier-po-2"
      })
    );
    const changed = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({ quantityReceived: 1, quantityToReceive: 9 })
    );
    if (
      current.sourceAvailability !== "Present" ||
      currentSecond.sourceAvailability !== "Present" ||
      changed.sourceAvailability !== "Present"
    ) {
      throw new Error("Test PO snapshots must be present");
    }
    const decision = (
      id: string,
      targetId: string,
      snapshot: unknown,
      rationale: string
    ) => ({
      id,
      companyId,
      changeNoticeId,
      targetType: "purchaseOrderLine",
      targetId,
      decisionStatus: "Action required",
      noActionReasonCode: null,
      rationale,
      resolutionNote: null,
      assessmentSnapshot: snapshot,
      snapshotVersion: 1,
      assessedBy: "user-0",
      assessedAt: "2026-08-24T00:00:00.000Z",
      revision: 1
    });
    const recorder = makeBulkImpactKyselyRecorder({
      rows: makeBulkPurchaseOrderRows(
        [
          decision(
            "decision-1",
            "pol-1",
            changed.snapshot,
            "Supplier review remains open."
          ),
          decision(
            "decision-2",
            "pol-2",
            currentSecond.snapshot,
            "Supplier review remains open."
          )
        ],
        [
          {
            id: "provenance-1",
            companyId,
            decisionId: "decision-1",
            affectedItemId: "affected-1",
            affectedItemSourceId: "item-1",
            affectedItemLabel: "ITEM-1 Rev A",
            startedAt: "2026-08-24T00:00:00.000Z",
            startedBy: "user-0",
            endedAt: null,
            endedBy: null,
            endedReason: null
          },
          {
            id: "provenance-2",
            companyId,
            decisionId: "decision-2",
            affectedItemId: "affected-2",
            affectedItemSourceId: "item-2",
            affectedItemLabel: "ITEM-2 Rev A",
            startedAt: "2026-08-24T00:00:00.000Z",
            startedBy: "user-0",
            endedAt: null,
            endedBy: null,
            endedReason: null
          }
        ]
      )
    });
    const result = await writeChangeNoticeImpactDecisions(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targets: [
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-1",
            decisionStatus: "Action required",
            expectedRevision: 1,
            rationale: "Reassess the changed supplier facts."
          },
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-2",
            decisionStatus: "Action required",
            expectedRevision: 1
          }
        ]
      }
    );

    expect(result).toEqual({
      data: {
        changeNoticeId,
        selectedCount: 2,
        appliedCount: 1,
        noOpCount: 1
      },
      error: null
    });
    expect(
      recorder.updates.filter(
        (row) => row.table === "changeOrderImpactDecision"
      )
    ).toHaveLength(1);
    expect(
      recorder.inserts.filter(
        (row) => row.table === "changeOrderImpactDecisionHistory"
      )
    ).toHaveLength(1);
    expect(recorder.committed).toBe(true);
  });

  it("rejects a stale target during preflight without writing any selected target", async () => {
    const recorder = makeBulkImpactKyselyRecorder({
      rows: makeBulkPurchaseOrderRows([
        {
          id: "decision-1",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-1",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "Existing review.",
          resolutionNote: null,
          assessmentSnapshot: normalizePurchaseOrderLineImpactSnapshot(
            basePoInput()
          ).snapshot,
          snapshotVersion: 1,
          assessedBy: "user-0",
          assessedAt: "2026-08-24T00:00:00.000Z",
          revision: 1
        },
        {
          id: "decision-2",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-2",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "Existing review.",
          resolutionNote: null,
          assessmentSnapshot: normalizePurchaseOrderLineImpactSnapshot(
            basePoInput({ purchaseOrderLineId: "pol-2", itemId: "item-2" })
          ).snapshot,
          snapshotVersion: 1,
          assessedBy: "user-0",
          assessedAt: "2026-08-24T00:00:00.000Z",
          revision: 2
        }
      ])
    });
    const result = await writeChangeNoticeImpactDecisions(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targets: [
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-1",
            decisionStatus: "Action required",
            expectedRevision: 1,
            rationale: "Reconfirm the first supplier commitment."
          },
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-2",
            decisionStatus: "Action required",
            expectedRevision: 1,
            rationale: "Reconfirm the second supplier commitment."
          }
        ]
      }
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("pol-2");
    expect(result.error?.message).toContain("changed before your update");
    expect(recorder.inserts).toEqual([]);
    expect(recorder.updates).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("rejects a stale bulk preview before applying any selected target", async () => {
    const first = normalizePurchaseOrderLineImpactSnapshot(basePoInput());
    const second = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({
        purchaseOrderLineId: "pol-2",
        purchaseOrderId: "po-2",
        itemId: "item-2",
        supplierId: "supplier-po-2"
      })
    );
    if (
      first.sourceAvailability !== "Present" ||
      second.sourceAvailability !== "Present"
    ) {
      throw new Error("Test PO snapshots must be present");
    }
    const firstFingerprint = await createChangeNoticeImpactPreviewFingerprint({
      targetType: "purchaseOrderLine",
      snapshot: first.snapshot,
      affectedItemId: "affected-1",
      affectedItemSourceId: "item-1"
    });
    const recorder = makeBulkImpactKyselyRecorder({
      rows: makeBulkPurchaseOrderRows([
        {
          id: "decision-1",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-1",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "Existing review.",
          resolutionNote: null,
          assessmentSnapshot: first.snapshot,
          snapshotVersion: 1,
          assessedBy: "user-0",
          assessedAt: "2026-08-24T00:00:00.000Z",
          revision: 1
        },
        {
          id: "decision-2",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-2",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "Existing review.",
          resolutionNote: null,
          assessmentSnapshot: second.snapshot,
          snapshotVersion: 1,
          assessedBy: "user-0",
          assessedAt: "2026-08-24T00:00:00.000Z",
          revision: 1
        }
      ])
    });
    const result = await writeChangeNoticeImpactDecisions(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targets: [
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-1",
            decisionStatus: "Action required",
            expectedRevision: 1,
            expectedSnapshotFingerprint: firstFingerprint,
            rationale: "Reconfirm the first supplier commitment."
          },
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-2",
            decisionStatus: "Action required",
            expectedRevision: 1,
            expectedSnapshotFingerprint: "stale-preview",
            rationale: "Reconfirm the second supplier commitment."
          }
        ]
      }
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain(
      "This Impact bulk preview is stale"
    );
    expect(recorder.inserts).toEqual([]);
    expect(recorder.updates).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("rolls back earlier bulk writes when a later apply write fails", async () => {
    const recorder = makeBulkImpactKyselyRecorder({
      rows: makeBulkPurchaseOrderRows(),
      failInsertAt: 6
    });
    const result = await writeChangeNoticeImpactDecisions(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targets: [
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-1",
            decisionStatus: "Action required",
            rationale: "Supplier cut-in follow-up remains open."
          },
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-2",
            decisionStatus: "Action required",
            rationale: "The second supplier commitment needs review."
          }
        ]
      }
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("insert failed");
    expect(result.error?.message).toContain("pol-1");
    expect(result.error?.message).toContain("pol-2");
    expect(recorder.committed).toBe(false);
    expect(recorder.rolledBack).toBe(true);
  });

  it("resolves a bulk set without reading source evidence or provenance", async () => {
    const first = normalizePurchaseOrderLineImpactSnapshot(basePoInput());
    const second = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({
        purchaseOrderLineId: "pol-2",
        purchaseOrderId: "po-2",
        itemId: "item-2",
        supplierId: "supplier-po-2"
      })
    );
    if (
      first.sourceAvailability !== "Present" ||
      second.sourceAvailability !== "Present"
    ) {
      throw new Error("Test PO snapshots must be present");
    }
    const decision = (id: string, targetId: string, snapshot: unknown) => ({
      id,
      companyId,
      changeNoticeId,
      targetType: "purchaseOrderLine",
      targetId,
      decisionStatus: "Action required",
      noActionReasonCode: null,
      rationale: "Supplier follow-up remains open.",
      resolutionNote: null,
      assessmentSnapshot: snapshot,
      snapshotVersion: 1,
      assessedBy: "user-0",
      assessedAt: "2026-08-24T00:00:00.000Z",
      revision: 1
    });
    const recorder = makeBulkImpactKyselyRecorder({
      rows: makeBulkPurchaseOrderRows([
        decision("decision-1", "pol-1", first.snapshot),
        decision("decision-2", "pol-2", second.snapshot)
      ]),
      forbidSelectTables: [
        "purchaseOrderLine",
        "purchaseOrder",
        "purchaseOrderDelivery",
        "item",
        "changeOrderAffectedItem",
        "changeOrderImpactDecisionAffectedItem"
      ]
    });
    const result = await writeChangeNoticeImpactDecisions(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targets: [
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-1",
            decisionStatus: "Resolved",
            resolutionNote: "Supplier confirmed the cut-in externally.",
            expectedRevision: 1
          },
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-2",
            decisionStatus: "Resolved",
            resolutionNote: "Supplier confirmed the second cut-in externally.",
            expectedRevision: 1
          }
        ]
      }
    );

    expect(result.data).toEqual({
      changeNoticeId,
      selectedCount: 2,
      appliedCount: 2,
      noOpCount: 0
    });
    expect(recorder.selects).not.toContain("purchaseOrderLine");
    expect(recorder.selects).not.toContain(
      "changeOrderImpactDecisionAffectedItem"
    );
    expect(recorder.updates).toHaveLength(2);
    expect(recorder.committed).toBe(true);
  });

  it("batches explicit PO, Job, and Job Material targets without collapsing identities", async () => {
    const rows = makeBulkPurchaseOrderRows();
    rows.purchaseOrderLine = [rows.purchaseOrderLine[0]];
    rows.purchaseOrder = [rows.purchaseOrder[0]];
    rows.purchaseOrderDelivery = [rows.purchaseOrderDelivery[0]];
    rows.item = [
      rows.item[0],
      {
        id: "item-3",
        companyId,
        readableId: "ITEM-3",
        readableIdWithRevision: "ITEM-3 Rev A",
        name: "Part",
        revision: "A"
      }
    ];
    rows.job = [
      {
        id: "job-1",
        companyId,
        itemId: "item-1",
        jobId: "JOB-1",
        status: "In Progress",
        quantity: 100,
        quantityComplete: 20,
        quantityShipped: 10,
        quantityReceivedToInventory: 5,
        dueDate: "2026-08-30",
        unitOfMeasureCode: "EA"
      },
      {
        id: "job-2",
        companyId,
        itemId: "item-3",
        jobId: "JOB-2",
        status: "In Progress",
        quantity: 50,
        quantityComplete: 10,
        quantityShipped: 0,
        quantityReceivedToInventory: 0,
        dueDate: "2026-08-30",
        unitOfMeasureCode: "EA"
      }
    ];
    rows.jobMaterial = [
      {
        id: "material-1",
        companyId,
        jobId: "job-2",
        itemId: "item-3",
        estimatedQuantity: 5,
        quantityIssued: 1,
        quantityToIssue: 4,
        unitOfMeasureCode: "EA",
        methodType: "Pull from Inventory",
        jobOperationId: null,
        requiresBatchTracking: true,
        requiresSerialTracking: false
      }
    ];
    rows.jobMakeMethod = [
      {
        id: "job-method-1",
        companyId,
        jobId: "job-1",
        itemId: "item-1",
        version: 2,
        parentMaterialId: null
      }
    ];
    rows.changeOrderAffectedItem = [
      {
        id: "affected-1",
        companyId,
        changeOrderId: changeNoticeId,
        itemId: "item-1"
      },
      {
        id: "affected-3",
        companyId,
        changeOrderId: changeNoticeId,
        itemId: "item-3"
      }
    ];
    const recorder = makeBulkImpactKyselyRecorder({ rows });
    const result = await writeChangeNoticeImpactDecisions(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targets: [
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-1",
            decisionStatus: "Action required",
            rationale: "Supplier cut-in follow-up remains open."
          },
          {
            targetType: "job",
            targetId: "job-1",
            decisionStatus: "Action required",
            rationale: "The producing job needs a cut-in review."
          },
          {
            targetType: "jobMaterial",
            targetId: "material-1",
            decisionStatus: "Action required",
            rationale: "The consuming material needs a cut-in review."
          }
        ]
      }
    );

    expect(result.data).toEqual({
      changeNoticeId,
      selectedCount: 3,
      appliedCount: 3,
      noOpCount: 0
    });
    expect(
      recorder.inserts.filter(
        (row) => row.table === "changeOrderImpactDecision"
      )
    ).toHaveLength(3);
    expect(
      recorder.inserts.filter(
        (row) => row.table === "changeOrderImpactDecisionHistory"
      )
    ).toHaveLength(3);
  });

  it("supports more than one source batch without imposing a selection cap", async () => {
    const targetCount = 51;
    const recorder = makeBulkImpactKyselyRecorder({
      rows: makeBulkPurchaseOrderRows([], [], targetCount)
    });
    const result = await writeChangeNoticeImpactDecisions(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targets: Array.from({ length: targetCount }, (_, index) => ({
          targetType: "purchaseOrderLine" as const,
          targetId: `pol-${index + 1}`,
          decisionStatus: "Action required" as const,
          rationale: `Supplier commitment ${index + 1} needs review.`
        }))
      }
    );

    expect(result).toEqual({
      data: {
        changeNoticeId,
        selectedCount: targetCount,
        appliedCount: targetCount,
        noOpCount: 0
      },
      error: null
    });
    expect(
      recorder.selects.filter((table) => table === "purchaseOrderLine")
    ).toHaveLength(2);
    expect(
      recorder.selects.filter((table) => table === "purchaseOrder")
    ).toHaveLength(2);
    expect(
      recorder.inserts.filter(
        (row) => row.table === "changeOrderImpactDecision"
      )
    ).toHaveLength(targetCount);
    expect(recorder.committed).toBe(true);
  });

  it("derives lifecycle operations from persisted status, not a request enum", () => {
    expect(
      deriveChangeNoticeImpactDecisionOperation({
        existingStatus: null,
        requestedStatus: "Resolved"
      })
    ).toBe("createDecision");
    expect(
      deriveChangeNoticeImpactDecisionOperation({
        existingStatus: "No action required",
        requestedStatus: "Action required"
      })
    ).toBe("reassessDecision");
    expect(
      deriveChangeNoticeImpactDecisionOperation({
        existingStatus: "Action required",
        requestedStatus: "No action required"
      })
    ).toBe("correctDecision");
    expect(
      deriveChangeNoticeImpactDecisionOperation({
        existingStatus: "Resolved",
        requestedStatus: "Action required"
      })
    ).toBe("reopenDecision");
    expect(
      deriveChangeNoticeImpactDecisionOperation({
        existingStatus: "Resolved",
        requestedStatus: "No action required"
      })
    ).toBe("correctDecision");
  });

  it("enforces first-assessment conclusion evidence rules", () => {
    expect(
      validateChangeNoticeImpactFirstAssessment({
        targetType: "job",
        decisionStatus: "Action required"
      }).valid
    ).toBe(false);
    expect(
      validateChangeNoticeImpactFirstAssessment({
        targetType: "job",
        decisionStatus: "Resolved",
        resolutionNote: "Supplier cut-in was completed before this assessment."
      })
    ).toMatchObject({
      valid: true,
      rationale: null,
      resolutionNote: "Supplier cut-in was completed before this assessment."
    });
    expect(
      validateChangeNoticeImpactFirstAssessment({
        targetType: "purchaseOrderLine",
        decisionStatus: "No action required",
        noActionReasonCode: "No purchasing intervention remains",
        confirmNoPurchasingInterventionRemains: false,
        rationale: "Reviewed supplier action."
      }).valid
    ).toBe(false);
    expect(
      validateChangeNoticeImpactFirstAssessment({
        targetType: "purchaseOrderLine",
        decisionStatus: "No action required",
        noActionReasonCode: "Not affected after review"
      }).valid
    ).toBe(false);
    expect(
      validateChangeNoticeImpactFirstAssessment({
        targetType: "job",
        decisionStatus: "Action required",
        resolutionNote: "The work was completed outside Carbon."
      }).valid
    ).toBe(false);
    expect(
      validateChangeNoticeImpactFirstAssessment({
        targetType: "purchaseOrderLine",
        decisionStatus: "No action required",
        noActionReasonCode: "Not affected after review",
        confirmNoPurchasingInterventionRemains: true,
        rationale: "Reviewed supplier action."
      }).valid
    ).toBe(false);
  });

  it("persists a first assessment, provenance, and both initial history events atomically", async () => {
    const recorder = makeImpactKyselyRecorder();
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        rationale: "Supplier cut-in and replacement still need follow-up."
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.operation).toBe("createDecision");
    expect(recorder.committed).toBe(true);
    expect(recorder.rolledBack).toBe(false);
    expect(recorder.inserts).toHaveLength(3);
    expect(recorder.inserts[0]).toMatchObject({
      table: "changeOrderImpactDecision",
      values: expect.objectContaining({
        companyId,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        snapshotVersion: 1,
        revision: 1
      })
    });
    expect(
      (recorder.inserts[0].values as Record<string, unknown>).assessmentSnapshot
    ).toMatchObject({
      schema: PO_LINE_SNAPSHOT_V1,
      purchaseOrderLineId: "pol-1",
      itemId: "item-1",
      remainingQuantity: 8,
      eligibilityBasis: OPEN_PURCHASING_COMMITMENT
    });
    expect(recorder.inserts[1]).toMatchObject({
      table: "changeOrderImpactDecisionAffectedItem",
      values: expect.objectContaining({
        companyId,
        affectedItemId: "affected-1",
        affectedItemSourceId: "item-1",
        affectedItemLabel: "PART-1 Rev A"
      })
    });
    expect(recorder.inserts[2]).toMatchObject({
      table: "changeOrderImpactDecisionHistory",
      values: expect.arrayContaining([
        expect.objectContaining({ eventType: "Decision created" }),
        expect.objectContaining({
          eventType: "Provenance started",
          relatedAffectedItemId: "affected-1"
        })
      ])
    });
  });

  it("reassesses No action required to Action required with rationale", async () => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: {
        decisionStatus: "No action required",
        noActionReasonCode: "Not affected after review",
        rationale: "The original review found no consequence."
      }
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        rationale: "New receiving exposure requires supplier cut-in follow-up.",
        expectedRevision: 1
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.operation).toBe("reassessDecision");
    expect(recorder.inserts[0]).toMatchObject({
      table: "changeOrderImpactDecisionHistory",
      values: [
        expect.objectContaining({
          eventType: "Decision reassessed",
          previousStatus: "No action required",
          newStatus: "Action required",
          previousReasonCode: "Not affected after review",
          newReasonCode: null
        })
      ]
    });
  });

  it("corrects an existing assessment with a revision and truthful history", async () => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: {
        id: "decision-1",
        decisionStatus: "Action required",
        revision: 1
      }
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "No action required",
        noActionReasonCode: "Not affected after review",
        rationale: "The supplier had cancelled before the original assessment.",
        expectedRevision: 1
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.operation).toBe("correctDecision");
    expect(result.data?.decision.revision).toBe(2);
    expect(recorder.updates).toEqual([
      expect.objectContaining({
        table: "changeOrderImpactDecision",
        values: expect.objectContaining({
          decisionStatus: "No action required",
          revision: 2,
          updatedBy: "user-1"
        })
      })
    ]);
    expect(recorder.inserts).toHaveLength(1);
    expect(recorder.inserts[0]).toMatchObject({
      table: "changeOrderImpactDecisionHistory",
      values: [
        expect.objectContaining({
          eventType: "Conclusion corrected",
          previousStatus: "Action required",
          newStatus: "No action required",
          priorAssessmentWasChanged: false
        })
      ]
    });
    expect(recorder.committed).toBe(true);
    expect(recorder.rolledBack).toBe(false);
  });

  it("returns a no-op without mutating decision, provenance, or history", async () => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: { decisionStatus: "Action required" }
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        expectedRevision: 1
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.operation).toBe("noOp");
    expect(result.data?.decision.revision).toBe(1);
    expect(recorder.updates).toEqual([]);
    expect(recorder.inserts).toEqual([]);
    expect(recorder.committed).toBe(true);
  });

  it("preserves an existing purchasing reason without repeated attestation", async () => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: {
        decisionStatus: "No action required",
        noActionReasonCode: "No purchasing intervention remains",
        rationale:
          "Supplier return, replacement, credit, and communication were reviewed."
      }
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "No action required",
        rationale: "The existing purchasing review remains valid.",
        expectedRevision: 1
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.operation).toBe("updateDecision");
    expect(recorder.updates).toHaveLength(1);
    expect(recorder.inserts[0]).toMatchObject({
      table: "changeOrderImpactDecisionHistory",
      values: [
        expect.objectContaining({
          previousReasonCode: "No purchasing intervention remains",
          newReasonCode: "No purchasing intervention remains"
        })
      ]
    });
  });

  it("requires the current revision for an existing assessment", async () => {
    const missingRevision = makeImpactKyselyRecorder({
      existingDecision: { decisionStatus: "Action required" }
    });
    const missingResult = await writeChangeNoticeImpactDecision(
      missingRevision.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required"
      }
    );
    expect(missingResult.error?.message).toBe(
      "Existing Impact assessments require an expected decision revision."
    );
    expect(missingRevision.updates).toEqual([]);
    expect(missingRevision.inserts).toEqual([]);

    const staleRevision = makeImpactKyselyRecorder({
      existingDecision: { decisionStatus: "Action required", revision: 3 }
    });
    const staleResult = await writeChangeNoticeImpactDecision(
      staleRevision.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        expectedRevision: 2
      }
    );
    expect(staleResult.error?.message).toBe(
      "This Impact assessment changed before your update. Refresh and try again."
    );
    expect(staleRevision.updates).toEqual([]);
    expect(staleRevision.inserts).toEqual([]);
  });

  it("maps a failed revision compare-and-swap update to the revision conflict", async () => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: { decisionStatus: "Action required" },
      updateReturnsNoRow: true
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        rationale: "The follow-up owner changed.",
        expectedRevision: 1
      }
    );

    expect(result.error?.message).toBe(
      "This Impact assessment changed before your update. Refresh and try again."
    );
    expect(recorder.updates).toHaveLength(1);
    expect(recorder.inserts).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("persists a meaningful same-state update as reassessment history", async () => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: { decisionStatus: "Action required" }
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        rationale: "The replacement path and supplier communication changed.",
        expectedRevision: 1
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.operation).toBe("updateDecision");
    expect(recorder.updates).toHaveLength(1);
    expect(recorder.inserts).toHaveLength(1);
    expect(recorder.inserts[0]).toMatchObject({
      table: "changeOrderImpactDecisionHistory",
      values: [
        expect.objectContaining({
          eventType: "Decision reassessed",
          previousStatus: "Action required",
          newStatus: "Action required",
          priorAssessmentWasChanged: false
        })
      ]
    });
  });

  it("reassesses when the canonical source snapshot changed", async () => {
    const changedSnapshot = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({ quantityToReceive: 7 })
    );
    if (changedSnapshot.sourceAvailability !== "Present") {
      throw new Error("Test PO snapshot must be present");
    }
    const recorder = makeImpactKyselyRecorder({
      existingDecision: {
        decisionStatus: "Action required",
        assessmentSnapshot: changedSnapshot.snapshot
      }
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        expectedRevision: 1
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.operation).toBe("updateDecision");
    expect(result.data?.decision.revision).toBe(2);
    expect(recorder.inserts[0]).toMatchObject({
      table: "changeOrderImpactDecisionHistory",
      values: [
        expect.objectContaining({
          eventType: "Decision reassessed",
          priorAssessmentWasChanged: true
        })
      ]
    });
  });

  it("reconciles provenance without mutating the decision and repeats as a no-op", async () => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: { decisionStatus: "Action required" },
      existingProvenance: [
        {
          id: "provenance-old",
          affectedItemId: "affected-old",
          affectedItemSourceId: "item-1",
          affectedItemLabel: "PART-1 Rev A",
          startedAt: "2026-08-23T00:00:00.000Z",
          startedBy: "user-0",
          endedAt: null,
          endedBy: null,
          endedReason: null
        }
      ]
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        expectedRevision: 1
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.operation).toBe("updateDecision");
    expect(result.data?.decision).toMatchObject({
      decisionStatus: "Action required",
      assessmentSnapshot: expect.objectContaining({
        schema: PO_LINE_SNAPSHOT_V1
      }),
      snapshotVersion: 1,
      assessedBy: "user-0",
      assessedAt: "2026-08-24T00:00:00.000Z",
      revision: 1
    });
    expect(recorder.updates).toHaveLength(1);
    expect(recorder.updates[0]).toMatchObject({
      table: "changeOrderImpactDecisionAffectedItem",
      values: {
        endedBy: "user-1",
        endedReason: "Affected item provenance changed before reassessment"
      }
    });
    expect(recorder.updates).not.toContainEqual(
      expect.objectContaining({ table: "changeOrderImpactDecision" })
    );
    expect(recorder.inserts).toHaveLength(2);
    expect(recorder.inserts[0]).toMatchObject({
      table: "changeOrderImpactDecisionAffectedItem",
      values: expect.objectContaining({ affectedItemId: "affected-1" })
    });
    expect(recorder.inserts[1]).toMatchObject({
      table: "changeOrderImpactDecisionHistory",
      values: expect.arrayContaining([
        expect.objectContaining({
          eventType: "Provenance ended",
          relatedAffectedItemId: "affected-old",
          rationale: "Affected item provenance changed before reassessment"
        }),
        expect.objectContaining({
          eventType: "Provenance started",
          relatedAffectedItemId: "affected-1"
        })
      ])
    });

    const repeated = makeImpactKyselyRecorder({
      existingDecision: { decisionStatus: "Action required" },
      existingProvenance: [
        {
          id: "provenance-current",
          affectedItemId: "affected-1",
          affectedItemSourceId: "item-1",
          affectedItemLabel: "PART-1 Rev A",
          startedAt: "2026-08-25T00:00:00.000Z",
          startedBy: "user-1",
          endedAt: null,
          endedBy: null,
          endedReason: null
        }
      ]
    });
    const repeatedResult = await writeChangeNoticeImpactDecision(
      repeated.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-2",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        expectedRevision: 1
      }
    );

    expect(repeatedResult.error).toBeNull();
    expect(repeatedResult.data?.operation).toBe("noOp");
    expect(repeatedResult.data?.decision).toMatchObject({
      assessedBy: "user-0",
      assessedAt: "2026-08-24T00:00:00.000Z",
      revision: 1
    });
    expect(repeated.updates).toEqual([]);
    expect(repeated.inserts).toEqual([]);
  });

  it("corrects Resolved to No action only with a new correction rationale", async () => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: {
        decisionStatus: "Resolved",
        rationale: "Previously closed with supplier evidence.",
        resolutionNote: "Supplier replacement was completed."
      }
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "No action required",
        noActionReasonCode: "Not affected after review",
        rationale:
          "The supplier had cancelled before any intervention was needed.",
        expectedRevision: 1
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.operation).toBe("correctDecision");
    expect(result.data?.decision.resolutionNote).toBeNull();
    expect(recorder.inserts[0]).toMatchObject({
      table: "changeOrderImpactDecisionHistory",
      values: [
        expect.objectContaining({
          eventType: "Conclusion corrected",
          previousStatus: "Resolved",
          newStatus: "No action required"
        })
      ]
    });
  });

  it("reopens a resolved assessment without changing resolution behavior", async () => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: {
        decisionStatus: "Resolved",
        rationale: "Previously closed with supplier evidence.",
        resolutionNote: "Supplier replacement was completed."
      }
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        rationale: "The supplier replacement no longer covers this line.",
        expectedRevision: 1
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.operation).toBe("reopenDecision");
    expect(result.data?.decision.resolutionNote).toBeNull();
    expect(recorder.inserts[0]).toMatchObject({
      table: "changeOrderImpactDecisionHistory",
      values: [expect.objectContaining({ eventType: "Decision reopened" })]
    });
  });

  it.each([
    "Pending",
    "In Progress"
  ])("rejects resolution while a linked task is %s without writing decision history", async (taskStatus) => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: { decisionStatus: "Action required" },
      impactTasks: [
        {
          id: "task-1",
          companyId,
          changeOrderId: changeNoticeId,
          status: taskStatus
        }
      ],
      impactTaskLinks: [
        {
          decisionId: "decision-1",
          actionTaskId: "task-1",
          companyId
        }
      ]
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Resolved",
        resolutionNote: "Supplier replacement was completed.",
        expectedRevision: 1
      }
    );

    expect(result.error?.message).toBe(
      "All linked Impact tasks must be Completed or Skipped before resolution."
    );
    expect(recorder.updates).toEqual([]);
    expect(recorder.inserts).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it.each([
    "Completed",
    "Skipped"
  ])("allows resolution when every linked task is %s", async (taskStatus) => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: { decisionStatus: "Action required" },
      impactTasks: [
        {
          id: "task-1",
          companyId,
          changeOrderId: changeNoticeId,
          status: taskStatus
        }
      ],
      impactTaskLinks: [
        {
          decisionId: "decision-1",
          actionTaskId: "task-1",
          companyId
        }
      ]
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Resolved",
        resolutionNote: "Supplier replacement was completed.",
        expectedRevision: 1
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.operation).toBe("resolveActionRequired");
    expect(recorder.committed).toBe(true);
  });

  it.each([
    "Draft",
    "Start",
    "Engineering Complete",
    "Implementation",
    "Done",
    "Cancelled"
  ])("resolves an existing Action Required decision in %s", async (status) => {
    const recorder = makeImpactKyselyRecorder({
      changeNoticeStatus: status,
      existingDecision: { decisionStatus: "Action required" },
      forbidSelectTables: [
        "purchaseOrderLine",
        "purchaseOrder",
        "purchaseOrderDelivery",
        "item",
        "job",
        "jobMakeMethod",
        "jobMaterial",
        "changeOrderImpactDecisionAffectedItem"
      ]
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Resolved",
        resolutionNote: "  Supplier replacement was completed.  ",
        expectedRevision: 1
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.operation).toBe("resolveActionRequired");
    expect(result.data?.decision).toMatchObject({
      id: "decision-1",
      targetType: "purchaseOrderLine",
      targetId: "pol-1",
      decisionStatus: "Resolved",
      noActionReasonCode: null,
      rationale: "Existing assessment",
      resolutionNote: "Supplier replacement was completed.",
      assessmentSnapshot: expect.objectContaining({
        schema: PO_LINE_SNAPSHOT_V1,
        purchaseOrderLineId: "pol-1"
      }),
      snapshotVersion: 1,
      assessedBy: "user-0",
      assessedAt: "2026-08-24T00:00:00.000Z",
      revision: 2
    });
    expect(recorder.selects).toEqual([
      "changeOrder",
      "changeOrderImpactDecision",
      "changeOrderImpactDecisionActionTask"
    ]);
    expect(recorder.updates).toEqual([
      expect.objectContaining({
        table: "changeOrderImpactDecision",
        values: expect.objectContaining({
          decisionStatus: "Resolved",
          noActionReasonCode: null,
          resolutionNote: "Supplier replacement was completed.",
          revision: 2,
          updatedBy: "user-1",
          updatedAt: expect.any(String)
        })
      })
    ]);
    expect(recorder.updates[0]?.values).not.toHaveProperty(
      "assessmentSnapshot"
    );
    expect(recorder.updates[0]?.values).not.toHaveProperty("snapshotVersion");
    expect(recorder.updates[0]?.values).not.toHaveProperty("assessedBy");
    expect(recorder.updates[0]?.values).not.toHaveProperty("assessedAt");
    expect(recorder.updates[0]?.values).not.toHaveProperty("rationale");
    expect(recorder.inserts).toEqual([
      expect.objectContaining({
        table: "changeOrderImpactDecisionHistory",
        values: [
          expect.objectContaining({
            eventType: "Decision resolved",
            previousStatus: "Action required",
            newStatus: "Resolved",
            previousReasonCode: null,
            newReasonCode: null,
            previousSnapshot: expect.objectContaining({
              schema: PO_LINE_SNAPSHOT_V1,
              purchaseOrderLineId: "pol-1"
            }),
            newSnapshot: expect.objectContaining({
              schema: PO_LINE_SNAPSHOT_V1,
              purchaseOrderLineId: "pol-1"
            }),
            rationale: "Existing assessment",
            resolutionNote: "Supplier replacement was completed.",
            priorAssessmentWasChanged: false,
            createdBy: "user-1",
            createdAt: expect.any(String)
          })
        ]
      })
    ]);
    expect(recorder.committed).toBe(true);
    expect(recorder.rolledBack).toBe(false);
  });

  it.each([
    undefined,
    null,
    "   "
  ])("requires nonblank closure evidence for resolution (%s)", async (resolutionNote) => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: { decisionStatus: "Action required" }
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Resolved",
        resolutionNote,
        expectedRevision: 1
      }
    );

    expect(result.error?.message).toBe(
      "Resolved requires written closure evidence."
    );
    expect(recorder.updates).toEqual([]);
    expect(recorder.inserts).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("maps a failed resolution CAS update to the revision conflict", async () => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: { decisionStatus: "Action required" },
      updateReturnsNoRow: true,
      forbidSelectTables: [
        "purchaseOrderLine",
        "purchaseOrder",
        "purchaseOrderDelivery",
        "item",
        "job",
        "jobMakeMethod",
        "jobMaterial",
        "changeOrderImpactDecisionAffectedItem"
      ]
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Resolved",
        resolutionNote: "Supplier replacement was completed.",
        expectedRevision: 1
      }
    );

    expect(result.error?.message).toBe(
      "This Impact assessment changed before your update. Refresh and try again."
    );
    expect(recorder.updates).toHaveLength(1);
    expect(recorder.inserts).toEqual([]);
    expect(recorder.committed).toBe(false);
    expect(recorder.rolledBack).toBe(true);
  });

  it("rejects an unusable persisted snapshot before resolution", async () => {
    const current = normalizePurchaseOrderLineImpactSnapshot(basePoInput());
    if (current.sourceAvailability !== "Present") {
      throw new Error("Test PO snapshot must be present");
    }

    for (const existingDecision of [
      { snapshotVersion: 2 },
      { assessmentSnapshot: {} },
      {
        assessmentSnapshot: {
          ...current.snapshot,
          purchaseOrderLineId: "pol-other"
        }
      }
    ]) {
      const recorder = makeImpactKyselyRecorder({
        existingDecision: {
          decisionStatus: "Action required",
          ...existingDecision
        }
      });
      const result = await writeChangeNoticeImpactDecision(
        recorder.db as unknown as Kysely<KyselyDatabase>,
        {
          companyId,
          userId: "user-1",
          sourceAccess,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-1",
          decisionStatus: "Resolved",
          resolutionNote: "Supplier replacement was completed.",
          expectedRevision: 1
        }
      );

      expect(result.error?.message).toBe(
        "Stored Impact assessment snapshot is unavailable for resolution."
      );
      expect(recorder.updates).toEqual([]);
      expect(recorder.inserts).toEqual([]);
      expect(recorder.rolledBack).toBe(true);
    }
  });

  it("rolls back a resolution when its history insertion fails", async () => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: { decisionStatus: "Action required" },
      failInsertTable: "changeOrderImpactDecisionHistory",
      failInsertError: new Error("history write failed")
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Resolved",
        resolutionNote: "Supplier replacement was completed.",
        expectedRevision: 1
      }
    );

    expect(result.error?.message).toBe("history write failed");
    expect(recorder.updates).toHaveLength(1);
    expect(recorder.inserts).toHaveLength(1);
    expect(recorder.inserts[0]?.table).toBe("changeOrderImpactDecisionHistory");
    expect(recorder.committed).toBe(false);
    expect(recorder.rolledBack).toBe(true);
  });

  it("rejects No action required to Resolved as an invalid transition", async () => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: {
        decisionStatus: "No action required",
        noActionReasonCode: "Not affected after review",
        rationale: "The original review found no consequence."
      }
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Resolved",
        resolutionNote: "Supplier replacement was completed.",
        expectedRevision: 1
      }
    );

    expect(result.error?.message).toBe(
      "No action required decisions cannot transition directly to Resolved."
    );
    expect(recorder.updates).toEqual([]);
    expect(recorder.inserts).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("blocks existing-decision mutations outside the allowed lifecycle", async () => {
    const recorder = makeImpactKyselyRecorder({
      changeNoticeStatus: "Cancelled",
      existingDecision: { decisionStatus: "Action required" }
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        expectedRevision: 1
      }
    );

    expect(result.error?.message).toBe(
      "Cancelled Change Notices do not accept Impact reassessment."
    );
    expect(recorder.updates).toEqual([]);
    expect(recorder.inserts).toEqual([]);
  });

  it("rolls back an existing-decision update when history insertion fails", async () => {
    const recorder = makeImpactKyselyRecorder({
      existingDecision: { decisionStatus: "Action required" },
      failInsertTable: "changeOrderImpactDecisionHistory",
      failInsertError: new Error("history write failed")
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        rationale: "The follow-up owner changed.",
        expectedRevision: 1
      }
    );

    expect(result.error?.message).toBe("history write failed");
    expect(recorder.updates).toHaveLength(1);
    expect(recorder.committed).toBe(false);
    expect(recorder.rolledBack).toBe(true);
  });

  it("rolls back all writes when the initial history insert fails", async () => {
    const recorder = makeImpactKyselyRecorder({
      failInsertTable: "changeOrderImpactDecisionHistory",
      failInsertError: new Error("history write failed")
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        rationale: "Supplier cut-in still needs follow-up."
      }
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("history write failed");
    expect(recorder.committed).toBe(false);
    expect(recorder.rolledBack).toBe(true);
    expect(recorder.inserts.map((insert) => insert.table)).toEqual([
      "changeOrderImpactDecision",
      "changeOrderImpactDecisionAffectedItem",
      "changeOrderImpactDecisionHistory"
    ]);
  });

  it("ends open provenance and records removal history before deleting scope", async () => {
    const recorder = makeImpactRemovalKyselyRecorder();
    const result = await removeChangeNoticeAffectedItem(
      {} as SupabaseClient<Database>,
      recorder.db as unknown as Kysely<KyselyDatabase>,
      "affected-1",
      changeNoticeId,
      companyId,
      "user-2"
    );

    expect(result).toEqual({ data: null, error: null });
    expect(recorder.committed).toBe(true);
    expect(recorder.rolledBack).toBe(false);
    expect(recorder.updates).toEqual([
      expect.objectContaining({
        table: "changeOrderImpactDecisionAffectedItem",
        values: expect.objectContaining({
          endedBy: "user-2",
          endedReason: "Affected item removed from Change Notice"
        })
      })
    ]);
    expect(recorder.inserts).toEqual([
      expect.objectContaining({
        table: "changeOrderImpactDecisionHistory",
        values: [
          expect.objectContaining({
            eventType: "Provenance ended",
            decisionId: "decision-1",
            relatedAffectedItemId: "affected-1",
            createdBy: "user-2"
          })
        ]
      })
    ]);
    expect(recorder.deletes).toEqual(["changeOrderAffectedItem"]);
  });

  it("rolls back provenance reconciliation when removal history fails", async () => {
    const recorder = makeImpactRemovalKyselyRecorder({
      failInsertTable: "changeOrderImpactDecisionHistory"
    });
    const result = await removeChangeNoticeAffectedItem(
      {} as SupabaseClient<Database>,
      recorder.db as unknown as Kysely<KyselyDatabase>,
      "affected-1",
      changeNoticeId,
      companyId,
      "user-2"
    );

    expect(result.error?.message).toBe("history write failed");
    expect(recorder.committed).toBe(false);
    expect(recorder.rolledBack).toBe(true);
    expect(recorder.deletes).toEqual([]);
  });

  it("writes the same atomic seam for Jobs and Job Materials", async () => {
    const cases = [
      {
        targetType: "job" as const,
        targetId: "job-1",
        decisionStatus: "Action required" as const,
        rationale: "The producing job still needs a cut-in review."
      },
      {
        targetType: "jobMaterial" as const,
        targetId: "material-1",
        decisionStatus: "No action required" as const,
        noActionReasonCode: "Not affected after review" as const,
        rationale: "The material use was reviewed and needs no intervention."
      }
    ];

    for (const assessment of cases) {
      const recorder = makeImpactKyselyRecorder();
      const result = await writeChangeNoticeImpactDecision(
        recorder.db as unknown as Kysely<KyselyDatabase>,
        {
          companyId,
          userId: "user-1",
          sourceAccess,
          changeNoticeId,
          ...assessment
        }
      );

      expect(result.error).toBeNull();
      expect(result.data?.decision.targetType).toBe(assessment.targetType);
      expect(result.data?.decision.targetId).toBe(assessment.targetId);
      expect(result.data?.decision.assessmentSnapshot.schema).toBe(
        assessment.targetType === "job"
          ? JOB_SNAPSHOT_V1
          : JOB_MATERIAL_SNAPSHOT_V1
      );
      expect(recorder.committed).toBe(true);
      expect(recorder.inserts).toHaveLength(3);
    }
  });

  it("maps the target unique conflict to a retryable first-assessment error", async () => {
    const recorder = makeImpactKyselyRecorder({
      failInsertTable: "changeOrderImpactDecision"
    });
    const result = await writeChangeNoticeImpactDecision(
      recorder.db as unknown as Kysely<KyselyDatabase>,
      {
        companyId,
        userId: "user-1",
        sourceAccess,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        rationale: "Supplier cut-in still needs follow-up."
      }
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("assessed by someone else");
    expect(recorder.committed).toBe(false);
    expect(recorder.rolledBack).toBe(true);
  });

  it("enforces reason applicability and rationale rules", () => {
    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure"
      }).valid
    ).toBe(false);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure",
        effectivityProof: {
          complete: true,
          decisionRelevant: true,
          outsideEffectivity: true,
          ambiguous: false
        }
      }).valid
    ).toBe(true);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure",
        effectivityProof: {
          complete: true,
          decisionRelevant: true,
          outsideEffectivity: true,
          ambiguous: true
        }
      }).valid
    ).toBe(false);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure",
        effectivityProof: {
          complete: true,
          decisionRelevant: true,
          outsideEffectivity: true,
          ambiguous: true
        },
        rationale: "The applicability evidence is ambiguous but was reviewed."
      }).valid
    ).toBe(true);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure",
        effectivityProof: {
          complete: false,
          decisionRelevant: true,
          outsideEffectivity: true,
          ambiguous: false
        }
      }).valid
    ).toBe(false);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure",
        effectivityProof: {
          complete: true,
          decisionRelevant: false,
          outsideEffectivity: true,
          ambiguous: false
        }
      }).valid
    ).toBe(false);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure",
        effectivityProof: {
          complete: true,
          decisionRelevant: true,
          outsideEffectivity: false,
          ambiguous: false
        }
      }).valid
    ).toBe(false);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Not affected after review",
        exposureClassification: "Current operational exposure"
      }).valid
    ).toBe(false);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "purchaseOrderLine",
        reasonCode: "No purchasing intervention remains",
        exposureClassification: "Current operational exposure",
        purchasingInterventionConfirmation: {
          supplierReturnReviewed: true,
          replacementReviewed: true,
          creditReviewed: true,
          communicationReviewed: true,
          noInterventionRemains: true
        },
        rationale:
          "Supplier return, replacement, credit, and communication were reviewed."
      }).valid
    ).toBe(true);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "purchaseOrderLine",
        reasonCode: "No purchasing intervention remains",
        exposureClassification: "Historical reference",
        rationale: "The line is complete."
      }).valid
    ).toBe(false);
  });

  it("classifies the supported lifecycle matrices without treating display statuses as lifecycle", () => {
    for (const status of [
      "Draft",
      "Planned",
      "Needs Approval",
      "To Review",
      "To Receive",
      "To Receive and Invoice",
      "To Invoice"
    ]) {
      expect(
        classifyPurchaseOrderLineImpactEligibility({
          purchaseOrderLineType: "Part",
          purchaseOrderStatus: status,
          receivedComplete: false,
          remainingQuantity: 1
        })
      ).toBe("Current operational exposure");
    }
    for (const status of ["Completed", "Closed", "Rejected"]) {
      expect(
        classifyPurchaseOrderLineImpactEligibility({
          purchaseOrderLineType: "Part",
          purchaseOrderStatus: status,
          receivedComplete: false,
          remainingQuantity: 1
        })
      ).toBe("Historical reference");
    }
    expect(
      classifyPurchaseOrderLineImpactEligibility({
        purchaseOrderLineType: "Part",
        purchaseOrderStatus: "Cancelled",
        receivedComplete: false,
        remainingQuantity: 1
      })
    ).toBe("Unavailable");

    for (const status of [
      "Draft",
      "Planned",
      "Ready",
      "In Progress",
      "Paused"
    ]) {
      expect(classifyJobImpactEligibility(status)).toBe(
        "Current operational exposure"
      );
    }
    for (const status of ["Completed", "Closed", "Cancelled"]) {
      expect(classifyJobImpactEligibility(status)).toBe("Historical reference");
    }
    expect(classifyJobImpactEligibility("Overdue")).toBe("Unavailable");
    expect(classifyJobMaterialImpactEligibility("In Progress")).toBe(
      "Current operational exposure"
    );
  });

  it("keeps accepted PO line types assessable and treats non-assessment types as historical", () => {
    for (const purchaseOrderLineType of [
      "Part",
      "Material",
      "Tool",
      "Consumable",
      "Fixture"
    ]) {
      expect(
        classifyPurchaseOrderLineImpactEligibility({
          purchaseOrderLineType,
          purchaseOrderStatus: "To Receive",
          receivedComplete: false,
          remainingQuantity: 1
        })
      ).toBe("Current operational exposure");
    }
    for (const purchaseOrderLineType of [
      "Comment",
      "G/L Account",
      "Fixed Asset",
      "Service"
    ]) {
      expect(
        classifyPurchaseOrderLineImpactEligibility({
          purchaseOrderLineType,
          purchaseOrderStatus: "To Receive",
          receivedComplete: false,
          remainingQuantity: 1
        })
      ).toBe("Historical reference");
    }
    expect(
      classifyPurchaseOrderLineImpactEligibility({
        purchaseOrderLineType: "Part",
        purchaseOrderStatus: "To Receive",
        receivedComplete: true,
        remainingQuantity: 1
      })
    ).toBe("Historical reference");
    expect(
      classifyPurchaseOrderLineImpactEligibility({
        purchaseOrderLineType: "Part",
        purchaseOrderStatus: "To Receive",
        receivedComplete: false,
        remainingQuantity: 0
      })
    ).toBe("Historical reference");
    expect(
      classifyPurchaseOrderLineImpactEligibility({
        purchaseOrderLineType: "Part",
        purchaseOrderStatus: "To Receive",
        receivedComplete: false,
        remainingQuantity: 0.000001,
        conversionFactor: 1
      })
    ).toBe("Historical reference");
  });
});

describe("Change Notice Impact snapshot normalizers", () => {
  it("normalizes PO quantities with Carbon precision and preserves explicit nulls", () => {
    const result = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({
        itemRevision: null,
        purchaseUnitOfMeasureCode: null,
        requiredDate: null,
        promisedDate: null,
        deliveryReceiptPromisedDate: "2026-08-31",
        purchaseQuantity: 1.234567,
        quantityReceived: 0.234567,
        quantityToReceive: 1
      })
    );
    expect(result.sourceAvailability).toBe("Present");
    if (result.sourceAvailability !== "Present") return;
    expect(Object.keys(result.snapshot)).toEqual([
      "schema",
      "purchaseOrderLineId",
      "purchaseOrderId",
      "supplierId",
      "itemId",
      "itemRevision",
      "purchaseOrderLineType",
      "purchaseOrderStatus",
      "receivedComplete",
      "orderedQuantity",
      "receivedQuantity",
      "remainingQuantity",
      "purchaseUnitOfMeasureCode",
      "inventoryUnitOfMeasureCode",
      "conversionFactor",
      "requiredDate",
      "promisedDate",
      "eligibilityBasis"
    ]);
    expect(result.snapshot).toMatchObject({
      schema: PO_LINE_SNAPSHOT_V1,
      orderedQuantity: 1.23457,
      receivedQuantity: 0.23457,
      remainingQuantity: 1,
      conversionFactor: 2,
      itemRevision: null,
      purchaseUnitOfMeasureCode: null,
      requiredDate: null,
      promisedDate: "2026-08-31",
      eligibilityBasis: OPEN_PURCHASING_COMMITMENT
    });
  });

  it("keeps PO snapshot quantities in purchase UOM while storing conversionFactor separately", () => {
    const result = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({
        purchaseQuantity: 10,
        quantityReceived: 2,
        quantityToReceive: 8,
        conversionFactor: 12
      })
    );
    expect(result.sourceAvailability).toBe("Present");
    if (result.sourceAvailability !== "Present") return;
    expect(result.snapshot).toMatchObject({
      orderedQuantity: 10,
      receivedQuantity: 2,
      remainingQuantity: 8,
      conversionFactor: 12
    });
    expect(result.snapshot).not.toMatchObject({
      orderedQuantity: 120,
      receivedQuantity: 24,
      remainingQuantity: 96
    });
  });

  it("canonicalizes conversion factors and rejects non-positive canonical values", () => {
    for (const [conversionFactor, expected] of [
      [null, 1],
      [1, 1],
      [1.234567, 1.23457],
      [0.000006, 0.00001]
    ] as const) {
      expect(
        normalizePurchaseOrderLineImpactSnapshot(
          basePoInput({ conversionFactor })
        )
      ).toMatchObject({
        sourceAvailability: "Present",
        snapshot: { conversionFactor: expected }
      });
    }

    for (const conversionFactor of [0, -1, 0.000001]) {
      expectUnavailable(
        normalizePurchaseOrderLineImpactSnapshot(
          basePoInput({ conversionFactor })
        )
      );
    }
  });

  it("rejects negative operational quantities in each supported snapshot", () => {
    for (const field of [
      "purchaseQuantity",
      "quantityReceived",
      "quantityToReceive"
    ]) {
      expectUnavailable(
        normalizePurchaseOrderLineImpactSnapshot(basePoInput({ [field]: -1 }))
      );
    }

    for (const field of [
      "quantity",
      "quantityComplete",
      "quantityShipped",
      "quantityReceivedToInventory"
    ]) {
      expectUnavailable(
        normalizeJobImpactSnapshot(baseJobInput({ [field]: -1 }))
      );
    }

    for (const field of [
      "estimatedQuantity",
      "quantityIssued",
      "quantityToIssue"
    ]) {
      expectUnavailable(
        normalizeJobMaterialImpactSnapshot(baseMaterialInput({ [field]: -1 }))
      );
    }

    // Method version is metadata, not an operational quantity. Its existing
    // numeric contract remains independent from the quantity guard.
    expect(
      normalizeJobImpactSnapshot(baseJobInput({ effectiveMethodVersion: 1.5 }))
        .sourceAvailability
    ).toBe("Present");
  });

  it("normalizes Jobs from quantity, not productionQuantity", () => {
    const result = normalizeJobImpactSnapshot(
      baseJobInput({
        quantity: 100,
        productionQuantity: 110,
        remainingQuantity: 999
      })
    );
    expect(result.sourceAvailability).toBe("Present");
    if (result.sourceAvailability !== "Present") return;
    expect(result.snapshot).toMatchObject({
      plannedQuantity: 100,
      completedQuantity: 20,
      remainingQuantity: 80
    });
  });

  it("requires planned quantity or job.quantity instead of productionQuantity", () => {
    const productionOnly = {
      ...baseJobInput(),
      plannedQuantity: undefined,
      quantity: undefined
    };
    expectUnavailable(normalizeJobImpactSnapshot(productionOnly));
  });

  it("normalizes Jobs with base status and excludes display-only fields", () => {
    const result = normalizeJobImpactSnapshot(
      baseJobInput({
        status: "Overdue",
        name: "display name",
        updatedAt: "later"
      })
    );
    expectUnavailable(result);

    const present = normalizeJobImpactSnapshot(baseJobInput());
    expect(present.sourceAvailability).toBe("Present");
    if (present.sourceAvailability !== "Present") return;
    expect(Object.keys(present.snapshot)).toEqual([
      "schema",
      "jobId",
      "itemId",
      "itemRevision",
      "status",
      "plannedQuantity",
      "completedQuantity",
      "remainingQuantity",
      "quantityShipped",
      "quantityReceivedToInventory",
      "dueDate",
      "effectiveMethodId",
      "effectiveMethodVersion",
      "unitOfMeasureCode",
      "eligibilityBasis"
    ]);
    expect(present.snapshot).toMatchObject({
      schema: JOB_SNAPSHOT_V1,
      status: "In Progress",
      plannedQuantity: 100,
      completedQuantity: 20,
      remainingQuantity: 80,
      effectiveMethodId: "job-method-1",
      effectiveMethodVersion: 2,
      eligibilityBasis: ACTIVE_PRODUCING_JOB
    });
  });

  it("normalizes Job Materials with generated remaining quantity and tracking", () => {
    const result = normalizeJobMaterialImpactSnapshot(baseMaterialInput());
    expect(result.sourceAvailability).toBe("Present");
    if (result.sourceAvailability !== "Present") return;
    expect(Object.keys(result.snapshot)).toEqual([
      "schema",
      "jobMaterialId",
      "jobId",
      "itemId",
      "itemRevision",
      "jobStatus",
      "requiredQuantity",
      "issuedQuantity",
      "remainingQuantity",
      "unitOfMeasureCode",
      "methodType",
      "jobOperationId",
      "requiresTracking",
      "eligibilityBasis"
    ]);
    expect(result.snapshot).toMatchObject({
      schema: JOB_MATERIAL_SNAPSHOT_V1,
      requiredQuantity: 5,
      issuedQuantity: 5,
      remainingQuantity: 0,
      jobOperationId: null,
      requiresTracking: { batch: true, serial: false },
      eligibilityBasis: ACTIVE_JOB_MATERIAL
    });
    expect(classifyJobMaterialImpactEligibility("In Progress")).toBe(
      "Current operational exposure"
    );
  });

  it("distinguishes explicit null from missing nullable issued quantity", () => {
    const explicitNull = normalizeJobMaterialImpactSnapshot(
      baseMaterialInput({
        quantityIssued: null,
        itemRevision: null,
        unitOfMeasureCode: null
      })
    );
    expect(explicitNull.sourceAvailability).toBe("Present");
    if (
      explicitNull.sourceAvailability === "Present" &&
      explicitNull.snapshot.schema === JOB_MATERIAL_SNAPSHOT_V1
    ) {
      expect(Object.hasOwn(explicitNull.snapshot, "issuedQuantity")).toBe(true);
      expect(explicitNull.snapshot.issuedQuantity).toBeNull();
      expect(explicitNull.snapshot.itemRevision).toBeNull();
      expect(explicitNull.snapshot.unitOfMeasureCode).toBeNull();
    }

    const missingIssued = baseMaterialInput();
    Reflect.deleteProperty(missingIssued, "quantityIssued");
    expectUnavailable(normalizeJobMaterialImpactSnapshot(missingIssued));

    for (const value of [undefined, ""]) {
      expectUnavailable(
        normalizeJobMaterialImpactSnapshot(
          baseMaterialInput({ quantityIssued: value })
        )
      );
    }

    const numeric = normalizeJobMaterialImpactSnapshot(
      baseMaterialInput({ quantityIssued: 2.5 })
    );
    expect(numeric.sourceAvailability).toBe("Present");
    if (
      numeric.sourceAvailability === "Present" &&
      numeric.snapshot.schema === JOB_MATERIAL_SNAPSHOT_V1
    ) {
      expect(numeric.snapshot.issuedQuantity).toBe(2.5);
    }

    expectUnavailable(
      normalizeJobMaterialImpactSnapshot(
        baseMaterialInput({ quantityIssued: -0.000001 })
      )
    );
  });

  it("returns Unavailable for missing required facts and unknown snapshot versions", () => {
    expectUnavailable(
      normalizePurchaseOrderLineImpactSnapshot(
        basePoInput({ quantityToReceive: null })
      )
    );
    expectUnavailable(
      normalizePurchaseOrderLineImpactSnapshot(
        basePoInput({ requiredDate: "2026-99-99" })
      )
    );
    expectUnavailable(
      normalizePurchaseOrderLineImpactSnapshot(
        basePoInput({ purchaseUnitOfMeasureCode: 42 })
      )
    );
    expectUnavailable(
      normalizePurchaseOrderLineImpactSnapshot(
        basePoInput({ purchaseUnitOfMeasureCode: undefined })
      )
    );
    expectUnavailable(
      normalizePurchaseOrderLineImpactSnapshot(
        basePoInput({ requiredDate: undefined })
      )
    );
    expectUnavailable(
      normalizeJobImpactSnapshot(baseJobInput({ effectiveMethodId: null }))
    );
    expectUnavailable(
      normalizeJobMaterialImpactSnapshot(
        baseMaterialInput({ requiresBatchTracking: undefined })
      )
    );
    expectUnavailable(
      normalizeJobMaterialImpactSnapshot(
        baseMaterialInput({ jobOperationId: 42 })
      )
    );

    const current = normalizePurchaseOrderLineImpactSnapshot(basePoInput());
    expect(current.sourceAvailability).toBe("Present");
    if (current.sourceAvailability !== "Present") return;
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        current.snapshot,
        current.snapshot,
        2
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        current.snapshot,
        { ...current.snapshot, cosmeticLabel: "ignored?" },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        current.snapshot,
        { ...current.snapshot, itemRevision: "" },
        1
      )
    ).toBe("Unknown");
  });

  it("detects meaningful changes but ignores updatedAt/display-only source fields", () => {
    const current = normalizePurchaseOrderLineImpactSnapshot(basePoInput());
    const stored = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({ name: "old display", updatedAt: "old" })
    );
    expect(current.sourceAvailability).toBe("Present");
    expect(stored.sourceAvailability).toBe("Present");
    if (
      current.sourceAvailability !== "Present" ||
      stored.sourceAvailability !== "Present"
    ) {
      return;
    }
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        current.snapshot,
        stored.snapshot,
        1
      )
    ).toBe("Current");
    const changed = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({ quantityReceived: 3 })
    );
    expect(changed.sourceAvailability).toBe("Present");
    if (changed.sourceAvailability !== "Present") return;
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        changed.snapshot,
        stored.snapshot,
        1
      )
    ).toBe("Changed since assessment");
  });

  it("rejects non-canonical and negative persisted quantity evidence", () => {
    const po = normalizePurchaseOrderLineImpactSnapshot(basePoInput());
    const job = normalizeJobImpactSnapshot(baseJobInput());
    const material = normalizeJobMaterialImpactSnapshot(baseMaterialInput());
    const materialWithNull = normalizeJobMaterialImpactSnapshot(
      baseMaterialInput({ quantityIssued: null })
    );
    expect(po.sourceAvailability).toBe("Present");
    expect(job.sourceAvailability).toBe("Present");
    expect(material.sourceAvailability).toBe("Present");
    expect(materialWithNull.sourceAvailability).toBe("Present");
    if (
      po.sourceAvailability !== "Present" ||
      job.sourceAvailability !== "Present" ||
      material.sourceAvailability !== "Present" ||
      materialWithNull.sourceAvailability !== "Present"
    ) {
      return;
    }

    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        po.snapshot,
        { ...po.snapshot, orderedQuantity: 10.000001 },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        po.snapshot,
        { ...po.snapshot, orderedQuantity: -1 },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        po.snapshot,
        { ...po.snapshot, conversionFactor: 0 },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        po.snapshot,
        { ...po.snapshot, purchaseOrderLineId: "pol-other" },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "job",
        job.snapshot,
        { ...job.snapshot, plannedQuantity: 100.000001 },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "job",
        job.snapshot,
        { ...job.snapshot, remainingQuantity: 999 },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "job",
        job.snapshot,
        { ...job.snapshot, effectiveMethodVersion: 2.000001 },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "jobMaterial",
        material.snapshot,
        { ...material.snapshot, requiredQuantity: 5.000001 },
        1
      )
    ).toBe("Unknown");
    if (materialWithNull.snapshot.schema !== JOB_MATERIAL_SNAPSHOT_V1) {
      return;
    }
    expect(
      compareChangeNoticeImpactSnapshot(
        "jobMaterial",
        materialWithNull.snapshot,
        { ...materialWithNull.snapshot, issuedQuantity: null },
        1
      )
    ).toBe("Current");
  });
});

describe("Change Notice Impact provenance", () => {
  it("keeps repeated historical provenance intervals instead of deduplicating causes", () => {
    const result = deriveChangeNoticeImpactProvenance({
      sourceItemId: "item-b",
      currentAffectedItems: [
        { id: "affected-b", itemId: "item-b", label: "PART-B" }
      ],
      persistedProvenance: [
        {
          affectedItemId: "affected-a",
          affectedItemSourceId: "item-a",
          affectedItemLabel: "PART-A",
          endedAt: "2026-08-24T00:00:00Z",
          endedReason: "Source item changed"
        },
        {
          affectedItemId: "affected-b",
          affectedItemSourceId: "item-b",
          affectedItemLabel: "PART-B",
          endedAt: "2026-08-25T00:00:00Z",
          endedReason: "Source item changed"
        },
        {
          affectedItemId: "affected-a",
          affectedItemSourceId: "item-a",
          affectedItemLabel: "PART-A",
          endedAt: "2026-08-26T00:00:00Z",
          endedReason: "Source item changed again"
        }
      ]
    });

    expect(result.historicalProvenance).toHaveLength(3);
    expect(
      result.historicalProvenance.map((cause) => cause.endedReason)
    ).toEqual([
      "Source item changed",
      "Source item changed",
      "Source item changed again"
    ]);
  });

  it("keeps current and historical causes separate in a database-valid state", () => {
    const result = deriveChangeNoticeImpactProvenance({
      sourceItemId: "item-1",
      currentAffectedItems: [
        { id: "affected-1", itemId: "item-1", label: "PART-A" }
      ],
      persistedProvenance: [
        {
          affectedItemId: "removed",
          affectedItemSourceId: "item-old",
          affectedItemLabel: null,
          endedAt: "2026-08-24T00:00:00Z",
          endedReason: "Affected item removed from Change Notice"
        }
      ]
    });
    expect(result.currentProvenance).toEqual([
      expect.objectContaining({
        affectedItemId: "affected-1",
        status: "Current"
      })
    ]);
    expect(result.historicalProvenance).toEqual([
      expect.objectContaining({
        affectedItemId: "removed",
        affectedItemLabel: null,
        status: "Historical",
        endedReason: "Affected item removed from Change Notice"
      })
    ]);
  });
});

type FakeRow = Record<string, unknown>;

// PostgreSQL's verified en_US.UTF-8 order for Carbon's Base58 alphabet.
const VERIFIED_DATABASE_BASE58_ORDER =
  "123456789aAbBcCdDeEfFgGhHijJkKLmMnNopPqQrRsStTuUvVwWxXyYzZ";
const databaseBase58Ranks = new Map(
  [...VERIFIED_DATABASE_BASE58_ORDER].map((character, rank) => [
    character,
    rank
  ])
);

// Keep the fake's database model independent from the production pagination code.
// The fallback keeps non-Base58 fixture text on its existing locale-aware path.
function compareDatabaseIds(left: string, right: string): number {
  if (left === right) return 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftCharacter = left[index];
    const rightCharacter = right[index];
    if (leftCharacter === rightCharacter) continue;
    const leftRank = databaseBase58Ranks.get(leftCharacter);
    const rightRank = databaseBase58Ranks.get(rightCharacter);
    if (leftRank !== undefined && rightRank !== undefined) {
      return leftRank - rightRank;
    }
    return left.localeCompare(right);
  }
  return left.length - right.length;
}

type FakeClientOptions = {
  rows: Record<string, FakeRow[]>;
  errors?: Set<string>;
  queries?: string[];
  selects?: string[];
  inCalls?: Array<{
    table: string;
    column: string;
    values: unknown[];
  }>;
  ranges?: Array<{
    table: string;
    from: number;
    to: number;
  }>;
  maxRows?: number;
};

function fakeImpactClient(options: FakeClientOptions) {
  const queries = options.queries ?? [];
  const selects = options.selects ?? [];
  const inCalls = options.inCalls ?? [];
  const ranges = options.ranges ?? [];
  const errors = options.errors ?? new Set<string>();
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;

  return {
    queries,
    selects,
    inCalls,
    ranges,
    from(table: string) {
      queries.push(table);
      const state: {
        select: string;
        count: boolean;
        head: boolean;
        eq: Array<[string, unknown]>;
        in: Array<[string, unknown[]]>;
        gt: Array<[string, unknown]>;
        is: Array<[string, unknown]>;
        order: Array<{ column: string; ascending: boolean }>;
        range: [number, number] | null;
        limit: number | null;
        single: boolean;
      } = {
        select: "*",
        count: false,
        head: false,
        eq: [],
        in: [],
        gt: [],
        is: [],
        order: [],
        range: null,
        limit: null,
        single: false
      };

      const relatedValue = (row: FakeRow, column: string): unknown => {
        if (
          column === "purchaseOrder.status" ||
          column === "purchaseOrder.companyId"
        ) {
          const parent = options.rows.purchaseOrder?.find(
            (candidate) => candidate.id === row.purchaseOrderId
          );
          return column.endsWith("status")
            ? (parent?.status ?? row.purchaseOrderStatus)
            : (parent?.companyId ?? row.purchaseOrderCompanyId);
        }
        if (column === "job.status" || column === "job.companyId") {
          const parent = options.rows.job?.find(
            (candidate) => candidate.id === row.jobId
          );
          return column.endsWith("status")
            ? (parent?.status ?? row.jobStatus)
            : (parent?.companyId ?? row.jobCompanyId);
        }
        return row[column];
      };

      const hasParent = (row: FakeRow, relation: "purchaseOrder" | "job") =>
        relation === "purchaseOrder"
          ? options.rows.purchaseOrder?.some(
              (parent) => parent.id === row.purchaseOrderId
            )
          : options.rows.job?.some((parent) => parent.id === row.jobId);

      const builder = {
        select: (
          columns?: string,
          selectOptions?: { count?: string; head?: boolean }
        ) => {
          state.select = columns ?? "*";
          selects.push(state.select);
          state.count = selectOptions?.count === "exact";
          state.head = selectOptions?.head === true;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          state.eq.push([column, value]);
          return builder;
        },
        in: (column: string, values: unknown[]) => {
          state.in.push([column, values]);
          inCalls.push({ table, column, values: [...values] });
          return builder;
        },
        gt: (column: string, value: unknown) => {
          state.gt.push([column, value]);
          return builder;
        },
        is: (column: string, value: unknown) => {
          state.is.push([column, value]);
          return builder;
        },
        order: (column: string, orderOptions?: { ascending?: boolean }) => {
          state.order.push({
            column,
            ascending: orderOptions?.ascending !== false
          });
          return builder;
        },
        range: (from: number, to: number) => {
          state.range = [from, to];
          ranges.push({ table, from, to });
          return builder;
        },
        limit: (value: number) => {
          state.limit = value;
          return builder;
        },
        single: () => {
          state.single = true;
          return Promise.resolve(resolve());
        },
        maybeSingle: () => {
          state.single = true;
          return Promise.resolve(resolve(true));
        },
        then: (
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => Promise.resolve(resolve()).then(onFulfilled, onRejected)
      };

      function resolve(allowEmpty = false) {
        if (
          errors.has(table) ||
          (state.count && errors.has(`${table}:count`))
        ) {
          return {
            data: null,
            count: null,
            error: { message: `${table} failed` }
          };
        }
        let result = [...(options.rows[table] ?? [])];
        if (state.select.includes("purchaseOrder!inner")) {
          result = result.filter((row) => hasParent(row, "purchaseOrder"));
        }
        if (state.select.includes("job!inner")) {
          result = result.filter((row) => hasParent(row, "job"));
        }
        for (const [column, value] of state.eq) {
          result = result.filter((row) => relatedValue(row, column) === value);
        }
        for (const [column, values] of state.in) {
          result = result.filter((row) =>
            values.includes(relatedValue(row, column))
          );
        }
        for (const [column, value] of state.gt) {
          result = result.filter((row) => {
            const actual = relatedValue(row, column);
            if (typeof actual === "number" && typeof value === "number") {
              return actual > value;
            }
            return (
              typeof actual === "string" &&
              typeof value === "string" &&
              compareDatabaseIds(actual, value) > 0
            );
          });
        }
        for (const [column, value] of state.is) {
          result = result.filter((row) =>
            value === null
              ? relatedValue(row, column) === null
              : relatedValue(row, column) === value
          );
        }
        if (state.order.length > 0) {
          result.sort((left, right) => {
            for (const { column, ascending } of state.order) {
              const leftValue = relatedValue(left, column);
              const rightValue = relatedValue(right, column);
              if (leftValue === rightValue) continue;
              const comparison = compareDatabaseIds(
                String(leftValue),
                String(rightValue)
              );
              return ascending ? comparison : -comparison;
            }
            return 0;
          });
        }
        const count = result.length;
        if (state.limit !== null) result = result.slice(0, state.limit);
        if (state.range !== null) {
          const [from, to] = state.range;
          result = result.slice(from, to + 1);
        }
        if (Number.isFinite(maxRows)) result = result.slice(0, maxRows);
        if (state.head) return { data: null, count, error: null };

        const projected =
          state.select === "*"
            ? result
            : result.map((row) => {
                const columns = state.select
                  .split(",")
                  .map((column) => column.trim())
                  .filter(
                    (column) => column.length > 0 && !column.includes("!")
                  );
                return Object.fromEntries(
                  columns.flatMap((column) => {
                    if (column === "supplier(name)") {
                      return Object.hasOwn(row, "supplier")
                        ? [["supplier", row.supplier]]
                        : [];
                    }
                    return Object.hasOwn(row, column)
                      ? [[column, row[column]]]
                      : [];
                  })
                );
              });
        if (state.single) {
          return {
            data: projected[0] ?? null,
            count: state.count ? count : null,
            error:
              projected.length === 0 && !allowEmpty
                ? { message: `${table} not found` }
                : null
          };
        }
        return {
          data: projected,
          count: state.count ? count : null,
          error: null
        };
      }

      return builder;
    }
  } as unknown as SupabaseClient<Database> & {
    queries: string[];
    selects: string[];
    inCalls: Array<{ table: string; column: string; values: unknown[] }>;
    ranges: Array<{ table: string; from: number; to: number }>;
  };
}

function baseImpactRows(over: Partial<FakeClientOptions["rows"]> = {}) {
  const affected = [
    {
      id: "affected-1",
      changeOrderId: changeNoticeId,
      itemId: "item-1",
      companyId,
      item: {
        id: "item-1",
        readableId: "PART-1",
        readableIdWithRevision: "PART-1.A",
        name: "Part 1",
        revision: "A"
      }
    }
  ];
  const items = [
    {
      id: "item-1",
      readableId: "PART-1",
      readableIdWithRevision: "PART-1.A",
      revision: "A",
      unitOfMeasureCode: "EA",
      companyId
    }
  ];
  const rows: Record<string, FakeRow[]> = {
    changeOrder: [
      {
        id: changeNoticeId,
        companyId,
        status: "Draft",
        changeOrderId: "CN-1",
        name: "Change"
      }
    ],
    changeOrderAffectedItem: affected,
    item: items,
    purchaseOrderLine: [],
    purchaseOrder: [],
    purchaseOrderDelivery: [],
    job: [],
    jobMakeMethod: [],
    jobMaterial: [],
    changeOrderImpactDecision: [],
    changeOrderImpactDecisionAffectedItem: [],
    ...over
  };
  if (!("purchaseOrderDelivery" in over)) {
    rows.purchaseOrderDelivery = (rows.purchaseOrder ?? []).map((parent) => ({
      id: parent.id,
      receiptPromisedDate: null,
      companyId
    }));
  }
  return rows;
}

function poRow(id: string, itemId = "item-1", over: FakeRow = {}) {
  return {
    id,
    purchaseOrderId: `po-${id}`,
    supplierId: "supplier-1",
    itemId,
    itemRevision: "A",
    purchaseOrderLineType: "Part",
    purchaseOrderStatus: "To Receive",
    purchaseQuantity: 10,
    quantityReceived: 2,
    quantityToReceive: 8,
    receivedComplete: false,
    purchaseUnitOfMeasureCode: "EA",
    inventoryUnitOfMeasureCode: "EA",
    conversionFactor: 1,
    requiredDate: "2026-08-25",
    promisedDate: null,
    deliveryRowPresent: true,
    deliveryReceiptPromisedDate: null,
    companyId,
    ...over
  };
}

function poParent(
  id: string,
  status = "To Receive",
  supplierName = "Acme Components"
) {
  return {
    id,
    purchaseOrderId: id.toUpperCase(),
    supplierId: "supplier-1",
    supplier: { name: supplierName },
    status,
    companyId
  };
}

function jobRow(id: string, itemId = "item-1", status = "In Progress") {
  return {
    id,
    jobId: id.toUpperCase(),
    itemId,
    status,
    quantity: 100,
    productionQuantity: 100,
    quantityComplete: 20,
    quantityShipped: 10,
    quantityReceivedToInventory: 5,
    dueDate: "2026-08-30",
    unitOfMeasureCode: "EA",
    companyId
  };
}

function rootRow(jobId: string, itemId = "item-1") {
  return {
    id: `root-${jobId}`,
    jobId,
    itemId,
    version: 2,
    parentMaterialId: null,
    companyId
  };
}

function materialRow(id: string, jobId: string, itemId = "item-1") {
  return {
    id,
    jobId,
    itemId,
    estimatedQuantity: 5,
    quantityIssued: 5,
    quantityToIssue: 0,
    unitOfMeasureCode: "EA",
    methodType: "Pull from Inventory",
    jobOperationId: null,
    requiresBatchTracking: true,
    requiresSerialTracking: false,
    companyId
  };
}

function largeAffectedItemRows(count = 1001) {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(4, "0");
    return {
      id: `affected-${suffix}`,
      changeOrderId: changeNoticeId,
      itemId: `item-${suffix}`,
      sortOrder: suffix,
      createdAt: "2026-08-24T00:00:00Z",
      companyId
    };
  });
}

function largeItemRows(count = 1001) {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(4, "0");
    return {
      id: `item-${suffix}`,
      readableId: `PART-${suffix}`,
      readableIdWithRevision: `PART-${suffix}.A`,
      name: `Part ${suffix}`,
      type: "Part",
      active: true,
      revisionStatus: "Draft",
      replenishmentSystem: "Make",
      revision: "A",
      unitOfMeasureCode: "EA",
      companyId
    };
  });
}

describe("Change Notice affected-item scope", () => {
  it("loads affected items and labels beyond the PostgREST row cap", async () => {
    const client = fakeImpactClient({
      maxRows: 1000,
      rows: baseImpactRows({
        changeOrderAffectedItem: largeAffectedItemRows(),
        item: largeItemRows()
      })
    });

    const result = await getChangeNoticeAffectedItems(
      client,
      changeNoticeId,
      companyId
    );

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1001);
    expect(result.data.at(-1)).toMatchObject({
      id: "affected-1000",
      item: { id: "item-1000", readableIdWithRevision: "PART-1000.A" }
    });
    expect(
      client.inCalls
        .filter((call) => call.table === "item")
        .every((call) => call.values.length <= 50)
    ).toBe(true);
  });
});

describe("Change Notice Impact candidate discovery", () => {
  it("discovers PO, Job, and Job Material set-wise and preserves an active fully-issued material", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-1")],
      purchaseOrder: [poParent("po-pol-1")],
      purchaseOrderDelivery: [
        { id: "po-pol-1", receiptPromisedDate: "2026-08-31", companyId }
      ],
      job: [jobRow("job-1")],
      jobMakeMethod: [rootRow("job-1")],
      jobMaterial: [materialRow("material-1", "job-1")]
    });
    const client = fakeImpactClient({ rows });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.error).toBeNull();
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("complete");
    expect(result.data?.coverage.job.status).toBe("complete");
    expect(result.data?.coverage.jobMaterial.status).toBe("complete");
    expect(result.data?.coverage.job.currentExposureCount).toBe(1);
    expect(result.data?.coverage.jobMaterial.currentExposureCount).toBe(1);
    expect(result.data?.coverage.purchaseOrderLine.currentExposureCount).toBe(
      1
    );
    expect(
      result.data?.candidates.map((candidate) => candidate.targetType)
    ).toEqual(["job", "jobMaterial", "purchaseOrderLine"]);
    const material = result.data?.candidates.find(
      (candidate) => candidate.targetType === "jobMaterial"
    );
    expect(material?.exposureClassification).toBe(
      "Current operational exposure"
    );
    expect(material?.currentSnapshot).toMatchObject({
      issuedQuantity: 5,
      remainingQuantity: 0
    });
    expect(
      client.queries.filter((table) => table === "job").length
    ).toBeLessThanOrEqual(3);
    expect(
      client.queries.filter((table) => table === "jobMaterial").length
    ).toBeLessThanOrEqual(3);
    expect(
      client.queries.filter((table) => table === "purchaseOrderLine").length
    ).toBeLessThanOrEqual(3);
    expect(client.queries).not.toContain("jobMaterialUsage");
    expect(
      client.selects
        .filter((select) => select.includes("quantityComplete"))
        .every((select) => !select.includes("productionQuantity"))
    ).toBe(true);
  });

  it("classifies historical Jobs and Job Materials as references", async () => {
    const cases = [
      {
        targetType: "job" as const,
        targetId: "job-historical",
        rows: {
          job: [jobRow("job-historical", "item-1", "Completed")],
          jobMakeMethod: [rootRow("job-historical")]
        }
      },
      {
        targetType: "jobMaterial" as const,
        targetId: "material-historical",
        rows: {
          job: [jobRow("job-material-historical", "item-1", "Completed")],
          jobMakeMethod: [rootRow("job-material-historical")],
          jobMaterial: [
            materialRow("material-historical", "job-material-historical")
          ]
        }
      }
    ];

    for (const entry of cases) {
      const result = await getChangeNoticeImpactCandidates(
        fakeImpactClient({ rows: baseImpactRows(entry.rows) }),
        companyId,
        changeNoticeId,
        { sourceAccess }
      );
      const candidate = result.data?.candidates.find(
        (item) =>
          item.targetType === entry.targetType &&
          item.targetId === entry.targetId
      );

      expect(candidate).toMatchObject({
        targetType: entry.targetType,
        targetId: entry.targetId,
        sourceAvailability: "Present",
        exposureClassification: "Historical reference",
        currentSnapshot: expect.any(Object),
        decision: null,
        freshness: null
      });
      expect(result.data?.coverage[entry.targetType]).toMatchObject({
        status: "complete",
        currentExposureCount: 0,
        historicalReferenceCount: 1,
        unassessedCount: 0
      });
    }
  });

  it("retains historical Job and Job Material decisions", async () => {
    const storedJob = normalizeJobImpactSnapshot(
      baseJobInput({
        jobId: "job-assessed",
        status: "Completed",
        effectiveMethodId: "root-job-assessed"
      })
    );
    const storedMaterial = normalizeJobMaterialImpactSnapshot(
      baseMaterialInput({
        jobMaterialId: "material-assessed",
        jobId: "job-material-assessed",
        jobStatus: "Completed"
      })
    );
    if (
      storedJob.sourceAvailability !== "Present" ||
      storedMaterial.sourceAvailability !== "Present"
    ) {
      throw new Error("Production assessment fixtures must normalize");
    }

    const cases = [
      {
        targetType: "job" as const,
        targetId: "job-assessed",
        rows: {
          job: [jobRow("job-assessed", "item-1", "Completed")],
          jobMakeMethod: [rootRow("job-assessed")]
        },
        snapshot: storedJob.snapshot
      },
      {
        targetType: "jobMaterial" as const,
        targetId: "material-assessed",
        rows: {
          job: [jobRow("job-material-assessed", "item-1", "Completed")],
          jobMakeMethod: [rootRow("job-material-assessed")],
          jobMaterial: [
            materialRow("material-assessed", "job-material-assessed")
          ]
        },
        snapshot: storedMaterial.snapshot
      }
    ];

    for (const entry of cases) {
      const result = await getChangeNoticeImpactCandidates(
        fakeImpactClient({
          rows: baseImpactRows({
            ...entry.rows,
            changeOrderImpactDecision: [
              {
                id: `decision-${entry.targetId}`,
                companyId,
                changeNoticeId,
                targetType: entry.targetType,
                targetId: entry.targetId,
                decisionStatus: "Action required",
                noActionReasonCode: null,
                rationale: "follow up",
                resolutionNote: null,
                revision: 1,
                snapshotVersion: 1,
                assessmentSnapshot: entry.snapshot
              }
            ]
          })
        }),
        companyId,
        changeNoticeId,
        { sourceAccess }
      );
      const candidate = result.data?.candidates.find(
        (item) =>
          item.targetType === entry.targetType &&
          item.targetId === entry.targetId
      );

      expect(candidate).toMatchObject({
        sourceAvailability: "Present",
        exposureClassification: "Historical reference",
        currentSnapshot: expect.any(Object),
        decision: {
          status: "Action required",
          persistedSnapshot: expect.any(Object)
        },
        freshness: "Current"
      });
      expect(result.data?.coverage[entry.targetType]).toMatchObject({
        status: "complete",
        currentExposureCount: 0,
        historicalReferenceCount: 1,
        unassessedCount: 0
      });
    }
  });

  it("reports changed freshness for Jobs and Job Materials", async () => {
    const storedJob = normalizeJobImpactSnapshot(
      baseJobInput({
        jobId: "job-changed",
        effectiveMethodId: "root-job-changed"
      })
    );
    const storedMaterial = normalizeJobMaterialImpactSnapshot(
      baseMaterialInput({
        jobMaterialId: "material-changed",
        jobId: "job-material-changed"
      })
    );
    if (
      storedJob.sourceAvailability !== "Present" ||
      storedMaterial.sourceAvailability !== "Present"
    ) {
      throw new Error("Production assessment fixtures must normalize");
    }

    const cases = [
      {
        targetType: "job" as const,
        targetId: "job-changed",
        rows: {
          job: [
            {
              ...jobRow("job-changed"),
              quantityComplete: 25
            }
          ],
          jobMakeMethod: [rootRow("job-changed")]
        },
        snapshot: storedJob.snapshot
      },
      {
        targetType: "jobMaterial" as const,
        targetId: "material-changed",
        rows: {
          job: [jobRow("job-material-changed")],
          jobMakeMethod: [rootRow("job-material-changed")],
          jobMaterial: [
            materialRow("material-changed", "job-material-changed", "item-1")
          ].map((row) => ({
            ...row,
            quantityIssued: 4,
            quantityToIssue: 1
          }))
        },
        snapshot: storedMaterial.snapshot
      }
    ];

    for (const entry of cases) {
      const result = await getChangeNoticeImpactCandidates(
        fakeImpactClient({
          rows: baseImpactRows({
            ...entry.rows,
            changeOrderImpactDecision: [
              {
                id: `decision-${entry.targetId}`,
                companyId,
                changeNoticeId,
                targetType: entry.targetType,
                targetId: entry.targetId,
                decisionStatus: "Action required",
                noActionReasonCode: null,
                rationale: "follow up",
                resolutionNote: null,
                revision: 1,
                snapshotVersion: 1,
                assessmentSnapshot: entry.snapshot
              }
            ]
          })
        }),
        companyId,
        changeNoticeId,
        { sourceAccess }
      );
      const candidate = result.data?.candidates.find(
        (item) =>
          item.targetType === entry.targetType &&
          item.targetId === entry.targetId
      );

      expect(candidate).toMatchObject({
        sourceAvailability: "Present",
        exposureClassification: "Current operational exposure",
        currentSnapshot: expect.any(Object),
        decision: { status: "Action required" },
        freshness: "Changed since assessment"
      });
      expect(result.data?.coverage[entry.targetType]).toMatchObject({
        status: "complete",
        currentExposureCount: 1,
        historicalReferenceCount: 0,
        unassessedCount: 0
      });
    }
  });

  it("establishes Source deleted for missing Production sources only after complete lookup", async () => {
    const storedJob = normalizeJobImpactSnapshot(
      baseJobInput({
        jobId: "job-deleted",
        effectiveMethodId: "root-job-deleted"
      })
    );
    const storedMaterial = normalizeJobMaterialImpactSnapshot(
      baseMaterialInput({
        jobMaterialId: "material-deleted",
        jobId: "job-material-deleted"
      })
    );
    if (
      storedJob.sourceAvailability !== "Present" ||
      storedMaterial.sourceAvailability !== "Present"
    ) {
      throw new Error("Production assessment fixtures must normalize");
    }

    const cases = [
      {
        targetType: "job" as const,
        targetId: "job-deleted",
        snapshot: storedJob.snapshot
      },
      {
        targetType: "jobMaterial" as const,
        targetId: "material-deleted",
        snapshot: storedMaterial.snapshot
      }
    ];

    for (const entry of cases) {
      const result = await getChangeNoticeImpactCandidates(
        fakeImpactClient({
          rows: baseImpactRows({
            changeOrderImpactDecision: [
              {
                id: `decision-${entry.targetId}`,
                companyId,
                changeNoticeId,
                targetType: entry.targetType,
                targetId: entry.targetId,
                decisionStatus: "Action required",
                noActionReasonCode: null,
                rationale: "follow up",
                resolutionNote: null,
                revision: 1,
                snapshotVersion: 1,
                assessmentSnapshot: entry.snapshot
              }
            ]
          })
        }),
        companyId,
        changeNoticeId,
        { sourceAccess }
      );
      const candidate = result.data?.candidates.find(
        (item) =>
          item.targetType === entry.targetType &&
          item.targetId === entry.targetId
      );

      expect(candidate).toMatchObject({
        sourceAvailability: "Source deleted",
        exposureClassification: "Historical reference",
        currentSnapshot: null,
        decision: {
          status: "Action required",
          persistedSnapshot: expect.any(Object)
        },
        freshness: "Unknown"
      });
      expect(result.data?.coverage[entry.targetType]).toMatchObject({
        status: "complete",
        currentExposureCount: 0,
        historicalReferenceCount: 1,
        unassessedCount: 0
      });
    }
  });

  it("keeps valid candidates when one domain row has a negative quantity", async () => {
    const cases = [
      {
        targetType: "purchaseOrderLine" as const,
        validId: "pol-valid",
        invalidId: "pol-negative",
        rows: {
          purchaseOrderLine: [
            poRow("pol-valid"),
            poRow("pol-negative", "item-1", { purchaseQuantity: -1 })
          ],
          purchaseOrder: [poParent("po-pol-valid"), poParent("po-pol-negative")]
        }
      },
      {
        targetType: "job" as const,
        validId: "job-valid",
        invalidId: "job-negative",
        rows: {
          job: [
            jobRow("job-valid"),
            { ...jobRow("job-negative"), quantity: -1 }
          ],
          jobMakeMethod: [rootRow("job-valid"), rootRow("job-negative")]
        }
      },
      {
        targetType: "jobMaterial" as const,
        validId: "material-valid",
        invalidId: "material-negative",
        rows: {
          job: [jobRow("job-material-parent")],
          jobMakeMethod: [rootRow("job-material-parent")],
          jobMaterial: [
            materialRow("material-valid", "job-material-parent"),
            {
              ...materialRow("material-negative", "job-material-parent"),
              quantityIssued: -1
            }
          ]
        }
      }
    ];

    for (const entry of cases) {
      const result = await getChangeNoticeImpactCandidates(
        fakeImpactClient({ rows: baseImpactRows(entry.rows) }),
        companyId,
        changeNoticeId,
        { sourceAccess }
      );
      expect(
        result.data?.candidates.find(
          (candidate) => candidate.targetId === entry.invalidId
        )
      ).toMatchObject({
        sourceAvailability: "Unavailable",
        exposureClassification: null
      });
      expect(
        result.data?.candidates.find(
          (candidate) => candidate.targetId === entry.validId
        )
      ).toMatchObject({
        sourceAvailability: "Present",
        exposureClassification: "Current operational exposure"
      });
      expect(result.data?.coverage[entry.targetType]).toMatchObject({
        status: "partial",
        currentExposureCount: null,
        historicalReferenceCount: null
      });
    }
  });

  it("marks a producing Job unavailable when its required root method is missing", async () => {
    const rows = baseImpactRows({
      job: [jobRow("job-without-root")],
      jobMakeMethod: []
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetType === "job"
    );
    expect(candidate?.sourceAvailability).toBe("Unavailable");
    expect(result.data?.coverage.job.currentExposureCount).toBeNull();
  });

  it("recovers a hidden duplicate root method past the PostgREST row cap", async () => {
    const otherJobIds = Array.from(
      { length: 49 },
      (_, index) => `job-other-${index.toString().padStart(2, "0")}`
    );
    const jobs = ["job-target", ...otherJobIds].map((id) => jobRow(id));
    const rootMethods = [
      { ...rootRow("job-target"), id: "root-job-target-1" },
      ...Array.from({ length: 999 }, (_, index) => {
        const jobId = otherJobIds[index % otherJobIds.length];
        return { ...rootRow(jobId), id: `root-${jobId}-${index}` };
      }),
      { ...rootRow("job-target"), id: "root-job-target-2" }
    ];
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        maxRows: 1000,
        rows: baseImpactRows({ job: jobs, jobMakeMethod: rootMethods })
      }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const target = result.data?.candidates.find(
      (candidate) =>
        candidate.targetType === "job" && candidate.targetId === "job-target"
    );
    expect(target).toMatchObject({
      sourceAvailability: "Unavailable",
      exposureClassification: null,
      currentSnapshot: null
    });
    expect(result.data?.coverage.job.status).toBe("partial");
  });

  it("marks a Job unavailable when its root method belongs to another item", async () => {
    const rows = baseImpactRows({
      changeOrderAffectedItem: [
        {
          id: "affected-b",
          changeOrderId: changeNoticeId,
          itemId: "item-b",
          companyId
        },
        {
          id: "affected-c",
          changeOrderId: changeNoticeId,
          itemId: "item-c",
          companyId
        }
      ],
      item: [
        {
          id: "item-b",
          readableId: "PART-B",
          readableIdWithRevision: "PART-B.A",
          revision: "A",
          unitOfMeasureCode: "EA",
          companyId
        },
        {
          id: "item-c",
          readableId: "PART-C",
          readableIdWithRevision: "PART-C.A",
          revision: "A",
          unitOfMeasureCode: "EA",
          companyId
        }
      ],
      job: [jobRow("job-mismatch", "item-b"), jobRow("job-valid", "item-c")],
      jobMakeMethod: [
        rootRow("job-mismatch", "item-a"),
        rootRow("job-valid", "item-c")
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );

    const mismatch = result.data?.candidates.find(
      (candidate) => candidate.targetId === "job-mismatch"
    );
    const valid = result.data?.candidates.find(
      (candidate) => candidate.targetId === "job-valid"
    );
    expect(mismatch).toMatchObject({
      sourceAvailability: "Unavailable",
      exposureClassification: null,
      parent: null,
      item: null,
      currentSnapshot: null
    });
    expect(mismatch?.sourceAvailability).not.toBe("Source deleted");
    expect(valid).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure"
    });
    expect(result.data?.coverage.job).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
  });

  it("uses bounded set reads for many lines rather than querying once per affected item", async () => {
    const itemIds = Array.from(
      { length: 5 },
      (_, index) => `item-${index + 1}`
    );
    const affectedItems = itemIds.map((itemId, index) => ({
      id: `affected-${index + 1}`,
      changeOrderId: changeNoticeId,
      itemId,
      companyId,
      item: {
        id: itemId,
        readableId: `PART-${index + 1}`,
        readableIdWithRevision: `PART-${index + 1}.A`,
        name: `Part ${index + 1}`,
        revision: "A"
      }
    }));
    const items = itemIds.map((itemId, index) => ({
      id: itemId,
      readableId: `PART-${index + 1}`,
      readableIdWithRevision: `PART-${index + 1}.A`,
      revision: "A",
      unitOfMeasureCode: "EA",
      companyId
    }));
    const purchaseOrderLines = itemIds.map((itemId, index) =>
      poRow(`pol-${index + 1}`, itemId)
    );
    const purchaseOrders = purchaseOrderLines.map((line) =>
      poParent(line.purchaseOrderId as string)
    );
    const client = fakeImpactClient({
      rows: baseImpactRows({
        changeOrderAffectedItem: affectedItems,
        item: items,
        purchaseOrderLine: purchaseOrderLines,
        purchaseOrder: purchaseOrders
      })
    });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.error).toBeNull();
    expect(
      client.queries.filter((table) => table === "purchaseOrderLine").length
    ).toBeLessThanOrEqual(3);
    expect(
      result.data?.candidates.filter(
        (candidate) => candidate.targetType === "purchaseOrderLine"
      )
    ).toHaveLength(5);
  });

  it("keeps Impact PostgREST ID filters within Carbon's safe batch size", async () => {
    const client = fakeImpactClient({
      rows: baseImpactRows({
        changeOrderAffectedItem: largeAffectedItemRows(),
        item: largeItemRows()
      })
    });

    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );

    expect(result.error).toBeNull();
    expect(client.inCalls.length).toBeGreaterThan(0);
    expect(client.inCalls.every((call) => call.values.length <= 50)).toBe(true);
    expect(Math.max(...client.inCalls.map((call) => call.values.length))).toBe(
      50
    );
  });

  it("excludes a tiny positive PO quantity that rounds to zero from current exact counts", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [
        poRow("pol-tiny", "item-1", { quantityToReceive: 0.0000001 })
      ],
      purchaseOrder: [poParent("po-pol-tiny")]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.purchaseOrderLine.currentExposureCount).toBe(
      0
    );
    expect(
      result.data?.coverage.purchaseOrderLine.historicalReferenceCount
    ).toBe(1);
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-tiny"
      )?.exposureClassification
    ).toBe("Historical reference");
  });

  it("fails closed when a tiny positive conversion factor rounds to zero", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [
        poRow("pol-tiny-factor", "item-1", {
          quantityToReceive: 100000,
          conversionFactor: 0.000001
        }),
        poRow("pol-valid-factor")
      ],
      purchaseOrder: [
        poParent("po-pol-tiny-factor"),
        poParent("po-pol-valid-factor")
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const tiny = result.data?.candidates.find(
      (candidate) => candidate.targetId === "pol-tiny-factor"
    );
    const valid = result.data?.candidates.find(
      (candidate) => candidate.targetId === "pol-valid-factor"
    );

    expect(tiny).toMatchObject({
      sourceAvailability: "Unavailable",
      exposureClassification: null,
      currentSnapshot: null
    });
    expect(tiny?.exposureClassification).not.toBe("Historical reference");
    expect(valid).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure"
    });
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
  });

  it("fails exact PO counts when off-page semantic facts are missing or invalid", async () => {
    const rows = baseImpactRows({
      changeOrderAffectedItem: [
        {
          id: "affected-1",
          changeOrderId: changeNoticeId,
          itemId: "item-1",
          companyId,
          item: {
            id: "item-1",
            readableId: "PART-1",
            readableIdWithRevision: "PART-1.A",
            name: "Part 1",
            revision: "A"
          }
        },
        {
          id: "affected-2",
          changeOrderId: changeNoticeId,
          itemId: "item-2",
          companyId,
          item: {
            id: "item-2",
            readableId: "PART-2",
            readableIdWithRevision: "PART-2.A",
            name: "Part 2",
            revision: "A"
          }
        }
      ],
      purchaseOrderLine: [
        poRow("pol-valid"),
        poRow("pol-invalid", "item-2", { conversionFactor: 0 }),
        poRow("pol-missing-uom", "item-2", {
          purchaseUnitOfMeasureCode: undefined
        }),
        poRow("pol-unknown-type", "item-1", {
          purchaseOrderLineType: "Future line type"
        })
      ],
      purchaseOrder: [
        poParent("po-pol-valid"),
        poParent("po-pol-invalid"),
        poParent("po-pol-missing-uom"),
        poParent("po-pol-unknown-type")
      ],
      purchaseOrderDelivery: [
        { id: "po-pol-valid", receiptPromisedDate: null, companyId },
        { id: "po-pol-invalid", receiptPromisedDate: null, companyId },
        { id: "po-pol-missing-uom", receiptPromisedDate: null, companyId },
        { id: "po-pol-unknown-type", receiptPromisedDate: null, companyId }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-valid"
      )
    ).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure"
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-invalid"
      )
    ).toMatchObject({
      sourceAvailability: "Unavailable",
      exposureClassification: null
    });
  });

  it("does not omit an unknown PO line type from semantic coverage", async () => {
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows: baseImpactRows({
          purchaseOrderLine: [
            poRow("pol-unknown-type", "item-1", {
              purchaseOrderLineType: "Future line type"
            })
          ],
          purchaseOrder: [poParent("po-pol-unknown-type")],
          purchaseOrderDelivery: [
            { id: "po-pol-unknown-type", receiptPromisedDate: null, companyId }
          ]
        })
      }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-unknown-type"
      )
    ).toMatchObject({ sourceAvailability: "Unavailable" });
  });

  it("does not count an off-page persisted PO with missing source facts", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("stored"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows: baseImpactRows({
          purchaseOrderLine: [poRow("persisted-invalid", "item-2")],
          purchaseOrder: [poParent("po-persisted-invalid")],
          purchaseOrderDelivery: [
            {
              id: "po-persisted-invalid",
              receiptPromisedDate: null,
              companyId
            }
          ],
          changeOrderImpactDecision: [
            {
              id: "decision-deleted",
              companyId,
              changeNoticeId,
              targetType: "purchaseOrderLine",
              targetId: "aaa-deleted",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: stored.snapshot
            },
            {
              id: "decision-invalid",
              companyId,
              changeNoticeId,
              targetType: "purchaseOrderLine",
              targetId: "persisted-invalid",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: stored.snapshot
            }
          ]
        })
      }),
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 1 }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "aaa-deleted"
      )
    ).toMatchObject({ sourceAvailability: "Unavailable" });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "aaa-deleted"
      )?.sourceAvailability
    ).not.toBe("Source deleted");
  });

  it("does not count off-page Jobs missing an item or unique root method", async () => {
    const rows = baseImpactRows({
      changeOrderAffectedItem: [
        {
          id: "affected-1",
          changeOrderId: changeNoticeId,
          itemId: "item-1",
          companyId,
          item: {
            id: "item-1",
            readableId: "PART-1",
            readableIdWithRevision: "PART-1.A",
            name: "Part 1",
            revision: "A"
          }
        },
        {
          id: "affected-2",
          changeOrderId: changeNoticeId,
          itemId: "item-2",
          companyId,
          item: {
            id: "item-2",
            readableId: "PART-2",
            readableIdWithRevision: "PART-2.A",
            name: "Part 2",
            revision: "A"
          }
        }
      ],
      job: [
        jobRow("job-valid"),
        jobRow("job-missing-item", "item-2"),
        jobRow("job-invalid")
      ],
      jobMakeMethod: [
        rootRow("job-valid"),
        rootRow("job-missing-item"),
        rootRow("job-invalid"),
        rootRow("job-invalid")
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.job).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "job-valid"
      )
    ).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure"
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "job-missing-item"
      )
    ).toMatchObject({ sourceAvailability: "Unavailable" });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "job-invalid"
      )
    ).toMatchObject({ sourceAvailability: "Unavailable" });
  });

  it("does not count off-page Job Materials missing parent, item, or material facts", async () => {
    const rows = baseImpactRows({
      changeOrderAffectedItem: [
        {
          id: "affected-1",
          changeOrderId: changeNoticeId,
          itemId: "item-1",
          companyId,
          item: {
            id: "item-1",
            readableId: "PART-1",
            readableIdWithRevision: "PART-1.A",
            name: "Part 1",
            revision: "A"
          }
        },
        {
          id: "affected-2",
          changeOrderId: changeNoticeId,
          itemId: "item-2",
          companyId,
          item: {
            id: "item-2",
            readableId: "PART-2",
            readableIdWithRevision: "PART-2.A",
            name: "Part 2",
            revision: "A"
          }
        }
      ],
      job: [jobRow("job-valid")],
      jobMakeMethod: [rootRow("job-valid")],
      jobMaterial: [
        materialRow("material-valid", "job-valid"),
        materialRow("material-missing-item", "job-valid", "item-2"),
        materialRow("material-invalid-parent", "job-missing", "item-1"),
        {
          ...materialRow("material-invalid-facts", "job-valid", "item-1"),
          methodType: undefined
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.jobMaterial).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "material-valid"
      )
    ).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure"
    });
    for (const targetId of [
      "material-missing-item",
      "material-invalid-parent",
      "material-invalid-facts"
    ]) {
      expect(
        result.data?.candidates.find(
          (candidate) => candidate.targetId === targetId
        )
      ).toMatchObject({ sourceAvailability: "Unavailable" });
    }
  });

  it("pages current and historical PO streams independently with historical rows outside current counts", async () => {
    const lines = [
      poRow("hist-a"),
      poRow("hist-b"),
      poRow("curr-a"),
      poRow("curr-b")
    ];
    const rows = baseImpactRows({
      purchaseOrderLine: lines,
      purchaseOrder: [
        poParent("po-hist-a", "Completed"),
        poParent("po-hist-b", "Completed"),
        poParent("po-curr-a"),
        poParent("po-curr-b")
      ]
    });
    const client = fakeImpactClient({ rows });
    const first = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 2
      }
    );
    expect(
      first.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Current operational exposure"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["curr-a", "curr-b"]);
    expect(
      first.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Historical reference"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["hist-a", "hist-b"]);
    expect(first.data?.coverage.purchaseOrderLine.currentExposureCount).toBe(2);
    expect(
      first.data?.coverage.purchaseOrderLine.historicalReferenceCount
    ).toBe(2);
    expect(first.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: null,
      historical: null
    });

    const historical = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 2,
        cursor: { purchaseOrderLine: { historical: "hist-a" } }
      }
    );
    expect(
      historical.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Historical reference"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["hist-b"]);
    expect(
      historical.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Current operational exposure"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["curr-a", "curr-b"]);
    expect(historical.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: null,
      historical: null
    });

    const currentAfterHistorical = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 1,
        cursor: { purchaseOrderLine: { current: "curr-a" } }
      }
    );
    expect(
      currentAfterHistorical.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Current operational exposure"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["curr-b"]);
    expect(
      currentAfterHistorical.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Historical reference"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["hist-a"]);
    expect(
      currentAfterHistorical.data?.coverage.purchaseOrderLine.nextCursor
    ).toEqual({ current: null, historical: "hist-a" });
  });

  it("traverses current and historical streams independently without duplicates", async () => {
    const lines = [
      poRow("hist-a"),
      poRow("hist-b"),
      poRow("hist-c"),
      poRow("curr-a"),
      poRow("curr-b"),
      poRow("curr-c")
    ];
    const rows = baseImpactRows({
      purchaseOrderLine: lines,
      purchaseOrder: [
        poParent("po-hist-a", "Completed"),
        poParent("po-hist-b", "Completed"),
        poParent("po-hist-c", "Completed"),
        poParent("po-curr-a"),
        poParent("po-curr-b"),
        poParent("po-curr-c")
      ]
    });
    const client = fakeImpactClient({ rows });
    const seenCurrent = new Set<string>();
    const seenHistorical = new Set<string>();
    let cursor:
      | {
          purchaseOrderLine: {
            current: string | null;
            historical: string | null;
          };
        }
      | undefined;

    for (let index = 0; index < 3; index += 1) {
      const result = await getChangeNoticeImpactCandidates(
        client,
        companyId,
        changeNoticeId,
        { sourceAccess, limit: 1, ...(cursor ? { cursor } : {}) }
      );
      const purchaseCandidates = result.data?.candidates.filter(
        (candidate) => candidate.targetType === "purchaseOrderLine"
      );
      const current = purchaseCandidates?.find(
        (candidate) =>
          candidate.exposureClassification === "Current operational exposure"
      );
      const historical = purchaseCandidates?.find(
        (candidate) =>
          candidate.exposureClassification === "Historical reference"
      );
      expect(current?.targetId).toBe(`curr-${String.fromCharCode(97 + index)}`);
      expect(historical?.targetId).toBe(
        `hist-${String.fromCharCode(97 + index)}`
      );
      expect(seenCurrent.has(current?.targetId ?? "")).toBe(false);
      expect(seenHistorical.has(historical?.targetId ?? "")).toBe(false);
      seenCurrent.add(current?.targetId ?? "");
      seenHistorical.add(historical?.targetId ?? "");
      cursor = {
        purchaseOrderLine: result.data?.coverage.purchaseOrderLine
          .nextCursor ?? {
          current: null,
          historical: null
        }
      };
    }

    expect(seenCurrent).toEqual(new Set(["curr-a", "curr-b", "curr-c"]));
    expect(seenHistorical).toEqual(new Set(["hist-a", "hist-b", "hist-c"]));
    expect(cursor?.purchaseOrderLine).toEqual({
      current: null,
      historical: null
    });

    const historicalOnly = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 1,
        cursor: { purchaseOrderLine: { historical: "hist-a" } }
      }
    );
    expect(
      historicalOnly.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Current operational exposure"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["curr-a"]);
    expect(
      historicalOnly.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Historical reference"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["hist-b"]);

    const currentOnly = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 1,
        cursor: { purchaseOrderLine: { current: "curr-a" } }
      }
    );
    expect(
      currentOnly.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Current operational exposure"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["curr-b"]);
    expect(
      currentOnly.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Historical reference"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["hist-a"]);
  });

  it("fails exact Job counts when an off-page status is unknown", async () => {
    const rows = baseImpactRows({
      job: [jobRow("job-valid"), jobRow("job-unknown", "item-1", "Overdue")],
      jobMakeMethod: [rootRow("job-valid"), rootRow("job-unknown")]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.job).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "job-valid"
      )
    ).toMatchObject({ sourceAvailability: "Present" });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "job-unknown"
      )
    ).toMatchObject({ sourceAvailability: "Unavailable" });
  });

  it("paginates with stable ordering, real cursors, and exact summary counts independent of the visible page", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-b"), poRow("pol-a"), poRow("pol-c")],
      purchaseOrder: [
        poParent("po-pol-b"),
        poParent("po-pol-a"),
        poParent("po-pol-c")
      ]
    });
    const client = fakeImpactClient({ rows });

    const first = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 1 }
    );
    expect(
      first.data?.candidates
        .filter((candidate) => candidate.targetType === "purchaseOrderLine")
        .map((candidate) => candidate.targetId)
    ).toEqual(["pol-a"]);
    expect(first.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: "pol-a",
      historical: null
    });
    expect(first.data?.coverage.purchaseOrderLine.currentExposureCount).toBe(3);
    expect(first.data?.coverage.purchaseOrderLine.unassessedCount).toBe(3);

    const second = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 1,
        cursor: { purchaseOrderLine: { current: "pol-a" } }
      }
    );
    expect(
      second.data?.candidates
        .filter((candidate) => candidate.targetType === "purchaseOrderLine")
        .map((candidate) => candidate.targetId)
    ).toEqual(["pol-b"]);
    expect(second.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: "pol-b",
      historical: null
    });

    const third = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 1,
        cursor: { purchaseOrderLine: { current: "pol-b" } }
      }
    );
    expect(
      third.data?.candidates
        .filter((candidate) => candidate.targetType === "purchaseOrderLine")
        .map((candidate) => candidate.targetId)
    ).toEqual(["pol-c"]);
    expect(third.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: null,
      historical: null
    });
    expect(third.data?.coverage.purchaseOrderLine.currentExposureCount).toBe(3);
  });

  it("treats an exhausted domain cursor as an exhausted stream", async () => {
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows: baseImpactRows({
          purchaseOrderLine: [poRow("pol-exhausted")],
          purchaseOrder: [poParent("po-pol-exhausted")]
        })
      }),
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 1,
        cursor: {
          purchaseOrderLine: { current: null, historical: null }
        }
      }
    );

    expect(
      result.data?.candidates.filter(
        (candidate) => candidate.targetType === "purchaseOrderLine"
      )
    ).toEqual([]);
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "complete",
      nextCursor: { current: null, historical: null }
    });
  });

  it("does not skip or repeat mixed-case IDs across failed-coverage continuation pages", async () => {
    const lines = [
      poRow("pol_A"),
      poRow("pol_B"),
      poRow("pol_a"),
      poRow("pol_b")
    ];
    const client = fakeImpactClient({
      rows: baseImpactRows({
        purchaseOrderLine: lines,
        purchaseOrder: lines.map((line) =>
          poParent(line.purchaseOrderId as string)
        )
      }),
      errors: new Set(["purchaseOrder"])
    });
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let index = 0; index < lines.length; index += 1) {
      const result = await getChangeNoticeImpactCandidates(
        client,
        companyId,
        changeNoticeId,
        {
          sourceAccess,
          limit: 1,
          ...(cursor
            ? { cursor: { purchaseOrderLine: { current: cursor } } }
            : {})
        }
      );
      const candidate = result.data?.candidates.find(
        (entry) => entry.targetType === "purchaseOrderLine"
      );
      expect(candidate).toBeDefined();
      seen.push(candidate?.targetId ?? "");
      const nextCursor =
        result.data?.coverage.purchaseOrderLine.nextCursor.current;
      if (nextCursor === null) break;
      cursor = nextCursor;
    }

    expect(seen).toEqual(["pol_a", "pol_A", "pol_b", "pol_B"]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("reports failed purchasing summary hydration without exposing fake exact totals", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-count-failure")],
      purchaseOrder: [poParent("po-pol-count-failure")]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows,
        errors: new Set(["purchaseOrder"])
      }),
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 1 }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "failed",
      currentExposureCount: null,
      historicalReferenceCount: null,
      unassessedCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-count-failure"
      )
    ).toMatchObject({
      sourceAvailability: "Unavailable",
      exposureClassification: null,
      currentSnapshot: null
    });
  });

  it("preserves failed purchasing coverage when bounded fallback reaches the workspace limit", async () => {
    const ids = Array.from(
      { length: 501 },
      (_, index) => `pol-${index.toString().padStart(4, "0")}`
    );
    const client = fakeImpactClient({
      rows: baseImpactRows({
        purchaseOrderLine: ids.map((id) => poRow(id)),
        purchaseOrder: ids.map((id) => poParent(`po-${id}`))
      }),
      // The full summary's parent hydration fails, while the bounded fallback
      // row read remains available to return a continuation cursor.
      errors: new Set(["purchaseOrder"])
    });

    const result = await getChangeNoticeImpactWorkspace(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const purchaseCandidates = result.data?.candidates.filter(
      (candidate) => candidate.targetType === "purchaseOrderLine"
    );

    expect(result.error).toBeNull();
    expect(purchaseCandidates).toHaveLength(500);
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "failed",
      currentExposureCount: null,
      historicalReferenceCount: null,
      unassessedCount: null,
      errorMessage: "Purchase Order Impact coverage failed.",
      nextCursor: { current: "pol-0499", historical: null }
    });
  });

  it("preserves a valid persisted decision beside an unrelated malformed row", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-a"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      changeOrderAffectedItem: [
        {
          id: "affected-1",
          changeOrderId: changeNoticeId,
          itemId: "item-1",
          companyId,
          item: {
            id: "item-1",
            readableId: "PART-1",
            readableIdWithRevision: "PART-1.A",
            name: "Part 1",
            revision: "A"
          }
        },
        {
          id: "affected-2",
          changeOrderId: changeNoticeId,
          itemId: "item-2",
          companyId,
          item: {
            id: "item-2",
            readableId: "PART-2",
            readableIdWithRevision: "PART-2.A",
            name: "Part 2",
            revision: "A"
          }
        }
      ],
      purchaseOrderLine: [
        poRow("pol-a"),
        poRow("pol-z", "item-2", { purchaseUnitOfMeasureCode: undefined })
      ],
      purchaseOrder: [poParent("po-pol-a"), poParent("po-pol-z")],
      purchaseOrderDelivery: [
        { id: "po-pol-a", receiptPromisedDate: null, companyId },
        { id: "po-pol-z", receiptPromisedDate: null, companyId }
      ],
      changeOrderImpactDecision: [
        {
          id: "decision-pol-a",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-a",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 1 }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-a"
    );
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("partial");
    expect(candidate).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure",
      decision: { status: "Action required" },
      freshness: "Current"
    });
  });

  it("marks a visible malformed persisted snapshot as partial without poisoning valid rows", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-bad"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-good"), poRow("pol-bad")],
      purchaseOrder: [poParent("po-pol-good"), poParent("po-pol-bad")],
      changeOrderImpactDecision: [
        {
          id: "decision-pol-bad",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-bad",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: {
            ...stored.snapshot,
            orderedQuantity: 10.000001
          }
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-good"
      )
    ).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure"
    });
    const malformed = result.data?.candidates.find(
      (candidate) => candidate.targetId === "pol-bad"
    );
    expect(malformed).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure",
      currentSnapshot: expect.any(Object),
      decision: {
        status: "Action required",
        persistedSnapshot: null
      },
      freshness: "Unknown"
    });
    expect(malformed?.sourceAvailability).not.toBe("Source deleted");
    expect(malformed?.decision?.status).not.toBe("Unassessed");
  });

  it("keeps off-page malformed persisted snapshots in domain coverage", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-z"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-a"), poRow("pol-z")],
      purchaseOrder: [poParent("po-pol-a"), poParent("po-pol-z")],
      changeOrderImpactDecision: [
        {
          id: "decision-pol-z",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-z",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: {
            ...stored.snapshot,
            orderedQuantity: 10.000001
          }
        }
      ]
    });
    const client = fakeImpactClient({ rows });
    const first = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 1 }
    );
    expect(
      first.data?.candidates.some((candidate) => candidate.targetId === "pol-z")
    ).toBe(false);
    expect(first.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });

    const second = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 1,
        cursor: { purchaseOrderLine: { current: "pol-a" } }
      }
    );
    const malformed = second.data?.candidates.find(
      (candidate) => candidate.targetId === "pol-z"
    );
    expect(malformed).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure",
      currentSnapshot: expect.any(Object),
      decision: {
        status: "Action required",
        persistedSnapshot: null
      },
      freshness: "Unknown"
    });
    expect(
      second.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-z"
      )?.sourceAvailability
    ).not.toBe("Source deleted");
    expect(second.data?.coverage.purchaseOrderLine.status).toBe("partial");
  });

  it("does not infer Source deleted when malformed persisted evidence makes a domain partial", async () => {
    const poMissingSnapshot = normalizePurchaseOrderLineImpactSnapshot(
      poRow("pol-missing")
    );
    const poMalformedSnapshot = normalizePurchaseOrderLineImpactSnapshot(
      poRow("pol-malformed")
    );
    const jobMissingSnapshot = normalizeJobImpactSnapshot({
      ...jobRow("job-missing"),
      jobId: "job-missing",
      itemRevision: "A",
      effectiveMethodId: "job-method-missing",
      effectiveMethodVersion: 2
    });
    const jobMalformedSnapshot = normalizeJobImpactSnapshot({
      ...jobRow("job-malformed"),
      jobId: "job-malformed",
      itemRevision: "A",
      effectiveMethodId: "job-method-malformed",
      effectiveMethodVersion: 2
    });
    const materialMissingSnapshot = normalizeJobMaterialImpactSnapshot({
      ...materialRow("material-missing", "job-material-parent"),
      itemRevision: "A",
      jobStatus: "In Progress"
    });
    const materialMalformedSnapshot = normalizeJobMaterialImpactSnapshot({
      ...materialRow("material-malformed", "job-material-parent"),
      itemRevision: "A",
      jobStatus: "In Progress"
    });
    if (
      poMissingSnapshot.sourceAvailability !== "Present" ||
      poMalformedSnapshot.sourceAvailability !== "Present" ||
      jobMissingSnapshot.sourceAvailability !== "Present" ||
      jobMalformedSnapshot.sourceAvailability !== "Present" ||
      materialMissingSnapshot.sourceAvailability !== "Present" ||
      materialMalformedSnapshot.sourceAvailability !== "Present"
    ) {
      throw new Error("Impact regression fixtures must normalize successfully");
    }

    const cases = [
      {
        targetType: "purchaseOrderLine" as const,
        missingId: "pol-missing",
        malformedId: "pol-malformed",
        rows: baseImpactRows({
          purchaseOrderLine: [poRow("pol-malformed")],
          purchaseOrder: [poParent("po-pol-malformed")],
          changeOrderImpactDecision: [
            {
              id: "decision-pol-missing",
              companyId,
              changeNoticeId,
              targetType: "purchaseOrderLine",
              targetId: "pol-missing",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: poMissingSnapshot.snapshot
            },
            {
              id: "decision-pol-malformed",
              companyId,
              changeNoticeId,
              targetType: "purchaseOrderLine",
              targetId: "pol-malformed",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: {
                ...poMalformedSnapshot.snapshot,
                orderedQuantity: 10.000001
              }
            }
          ]
        })
      },
      {
        targetType: "job" as const,
        missingId: "job-missing",
        malformedId: "job-malformed",
        rows: baseImpactRows({
          job: [jobRow("job-malformed")],
          jobMakeMethod: [rootRow("job-malformed")],
          changeOrderImpactDecision: [
            {
              id: "decision-job-missing",
              companyId,
              changeNoticeId,
              targetType: "job",
              targetId: "job-missing",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: jobMissingSnapshot.snapshot
            },
            {
              id: "decision-job-malformed",
              companyId,
              changeNoticeId,
              targetType: "job",
              targetId: "job-malformed",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: {
                ...jobMalformedSnapshot.snapshot,
                remainingQuantity: 999
              }
            }
          ]
        })
      },
      {
        targetType: "jobMaterial" as const,
        missingId: "material-missing",
        malformedId: "material-malformed",
        rows: baseImpactRows({
          job: [jobRow("job-material-parent")],
          jobMakeMethod: [rootRow("job-material-parent")],
          jobMaterial: [
            materialRow("material-malformed", "job-material-parent")
          ],
          changeOrderImpactDecision: [
            {
              id: "decision-material-missing",
              companyId,
              changeNoticeId,
              targetType: "jobMaterial",
              targetId: "material-missing",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: materialMissingSnapshot.snapshot
            },
            {
              id: "decision-material-malformed",
              companyId,
              changeNoticeId,
              targetType: "jobMaterial",
              targetId: "material-malformed",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: {
                ...materialMalformedSnapshot.snapshot,
                requiredQuantity: 5.000001
              }
            }
          ]
        })
      }
    ];

    for (const entry of cases) {
      const result = await getChangeNoticeImpactCandidates(
        fakeImpactClient({ rows: entry.rows }),
        companyId,
        changeNoticeId,
        { sourceAccess }
      );
      const missing = result.data?.candidates.find(
        (candidate) => candidate.targetId === entry.missingId
      );
      const malformed = result.data?.candidates.find(
        (candidate) => candidate.targetId === entry.malformedId
      );

      expect(result.data?.coverage[entry.targetType]).toMatchObject({
        status: "partial",
        currentExposureCount: null,
        historicalReferenceCount: null,
        unassessedCount: null
      });
      expect(missing).toMatchObject({
        targetType: entry.targetType,
        targetId: entry.missingId,
        parent: null,
        item: null,
        currentSnapshot: null,
        exposureClassification: null,
        sourceAvailability: "Unavailable",
        freshness: "Unknown",
        decision: {
          status: "Action required",
          persistedSnapshot: expect.any(Object)
        }
      });
      expect(missing?.sourceAvailability).not.toBe("Source deleted");
      expect(malformed).toMatchObject({
        targetType: entry.targetType,
        targetId: entry.malformedId,
        currentSnapshot: expect.any(Object),
        sourceAvailability: "Present",
        exposureClassification: "Current operational exposure",
        freshness: "Unknown",
        decision: {
          status: "Action required",
          persistedSnapshot: null
        }
      });
      expect(malformed?.sourceAvailability).not.toBe("Source deleted");
      expect(malformed?.decision?.status).not.toBe("Unassessed");
    }
  });

  it("marks schema-permitted empty persisted decision IDs partial without fake targets", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-good"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-good")],
      purchaseOrder: [poParent("po-pol-good")],
      changeOrderImpactDecision: [
        {
          id: "decision-empty-target",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "corrupt target identity",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        },
        {
          id: "",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-missing-decision-id",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "corrupt decision identity",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        },
        {
          id: "decision-padded-target",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: " pol-deleted ",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "corrupt target identity",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: {
            ...stored.snapshot,
            purchaseOrderLineId: " pol-deleted "
          }
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.some((candidate) => candidate.targetId === "")
    ).toBe(false);
    expect(
      result.data?.candidates.some(
        (candidate) => candidate.sourceAvailability === "Source deleted"
      )
    ).toBe(false);
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-good"
      )
    ).toMatchObject({
      sourceAvailability: "Present",
      decision: null
    });
  });

  it("marks malformed provenance on a known decision partial while preserving valid evidence", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-1"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows: baseImpactRows({
          purchaseOrderLine: [poRow("pol-1")],
          purchaseOrder: [poParent("po-pol-1")],
          changeOrderImpactDecision: [
            {
              id: "decision-pol-1",
              companyId,
              changeNoticeId,
              targetType: "purchaseOrderLine",
              targetId: "pol-1",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: stored.snapshot
            }
          ],
          changeOrderImpactDecisionAffectedItem: [
            {
              decisionId: "decision-pol-1",
              affectedItemId: "affected-1",
              affectedItemSourceId: "item-1",
              affectedItemLabel: null,
              endedAt: null,
              endedReason: null,
              companyId
            },
            {
              decisionId: "decision-pol-1",
              affectedItemId: "",
              affectedItemSourceId: "item-1",
              affectedItemLabel: null,
              endedAt: null,
              endedReason: null,
              companyId
            }
          ]
        })
      }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-1"
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(candidate).toMatchObject({
      sourceAvailability: "Present",
      decision: { status: "Action required" },
      freshness: "Current"
    });
    expect(candidate?.currentProvenance).toHaveLength(1);
    expect(candidate?.currentProvenance[0]).toMatchObject({
      affectedItemId: "affected-1",
      status: "Current"
    });
  });

  it("does not query any source or persisted domain when access resolution failed", async () => {
    const client = fakeImpactClient({
      rows: baseImpactRows({
        purchaseOrderLine: [poRow("secret-line")],
        purchaseOrder: [poParent("po-secret-line")]
      })
    });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess: {
          status: "failed",
          errorMessage: "internal permission lookup failed"
        }
      }
    );
    expect(result.error).toBeNull();
    expect(result.data?.candidates).toEqual([]);
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("failed");
    expect(result.data?.coverage.job.status).toBe("failed");
    expect(result.data?.coverage.jobMaterial.status).toBe("failed");
    expect(client.queries).toEqual([]);
  });

  it("fails closed for an incomplete source capability map", async () => {
    const client = fakeImpactClient({
      rows: baseImpactRows({
        purchaseOrderLine: [poRow("secret-line")],
        purchaseOrder: [poParent("po-secret-line")]
      })
    });
    const incompleteSourceAccess = { ...sourceAccess };
    Reflect.deleteProperty(incompleteSourceAccess, "jobMaterial");

    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess: incompleteSourceAccess }
    );

    expect(result.error).toBeNull();
    expect(result.data?.candidates).toEqual([]);
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("failed");
    expect(result.data?.coverage.job.status).toBe("failed");
    expect(result.data?.coverage.jobMaterial.status).toBe("failed");
    expect(client.queries).toEqual([]);
  });

  it("isolates wrong-company source rows through every company predicate", async () => {
    const client = fakeImpactClient({
      rows: baseImpactRows({
        purchaseOrderLine: [
          poRow("wrong-company", "item-1", { companyId: "company-2" })
        ],
        purchaseOrder: [poParent("po-wrong-company")]
      })
    });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(
      result.data?.candidates.some(
        (candidate) => candidate.targetId === "wrong-company"
      )
    ).toBe(false);
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("complete");
  });

  it("returns restricted production coverage without querying Job or Job Material sources", async () => {
    const client = fakeImpactClient({
      rows: baseImpactRows({
        job: [jobRow("hidden-job")],
        jobMaterial: [materialRow("hidden-material", "hidden-job")]
      })
    });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess: {
          purchaseOrderLine: true,
          job: true,
          jobMaterial: false
        }
      }
    );
    expect(result.data?.coverage.job.status).toBe("restricted");
    expect(result.data?.coverage.jobMaterial.status).toBe("restricted");
    expect(client.queries.includes("job")).toBe(false);
    expect(client.queries.includes("jobMaterial")).toBe(false);
  });

  it("deduplicates one target while retaining current and historical provenance causes", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(
      poRow("pol-1", "item-1", { purchaseOrderStatus: "Completed" })
    );
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-1")],
      purchaseOrder: [poParent("po-pol-1", "Completed")],
      purchaseOrderDelivery: [
        { id: "po-pol-1", receiptPromisedDate: null, companyId }
      ],
      changeOrderImpactDecision: [
        {
          id: "decision-pol-1",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-1",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        }
      ],
      changeOrderImpactDecisionAffectedItem: [
        {
          decisionId: "decision-pol-1",
          affectedItemId: "affected-old",
          affectedItemSourceId: "item-old",
          affectedItemLabel: null,
          endedAt: "2026-08-24T00:00:00Z",
          endedReason: "Affected item removed from Change Notice",
          companyId
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetType === "purchaseOrderLine"
    );
    expect(candidate).toMatchObject({
      currentSnapshot: stored.snapshot,
      decision: { persistedSnapshot: stored.snapshot },
      freshness: "Current"
    });
    expect(candidate?.currentProvenance).toEqual([
      expect.objectContaining({
        affectedItemId: "affected-1",
        affectedItemSourceId: "item-1",
        status: "Current"
      })
    ]);
    expect(candidate?.historicalProvenance).toEqual([
      expect.objectContaining({
        affectedItemId: "affected-old",
        affectedItemSourceId: "item-old",
        status: "Historical",
        endedReason: "Affected item removed from Change Notice"
      })
    ]);
    expect(candidate?.exposureClassification).toBe("Historical reference");
    expect(
      result.data?.candidates.filter((entry) => entry.targetId === "pol-1")
    ).toHaveLength(1);
    expect(
      result.data?.coverage.purchaseOrderLine.historicalReferenceCount
    ).toBe(1);
  });

  it("keeps a null promised date when the required delivery row exists", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-null-date")],
      purchaseOrder: [poParent("po-pol-null-date")],
      purchaseOrderDelivery: [
        { id: "po-pol-null-date", receiptPromisedDate: null, companyId }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-null-date"
    );
    expect(candidate?.sourceAvailability).toBe("Present");
    expect(candidate?.currentSnapshot).toMatchObject({ promisedDate: null });
  });

  it("marks a missing required delivery row Unavailable instead of treating it as a null date", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-missing-delivery")],
      purchaseOrder: [poParent("po-pol-missing-delivery")],
      purchaseOrderDelivery: []
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-missing-delivery"
    );
    expect(candidate?.sourceAvailability).toBe("Unavailable");
    expect(candidate?.unavailableReason).toContain("delivery");
  });

  it("uses the line promised date before the delivery fallback", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [
        poRow("pol-1", "item-1", { promisedDate: "2026-09-01" })
      ],
      purchaseOrder: [poParent("po-pol-1")],
      purchaseOrderDelivery: [
        { id: "po-pol-1", receiptPromisedDate: "2026-09-30", companyId }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetType === "purchaseOrderLine"
    );
    expect(candidate?.currentSnapshot).toMatchObject({
      promisedDate: "2026-09-01"
    });
  });

  it("reconciles a persisted decision against the current canonical snapshot without writing", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-1"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-1", "item-1", { quantityReceived: 3 })],
      purchaseOrder: [poParent("po-pol-1")],
      changeOrderImpactDecision: [
        {
          id: "decision-pol-1",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-1",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "Supplier follow-up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        }
      ]
    });
    const client = fakeImpactClient({ rows });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-1"
    );
    expect(candidate?.decision?.status).toBe("Action required");
    expect(candidate?.decision?.decisionStatus).toBe("Action required");
    expect(candidate?.freshness).toBe("Changed since assessment");
    expect(
      result.data?.candidates.filter((entry) => entry.targetId === "pol-1")
    ).toHaveLength(1);
    expect(
      client.queries.some((table) => table === "changeOrderImpactDecision")
    ).toBe(true);
  });

  it("returns restricted coverage without querying the restricted source or leaking identities", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("secret-line")],
      purchaseOrder: [poParent("po-secret-line")]
    });
    const client = fakeImpactClient({ rows });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess: {
          purchaseOrderLine: false,
          job: true,
          jobMaterial: true
        }
      }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "restricted",
      currentExposureCount: null,
      historicalReferenceCount: null,
      unassessedCount: null
    });
    expect(
      result.data?.candidates.some(
        (candidate) => candidate.targetId === "secret-line"
      )
    ).toBe(false);
    expect(client.queries.includes("purchaseOrderLine")).toBe(false);
  });

  it("paginates persisted decisions instead of losing rows past the PostgREST cap", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("stored"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const decisions = Array.from({ length: 1001 }, (_, index) => {
      const targetId = `deleted-${index.toString().padStart(4, "0")}`;
      return {
        id: `decision-${index.toString().padStart(4, "0")}`,
        companyId,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId,
        decisionStatus: "Action required",
        noActionReasonCode: null,
        rationale: "follow up",
        resolutionNote: null,
        revision: 1,
        snapshotVersion: 1,
        assessmentSnapshot: {
          ...stored.snapshot,
          purchaseOrderLineId: targetId
        }
      };
    });
    const client = fakeImpactClient({
      maxRows: 1000,
      rows: baseImpactRows({ changeOrderImpactDecision: decisions })
    });
    const first = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 500 }
    );
    const firstCandidates = first.data?.candidates.filter(
      (candidate) => candidate.targetType === "purchaseOrderLine"
    );
    expect(firstCandidates).toHaveLength(500);
    expect(
      firstCandidates?.slice(0, 2).map((candidate) => candidate.targetId)
    ).toEqual(["deleted-0000", "deleted-0001"]);
    expect(first.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: null,
      historical: "deleted-0499"
    });

    const second = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 500,
        cursor: { purchaseOrderLine: { historical: "deleted-0499" } }
      }
    );
    const secondCandidates = second.data?.candidates.filter(
      (candidate) => candidate.targetType === "purchaseOrderLine"
    );
    expect(secondCandidates).toHaveLength(500);
    expect(second.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: null,
      historical: "deleted-0999"
    });

    const third = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 500,
        cursor: { purchaseOrderLine: { historical: "deleted-0999" } }
      }
    );
    const thirdCandidates = third.data?.candidates.filter(
      (candidate) => candidate.targetType === "purchaseOrderLine"
    );
    expect(thirdCandidates).toHaveLength(1);
    expect(thirdCandidates?.[0]).toMatchObject({
      targetId: "deleted-1000",
      sourceAvailability: "Source deleted"
    });
    expect(third.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: null,
      historical: null
    });
  });

  it("fails closed when persisted Impact state cannot be read", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-persisted-failure")],
      purchaseOrder: [poParent("po-pol-persisted-failure")]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows,
        errors: new Set(["changeOrderImpactDecision"])
      }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-persisted-failure"
    );
    expect(candidate).toMatchObject({
      sourceAvailability: "Unavailable",
      exposureClassification: null,
      parent: null,
      item: null,
      currentSnapshot: null,
      currentProvenance: [],
      historicalProvenance: [],
      provenance: [],
      decision: null,
      freshness: "Unknown"
    });
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("failed");
  });

  it("reports failed source coverage rather than returning a safe empty result", async () => {
    const client = fakeImpactClient({
      rows: baseImpactRows({ purchaseOrderLine: [poRow("pol-1")] }),
      errors: new Set(["purchaseOrderLine"])
    });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.error).toBeNull();
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("failed");
    expect(
      result.data?.coverage.purchaseOrderLine.currentExposureCount
    ).toBeNull();
  });

  it("reports failed Job source coverage independently from Job Material", async () => {
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows: baseImpactRows({
          job: [jobRow("job-source-failure")],
          jobMakeMethod: [rootRow("job-source-failure")]
        }),
        errors: new Set(["job"])
      }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );

    expect(result.error).toBeNull();
    expect(result.data?.coverage.job).toMatchObject({
      status: "failed",
      currentExposureCount: null,
      historicalReferenceCount: null,
      unassessedCount: null
    });
    expect(result.data?.coverage.jobMaterial.status).toBe("complete");
  });

  it("reports failed Job Material source coverage independently from Job", async () => {
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows: baseImpactRows({
          job: [jobRow("job-material-source")],
          jobMakeMethod: [rootRow("job-material-source")],
          jobMaterial: [
            materialRow("material-source-failure", "job-material-source")
          ]
        }),
        errors: new Set(["jobMaterial"])
      }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );

    expect(result.error).toBeNull();
    expect(result.data?.coverage.job.status).toBe("complete");
    expect(result.data?.coverage.jobMaterial).toMatchObject({
      status: "failed",
      currentExposureCount: null,
      historicalReferenceCount: null,
      unassessedCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetType === "job"
      )
    ).toMatchObject({
      targetId: "job-material-source",
      sourceAvailability: "Present"
    });
  });

  it("redacts all candidate context when source coverage fails", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(
      poRow("pol-source-failure")
    );
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;

    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows: baseImpactRows({
          purchaseOrderLine: [poRow("pol-source-failure")],
          purchaseOrder: [poParent("po-pol-source-failure")],
          changeOrderImpactDecision: [
            {
              id: "decision-source-failure",
              companyId,
              changeNoticeId,
              targetType: "purchaseOrderLine",
              targetId: "pol-source-failure",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "Supplier follow-up remains open.",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: stored.snapshot
            }
          ],
          changeOrderImpactDecisionAffectedItem: [
            {
              id: "provenance-source-failure",
              companyId,
              decisionId: "decision-source-failure",
              affectedItemId: "affected-1",
              affectedItemSourceId: "item-1",
              affectedItemLabel: "PART-1"
            }
          ]
        }),
        errors: new Set(["purchaseOrder"])
      }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-source-failure"
    );

    expect(candidate).toMatchObject({
      sourceAvailability: "Unavailable",
      parent: null,
      item: null,
      currentSnapshot: null,
      currentProvenance: [],
      historicalProvenance: [],
      provenance: [],
      exposureClassification: null,
      decision: null,
      freshness: "Unknown"
    });
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("failed");
  });

  it("keeps current and historical paging independent for persisted references", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("missing"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-1"), poRow("pol-2")],
      purchaseOrder: [poParent("po-pol-1"), poParent("po-pol-2")],
      changeOrderImpactDecision: [
        {
          id: "decision-missing",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "missing",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 1 }
    );
    const missing = result.data?.candidates.find(
      (candidate) => candidate.targetId === "missing"
    );
    // Historical paging is independent from the current page. The complete
    // semantic scan proves the persisted source is deleted without using the
    // visible current page as deletion evidence.
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("complete");
    expect(result.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: "pol-1",
      historical: null
    });
    expect(result.data?.coverage.purchaseOrderLine.currentExposureCount).toBe(
      2
    );
    expect(missing?.sourceAvailability).toBe("Source deleted");
  });

  it("establishes Source deleted only after a complete authorized lookup", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("deleted"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [],
      purchaseOrder: [],
      changeOrderImpactDecision: [
        {
          id: "decision-deleted",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "deleted",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const deleted = result.data?.candidates.find(
      (candidate) => candidate.targetId === "deleted"
    );
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("complete");
    expect(deleted?.sourceAvailability).toBe("Source deleted");
    expect(deleted?.exposureClassification).toBe("Historical reference");
  });

  it("classifies an existing source target outside the current affected-item scope without calling it deleted", async () => {
    const rows = baseImpactRows({
      item: [
        {
          id: "item-2",
          readableId: "PART-2",
          readableIdWithRevision: "PART-2.A",
          revision: "A",
          unitOfMeasureCode: "EA",
          companyId
        }
      ],
      purchaseOrderLine: [poRow("out-of-scope", "item-2")],
      purchaseOrder: [poParent("po-out-of-scope")],
      changeOrderImpactDecision: [
        {
          id: "decision-out",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "out-of-scope",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: normalizePurchaseOrderLineImpactSnapshot(
            poRow("out-of-scope", "item-2")
          ).snapshot
        }
      ],
      changeOrderImpactDecisionAffectedItem: [
        {
          decisionId: "decision-out",
          affectedItemId: "removed-affected-item",
          affectedItemSourceId: "item-old",
          affectedItemLabel: null,
          endedAt: "2026-08-24T00:00:00Z",
          endedReason: "Affected item removed from Change Notice",
          companyId
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "out-of-scope"
    );
    expect(candidate?.sourceAvailability).toBe("Present");
    expect(candidate?.exposureClassification).toBe(
      "No longer in current scope"
    );
    expect(candidate?.sourceAvailability).not.toBe("Source deleted");
    expect(candidate?.historicalProvenance).toEqual([
      expect.objectContaining({
        affectedItemId: "removed-affected-item",
        affectedItemLabel: null
      })
    ]);
    expect(
      result.data?.coverage.purchaseOrderLine.historicalReferenceCount
    ).toBe(1);
  });

  it("does not discover new source population for a Cancelled Change Notice", async () => {
    const rows = baseImpactRows({
      changeOrder: [
        {
          id: changeNoticeId,
          companyId,
          status: "Cancelled",
          changeOrderId: "CN-1",
          name: "Cancelled Change"
        }
      ],
      purchaseOrderLine: [poRow("new-after-cancel")],
      purchaseOrder: [poParent("po-new-after-cancel")]
    });
    const client = fakeImpactClient({ rows });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(
      result.data?.candidates.some(
        (candidate) => candidate.targetId === "new-after-cancel"
      )
    ).toBe(false);
    expect(client.queries.includes("purchaseOrderLine")).toBe(false);
  });

  it("keeps persisted active PO, Job, and Job Material targets current when Cancelled", async () => {
    const cases = [
      {
        targetType: "purchaseOrderLine" as const,
        targetId: "pol-cancelled",
        sourceRows: {
          purchaseOrderLine: [
            poRow("pol-cancelled"),
            poRow("pol-new-after-cancel")
          ],
          purchaseOrder: [
            poParent("po-pol-cancelled"),
            poParent("po-pol-new-after-cancel")
          ]
        },
        snapshot: normalizePurchaseOrderLineImpactSnapshot(
          poRow("pol-cancelled")
        )
      },
      {
        targetType: "job" as const,
        targetId: "job-cancelled",
        sourceRows: {
          job: [jobRow("job-cancelled"), jobRow("job-new-after-cancel")],
          jobMakeMethod: [
            rootRow("job-cancelled"),
            rootRow("job-new-after-cancel")
          ]
        },
        snapshot: normalizeJobImpactSnapshot(
          baseJobInput({
            jobId: "job-cancelled",
            effectiveMethodId: "root-job-cancelled"
          })
        )
      },
      {
        targetType: "jobMaterial" as const,
        targetId: "material-cancelled",
        sourceRows: {
          job: [jobRow("job-material-cancelled")],
          jobMakeMethod: [rootRow("job-material-cancelled")],
          jobMaterial: [
            materialRow("material-cancelled", "job-material-cancelled"),
            materialRow("material-new-after-cancel", "job-material-cancelled")
          ]
        },
        snapshot: normalizeJobMaterialImpactSnapshot(
          baseMaterialInput({
            jobMaterialId: "material-cancelled",
            jobId: "job-material-cancelled"
          })
        )
      }
    ];

    for (const entry of cases) {
      expect(entry.snapshot.sourceAvailability).toBe("Present");
      if (entry.snapshot.sourceAvailability !== "Present") continue;
      const client = fakeImpactClient({
        rows: baseImpactRows({
          changeOrder: [
            {
              id: changeNoticeId,
              companyId,
              status: "Cancelled",
              changeOrderId: "CN-1",
              name: "Cancelled Change"
            }
          ],
          ...entry.sourceRows,
          changeOrderImpactDecision: [
            {
              id: `decision-${entry.targetId}`,
              companyId,
              changeNoticeId,
              targetType: entry.targetType,
              targetId: entry.targetId,
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: entry.snapshot.snapshot
            }
          ]
        })
      });
      const result = await getChangeNoticeImpactCandidates(
        client,
        companyId,
        changeNoticeId,
        { sourceAccess }
      );
      const candidate = result.data?.candidates.find(
        (item) =>
          item.targetType === entry.targetType &&
          item.targetId === entry.targetId
      );
      expect(candidate).toMatchObject({
        sourceAvailability: "Present",
        exposureClassification: "Current operational exposure",
        currentProvenance: [
          expect.objectContaining({
            affectedItemId: "affected-1",
            status: "Current"
          })
        ],
        historicalProvenance: [],
        decision: { status: "Action required" },
        freshness: "Current"
      });
      expect(
        result.data?.candidates.some((item) =>
          item.targetId.endsWith("new-after-cancel")
        )
      ).toBe(false);
      expect(result.data?.coverage[entry.targetType]).toMatchObject({
        status: "complete",
        currentExposureCount: 1,
        historicalReferenceCount: 0
      });
    }
  });

  it("projects authorized linked task names and statuses without changing decision state", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-1"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;

    const client = fakeImpactClient({
      rows: baseImpactRows({
        purchaseOrderLine: [poRow("pol-1")],
        purchaseOrder: [poParent("po-pol-1")],
        changeOrderImpactDecision: [
          {
            id: "decision-pol-1",
            companyId,
            changeNoticeId,
            targetType: "purchaseOrderLine",
            targetId: "pol-1",
            decisionStatus: "Action required",
            noActionReasonCode: null,
            rationale: "Supplier follow-up remains open.",
            resolutionNote: null,
            revision: 1,
            snapshotVersion: 1,
            assessmentSnapshot: stored.snapshot
          }
        ],
        changeOrderImpactDecisionActionTask: [
          {
            decisionId: "decision-pol-1",
            actionTaskId: "task-pol-1",
            companyId
          }
        ],
        changeOrderActionTask: [
          {
            id: "task-pol-1",
            changeOrderId: changeNoticeId,
            companyId,
            name: "Confirm supplier cut-in",
            status: "In Progress",
            assignee: "user-2",
            dueDate: "2026-09-01",
            taskOrigin: "Impact follow-up"
          }
        ]
      })
    });

    const result = await getChangeNoticeImpactWorkspace(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-1"
    );

    expect(result.error).toBeNull();
    expect(result.data?.taskCoverage).toEqual({ status: "complete" });
    expect(candidate).toMatchObject({
      parent: { supplierName: "Acme Components" },
      decision: { status: "Action required" },
      taskLinks: [
        {
          decisionId: "decision-pol-1",
          actionTaskId: "task-pol-1",
          name: "Confirm supplier cut-in",
          status: "In Progress",
          assignee: "user-2",
          dueDate: "2026-09-01",
          taskOrigin: "Impact follow-up"
        }
      ]
    });
    expect(candidate?.currentSnapshot).toMatchObject({
      schema: PO_LINE_SNAPSHOT_V1,
      orderedQuantity: 10,
      promisedDate: null
    });
    expect(candidate?.currentSnapshot).not.toHaveProperty(
      "purchaseOrderLineId"
    );
    expect(candidate?.currentSnapshot).not.toHaveProperty("purchaseOrderId");
    expect(candidate?.currentSnapshot).not.toHaveProperty("supplierId");
    expect(candidate?.currentSnapshot).not.toHaveProperty("itemId");
    expect(candidate?.decision?.persistedSnapshot).not.toHaveProperty(
      "purchaseOrderLineId"
    );
    expect(candidate?.decision?.persistedSnapshot).not.toHaveProperty(
      "supplierId"
    );
    expect(
      client.selects.some((select) => select.includes("supplier(name)"))
    ).toBe(true);
    expect(client.queries).toContain("changeOrderImpactDecisionActionTask");
    expect(client.queries).toContain("changeOrderActionTask");
  });

  it("strips internal identifiers from every workspace snapshot", async () => {
    const poSnapshot = normalizePurchaseOrderLineImpactSnapshot(basePoInput());
    const jobSnapshot = normalizeJobImpactSnapshot({
      ...baseJobInput(),
      effectiveMethodId: "method-1"
    });
    const materialSnapshot = normalizeJobMaterialImpactSnapshot(
      baseMaterialInput()
    );
    expect(poSnapshot.sourceAvailability).toBe("Present");
    expect(jobSnapshot.sourceAvailability).toBe("Present");
    expect(materialSnapshot.sourceAvailability).toBe("Present");
    if (
      poSnapshot.sourceAvailability !== "Present" ||
      jobSnapshot.sourceAvailability !== "Present" ||
      materialSnapshot.sourceAvailability !== "Present"
    ) {
      return;
    }

    const result = await getChangeNoticeImpactWorkspace(
      fakeImpactClient({
        rows: baseImpactRows({
          purchaseOrderLine: [poRow("pol-1")],
          purchaseOrder: [poParent("po-pol-1")],
          job: [jobRow("job-1")],
          jobMakeMethod: [rootRow("job-1")],
          jobMaterial: [materialRow("material-1", "job-1")],
          changeOrderImpactDecision: [
            {
              id: "decision-pol-1",
              companyId,
              changeNoticeId,
              targetType: "purchaseOrderLine",
              targetId: "pol-1",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "PO follow-up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: poSnapshot.snapshot
            },
            {
              id: "decision-job-1",
              companyId,
              changeNoticeId,
              targetType: "job",
              targetId: "job-1",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "Job follow-up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: jobSnapshot.snapshot
            },
            {
              id: "decision-material-1",
              companyId,
              changeNoticeId,
              targetType: "jobMaterial",
              targetId: "material-1",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "Material follow-up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: materialSnapshot.snapshot
            }
          ]
        })
      }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );

    expect(result.error).toBeNull();
    const candidates = result.data?.candidates ?? [];
    const po = candidates.find((candidate) => candidate.targetId === "pol-1");
    const job = candidates.find(
      (candidate) =>
        candidate.targetType === "job" && candidate.targetId === "job-1"
    );
    const material = candidates.find(
      (candidate) =>
        candidate.targetType === "jobMaterial" &&
        candidate.targetId === "material-1"
    );

    for (const snapshot of [
      po?.currentSnapshot,
      po?.decision?.persistedSnapshot
    ]) {
      expect(snapshot).not.toHaveProperty("purchaseOrderLineId");
      expect(snapshot).not.toHaveProperty("purchaseOrderId");
      expect(snapshot).not.toHaveProperty("supplierId");
      expect(snapshot).not.toHaveProperty("itemId");
    }
    for (const snapshot of [
      job?.currentSnapshot,
      job?.decision?.persistedSnapshot
    ]) {
      expect(snapshot).not.toHaveProperty("jobId");
      expect(snapshot).not.toHaveProperty("effectiveMethodId");
      expect(snapshot).not.toHaveProperty("itemId");
    }
    for (const snapshot of [
      material?.currentSnapshot,
      material?.decision?.persistedSnapshot
    ]) {
      expect(snapshot).not.toHaveProperty("jobMaterialId");
      expect(snapshot).not.toHaveProperty("jobId");
      expect(snapshot).not.toHaveProperty("jobOperationId");
      expect(snapshot).not.toHaveProperty("itemId");
    }
  });

  it("batches linked-task reads without changing the task projection", async () => {
    const ids = Array.from({ length: 51 }, (_, index) => `pol-${index}`);
    const storedById = new Map(
      ids.map((id) => {
        const stored = normalizePurchaseOrderLineImpactSnapshot(poRow(id));
        if (stored.sourceAvailability !== "Present") {
          throw new Error("Expected the test PO snapshot to be present");
        }
        return [id, stored.snapshot] as const;
      })
    );
    const client = fakeImpactClient({
      rows: baseImpactRows({
        purchaseOrderLine: ids.map((id) => poRow(id)),
        purchaseOrder: ids.map((id) => poParent(`po-${id}`)),
        changeOrderImpactDecision: ids.map((id) => ({
          id: `decision-${id}`,
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: id,
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "Follow-up remains open.",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: storedById.get(id)
        })),
        changeOrderImpactDecisionActionTask: ids.map((id) => ({
          decisionId: `decision-${id}`,
          actionTaskId: `task-${id}`,
          companyId
        })),
        changeOrderActionTask: ids.map((id) => ({
          id: `task-${id}`,
          changeOrderId: changeNoticeId,
          companyId,
          name: `Follow up ${id}`,
          status: "Pending",
          assignee: "user-2",
          dueDate: "2026-09-01",
          taskOrigin: "Impact follow-up"
        }))
      })
    });

    const result = await getChangeNoticeImpactWorkspace(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );

    expect(result.error).toBeNull();
    expect(result.data?.candidates).toHaveLength(51);
    expect(
      client.inCalls
        .filter(
          (call) =>
            call.table === "changeOrderImpactDecisionActionTask" ||
            call.table === "changeOrderActionTask"
        )
        .map((call) => call.values.length)
        .sort((left, right) => left - right)
    ).toEqual([1, 1, 50, 50]);
    expect(
      result.data?.candidates.every(
        (candidate) =>
          candidate.taskLinks.length === 1 &&
          candidate.taskLinks[0]?.assignee === "user-2" &&
          candidate.taskLinks[0]?.taskOrigin === "Impact follow-up"
      )
    ).toBe(true);
  });

  it("materializes the bounded workspace without replaying source scans", async () => {
    const ids = ["pol-a", "pol-b", "pol-c"];
    const client = fakeImpactClient({
      rows: baseImpactRows({
        purchaseOrderLine: ids.map((id) => poRow(id)),
        purchaseOrder: ids.map((id) => poParent(`po-${id}`))
      })
    });

    const result = await getChangeNoticeImpactWorkspace(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );

    expect(result.error).toBeNull();
    expect(
      result.data?.candidates
        .filter((candidate) => candidate.targetType === "purchaseOrderLine")
        .map((candidate) => candidate.targetId)
    ).toEqual(ids);
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "complete",
      currentExposureCount: 3,
      historicalReferenceCount: 0,
      unassessedCount: 3,
      nextCursor: { current: null, historical: null }
    });
    expect(
      client.queries.filter((table) => table === "purchaseOrderLine")
    ).toHaveLength(1);
  });

  it("paginates source scans before materializing a workspace over the row cap", async () => {
    const ids = Array.from(
      { length: 1001 },
      (_, index) => `pol-${index.toString().padStart(4, "0")}`
    );
    const client = fakeImpactClient({
      maxRows: 1000,
      rows: baseImpactRows({
        purchaseOrderLine: ids.map((id) => poRow(id)),
        purchaseOrder: ids.map((id) => poParent(`po-${id}`))
      })
    });

    const result = await getChangeNoticeImpactWorkspace(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidates = result.data?.candidates.filter(
      (candidate) => candidate.targetType === "purchaseOrderLine"
    );

    expect(result.error).toBeNull();
    expect(candidates).toHaveLength(1001);
    expect(candidates?.at(-1)).toMatchObject({ targetId: "pol-1000" });
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "complete",
      currentExposureCount: 1001,
      historicalReferenceCount: 0,
      unassessedCount: 1001
    });
    expect(
      client.ranges
        .filter((range) => range.table === "purchaseOrderLine")
        .map((range) => range.from)
    ).toContain(1000);
  });

  it("keeps task coverage failed instead of presenting an empty linked-task result", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-1"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;

    const client = fakeImpactClient({
      rows: baseImpactRows({
        purchaseOrderLine: [poRow("pol-1")],
        purchaseOrder: [poParent("po-pol-1")],
        changeOrderImpactDecision: [
          {
            id: "decision-pol-1",
            companyId,
            changeNoticeId,
            targetType: "purchaseOrderLine",
            targetId: "pol-1",
            decisionStatus: "Action required",
            noActionReasonCode: null,
            rationale: "Supplier follow-up remains open.",
            resolutionNote: null,
            revision: 1,
            snapshotVersion: 1,
            assessmentSnapshot: stored.snapshot
          }
        ],
        changeOrderImpactDecisionActionTask: [
          {
            decisionId: "decision-pol-1",
            actionTaskId: "task-pol-1",
            companyId
          }
        ]
      }),
      errors: new Set(["changeOrderActionTask"])
    });

    const result = await getChangeNoticeImpactWorkspace(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-1"
    );

    expect(result.error).toBeNull();
    expect(result.data?.taskCoverage.status).toBe("failed");
    expect(candidate?.taskLinks).toEqual([]);
    expect(candidate?.decision).toMatchObject({ status: "Action required" });
  });

  it("does not restart an exhausted stream while the other stream continues", async () => {
    const scenarios = [
      {
        current: ["curr-a"],
        historical: ["hist-a", "hist-b", "hist-c"]
      },
      {
        current: ["curr-a", "curr-b", "curr-c"],
        historical: ["hist-a"]
      }
    ];

    for (const scenario of scenarios) {
      const rows = baseImpactRows({
        purchaseOrderLine: [
          ...scenario.current.map((id) => poRow(id)),
          ...scenario.historical.map((id) => poRow(id))
        ],
        purchaseOrder: [
          ...scenario.current.map((id) => poParent(`po-${id}`)),
          ...scenario.historical.map((id) => poParent(`po-${id}`, "Completed"))
        ]
      });
      const client = fakeImpactClient({ rows });
      const seenCurrent: string[] = [];
      const seenHistorical: string[] = [];
      let cursor:
        | {
            purchaseOrderLine: {
              current: string | null;
              historical: string | null;
            };
          }
        | undefined;
      let terminated = false;

      for (let request = 0; request < 10; request += 1) {
        const result = await getChangeNoticeImpactCandidates(
          client,
          companyId,
          changeNoticeId,
          { sourceAccess, limit: 1, ...(cursor ? { cursor } : {}) }
        );
        const purchaseCandidates = result.data?.candidates.filter(
          (candidate) => candidate.targetType === "purchaseOrderLine"
        );
        const current = purchaseCandidates?.find(
          (candidate) =>
            candidate.exposureClassification === "Current operational exposure"
        );
        const historical = purchaseCandidates?.find(
          (candidate) =>
            candidate.exposureClassification === "Historical reference"
        );
        if (current) seenCurrent.push(current.targetId);
        if (historical) seenHistorical.push(historical.targetId);

        const nextCursor = result.data?.coverage.purchaseOrderLine.nextCursor;
        expect(nextCursor).toBeDefined();
        cursor = { purchaseOrderLine: nextCursor! };
        if (nextCursor?.current === null && nextCursor.historical === null) {
          terminated = true;
          break;
        }
      }

      expect(terminated).toBe(true);
      expect(seenCurrent).toEqual(scenario.current);
      expect(seenHistorical).toEqual(scenario.historical);
      expect(new Set(seenCurrent).size).toBe(seenCurrent.length);
      expect(new Set(seenHistorical).size).toBe(seenHistorical.length);
    }
  });
});
