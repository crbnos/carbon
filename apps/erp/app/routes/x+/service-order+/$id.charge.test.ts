// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  createServiceContext,
  type ServiceContext
} from "@carbon/api/service-fn.server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Service time warns on a budget overrun (Government Contracting 5c). The
// check must run BEFORE the entry posts: after posting, the entry's cost is
// already in the actual cost and the check would count it twice. The order
// lives in the `logServiceTime` operation; the route only turns its warning
// into the success flash.

let events: string[];
let warning: string | null;

vi.mock("@carbon/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  success: (message: string) => ({ message })
}));
vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(async (_request: Request, result: { message: string }) => ({
    headers: { "x-flash": result.message }
  }))
}));

// The route calls the operation through `carbon(request)`.
const logServiceTimeCall = vi.fn();
vi.mock("@carbon/api/carbon.server", () => ({
  carbon: vi.fn(async () => ({
    service: { logServiceTime: logServiceTimeCall }
  }))
}));

// The operation's building blocks.
vi.mock("~/modules/service/service.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  attemptServiceOrder: async <R>(
    _ctx: ServiceContext,
    _fallback: string,
    body: () => Promise<R>
  ) => body(),
  requireServiceVisitAccess: vi.fn(async () => undefined),
  requireServiceOrderNode: vi.fn(async () => ({ projectId: "p1" }))
}));
vi.mock("~/modules/shared/shared.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  invokePosting: vi.fn(async (_ctx: unknown, name: string) => {
    events.push(name === "save-timesheet-entry" ? "save" : name);
    return { data: { entryId: "te1" }, error: null };
  })
}));
vi.mock("~/modules/projects/projects.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  timesheetBudgetWarning: vi.fn(async () => {
    events.push("budget");
    return warning;
  }),
  postTimesheetEntries: vi.fn(async () => {
    events.push("post");
    return null;
  })
}));

const { action } = await import("./$id.charge");
const { logServiceTime } = await import("~/modules/service/service.server");

function stub(name: string): never {
  return new Proxy({} as never, {
    get() {
      throw new Error(`The operation used the ${name}`);
    }
  });
}

function systemContext(): ServiceContext {
  return createServiceContext({
    actor: { type: "system", onBehalfOf: "u1" },
    company: { id: "c1", groupId: "g1" },
    caller: {} as never,
    system: () => stub("service-role client"),
    pg: () => ({}) as never,
    kv: () => stub("kv")
  });
}

const time = {
  serviceOrderId: "so1",
  serviceVisitId: null,
  projectId: "p1",
  laborCategoryId: "lc1",
  entryDate: "2026-10-11",
  hours: 4
};

function timeRequest() {
  const body = new FormData();
  body.set("intent", "time");
  body.set("projectId", "p1");
  body.set("laborCategoryId", "lc1");
  body.set("entryDate", "2026-10-11");
  body.set("hours", "4");
  return new Request("http://localhost/x/service-order/so1/charge", {
    method: "POST",
    body
  });
}

async function run() {
  const result = (await action({
    request: timeRequest(),
    params: { id: "so1" }
  } as never)) as unknown as {
    data: { success: boolean };
    init: { headers: Record<string, string> } | null;
  };
  return result;
}

describe("service order time charge", () => {
  beforeEach(() => {
    events = [];
    warning = null;
    logServiceTimeCall.mockReset();
  });

  it("checks the budget after the save and before the entry posts", async () => {
    const logged = await logServiceTime(systemContext(), time);
    expect(logged.error).toBeNull();
    expect(events).toEqual(["save", "budget", "post"]);
  });

  it("returns the budget warning", async () => {
    warning = "PRJ-1.2 Design is over budget by $500.00.";
    const logged = await logServiceTime(systemContext(), time);
    expect(logged.data).toEqual({ warning });
  });

  it("adds the budget warning to the success flash", async () => {
    logServiceTimeCall.mockResolvedValue({
      data: { warning: "PRJ-1.2 Design is over budget by $500.00." },
      error: null
    });
    const result = await run();
    expect(logServiceTimeCall).toHaveBeenCalledWith(
      expect.objectContaining({ serviceOrderId: "so1", projectId: "p1" })
    );
    expect(result.data.success).toBe(true);
    expect(result.init?.headers["x-flash"]).toBe(
      "Time logged. PRJ-1.2 Design is over budget by $500.00."
    );
  });

  it("keeps the plain flash without an overrun", async () => {
    logServiceTimeCall.mockResolvedValue({
      data: { warning: null },
      error: null
    });
    const result = await run();
    expect(result.init?.headers["x-flash"]).toBe("Time logged");
  });
});
