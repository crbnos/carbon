import { parseAbsolute } from "@internationalized/date";
import { it } from "vitest";
import { expandCalendar, intersectWindows } from "./calendar-utils.ts";
import {
  type AllocationResult,
  type AllocationSuccess,
  type AttendedAllocationSuccess,
  allocateAttendedOperation,
  allocateOperation,
  type EligibleMember,
  formatBlockingJobs,
  isConflict,
  type ReservationInterval,
  type ResourceCapacityData
} from "./slot-allocator.ts";
import { assert, assertEquals } from "./test-helpers.ts";

const utc = (iso: string) => parseAbsolute(iso, "UTC").toDate().getTime();

// 2026-01-05 is a Monday
const RANGE_START = utc("2026-01-05T00:00:00Z");
const HORIZON = utc("2026-01-19T00:00:00Z");

// Mon-Fri 08:00-16:00 UTC — a person's shift pattern
const weekdayShifts = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: "08:00",
  endTime: "16:00"
}));
const weekdayWindows = expandCalendar(weekdayShifts, RANGE_START, HORIZON);
const alwaysOpen = [{ start: RANGE_START, end: HORIZON }];

function makeCapacity(
  reservations: ReservationInterval[] = []
): ResourceCapacityData {
  return {
    workCenter: { id: "wc1" },
    windows: alwaysOpen,
    reservations
  };
}

function member(employeeId: string, windows = alwaysOpen): EligibleMember {
  return { employeeId, windows };
}

function expectSlot(r: AllocationResult): AllocationSuccess {
  assert(!isConflict(r), `expected slot, got conflict: ${JSON.stringify(r)}`);
  return r;
}

function expectAttended(
  r: AttendedAllocationSuccess | { conflict: string }
): AttendedAllocationSuccess {
  assert(!isConflict(r), `expected slot, got conflict: ${JSON.stringify(r)}`);
  return r;
}

// --- machine gating (ungated operations) ------------------------------------

it("work center capacity is 1 — ungated ops queue back to back", () => {
  const capacity = makeCapacity();
  const placed: AllocationSuccess[] = [];

  for (let i = 0; i < 3; i++) {
    const slot = expectSlot(
      allocateOperation({
        durationHours: 4,
        earliestStart: utc("2026-01-05T08:00:00Z"),
        horizonEnd: HORIZON,
        capacity
      })
    );
    placed.push(slot);
    capacity.reservations.push({ startAt: slot.start, endAt: slot.end });
  }

  // One operation at a time: each op starts when the previous one ends
  assertEquals(placed[0]?.start, utc("2026-01-05T08:00:00.000Z"));
  assertEquals(placed[0]?.end, utc("2026-01-05T12:00:00.000Z"));
  assertEquals(placed[1]?.start, utc("2026-01-05T12:00:00.000Z"));
  assertEquals(placed[1]?.end, utc("2026-01-05T16:00:00.000Z"));
  assertEquals(placed[2]?.start, utc("2026-01-05T16:00:00.000Z"));
  assertEquals(placed[2]?.end, utc("2026-01-05T20:00:00.000Z"));

  // The first op didn't wait; the queued ones attribute their wait to the
  // machine, held by untagged (same-job in-run) reservations
  assertEquals(placed[0]?.wait, null);
  assertEquals(placed[1]?.wait, {
    resource: "machine",
    blockers: null,
    ownJobAhead: true
  });
  assertEquals(placed[2]?.wait?.resource, "machine");
});

it("an existing work-center reservation delays an ungated op until it ends", () => {
  const capacity = makeCapacity([
    {
      startAt: utc("2026-01-05T06:00:00Z"),
      endAt: utc("2026-01-05T18:00:00Z")
    }
  ]);

  const slot = expectSlot(
    allocateOperation({
      durationHours: 2,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity
    })
  );

  assertEquals(slot.start, utc("2026-01-05T18:00:00.000Z"));
  assertEquals(slot.wait?.resource, "machine");
});

