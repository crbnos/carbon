// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The service's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));

const { disposition, invoke, postNonconformance } = vi.hoisted(() => ({
  // The inspection engine's lot disposition.
  disposition: vi.fn(),
  // The server functions (`create`).
  invoke: vi.fn(),
  // The inventory write-off's posting.
  postNonconformance: vi.fn()
}));
vi.mock("@carbon/database/quality", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/database/quality")>()),
  dispositionInspection: disposition
}));
vi.mock("../app/modules/quality/quality.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../app/modules/quality/quality.service")
  >()),
  postNonconformance
}));
vi.mock("../app/modules/shared/shared.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../app/modules/shared/shared.service")
    >();
  // The postings the server functions package ran are the boundary; every
  // other posting runs its (mocked) body as before.
  const stubbed = new Set([
    "issue",
    "create",
    "batch-operations",
    "post-inventory-adjustment",
    "post-maintenance-event",
    "post-picking",
    "post-production-event",
    "recalculate",
    "reschedule",
    "trigger-rework"
  ]);
  return {
    ...actual,
    invokePosting: ((from: never, name: string, input: never, ...rest: never[]) =>
      stubbed.has(name)
        ? invoke(name, input)
        : (actual.invokePosting as (...args: unknown[]) => unknown)(
            from,
            name,
            input,
            ...rest
          )) as typeof actual.invokePosting,
    invokeCreate: (_from: unknown, input: unknown) => invoke("create", input)
  };
});

import { createServiceContext } from "@carbon/api/service-fn.server";

const {
  createIssue,
  rejectInspection,
  saveInspectionDocument,
  setIssueStatus,
  updateIssueField,
  updateIssueItemField,
  updateQualityDocumentField
} = await import("../app/modules/quality/quality.server");

const quality = {
  quality: {
    view: ["company-1"],
    create: ["company-1"],
    update: ["company-1"],
    delete: ["company-1"]
  }
};

/**
 * A Supabase client whose every query answers with the rows the test names
 * for its table. Any write is recorded; nothing else is checked.
 */
function client(rows: Record<string, unknown>) {
  const writes: string[] = [];
  const from = (table: string) => {
    const result = { data: rows[table] ?? null, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "limit", "order"]) {
      chain[method] = () => chain;
    }
    for (const method of ["insert", "update", "delete"]) {
      chain[method] = () => {
        writes.push(`${method}:${table}`);
        return chain;
      };
    }
    chain.single = chain.maybeSingle = () => Promise.resolve(result);
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
    return chain;
  };
  return { from, writes } as unknown as {
    from: typeof from;
    writes: string[];
  };
}

function contextWith(rows: Record<string, unknown> = {}) {
  const db = client(rows);
  const ctx = createServiceContext({
    actor: { type: "user", userId: "user-1", permissions: quality },
    company: { id: "company-1", groupId: "group-1" },
    caller: db as never,
    system: () => db as never,
    pg: () => ({}) as never,
    kv: () => ({}) as never
  });
  return { ctx, writes: db.writes };
}

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ data: { journalId: null }, error: null });
  postNonconformance.mockResolvedValue({ journalId: null });
});

describe("rejecting an inspection lot", () => {
  const writeOff = { itemId: "part-2", quantity: -5, locationId: "loc-1" };

  it("posts the lot's write-off, and with no issue asked for, stops there", async () => {
    disposition.mockResolvedValue({
      data: { id: "insp-1", status: "Failed", writeOff },
      error: null
    });
    const { ctx } = contextWith();

    const result = await rejectInspection(ctx, {
      id: "insp-1",
      createNcr: false
    });

    expect(result).toEqual({
      data: { id: "insp-1", issueId: null },
      error: null
    });
    // Only Receipt lots: a Job Operation lot is rejected from the shop floor.
    expect(disposition.mock.calls[0]![1]).toMatchObject({
      decision: "Reject",
      requireSource: "Receipt"
    });
    expect(postNonconformance).toHaveBeenCalledWith(expect.anything(), {
      documentType: "Inbound Inspection",
      documentId: "insp-1",
      description: "Inbound inspection lot rejected",
      movements: [{ ...writeOff, trackedEntityId: null }]
    });
  });

  it("posts nothing for a lot with no write-off (tracked, or not inventory)", async () => {
    disposition.mockResolvedValue({
      data: { id: "insp-1", status: "Failed", writeOff: null },
      error: null
    });
    const { ctx } = contextWith();

    const result = await rejectInspection(ctx, {
      id: "insp-1",
      createNcr: false
    });

    expect(result.error).toBeNull();
    expect(postNonconformance).not.toHaveBeenCalled();
  });

  // Closing the issue restores value on Use As Is on the assumption the
  // reject wrote it off, so an issue opened after a failed write-off would
  // count the lot twice.
  it("opens no issue when the write-off fails to post", async () => {
    disposition.mockResolvedValue({
      data: { id: "insp-1", status: "Failed", writeOff },
      error: null
    });
    postNonconformance.mockRejectedValue(new Error("no account"));
    const { ctx, writes } = contextWith();

    const result = await rejectInspection(ctx, { id: "insp-1" });

    expect(result.error?.message).toMatch(
      /^Lot rejected, but the inventory write-off failed to post/
    );
    expect(writes).toEqual([]);
  });

  it("is refused when the engine refuses the lot", async () => {
    disposition.mockResolvedValue({
      data: null,
      error: { message: "Only receipt lots" }
    });
    const { ctx } = contextWith();

    const result = await rejectInspection(ctx, { id: "insp-1" });

    expect(result.error).toMatchObject({
      category: "rule",
      message: "Failed to reject lot"
    });
    expect(postNonconformance).not.toHaveBeenCalled();
  });
});

