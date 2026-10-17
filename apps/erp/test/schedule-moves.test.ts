// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// A card dropped on the schedule boards: which moves are refused before
// anything is written, and when the scheduler is told.

vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/env")>()),
  ASSEMBLER_SERVICE_URL: ""
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn() })
}));
vi.mock("@carbon/jobs", () => ({ trigger: vi.fn(), batchTrigger: vi.fn() }));
vi.mock("@carbon/planning", () => ({ runLocationSchedule: vi.fn() }));
vi.mock("../app/modules/production/production.service", () => ({
  notifyScheduleInputsChanged: vi.fn()
}));

import { notifyScheduleInputsChanged } from "../app/modules/production/production.service";
import {
  moveScheduleJob,
  reorderScheduleOperations
} from "../app/modules/production/production.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

type Answer = { data: unknown; error: { message: string } | null };

/** The user client: one answer per table, whatever the query. */
function callerWith(answers: Record<string, Answer>) {
  const writes: string[] = [];
  return {
    writes,
    client: {
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq", "in", "not"]) {
          chain[method] = () => chain;
        }
        chain.update = () => {
          writes.push(table);
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
    expect(notifyScheduleInputsChanged).not.toHaveBeenCalled();
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
    const caller = callerWith({ job: { data: { id: "j1" }, error: null } });
    const result = await move(caller);
    expect(result.error).toBeNull();
    expect(caller.writes).toEqual(["job"]);
    expect(notifyScheduleInputsChanged).toHaveBeenCalledOnce();
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
    expect(notifyScheduleInputsChanged).not.toHaveBeenCalled();
  });

  it("keeps the move when the scheduler cannot be told", async () => {
    vi.mocked(notifyScheduleInputsChanged).mockResolvedValueOnce(false);
    const result = await move(callerWith({ job: { data: { id: "j1" }, error: null } }));
    expect(result.error).toBeNull();
  });
});
