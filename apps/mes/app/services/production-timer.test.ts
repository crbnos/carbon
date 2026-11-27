// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The shared timer Start and End (`@carbon/lib/production/timer`), which the
// MES buttons and the ERP's API and MCP tools run, over the in-memory client:
// what each refuses before it writes, and whose time a Start records.

import {
  endOperationTimer,
  startOperationTimer,
  type TimerDeps
} from "@carbon/lib/production/timer";
import { describe, expect, it } from "vitest";
import { fakeClient, serialOperation } from "./work-unit-test-fixture";

const op = "op_1";

/** A released job's untracked first operation; `extra` adds or replaces tables. */
function floor({
  jobStatus = "Ready",
  operation = {},
  extra = {}
}: {
  jobStatus?: string;
  operation?: Record<string, unknown>;
  extra?: Record<string, Record<string, unknown>[]>;
} = {}) {
  return fakeClient({
    jobOperation: [
      serialOperation({
        id: op,
        jobMakeMethodId: "jmm",
        later: false,
        serial: false,
        extra: operation
      })
    ],
    job: [{ id: "job", companyId: "co", status: jobStatus }],
    ...extra
  });
}

function depsOf(
  fake: ReturnType<typeof fakeClient>,
  { permitted = true }: { permitted?: boolean } = {}
) {
  const posted: string[][] = [];
  const deps: TimerDeps = {
    client: fake.client,
    serviceRole: fake.client,
    db: () => {
      throw new Error("no machine time here");
    },
    permitted: () => permitted,
    numberUnit: async () => undefined,
    postEnded: async (ids) => {
      posted.push(ids);
    }
  };
  return { deps, posted };
}

const start = (
  fake: ReturnType<typeof fakeClient>,
  employeeId = "operator",
  input: { type?: "Labor" | "Machine"; workCenterId?: string } = {},
  permitted = true
) =>
  startOperationTimer(depsOf(fake, { permitted }).deps, {
    companyId: "co",
    employeeId,
    jobOperationId: op,
    type: input.type ?? "Labor",
    workCenterId: input.workCenterId
  });

/** An operation on `wc_1` whose process `wc_2` also runs. */
const onWorkCenter = () =>
  floor({
    operation: { workCenterId: "wc_1", processId: "proc_1" },
    extra: {
      workCenterProcess: [
        { workCenterId: "wc_2", processId: "proc_1", companyId: "co" }
      ],
      workCenter: [
        { id: "wc_1", companyId: "co" },
        { id: "wc_2", companyId: "co" },
        { id: "wc_other", companyId: "co" }
      ]
    }
  });

const eventWrites = (fake: ReturnType<typeof fakeClient>) =>
  fake.writes().filter((w) => w.table === "productionEvent");

