import { describe, expect, it, vi } from "vitest";

// The settings barrel re-exports its UI, which transitively pulls Lingui `msg`
// macros that vitest does not transform. accounting.service only needs
// getNextSequence from it, which these tests never exercise — stub it to keep
// the import graph light and macro-free.
vi.mock("~/modules/settings", () => ({
  getNextSequence: vi.fn()
}));

// @carbon/glossary's terms.ts evaluates Lingui `msg` macros at module load,
// which vitest doesn't transform. Nothing under test touches the glossary, so
// stub the whole package.
vi.mock("@carbon/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: () => [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: (t: string) => t,
  terms: {}
}));

import type {
  PeriodCloseTaskRow,
  PeriodReadinessCheck
} from "./accounting.service";
import {
  checklistTasksToCreate,
  closeAccountingPeriod,
  closePeriodWithChecklist,
  createFiscalYearPeriods,
  deleteAccountingPeriod,
  evaluateCloseChecklist,
  getAccountingPeriodDeletability,
  getFiscalCalendarCommitted,
  getOrCreateAccountingPeriod,
  postJournalEntry,
  reopenAccountingPeriod,
  skipCloseTask
} from "./accounting.service";

// ---------------------------------------------------------------------------
// Sequential close / reverse-sequential reopen gates (acceptance criteria 4/5)
//
// These exercise the real service functions against a scripted fake supabase
// client. Each awaited query (or `.single()`) shifts the next scripted result
// off the queue, in the exact order the function issues them:
//   close:  getAccountingPeriodById -> earlierOpen count -> update
//   reopen: getAccountingPeriodById -> laterClosed count -> update
// ---------------------------------------------------------------------------

type Scripted = { data?: unknown; count?: number; error?: unknown };

function makeClient(responses: Scripted[]) {
  let i = 0;
  const next = () => responses[i++] ?? { data: null, error: null };
  const builder: any = {
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    delete: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    lt: () => builder,
    gt: () => builder,
    gte: () => builder,
    lte: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    single: () => Promise.resolve(next()),
    then: (resolve: (v: Scripted) => unknown) => resolve(next())
  };
  return { from: () => builder } as any;
}

// Like makeClient but records every `.update(values)` keyed by table, so tests
// can assert which rows a service persisted (and in what state), not just its
// return value. The shared response queue advances in issue order exactly as in
// makeClient; a fresh builder per `from(table)` carries the table name through.
function makeRecordingClient(responses: Scripted[]) {
  let i = 0;
  const next = () => responses[i++] ?? { data: null, error: null };
  const updates: { table: string; values: any }[] = [];
  const makeBuilder = (table: string) => {
    const builder: any = {
      select: () => builder,
      insert: () => builder,
      upsert: () => builder,
      update: (values: any) => {
        updates.push({ table, values });
        return builder;
      },
      eq: () => builder,
      neq: () => builder,
      in: () => builder,
      lt: () => builder,
      gt: () => builder,
      gte: () => builder,
      lte: () => builder,
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      single: () => Promise.resolve(next()),
      then: (resolve: (v: Scripted) => unknown) => resolve(next())
    };
    return builder;
  };
  return { client: { from: (t: string) => makeBuilder(t) } as any, updates };
}

// The close path flips periodCloseTask + accountingPeriod through the Kysely
// client inside a single transaction. This records every `.set(values)` keyed
// by table so tests can assert the persisted state, mirroring the supabase
// recording client above. `.execute()` resolves empty — the service ignores the
// result and returns `{ id: periodId }` on a clean transaction.
function makeKyselyRecorder() {
  const updates: { table: string; values: any }[] = [];
  // Raw statements executed on the transaction. The close path snapshots GL
  // balances via `sql`SELECT "snapshotAccountingPeriodBalances"(...)`.execute(trx)`
  // after the period flip, so `tx` must satisfy Kysely's RawBuilder.execute
  // (which reads `trx.getExecutor()`). We don't parse the SQL — recording that a
  // raw statement ran is enough to assert the snapshot fired. The executor is a
  // Proxy so it tolerates whatever internal methods RawBuilder.execute calls.
  const rawExecutions: unknown[] = [];
  const executor = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "executeQuery")
          return async (compiled: unknown) => {
            rawExecutions.push(compiled);
            return { rows: [] };
          };
        if (prop === "transformQuery") return (node: unknown) => node;
        if (prop === "compileQuery")
          return (node: unknown) => ({ sql: "", parameters: [], query: node });
        if (prop === "provideConnection")
          return async (fn: (c: unknown) => unknown) =>
            fn({
              executeQuery: async (compiled: unknown) => {
                rawExecutions.push(compiled);
                return { rows: [] };
              }
            });
        return () => undefined;
      }
    }
  );
  const tx = {
    updateTable(table: string) {
      const builder: any = {
        set: (values: any) => {
          updates.push({ table, values });
          return builder;
        },
        where: () => builder,
        execute: () => Promise.resolve([])
      };
      return builder;
    },
    getExecutor: () => executor
  };
  const db: any = {
    transaction: () => ({
      execute: async (fn: (t: unknown) => Promise<unknown>) => {
        await fn(tx);
      }
    })
  };
  return { db, updates, rawExecutions };
}

