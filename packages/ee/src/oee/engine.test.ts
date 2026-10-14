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
  loads: [
    { jobOperationId: "A", from: t("07:00:00"), to: null, assignable: true }
  ],
  firstUnplannedPressAt: null,
  blocks: [],
  openMachineEvent: null,
  openUnattributed: null,
  lastMachineEventEndTime: null,
  recordedIntervals: [],
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
        openMachineEvent: {
          id: "pe1",
          jobOperationId: "A",
          startTime: t("10:00:00"),
          system: true
        },
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
        loads: [],
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
        blocks: [{ from: t("09:00:00"), to: null }],
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
        openMachineEvent: {
          id: "pe1",
          jobOperationId: "A",
          startTime: t("09:00:00"),
          system: true
        },
        blocks: [{ from: t("10:30:00"), to: null }]
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
        blocks: [{ from: t("10:30:00"), to: null }],
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
        blocks: [{ from: t("10:30:00"), to: null }]
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
        openMachineEvent: {
          id: "pe2",
          jobOperationId: "A",
          startTime: t("10:45:00"),
          system: false
        },
        blocks: [{ from: t("10:30:00"), to: null }]
      })
    );
    expect(result.writes).toEqual([]);
  });

  it("queues a run until an operation loads, then charges the operation", () => {
    const result = planMachineTime(
      base({
        loads: [
          {
            jobOperationId: "A",
            from: t("10:05:00"),
            to: null,
            assignable: true
          }
        ],
        changes: [{ state: "Running", changedAt: t("10:00:00") }]
      })
    );
    expect(result.writes).toEqual([
      {
        kind: "insertUnattributed",
        startTime: t("10:00:00"),
        endTime: t("10:05:00")
      },
      {
        kind: "insertMachineEvent",
        jobOperationId: "A",
        startTime: t("10:05:00"),
        endTime: null
      }
    ]);
  });

  it("after an operator's Stop on a running machine, queues the time until it stops; the next run goes to the operation", () => {
    // The event was open since 10:00; the operator pressed Stop at 10:03,
    // which closed it. The machine ran on until 11:00, then started again.
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
        kind: "insertUnattributed",
        startTime: t("10:03:00"),
        endTime: t("11:00:00")
      },
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

  describe("a run reported only after the operator's press", () => {
    // The machine started at 10:00. The operator pressed Start at 10:03,
    // which opened the operator's event; the provider reported 10:00 later.
    // Nothing was loaded before the press.
    const pressed = {
      lastManualChangeAt: t("10:03:00"),
      loads: [],
      recordedIntervals: [
        {
          id: "r1",
          kind: "event" as const,
          startTime: t("10:03:00"),
          endTime: null
        }
      ]
    };

    it("records the time before the press as unattributed when nothing was loaded", () => {
      const result = planMachineTime(
        base({
          ...pressed,
          changes: [{ state: "Running", changedAt: t("10:00:00") }]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "insertUnattributed",
          startTime: t("10:00:00"),
          endTime: t("10:03:00")
        }
      ]);
      expect(result.currentState).toBe("Running");
    });

    it("records nothing that an event already holds", () => {
      const result = planMachineTime(
        base({
          lastManualChangeAt: t("10:03:00"),
          loads: [],
          recordedIntervals: [
            {
              id: "r2",
              kind: "event" as const,
              startTime: t("09:30:00"),
              endTime: t("10:03:00")
            }
          ],
          // The machine stops 30 seconds after the press: no time after it.
          changes: [
            { state: "Running", changedAt: t("10:00:00") },
            { state: "Idle", changedAt: t("10:03:30") }
          ]
        })
      );
      expect(result.writes).toEqual([]);
    });

    it("records only the part no event holds", () => {
      const result = planMachineTime(
        base({
          lastManualChangeAt: t("10:05:00"),
          loads: [],
          recordedIntervals: [
            {
              id: "r3",
              kind: "event" as const,
              startTime: t("10:02:00"),
              endTime: t("10:05:00")
            },
            {
              id: "r4",
              kind: "event" as const,
              startTime: t("10:05:00"),
              endTime: null
            }
          ],
          changes: [{ state: "Running", changedAt: t("10:00:00") }]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "insertUnattributed",
          startTime: t("10:00:00"),
          endTime: t("10:02:00")
        }
      ]);
    });

    it("ends the time where the machine stopped before the press", () => {
      const result = planMachineTime(
        base({
          ...pressed,
          changes: [
            { state: "Running", changedAt: t("09:58:00") },
            { state: "Idle", changedAt: t("10:01:00") }
          ]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "insertUnattributed",
          startTime: t("09:58:00"),
          endTime: t("10:01:00")
        }
      ]);
    });

    it("ends the time at the press when a later change follows", () => {
      const result = planMachineTime(
        base({
          ...pressed,
          changes: [
            { state: "Running", changedAt: t("10:00:00") },
            { state: "Idle", changedAt: t("10:30:00") }
          ]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "insertUnattributed",
          startTime: t("10:00:00"),
          endTime: t("10:03:00")
        }
      ]);
    });

    it("drops time shorter than the minimum", () => {
      const result = planMachineTime(
        base({
          ...pressed,
          changes: [{ state: "Running", changedAt: t("10:02:30") }]
        })
      );
      expect(result.writes).toEqual([]);
    });

    it("ends the time at a stop still pending before the press", () => {
      const result = planMachineTime(
        base({
          now: t("10:03:00"),
          lastManualChangeAt: t("10:02:45"),
          loads: [],
          recordedIntervals: [
            {
              id: "r5",
              kind: "event" as const,
              startTime: t("10:02:45"),
              endTime: null
            }
          ],
          changes: [
            { state: "Running", changedAt: t("10:00:00") },
            { state: "Idle", changedAt: t("10:02:30") }
          ]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "insertUnattributed",
          startTime: t("10:00:00"),
          endTime: t("10:02:30")
        }
      ]);
    });
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
        openMachineEvent: {
          id: "pe1",
          jobOperationId: "A",
          startTime: t("10:00:00"),
          system: true
        },
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
        loads: [
          {
            jobOperationId: "A",
            from: t("08:00:00"),
            to: null,
            assignable: true
          }
        ],
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
        loads: [],
        lastMachineEventEndTime: t("10:00:00")
      })
    );
    expect(result.writes).toEqual([
      { kind: "insertUnattributed", startTime: t("10:00:00"), endTime: null }
    ]);
  });

  it("queues the time a machine keeps running after the operator stopped the run", () => {
    const result = planMachineTime(
      base({
        currentState: "Running",
        currentStateAt: t("09:00:00"),
        lastManualChangeAt: t("10:03:00"),
        lastMachineEventEndTime: t("10:03:00"),
        recordedIntervals: [
          {
            id: "r6",
            kind: "event" as const,
            startTime: t("09:00:00"),
            endTime: t("10:03:00")
          }
        ]
      })
    );
    expect(result.writes).toEqual([
      { kind: "insertUnattributed", startTime: t("10:03:00"), endTime: null }
    ]);
  });

  describe("the same facts in either order of arrival", () => {
    // The machine starts at 10:00 while X is loaded. The operator presses
    // Start on Y at 10:03, which loads Y.
    const loads = [
      {
        jobOperationId: "X",
        from: t("09:00:00"),
        to: t("10:03:00"),
        assignable: true
      },
      { jobOperationId: "Y", from: t("10:03:00"), to: null, assignable: true }
    ];

    it("gives a start reported before the press to the operation loaded then", () => {
      const result = planMachineTime(
        base({
          loads: [loads[0]!].map((load) => ({ ...load, to: null })),
          changes: [{ state: "Running", changedAt: t("10:00:00") }]
        })
      );
      // The press then ends this event at 10:03.
      expect(result.writes).toEqual([
        {
          kind: "insertMachineEvent",
          jobOperationId: "X",
          startTime: t("10:00:00"),
          endTime: null
        }
      ]);
    });

    it("gives a start reported after the press to the operation loaded then", () => {
      const result = planMachineTime(
        base({
          lastManualChangeAt: t("10:03:00"),
          loads,
          recordedIntervals: [
            {
              id: "r7",
              kind: "event" as const,
              startTime: t("10:03:00"),
              endTime: null
            }
          ],
          changes: [{ state: "Running", changedAt: t("10:00:00") }]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "insertMachineEvent",
          jobOperationId: "X",
          startTime: t("10:00:00"),
          endTime: t("10:03:00")
        }
      ]);
    });

    it("queues the part of a late run after its load ended", () => {
      const result = planMachineTime(
        base({
          lastManualChangeAt: t("10:03:00"),
          loads: [{ ...loads[0]!, to: t("10:01:30") }],
          recordedIntervals: [
            {
              id: "r8",
              kind: "event" as const,
              startTime: t("10:03:00"),
              endTime: null
            }
          ],
          changes: [{ state: "Running", changedAt: t("10:00:00") }]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "insertMachineEvent",
          jobOperationId: "X",
          startTime: t("10:00:00"),
          endTime: t("10:01:30")
        },
        {
          kind: "insertUnattributed",
          startTime: t("10:01:30"),
          endTime: t("10:03:00")
        }
      ]);
    });

    it("queues a late run whose operation can no longer take time", () => {
      const result = planMachineTime(
        base({
          lastManualChangeAt: t("10:03:00"),
          loads: [{ ...loads[0]!, assignable: false }],
          recordedIntervals: [
            {
              id: "r9",
              kind: "event" as const,
              startTime: t("10:03:00"),
              endTime: null
            }
          ],
          changes: [{ state: "Running", changedAt: t("10:00:00") }]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "insertUnattributed",
          startTime: t("10:00:00"),
          endTime: t("10:03:00")
        }
      ]);
    });

    // The operator's event ran 10:10-10:20 and a Pause ended it; the machine
    // ran on until 10:30.
    const paused = {
      currentState: "Running" as const,
      currentStateAt: t("10:00:00"),
      lastManualChangeAt: t("10:20:00")
    };

    it("after a Pause, a sync while the machine still runs opens the time, and the stop closes it", () => {
      const running = planMachineTime(
        base({
          ...paused,
          now: t("10:21:30"),
          recordedIntervals: [
            {
              id: "r10",
              kind: "event" as const,
              startTime: t("10:10:00"),
              endTime: t("10:20:00")
            }
          ]
        })
      );
      expect(running.writes).toEqual([
        { kind: "insertUnattributed", startTime: t("10:20:00"), endTime: null }
      ]);

      const stopped = planMachineTime(
        base({
          ...paused,
          openUnattributed: { id: "u1", startTime: t("10:20:00") },
          recordedIntervals: [
            {
              id: "r11",
              kind: "event" as const,
              startTime: t("10:10:00"),
              endTime: t("10:20:00")
            },
            {
              id: "u1",
              kind: "unattributed" as const,
              startTime: t("10:20:00"),
              endTime: null
            }
          ],
          changes: [{ state: "Idle", changedAt: t("10:30:00") }]
        })
      );
      expect(stopped.writes).toEqual([
        {
          kind: "closeUnattributed",
          unattributedId: "u1",
          endTime: t("10:30:00")
        }
      ]);
    });

    it("after a Pause, a stop reported with no sync between records the same time", () => {
      const result = planMachineTime(
        base({
          ...paused,
          recordedIntervals: [
            {
              id: "r13",
              kind: "event" as const,
              startTime: t("10:10:00"),
              endTime: t("10:20:00")
            }
          ],
          changes: [{ state: "Idle", changedAt: t("10:30:00") }]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "insertUnattributed",
          startTime: t("10:20:00"),
          endTime: t("10:30:00")
        }
      ]);
    });

    it("records nothing when the machine stops soon after a Pause", () => {
      const waiting = planMachineTime(base({ ...paused, now: t("10:20:30") }));
      expect(waiting.writes).toEqual([]);

      const stopped = planMachineTime(
        base({
          ...paused,
          changes: [{ state: "Idle", changedAt: t("10:20:40") }]
        })
      );
      expect(stopped.writes).toEqual([]);
    });
  });

  it("closes the open event when the machine goes down or offline", () => {
    for (const state of ["Down", "Offline"] as const) {
      const result = planMachineTime(
        base({
          currentState: "Running",
          currentStateAt: t("10:00:00"),
          openMachineEvent: {
            id: "pe1",
            jobOperationId: "A",
            startTime: t("10:00:00"),
            system: true
          },
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
        openMachineEvent: {
          id: "pe-manual",
          jobOperationId: "A",
          startTime: t("10:00:00"),
          system: false
        },
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
        openMachineEvent: {
          id: "pe1",
          jobOperationId: "A",
          startTime: t("10:30:00"),
          system: true
        },
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

  describe("two presses and late stops, in any order", () => {
    // The machine runs from 09:00. The operator's Machine time ran 09:30 to
    // 10:00 (Pause), and again from 10:10 (Start).
    const running = {
      currentState: "Running" as const,
      currentStateAt: t("09:00:00"),
      loads: []
    };

    it("records the time between a Pause and a Start with no sync between", () => {
      const result = planMachineTime(
        base({
          ...running,
          now: t("10:15:00"),
          firstUnplannedPressAt: t("10:00:00"),
          lastManualChangeAt: t("10:10:00"),
          openMachineEvent: {
            id: "op2",
            jobOperationId: "A",
            startTime: t("10:10:00"),
            system: false
          },
          recordedIntervals: [
            {
              id: "op1",
              kind: "event" as const,
              startTime: t("09:30:00"),
              endTime: t("10:00:00")
            },
            {
              id: "op2",
              kind: "event" as const,
              startTime: t("10:10:00"),
              endTime: null
            }
          ]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "insertUnattributed",
          startTime: t("10:00:00"),
          endTime: t("10:10:00")
        }
      ]);
    });

    it("records the same time when a sync ran between the presses", () => {
      const between = planMachineTime(
        base({
          ...running,
          now: t("10:05:00"),
          firstUnplannedPressAt: t("10:00:00"),
          lastManualChangeAt: t("10:00:00"),
          recordedIntervals: [
            {
              id: "op1",
              kind: "event" as const,
              startTime: t("09:30:00"),
              endTime: t("10:00:00")
            }
          ]
        })
      );
      expect(between.writes).toEqual([
        { kind: "insertUnattributed", startTime: t("10:00:00"), endTime: null }
      ]);

      // The Start at 10:10 closed that row; the next sync adds nothing.
      const after = planMachineTime(
        base({
          ...running,
          now: t("10:15:00"),
          firstUnplannedPressAt: t("10:10:00"),
          lastManualChangeAt: t("10:10:00"),
          openMachineEvent: {
            id: "op2",
            jobOperationId: "A",
            startTime: t("10:10:00"),
            system: false
          },
          recordedIntervals: [
            {
              id: "op1",
              kind: "event" as const,
              startTime: t("09:30:00"),
              endTime: t("10:00:00")
            },
            {
              id: "u1",
              kind: "unattributed" as const,
              startTime: t("10:00:00"),
              endTime: t("10:10:00")
            },
            {
              id: "op2",
              kind: "event" as const,
              startTime: t("10:10:00"),
              endTime: null
            }
          ]
        })
      );
      expect(after.writes).toEqual([]);
    });

    it("trims a queue row to the running time when a stop is reported late", () => {
      // A queue row ran from the Pause at 10:00 until a Start closed it at
      // 10:20, but the machine had stopped at 10:10.
      const result = planMachineTime(
        base({
          ...running,
          lastManualChangeAt: t("10:20:00"),
          firstUnplannedPressAt: t("10:20:00"),
          recordedIntervals: [
            {
              id: "u1",
              kind: "unattributed" as const,
              startTime: t("10:00:00"),
              endTime: t("10:20:00")
            },
            {
              id: "op2",
              kind: "event" as const,
              startTime: t("10:20:00"),
              endTime: null
            }
          ],
          changes: [{ state: "Idle", changedAt: t("10:10:00") }]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "updateUnattributed",
          unattributedId: "u1",
          startTime: t("10:00:00"),
          endTime: t("10:10:00")
        }
      ]);
    });

    it("splits a queue row around an idle stretch reported late", () => {
      const result = planMachineTime(
        base({
          ...running,
          lastManualChangeAt: t("10:20:00"),
          firstUnplannedPressAt: t("10:20:00"),
          recordedIntervals: [
            {
              id: "u1",
              kind: "unattributed" as const,
              startTime: t("10:00:00"),
              endTime: t("10:20:00")
            },
            {
              id: "op2",
              kind: "event" as const,
              startTime: t("10:20:00"),
              endTime: null
            }
          ],
          changes: [
            { state: "Idle", changedAt: t("10:10:00") },
            { state: "Running", changedAt: t("10:14:00") }
          ]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "updateUnattributed",
          unattributedId: "u1",
          startTime: t("10:00:00"),
          endTime: t("10:10:00")
        },
        {
          kind: "insertUnattributed",
          startTime: t("10:14:00"),
          endTime: t("10:20:00")
        }
      ]);
    });
  });

  describe("an open slot follows its owner", () => {
    const running = {
      currentState: "Running" as const,
      currentStateAt: t("10:00:00")
    };

    it("hands the time back to the operation when maintenance ends", () => {
      const result = planMachineTime(
        base({
          ...running,
          blocks: [{ from: t("10:30:00"), to: t("11:00:00") }],
          openUnattributed: { id: "u1", startTime: t("10:30:00") },
          recordedIntervals: [
            {
              id: "u1",
              kind: "unattributed" as const,
              startTime: t("10:30:00"),
              endTime: null
            }
          ]
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "closeUnattributed",
          unattributedId: "u1",
          endTime: t("11:00:00")
        },
        {
          kind: "insertMachineEvent",
          jobOperationId: "A",
          startTime: t("11:00:00"),
          endTime: null
        }
      ]);
    });

    it("queues the rest of a run after its operation is unloaded", () => {
      const result = planMachineTime(
        base({
          ...running,
          loads: [
            {
              jobOperationId: "A",
              from: t("07:00:00"),
              to: t("11:00:00"),
              assignable: false
            }
          ],
          openMachineEvent: {
            id: "pe1",
            jobOperationId: "A",
            startTime: t("10:00:00"),
            system: true
          }
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "closeMachineEvent",
          productionEventId: "pe1",
          endTime: t("11:00:00")
        },
        { kind: "insertUnattributed", startTime: t("11:00:00"), endTime: null }
      ]);
    });

    it("moves the sensor's time to the operation loaded next", () => {
      const result = planMachineTime(
        base({
          ...running,
          loads: [
            {
              jobOperationId: "A",
              from: t("07:00:00"),
              to: t("11:00:00"),
              assignable: true
            },
            {
              jobOperationId: "B",
              from: t("11:00:00"),
              to: null,
              assignable: true
            }
          ],
          openMachineEvent: {
            id: "pe1",
            jobOperationId: "A",
            startTime: t("10:00:00"),
            system: true
          }
        })
      );
      expect(result.writes).toEqual([
        {
          kind: "closeMachineEvent",
          productionEventId: "pe1",
          endTime: t("11:00:00")
        },
        {
          kind: "insertMachineEvent",
          jobOperationId: "B",
          startTime: t("11:00:00"),
          endTime: null
        }
      ]);
    });

    it("leaves an operator's event on its operation when another loads", () => {
      const result = planMachineTime(
        base({
          ...running,
          loads: [
            {
              jobOperationId: "A",
              from: t("07:00:00"),
              to: t("11:00:00"),
              assignable: true
            },
            {
              jobOperationId: "B",
              from: t("11:00:00"),
              to: null,
              assignable: true
            }
          ],
          openMachineEvent: {
            id: "op1",
            jobOperationId: "A",
            startTime: t("10:00:00"),
            system: false
          }
        })
      );
      expect(result.writes).toEqual([]);
    });
  });
});
