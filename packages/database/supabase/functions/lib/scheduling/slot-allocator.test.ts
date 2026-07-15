import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { expandCalendar } from "./calendar-utils.ts";
import {
  type AllocationResult,
  allocateOperation,
  formatBlockingJobs,
  isConflict,
  type OperatorPool,
  type ReservationInterval,
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

Deno.test("work centers never limit concurrency — ungated ops overlap freely", () => {
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

  // Anyone qualified can work at a station: all three place at the earliest
  // start, fully overlapping — only the operator pool ever serializes work
  for (const slot of placed) {
    assertEquals(slot.start.toISOString(), "2026-01-05T08:00:00.000Z");
    assertEquals(slot.end.toISOString(), "2026-01-05T12:00:00.000Z");
  }
});

Deno.test("existing work-center reservations do not delay ungated ops", () => {
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

  // Machine "busy" is not a constraint — the op starts at its earliest start
  assertEquals(slot.start.toISOString(), "2026-01-05T08:00:00.000Z");
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

// --- formatBlockingJobs -----------------------------------------------------

function interval(
  startIso: string,
  endIso: string,
  readableJobId?: string
): ReservationInterval {
  return { startAt: utc(startIso), endAt: utc(endIso), readableJobId };
}

Deno.test("formatBlockingJobs groups by job and counts reservations", () => {
  const reservations = [
    interval("2026-01-05T08:00:00Z", "2026-01-05T10:00:00Z", "J000001"),
    interval("2026-01-05T10:00:00Z", "2026-01-05T12:00:00Z", "J000001"),
    interval("2026-01-05T12:00:00Z", "2026-01-05T14:00:00Z", "J000001"),
    interval("2026-01-05T14:00:00Z", "2026-01-05T16:00:00Z", "J000007"),
  ];

  assertEquals(
    formatBlockingJobs(
      reservations,
      utc("2026-01-05T08:00:00Z"),
      utc("2026-01-05T16:00:00Z")
    ),
    "queued behind J000001 (3 ops), J000007 (1 op)"
  );
});

Deno.test("formatBlockingJobs ignores untagged (own-job) intervals", () => {
  const reservations = [
    interval("2026-01-05T08:00:00Z", "2026-01-05T12:00:00Z"), // own in-run push
    interval("2026-01-05T12:00:00Z", "2026-01-05T14:00:00Z", "J000002"),
  ];

  assertEquals(
    formatBlockingJobs(
      reservations,
      utc("2026-01-05T08:00:00Z"),
      utc("2026-01-05T16:00:00Z")
    ),
    "queued behind J000002 (1 op)"
  );
});

Deno.test("formatBlockingJobs treats touching intervals as non-overlapping", () => {
  const reservations = [
    // ends exactly at region start / starts exactly at region end
    interval("2026-01-05T06:00:00Z", "2026-01-05T08:00:00Z", "J000003"),
    interval("2026-01-05T16:00:00Z", "2026-01-05T18:00:00Z", "J000004"),
  ];

  assertEquals(
    formatBlockingJobs(
      reservations,
      utc("2026-01-05T08:00:00Z"),
      utc("2026-01-05T16:00:00Z")
    ),
    null
  );
});

Deno.test("formatBlockingJobs returns null for an empty region or no blockers", () => {
  const tagged = [
    interval("2026-01-05T08:00:00Z", "2026-01-05T12:00:00Z", "J000005"),
  ];
  // zero-width region (op started exactly when it could have)
  assertEquals(
    formatBlockingJobs(
      tagged,
      utc("2026-01-05T08:00:00Z"),
      utc("2026-01-05T08:00:00Z")
    ),
    null
  );
  assertEquals(
    formatBlockingJobs([], utc("2026-01-05T08:00:00Z"), utc("2026-01-06T00:00:00Z")),
    null
  );
});

Deno.test("formatBlockingJobs ranks by op count then job id, capping at 3", () => {
  const reservations = [
    interval("2026-01-05T08:00:00Z", "2026-01-05T09:00:00Z", "J000004"),
    interval("2026-01-05T09:00:00Z", "2026-01-05T10:00:00Z", "J000002"),
    interval("2026-01-05T10:00:00Z", "2026-01-05T11:00:00Z", "J000002"),
    interval("2026-01-05T11:00:00Z", "2026-01-05T12:00:00Z", "J000003"),
    interval("2026-01-05T12:00:00Z", "2026-01-05T13:00:00Z", "J000001"),
  ];

  assertEquals(
    formatBlockingJobs(
      reservations,
      utc("2026-01-05T08:00:00Z"),
      utc("2026-01-05T16:00:00Z")
    ),
    "queued behind J000002 (2 ops), J000001 (1 op), J000003 (1 op), +1 more"
  );
});

Deno.test("delayed placement names the job whose POOL reservation forced the wait", () => {
  // Another job holds the only qualified operator 06:00-18:00 (shiftless
  // member = 24/7 availability); our op could start at 08:00
  const capacity = makeCapacity();
  const pool = makePool(
    [{ employeeId: "emp-1", windows: alwaysOpen }],
    [interval("2026-01-05T06:00:00Z", "2026-01-05T18:00:00Z", "J000001")]
  );
  const earliestStart = utc("2026-01-05T08:00:00Z");

  const slot = expectSlot(
    allocateOperation({
      durationHours: 2,
      earliestStart,
      horizonEnd: HORIZON,
      capacity,
      operatorPool: pool,
    })
  );

  // The selector composes the past-due message from exactly this call
  assertEquals(slot.start.toISOString(), "2026-01-05T18:00:00.000Z");
  assertEquals(
    formatBlockingJobs(pool.reservations, earliestStart, slot.start),
    "queued behind J000001 (1 op)"
  );
});
