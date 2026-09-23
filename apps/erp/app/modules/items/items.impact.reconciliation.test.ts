import type { Kysely, KyselyDatabase } from "@carbon/database/client";
// The Items module imports the glossary at module load time. Keep this focused
// service test independent of Lingui's application transform.
import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const { reconcileChangeNoticeImpactProvenance } = await import(
  "./items.service"
);

const companyId = "company-1";
const changeNoticeId = "notice-1";
const userId = "user-1";
const sourceAccess = {
  purchaseOrderLine: true,
  job: true,
  jobMaterial: true
};

type FakeRow = Record<string, unknown>;
type FakeFilter = {
  column: string;
  operator: string;
  value: unknown;
};
type FakeBuilder = {
  select: (...args: unknown[]) => FakeBuilder;
  where: (...args: unknown[]) => FakeBuilder;
  orderBy: (...args: unknown[]) => FakeBuilder;
  forUpdate: () => FakeBuilder;
  set: (values: unknown) => FakeBuilder;
  values: (values: unknown) => FakeBuilder;
  execute: () => Promise<unknown>;
  executeTakeFirst: () => Promise<unknown>;
};

type Recorder = {
  db: Kysely<KyselyDatabase>;
  state: Record<string, FakeRow[]>;
  sourceBatchSizes: number[];
  provenanceUpdateBatchSizes: number[];
  committed: boolean;
  rolledBack: boolean;
};

function cloneState(
  state: Record<string, FakeRow[]>
): Record<string, FakeRow[]> {
  return structuredClone(state);
}

function rowMatches(row: FakeRow, filter: FakeFilter): boolean {
  const actual = row[filter.column];
  if (filter.operator === "=") return actual === filter.value;
  if (filter.operator === "is") {
    return filter.value === null
      ? actual === null || actual === undefined
      : actual === filter.value;
  }
  if (filter.operator === "in") {
    return Array.isArray(filter.value) && filter.value.includes(actual);
  }
  throw new Error(`Unsupported fake filter ${filter.operator}`);
}

