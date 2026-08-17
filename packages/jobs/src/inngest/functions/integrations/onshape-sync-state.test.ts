import { describe, expect, it } from "vitest";
import {
  accumulateRunCounters,
  buildItemSyncState,
  captureAmbiguousReleases,
  captureUnmatchedReleases,
  createRunProgress,
  finalizeRun,
  isStalled,
  markItemSyncStateFailedByElement,
  markItemSyncStateFailedByItem,
  markRunRunning,
  type OnshapeReleaseReference,
  RELEASE_CAPTURE_LIMIT,
  upsertItemSyncState,
  writeRunProgress
} from "./onshape-sync-state";

// This module is the bookkeeping layer for the Onshape asset sync, so the two
// things pinned hardest here are the ones that would break the SYNC rather than
// the reporting: a write helper must never propagate a failure into its
// enclosing Inngest step, and a terminal run state (a recorded cancel) must
// never be overwritten by the job's own completion write. The rest — builder
// shape, counter folds, the release-capture cap and the stall boundaries — are
// pinned because the panel and the dashboard read them literally.

type RecordedFilter = { method: "eq" | "in"; column: string; value: unknown };

type RecordedCall = {
  table: string;
  operation: "select" | "insert" | "update";
  values?: Record<string, unknown>;
  options?: unknown;
  filters: RecordedFilter[];
};

type FakeClientOptions = {
  /** What the item-state row lookup finds. */
  existingItemRow?: { id: string } | null;
  /** Rows the guarded update matched. */
  updateCount?: number;
  /**
   * The status the single stored row holds. When set, an update carrying a
   * status filter matches the row only if the filter admits this status — which
   * is what makes a guarded failure write observable.
   */
  storedStatus?: string;
  selectErrorMessage?: string;
  insertErrorMessage?: string;
  updateErrorMessage?: string;
  /** Simulates a client that throws instead of returning `{ error }`. */
  throwOnUse?: boolean;
};

// Does the update's own status filter admit the stored row's status?
function statusFilterAdmits(
  filters: RecordedFilter[],
  storedStatus: string
): boolean {
  return filters
    .filter((filter) => filter.column === "status")
    .every((filter) =>
      filter.method === "in"
        ? (filter.value as string[]).includes(storedStatus)
        : filter.value === storedStatus
    );
}

type FakeCarbonClient = {
  from: (table: string) => unknown;
  calls: RecordedCall[];
};

function createFakeCarbonClient(
  options: FakeClientOptions = {}
): FakeCarbonClient {
  const calls: RecordedCall[] = [];

  // The result resolves lazily (once every filter has been recorded) so a fake
  // update can answer according to the filters it was actually given.
  const makeBuilder = (call: RecordedCall, resolveResult: () => unknown) => {
    const builder = {
      eq(column: string, value: unknown) {
        call.filters.push({ method: "eq", column, value });
        return builder;
      },
      in(column: string, value: unknown) {
        call.filters.push({ method: "in", column, value });
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(resolveResult());
      },
      then(
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        return Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
      }
    };
    return builder;
  };

  return {
    calls,
    from(table: string) {
      if (options.throwOnUse) {
        throw new Error("supabase client exploded");
      }
      return {
        select(_columns: string) {
          const call: RecordedCall = {
            table,
            operation: "select",
            filters: []
          };
          calls.push(call);
          return makeBuilder(call, () =>
            options.selectErrorMessage
              ? { data: null, error: { message: options.selectErrorMessage } }
              : { data: options.existingItemRow ?? null, error: null }
          );
        },
        insert(values: Record<string, unknown>) {
          const call: RecordedCall = {
            table,
            operation: "insert",
            values,
            filters: []
          };
          calls.push(call);
          return makeBuilder(call, () =>
            options.insertErrorMessage
              ? { data: null, error: { message: options.insertErrorMessage } }
              : { data: null, error: null }
          );
        },
        update(values: Record<string, unknown>, updateOptions?: unknown) {
          const call: RecordedCall = {
            table,
            operation: "update",
            values,
            options: updateOptions,
            filters: []
          };
          calls.push(call);
          return makeBuilder(call, () => {
            if (options.updateErrorMessage) {
              return {
                data: null,
                error: { message: options.updateErrorMessage },
                count: null
              };
            }
            const matched =
              options.storedStatus === undefined ||
              statusFilterAdmits(call.filters, options.storedStatus);
            return {
              data: null,
              error: null,
              count: matched ? (options.updateCount ?? 1) : 0
            };
          });
        }
      };
    }
  };
}