const args = { periodId: "P2", companyId: "C1", userId: "U1" };

describe("closeAccountingPeriod — sequential close", () => {
  it("rejects closing period N while an earlier period is not Closed", async () => {
    const client = makeClient([
      { data: { id: "P2", startDate: "2026-02-01", closeStatus: "Locked" } },
      { count: 1 } // one earlier period still open
    ]);
    const { db } = makeKyselyRecorder();

    const result = await closeAccountingPeriod(client, db, args);

    expect(result.error).toBeTruthy();
    expect(result.error?.message).toMatch(/sequential close/i);
    expect(result.data).toBeNull();
  });

  it("rejects closing a period that is not yet Locked", async () => {
    const client = makeClient([
      { data: { id: "P2", startDate: "2026-02-01", closeStatus: "Open" } }
    ]);
    const { db } = makeKyselyRecorder();

    const result = await closeAccountingPeriod(client, db, args);

    expect(result.error?.message).toMatch(/must be locked/i);
    expect(result.data).toBeNull();
  });

  it("allows closing when earlier periods are closed and the checklist is clear", async () => {
    // Query order after the sequential gate:
    //   getPeriodCloseChecklist: getAccountingPeriodById -> [definitions, tasks]
    //     -> readiness (4 parallel) ; then the period-flip update.
    const client = makeClient([
      { data: { id: "P2", startDate: "2026-02-01", closeStatus: "Locked" } },
      { count: 0 }, // no earlier open periods
      {
        data: {
          id: "P2",
          startDate: "2026-02-01",
          endDate: "2026-02-28",
          closeStatus: "Locked"
        }
      },
      { data: [] }, // active definitions (none configured)
      { data: [] }, // existing tasks (none)
      { count: 0 }, // readiness: draft journals
      { data: [] }, // readiness: posted journals in period
      { count: 0 }, // readiness: draft depreciation
      { count: 0 }, // readiness: unmatched intercompany
      { count: 0 }, // readiness: pending receipts
      { count: 0 }, // readiness: pending shipments
      { count: 0 }, // readiness: pending sales invoices
      { count: 0 }, // readiness: pending purchase invoices
      { count: 0 }, // readiness: draft payments
      { count: 0 } // readiness: draft memos
    ]);
    // The period-flip write goes through the Kysely transaction, not supabase.
    const { db } = makeKyselyRecorder();

    const result = await closeAccountingPeriod(client, db, args);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "P2" });
  });
});

// ---------------------------------------------------------------------------
// closePeriodWithChecklist — the UI entry point (acceptance criteria 1/4).
//
// Delegates to closeAccountingPeriod, so it drives the full query graph:
//   getAccountingPeriodById -> earlierOpen count
//   -> getPeriodCloseChecklist(getAccountingPeriodById -> [definitions, tasks]
//      -> readiness: [draftJournals, journalsInPeriod, draftDepreciation, IC,
//         pendingReceipts, pendingShipments, pendingSalesInv, pendingPurchInv])
//   -> (per differing Auto task) periodCloseTask update
//   -> accountingPeriod flip.
// makeRecordingClient (above) records every `.update()` keyed by table so we can
// assert both the close-gate outcome and that final Auto-task states persist.
// ---------------------------------------------------------------------------

// Close requires the period to already be Locked (Open -> Locked -> Closed).
const lockedPeriod = {
  id: "P2",
  startDate: "2026-02-01",
  closeStatus: "Locked"
};
const lockedPeriodWithRange = {
  ...lockedPeriod,
  endDate: "2026-02-28"
};