it("machine nextTryAfter hops to the earliest overlapping reservation end", () => {
  const capacity = makeCapacity([
    {
      startAt: utc("2026-01-05T08:00:00Z"),
      endAt: utc("2026-01-05T10:00:00Z")
    },
    {
      startAt: utc("2026-01-05T09:00:00Z"),
      endAt: utc("2026-01-05T14:00:00Z")
    }
  ]);

  const slot = expectSlot(
    allocateOperation({
      durationHours: 2,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity
    })
  );

  assertEquals(slot.start, utc("2026-01-05T14:00:00.000Z"));
  assertEquals(slot.end, utc("2026-01-05T16:00:00.000Z"));
});

it("conflict when the machine is booked through the horizon (ungated)", () => {
  const capacity = makeCapacity([
    { startAt: RANGE_START, endAt: HORIZON, readableJobId: "J000009" }
  ]);

  const result = allocateOperation({
    durationHours: 2,
    earliestStart: utc("2026-01-05T08:00:00Z"),
    horizonEnd: HORIZON,
    capacity
  });

  assert(isConflict(result));
  assertEquals(
    result.conflict,
    "No work center capacity available before 2026-01-19"
  );
});

it("conflict when the horizon is exhausted", () => {
  const result = allocateOperation({
    durationHours: 24 * 30, // longer than the two-week horizon
    earliestStart: utc("2026-01-05T08:00:00Z"),
    horizonEnd: HORIZON,
    capacity: makeCapacity()
  });

  assert(isConflict(result));
});

// --- machine hours bound placement (shift-bound work centers) ---------------

it("machine hours bound an ungated op: 10h on an 8h/day machine spans two days", () => {
  // The work center is open Mon–Fri 08:00–16:00 (8h/day), not 24×7.
  const capacity: ResourceCapacityData = {
    workCenter: { id: "wc1" },
    windows: weekdayWindows,
    reservations: []
  };
  const slot = expectSlot(
    allocateOperation({
      durationHours: 10,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity
    })
  );
  assertEquals(slot.start, utc("2026-01-05T08:00:00.000Z"));
  // 8h Monday (08–16) + 2h Tuesday (08–10) — pauses overnight, never a weekend
  assertEquals(slot.end, utc("2026-01-06T10:00:00.000Z"));
});

it("attended remainder accumulates on machine windows: 4h from 1h before close resumes next window", () => {
  // Machine open 08:00–16:00; a 4h unattended remainder starting at 15:00
  // (1h before close) finishes 3h into the next window.
  const capacity: ResourceCapacityData = {
    workCenter: { id: "wc1" },
    windows: weekdayWindows,
    reservations: []
  };
  const sam = member("emp-sam", weekdayWindows); // already machine-clipped
  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 1, // 14:00–15:00
      totalHours: 5, // + 4h unattended machine run
      earliestStart: utc("2026-01-05T14:00:00Z"),
      horizonEnd: HORIZON,
      capacity,
      members: [sam],
      busyByEmployee: new Map()
    })
  );
  assertEquals(r.attendedEnd, utc("2026-01-05T15:00:00.000Z"));
  // 1h to close (16:00) + 3h into Tuesday's window (08:00–11:00)
  assertEquals(r.end, utc("2026-01-06T11:00:00.000Z"));
});

it("a 24×7 member clipped to an 8h machine window works only machine hours", () => {
  const capacity: ResourceCapacityData = {
    workCenter: { id: "wc1" },
    windows: weekdayWindows, // 8h/day
    reservations: []
  };
  // Person is available around the clock, but the selector clips them to the
  // machine's hours — a person can't run a closed machine.
  const clipped = intersectWindows(alwaysOpen, capacity.windows);
  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 12,
      totalHours: 12,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity,
      members: [member("emp-sam", clipped)],
      busyByEmployee: new Map()
    })
  );
  // 8h Monday + 4h Tuesday — never overnight, despite the person being 24×7
  assertEquals(r.segments.length, 2);
  assertEquals(r.segments[0]?.startAt, utc("2026-01-05T08:00:00.000Z"));
  assertEquals(r.segments[0]?.endAt, utc("2026-01-05T16:00:00.000Z"));
  assertEquals(r.segments[1]?.startAt, utc("2026-01-06T08:00:00.000Z"));
  assertEquals(r.segments[1]?.endAt, utc("2026-01-06T12:00:00.000Z"));
  assertEquals(r.attendedEnd, utc("2026-01-06T12:00:00.000Z"));
});

// --- attended windows, relay, lights-out (gated operations) -----------------

