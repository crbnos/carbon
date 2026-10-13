// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { type PlanMachineTimeInput, planMachineTime } from "./engine";

const t = (hhmmss: string) => `2026-10-12T${hhmmss}.000Z`;

const base = (
  overrides: Partial<PlanMachineTimeInput>
): PlanMachineTimeInput => ({
  now: t("12:00:00"),
  minimumStateSeconds: 60,
  mappedAt: t("06:00:00"),
  currentState: "Idle",
  currentStateAt: t("08:00:00"),
  lastManualChangeAt: null,
  loadedJobOperationId: "A",
  loadedAt: t("07:00:00"),
  blockedSince: null,
  openMachineEvent: null,
  openUnattributed: null,
  lastMachineEventEndTime: null,
  changes: [],
  ...overrides
});

describe("planMachineTime", () => {
  it("opens a Machine event on the loaded operation when the machine runs", () => {
    const result = planMachineTime(
      base({ changes: [{ state: "Running", changedAt: t("10:00:00") }] })
    );
    expect(result.writes).toEqual([
      {
        kind: "insertMachineEvent",
        jobOperationId: "A",
        startTime: t("10:00:00"),
        endTime: null
      }
    ]);
    expect(result.currentState).toBe("Running");
    expect(result.currentStateAt).toBe(t("10:00:00"));
    expect(result.appliedThrough).toBe(t("10:00:00"));
  });

  it("inserts a closed event for a run that starts and ends in one sync", () => {
    const result = planMachineTime(
      base({
        changes: [
          { state: "Running", changedAt: t("10:00:00") },
          { state: "Idle", changedAt: t("10:30:00") }
        ]
      })
    );
    expect(result.writes).toEqual([
      {
        kind: "insertMachineEvent",
        jobOperationId: "A",
        startTime: t("10:00:00"),
        endTime: t("10:30:00")
      }
    ]);
  });

  it("closes the open event when the machine goes idle", () => {
    const result = planMachineTime(
      base({
        currentState: "Running",
        currentStateAt: t("10:00:00"),
        openMachineEvent: { id: "pe1", startTime: t("10:00:00") },
        changes: [{ state: "Idle", changedAt: t("10:45:00") }]
      })
    );
    expect(result.writes).toEqual([
      {
        kind: "closeMachineEvent",
        productionEventId: "pe1",
        endTime: t("10:45:00")
      }
    ]);
  });

  it("records unattributed time when nothing is loaded", () => {
    const result = planMachineTime(
      base({
        loadedJobOperationId: null,
        loadedAt: null,
        changes: [{ state: "Running", changedAt: t("10:00:00") }]
      })
    );
    expect(result.writes).toEqual([
      { kind: "insertUnattributed", startTime: t("10:00:00"), endTime: null }
    ]);
  });

  it("records unattributed time while maintenance blocks the work center", () => {
    const result = planMachineTime(
      base({
        blockedSince: t("09:00:00"),
        changes: [{ state: "Running", changedAt: t("10:00:00") }]
      })
    );
    expect(result.writes).toEqual([
      { kind: "insertUnattributed", startTime: t("10:00:00"), endTime: null }
    ]);
  });

  it("stops a running event when maintenance starts and keeps the rest unattributed", () => {
    const result = planMachineTime(
      base({
        currentState: "Running",
        currentStateAt: t("09:00:00"),
        openMachineEvent: { id: "pe1", startTime: t("09:00:00") },
        blockedSince: t("10:30:00")
      })
    );
    expect(result.writes).toEqual([
      {
        kind: "closeMachineEvent",
        productionEventId: "pe1",
        endTime: t("10:30:00")
      },
      { kind: "insertUnattributed", startTime: t("10:30:00"), endTime: null }
    ]);
  });

  it("splits a run that straddles the start of maintenance", () => {
    const result = planMachineTime(
      base({
        blockedSince: t("10:30:00"),
        changes: [
          { state: "Running", changedAt: t("10:00:00") },
          { state: "Idle", changedAt: t("11:00:00") }
        ]
      })
    );
    expect(result.writes).toEqual([
      {
        kind: "insertMachineEvent",
        jobOperationId: "A",
        startTime: t("10:00:00"),
        endTime: t("10:30:00")
      },
      {
        kind: "insertUnattributed",
        startTime: t("10:30:00"),
        endTime: t("11:00:00")
      }
    ]);
  });

  it("does not reopen job time after maintenance closed the event", () => {
    // A Down dispatch ends the work center's events when it is created; the
    // machine still runs, so the time after it is unattributed, not the job's.
    const result = planMachineTime(
      base({
        currentState: "Running",
        currentStateAt: t("09:00:00"),
        lastMachineEventEndTime: t("10:30:00"),
        blockedSince: t("10:30:00")
      })
    );
    expect(result.writes).toEqual([
      { kind: "insertUnattributed", startTime: t("10:30:00"), endTime: null }
    ]);
  });

  it("leaves an event the operator started after maintenance began", () => {
    const result = planMachineTime(
      base({
        currentState: "Running",
        currentStateAt: t("09:00:00"),
        lastManualChangeAt: t("10:45:00"),
        openMachineEvent: { id: "pe2", startTime: t("10:45:00") },
        blockedSince: t("10:30:00")
      })
    );
    expect(result.writes).toEqual([]);
  });

  it("does not charge an operation for a run that started before it was loaded", () => {
    const result = planMachineTime(
      base({
        loadedAt: t("10:05:00"),
        changes: [{ state: "Running", changedAt: t("10:00:00") }]
      })
    );
    expect(result.writes).toEqual([
      { kind: "insertUnattributed", startTime: t("10:00:00"), endTime: null }
    ]);
  });

  it("keeps an operator's Stop: the next run opens a new event on the same operation", () => {
    // The event was open since 10:00; the operator pressed Stop at 10:03,
    // which closed it. The sensor later reports Idle, then Running again.
    const result = planMachineTime(
      base({
        currentState: "Running",
        currentStateAt: t("10:00:00"),
        lastManualChangeAt: t("10:03:00"),
        changes: [
          { state: "Idle", changedAt: t("11:00:00") },
          { state: "Running", changedAt: t("11:05:00") }
        ]
      })
    );
    expect(result.writes).toEqual([
      {
        kind: "insertMachineEvent",
        jobOperationId: "A",
        startTime: t("11:05:00"),
        endTime: null
      }
    ]);
  });

  it("ignores a sensor change older than the operator's press", () => {
    const result = planMachineTime(
      base({
        currentState: "Running",
        currentStateAt: t("09:00:00"),
        lastManualChangeAt: t("10:03:00"),
        changes: [{ state: "Idle", changedAt: t("10:02:00") }]
      })
    );
    expect(result.writes).toEqual([]);
    expect(result.currentState).toBe("Idle");
  });

  it("drops a state shorter than the minimum", () => {
    const result = planMachineTime(
      base({
        changes: [
          { state: "Running", changedAt: t("10:00:00") },
          { state: "Idle", changedAt: t("10:20:00") },
          { state: "Running", changedAt: t("10:20:30") },
          { state: "Idle", changedAt: t("11:00:00") }
        ]
      })
    );
    expect(result.writes).toEqual([
      {
        kind: "insertMachineEvent",
        jobOperationId: "A",
        startTime: t("10:00:00"),
        endTime: t("11:00:00")
      }
    ]);
    expect(result.appliedThrough).toBe(t("11:00:00"));
  });

  it("leaves a change younger than the minimum pending", () => {
    const result = planMachineTime(
      base({
        currentState: "Running",
        currentStateAt: t("10:00:00"),
        openMachineEvent: { id: "pe1", startTime: t("10:00:00") },
        changes: [{ state: "Idle", changedAt: t("11:59:30") }]
      })
    );
    expect(result.writes).toEqual([]);
    expect(result.appliedThrough).toBeNull();
    expect(result.currentState).toBe("Running");
  });

  it("starts a newly mapped device at the mapping, never before it", () => {
    const result = planMachineTime(
      base({
        currentState: null,
        currentStateAt: null,
        mappedAt: t("10:00:00"),
        loadedAt: t("08:00:00"),
        changes: [{ state: "Running", changedAt: t("09:00:00") }]
      })
    );
    expect(result.writes).toEqual([
      {
        kind: "insertMachineEvent",
        jobOperationId: "A",
        startTime: t("10:00:00"),
        endTime: null
      }
    ]);
    expect(result.currentStateAt).toBe(t("10:00:00"));
    expect(result.appliedThrough).toBe(t("09:00:00"));
  });

  it("makes the rest of a run unattributed after its operation is done", () => {
    const result = planMachineTime(
      base({
        currentState: "Running",
        currentStateAt: t("09:00:00"),
        loadedJobOperationId: null,
        loadedAt: null,
        lastMachineEventEndTime: t("10:00:00")
      })
    );
    expect(result.writes).toEqual([
      { kind: "insertUnattributed", startTime: t("10:00:00"), endTime: null }
    ]);
  });

  it("does not reopen time after the operator stopped the run", () => {
    const result = planMachineTime(
      base({
        currentState: "Running",
        currentStateAt: t("09:00:00"),
        lastManualChangeAt: t("10:03:00"),
        lastMachineEventEndTime: t("10:03:00")
      })
    );
    expect(result.writes).toEqual([]);
  });

  it("closes the open event when the machine goes down or offline", () => {
    for (const state of ["Down", "Offline"] as const) {
      const result = planMachineTime(
        base({
          currentState: "Running",
          currentStateAt: t("10:00:00"),
          openMachineEvent: { id: "pe1", startTime: t("10:00:00") },
          changes: [{ state, changedAt: t("10:30:00") }]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "closeMachineEvent",
          productionEventId: "pe1",
          endTime: t("10:30:00")
        }
      ]);
    }
  });

  it("leaves an operator's open Machine event alone when the machine runs", () => {
    const result = planMachineTime(
      base({
        lastManualChangeAt: t("10:00:00"),
        openMachineEvent: { id: "pe-manual", startTime: t("10:00:00") },
        changes: [{ state: "Running", changedAt: t("10:01:00") }]
      })
    );
    expect(result.writes).toEqual([]);
    expect(result.currentState).toBe("Running");
  });

  it("drops a new slot that would close at or before its start", () => {
    const result = planMachineTime(
      base({
        minimumStateSeconds: 0,
        changes: [
          { state: "Running", changedAt: t("10:00:00") },
          { state: "Idle", changedAt: t("10:00:00") }
        ]
      })
    );
    expect(result.writes).toEqual([]);
    expect(result.currentState).toBe("Idle");
  });

  it("closes an existing slot at its start when the end is earlier", () => {
    const result = planMachineTime(
      base({
        currentState: "Running",
        openMachineEvent: { id: "pe1", startTime: t("10:30:00") },
        changes: [{ state: "Idle", changedAt: t("10:20:00") }]
      })
    );
    expect(result.writes).toEqual([
      {
        kind: "closeMachineEvent",
        productionEventId: "pe1",
        endTime: t("10:30:00")
      }
    ]);
  });

  it("treats repeated same-state changes as one run for the debounce", () => {
    const result = planMachineTime(
      base({
        now: t("10:05:00"),
        changes: [
          { state: "Running", changedAt: t("10:00:00") },
          { state: "Running", changedAt: t("10:00:30") },
          { state: "Running", changedAt: t("10:00:50") }
        ]
      })
    );
    expect(result.writes).toEqual([
      {
        kind: "insertMachineEvent",
        jobOperationId: "A",
        startTime: t("10:00:00"),
        endTime: null
      }
    ]);
  });
});