describe("closePeriodWithChecklist — Blocker gate + Auto-task persistence", () => {
  it("rejects the close when a Blocker auto-check (draft JEs) is failing", async () => {
    const { client, updates } = makeRecordingClient([
      { data: lockedPeriod }, // getAccountingPeriodById
      { count: 0 }, // no earlier open periods
      { data: lockedPeriodWithRange }, // checklist: getAccountingPeriodById
      { data: [] }, // active definitions (already instantiated)
      {
        data: [
          {
            id: "auto1",
            companyId: "C1",
            accountingPeriodId: "P2",
            definitionId: "d1",
            name: "Post or re-date draft journal entries",
            taskType: "Auto",
            autoCheckKey: "draft-journals",
            sortOrder: 1,
            required: true,
            severity: "Blocker",
            status: "Open",
            assigneeId: null,
            completedBy: null,
            completedAt: null,
            skippedReason: null,
            notes: null
          }
        ]
      }, // existing tasks — no instantiation needed
      { count: 2 }, // readiness: draft journals present -> Blocker failing
      { data: [] }, // readiness: posted journals in period
      { count: 0 }, // readiness: draft depreciation
      { count: 0 }, // readiness: unmatched intercompany
      { count: 0 }, // readiness: pending receipts
      { count: 0 }, // readiness: pending shipments
      { count: 0 }, // readiness: pending sales invoices
      { count: 0 }, // readiness: pending purchase invoices
      { count: 0 }, // readiness: draft payments
      { count: 0 } // readiness: draft memos
    ]);
    const { db, updates: txUpdates } = makeKyselyRecorder();

    const result = await closePeriodWithChecklist(client, db, args);

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/draft journal/i);
    // The close is rejected before the transaction opens, so nothing is
    // persisted through either client.
    expect(txUpdates).toHaveLength(0);
    expect(
      updates.some(
        (u) =>
          u.table === "accountingPeriod" && u.values.closeStatus === "Closed"
      )
    ).toBe(false);
  });

  it("persists the resolved Auto-task state, then closes, when checks pass", async () => {
    const { client } = makeRecordingClient([
      { data: lockedPeriod }, // getAccountingPeriodById
      { count: 0 }, // no earlier open periods
      { data: lockedPeriodWithRange }, // checklist: getAccountingPeriodById
      { data: [] }, // active definitions
      {
        data: [
          {
            id: "auto1",
            companyId: "C1",
            accountingPeriodId: "P2",
            definitionId: "d1",
            name: "Post or re-date draft journal entries",
            taskType: "Auto",
            autoCheckKey: "draft-journals",
            sortOrder: 1,
            required: true,
            severity: "Blocker",
            status: "Open", // stale Open; readiness now passes -> flips to Done
            assigneeId: null,
            completedBy: null,
            completedAt: null,
            skippedReason: null,
            notes: null
          }
        ]
      },
      { count: 0 }, // readiness: no draft journals -> Blocker passing
      { data: [] }, // readiness: posted journals in period
      { count: 0 }, // readiness: draft depreciation
      { count: 0 }, // readiness: unmatched intercompany
      { count: 0 }, // readiness: pending receipts
      { count: 0 }, // readiness: pending shipments
      { count: 0 }, // readiness: pending sales invoices
      { count: 0 }, // readiness: pending purchase invoices
      { count: 0 }, // readiness: draft payments
      { count: 0 } // readiness: draft memos
    ]);
    // The task persist + period flip both run inside the Kysely transaction.
    const { db, updates: txUpdates, rawExecutions } = makeKyselyRecorder();

    const result = await closePeriodWithChecklist(client, db, args);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "P2" });

    // The GL balance snapshot is written (snapshotAccountingPeriodBalances) via a
    // raw statement inside the same transaction, after the period is flipped.
    expect(rawExecutions.length).toBeGreaterThan(0);

    // Final Auto-task state persisted to periodCloseTask as Done.
    const taskUpdate = txUpdates.find((u) => u.table === "periodCloseTask");
    expect(taskUpdate?.values.status).toBe("Done");

    // Period flipped to Closed after the task state was flushed.
    const periodUpdate = txUpdates.find((u) => u.table === "accountingPeriod");
    expect(periodUpdate?.values.closeStatus).toBe("Closed");
    // The task write precedes the period flip within the transaction.
    expect(txUpdates.map((u) => u.table)).toEqual([
      "periodCloseTask",
      "accountingPeriod"
    ]);
  });
});