function makeRecorder(
  overrides: {
    status?: string;
    sourceItemId?: string | null;
    scope?: FakeRow[];
    provenance?: FakeRow[];
    sourceRows?: FakeRow[];
    decision?: FakeRow;
    failSourceRead?: boolean;
    failInsertTable?: string;
  } = {}
): Recorder {
  const decision = {
    id: "decision-1",
    companyId,
    changeNoticeId,
    targetType: "purchaseOrderLine",
    targetId: "line-1",
    decisionStatus: "Action required",
    noActionReasonCode: null,
    rationale: "Review the remaining old revision.",
    resolutionNote: null,
    assessmentSnapshot: { schema: "PO_LINE_SNAPSHOT_V1" },
    snapshotVersion: 1,
    assessedBy: "assessor-1",
    assessedAt: "2026-08-24T00:00:00.000Z",
    revision: 4,
    createdBy: "assessor-1",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedBy: "assessor-1",
    updatedAt: "2026-08-24T00:00:00.000Z",
    ...overrides.decision
  };
  const state: Record<string, FakeRow[]> = {
    changeOrder: [
      { id: changeNoticeId, companyId, status: overrides.status ?? "Done" }
    ],
    changeOrderImpactDecision: [decision],
    changeOrderAffectedItem: overrides.scope ?? [
      {
        id: "affected-a",
        companyId,
        changeOrderId: changeNoticeId,
        itemId: "item-a"
      }
    ],
    changeOrderImpactDecisionAffectedItem: overrides.provenance ?? [
      {
        id: "provenance-a",
        companyId,
        decisionId: "decision-1",
        affectedItemId: "affected-a",
        affectedItemSourceId: "item-a",
        affectedItemLabel: "PART-A Rev A",
        endedAt: null,
        endedBy: null,
        endedReason: null
      }
    ],
    changeOrderImpactDecisionHistory: [],
    purchaseOrderLine: overrides.sourceRows ?? [
      {
        id: "line-1",
        companyId,
        itemId: overrides.sourceItemId ?? "item-a"
      }
    ],
    job: [],
    jobMaterial: [],
    item: [
      {
        id: "item-a",
        companyId,
        readableId: "PART-A",
        readableIdWithRevision: "PART-A Rev A",
        name: "Part A"
      },
      {
        id: "item-b",
        companyId,
        readableId: "PART-B",
        readableIdWithRevision: "PART-B Rev B",
        name: "Part B"
      }
    ]
  };
  const sourceBatchSizes: number[] = [];
  const provenanceUpdateBatchSizes: number[] = [];
  let committed = false;
  let rolledBack = false;

  const makeBuilder = (
    table: string,
    kind: "select" | "update" | "insert"
  ): FakeBuilder => {
    const filters: FakeFilter[] = [];
    let updateValues: FakeRow = {};
    let insertValues: FakeRow[] = [];

    const builder: FakeBuilder = {
      select: () => builder,
      where: (...args) => {
        if (args.length >= 3) {
          const [column, operator, value] = args;
          filters.push({
            column: String(column),
            operator: String(operator),
            value
          });
          if (
            kind === "select" &&
            ["purchaseOrderLine", "job", "jobMaterial"].includes(table) &&
            operator === "in" &&
            Array.isArray(value)
          ) {
            sourceBatchSizes.push(value.length);
          }
          if (
            kind === "update" &&
            table === "changeOrderImpactDecisionAffectedItem" &&
            operator === "in" &&
            Array.isArray(value)
          ) {
            provenanceUpdateBatchSizes.push(value.length);
          }
        }
        return builder;
      },
      orderBy: () => builder,
      forUpdate: () => builder,
      set: (values) => {
        updateValues = values as FakeRow;
        return builder;
      },
      values: (values) => {
        insertValues = (Array.isArray(values) ? values : [values]) as FakeRow[];
        return builder;
      },
      execute: async () => {
        if (
          kind === "select" &&
          overrides.failSourceRead &&
          ["purchaseOrderLine", "job", "jobMaterial"].includes(table)
        ) {
          throw new Error("source read failed");
        }

        const rows = state[table] ?? [];
        const matching = rows.filter((row) =>
          filters.every((filter) => rowMatches(row, filter))
        );
        if (kind === "select") return matching;
        if (kind === "insert" && overrides.failInsertTable === table) {
          throw new Error(`${table} write failed`);
        }
        if (kind === "update") {
          for (const row of matching) Object.assign(row, updateValues);
          return { numUpdatedRows: BigInt(matching.length) };
        }
        for (const row of insertValues) {
          state[table] ??= [];
          state[table].push({
            ...row,
            id: row.id ?? `generated-${state[table].length + 1}`,
            endedAt: row.endedAt ?? null,
            endedBy: row.endedBy ?? null,
            endedReason: row.endedReason ?? null
          });
        }
        return { numInsertedOrUpdatedRows: BigInt(insertValues.length) };
      },
      executeTakeFirst: async () => {
        if (kind === "update") return builder.execute();
        const rows = state[table] ?? [];
        const matching = rows.filter((row) =>
          filters.every((filter) => rowMatches(row, filter))
        );
        return matching[0] ?? null;
      }
    };
    return builder;
  };

  const tx = {
    selectFrom: (table: string) => makeBuilder(table, "select"),
    updateTable: (table: string) => makeBuilder(table, "update"),
    insertInto: (table: string) => makeBuilder(table, "insert")
  };
  const executeTransaction = async (
    callback: (transaction: typeof tx) => Promise<unknown>
  ) => {
    const before = cloneState(state);
    try {
      const result = await callback(tx);
      committed = true;
      return result;
    } catch (cause) {
      for (const [table, rows] of Object.entries(before)) state[table] = rows;
      rolledBack = true;
      throw cause;
    }
  };
  const db = {
    transaction: () => ({ execute: executeTransaction })
  };

  return {
    db: db as unknown as Kysely<KyselyDatabase>,
    state,
    sourceBatchSizes,
    provenanceUpdateBatchSizes,
    get committed() {
      return committed;
    },
    get rolledBack() {
      return rolledBack;
    }
  } as Recorder;
}