it("one person tends two machines — attended windows interleave, both run in parallel", () => {
  const capacityA = makeCapacity();
  const capacityB = makeCapacity();
  const sam = member("emp-sam");
  const busy = new Map<string, ReservationInterval[]>();

  // 5 min labor + 55 min unattended run = 1h total on each machine
  const a = expectAttended(
    allocateAttendedOperation({
      attendedHours: 5 / 60,
      totalHours: 1,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: capacityA,
      members: [sam],
      busyByEmployee: busy
    })
  );
  capacityA.reservations.push({ startAt: a.start, endAt: a.end });
  busy.set(
    "emp-sam",
    a.segments.map((s) => ({ startAt: s.startAt, endAt: s.endAt }))
  );

  const b = expectAttended(
    allocateAttendedOperation({
      attendedHours: 5 / 60,
      totalHours: 1,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: capacityB,
      members: [sam],
      busyByEmployee: busy
    })
  );

  // Machine A runs 08:00-09:00; Sam is free from 08:05 so machine B runs
  // 08:05-09:05 — both machines live with one person
  assertEquals(a.start, utc("2026-01-05T08:00:00.000Z"));
  assertEquals(a.attendedEnd, utc("2026-01-05T08:05:00.000Z"));
  assertEquals(a.end, utc("2026-01-05T09:00:00.000Z"));
  assertEquals(b.start, utc("2026-01-05T08:05:00.000Z"));
  assertEquals(b.attendedEnd, utc("2026-01-05T08:10:00.000Z"));
  assertEquals(b.end, utc("2026-01-05T09:05:00.000Z"));
  assertEquals(b.segments, [
    {
      employeeId: "emp-sam",
      startAt: utc("2026-01-05T08:05:00Z"),
      endAt: utc("2026-01-05T08:10:00Z")
    }
  ]);
  assertEquals(b.wait?.resource, "operator");
});

it("relay: attended work hands off at the shift boundary", () => {
  const sam = member("emp-sam", [
    { start: utc("2026-01-05T08:00:00Z"), end: utc("2026-01-05T16:00:00Z") }
  ]);
  const dave = member("emp-dave", [
    { start: utc("2026-01-05T16:00:00Z"), end: utc("2026-01-06T00:00:00Z") }
  ]);

  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 12,
      totalHours: 12,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      members: [sam, dave],
      busyByEmployee: new Map()
    })
  );

  // Sam 08-16, Dave 16-20 — continuous progress across the boundary
  assertEquals(r.segments, [
    {
      employeeId: "emp-sam",
      startAt: utc("2026-01-05T08:00:00Z"),
      endAt: utc("2026-01-05T16:00:00Z")
    },
    {
      employeeId: "emp-dave",
      startAt: utc("2026-01-05T16:00:00Z"),
      endAt: utc("2026-01-05T20:00:00Z")
    }
  ]);
  assertEquals(r.end, utc("2026-01-05T20:00:00.000Z"));
});

it("pause: single person, attended work spans two shifts, machine held across the gap", () => {
  const sam = member("emp-sam", weekdayWindows);

  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 12,
      totalHours: 12,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      members: [sam],
      busyByEmployee: new Map()
    })
  );

  // 8h Monday + 4h Tuesday; nobody booked overnight but the op (and machine
  // span) stretches across the gap
  assertEquals(r.segments, [
    {
      employeeId: "emp-sam",
      startAt: utc("2026-01-05T08:00:00Z"),
      endAt: utc("2026-01-05T16:00:00Z")
    },
    {
      employeeId: "emp-sam",
      startAt: utc("2026-01-06T08:00:00Z"),
      endAt: utc("2026-01-06T12:00:00Z")
    }
  ]);
  assertEquals(r.end, utc("2026-01-06T12:00:00.000Z"));
  assertEquals(r.attendedEnd, r.end);
});

it("lights-out: the unattended remainder runs on calendar time overnight", () => {
  const sam = member("emp-sam", weekdayWindows);

  // Loaded Mon 15:00 with 5 min labor; 20h machine run continues after
  // Sam's shift ends at 16:00
  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 5 / 60,
      totalHours: 20 + 5 / 60,
      earliestStart: utc("2026-01-05T15:00:00Z"),
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      members: [sam],
      busyByEmployee: new Map()
    })
  );

  assertEquals(r.start, utc("2026-01-05T15:00:00.000Z"));
  assertEquals(r.attendedEnd, utc("2026-01-05T15:05:00.000Z"));
  assertEquals(r.end, utc("2026-01-06T11:05:00.000Z"));
});