// The helpers take the service-role Supabase client; the fake stands in for it.
function asCarbonClient(client: FakeCarbonClient) {
  return client as unknown as Parameters<typeof upsertItemSyncState>[0];
}

const itemStateBase = {
  companyId: "company_1",
  userId: "user_1",
  itemId: "item_1",
  assetKind: "model" as const,
  source: "webhook" as const
};

const runWriteBase = {
  companyId: "company_1",
  userId: "user_1",
  runId: "run_1"
};

function makeReleases(
  count: number,
  prefix: string
): OnshapeReleaseReference[] {
  return Array.from({ length: count }, (_unused, index) => ({
    partNumber: `${prefix}-${index}`,
    revision: "A",
    state: "Released"
  }));
}

describe("buildItemSyncState", () => {
  it("builds a synced model row with its identifiers and no skip/error", () => {
    const row = buildItemSyncState({
      ...itemStateBase,
      status: "synced",
      partNumber: "PRT-002033",
      revision: "A",
      revisionId: "rev_1",
      documentId: "doc_1",
      versionId: "ver_1",
      elementId: "el_1",
      releaseState: "Released",
      modelUploadId: "model_1",
      runId: "run_1"
    });

    expect(row).toEqual({
      companyId: "company_1",
      itemId: "item_1",
      assetKind: "model",
      status: "synced",
      source: "webhook",
      skipReason: null,
      error: null,
      observedOnly: false,
      partNumber: "PRT-002033",
      revision: "A",
      revisionId: "rev_1",
      documentId: "doc_1",
      versionId: "ver_1",
      elementId: "el_1",
      releaseState: "Released",
      modelUploadId: "model_1",
      documentPath: null,
      runId: "run_1"
    });
  });

  it("keeps the skip reason as a wire code and leaves error null", () => {
    const row = buildItemSyncState({
      ...itemStateBase,
      status: "skipped",
      skipReason: "asset-too-large"
    });

    expect(row.status).toBe("skipped");
    expect(row.skipReason).toBe("asset-too-large");
    expect(row.error).toBeNull();
  });

  it("carries the error text on a failed row and clears any skip reason", () => {
    const row = buildItemSyncState({
      ...itemStateBase,
      status: "failed",
      error: "Onshape translation FAILED"
    });

    expect(row.status).toBe("failed");
    expect(row.error).toBe("Onshape translation FAILED");
    expect(row.skipReason).toBeNull();
  });

  it("spells omitted revision fields out as null so an update clears stale values", () => {
    const row = buildItemSyncState({ ...itemStateBase, status: "queued" });

    expect(row.partNumber).toBeNull();
    expect(row.revision).toBeNull();
    expect(row.revisionId).toBeNull();
    expect(row.documentId).toBeNull();
    expect(row.versionId).toBeNull();
    expect(row.elementId).toBeNull();
    expect(row.releaseState).toBeNull();
    expect(row.modelUploadId).toBeNull();
    expect(row.documentPath).toBeNull();
    expect(row.runId).toBeNull();
    expect(row.observedOnly).toBe(false);
  });

  it("marks an observed-only row (already attached, never re-downloaded)", () => {
    const row = buildItemSyncState({
      ...itemStateBase,
      assetKind: "drawing",
      source: "backfill",
      status: "synced",
      observedOnly: true
    });

    expect(row.observedOnly).toBe(true);
    expect(row.assetKind).toBe("drawing");
    expect(row.source).toBe("backfill");
  });
});

