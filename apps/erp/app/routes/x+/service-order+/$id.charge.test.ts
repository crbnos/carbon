// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Service time warns on a budget overrun (Government Contracting 5c). The
// check must run BEFORE the entry posts: after posting, the entry's cost is
// already in the actual cost and the check would count it twice.

let events: string[];
let warning: string | null;

// The projects models reach the glossary, which builds Lingui `msg`
// descriptors at module load; the macro is not transformed under plain
// vitest (as in project-billing-models.test.ts).
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string) =>
    Array.isArray(strings) ? strings.join("") : String(strings)
}));
vi.mock("@carbon/content/glossary", () => ({
  glossaryEntries: () => [],
  terms: {}
}));

vi.mock("@carbon/auth", () => ({
  assertIsPost: vi.fn(),
  hasPermission: () => true,
  success: (message: string) => ({ message })
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn(async () => ({
    client: {},
    companyId: "c1",
    userId: "u1"
  }))
}));
vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(async (_request: Request, result: { message: string }) => ({
    headers: { "x-flash": result.message }
  }))
}));
vi.mock("@carbon/auth/users.server", () => ({
  getUserClaims: vi.fn(async () => ({ permissions: {} }))
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn() })
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({})
}));
vi.mock("~/modules/projects", async () => {
  const { logTimeValidator, projectIssueValidator } = await import(
    "~/modules/projects/projects.models"
  );
  return { logTimeValidator, projectIssueValidator };
});
vi.mock("~/modules/service", () => ({
  coverageOverrideValidator: {},
  serviceChargeReversalValidator: {},
  serviceExpenseValidator: {}
}));
vi.mock("~/modules/service/service.server", () => ({
  addServiceExpense: vi.fn(),
  reclassServiceCharge: vi.fn(),
  requireOwnServiceVisit: vi.fn(),
  requireServiceOrderNode: vi.fn(async () => ({ projectId: "p1" })),
  reverseServiceCharge: vi.fn(),
  ServiceOrderError: class extends Error {}
}));
vi.mock("~/modules/projects/projects.service", () => ({
  postProjectIssue: vi.fn(),
  saveTimesheetEntry: vi.fn(async () => {
    events.push("save");
    return { data: { entryId: "te1" }, error: null };
  }),
  postTimesheetEntries: vi.fn(async () => {
    events.push("post");
    return null;
  }),
  timesheetBudgetWarning: vi.fn(async () => {
    events.push("budget");
    return warning;
  })
}));

const { action } = await import("./$id.charge");

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
  });

  it("checks the budget after the save and before the entry posts", async () => {
    await run();
    expect(events).toEqual(["save", "budget", "post"]);
  });

  it("adds the budget warning to the success flash", async () => {
    warning = "PRJ-1.2 Design is over budget by $500.00.";
    const result = await run();
    expect(result.data.success).toBe(true);
    expect(result.init?.headers["x-flash"]).toBe(
      "Time logged. PRJ-1.2 Design is over budget by $500.00."
    );
  });

  it("keeps the plain flash without an overrun", async () => {
    const result = await run();
    expect(result.init?.headers["x-flash"]).toBe("Time logged");
  });
});
