import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { expandCalendar } from "./calendar-utils.ts";
import {
  type AllocationResult,
  allocateOperation,
  isConflict,
  type OperatorPool,
  type ResourceCapacityData,
} from "./slot-allocator.ts";

const utc = (iso: string) => new Date(iso);

// 2026-01-05 is a Monday
const RANGE_START = utc("2026-01-05T00:00:00Z");
const HORIZON = utc("2026-01-19T00:00:00Z");

// Mon-Fri 08:00-16:00 UTC — a pool member's shift pattern
const weekdayShifts = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: "08:00",
  endTime: "16:00",
}));
const weekdayWindows = expandCalendar(weekdayShifts, RANGE_START, HORIZON);
const alwaysOpen = [{ start: RANGE_START, end: HORIZON }];

function makeCapacity(
  reservations: { startAt: Date; endAt: Date }[] = []
): ResourceCapacityData {
  return {
    workCenter: { id: "wc1" },
    windows: alwaysOpen,
    reservations,
  };
}

function makePool(
  members: OperatorPool["members"],
  reservations: OperatorPool["reservations"] = []
): OperatorPool {
  return {
    abilityId: "ab1",
    abilityName: "Welding",
    members,
    reservations,
  };
}

function expectSlot(r: AllocationResult): { start: Date; end: Date } {
  assert(!isConflict(r), `expected slot, got conflict: ${JSON.stringify(r)}`);
  return r;
}

Deno.test("fills a work center sequentially — one operation at a time", () => {
  const capacity = makeCapacity();
  const placed: { start: Date; end: Date }[] = [];

  for (let i = 0; i < 3; i++) {
    const slot = expectSlot(
      allocateOperation({
        durationHours: 4,
        earliestStart: utc("2026-01-05T08:00:00Z"),
        horizonEnd: HORIZON,
        capacity,
      })
    );
    placed.push(slot);
    capacity.reservations.push({ startAt: slot.start, endAt: slot.end });
  }

  // 24/7 continuum: back-to-back with no overlap and no gaps
  assertEquals(placed[0].start.toISOString(), "2026-01-05T08:00:00.000Z");
  assertEquals(placed[0].end.toISOString(), "2026-01-05T12:00:00.000Z");
  assertEquals(placed[1].start.toISOString(), "2026-01-05T12:00:00.000Z");
  assertEquals(placed[1].end.toISOString(), "2026-01-05T16:00:00.000Z");
  assertEquals(placed[2].start.toISOString(), "2026-01-05T16:00:00.000Z");
});

Deno.test("an existing reservation pushes the operation to its end", () => {
  const capacity = makeCapacity([
    {
      startAt: utc("2026-01-05T06:00:00Z"),
      endAt: utc("2026-01-05T18:00:00Z"),
    },
  ]);

  const slot = expectSlot(
    allocateOperation({
      durationHours: 2,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity,
    })
  );

  assertEquals(slot.start.toISOString(), "2026-01-05T18:00:00.000Z");
});

Deno.test("conflict when the horizon is exhausted", () => {
  const result = allocateOperation({
    durationHours: 24 * 30, // longer than the two-week horizon
    earliestStart: utc("2026-01-05T08:00:00Z"),
    horizonEnd: HORIZON,
    capacity: makeCapacity(),
  });

  assert(isConflict(result));
});

Deno.test("gated operation waits for the member's shift and pauses off-shift", () => {
  // Qualified welder works Mon-Fri 08:00-16:00; op needs 10h starting Saturday
  const pool = makePool([{ employeeId: "emp1", windows: weekdayWindows }]);

  const slot = expectSlot(
    allocateOperation({
      durationHours: 10,
      earliestStart: utc("2026-01-10T00:00:00Z"), // Saturday
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      operatorPool: pool,
    })
  );

  // Starts Monday 08:00, 8h Monday + 2h Tuesday
  assertEquals(slot.start.toISOString(), "2026-01-12T08:00:00.000Z");
  assertEquals(slot.end.toISOString(), "2026-01-13T10:00:00.000Z");
});

Deno.test("gated operation with a shiftless member runs around the clock", () => {
  const pool = makePool([{ employeeId: "emp1", windows: alwaysOpen }]);

  const slot = expectSlot(
    allocateOperation({
      durationHours: 10,
      earliestStart: utc("2026-01-10T00:00:00Z"), // Saturday — no shift needed
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      operatorPool: pool,
    })
  );

  assertEquals(slot.start.toISOString(), "2026-01-10T00:00:00.000Z");
  assertEquals(slot.end.toISOString(), "2026-01-10T10:00:00.000Z");
});

Deno.test("zero qualified members is an immediate skill conflict", () => {
  const result = allocateOperation({
    durationHours: 1,
    earliestStart: utc("2026-01-05T08:00:00Z"),
    horizonEnd: HORIZON,
    capacity: makeCapacity(),
    operatorPool: makePool([]),
  });

  assert(isConflict(result));
  assertEquals(result.conflict, "No qualified operator for Welding");
});

Deno.test("a busy pool defers the operation until the reservation ends", () => {
  // One welder, already reserved 08:00-12:00 Monday by another job
  const pool = makePool(
    [{ employeeId: "emp1", windows: weekdayWindows }],
    [
      {
        startAt: utc("2026-01-05T08:00:00Z"),
        endAt: utc("2026-01-05T12:00:00Z"),
      },
    ]
  );

  const slot = expectSlot(
    allocateOperation({
      durationHours: 2,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      operatorPool: pool,
    })
  );

  assertEquals(slot.start.toISOString(), "2026-01-05T12:00:00.000Z");
});

Deno.test("two members on different shifts extend the working windows", () => {
  // Early shift Mon 00:00-08:00, late shift Mon 08:00-16:00 — union covers 00:00-16:00
  const early = expandCalendar(
    [{ dayOfWeek: 1, startTime: "00:00", endTime: "08:00" }],
    RANGE_START,
    HORIZON
  );
  const late = expandCalendar(
    [{ dayOfWeek: 1, startTime: "08:00", endTime: "16:00" }],
    RANGE_START,
    HORIZON
  );
  const pool = makePool([
    { employeeId: "empEarly", windows: early },
    { employeeId: "empLate", windows: late },
  ]);

  const slot = expectSlot(
    allocateOperation({
      durationHours: 12,
      earliestStart: utc("2026-01-05T00:00:00Z"),
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      operatorPool: pool,
    })
  );

  // 12h fits inside Monday 00:00-16:00 because someone is always on shift
  assertEquals(slot.start.toISOString(), "2026-01-05T00:00:00.000Z");
  assertEquals(slot.end.toISOString(), "2026-01-05T12:00:00.000Z");
});

Deno.test("pool concurrency: one member on shift cannot cover two overlapping ops", () => {
  const sharedReservations: { startAt: Date; endAt: Date }[] = [];
  const pool = makePool(
    [{ employeeId: "emp1", windows: weekdayWindows }],
    sharedReservations
  );
  const capacityA = makeCapacity();
  const capacityB = makeCapacity(); // different machine, same welder pool

  const first = expectSlot(
    allocateOperation({
      durationHours: 4,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: capacityA,
      operatorPool: pool,
    })
  );
  sharedReservations.push({ startAt: first.start, endAt: first.end });

  const second = expectSlot(
    allocateOperation({
      durationHours: 4,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: capacityB,
      operatorPool: pool,
    })
  );

  // Second op must wait for the welder even though its machine is free
  assertEquals(second.start.toISOString(), first.end.toISOString());
});
