// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The scheduler is told through an event.
const { trigger } = vi.hoisted(() => ({ trigger: vi.fn() }));
vi.mock("@carbon/jobs", () => ({ trigger }));

import { updateShift } from "../app/modules/people/people.server";
import { timeCardError } from "../app/modules/people/people.service";
import { createServiceContext } from "@carbon/api/service-fn.server";

const unreachable = () => {
  throw new Error("must not be reached");
};

const ctx = shiftContext({} as never, []);

// The time card helpers refuse with a plain `{ message }`; the database
// errors they pass through carry a code. One is the caller's to fix, the
// other is ours.
describe("timeCardError", () => {
  it("returns a helper's refusal as a rule the caller can read", () => {
    expect(
      timeCardError(ctx, { message: "Already clocked in" }, "Failed to clock in")
    ).toMatchObject({ category: "rule", message: "Already clocked in" });
  });

  it("hides a database error behind the operation's own message", () => {
    expect(
      timeCardError(
        ctx,
        { message: "duplicate key value", code: "23505" },
        "Failed to clock in"
      )
    ).toMatchObject({ category: "internal", message: "Failed to clock in" });
  });
});

// The boundary is PostgREST: a real supabase-js client whose fetch answers the
// shift UPDATE with `rows`, as RLS leaves them. An UPDATE that reaches no row
// is not an error there, so the empty answer is the case to refuse. The read
// before it (the shift's current location) answers with `stored`.
function shiftCaller(
  rows: { id: string }[],
  stored: { locationId: string }[] = rows.map(() => ({ locationId: "loc-1" }))
) {
  const sent: { method: string; url: URL }[] = [];
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    sent.push({ method, url: new URL(String(input)) });
    return new Response(JSON.stringify(method === "GET" ? stored : rows), {
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
  beforeEach(() => trigger.mockClear());

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
    const patch = sent.filter((request) => request.method === "PATCH");
    expect(patch).toHaveLength(1);
    expect(patch[0]?.url.searchParams.get("id")).toBe("eq.shift-missing");
    expect(patch[0]?.url.searchParams.get("companyId")).toBe("eq.company-1");
    expect(trigger).not.toHaveBeenCalled();
  });

  it("saves the shift and marks the schedule stale", async () => {
    const { client } = shiftCaller([{ id: "shift-1" }]);
    const result = await updateShift(
      shiftContext(client, ["company-1"]),
      SHIFT
    );
    expect(result).toEqual({ data: { id: "shift-1" }, error: null });
    expect(trigger.mock.calls).toEqual([
      [
        "schedule-inputs-changed",
        expect.objectContaining({ kind: "shift", entityId: "shift-1" })
      ]
    ]);
  });

  // The stations at the old location lose the shift's hours too, and the
  // shift-scoped notice only sees the new location.
  it("re-plans the company when the shift moves to another location", async () => {
    const { client } = shiftCaller([{ id: "shift-1" }], [{ locationId: "hq" }]);
    const result = await updateShift(
      shiftContext(client, ["company-1"]),
      SHIFT
    );
    expect(result).toEqual({ data: { id: "shift-1" }, error: null });
    expect(trigger.mock.calls).toEqual([
      [
        "schedule-inputs-changed",
        expect.objectContaining({ kind: "location", entityId: undefined })
      ]
    ]);
  });
});