// ---------------------------------------------------------------------------
// Close checklist gating (acceptance criteria 6/9/10) — exercised as pure logic
// so the gate is verified without scripting a full query graph.
// ---------------------------------------------------------------------------

function task(overrides: Partial<PeriodCloseTaskRow>): PeriodCloseTaskRow {
  return {
    id: "T",
    companyId: "C1",
    accountingPeriodId: "P2",
    definitionId: "D",
    name: "Task",
    taskType: "Manual",
    autoCheckKey: null,
    sortOrder: 1,
    required: true,
    severity: null,
    status: "Open",
    assigneeId: null,
    completedBy: null,
    completedAt: null,
    skippedReason: null,
    notes: null,
    ...overrides
  };
}

const draftBlockerFailing: PeriodReadinessCheck = {
  autoCheckKey: "draft-journals",
  severity: "Blocker",
  label: "Draft journal entries dated in this period",
  failing: true,
  count: 2
};
const draftBlockerPassing: PeriodReadinessCheck = {
  ...draftBlockerFailing,
  failing: false,
  count: 0
};

describe("checklistTasksToCreate — idempotent instantiation (criterion 6)", () => {
  it("creates a task per definition on first run, none on re-run", () => {
    const defs = [{ id: "d1" }, { id: "d2" }, { id: "d3" }];

    const first = checklistTasksToCreate(defs, []);
    expect(first.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);

    // Simulate the tasks that first-run would have created, then re-run.
    const existing = first.map((d) => ({ definitionId: d.id }));
    const second = checklistTasksToCreate(defs, existing);
    expect(second).toEqual([]);
  });
});

describe("evaluateCloseChecklist — close gate (criteria 7/10)", () => {
  it("blocks close when a required manual task is still Open", () => {
    const result = evaluateCloseChecklist(
      [task({ taskType: "Manual", status: "Open", name: "Review financials" })],
      [],
      "Locked"
    );
    expect(result.canClose).toBe(false);
    expect(result.blockingReason).toMatch(/Review financials/);
  });

  it("blocks close when a Blocker auto-check is failing", () => {
    const result = evaluateCloseChecklist(
      [
        task({
          taskType: "Auto",
          autoCheckKey: "draft-journals",
          severity: "Blocker",
          status: "Open",
          name: "Post or re-date draft journal entries"
        })
      ],
      [draftBlockerFailing],
      "Locked"
    );
    expect(result.canClose).toBe(false);
    expect(result.blockingReason).toMatch(/draft journal/i);
  });

  it("fails closed when an Auto task has no registered evaluator", () => {
    const result = evaluateCloseChecklist(
      [
        task({
          taskType: "Auto",
          autoCheckKey: "future-custom-check",
          severity: "Blocker",
          status: "Open",
          name: "Some future auto check"
        })
      ],
      [], // no evaluator produced for this key
      "Locked"
    );
    expect(result.canClose).toBe(false);
    expect(result.blockingReason).toMatch(/Some future auto check/);
  });

  it("allows close and persists the resolved Auto-task state when checks pass", () => {
    const result = evaluateCloseChecklist(
      [
        task({
          id: "auto1",
          taskType: "Auto",
          autoCheckKey: "draft-journals",
          severity: "Blocker",
          status: "Open"
        }),
        task({ taskType: "Manual", status: "Done" })
      ],
      [draftBlockerPassing],
      "Locked"
    );
    expect(result.canClose).toBe(true);
    expect(result.autoTaskStates).toEqual([{ id: "auto1", status: "Done" }]);
  });

  it("derives the Lock task status from closeStatus and gates the close on it", () => {
    const lockTask = task({
      taskType: "Action",
      status: "Open",
      name: "Lock the period"
    });

    const openState = evaluateCloseChecklist([lockTask], [], "Open");
    expect(openState.tasks[0]?.effectiveStatus).toBe("Open");
    expect(openState.canClose).toBe(false);
    expect(openState.blockingReason).toMatch(/Lock the period/);

    const lockedState = evaluateCloseChecklist([lockTask], [], "Locked");
    expect(lockedState.tasks[0]?.effectiveStatus).toBe("Done");
    expect(lockedState.canClose).toBe(true);
  });
});