describe("opening an issue", () => {
  const issue = {
    name: "Cracked housing",
    priority: "Medium",
    source: "Internal",
    locationId: "loc-1",
    nonConformanceTypeId: "type-1",
    openDate: "2026-10-16"
  } as const;

  it("refuses a record of another company, and creates nothing", async () => {
    // Every reference is found, except the location.
    const { ctx, writes } = contextWith({
      location: [],
      nonConformanceType: [{ id: "type-1" }]
    });

    const result = await createIssue(ctx, issue);

    expect(result.error).toMatchObject({ category: "notFound" });
    expect(writes).toEqual([]);
  });
});

describe("issue status", () => {
  it("cannot close an issue: closing posts its dispositions", async () => {
    const { ctx } = contextWith();
    const result = await setIssueStatus(ctx, {
      id: "nc-1",
      status: "Closed" as never
    });
    expect(result.error?.category).toBe("validation");
  });

  it("refuses to reopen an issue whose dispositions posted inventory", async () => {
    const { ctx, writes } = contextWith({
      nonConformance: { status: "Closed" },
      itemLedger: [{ id: "il-1" }]
    });

    const result = await setIssueStatus(ctx, {
      id: "nc-1",
      status: "Registered"
    });

    expect(result.error).toMatchObject({
      category: "rule",
      message:
        "This NCR posted inventory transactions and can't be reopened. Create a correcting entry instead."
    });
    expect(writes).toEqual([]);
  });
});

describe("a closed issue is locked", () => {
  const locked = "Cannot modify a closed issue. Reopen it first.";

  it("refuses a field change when any of the issues is closed", async () => {
    const { ctx, writes } = contextWith({
      nonConformance: [
        { id: "nc-1", status: "In Progress" },
        { id: "nc-2", status: "Closed" }
      ]
    });

    const result = await updateIssueField(ctx, {
      ids: ["nc-1", "nc-2"],
      field: "priority",
      value: "High"
    });

    expect(result.error).toMatchObject({ category: "rule", message: locked });
    expect(writes).toEqual([]);
  });

  it("refuses a disposition change on a closed issue", async () => {
    const { ctx, writes } = contextWith({
      nonConformanceItem: { nonConformance: { status: "Closed" } }
    });

    const result = await updateIssueItemField(ctx, {
      id: "nci-1",
      field: "disposition",
      value: "Scrap"
    });

    expect(result.error).toMatchObject({ category: "rule", message: locked });
    expect(writes).toEqual([]);
  });

  it("refuses a missing disposition row before any write", async () => {
    const { ctx, writes } = contextWith({ nonConformanceItem: null });

    const result = await updateIssueItemField(ctx, {
      id: "nci-missing",
      field: "disposition",
      value: "Scrap"
    });

    expect(result.error).toMatchObject({
      category: "notFound",
      message: "Issue item not found"
    });
    expect(writes).toEqual([]);
  });

  it("refuses a negative quantity", async () => {
    const { ctx } = contextWith();
    const result = await updateIssueItemField(ctx, {
      id: "nci-1",
      field: "quantity",
      value: -3,
      expectedQuantity: 0
    });
    expect(result.error?.message).toContain("Quantity must be zero or more");
  });
});

describe("quality document fields", () => {
  it("refuses a status that is not one", async () => {
    const { ctx, writes } = contextWith();
    const result = await updateQualityDocumentField(ctx, {
      ids: ["qd-1"],
      field: "status",
      value: "Published"
    });
    expect(result.error).toMatchObject({
      category: "validation",
      message: "Invalid status"
    });
    expect(writes).toEqual([]);
  });

  it("takes a single tag as the whole list", async () => {
    const { ctx, writes } = contextWith();
    const result = await updateQualityDocumentField(ctx, {
      ids: ["qd-1"],
      field: "tags",
      value: "ISO 9001"
    });
    expect(result.error).toBeNull();
    expect(writes).toEqual(["update:qualityDocument"]);
  });
});

describe("saving an inspection plan", () => {
  it("refuses legacy balloons sent without their anchors", async () => {
    const { ctx, writes } = contextWith();
    const result = await saveInspectionDocument(ctx, {
      inspectionDocumentId: "doc-1",
      balloons: {
        create: [
          {
            tempBalloonAnchorId: "anchor-1",
            label: "1",
            xCoordinate: 0.5,
            yCoordinate: 0.5
          }
        ],
        update: [],
        delete: []
      }
    });
    expect(result.error).toMatchObject({
      category: "validation",
      message: "Legacy balloons payload requires anchors"
    });
    expect(writes).toEqual([]);
  });
});