it("zero attended hours: no person booked, machine-only placement", () => {
  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 0,
      totalHours: 2,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      members: [member("emp-sam", weekdayWindows)],
      busyByEmployee: new Map()
    })
  );

  assertEquals(r.segments, []);
  assertEquals(r.start, utc("2026-01-05T08:00:00.000Z"));
  assertEquals(r.end, utc("2026-01-05T10:00:00.000Z"));
  assertEquals(r.wait, null);
});

it("no eligible people is an immediate conflict", () => {
  const result = allocateAttendedOperation({
    attendedHours: 1,
    totalHours: 1,
    earliestStart: utc("2026-01-05T08:00:00Z"),
    horizonEnd: HORIZON,
    capacity: makeCapacity(),
    members: [],
    busyByEmployee: new Map()
  });

  assert(isConflict(result));
  assertEquals(result.conflict, "No qualified operator available");
});

it("cross-ability double-booking: a person busy via another booking is unavailable", () => {
  const sam = member("emp-sam");
  const busy = new Map<string, ReservationInterval[]>([
    [
      "emp-sam",
      [
        {
          startAt: utc("2026-01-05T08:00:00Z"),
          endAt: utc("2026-01-05T12:00:00Z"),
          readableJobId: "J000009"
        }
      ]
    ]
  ]);

  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 2,
      totalHours: 2,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      members: [sam],
      busyByEmployee: busy
    })
  );

  assertEquals(r.start, utc("2026-01-05T12:00:00.000Z"));
  assertEquals(r.wait, {
    resource: "operator",
    blockers: "queued behind J000009 (1 op)",
    ownJobAhead: false
  });
});

it("machine busy blocks the attended start — attribution machine", () => {
  const capacity = makeCapacity([
    {
      startAt: utc("2026-01-05T08:00:00Z"),
      endAt: utc("2026-01-05T10:00:00Z"),
      readableJobId: "J000009"
    }
  ]);

  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 2,
      totalHours: 2,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity,
      members: [member("emp-sam")],
      busyByEmployee: new Map()
    })
  );

  assertEquals(r.start, utc("2026-01-05T10:00:00.000Z"));
  assertEquals(r.wait, {
    resource: "machine",
    blockers: "queued behind J000009 (1 op)",
    ownJobAhead: false
  });
});

it("interleaving: machine frees first, operator binds last — attribution follows the last blocker", () => {
  const capacity = makeCapacity([
    {
      startAt: utc("2026-01-05T08:00:00Z"),
      endAt: utc("2026-01-05T10:00:00Z"),
      readableJobId: "J000009"
    }
  ]);
  const busy = new Map<string, ReservationInterval[]>([
    [
      "emp-sam",
      [
        {
          startAt: utc("2026-01-05T09:00:00Z"),
          endAt: utc("2026-01-05T13:00:00Z"),
          readableJobId: "J000010"
        }
      ]
    ]
  ]);

  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 2,
      totalHours: 2,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity,
      members: [member("emp-sam")],
      busyByEmployee: busy
    })
  );

  assertEquals(r.start, utc("2026-01-05T13:00:00.000Z"));
  assertEquals(r.wait, {
    resource: "operator",
    blockers: "queued behind J000010 (1 op)",
    ownJobAhead: false
  });
});

it("attended op conflicts when the machine is booked through the horizon", () => {
  const capacity = makeCapacity([
    { startAt: RANGE_START, endAt: HORIZON, readableJobId: "J000009" }
  ]);

  const result = allocateAttendedOperation({
    attendedHours: 1,
    totalHours: 2,
    earliestStart: utc("2026-01-05T08:00:00Z"),
    horizonEnd: HORIZON,
    capacity,
    members: [member("emp-sam")],
    busyByEmployee: new Map()
  });

  assert(isConflict(result));
  assertEquals(
    result.conflict,
    "No slot with both an open work center and a qualified operator available before 2026-01-19"
  );
});