describe("reopenAccountingPeriod — reverse-sequential reopen", () => {
  it("rejects reopening period N while a later period is still Closed", async () => {
    const client = makeClient([
      { data: { id: "P2", startDate: "2026-02-01", closeStatus: "Closed" } },
      { count: 1 } // a later period is still closed
    ]);

    const result = await reopenAccountingPeriod(client, args);

    expect(result.error).toBeTruthy();
    expect(result.error?.message).toMatch(/later periods must be reopened/i);
    expect(result.data).toBeNull();
  });

  it("allows reopening when no later period is Closed", async () => {
    const client = makeClient([
      {
        data: {
          id: "P2",
          startDate: "2026-02-01",
          endDate: "2026-02-28",
          closeStatus: "Closed"
        }
      },
      { count: 0 }, // no later closed periods
      { error: null }, // delete cumulative snapshots (invariant #3)
      { data: { id: "P2" }, error: null } // update
    ]);

    const result = await reopenAccountingPeriod(client, args);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "P2" });
  });

  // Records which table each terminal op hit, so we can assert the reopen both
  // deletes the stale cumulative snapshots and orders the delete before the flip.
  function makeReopenTracker(responses: Scripted[]) {
    const ops: string[] = [];
    let i = 0;
    const next = () => responses[i++] ?? { data: null, error: null };
    const makeBuilder = (table: string) => {
      const builder: any = {
        select: () => builder,
        update: () => {
          ops.push(`update:${table}`);
          return builder;
        },
        delete: () => {
          ops.push(`delete:${table}`);
          return builder;
        },
        eq: () => builder,
        neq: () => builder,
        gt: () => builder,
        gte: () => builder,
        lt: () => builder,
        lte: () => builder,
        or: () => builder,
        order: () => builder,
        limit: () => builder,
        single: () => Promise.resolve(next()),
        then: (resolve: (v: Scripted) => unknown) => resolve(next())
      };
      return builder;
    };
    return { client: { from: (t: string) => makeBuilder(t) } as any, ops };
  }

  it("deletes cumulative snapshots at/after the period end before flipping to Open", async () => {
    const { client, ops } = makeReopenTracker([
      {
        data: {
          id: "P2",
          startDate: "2026-02-01",
          endDate: "2026-02-28",
          closeStatus: "Closed"
        }
      },
      { count: 0 }, // no later closed periods
      { error: null }, // delete snapshots
      { data: { id: "P2" }, error: null } // update
    ]);

    const result = await reopenAccountingPeriod(client, args);

    expect(result.error).toBeNull();
    // Snapshot rows are cleared, and the delete precedes the status flip.
    expect(ops).toEqual([
      "delete:accountingPeriodBalance",
      "update:accountingPeriod"
    ]);
  });

  it("aborts the reopen (period stays Closed) if snapshot deletion fails", async () => {
    const { client, ops } = makeReopenTracker([
      {
        data: {
          id: "P2",
          startDate: "2026-02-01",
          endDate: "2026-02-28",
          closeStatus: "Closed"
        }
      },
      { count: 0 }, // no later closed periods
      { error: { message: "snapshot delete failed" } } // delete fails
    ]);

    const result = await reopenAccountingPeriod(client, args);

    expect(result.error?.message).toBe("snapshot delete failed");
    // The period was never flipped — no update issued after the failed delete.
    expect(ops).toEqual(["delete:accountingPeriodBalance"]);
  });
});

// ---------------------------------------------------------------------------
// Source-aware posting gate (acceptance criteria 2/3)
//
// getOrCreateAccountingPeriod issues one query (getCurrentAccountingPeriod's
// `.single()`) to resolve the current period, then applies the close-status
// gate. An Active + Locked period rejects "operational" posting but still
// accepts "accounting" adjustments.
// ---------------------------------------------------------------------------

describe("getOrCreateAccountingPeriod — locked-period source gate", () => {
  it("rejects operational posting into a Locked period", async () => {
    const client = makeClient([
      { data: { id: "P2", status: "Active", closeStatus: "Locked" } }
    ]);

    const result = await getOrCreateAccountingPeriod(
      client,
      "C1",
      "2026-02-15",
      "operational"
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/locked/i);
  });

  it("allows accounting posting into a Locked period", async () => {
    const client = makeClient([
      { data: { id: "P2", status: "Active", closeStatus: "Locked" } }
    ]);

    const result = await getOrCreateAccountingPeriod(
      client,
      "C1",
      "2026-02-15",
      "accounting"
    );

    expect(result.error).toBeNull();
    expect(result.data).toBe("P2");
  });
});