describe("run progress accumulation", () => {
  it("starts every counter at zero with empty capture lists", () => {
    expect(createRunProgress()).toEqual({
      pagesProcessed: 0,
      revisionsScanned: 0,
      matched: 0,
      synced: 0,
      skippedNoItem: 0,
      skippedAlreadySynced: 0,
      skippedNonModel: 0,
      skippedTooLarge: 0,
      failed: 0,
      unmatchedReleases: [],
      unmatchedOverflow: 0,
      ambiguousReleases: [],
      ambiguousOverflow: 0
    });
  });

  it("adds a delta without mutating the progress it was given", () => {
    const before = createRunProgress();
    const after = accumulateRunCounters(before, {
      pagesProcessed: 1,
      revisionsScanned: 50,
      matched: 12
    });

    expect(after.pagesProcessed).toBe(1);
    expect(after.revisionsScanned).toBe(50);
    expect(after.matched).toBe(12);
    expect(before.revisionsScanned).toBe(0);
  });

  it("folds several pages and per-item outcomes into running totals", () => {
    let progress = createRunProgress();
    progress = accumulateRunCounters(progress, {
      pagesProcessed: 1,
      revisionsScanned: 50,
      matched: 3,
      skippedNoItem: 40,
      skippedAlreadySynced: 5,
      skippedNonModel: 2
    });
    progress = accumulateRunCounters(progress, { synced: 1 });
    progress = accumulateRunCounters(progress, { skippedTooLarge: 1 });
    progress = accumulateRunCounters(progress, { failed: 1 });
    progress = accumulateRunCounters(progress, {
      pagesProcessed: 1,
      revisionsScanned: 10,
      matched: 1
    });
    progress = accumulateRunCounters(progress, { synced: 1 });

    expect(progress.pagesProcessed).toBe(2);
    expect(progress.revisionsScanned).toBe(60);
    expect(progress.matched).toBe(4);
    expect(progress.synced).toBe(2);
    expect(progress.skippedNoItem).toBe(40);
    expect(progress.skippedAlreadySynced).toBe(5);
    expect(progress.skippedNonModel).toBe(2);
    expect(progress.skippedTooLarge).toBe(1);
    expect(progress.failed).toBe(1);
  });
});

describe("release capture", () => {
  it("captures every unmatched release below the cap", () => {
    const progress = captureUnmatchedReleases(
      createRunProgress(),
      makeReleases(3, "PRT")
    );

    expect(progress.unmatchedReleases).toHaveLength(3);
    expect(progress.unmatchedOverflow).toBe(0);
    expect(progress.unmatchedReleases[0]).toEqual({
      partNumber: "PRT-0",
      revision: "A",
      state: "Released"
    });
  });

  it("stops at 200 entries and counts the remainder as overflow", () => {
    const progress = captureUnmatchedReleases(
      createRunProgress(),
      makeReleases(250, "PRT")
    );

    expect(RELEASE_CAPTURE_LIMIT).toBe(200);
    expect(progress.unmatchedReleases).toHaveLength(200);
    expect(progress.unmatchedOverflow).toBe(50);
  });

  it("keeps the cap and the overflow count accurate across pages", () => {
    let progress = createRunProgress();
    for (let page = 0; page < 5; page++) {
      progress = captureUnmatchedReleases(progress, makeReleases(60, "PRT"));
    }

    expect(progress.unmatchedReleases).toHaveLength(200);
    // 300 released, 200 kept — the other 100 are only counted.
    expect(progress.unmatchedOverflow).toBe(100);
  });

  it("caps ambiguous releases independently of unmatched ones", () => {
    let progress = captureUnmatchedReleases(
      createRunProgress(),
      makeReleases(200, "PRT")
    );
    progress = captureAmbiguousReleases(progress, makeReleases(201, "DRW"));

    expect(progress.unmatchedReleases).toHaveLength(200);
    expect(progress.unmatchedOverflow).toBe(0);
    expect(progress.ambiguousReleases).toHaveLength(200);
    expect(progress.ambiguousOverflow).toBe(1);
    expect(progress.ambiguousReleases[0]?.partNumber).toBe("DRW-0");
  });
});

