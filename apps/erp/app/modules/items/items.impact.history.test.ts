import type { Database } from "@carbon/database";
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
  getChangeNoticeImpactHistory,
  normalizePurchaseOrderLineImpactSnapshot
} = await import("./items.service");

const companyId = "company-1";
const changeNoticeId = "change-notice-1";
const decisionId = "decision-1";
const targetId = "po-line-1";
const createdAt = "2026-08-25T10:00:00.000Z";

function makeSnapshot() {
  const result = normalizePurchaseOrderLineImpactSnapshot({
    purchaseOrderLineId: targetId,
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
    deliveryRowPresent: true
  });
  if (result.sourceAvailability !== "Present") {
    throw new Error("Expected a canonical PO line snapshot");
  }
  return result.snapshot;
}

type TableResult = {
  data: unknown;
  error: { message: string } | null;
};

function makeClient(results: Record<string, TableResult>) {
  const queriedTables: string[] = [];
  const from = vi.fn((table: string) => {
    queriedTables.push(table);
    const result = results[table] ?? { data: [], error: null };
    const query: Record<string, (...args: unknown[]) => unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.in = vi.fn(() => query);
    query.order = vi.fn(() => query);
    query.range = vi.fn(() =>
      Promise.resolve({
        data: result.error ? null : result.data,
        count: Array.isArray(result.data) ? result.data.length : 0,
        error: result.error
      })
    );
    query.maybeSingle = vi.fn(() =>
      Promise.resolve({
        data: result.error ? null : result.data,
        error: result.error
      })
    );
    return query;
  });
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    queriedTables
  };
}

function decisionRow() {
  return {
    id: decisionId,
    companyId,
    changeNoticeId,
    targetType: "purchaseOrderLine",
    targetId
  };
}

function historyRow(over: Record<string, unknown> = {}) {
  return {
    id: "history-default",
    companyId,
    decisionId,
    targetType: "purchaseOrderLine",
    targetId,
    eventType: "Decision reassessed",
    previousStatus: "Action required",
    newStatus: "No action required",
    previousReasonCode: null,
    newReasonCode: "Not affected after review",
    previousSnapshot: null,
    newSnapshot: makeSnapshot(),
    rationale: "Reviewed",
    resolutionNote: null,
    relatedActionTaskId: null,
    relatedAffectedItemId: null,
    priorAssessmentWasChanged: false,
    createdBy: "employee-1",
    createdAt,
    ...over
  };
}

describe("getChangeNoticeImpactHistory", () => {
  it("reads one authorized decision and returns safe event, task, and provenance projections", async () => {
    const { client, queriedTables } = makeClient({
      changeOrderImpactDecision: { data: decisionRow(), error: null },
      changeOrderImpactDecisionHistory: {
        data: [
          historyRow({
            id: "history-task",
            eventType: "Task linked",
            previousStatus: null,
            newStatus: null,
            newSnapshot: null,
            rationale: null,
            relatedActionTaskId: "task-1"
          }),
          historyRow({
            id: "history-provenance",
            eventType: "Provenance ended",
            previousSnapshot: makeSnapshot(),
            newSnapshot: makeSnapshot(),
            relatedAffectedItemId: "affected-item-1",
            rationale: "Affected item was removed"
          }),
          historyRow({ id: "history-decision" })
        ],
        error: null
      },
      changeOrderImpactDecisionAffectedItem: {
        data: [
          {
            id: "interval-1",
            companyId,
            decisionId,
            affectedItemId: "affected-item-1",
            affectedItemLabel: "PART-1 Rev A",
            startedAt: "2026-08-20T10:00:00.000Z",
            endedAt: createdAt,
            endedReason: "Affected item was removed"
          }
        ],
        error: null
      }
    });

    const result = await getChangeNoticeImpactHistory(
      client,
      companyId,
      changeNoticeId,
      decisionId,
      {
        sourceAccess: {
          purchaseOrderLine: true,
          job: false,
          jobMaterial: false
        }
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.entries).toHaveLength(3);
    expect(queriedTables).toEqual([
      "changeOrderImpactDecision",
      "changeOrderImpactDecisionHistory",
      "changeOrderImpactDecisionAffectedItem"
    ]);

    const decision = result.data?.entries.find(
      (entry) => entry.id === "history-decision"
    );
    expect(decision).toMatchObject({
      previousStatus: "Action required",
      newStatus: "No action required",
      previousSnapshotStatus: "absent",
      newSnapshotStatus: "present"
    });
    expect(decision?.newSnapshot).not.toHaveProperty("purchaseOrderLineId");
    expect(decision?.newSnapshot).not.toHaveProperty("itemId");

    const task = result.data?.entries.find(
      (entry) => entry.id === "history-task"
    );
    expect(task).toMatchObject({
      relatedActionTaskId: "task-1",
      previousSnapshot: null,
      newSnapshot: null
    });

    const provenance = result.data?.entries.find(
      (entry) => entry.id === "history-provenance"
    );
    expect(provenance?.provenance).toEqual({
      affectedItemLabel: "PART-1 Rev A",
      endedAt: createdAt,
      endedReason: "Affected item was removed"
    });
  });

  it("retains a malformed snapshot event without projecting unsafe facts", async () => {
    const { client } = makeClient({
      changeOrderImpactDecision: { data: decisionRow(), error: null },
      changeOrderImpactDecisionHistory: {
        data: [
          historyRow({
            id: "history-malformed",
            newSnapshot: { schema: "PO_LINE_SNAPSHOT_V1", targetId: "wrong" }
          })
        ],
        error: null
      }
    });

    const result = await getChangeNoticeImpactHistory(
      client,
      companyId,
      changeNoticeId,
      decisionId,
      {
        sourceAccess: {
          purchaseOrderLine: true,
          job: false,
          jobMaterial: false
        }
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.entries).toHaveLength(1);
    expect(result.data?.entries[0]).toMatchObject({
      id: "history-malformed",
      newSnapshot: null,
      newSnapshotStatus: "unavailable"
    });
  });

  it("fails closed for a target domain without returning an empty history", async () => {
    const { client, queriedTables } = makeClient({
      changeOrderImpactDecision: { data: decisionRow(), error: null }
    });

    const result = await getChangeNoticeImpactHistory(
      client,
      companyId,
      changeNoticeId,
      decisionId,
      {
        sourceAccess: {
          purchaseOrderLine: false,
          job: true,
          jobMaterial: true
        }
      }
    );

    expect(result.data).toBeNull();
    expect(result.error?.kind).toBe("restricted");
    expect(queriedTables).toEqual(["changeOrderImpactDecision"]);
  });

  it("does not turn a history query failure into an empty success", async () => {
    const { client } = makeClient({
      changeOrderImpactDecision: { data: decisionRow(), error: null },
      changeOrderImpactDecisionHistory: {
        data: [],
        error: { message: "database unavailable" }
      }
    });

    const result = await getChangeNoticeImpactHistory(
      client,
      companyId,
      changeNoticeId,
      decisionId,
      {
        sourceAccess: {
          purchaseOrderLine: true,
          job: false,
          jobMaterial: false
        }
      }
    );

    expect(result.data).toBeNull();
    expect(result.error?.kind).toBe("unavailable");
  });
});