// ---------------------------------------------------------------------------
// postJournalEntry now routes through the period gate (source "accounting").
// A balanced manual JE dated in a Closed period must be rejected — before the
// gate was wired in, the status flip proceeded regardless of period state.
//
// Query order: getJournalEntry `.single()` -> getCurrentAccountingPeriod
// `.single()` -> (only if the gate passes) the status-flip update `.single()`.
// ---------------------------------------------------------------------------

describe("postJournalEntry — period gate wiring", () => {
  const draftEntry = {
    data: {
      id: "J1",
      status: "Draft",
      companyId: "C1",
      postingDate: "2026-02-15",
      journalLine: [
        { amount: 100, account: { class: "Asset" } },
        { amount: 100, account: { class: "Liability" } }
      ]
    },
    error: null
  };

  it("rejects posting a balanced manual JE into a Closed period", async () => {
    const client = makeClient([
      draftEntry,
      { data: { id: "P2", status: "Active", closeStatus: "Closed" } }
    ]);

    const result = await postJournalEntry(client, "J1", "U1");

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/closed/i);
  });

  it("posts a balanced manual JE into a Locked period (accounting source)", async () => {
    const client = makeClient([
      draftEntry,
      { data: { id: "P2", status: "Active", closeStatus: "Locked" } },
      { data: { id: "J1" }, error: null }
    ]);

    const result = await postJournalEntry(client, "J1", "U1");

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "J1" });
  });
});

// ---------------------------------------------------------------------------
// skipCloseTask — Blocker skip rejection + empty-reason rejection (criteria 8/9)
// Query order: getPeriodCloseTaskById `.single()` -> (only if allowed) update.
// ---------------------------------------------------------------------------

describe("skipCloseTask — skip guards", () => {
  it("rejects an empty skip reason before touching the database", async () => {
    const client = makeClient([]);
    const result = await skipCloseTask(client, {
      taskId: "T1",
      companyId: "C1",
      userId: "U1",
      skippedReason: "   "
    });
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/reason is required/i);
  });

  it("rejects skipping a Blocker task", async () => {
    const client = makeClient([
      {
        data: {
          id: "T1",
          taskType: "Auto",
          severity: "Blocker",
          status: "Open"
        }
      }
    ]);
    const result = await skipCloseTask(client, {
      taskId: "T1",
      companyId: "C1",
      userId: "U1",
      skippedReason: "not applicable this month"
    });
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/cannot be skipped/i);
  });

  it("skips a Warning task with a recorded reason", async () => {
    const client = makeClient([
      {
        data: {
          id: "T2",
          taskType: "Auto",
          severity: "Warning",
          status: "Open"
        }
      },
      { data: { id: "T2" }, error: null } // update
    ]);
    const result = await skipCloseTask(client, {
      taskId: "T2",
      companyId: "C1",
      userId: "U1",
      skippedReason: "intercompany matched manually"
    });
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "T2" });
  });
});

// ---------------------------------------------------------------------------
// Period deletability + deletion guard, the fiscal-calendar "committed" check,
// and fiscal-year generation. These exercise the real service functions against
// the scripted fake supabase client; each awaited query / `.single()` shifts the
// next scripted result off the queue in the order the function issues them.
// ---------------------------------------------------------------------------

// Like makeClient but records every `.insert(values)` so a test can assert the
// rows a service generated (createFiscalYearPeriods' month math).
function makeInsertRecordingClient(responses: Scripted[]) {
  let i = 0;
  const next = () => responses[i++] ?? { data: null, error: null };
  const inserts: any[] = [];
  const builder: any = {
    select: () => builder,
    insert: (values: any) => {
      inserts.push(values);
      return builder;
    },
    eq: () => builder,
    single: () => Promise.resolve(next()),
    then: (resolve: (v: Scripted) => unknown) => resolve(next())
  };
  return { client: { from: () => builder } as any, inserts };
}