describe("isStalled", () => {
  const now = new Date("2026-07-30T12:00:00.000Z");
  const minutesBefore = (minutes: number) =>
    new Date(now.getTime() - minutes * 60 * 1000).toISOString();

  it("does not call a queued item stalled before 10 minutes, including at 10", () => {
    expect(
      isStalled(
        { kind: "item", status: "queued", createdAt: minutesBefore(9) },
        now
      )
    ).toBe(false);
    expect(
      isStalled(
        { kind: "item", status: "queued", createdAt: minutesBefore(10) },
        now
      )
    ).toBe(false);
  });

  it("calls a queued item stalled past 10 minutes", () => {
    expect(
      isStalled(
        {
          kind: "item",
          status: "queued",
          createdAt: minutesBefore(10.5)
        },
        now
      )
    ).toBe(true);
  });

  it("prefers updatedAt over createdAt, so a fresh write flips it back to live", () => {
    expect(
      isStalled(
        {
          kind: "item",
          status: "queued",
          createdAt: minutesBefore(45),
          updatedAt: minutesBefore(1)
        },
        now
      )
    ).toBe(false);
  });

  it("never calls an item stalled once it has an outcome", () => {
    for (const status of ["running", "synced", "skipped", "failed"] as const) {
      expect(
        isStalled({ kind: "item", status, createdAt: minutesBefore(120) }, now)
      ).toBe(false);
    }
  });

  it("calls a run stalled only past 30 minutes without a progress write", () => {
    expect(
      isStalled(
        {
          kind: "run",
          status: "running",
          createdAt: minutesBefore(120),
          updatedAt: minutesBefore(30)
        },
        now
      )
    ).toBe(false);
    expect(
      isStalled(
        {
          kind: "run",
          status: "running",
          createdAt: minutesBefore(120),
          updatedAt: minutesBefore(31)
        },
        now
      )
    ).toBe(true);
  });

  it("flips a live run back once its next page writes progress", () => {
    const subject = {
      kind: "run" as const,
      status: "running" as const,
      createdAt: minutesBefore(90)
    };
    expect(isStalled({ ...subject, updatedAt: minutesBefore(40) }, now)).toBe(
      true
    );
    expect(isStalled({ ...subject, updatedAt: minutesBefore(2) }, now)).toBe(
      false
    );
  });

  it("falls back to createdAt for a queued run that never wrote progress", () => {
    expect(
      isStalled(
        {
          kind: "run",
          status: "queued",
          createdAt: minutesBefore(31),
          updatedAt: null
        },
        now
      )
    ).toBe(true);
  });

  it("never calls a terminal run stalled", () => {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      expect(
        isStalled({ kind: "run", status, createdAt: minutesBefore(600) }, now)
      ).toBe(false);
    }
  });

  it("reads an unparseable timestamp as not stalled rather than guessing", () => {
    expect(
      isStalled(
        { kind: "item", status: "queued", createdAt: "not-a-date" },
        now
      )
    ).toBe(false);
  });
});

describe("upsertItemSyncState", () => {
  it("inserts a new row scoped by companyId, stamping only createdBy", async () => {
    const client = createFakeCarbonClient({ existingItemRow: null });
    const result = await upsertItemSyncState(asCarbonClient(client), {
      ...itemStateBase,
      status: "synced",
      partNumber: "PRT-002033"
    });

    expect(result).toEqual({ applied: true });
    const lookup = client.calls.find((call) => call.operation === "select");
    expect(lookup?.table).toBe("onshapeItemSyncState");
    expect(lookup?.filters).toEqual([
      { method: "eq", column: "companyId", value: "company_1" },
      { method: "eq", column: "itemId", value: "item_1" },
      { method: "eq", column: "assetKind", value: "model" }
    ]);

    const insert = client.calls.find((call) => call.operation === "insert");
    expect(insert?.values).toMatchObject({
      companyId: "company_1",
      itemId: "item_1",
      assetKind: "model",
      status: "synced",
      source: "webhook",
      createdBy: "user_1"
    });
    // A never-updated row keeps a null updatedAt — that is what the stall read
    // falls back from.
    expect(insert?.values).not.toHaveProperty("updatedAt");
  });

  it("updates the existing row in place, keeping createdBy/createdAt intact", async () => {
    const client = createFakeCarbonClient({
      existingItemRow: { id: "osis_1" }
    });
    const result = await upsertItemSyncState(asCarbonClient(client), {
      ...itemStateBase,
      status: "failed",
      error: "export failed"
    });

    expect(result).toEqual({ applied: true });
    const update = client.calls.find((call) => call.operation === "update");
    expect(update?.values).toMatchObject({
      status: "failed",
      error: "export failed",
      updatedBy: "user_1"
    });
    expect(update?.values).toHaveProperty("updatedAt");
    expect(update?.values).not.toHaveProperty("createdBy");
    expect(update?.values).not.toHaveProperty("createdAt");
    expect(update?.filters).toEqual([
      { method: "eq", column: "id", value: "osis_1" },
      { method: "eq", column: "companyId", value: "company_1" }
    ]);
  });

  it("swallows a database error instead of failing the caller", async () => {
    const client = createFakeCarbonClient({
      existingItemRow: null,
      insertErrorMessage: "duplicate key value violates unique constraint"
    });

    await expect(
      upsertItemSyncState(asCarbonClient(client), {
        ...itemStateBase,
        status: "synced"
      })
    ).resolves.toEqual({ applied: false });
  });
});

