import {
  getDayOfWeek,
  parseAbsolute,
  parseDate
} from "@internationalized/date";
import { it } from "vitest";
import { expandCalendar } from "./calendar-utils.ts";
import { DependencyGraphImpl } from "./dependency-manager.ts";
import { calendarAdapters, computeNeedByDates } from "./need-by-calculator.ts";
import { assert, assertEquals } from "./test-helpers.ts";
import type { ScheduledOperation } from "./types.ts";

// ---------------------------------------------------------------------------
// Fixtures — plain objects, no DB. January 2026: the 5th is a Monday, so
// 10/11 and 17/18 are weekends; the 16th is a Friday, the 19th a Monday.
// ---------------------------------------------------------------------------

function makeOp(
  overrides: Partial<ScheduledOperation> & { id: string }
): ScheduledOperation {
  return {
    jobId: "job-1",
    processId: null,
    startDate: null,
    dueDate: null,
    priority: 1,
    durationHours: 8,
    durationDays: 1,
    hasConflict: false,
    conflictReason: null,
    ...overrides
  };
}

/** edges: [operationId, dependsOnId] — operationId depends on dependsOnId. */
function makeGraph(
  operations: ScheduledOperation[],
  edges: [string, string][]
): DependencyGraphImpl {
  return new DependencyGraphImpl(
    // the graph only reads ids — strip the ScheduledOperation-only fields
    operations.map((op) => ({
      id: op.id,
      jobId: op.jobId,
      processId: op.processId
    })),
    edges.map(([operationId, dependsOnId]) => ({
      operationId,
      dependsOnId,
      jobId: "job-1"
    }))
  );
}

const isWeekday = (isoDate: string): boolean => {
  const weekday = getDayOfWeek(parseDate(isoDate), "en-US");
  return weekday !== 0 && weekday !== 6;
};
const monFri = (_workCenterId: string | null, isoDate: string) =>
  isWeekday(isoDate);
const eightHourDays = (_workCenterId: string | null) => 8;

function needBy(
  operations: ScheduledOperation[],
  edges: [string, string][],
  jobDueDate: string | null,
  overrides?: {
    calendarHoursPerDay?: (workCenterId: string | null) => number;
    workingDayTest?: (workCenterId: string | null, isoDate: string) => boolean;
  }
): Map<string, string | null> {
  return computeNeedByDates({
    operations,
    graph: makeGraph(operations, edges),
    jobDueDate,
    calendarHoursPerDay: overrides?.calendarHoursPerDay ?? eightHourDays,
    workingDayTest: overrides?.workingDayTest ?? monFri
  });
}

// ---------------------------------------------------------------------------
// The backward walk (port of main's BackwardSchedulingStrategy cases)
// ---------------------------------------------------------------------------

it("null jobDueDate: every operation maps to null (nothing is due)", () => {
  const ops = [
    makeOp({ id: "op1" }),
    makeOp({ id: "op2" }),
    makeOp({ id: "op3" })
  ];
  const result = needBy(
    ops,
    [
      ["op2", "op1"],
      ["op3", "op2"]
    ],
    null
  );

  assertEquals(result.size, 3);
  assertEquals(result.get("op1"), null);
  assertEquals(result.get("op2"), null);
  assertEquals(result.get("op3"), null);
});

it("leaf anchor: serial 3-op chain due Friday gets Wed/Thu/Fri need-bys", () => {
  // Spec acceptance case: 1-day ops, zero lead times, due Friday 2026-01-16.
  const ops = [
    makeOp({ id: "op1", order: 1 }),
    makeOp({ id: "op2", order: 2 }),
    makeOp({ id: "op3", order: 3 })
  ];
  const result = needBy(
    ops,
    [
      ["op2", "op1"],
      ["op3", "op2"]
    ],
    "2026-01-16"
  );

  assertEquals(result.get("op3"), "2026-01-16"); // leaf = job due date
  assertEquals(result.get("op2"), "2026-01-15"); // op3's need-by start
  assertEquals(result.get("op1"), "2026-01-14");
});

