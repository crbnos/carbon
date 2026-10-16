// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));
vi.mock("../app/modules/production/production.service", () => ({
  notifyScheduleInputsChanged: vi.fn()
}));
vi.mock("../app/modules/people/people.service", () => ({
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  createTimeCardEntry: vi.fn(),
  deleteTimeCardEntry: vi.fn(),
  updateEmployeeJob: vi.fn(),
  updateTimeCardEntry: vi.fn(),
  upsertShift: vi.fn()
}));

import { clockInPerson } from "../app/modules/people/people.server";
import { clockIn } from "../app/modules/people/people.service";
import { createServiceContext } from "../app/modules/service-fn.server";

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