describe("markItemSyncStateFailedByElement", () => {
  it("flips the row for one released element, scoped by companyId", async () => {
    const client = createFakeCarbonClient({ updateCount: 1 });
    const result = await markItemSyncStateFailedByElement(
      asCarbonClient(client),
      {
        companyId: "company_1",
        userId: "user_1",
        elementId: "el_1",
        assetKind: "drawing",
        error: "Onshape export failed"
      }
    );

    expect(result).toEqual({ applied: true });
    const update = client.calls.find((call) => call.operation === "update");
    expect(update?.values).toMatchObject({
      status: "failed",
      error: "Onshape export failed",
      updatedBy: "user_1"
    });
    expect(update?.filters).toEqual([
      { method: "eq", column: "companyId", value: "company_1" },
      { method: "eq", column: "elementId", value: "el_1" },
      { method: "eq", column: "assetKind", value: "drawing" }
    ]);
  });

  it("reports no write when the element has no state row yet", async () => {
    const client = createFakeCarbonClient({ updateCount: 0 });

    await expect(
      markItemSyncStateFailedByElement(asCarbonClient(client), {
        companyId: "company_1",
        userId: "user_1",
        elementId: "el_unknown",
        assetKind: "model",
        error: "boom"
      })
    ).resolves.toEqual({ applied: false });
  });
});

describe("markItemSyncStateFailedByItem", () => {
  const failureBase = {
    companyId: "company_1",
    userId: "user_1",
    itemId: "item_1",
    error: "Onshape export failed"
  };

  it("flips a queued row for the item and asset kind, scoped by companyId", async () => {
    const client = createFakeCarbonClient({ storedStatus: "queued" });
    const result = await markItemSyncStateFailedByItem(asCarbonClient(client), {
      ...failureBase,
      assetKind: "drawing",
      onlyFromStatuses: ["queued", "running"]
    });

    expect(result).toEqual({ applied: true });
    const update = client.calls.find((call) => call.operation === "update");
    expect(update?.values).toMatchObject({
      status: "failed",
      error: "Onshape export failed",
      updatedBy: "user_1"
    });
    expect(update?.filters).toEqual([
      { method: "eq", column: "companyId", value: "company_1" },
      { method: "eq", column: "itemId", value: "item_1" },
      { method: "eq", column: "assetKind", value: "drawing" },
      { method: "in", column: "status", value: ["queued", "running"] }
    ]);
  });

  it("CRITICAL: leaves an already-synced model row alone when the drawing arm fails", async () => {
    // The re-pull's two arms share one Inngest run: the model export finished
    // and wrote `synced`, then the drawing export exhausted its retries. The
    // run's failure belongs to the drawing, and the model keeps its outcome.
    const client = createFakeCarbonClient({ storedStatus: "synced" });

    const model = await markItemSyncStateFailedByItem(asCarbonClient(client), {
      ...failureBase,
      assetKind: "model",
      onlyFromStatuses: ["queued", "running"]
    });

    expect(model).toEqual({ applied: false });
  });
});

