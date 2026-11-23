// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// A card dropped on the schedule boards: which moves are refused before
// anything is written, and when the scheduler is told.

// The scheduler is told through an event.
const { trigger } = vi.hoisted(() => ({ trigger: vi.fn() }));
vi.mock("@carbon/jobs", () => ({ trigger }));

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from "kysely";
import {
  moveScheduleJob,
  reorderScheduleOperations,
  setJobDeadline
} from "../app/modules/production/production.server";
import {
  deadlineTypeForDueDate,
  nextJobDeadline
} from "../app/modules/production/production.service";
import { createServiceContext } from "@carbon/api/service-fn.server";

type Answer = { data: unknown; error: { message: string } | null };

/** The user client: one answer per table, whatever the query. */
function callerWith(answers: Record<string, Answer>) {
  const writes: string[] = [];
  const updates: unknown[] = [];
  return {
    writes,
    updates,
    client: {
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq", "in", "not"]) {
          chain[method] = () => chain;
        }
        chain.update = (payload: unknown) => {
          writes.push(table);
          updates.push(payload);
          return chain;
        };
        const answer = () => answers[table] ?? { data: null, error: null };
        chain.maybeSingle = async () => answer();
        chain.then = (resolve: (value: Answer) => unknown) =>
          Promise.resolve(answer()).then(resolve);
        return chain;
      }
    }
  };
}

const contextWith = (client: unknown) =>
  createServiceContext({
    actor: {
      type: "user",
      userId: "u1",
      permissions: {
        production: { view: [], create: [], update: ["c1"], delete: [] }
      }
    },
    company: { id: "c1", groupId: "g1" },
    caller: client as never,
    system: () => ({}) as never,
    pg: () => {
      throw new Error("refused moves never open a transaction");
    },
    kv: () => ({}) as never
  });

beforeEach(() => vi.clearAllMocks());

describe("reorderScheduleOperations", () => {
  const board = (overrides: Record<string, Answer> = {}) =>
    callerWith({
      jobOperation: {
        data: [
          {
            id: "op1",
            jobId: "j1",
            processId: "p1",
            status: "Ready",
            workCenterId: "wc1"
          }
        ],
        error: null
      },
      workCenter: {
        data: { id: "wc2", active: true, locationId: "loc1" },
        error: null
      },
      job: {
        data: [{ id: "j1", locationId: "loc1", status: "Ready" }],
        error: null
      },
      workCenterProcess: { data: [{ processId: "p1" }], error: null },
      ...overrides
    });
  const move = (caller: ReturnType<typeof callerWith>) =>
    reorderScheduleOperations(contextWith(caller.client), {
      columnId: "wc2",
      updates: [{ id: "op1", priority: -3.5 }]
    });

  it.each([
    [
      "an inactive work center",
      {
        workCenter: {
          data: { id: "wc2", active: false, locationId: "loc1" },
          error: null
        }
      }
    ],
    [
      "a work center at another location",
      {
        workCenter: {
          data: { id: "wc2", active: true, locationId: "loc2" },
          error: null
        }
      }
    ],
    [
      "a work center of another company",
      { workCenter: { data: null, error: null } }
    ],
    [
      "a finished operation",
      {
        jobOperation: {
          data: [
            {
              id: "op1",
              jobId: "j1",
              processId: "p1",
              status: "Done",
              workCenterId: "wc1"
            }
          ],
          error: null
        }
      }
    ],
    ["a missing operation", { jobOperation: { data: [], error: null } }],
    [
      "a locked job",
      {
        job: {
          data: [{ id: "j1", locationId: "loc1", status: "Completed" }],
          error: null
        }
      }
    ],
    [
      "a process the work center does not run",
      { workCenterProcess: { data: [], error: null } }
    ]
  ])("refuses %s before writing", async (_case, overrides) => {
    const caller = board(overrides);
    const result = await move(caller);
    expect(result.error).toMatchObject({
      category: "rule",
      message: "Invalid scheduling request"
    });
    expect(caller.writes).toEqual([]);
    expect(trigger).not.toHaveBeenCalled();
  });
});

