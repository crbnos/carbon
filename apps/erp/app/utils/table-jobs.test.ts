// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  BULK_ACTIONS,
  bulkActionServesList,
  bulkStartFormResponse,
  fitsOneRequest,
  getBulkActionMeta,
  hasListPermission,
  newTableExportId,
  parseAllMatching,
  parseTableExportId,
  refreshingClientFactory,
  resolveUserClient,
  rowLimitRefusal,
  splitIdsByStatus,
  type TableJobClaims,
  tableJobBusyMessage,
  USER_CLIENT_MAX_AGE_MS
} from "./table-jobs";

describe("tableJobBusyMessage", () => {
  it("says how long the lock can still hold, in whole minutes", () => {
    expect(tableJobBusyMessage("export", 1741)).toBe(
      "An export is already running for your company. Try again when it ends, at the latest in 30 minutes."
    );
    expect(tableJobBusyMessage("bulk", 30)).toBe(
      "A bulk action is already running for your company. Try again when it ends, at the latest in 1 minute."
    );
  });

  it("promises no wait when Redis gave no TTL", () => {
    expect(tableJobBusyMessage("bulk", 0)).toBe(
      "A bulk action is already running for your company."
    );
  });
});

describe("export ids", () => {
  it("carries the list key the download route checks", () => {
    expect(parseTableExportId(newTableExportId("purchase-orders"))).toEqual({
      listKey: "purchase-orders"
    });
  });

  it("refuses an id that is not one", () => {
    expect(parseTableExportId("failed:abc")).toBeNull();
    expect(parseTableExportId("parts")).toBeNull();
    expect(parseTableExportId("parts.short")).toBeNull();
    expect(parseTableExportId("../x.V1StGXR8_Z5jdHi6B-myT")).toBeNull();
    expect(parseTableExportId("parts.V1StGXR8_Z5jdHi6B-myT.csv")).toBeNull();
  });
});

describe("refreshingClientFactory", () => {
  it("keeps one token for four minutes, then signs a new one", async () => {
    let clock = 0;
    let signed = 0;
    const getClient = refreshingClientFactory(
      async () => ++signed,
      USER_CLIENT_MAX_AGE_MS,
      () => clock
    );
    expect(await getClient()).toBe(1);
    clock = USER_CLIENT_MAX_AGE_MS - 1;
    expect(await getClient()).toBe(1);
    clock = USER_CLIENT_MAX_AGE_MS;
    expect(await getClient()).toBe(2);
    clock += 1_000;
    expect(await getClient()).toBe(2);
  });

  it("serves the request's client as it is", async () => {
    const client = { from: () => null } as never;
    expect(await resolveUserClient(client)).toBe(client);
  });
});

function claims(overrides: Partial<TableJobClaims> = {}): TableJobClaims {
  return {
    role: "employee",
    permissions: {
      sales: { view: ["co_1"], create: [], update: ["co_1"], delete: [] },
      parts: { view: ["co_2"], create: [], update: [], delete: [] }
    },
    ...overrides
  };
}

describe("hasListPermission", () => {
  it("accepts an employee with the list's permission in the company", () => {
    expect(hasListPermission(claims(), { view: "sales" }, "co_1")).toBe(true);
  });

  it("refuses a permission granted in another company only", () => {
    expect(hasListPermission(claims(), { view: "parts" }, "co_1")).toBe(false);
  });

  it("refuses a portal account even with the permission", () => {
    expect(
      hasListPermission(claims({ role: "customer" }), { view: "sales" }, "co_1")
    ).toBe(false);
  });

  it("requires every action and every module of the permission", () => {
    expect(
      hasListPermission(claims(), { view: "sales", update: "sales" }, "co_1")
    ).toBe(true);
    expect(
      hasListPermission(claims(), { view: ["sales", "parts"] }, "co_1")
    ).toBe(false);
    expect(
      hasListPermission(claims(), { view: "sales", delete: "sales" }, "co_1")
    ).toBe(false);
  });

  it("accepts a role-only permission for an employee", () => {
    expect(hasListPermission(claims(), { role: "employee" }, "co_1")).toBe(
      true
    );
  });
});