describe("run row transitions", () => {
  it("starts a run only while it is still queued", async () => {
    const client = createFakeCarbonClient({ updateCount: 1 });
    const result = await markRunRunning(asCarbonClient(client), runWriteBase);

    expect(result).toEqual({ applied: true });
    const update = client.calls.find((call) => call.operation === "update");
    expect(update?.table).toBe("onshapeSyncRun");
    expect(update?.values).toMatchObject({ status: "running" });
    expect(update?.values).toHaveProperty("startedAt");
    expect(update?.filters).toEqual([
      { method: "eq", column: "id", value: "run_1" },
      { method: "eq", column: "companyId", value: "company_1" },
      { method: "eq", column: "status", value: "queued" }
    ]);
  });

  it("does not restart a run that is no longer queued", async () => {
    const client = createFakeCarbonClient({ updateCount: 0 });

    await expect(
      markRunRunning(asCarbonClient(client), runWriteBase)
    ).resolves.toEqual({ applied: false });
  });

  it("writes a page's counters and capture lists onto the run row", async () => {
    const client = createFakeCarbonClient({ updateCount: 1 });
    let progress = accumulateRunCounters(createRunProgress(), {
      pagesProcessed: 1,
      revisionsScanned: 50,
      matched: 2,
      synced: 2
    });
    progress = captureUnmatchedReleases(progress, makeReleases(1, "PRT"));

    const result = await writeRunProgress(asCarbonClient(client), {
      ...runWriteBase,
      progress
    });

    expect(result).toEqual({ applied: true });
    const update = client.calls.find((call) => call.operation === "update");
    expect(update?.values).toMatchObject({
      pagesProcessed: 1,
      revisionsScanned: 50,
      matched: 2,
      synced: 2,
      unmatchedOverflow: 0,
      updatedBy: "user_1"
    });
    expect(update?.values?.unmatchedReleases).toEqual([
      { partNumber: "PRT-0", revision: "A", state: "Released" }
    ]);
    // Progress stops accruing once the run reaches a terminal state.
    expect(update?.filters).toEqual([
      { method: "eq", column: "id", value: "run_1" },
      { method: "eq", column: "companyId", value: "company_1" },
      { method: "in", column: "status", value: ["queued", "running"] }
    ]);
  });

  it("completes a run with its final counters", async () => {
    const client = createFakeCarbonClient({ updateCount: 1 });
    const progress = accumulateRunCounters(createRunProgress(), {
      pagesProcessed: 2,
      revisionsScanned: 60,
      synced: 4
    });

    const result = await finalizeRun(asCarbonClient(client), {
      ...runWriteBase,
      status: "completed",
      progress
    });

    expect(result).toEqual({ applied: true });
    const update = client.calls.find((call) => call.operation === "update");
    expect(update?.values).toMatchObject({
      status: "completed",
      error: null,
      revisionsScanned: 60,
      synced: 4
    });
    expect(update?.values).toHaveProperty("finishedAt");
  });

  it("never overwrites a recorded cancel with its own completion", async () => {
    // The cancel route already wrote `cancelled`, so the status guard matches
    // no row and the job's completion write is a no-op.
    const client = createFakeCarbonClient({ updateCount: 0 });

    const result = await finalizeRun(asCarbonClient(client), {
      ...runWriteBase,
      status: "completed"
    });

    expect(result).toEqual({ applied: false });
    const update = client.calls.find((call) => call.operation === "update");
    expect(update?.filters).toEqual([
      { method: "eq", column: "id", value: "run_1" },
      { method: "eq", column: "companyId", value: "company_1" },
      { method: "in", column: "status", value: ["queued", "running"] }
    ]);
  });

  it("records a failed run with its error message", async () => {
    const client = createFakeCarbonClient({ updateCount: 1 });

    const result = await finalizeRun(asCarbonClient(client), {
      ...runWriteBase,
      status: "failed",
      error: "aborting after 5 consecutive failures"
    });

    expect(result).toEqual({ applied: true });
    const update = client.calls.find((call) => call.operation === "update");
    expect(update?.values).toMatchObject({
      status: "failed",
      error: "aborting after 5 consecutive failures"
    });
  });
});