describe("getAccountingPeriodDeletability", () => {
  // Query order: getAccountingPeriodById (.single) -> journal count.
  it("allows deleting an open period with no journals", async () => {
    const client = makeClient([
      { data: { id: "P1", closeStatus: "Open", startDate: "2026-03-01" } },
      { count: 0 }
    ]);
    const result = await getAccountingPeriodDeletability(client, "P1", "C1");
    expect(result.data?.canDelete).toBe(true);
    expect(result.data?.reason).toBeNull();
  });

  it("blocks an open period that has journals posted to it", async () => {
    const client = makeClient([
      { data: { id: "P1", closeStatus: "Open", startDate: "2026-03-01" } },
      { count: 3 }
    ]);
    const result = await getAccountingPeriodDeletability(client, "P1", "C1");
    expect(result.data?.canDelete).toBe(false);
    expect(result.data?.reason).toMatch(/3 journal entries/);
  });

  it("blocks a Locked/Closed period regardless of journals", async () => {
    const client = makeClient([
      { data: { id: "P1", closeStatus: "Locked", startDate: "2026-03-01" } },
      { count: 0 }
    ]);
    const result = await getAccountingPeriodDeletability(client, "P1", "C1");
    expect(result.data?.canDelete).toBe(false);
    expect(result.data?.reason).toMatch(/Locked/);
  });
});

describe("deleteAccountingPeriod — server-side guard", () => {
  it("refuses to delete a non-open period (never issues the DELETE)", async () => {
    const client = makeClient([
      { data: { id: "P1", closeStatus: "Closed", startDate: "2026-03-01" } },
      { count: 0 }
    ]);
    const result = await deleteAccountingPeriod(client, {
      periodId: "P1",
      companyId: "C1"
    });
    expect(result.error?.message).toMatch(/Closed/);
    expect(result.data).toBeNull();
  });

  it("deletes an open, empty period", async () => {
    const client = makeClient([
      { data: { id: "P1", closeStatus: "Open", startDate: "2026-03-01" } },
      { count: 0 },
      { data: null, error: null } // the DELETE result
    ]);
    const result = await deleteAccountingPeriod(client, {
      periodId: "P1",
      companyId: "C1"
    });
    expect(result.error).toBeNull();
  });
});

describe("getFiscalCalendarCommitted", () => {
  // committed = (non-open periods) OR (postings); the OR is order-independent,
  // so these assertions hold regardless of how the two counts are scripted.
  it("is not committed when every period is Open and there are no postings", async () => {
    const client = makeClient([{ count: 0 }, { count: 0 }]);
    const result = await getFiscalCalendarCommitted(client, "C1");
    expect(result.data?.committed).toBe(false);
  });

  it("is committed once a Locked/Closed period or a posting exists", async () => {
    const client = makeClient([{ count: 1 }, { count: 0 }]);
    const result = await getFiscalCalendarCommitted(client, "C1");
    expect(result.data?.committed).toBe(true);
  });
});

describe("createFiscalYearPeriods", () => {
  // Query order: getFiscalYearSettings (.single) -> existing periodNumbers ->
  // insert (only when there are rows to create).
  it("is idempotent — creates nothing when all 12 periods already exist", async () => {
    const existing = Array.from({ length: 12 }, (_, p) => ({
      periodNumber: p + 1
    }));
    const client = makeClient([
      { data: { startMonth: "January" } },
      { data: existing }
    ]);
    const result = await createFiscalYearPeriods(client, {
      companyId: "C1",
      fiscalYear: 2027,
      userId: "U1"
    });
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it("generates 12 periods anchored on the fiscal start month (March)", async () => {
    const { client, inserts } = makeInsertRecordingClient([
      { data: { startMonth: "March" } },
      { data: [] }, // none exist yet
      { data: [{ id: "x" }] } // insert result
    ]);
    await createFiscalYearPeriods(client, {
      companyId: "C1",
      fiscalYear: 2027,
      userId: "U1"
    });
    const rows = inserts[0] as {
      periodNumber: number;
      startDate: string;
      fiscalYear: number;
    }[];
    expect(rows).toHaveLength(12);
    // FY2027 with a March start spans Mar 2026 .. Feb 2027.
    expect(rows[0]).toMatchObject({
      periodNumber: 1,
      startDate: "2026-03-01",
      fiscalYear: 2027
    });
    expect(rows[11]).toMatchObject({
      periodNumber: 12,
      startDate: "2027-02-01",
      fiscalYear: 2027
    });
  });
});