it("min-dependent constraint: a feeder with two consumers takes the earliest", () => {
  // A feeds B (1 day) and C (3 days): C needs A done by Tue, B only by Thu.
  const ops = [
    makeOp({ id: "a", order: 1 }),
    makeOp({ id: "b", order: 2, durationHours: 8 }),
    makeOp({ id: "c", order: 3, durationHours: 24 })
  ];
  const result = needBy(
    ops,
    [
      ["b", "a"],
      ["c", "a"]
    ],
    "2026-01-16"
  );

  assertEquals(result.get("b"), "2026-01-16"); // start 2026-01-15
  assertEquals(result.get("c"), "2026-01-16"); // start 2026-01-13 (3 working days)
  assertEquals(result.get("a"), "2026-01-13"); // min(01-15, 01-13)
});

it("operationLeadTime on the consumer pulls feeders earlier, in working days", () => {
  // B needs its inputs 2 working days before it starts (2026-01-15) -> A due 01-13.
  const ops = [
    makeOp({ id: "a", order: 1 }),
    makeOp({ id: "b", order: 2, operationLeadTime: 2 })
  ];
  const result = needBy(ops, [["b", "a"]], "2026-01-16");
  assertEquals(result.get("b"), "2026-01-16");
  assertEquals(result.get("a"), "2026-01-13");

  // Working days, not calendar days: from a Monday start (2026-01-12) the
  // 2-day gap crosses the weekend and lands Thursday 2026-01-08.
  const weekendCrossing = needBy(ops, [["b", "a"]], "2026-01-13");
  assertEquals(weekendCrossing.get("b"), "2026-01-13"); // start Monday 01-12
  assertEquals(weekendCrossing.get("a"), "2026-01-08");
});

it("assemblyLeadTime applies only when the edge crosses make methods", () => {
  // Subassembly op feeding the parent method: pulled back 3 working days.
  const crossing = needBy(
    [
      makeOp({
        id: "sub",
        order: 1,
        jobMakeMethodId: "mm-sub",
        assemblyLeadTime: 3
      }),
      makeOp({ id: "root", order: 1, jobMakeMethodId: "mm-root" })
    ],
    [["root", "sub"]],
    "2026-01-16"
  );
  assertEquals(crossing.get("root"), "2026-01-16"); // start 2026-01-15
  assertEquals(crossing.get("sub"), "2026-01-12"); // 01-15 minus 3 working days

  // Same make method: the lead time is ignored (not an assembly boundary).
  const sameMethod = needBy(
    [
      makeOp({
        id: "sub",
        order: 1,
        jobMakeMethodId: "mm-root",
        assemblyLeadTime: 3
      }),
      makeOp({ id: "root", order: 2, jobMakeMethodId: "mm-root" })
    ],
    [["root", "sub"]],
    "2026-01-16"
  );
  assertEquals(sameMethod.get("sub"), "2026-01-15");
});

it("With Previous: copies its partner's target dates; upstream chains off the copy", () => {
  // U -> {P, X} -> D where X runs WITH P (sibling graph: X shares P's edges,
  // exactly what buildOperationDependencies produces). X is 3 days long on its
  // own — the copy pins it to P's dates anyway.
  const ops = [
    makeOp({ id: "u", order: 10 }),
    makeOp({ id: "p", order: 20 }),
    makeOp({
      id: "x",
      order: 30,
      operationOrder: "With Previous",
      durationHours: 24
    }),
    makeOp({ id: "d", order: 40 })
  ];
  const result = needBy(
    ops,
    [
      ["p", "u"],
      ["x", "u"],
      ["d", "p"],
      ["d", "x"]
    ],
    "2026-01-16"
  );

  assertEquals(result.get("d"), "2026-01-16"); // leaf; start 2026-01-15
  assertEquals(result.get("p"), "2026-01-15");
  assertEquals(result.get("x"), "2026-01-15"); // copied from P, not 3-day-derived
  // U derives from the COPIED start (2026-01-14). Had X computed its own
  // 3-day start (2026-01-12), U would have been due 01-12.
  assertEquals(result.get("u"), "2026-01-14");
});