it("least-loaded available person takes over when the incumbent is absent", () => {
  // Two people around the clock; Alex already carries 4h of bookings, Zoe 0.
  // A fresh op should go to Zoe (least loaded), not Alex, not id-order.
  const alex = member("emp-alex");
  const zoe = member("emp-zoe");
  const busy = new Map<string, ReservationInterval[]>([
    [
      "emp-alex",
      [
        {
          startAt: utc("2026-01-05T00:00:00Z"),
          endAt: utc("2026-01-05T04:00:00Z"),
          readableJobId: "J000001"
        }
      ]
    ]
  ]);

  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 1,
      totalHours: 1,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      members: [alex, zoe],
      busyByEmployee: busy
    })
  );

  assertEquals(r.segments.length, 1);
  assertEquals(r.segments[0]?.employeeId, "emp-zoe");
});

// --- formatBlockingJobs -----------------------------------------------------

function interval(
  startIso: string,
  endIso: string,
  readableJobId?: string
): ReservationInterval {
  return { startAt: utc(startIso), endAt: utc(endIso), readableJobId };
}

it("formatBlockingJobs groups by job and counts reservations", () => {
  const reservations = [
    interval("2026-01-05T08:00:00Z", "2026-01-05T10:00:00Z", "J000001"),
    interval("2026-01-05T10:00:00Z", "2026-01-05T12:00:00Z", "J000001"),
    interval("2026-01-05T12:00:00Z", "2026-01-05T14:00:00Z", "J000001"),
    interval("2026-01-05T14:00:00Z", "2026-01-05T16:00:00Z", "J000007")
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

it("formatBlockingJobs ignores untagged (own-job) intervals", () => {
  const reservations = [
    interval("2026-01-05T08:00:00Z", "2026-01-05T12:00:00Z"), // own in-run push
    interval("2026-01-05T12:00:00Z", "2026-01-05T14:00:00Z", "J000002")
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

it("formatBlockingJobs treats touching intervals as non-overlapping", () => {
  const reservations = [
    // ends exactly at region start / starts exactly at region end
    interval("2026-01-05T06:00:00Z", "2026-01-05T08:00:00Z", "J000003"),
    interval("2026-01-05T16:00:00Z", "2026-01-05T18:00:00Z", "J000004")
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

it("formatBlockingJobs returns null for an empty region or no blockers", () => {
  const tagged = [
    interval("2026-01-05T08:00:00Z", "2026-01-05T12:00:00Z", "J000005")
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
    formatBlockingJobs(
      [],
      utc("2026-01-05T08:00:00Z"),
      utc("2026-01-06T00:00:00Z")
    ),
    null
  );
});

it("formatBlockingJobs ranks by op count then job id, capping at 3", () => {
  const reservations = [
    interval("2026-01-05T08:00:00Z", "2026-01-05T09:00:00Z", "J000004"),
    interval("2026-01-05T09:00:00Z", "2026-01-05T10:00:00Z", "J000002"),
    interval("2026-01-05T10:00:00Z", "2026-01-05T11:00:00Z", "J000002"),
    interval("2026-01-05T11:00:00Z", "2026-01-05T12:00:00Z", "J000003"),
    interval("2026-01-05T12:00:00Z", "2026-01-05T13:00:00Z", "J000001")
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

// --- people team mode (station people works the same op together) ---------------

it("team: two members halve the labor, both booked on the same op", () => {
  // setup 1h + labor 4h, machine 0. Two 24/7 members => setup 1h at 1x, then
  // labor 4h at 2x = 2h wall. Attended span 08:00-11:00; both booked 3h.
  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 5,
      totalHours: 5,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      members: [member("bob"), member("carol")],
      busyByEmployee: new Map(),
      team: { setupHours: 1, laborHours: 4, machineHours: 0 }
    })
  );
  assertEquals(r.start, utc("2026-01-05T08:00:00.000Z"));
  assertEquals(r.attendedEnd, utc("2026-01-05T11:00:00.000Z"));
  assertEquals(r.end, utc("2026-01-05T11:00:00.000Z"));
  // One overlapping segment per person covering the whole attended span
  assertEquals(r.segments.length, 2);
  for (const employeeId of ["bob", "carol"]) {
    const seg = r.segments.find((s) => s.employeeId === employeeId);
    assert(seg, `${employeeId} booked`);
    assertEquals(seg!.startAt, utc("2026-01-05T08:00:00.000Z"));
    assertEquals(seg!.endAt, utc("2026-01-05T11:00:00.000Z"));
  }
});

it("team: single member matches the legacy attended result", () => {
  const argsBase = {
    attendedHours: 5,
    totalHours: 5,
    earliestStart: utc("2026-01-05T08:00:00Z"),
    horizonEnd: HORIZON,
    capacity: makeCapacity(),
    members: [member("bob", weekdayWindows)],
    busyByEmployee: new Map<string, ReservationInterval[]>()
  };
  const legacy = expectAttended(allocateAttendedOperation(argsBase));
  const team = expectAttended(
    allocateAttendedOperation({
      ...argsBase,
      team: { setupHours: 1, laborHours: 4, machineHours: 0 }
    })
  );
  assertEquals(team.start, legacy.start);
  assertEquals(team.attendedEnd, legacy.attendedEnd);
  assertEquals(team.end, legacy.end);
  assertEquals(team.segments.length, 1);
  assertEquals(team.segments[0]?.employeeId, "bob");
});

it("team: rate drops when a member's shift ends mid-op", () => {
  // Bob 24/7, Carol only Mon 08:00-10:00. Setup 0, labor 6h.
  // 08:00-10:00 both present: 2h wall x2 = 4h labor done.
  // 10:00 on Bob alone: remaining 2h at 1x -> attended ends 12:00.
  const carolWindows = [
    { start: utc("2026-01-05T08:00:00Z"), end: utc("2026-01-05T10:00:00Z") }
  ];
  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 6,
      totalHours: 6,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      members: [member("bob"), member("carol", carolWindows)],
      busyByEmployee: new Map(),
      team: { setupHours: 0, laborHours: 6, machineHours: 0 }
    })
  );
  assertEquals(r.attendedEnd, utc("2026-01-05T12:00:00.000Z"));
  const carol = r.segments.find((s) => s.employeeId === "carol");
  assertEquals(carol!.endAt, utc("2026-01-05T10:00:00.000Z"));
  const bob = r.segments.find((s) => s.employeeId === "bob");
  assertEquals(bob!.endAt, utc("2026-01-05T12:00:00.000Z"));
});

it("team: machine time is not compressed", () => {
  // Setup 1h, labor 4h, machine 6h. Two members: attended = 1h + 2h = 3h
  // (ends 11:00). Machine ran concurrently for the 2h labor wall-clock;
  // remaining 4h unattended -> end 15:00. (Legacy would end at
  // setup + max(labor, machine) = 7h -> 15:00 too, but attended would be 5h.)
  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 5,
      totalHours: 7,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      members: [member("bob"), member("carol")],
      busyByEmployee: new Map(),
      team: { setupHours: 1, laborHours: 4, machineHours: 6 }
    })
  );
  assertEquals(r.attendedEnd, utc("2026-01-05T11:00:00.000Z"));
  assertEquals(r.end, utc("2026-01-05T15:00:00.000Z"));
});

it("team: a busy member joins the op when they free up", () => {
  // Carol busy 08:00-09:00 on another booking; labor 4h, no setup.
  // 08:00-09:00 Bob alone (1h done), 09:00 Carol joins: remaining 3h at 2x
  // -> +1.5h -> attended ends 10:30.
  const busy = new Map<string, ReservationInterval[]>([
    [
      "carol",
      [
        {
          startAt: utc("2026-01-05T08:00:00Z"),
          endAt: utc("2026-01-05T09:00:00Z")
        }
      ]
    ]
  ]);
  const r = expectAttended(
    allocateAttendedOperation({
      attendedHours: 4,
      totalHours: 4,
      earliestStart: utc("2026-01-05T08:00:00Z"),
      horizonEnd: HORIZON,
      capacity: makeCapacity(),
      members: [member("bob"), member("carol")],
      busyByEmployee: busy,
      team: { setupHours: 0, laborHours: 4, machineHours: 0 }
    })
  );
  assertEquals(r.attendedEnd, utc("2026-01-05T10:30:00.000Z"));
  const carol = r.segments.find((s) => s.employeeId === "carol");
  assertEquals(carol!.startAt, utc("2026-01-05T09:00:00.000Z"));
});