function reconcile(recorder: Recorder) {
  return reconcileChangeNoticeImpactProvenance(recorder.db, {
    companyId,
    userId,
    changeNoticeId,
    sourceAccess
  });
}

describe("Change Notice Impact provenance reconciliation", () => {
  it("plans and applies a no-op without writing provenance or history", async () => {
    const recorder = makeRecorder();
    const beforeDecision = structuredClone(
      recorder.state.changeOrderImpactDecision[0]
    );
    const result = await reconcile(recorder);

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      changeNoticeId,
      changeNoticeStatus: "Done",
      started: 0,
      ended: 0,
      restrictedTargetTypes: []
    });
    expect(recorder.state.changeOrderImpactDecision).toEqual([beforeDecision]);
    expect(recorder.state.changeOrderImpactDecisionAffectedItem).toHaveLength(
      1
    );
    expect(recorder.state.changeOrderImpactDecisionHistory).toEqual([]);
    expect(recorder.committed).toBe(true);
  });

  it("starts a new interval after a relationship was ended", async () => {
    const recorder = makeRecorder({
      provenance: [
        {
          id: "provenance-old",
          companyId,
          decisionId: "decision-1",
          affectedItemId: "affected-a",
          affectedItemSourceId: "item-a",
          affectedItemLabel: "PART-A Rev A",
          endedAt: "2026-08-25T00:00:00.000Z",
          endedBy: "user-0",
          endedReason: "Affected item removed from Change Notice"
        }
      ]
    });
    const result = await reconcile(recorder);

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ started: 1, ended: 0 });
    expect(recorder.state.changeOrderImpactDecisionAffectedItem).toHaveLength(
      2
    );
    expect(
      recorder.state.changeOrderImpactDecisionAffectedItem.filter(
        (row) => row.endedAt === null
      )
    ).toMatchObject([
      expect.objectContaining({
        affectedItemId: "affected-a",
        affectedItemSourceId: "item-a",
        startedBy: userId
      })
    ]);
    expect(recorder.state.changeOrderImpactDecisionHistory).toMatchObject([
      expect.objectContaining({ eventType: "Provenance started" })
    ]);
  });

  it("ends an open interval when the source remains but leaves current scope", async () => {
    const recorder = makeRecorder({
      scope: [
        {
          id: "affected-b",
          companyId,
          changeOrderId: changeNoticeId,
          itemId: "item-b"
        }
      ]
    });
    const beforeDecision = structuredClone(
      recorder.state.changeOrderImpactDecision[0]
    );
    const result = await reconcile(recorder);

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ started: 0, ended: 1 });
    expect(
      recorder.state.changeOrderImpactDecisionAffectedItem[0]
    ).toMatchObject({
      endedBy: userId,
      endedReason: "Affected item removed from Change Notice"
    });
    expect(recorder.state.changeOrderImpactDecision).toEqual([beforeDecision]);
    expect(recorder.state.changeOrderImpactDecisionHistory).toMatchObject([
      expect.objectContaining({
        eventType: "Provenance ended",
        relatedAffectedItemId: "affected-a",
        previousStatus: "Action required",
        newStatus: "Action required"
      })
    ]);
  });

  it("uses a provenance-change reason when the source changes away from a still-affected item", async () => {
    const recorder = makeRecorder({ sourceItemId: "item-b" });
    const beforeDecision = structuredClone(
      recorder.state.changeOrderImpactDecision[0]
    );
    const result = await reconcile(recorder);

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ started: 0, ended: 1 });
    expect(
      recorder.state.changeOrderImpactDecisionAffectedItem[0]
    ).toMatchObject({
      endedReason: "Affected item provenance changed during reconciliation"
    });
    expect(
      recorder.state.changeOrderImpactDecisionAffectedItem[0]?.endedReason
    ).not.toBe("Affected item removed from Change Notice");
    expect(recorder.state.changeOrderImpactDecision).toEqual([beforeDecision]);
    expect(recorder.state.changeOrderImpactDecisionHistory).toMatchObject([
      expect.objectContaining({
        eventType: "Provenance ended",
        rationale: "Affected item provenance changed during reconciliation"
      })
    ]);
  });

  it("ends an open interval as Source deleted only after the exact lookup succeeds", async () => {
    const recorder = makeRecorder({ sourceRows: [] });
    const result = await reconcile(recorder);

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ started: 0, ended: 1 });
    expect(
      recorder.state.changeOrderImpactDecisionAffectedItem[0]
    ).toMatchObject({
      endedBy: userId,
      endedReason: "Impact source deleted"
    });
    expect(recorder.state.changeOrderImpactDecisionHistory).toMatchObject([
      expect.objectContaining({
        eventType: "Provenance ended",
        rationale: "Impact source deleted"
      })
    ]);
  });

  it("starts with a nullable label when the current item label is unavailable", async () => {
    const recorder = makeRecorder({
      sourceItemId: "item-without-readable-label",
      scope: [
        {
          id: "affected-missing-label",
          companyId,
          changeOrderId: changeNoticeId,
          itemId: "item-without-readable-label"
        }
      ],
      provenance: []
    });
    const result = await reconcile(recorder);

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ started: 1, ended: 0 });
    expect(recorder.state.changeOrderImpactDecisionAffectedItem).toMatchObject([
      expect.objectContaining({
        affectedItemLabel: null,
        affectedItemId: "affected-missing-label"
      })
    ]);
  });

  it("replaces a changed cause, preserves the old interval, and is idempotent", async () => {
    const recorder = makeRecorder({
      sourceItemId: "item-b",
      scope: [
        {
          id: "affected-b",
          companyId,
          changeOrderId: changeNoticeId,
          itemId: "item-b"
        }
      ]
    });
    const beforeDecision = structuredClone(
      recorder.state.changeOrderImpactDecision[0]
    );
    const first = await reconcile(recorder);

    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ started: 1, ended: 1 });
    expect(recorder.state.changeOrderImpactDecision).toEqual([beforeDecision]);
    expect(recorder.state.changeOrderImpactDecisionAffectedItem).toMatchObject([
      expect.objectContaining({
        endedReason: "Affected item provenance changed during reconciliation"
      }),
      expect.objectContaining({
        affectedItemId: "affected-b",
        affectedItemSourceId: "item-b",
        endedAt: null
      })
    ]);
    expect(recorder.state.changeOrderImpactDecisionHistory).toHaveLength(2);

    const second = await reconcile(recorder);
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({ started: 0, ended: 0 });
    expect(recorder.state.changeOrderImpactDecisionAffectedItem).toHaveLength(
      2
    );
    expect(recorder.state.changeOrderImpactDecisionHistory).toHaveLength(2);
  });

  it("rolls back ended and started rows when history cannot be written", async () => {
    const recorder = makeRecorder({
      sourceItemId: "item-b",
      scope: [
        {
          id: "affected-b",
          companyId,
          changeOrderId: changeNoticeId,
          itemId: "item-b"
        }
      ],
      failInsertTable: "changeOrderImpactDecisionHistory"
    });
    const result = await reconcile(recorder);

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe(
      "changeOrderImpactDecisionHistory write failed"
    );
    expect(recorder.state.changeOrderImpactDecisionAffectedItem).toHaveLength(
      1
    );
    expect(
      recorder.state.changeOrderImpactDecisionAffectedItem[0]?.endedAt
    ).toBeNull();
    expect(recorder.state.changeOrderImpactDecisionHistory).toEqual([]);
    expect(recorder.rolledBack).toBe(true);
  });

  it("does not start a new provenance relationship in Cancelled", async () => {
    const recorder = makeRecorder({
      status: "Cancelled",
      provenance: []
    });
    const result = await reconcile(recorder);

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ started: 0, ended: 0 });
    expect(recorder.state.changeOrderImpactDecisionAffectedItem).toEqual([]);
    expect(recorder.state.changeOrderImpactDecisionHistory).toEqual([]);
  });

  it("performs only an end in Cancelled and never starts the replacement cause", async () => {
    const recorder = makeRecorder({
      status: "Cancelled",
      sourceItemId: "item-b",
      scope: [
        {
          id: "affected-b",
          companyId,
          changeOrderId: changeNoticeId,
          itemId: "item-b"
        }
      ]
    });
    const result = await reconcile(recorder);

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ started: 0, ended: 1 });
    expect(recorder.state.changeOrderImpactDecisionAffectedItem).toHaveLength(
      1
    );
    expect(
      recorder.state.changeOrderImpactDecisionAffectedItem[0]?.endedAt
    ).not.toBeNull();
    expect(recorder.state.changeOrderImpactDecisionHistory).toHaveLength(1);
  });

  it("does not mutate a restricted domain and fails closed on source read errors", async () => {
    const restricted = makeRecorder();
    const restrictedResult = await reconcileChangeNoticeImpactProvenance(
      restricted.db,
      {
        companyId,
        userId,
        changeNoticeId,
        sourceAccess: {
          purchaseOrderLine: false,
          job: true,
          jobMaterial: true
        }
      }
    );
    expect(restrictedResult.error).toBeNull();
    expect(restrictedResult.data).toMatchObject({ started: 0, ended: 0 });
    expect(restrictedResult.data?.restrictedTargetTypes).toEqual([
      "purchaseOrderLine"
    ]);
    expect(
      restricted.state.changeOrderImpactDecisionAffectedItem[0]?.endedAt
    ).toBeNull();

    const failed = makeRecorder({ failSourceRead: true });
    const failedResult = await reconcile(failed);
    expect(failedResult.data).toBeNull();
    expect(failedResult.error?.message).toBe("source read failed");
    expect(
      failed.state.changeOrderImpactDecisionAffectedItem[0]?.endedAt
    ).toBeNull();
    expect(failed.state.changeOrderImpactDecisionHistory).toEqual([]);
    expect(failed.rolledBack).toBe(true);
  });

  it("rejects malformed source identity without ending the current interval", async () => {
    const recorder = makeRecorder({
      sourceRows: [{ id: "line-1", companyId, itemId: null }]
    });
    const result = await reconcile(recorder);

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe(
      "Complete purchaseOrderLine source evidence is unavailable."
    );
    expect(
      recorder.state.changeOrderImpactDecisionAffectedItem[0]?.endedAt
    ).toBeNull();
    expect(recorder.state.changeOrderImpactDecisionHistory).toEqual([]);
  });

  it("rejects duplicate current causes and multiple open intervals before writes", async () => {
    const duplicateScope = makeRecorder({
      scope: [
        {
          id: "affected-a",
          companyId,
          changeOrderId: changeNoticeId,
          itemId: "item-a"
        },
        {
          id: "affected-a-2",
          companyId,
          changeOrderId: changeNoticeId,
          itemId: "item-a"
        }
      ]
    });
    const duplicateScopeResult = await reconcile(duplicateScope);
    expect(duplicateScopeResult.error?.message).toContain(
      "more than one current affected-item cause"
    );
    expect(
      duplicateScope.state.changeOrderImpactDecisionAffectedItem[0]?.endedAt
    ).toBeNull();

    const duplicateOpen = makeRecorder({
      provenance: [
        {
          id: "provenance-a",
          companyId,
          decisionId: "decision-1",
          affectedItemId: "affected-a",
          affectedItemSourceId: "item-a",
          endedAt: null,
          endedBy: null,
          endedReason: null
        },
        {
          id: "provenance-b",
          companyId,
          decisionId: "decision-1",
          affectedItemId: "affected-b",
          affectedItemSourceId: "item-b",
          endedAt: null,
          endedBy: null,
          endedReason: null
        }
      ]
    });
    const duplicateOpenResult = await reconcile(duplicateOpen);
    expect(duplicateOpenResult.error?.message).toContain(
      "more than one current provenance cause"
    );
    expect(duplicateOpen.state.changeOrderImpactDecisionHistory).toEqual([]);
  });

  it("reads exact source targets in bounded batches", async () => {
    const scope = Array.from({ length: 51 }, (_, index) => ({
      id: `affected-${index}`,
      companyId,
      changeOrderId: changeNoticeId,
      itemId: `item-${index}`
    }));
    const decisions = scope.map((_, index) => ({
      id: `decision-${index}`,
      companyId,
      changeNoticeId,
      targetType: "purchaseOrderLine",
      targetId: `line-${index}`,
      decisionStatus: "Action required",
      noActionReasonCode: null,
      rationale: "Review",
      resolutionNote: null,
      assessmentSnapshot: { schema: "PO_LINE_SNAPSHOT_V1" },
      snapshotVersion: 1,
      assessedBy: "assessor-1",
      assessedAt: "2026-08-24T00:00:00.000Z",
      revision: 1
    }));
    const sourceRows = scope.map((_, index) => ({
      id: `line-${index}`,
      companyId,
      itemId: `item-${index}`
    }));
    const recorder = makeRecorder({
      scope,
      sourceRows,
      provenance: [],
      decision: decisions[0]
    });
    recorder.state.changeOrderImpactDecision = decisions;
    const result = await reconcile(recorder);

    expect(result.error).toBeNull();
    expect(recorder.sourceBatchSizes).toEqual([50, 1]);
    expect(result.data).toMatchObject({ started: 51, ended: 0 });
    expect(recorder.state.changeOrderImpactDecisionAffectedItem).toHaveLength(
      51
    );
  });

  it("ends a shared reason in bounded provenance-ID batches", async () => {
    const scope = Array.from({ length: 51 }, (_, index) => ({
      id: `affected-${index}`,
      companyId,
      changeOrderId: changeNoticeId,
      itemId: `item-${index}`
    }));
    const decisions = scope.map((_, index) => ({
      id: `decision-${index}`,
      companyId,
      changeNoticeId,
      targetType: "purchaseOrderLine",
      targetId: `line-${index}`,
      decisionStatus: "Action required",
      noActionReasonCode: null,
      rationale: "Review",
      resolutionNote: null,
      assessmentSnapshot: { schema: "PO_LINE_SNAPSHOT_V1" },
      snapshotVersion: 1,
      assessedBy: "assessor-1",
      assessedAt: "2026-08-24T00:00:00.000Z",
      revision: 1
    }));
    const provenance = scope.map((affected, index) => ({
      id: `provenance-${index}`,
      companyId,
      decisionId: `decision-${index}`,
      affectedItemId: affected.id,
      affectedItemSourceId: affected.itemId,
      affectedItemLabel: null,
      endedAt: null,
      endedBy: null,
      endedReason: null
    }));
    const recorder = makeRecorder({
      scope,
      sourceRows: [],
      provenance,
      decision: decisions[0]
    });
    recorder.state.changeOrderImpactDecision = decisions;

    const result = await reconcile(recorder);

    expect(result.error).toBeNull();
    expect(recorder.provenanceUpdateBatchSizes).toEqual([50, 1]);
    expect(result.data).toMatchObject({ started: 0, ended: 51 });
  });
});