it("calendar day lengths: a 16h work center halves the day count of an 8h one", () => {
  const hoursPerDay = (workCenterId: string | null) =>
    workCenterId === "wc-fast" ? 16 : 8;
  // Two independent chains, both leaves due Friday, 32h of work each:
  // 4 days on the 8h center, 2 days on the 16h center.
  const ops = [
    makeOp({ id: "f1", order: 1 }),
    makeOp({ id: "l1", order: 2, workCenterId: "wc-slow", durationHours: 32 }),
    makeOp({ id: "f2", order: 1 }),
    makeOp({ id: "l2", order: 2, workCenterId: "wc-fast", durationHours: 32 })
  ];
  const result = needBy(
    ops,
    [
      ["l1", "f1"],
      ["l2", "f2"]
    ],
    "2026-01-16",
    { calendarHoursPerDay: hoursPerDay }
  );

  assertEquals(result.get("f1"), "2026-01-12"); // l1 start: 4 working days back
  assertEquals(result.get("f2"), "2026-01-14"); // l2 start: 2 working days back
});

it("zero-hour days: a work center closed Fridays lands targets on Thursday", () => {
  const noFridays = (workCenterId: string | null, isoDate: string) => {
    if (!isWeekday(isoDate)) return false;
    const weekday = getDayOfWeek(parseDate(isoDate), "en-US");
    return workCenterId === "wc-nofri" ? weekday !== 5 : true;
  };
  // Leaf on the Friday-closed center due Monday 2026-01-19: its 1-day start
  // walk skips Sun/Sat AND Friday 01-16, landing Thursday 01-15.
  const ops = [
    makeOp({ id: "f", order: 1 }),
    makeOp({ id: "l", order: 2, workCenterId: "wc-nofri" })
  ];
  const result = needBy(ops, [["l", "f"]], "2026-01-19", {
    workingDayTest: noFridays
  });

  assertEquals(result.get("l"), "2026-01-19");
  assertEquals(result.get("f"), "2026-01-15"); // Thursday, not Friday
});

it("manual pin: stored dueDate passes through unchanged and propagates upstream", () => {
  // A -> B -> C, C due Friday 01-16 — but B is pinned a week early (01-09).
  const ops = [
    makeOp({ id: "a", order: 1 }),
    makeOp({
      id: "b",
      order: 2,
      manuallyScheduled: true,
      dueDate: "2026-01-09"
    }),
    makeOp({ id: "c", order: 3 })
  ];
  const result = needBy(
    ops,
    [
      ["b", "a"],
      ["c", "b"]
    ],
    "2026-01-16"
  );

  assertEquals(result.get("c"), "2026-01-16");
  assertEquals(result.get("b"), "2026-01-09"); // the pin, byte-identical
  // A chains off the PIN's start (01-08), not off C's chain (which would
  // have put B due 01-15 and A due 01-14).
  assertEquals(result.get("a"), "2026-01-08");
});

// ---------------------------------------------------------------------------
// calendarAdapters — ladder windows -> hours-per-day + working-day test
// ---------------------------------------------------------------------------

const utc = (iso: string) => parseAbsolute(iso, "UTC").toDate().getTime();
const RANGE_START = utc("2026-01-05T00:00:00Z"); // Monday
const RANGE_END = utc("2026-01-26T00:00:00Z");

const weekdayShifts = (startTime: string, endTime: string, days: number[]) =>
  days.map((dayOfWeek) => ({ dayOfWeek, startTime, endTime }));

it("calendarAdapters: hours per day from window minutes per weekday", () => {
  const windowsByWorkCenter = new Map([
    // Mon-Fri 08:00-16:00 => 8h working days
    [
      "wc8",
      expandCalendar(
        weekdayShifts("08:00", "16:00", [1, 2, 3, 4, 5]),
        RANGE_START,
        RANGE_END
      )
    ],
    // Mon-Fri 06:00-22:00 => 16h working days
    [
      "wc16",
      expandCalendar(
        weekdayShifts("06:00", "22:00", [1, 2, 3, 4, 5]),
        RANGE_START,
        RANGE_END
      )
    ],
    // never open => floored at 1h (div-by-zero guard)
    ["closed", []]
  ]);
  const locationWindows = expandCalendar(
    weekdayShifts("08:00", "16:00", [1, 2, 3, 4, 5]),
    RANGE_START,
    RANGE_END
  );
  const { calendarHoursPerDay } = calendarAdapters(
    windowsByWorkCenter,
    locationWindows,
    "UTC"
  );

  assertEquals(calendarHoursPerDay("wc8"), 8);
  assertEquals(calendarHoursPerDay("wc16"), 16);
  assertEquals(calendarHoursPerDay("closed"), 1);
  assertEquals(calendarHoursPerDay(null), 8); // location fallback
});

