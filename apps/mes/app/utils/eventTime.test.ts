// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseAbsolute } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { formatClock, getEventTotals, type TimedEvent } from "./eventTime";

const NOW = parseAbsolute("2026-08-04T12:00:00.000Z", "America/Chicago");

const event = (overrides: Partial<TimedEvent>): TimedEvent => ({
  id: "e",
  type: "Labor",
  startTime: "2026-08-04T11:00:00.000Z",
  endTime: null,
  duration: null,
  ...overrides
});

describe("getEventTotals", () => {
  it("keeps paused labor after the timer stops", () => {
    const totals = getEventTotals(
      [
        event({
          id: "a",
          endTime: "2026-08-04T11:40:00.000Z",
          duration: 2400
        })
      ],
      NOW
    );
    expect(totals).toEqual({ setup: 0, labor: 2_400_000, machine: 0 });
  });

  it("adds every operator's running time to the logged time", () => {
    const totals = getEventTotals(
      [
        event({ id: "a", endTime: "2026-08-04T11:40:00.000Z", duration: 2400 }),
        event({ id: "b", startTime: "2026-08-04T11:59:30.000Z" }),
        event({ id: "c", startTime: "2026-08-04T11:59:50.000Z" }),
        event({ id: "d", type: "Setup", startTime: "2026-08-04T11:59:00.000Z" })
      ],
      NOW
    );
    expect(totals).toEqual({ setup: 60_000, labor: 2_440_000, machine: 0 });
  });

  it("counts only the given operator's logged and running time", () => {
    const events = [
      event({ id: "a", employeeId: "me", endTime: "x", duration: 600 }),
      event({
        id: "b",
        employeeId: "me",
        startTime: "2026-08-04T11:59:30.000Z"
      }),
      event({ id: "c", employeeId: "other", endTime: "x", duration: 1200 }),
      event({
        id: "d",
        employeeId: "other",
        startTime: "2026-08-04T11:59:00.000Z"
      })
    ];
    expect(getEventTotals(events, NOW, "me")).toEqual({
      setup: 0,
      labor: 630_000,
      machine: 0
    });
    // Without an operator the team total stays: 600s + 30s + 1200s + 60s.
    expect(getEventTotals(events, NOW).labor).toBe(1_890_000);
  });

  it("counts a start ahead of the clock as zero and skips untyped events", () => {
    const totals = getEventTotals(
      [
        event({ id: "a", startTime: "2026-08-04T12:00:05.000Z" }),
        event({ id: "b", type: null, duration: 60, endTime: "x" })
      ],
      NOW
    );
    expect(totals).toEqual({ setup: 0, labor: 0, machine: 0 });
  });
});

describe("formatClock", () => {
  it("pads hours, minutes and seconds", () => {
    expect(formatClock(0)).toBe("00:00:00");
    expect(formatClock(2_400_999)).toBe("00:40:00");
    expect(formatClock(90_061_000)).toBe("25:01:01");
  });
});