describe("startOperationTimer", () => {
  it("records the time against the employee it is given", async () => {
    const fake = floor();
    const started = await start(fake, "caller");
    expect(started.ok).toBe(true);
    expect(eventWrites(fake)).toEqual([
      expect.objectContaining({
        op: "insert",
        values: expect.objectContaining({
          jobOperationId: op,
          type: "Labor",
          employeeId: "caller",
          createdBy: "caller",
          companyId: "co"
        })
      })
    ]);
  });

  it.each(["Draft", "Planned", "Completed", "Cancelled"])(
    "refuses an operation whose job is %s, before anything is written",
    async (jobStatus) => {
      const fake = floor({ jobStatus });
      const started = await start(fake);
      expect(started).toMatchObject({ ok: false, category: "rule" });
      expect(fake.writes()).toEqual([]);
    }
  );

  it("refuses an operation in a Planned batch even when its job is released", async () => {
    const fake = floor({
      operation: { jobOperationBatchId: "bat_1" },
      extra: {
        jobOperationBatch: [{ id: "bat_1", companyId: "co", status: "Planned" }]
      }
    });
    expect(await start(fake)).toMatchObject({ ok: false, category: "rule" });
    expect(fake.writes()).toEqual([]);
  });

  it("starts an operation in a released batch whose job is still Planned", async () => {
    const fake = floor({
      jobStatus: "Planned",
      operation: { jobOperationBatchId: "bat_1" },
      extra: {
        jobOperationBatch: [{ id: "bat_1", companyId: "co", status: "Active" }]
      }
    });
    expect((await start(fake)).ok).toBe(true);
    expect(eventWrites(fake)).toHaveLength(1);
  });

  it("refuses a work center blocked for maintenance", async () => {
    const fake = floor({
      operation: { workCenterId: "wc_1" },
      extra: {
        workCentersWithBlockingStatus: [
          {
            id: "wc_1",
            companyId: "co",
            isBlocked: true,
            blockingDispatchReadableId: "MD-1"
          }
        ]
      }
    });
    expect(await start(fake)).toMatchObject({ ok: false, category: "rule" });
    expect(fake.writes()).toEqual([]);
  });

  it("refuses a work center that does not run the operation's process", async () => {
    const fake = onWorkCenter();
    expect(
      await start(fake, "operator", { workCenterId: "wc_other" })
    ).toMatchObject({ ok: false, category: "rule" });
    expect(fake.writes()).toEqual([]);
  });

  it("starts on another work center that runs the operation's process", async () => {
    const fake = onWorkCenter();
    expect((await start(fake, "operator", { workCenterId: "wc_2" })).ok).toBe(
      true
    );
    expect(eventWrites(fake)).toEqual([
      expect.objectContaining({
        op: "insert",
        values: expect.objectContaining({ workCenterId: "wc_2" })
      })
    ]);
  });

  it("refuses a Machine press without production.jobs Create, before the press", async () => {
    const fake = onWorkCenter();
    const started = await start(fake, "operator", { type: "Machine" }, false);
    expect(started).toMatchObject({ ok: false, category: "forbidden" });
    expect(fake.writes()).toEqual([]);
  });

  it("refuses Outside Processing", async () => {
    const fake = floor({ operation: { operationType: "Outside Processing" } });
    expect(await start(fake)).toMatchObject({ ok: false, category: "rule" });
    expect(fake.writes()).toEqual([]);
  });

  it("refuses an operation of another company as not found", async () => {
    const fake = floor({ operation: { companyId: "other" } });
    expect(await start(fake)).toMatchObject({
      ok: false,
      category: "notFound"
    });
    expect(fake.writes()).toEqual([]);
  });
});

describe("endOperationTimer", () => {
  const running = (endTime: string | null) =>
    floor({
      extra: {
        productionEvent: [
          {
            id: "ev_1",
            companyId: "co",
            jobOperationId: op,
            type: "Labor",
            workCenterId: null,
            employeeId: "operator",
            endTime
          }
        ]
      }
    });

  it("ends a running timer and posts it", async () => {
    const fake = running(null);
    const { deps, posted } = depsOf(fake);
    const ended = await endOperationTimer(deps, {
      companyId: "co",
      userId: "operator",
      eventId: "ev_1"
    });
    expect(ended).toMatchObject({ ok: true, endedEventIds: ["ev_1"] });
    const update = eventWrites(fake).find((w) => w.op === "update");
    // Only an open event ends: the update carries `endTime IS NULL`.
    expect(update?.filters).toEqual([
      ["id", "ev_1"],
      ["companyId", "co"],
      ["endTime", null]
    ]);
    expect(posted).toEqual([["ev_1"]]);
  });

  it("refuses an event that has already ended, writing nothing", async () => {
    const fake = running("2026-11-26T10:00:00Z");
    const { deps, posted } = depsOf(fake);
    const ended = await endOperationTimer(deps, {
      companyId: "co",
      userId: "operator",
      eventId: "ev_1"
    });
    expect(ended).toMatchObject({ ok: false, category: "conflict" });
    expect(fake.writes()).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("refuses a Machine End without production.jobs Edit, before the press", async () => {
    const fake = floor({
      extra: {
        productionEvent: [
          {
            id: "ev_1",
            companyId: "co",
            jobOperationId: op,
            type: "Machine",
            workCenterId: "wc_1",
            endTime: null
          }
        ]
      }
    });
    const { deps, posted } = depsOf(fake, { permitted: false });
    const ended = await endOperationTimer(deps, {
      companyId: "co",
      userId: "operator",
      eventId: "ev_1"
    });
    expect(ended).toMatchObject({ ok: false, category: "forbidden" });
    expect(fake.writes()).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("ends a timer on a job that is no longer released", async () => {
    const fake = floor({
      jobStatus: "Completed",
      extra: {
        productionEvent: [
          {
            id: "ev_1",
            companyId: "co",
            jobOperationId: op,
            type: "Labor",
            workCenterId: null,
            endTime: null
          }
        ]
      }
    });
    const ended = await endOperationTimer(depsOf(fake).deps, {
      companyId: "co",
      userId: "operator",
      eventId: "ev_1"
    });
    expect(ended.ok).toBe(true);
  });
});