it("calendarAdapters: workingDayTest covers open dates, weekends and closed days fail", () => {
  const windowsByWorkCenter = new Map([
    // Mon-Thu only: Fridays are zero-hour days for this center
    [
      "wc-nofri",
      expandCalendar(
        weekdayShifts("08:00", "16:00", [1, 2, 3, 4]),
        RANGE_START,
        RANGE_END
      )
    ]
  ]);
  const locationWindows = expandCalendar(
    weekdayShifts("08:00", "16:00", [1, 2, 3, 4, 5]),
    RANGE_START,
    RANGE_END
  );
  const { calendarHoursPerDay, workingDayTest } = calendarAdapters(
    windowsByWorkCenter,
    locationWindows,
    "UTC"
  );

  assert(workingDayTest("wc-nofri", "2026-01-08")); // Thursday
  assert(!workingDayTest("wc-nofri", "2026-01-09")); // Friday: closed
  assert(!workingDayTest("wc-nofri", "2026-01-10")); // Saturday
  assertEquals(calendarHoursPerDay("wc-nofri"), 8); // Mon-Thu average

  assert(workingDayTest(null, "2026-01-09")); // location works Fridays
  assert(!workingDayTest(null, "2026-01-11")); // Sunday
  // Unknown work center id falls back to the location calendar.
  assert(workingDayTest("unknown-wc", "2026-01-09"));
});

it("integration: adapter-derived calendars drive the Friday-closed walk", () => {
  const windowsByWorkCenter = new Map([
    [
      "wc-nofri",
      expandCalendar(
        weekdayShifts("08:00", "16:00", [1, 2, 3, 4]),
        RANGE_START,
        RANGE_END
      )
    ]
  ]);
  const locationWindows = expandCalendar(
    weekdayShifts("08:00", "16:00", [1, 2, 3, 4, 5]),
    RANGE_START,
    RANGE_END
  );
  const adapters = calendarAdapters(
    windowsByWorkCenter,
    locationWindows,
    "UTC"
  );

  const ops = [
    makeOp({ id: "f", order: 1 }), // null wc -> location calendar
    makeOp({ id: "l", order: 2, workCenterId: "wc-nofri" })
  ];
  const result = needBy(ops, [["l", "f"]], "2026-01-19", adapters);

  assertEquals(result.get("l"), "2026-01-19");
  assertEquals(result.get("f"), "2026-01-15"); // Thursday: 01-16 is closed for wc-nofri
});

it("regression: targets at/before the windows range resolve via the weekly pattern (no year runaway)", () => {
  // Windows only cover [RANGE_START, RANGE_END] — the live regen's shape
  // ([now, horizon]). A due date AT the range start forces the backward walk
  // onto days BEFORE any window exists. The weekly-pattern workingDayTest must
  // keep resolving working days there; the old literal per-date test read
  // every pre-range day as closed and walked targets years into the past.
  const locationWindows = expandCalendar(
    weekdayShifts("08:00", "16:00", [1, 2, 3, 4, 5]),
    RANGE_START,
    RANGE_END
  );
  const adapters = calendarAdapters(new Map(), locationWindows, "UTC");

  const ops = [
    makeOp({ id: "first", order: 1 }),
    makeOp({ id: "last", order: 2 })
  ];
  // Due on the first covered day (Mon 2026-01-05): "last" needs a start on
  // Fri 2026-01-02, so "first" is due Fri 2026-01-02 and starts Thu 01-01 —
  // both BEFORE the windows range, resolvable only via the weekday pattern.
  const result = needBy(ops, [["last", "first"]], "2026-01-05", adapters);

  assertEquals(result.get("last"), "2026-01-05");
  assertEquals(result.get("first"), "2026-01-02"); // prior Friday, not 2025/2024
});
