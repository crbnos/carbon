import { describe, expect, it } from "vitest";
import { SyncOperationStatusSchema } from "./models";
import {
  getClaimEntityTypeExclusion,
  getClaimEntityTypeFilterError,
  getSyncOperationsByIds,
  getSyncOperationTransitionError,
  isCooldownTrigger,
  isLiveSyncOperationStatus,
  SYNC_OPERATION_COOLDOWN_MS,
  shouldSkipForCooldown,
  updateOperationMetadata
} from "./operations";
import type { SyncOperationStatus, SyncOperationTrigger } from "./types";

const ALL_STATUSES = SyncOperationStatusSchema.options;

describe("getSyncOperationTransitionError", () => {
  // Retry (Failed/Warning/Skipped → Pending — Skipped covers both a human
  // opt-out and the drain's machine no-op close), Skip
  // (Failed/Warning/Pending → Skipped), Re-send (Completed/Excluded →
  // Pending — an Excluded journal re-decides against the current policy
  // config)
  const allowed: Array<[SyncOperationStatus, SyncOperationStatus]> = [
    ["Failed", "Pending"],
    ["Warning", "Pending"],
    ["Completed", "Pending"],
    ["Excluded", "Pending"],
    ["Skipped", "Pending"],
    ["Failed", "Skipped"],
    ["Warning", "Skipped"],
    ["Pending", "Skipped"]
  ];

  it("covers every from → to combination exhaustively", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const isAllowed = allowed.some(([f, t]) => f === from && t === to);
        const error = getSyncOperationTransitionError(from, to);

        if (isAllowed) {
          expect(error, `${from} → ${to} should be allowed`).toBeNull();
        } else {
          expect(error, `${from} → ${to} should be rejected`).toBe(
            `invalid transition ${from} → ${to}`
          );
        }
      }
    }
  });

  it("rejects transitions out of In Flight entirely", () => {
    for (const to of ALL_STATUSES) {
      expect(getSyncOperationTransitionError("In Flight", to)).not.toBeNull();
    }
  });
});

describe("isLiveSyncOperationStatus", () => {
  it("absorbs re-triggers only into Pending and In Flight rows", () => {
    expect(isLiveSyncOperationStatus("Pending")).toBe(true);
    expect(isLiveSyncOperationStatus("In Flight")).toBe(true);
    expect(isLiveSyncOperationStatus("Completed")).toBe(false);
    expect(isLiveSyncOperationStatus("Failed")).toBe(false);
    expect(isLiveSyncOperationStatus("Warning")).toBe(false);
    expect(isLiveSyncOperationStatus("Skipped")).toBe(false);
  });
});

describe("shouldSkipForCooldown", () => {
  const now = new Date("2026-07-09T12:00:00.000Z");

  const completedAgo = (ms: number) =>
    new Date(now.getTime() - ms).toISOString();

  it("skips event/webhook re-triggers completed inside the cooldown", () => {
    for (const trigger of ["event", "webhook"] as const) {
      expect(
        shouldSkipForCooldown({
          trigger,
          completedAt: completedAgo(1_000),
          now
        })
      ).toBe(true);
      expect(
        shouldSkipForCooldown({
          trigger,
          completedAt: completedAgo(SYNC_OPERATION_COOLDOWN_MS - 1),
          now
        })
      ).toBe(true);
    }
  });

  it("does not skip once the cooldown has elapsed", () => {
    expect(
      shouldSkipForCooldown({
        trigger: "event",
        completedAt: completedAgo(SYNC_OPERATION_COOLDOWN_MS),
        now
      })
    ).toBe(false);
    expect(
      shouldSkipForCooldown({
        trigger: "webhook",
        completedAt: completedAgo(SYNC_OPERATION_COOLDOWN_MS + 1_000),
        now
      })
    ).toBe(false);
  });

  it("never skips backfill/manual/posting/retry triggers", () => {
    for (const trigger of [
      "backfill",
      "manual",
      "posting",
      "retry"
    ] as SyncOperationTrigger[]) {
      expect(isCooldownTrigger(trigger)).toBe(false);
      expect(
        shouldSkipForCooldown({
          trigger,
          completedAt: completedAgo(1_000),
          now
        })
      ).toBe(false);
    }
  });

  it("does not skip without a completed row or with an invalid timestamp", () => {
    expect(
      shouldSkipForCooldown({ trigger: "event", completedAt: null, now })
    ).toBe(false);
    expect(
      shouldSkipForCooldown({ trigger: "event", completedAt: undefined, now })
    ).toBe(false);
    expect(
      shouldSkipForCooldown({
        trigger: "event",
        completedAt: "not-a-date",
        now
      })
    ).toBe(false);
  });
});

describe("getClaimEntityTypeExclusion", () => {
  it("returns null when there is nothing to exclude", () => {
    expect(getClaimEntityTypeExclusion(undefined)).toBeNull();
    expect(getClaimEntityTypeExclusion([])).toBeNull();
  });

  it("formats a single entity type as a quoted PostgREST list", () => {
    // The daily-consolidation hold: journalEntry rows stay Pending for the
    // consolidation cron instead of being claimed by the drain
    expect(getClaimEntityTypeExclusion(["journalEntry"])).toBe(
      '("journalEntry")'
    );
  });

  it("formats multiple entity types comma-separated", () => {
    expect(getClaimEntityTypeExclusion(["journalEntry", "item"])).toBe(
      '("journalEntry","item")'
    );
  });
});