describe("moveScheduleJob", () => {
  const move = (caller: ReturnType<typeof callerWith>, columnId = "2026-10-20") =>
    moveScheduleJob(contextWith(caller.client), {
      id: "j1",
      locationId: "loc1",
      columnId,
      priority: -2
    });

  it("writes the date, then tells the scheduler", async () => {
    const caller = callerWith({ job: { data: { id: "j1", deadlineType: "Soft Deadline" }, error: null } });
    const result = await move(caller);
    expect(result.error).toBeNull();
    expect(caller.writes).toEqual(["job"]);
    expect(trigger.mock.calls.map(([event]) => event)).toEqual([
      "schedule-inputs-changed"
    ]);
  });

  it("refuses a column that is not a date before writing", async () => {
    const caller = callerWith({});
    const result = await move(caller, "not-a-column");
    expect(result.error?.category).toBe("validation");
    expect(caller.writes).toEqual([]);
  });

  it("does not tell the scheduler when no job matched (elsewhere or locked)", async () => {
    const result = await move(callerWith({ job: { data: null, error: null } }));
    expect(result.error).toMatchObject({
      category: "conflict",
      message: "Job unavailable or locked"
    });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("keeps the move when the scheduler cannot be told", async () => {
    trigger.mockRejectedValueOnce(new Error("event bus down"));
    const result = await move(callerWith({ job: { data: { id: "j1", deadlineType: "Soft Deadline" }, error: null } }));
    expect(result.error).toBeNull();
  });
});

describe("deadlineTypeForDueDate", () => {
  it.each([
    ["No Deadline", "2026-10-30", "Soft Deadline"],
    ["Soft Deadline", "2026-10-30", "Soft Deadline"],
    ["Hard Deadline", "2026-10-30", "Hard Deadline"],
    ["ASAP", "2026-10-30", "Soft Deadline"],
    ["Soft Deadline", null, "No Deadline"],
    ["Hard Deadline", null, "No Deadline"],
    ["ASAP", null, "ASAP"],
    ["No Deadline", null, "No Deadline"]
  ] as const)("a %s job given due date %s is %s", (type, dueDate, expected) => {
    expect(deadlineTypeForDueDate(type, dueDate)).toBe(expected);
  });
});

describe("nextJobDeadline", () => {
  const soft = { dueDate: "2026-10-24", deadlineType: "Soft Deadline" } as const;
  const undated = { dueDate: null, deadlineType: "No Deadline" } as const;

  it.each([
    ["ASAP clears the date", soft, { deadlineType: "ASAP" }, null, "ASAP"],
    [
      "No Deadline clears the date",
      soft,
      { deadlineType: "No Deadline" },
      null,
      "No Deadline"
    ],
    [
      "Hard Deadline keeps it",
      soft,
      { deadlineType: "Hard Deadline" },
      "2026-10-24",
      "Hard Deadline"
    ],
    [
      "a date makes a No Deadline job Soft",
      undated,
      { dueDate: "2026-10-30" },
      "2026-10-30",
      "Soft Deadline"
    ],
    [
      "clearing the date makes a Soft job No Deadline",
      soft,
      { dueDate: null },
      null,
      "No Deadline"
    ]
  ] as const)("%s", (_, job, change, dueDate, deadlineType) => {
    expect(nextJobDeadline(job, change)).toEqual({ dueDate, deadlineType });
  });
});

describe("moveScheduleJob keeps the deadline type in step with the date", () => {
  const move = (deadlineType: string, columnId: string) => {
    const caller = callerWith({
      job: { data: { id: "j1", deadlineType }, error: null }
    });
    return moveScheduleJob(contextWith(caller.client), {
      id: "j1",
      locationId: "loc1",
      columnId,
      priority: -2
    }).then((result) => ({ result, caller }));
  };

  // The job form hides the date of a "No Deadline" job.
  it("makes a No Deadline job dropped on a date a Soft Deadline", async () => {
    const { result, caller } = await move("No Deadline", "2026-10-30");
    expect(result.error).toBeNull();
    expect(caller.updates).toEqual([
      expect.objectContaining({
        dueDate: "2026-10-30",
        priority: -2,
        deadlineType: "Soft Deadline"
      })
    ]);
  });

  // A Hard or Soft Deadline requires a date the board just cleared.
  it("makes a Soft Deadline job dropped on an undated column No Deadline", async () => {
    const { caller } = await move("Soft Deadline", "unscheduled");
    expect(caller.updates).toEqual([
      expect.objectContaining({ dueDate: null, deadlineType: "No Deadline" })
    ]);
  });

  // The scheduler ignores an ASAP job's date; MRP would take it as the supply date.
  it("makes an ASAP job dropped on a date a Soft Deadline", async () => {
    const { caller } = await move("ASAP", "2026-10-30");
    expect(caller.updates).toEqual([
      expect.objectContaining({
        dueDate: "2026-10-30",
        deadlineType: "Soft Deadline"
      })
    ]);
  });

  it("leaves an ASAP job dropped on an undated column ASAP", async () => {
    const { caller } = await move("ASAP", "unscheduled");
    expect(caller.updates).toEqual([
      expect.objectContaining({ dueDate: null, deadlineType: "ASAP" })
    ]);
  });
});

describe("setJobDeadline", () => {
  // The writes go over the system connection; a driver that answers no rows
  // is enough, since what is under test is whether the scheduler is told.
  const pg = new Kysely({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
  const setDeadline = (statuses: string[]) => {
    const caller = callerWith({
      job: {
        data: statuses.map((status, index) => ({
          id: `j${index}`,
          status,
          locationId: "loc1",
          dueDate: null,
          deadlineType: "No Deadline"
        })),
        error: null
      }
    });
    return setJobDeadline(
      createServiceContext({
        actor: {
          type: "user",
          userId: "u1",
          permissions: {
            production: { view: [], create: [], update: ["c1"], delete: [] }
          }
        },
        company: { id: "c1", groupId: "g1" },
        caller: caller.client as never,
        system: () => ({}) as never,
        pg: () => pg as never,
        kv: () => ({}) as never
      }),
      { ids: statuses.map((_, index) => `j${index}`), dueDate: "2026-11-02" }
    );
  };
  const scheduleNotices = () =>
    trigger.mock.calls.filter(([event]) => event === "schedule-inputs-changed");

  // Draft and Planned jobs are not on the schedule yet.
  it("does not wake the scheduler for jobs it does not place", async () => {
    const result = await setDeadline(["Draft", "Planned"]);
    expect(result.error).toBeNull();
    expect(scheduleNotices()).toEqual([]);
  });

  it("wakes the scheduler when a released job moves", async () => {
    const result = await setDeadline(["Draft", "Ready"]);
    expect(result.error).toBeNull();
    expect(scheduleNotices()).toHaveLength(1);
  });
});