describe("splitIdsByStatus", () => {
  const isDraft = (status: string | null) => status === "Draft";

  it("keeps the ids whose status the action accepts, in request order", () => {
    expect(
      splitIdsByStatus(
        ["b", "a", "c"],
        [
          { id: "a", status: "Draft" },
          { id: "b", status: "Draft" },
          { id: "c", status: "Released" }
        ],
        isDraft
      )
    ).toEqual({ allowed: ["b", "a"], skipped: 1 });
  });

  it("skips an id the database did not return", () => {
    expect(
      splitIdsByStatus(
        ["a", "other-company"],
        [{ id: "a", status: "Draft" }],
        isDraft
      )
    ).toEqual({ allowed: ["a"], skipped: 1 });
  });
});

describe("parseAllMatching", () => {
  it("reads an object", () => {
    expect(parseAllMatching({ listKey: "jobs", search: "?q=x" })).toEqual({
      listKey: "jobs",
      search: "?q=x"
    });
  });

  it("reads the JSON text of a form field", () => {
    expect(
      parseAllMatching(JSON.stringify({ listKey: "parts", search: "" }))
    ).toEqual({ listKey: "parts", search: "" });
  });

  it("refuses a missing or broken value", () => {
    expect(parseAllMatching(null)).toBeNull();
    expect(parseAllMatching("not json")).toBeNull();
    expect(parseAllMatching({ listKey: "", search: "" })).toBeNull();
    expect(parseAllMatching({ listKey: "jobs" })).toBeNull();
  });
});

describe("the bulk actions' background path", () => {
  it("runs an action only on the lists it names", () => {
    expect(bulkActionServesList("jobs.release", "jobs")).toBe(true);
    expect(bulkActionServesList("jobs.release", "parts")).toBe(false);
    expect(bulkActionServesList("items.update", "services")).toBe(true);
    expect(bulkActionServesList("unknown", "jobs")).toBe(false);
    expect(getBulkActionMeta("toString")).toBeUndefined();
  });

  it("refuses Jobs Release and Batches Release past 2,000 rows", () => {
    expect(rowLimitRefusal(BULK_ACTIONS["jobs.release"], 2_000)).toBeNull();
    expect(rowLimitRefusal(BULK_ACTIONS["jobs.release"], 2_001)).toBe(
      "Release jobs runs on at most 2,000 rows. Filter the list to 2,000 rows or fewer."
    );
    expect(rowLimitRefusal(BULK_ACTIONS["batches.release"], 5_000)).toContain(
      "Release batches runs on at most 2,000 rows"
    );
  });

  it("puts no row limit on the other actions", () => {
    expect(rowLimitRefusal(BULK_ACTIONS["items.update"], 90_000)).toBeNull();
    expect(rowLimitRefusal(BULK_ACTIONS["jobs.delete"], 90_000)).toBeNull();
  });

  it("re-checks the plan feature of Edit Permissions in the job", () => {
    expect(getBulkActionMeta("users.permissions")?.feature).toBe("PERMISSIONS");
  });

  it("answers a form route's start with an error field on both outcomes", () => {
    expect(bulkStartFormResponse({ success: true, background: true })).toEqual({
      success: true,
      background: true,
      data: null,
      error: null
    });
    expect(bulkStartFormResponse({ success: false, message: "Busy" })).toEqual({
      success: false,
      message: "Busy",
      data: null,
      error: { message: "Busy" }
    });
  });
});

describe("fitsOneRequest", () => {
  it("keeps a selection inside one background step in the request", () => {
    expect(fitsOneRequest("jobs.release", 25)).toBe(true);
    expect(fitsOneRequest("jobs.release", 26)).toBe(false);
    expect(fitsOneRequest("batches.release", 10)).toBe(true);
    expect(fitsOneRequest("batches.release", 11)).toBe(false);
  });

  it("runs any selection in the request for an action with no step size", () => {
    expect(fitsOneRequest("jobs.delete", 1_000)).toBe(true);
  });
});