describe("legacy events without a runId", () => {
  // A backfill event queued before sync tracking existed carries no runId. Such
  // a run syncs exactly as before and tracks nothing — it must never invent a
  // run row or touch the database for bookkeeping.
  const legacyPayload: { companyId: string; userId: string; runId?: string } = {
    companyId: "company_1",
    userId: "user_1"
  };

  it("no-ops every run-level write without touching the client", async () => {
    const client = createFakeCarbonClient({ throwOnUse: true });
    const runWrite = {
      companyId: legacyPayload.companyId,
      userId: legacyPayload.userId,
      runId: legacyPayload.runId
    };

    await expect(
      markRunRunning(asCarbonClient(client), runWrite)
    ).resolves.toEqual({ applied: false });
    await expect(
      writeRunProgress(asCarbonClient(client), {
        ...runWrite,
        progress: createRunProgress()
      })
    ).resolves.toEqual({ applied: false });
    await expect(
      finalizeRun(asCarbonClient(client), { ...runWrite, status: "completed" })
    ).resolves.toEqual({ applied: false });

    expect(client.calls).toHaveLength(0);
  });
});

describe("bookkeeping is never fatal to the sync", () => {
  it("CRITICAL: a throwing client inside a write helper does not fail the enclosing sync step", async () => {
    const exploding = asCarbonClient(
      createFakeCarbonClient({ throwOnUse: true })
    );

    // Stands in for the work-item Inngest step: the export succeeded and the
    // state write runs inside the same step. If the write threw, Inngest would
    // retry — re-running an export that already completed.
    const runSyncStep = async () => {
      const exportOutcome = { modelUploadId: "model_1" };
      await upsertItemSyncState(exploding, {
        ...itemStateBase,
        status: "synced",
        modelUploadId: exportOutcome.modelUploadId
      });
      return exportOutcome;
    };

    await expect(runSyncStep()).resolves.toEqual({ modelUploadId: "model_1" });
  });

  it("resolves instead of throwing for every write helper", async () => {
    const exploding = asCarbonClient(
      createFakeCarbonClient({ throwOnUse: true })
    );

    await expect(
      upsertItemSyncState(exploding, { ...itemStateBase, status: "queued" })
    ).resolves.toEqual({ applied: false });
    await expect(
      markItemSyncStateFailedByElement(exploding, {
        companyId: "company_1",
        userId: "user_1",
        elementId: "el_1",
        assetKind: "model",
        error: "boom"
      })
    ).resolves.toEqual({ applied: false });
    await expect(
      markItemSyncStateFailedByItem(exploding, {
        companyId: "company_1",
        userId: "user_1",
        itemId: "item_1",
        assetKind: "model",
        error: "boom",
        onlyFromStatuses: ["queued", "running"]
      })
    ).resolves.toEqual({ applied: false });
    await expect(markRunRunning(exploding, runWriteBase)).resolves.toEqual({
      applied: false
    });
    await expect(
      writeRunProgress(exploding, {
        ...runWriteBase,
        progress: createRunProgress()
      })
    ).resolves.toEqual({ applied: false });
    await expect(
      finalizeRun(exploding, { ...runWriteBase, status: "completed" })
    ).resolves.toEqual({ applied: false });
  });

  it("treats a returned database error the same way — logged, not thrown", async () => {
    const failing = asCarbonClient(
      createFakeCarbonClient({
        existingItemRow: { id: "osis_1" },
        updateErrorMessage: "deadlock detected",
        selectErrorMessage: undefined
      })
    );

    await expect(
      upsertItemSyncState(failing, { ...itemStateBase, status: "synced" })
    ).resolves.toEqual({ applied: false });
    await expect(
      writeRunProgress(failing, {
        ...runWriteBase,
        progress: createRunProgress()
      })
    ).resolves.toEqual({ applied: false });
    await expect(
      finalizeRun(failing, { ...runWriteBase, status: "failed", error: "x" })
    ).resolves.toEqual({ applied: false });
  });
});
