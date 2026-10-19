// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));
vi.mock("../app/modules/production/production.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notifyScheduleInputsChanged: vi.fn()
}));
vi.mock("../app/modules/people/people.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  createTimeCardEntry: vi.fn(),
  deleteTimeCardEntry: vi.fn(),
  updateEmployeeJob: vi.fn(),
  updateTimeCardEntry: vi.fn()
}));

import { clockInPerson, updateShift } from "../app/modules/people/people.server";
import { clockIn } from "../app/modules/people/people.service";
import { notifyScheduleInputsChanged } from "../app/modules/production/production.service";
import { createServiceContext } from "@carbon/api/service-fn.server";

const unreachable = () => {
  throw new Error("must not be reached");
};

const ctx = createServiceContext({
  actor: {
    type: "user",
    userId: "user-1",
    permissions: {
      people: { view: ["company-1"], create: [], update: [], delete: [] }
    }
  },
  company: { id: "company-1", groupId: "group-1" },
  caller: {} as never,
  system: unreachable as never,
  pg: unreachable as never,
  kv: unreachable as never
});

// The time card helpers refuse with a plain `{ message }`; the database
// errors they pass through carry a code. One is the caller's to fix, the
// other is ours.
describe("clockInPerson", () => {
  it("returns the helper's refusal as a rule the caller can read", async () => {
    vi.mocked(clockIn).mockResolvedValue({
      data: null,
      error: { message: "Already clocked in" }
    } as never);
    const result = await clockInPerson(ctx, { employeeId: "user-2" });
    expect(result.error).toMatchObject({
      category: "rule",
      message: "Already clocked in"
    });
  });

  it("hides a database error behind its own message", async () => {
    vi.mocked(clockIn).mockResolvedValue({
      data: null,
      error: { message: "duplicate key value", code: "23505" }
    } as never);
    const result = await clockInPerson(ctx, { employeeId: "user-2" });
    expect(result.error).toMatchObject({
      category: "internal",
      message: "Failed to clock in"
    });
  });
});

// The boundary is PostgREST: a real supabase-js client whose fetch answers the
// shift UPDATE with `rows`, as RLS leaves them. An UPDATE that reaches no row
// is not an error there, so the empty answer is the case to refuse.
function shiftCaller(rows: { id: string }[]) {
  const sent: { method: string; url: URL }[] = [];
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ method: init?.method ?? "GET", url: new URL(String(input)) });
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const client = createClient("http://localhost:54321", "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchStub as typeof fetch }
  });
  return { client: client as never, sent };
}

function shiftContext(caller: never, update: string[]) {
  return createServiceContext({
    actor: {
      type: "user",
      userId: "user-1",
      permissions: {
        people: {
          view: ["company-1"],
          create: ["company-1"],
          update,
          delete: []
        }
      }
    },
    company: { id: "company-1", groupId: "group-1" },
    caller,
    system: unreachable as never,
    pg: unreachable as never,
    kv: unreachable as never
  });
}

const SHIFT = {
  id: "shift-1",
  name: "Day",
  startTime: "08:00",
  endTime: "16:00",
  locationId: "loc-1",
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false
};

describe("updateShift", () => {
  beforeEach(() => vi.mocked(notifyScheduleInputsChanged).mockClear());

  // The shift UPDATE policy needs people update; create alone saved nothing.
  it("needs people update, not create", async () => {
    const { client, sent } = shiftCaller([{ id: "shift-1" }]);
    const result = await updateShift(shiftContext(client, []), SHIFT);
    expect(result.error?.category).toBe("forbidden");
    expect(sent).toEqual([]);
  });

  it("refuses a shift the update reached no row of, and tells no scheduler", async () => {
    const { client, sent } = shiftCaller([]);
    const result = await updateShift(shiftContext(client, ["company-1"]), {
      ...SHIFT,
      id: "shift-missing"
    });
    expect(result.error).toMatchObject({
      category: "notFound",
      message: "Shift not found"
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe("PATCH");
    expect(sent[0]?.url.searchParams.get("id")).toBe("eq.shift-missing");
    expect(sent[0]?.url.searchParams.get("companyId")).toBe("eq.company-1");
    expect(notifyScheduleInputsChanged).not.toHaveBeenCalled();
  });

  it("saves the shift and marks the schedule stale", async () => {
    const { client } = shiftCaller([{ id: "shift-1" }]);
    const result = await updateShift(
      shiftContext(client, ["company-1"]),
      SHIFT
    );
    expect(result).toEqual({ data: { id: "shift-1" }, error: null });
    expect(notifyScheduleInputsChanged).toHaveBeenCalledOnce();
  });
});