describe("getClaimEntityTypeFilterError", () => {
  it("allows an include-only claim (daily-consolidation cron)", () => {
    expect(
      getClaimEntityTypeFilterError({ entityTypes: ["journalEntry"] })
    ).toBeNull();
  });

  it("allows an exclude-only claim (drain holding journalEntry)", () => {
    expect(
      getClaimEntityTypeFilterError({ excludeEntityTypes: ["journalEntry"] })
    ).toBeNull();
  });

  it("allows an unfiltered claim", () => {
    expect(getClaimEntityTypeFilterError({})).toBeNull();
    expect(
      getClaimEntityTypeFilterError({ entityTypes: [], excludeEntityTypes: [] })
    ).toBeNull();
  });

  it("rejects combining the include and exclude filters", () => {
    expect(
      getClaimEntityTypeFilterError({
        entityTypes: ["journalEntry"],
        excludeEntityTypes: ["item"]
      })
    ).toBe(
      "entityTypes and excludeEntityTypes are mutually exclusive claim filters"
    );
  });
});

// /********************************************************\
// *      Stateless-caller additions (byIds + metadata)     *
// \********************************************************/
// Minimal chainable stub emulating the exact supabase-js chains these two
// functions use (select().eq().in() thenable; update().eq().eq().select()
// .single()). Rows mutate in place so assertions read the "table" back.

function makeOperationTableStub(rows: Array<Record<string, unknown>>) {
  const client = {
    from(table: string) {
      if (table !== "accountingSyncOperation") {
        throw new Error(`unexpected table ${table}`);
      }

      let matched = rows;
      let patch: Record<string, unknown> | null = null;

      const applyPatch = () => {
        if (!patch) return;
        for (const row of matched) Object.assign(row, patch);
        patch = null;
      };

      const builder = {
        select() {
          return builder;
        },
        update(update: Record<string, unknown>) {
          patch = update;
          return builder;
        },
        eq(column: string, value: unknown) {
          matched = matched.filter((row) => row[column] === value);
          return builder;
        },
        in(column: string, values: readonly unknown[]) {
          matched = matched.filter((row) => values.includes(row[column]));
          return builder;
        },
        single() {
          applyPatch();
          return Promise.resolve(
            matched.length === 1
              ? { data: matched[0], error: null }
              : {
                  data: null,
                  error: { message: `expected 1 row, got ${matched.length}` }
                }
          );
        },
        then(
          onfulfilled?: (value: {
            data: Array<Record<string, unknown>>;
            error: null;
          }) => unknown
        ) {
          applyPatch();
          return Promise.resolve({ data: matched, error: null }).then(
            onfulfilled
          );
        }
      };

      return builder;
    }
  };

  return client as unknown as Parameters<typeof getSyncOperationsByIds>[0];
}

describe("getSyncOperationsByIds", () => {
  it("returns only the requested ids scoped to the company", async () => {
    const rows = [
      { id: "op-1", companyId: "company-1", status: "In Flight" },
      { id: "op-2", companyId: "company-1", status: "Pending" },
      { id: "op-1", companyId: "company-2", status: "In Flight" }
    ];

    const result = await getSyncOperationsByIds(makeOperationTableStub(rows), {
      companyId: "company-1",
      ids: ["op-1", "op-3"]
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      { id: "op-1", companyId: "company-1", status: "In Flight" }
    ]);
  });

  it("short-circuits an empty id list without touching the client", async () => {
    const client = {
      from() {
        throw new Error("should not query for an empty id list");
      }
    } as unknown as Parameters<typeof getSyncOperationsByIds>[0];

    const result = await getSyncOperationsByIds(client, {
      companyId: "company-1",
      ids: []
    });
    expect(result).toEqual({ data: [], error: null });
  });
});

describe("updateOperationMetadata", () => {
  it("replaces metadata (not merges) and leaves the status untouched", async () => {
    const rows = [
      {
        id: "op-1",
        companyId: "company-1",
        status: "In Flight",
        metadata: { qbdPhase: "query", stale: true },
        updatedAt: null
      }
    ];

    const result = await updateOperationMetadata(makeOperationTableStub(rows), {
      id: "op-1",
      companyId: "company-1",
      metadata: { qbdPhase: "mod" }
    });

    expect(result.error).toBeNull();
    expect(rows[0]).toMatchObject({
      status: "In Flight",
      metadata: { qbdPhase: "mod" }
    });
    expect(rows[0]?.metadata).not.toHaveProperty("stale");
    expect(rows[0]?.updatedAt).toBeTruthy();
  });

  it("returns an error for a missing operation", async () => {
    const result = await updateOperationMetadata(makeOperationTableStub([]), {
      id: "op-missing",
      companyId: "company-1",
      metadata: { qbdPhase: "add" }
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/expected 1 row, got 0/);
  });
});
