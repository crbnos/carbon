// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  bulkActionGate,
  bulkStartFormResponse,
  holdsListGate,
  itemListType,
  itemsBulkUpdateGate,
  newTableExportId,
  parseAllMatching,
  parseTableExportId,
  refreshingClientFactory,
  resolveUserClient,
  rowLimitRefusal,
  splitIdsByStatus,
  type TableJobClaims,
  tableJobBusyMessage,
  tableJobBusyRefusal,
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
      "sales.salesOrders": {
        view: ["co_1"],
        create: [],
        update: ["co_1"],
        delete: []
      },
      "parts.parts": { view: ["co_2"], create: [], update: [], delete: [] }
    },
    ...overrides
  };
}

describe("holdsListGate", () => {
  it("accepts an employee with the list's page in the company", () => {
    expect(
      holdsListGate(claims(), { "sales.salesOrders": "View" }, "co_1")
    ).toBe(true);
  });

  it("refuses a page granted in another company only", () => {
    expect(holdsListGate(claims(), { "parts.parts": "View" }, "co_1")).toBe(
      false
    );
  });

  it("refuses a portal account even with the page", () => {
    expect(
      holdsListGate(
        claims({ role: "customer" }),
        { "sales.salesOrders": "View" },
        "co_1"
      )
    ).toBe(false);
  });

  it("requires every page of a gate and any gate of a list", () => {
    expect(
      holdsListGate(claims(), { "sales.salesOrders": "Edit" }, "co_1")
    ).toBe(true);
    expect(
      holdsListGate(
        claims(),
        { "sales.salesOrders": "View", "parts.parts": "View" },
        "co_1"
      )
    ).toBe(false);
    expect(
      holdsListGate(
        claims(),
        [{ "parts.parts": "View" }, { "sales.salesOrders": "View" }],
        "co_1"
      )
    ).toBe(true);
    expect(
      holdsListGate(claims(), { "sales.salesOrders": "Full" }, "co_1")
    ).toBe(false);
  });

  it("accepts an empty gate for an employee", () => {
    expect(holdsListGate(claims(), {}, "co_1")).toBe(true);
  });
});

describe("itemsBulkUpdateGate", () => {
  const toolsEditor = claims({
    permissions: {
      "parts.tools": {
        view: ["co_1"],
        create: [],
        update: ["co_1"],
        delete: []
      },
      "parts.parts": { view: ["co_1"], create: [], update: [], delete: [] }
    }
  });
  const list = (key: string, page: string) => ({
    key,
    gate: { [page]: "View" as const }
  });
  const update = {
    lists: ["parts", "tools", "services", "jobs"],
    gate: itemsBulkUpdateGate
  };

  function mayRun(key: string, page: string) {
    const gate = bulkActionGate(update, list(key, page));
    return gate !== null ? holdsListGate(toolsEditor, gate, "co_1") : false;
  }

  it("lets Tools Edit update the tools list", () => {
    expect(mayRun("tools", "parts.tools")).toBe(true);
  });

  it("refuses Tools Edit on the parts list, even with Parts View", () => {
    expect(mayRun("parts", "parts.parts")).toBe(false);
  });

  it("asks for Edit on the page of each list's own gate", () => {
    expect(bulkActionGate(update, list("parts", "parts.parts"))).toEqual({
      "parts.parts": "Edit"
    });
    expect(bulkActionGate(update, list("services", "parts.services"))).toEqual({
      "parts.services": "Edit"
    });
  });

  it("refuses a list it does not serve, or one that is not an items list", () => {
    expect(
      bulkActionGate(update, list("materials", "parts.materials"))
    ).toBeNull();
    expect(bulkActionGate(update, list("jobs", "production.jobs"))).toBeNull();
  });

  it("reads the item type from the list's page", () => {
    expect(itemListType(list("consumables", "parts.consumables"))).toBe(
      "Consumable"
    );
    expect(itemListType(list("jobs", "production.jobs"))).toBeNull();
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
  it("refuses an action with a row limit past it", () => {
    const release = { label: "Release jobs", maxRows: 2_000 };
    expect(rowLimitRefusal(release, 2_000)).toBeNull();
    expect(rowLimitRefusal(release, 2_001)).toBe(
      "Release jobs runs on at most 2,000 rows. Filter the list to 2,000 rows or fewer."
    );
  });

  it("puts no row limit on an action without one", () => {
    expect(rowLimitRefusal({ label: "Delete jobs" }, 90_000)).toBeNull();
  });

  it("answers a form route's start with an error field on both outcomes", () => {
    expect(bulkStartFormResponse({ success: true, background: true })).toEqual({
      success: true,
      background: true,
      data: null,
      error: null
    });
    const refusal = { code: "busy", kind: "bulk", minutes: 3 } as const;
    expect(
      bulkStartFormResponse({ success: false, message: "Busy", refusal })
    ).toEqual({
      success: false,
      message: "Busy",
      refusal,
      data: null,
      error: { message: "Busy" }
    });
  });
});

describe("tableJobBusyRefusal", () => {
  it("rounds the lock's time left up to whole minutes", () => {
    expect(tableJobBusyRefusal("export", 1741)).toEqual({
      code: "busy",
      kind: "export",
      minutes: 30
    });
    expect(tableJobBusyRefusal("bulk", 0)).toEqual({
      code: "busy",
      kind: "bulk",
      minutes: 0
    });
  });
});
