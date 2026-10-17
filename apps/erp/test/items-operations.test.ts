// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The module graph reaches Lingui `msg` macros at load, which only run compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));
const { trigger } = vi.hoisted(() => ({ trigger: vi.fn() }));
vi.mock("@carbon/jobs", () => ({ trigger }));
vi.mock("@carbon/ee/approvals/document.server", () => ({
  openApprovalRequests: vi.fn(),
  cancelPendingApprovals: vi.fn(),
  decideApprovalRequest: vi.fn()
}));
vi.mock("../app/modules/items/items.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getItemSupersession: vi.fn(),
  updateChangeNoticeStatus: vi.fn(),
  updateItemMethodAndSourcing: vi.fn(),
  upsertItemPlanning: vi.fn(),
  upsertItemSupersession: vi.fn()
}));

import { openApprovalRequests } from "@carbon/ee/approvals/document.server";
import {
  addItemPredecessor,
  setChangeNoticeStatus,
  setItemActive,
  setItemPostingGroup,
  setItemSourcing,
  updateItemPlanning
} from "../app/modules/items/items.server";
import {
  getItemSupersession,
  updateChangeNoticeStatus,
  updateItemMethodAndSourcing,
  upsertItemPlanning,
  upsertItemSupersession
} from "../app/modules/items/items.service";
import { createServiceContext } from "@carbon/api/service-fn.server";

type Write = {
  table: string;
  op: "insert" | "update" | "delete";
  values?: unknown;
  filters: [string, unknown][];
};

/** A Supabase client that answers every read of a table with `reads[table]`
 *  and records each write. A table it has no answer for reads as null. */
function fakeClient(reads: Record<string, unknown> = {}) {
  const writes: Write[] = [];
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let write: Omit<Write, "table" | "filters"> | null = null;
      const answer = () => {
        if (write) {
          writes.push({ table, ...write, filters });
          return { data: null, error: null };
        }
        return { data: reads[table] ?? null, error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        insert: (values: unknown) => {
          write = { op: "insert", values };
          return chain;
        },
        update: (values: unknown) => {
          write = { op: "update", values };
          return chain;
        },
        delete: () => {
          write = { op: "delete" };
          return chain;
        },
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        in: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        order: () => chain,
        range: () => chain,
        maybeSingle: async () => answer(),
        single: async () => answer(),
        then: (resolve: (value: unknown) => unknown) => resolve(answer())
      };
      return chain;
    }
  };
  return { client: client as any, writes };
}

const unreachable = () => {
  throw new Error("must not be reached");
};

function contextFor(
  caller: unknown,
  { system = unreachable }: { system?: () => unknown } = {}
) {
  return createServiceContext({
    actor: {
      type: "user",
      userId: "user-1",
      permissions: {
        parts: {
          view: ["company-1"],
          create: ["company-1"],
          update: ["company-1"],
          delete: ["company-1"]
        }
      }
    },
    company: { id: "company-1", groupId: "group-1" },
    caller: caller as any,
    system: system as any,
    pg: () => ({}) as any,
    kv: unreachable
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  trigger.mockResolvedValue(undefined);
});

describe("setItemPostingGroup", () => {
  it("updates the items that have a cost row and creates one for each that has none", async () => {
    const { client, writes } = fakeClient({ itemCost: [{ itemId: "i1" }] });

    const result = await setItemPostingGroup(contextFor(client), {
      ids: ["i1", "i2", "i3"],
      itemPostingGroupId: "group-a"
    });

    expect(result.error).toBeNull();
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      op: "update",
      values: { itemPostingGroupId: "group-a" },
      filters: [
        ["itemId", ["i1"]],
        ["companyId", "company-1"]
      ]
    });
    expect(writes[1].op).toBe("insert");
    expect(writes[1].values).toMatchObject([
      { itemId: "i2", itemPostingGroupId: "group-a", companyId: "company-1" },
      { itemId: "i3", itemPostingGroupId: "group-a", companyId: "company-1" }
    ]);
  });
});

describe("setItemSourcing", () => {
  it("refuses a call that sets none, or more than one, of the three fields", async () => {
    const inputs: Parameters<typeof setItemSourcing>[1][] = [
      { ids: ["i1"] },
      { ids: ["i1"], replenishmentSystem: "Make", sourcingType: "Drop Ship" }
    ];
    for (const input of inputs) {
      const result = await setItemSourcing(contextFor(unreachable), input);
      expect(result.error).toMatchObject({ category: "validation" });
    }
    expect(updateItemMethodAndSourcing).not.toHaveBeenCalled();
  });
});

describe("setItemActive", () => {
  it("refuses to activate an item its unreleased change notice created, and writes nothing", async () => {
    const { client, writes } = fakeClient();
    const system = fakeClient({
      item: [
        { id: "i1", readableIdWithRevision: "P1.A", changeOrderId: "co-1" }
      ],
      changeOrder: [{ id: "co-1", changeOrderId: "ECO-1", status: "Draft" }]
    });

    const result = await setItemActive(
      contextFor(client, { system: () => system.client }),
      { ids: ["i1"], active: true }
    );

    expect(result.error).toMatchObject({ category: "rule" });
    expect(result.error?.message).toContain("ECO-1");
    expect(writes).toHaveLength(0);
  });

  it("deactivates without checking change notices", async () => {
    const { client, writes } = fakeClient();

    const result = await setItemActive(contextFor(client), {
      ids: ["i1"],
      active: false
    });

    expect(result.error).toBeNull();
    expect(writes).toMatchObject([{ op: "update", values: { active: false } }]);
  });
});

describe("setChangeNoticeStatus", () => {
  const gated = {
    id: "co-1",
    fromStatus: "Engineering Complete",
    status: "Implementation"
  } as const;

  it("opens no approval request for a notice that moved on", async () => {
    const { client } = fakeClient({ changeOrder: { status: "Implementation" } });

    const result = await setChangeNoticeStatus(contextFor(client), gated);

    expect(result.error).toMatchObject({ category: "conflict" });
    expect(openApprovalRequests).not.toHaveBeenCalled();
  });

  it("submits for approval instead of moving when a rule gates the step", async () => {
    const { client } = fakeClient({
      changeOrder: { status: "Engineering Complete" }
    });
    vi.mocked(openApprovalRequests).mockResolvedValue({
      status: "opened",
      requested: ["co-1"],
      alreadyPending: [],
      approverIds: ["approver-1"]
    });

    const result = await setChangeNoticeStatus(
      contextFor(client, { system: () => ({}) }),
      gated
    );

    expect(result.data).toMatchObject({ approvalRequested: true });
    expect(updateChangeNoticeStatus).not.toHaveBeenCalled();
  });

  it("refuses a second request while one is pending", async () => {
    const { client } = fakeClient({
      changeOrder: { status: "Engineering Complete" }
    });
    vi.mocked(openApprovalRequests).mockResolvedValue({
      status: "opened",
      requested: [],
      alreadyPending: ["co-1"],
      approverIds: []
    });

    const result = await setChangeNoticeStatus(
      contextFor(client, { system: () => ({}) }),
      gated
    );

    expect(result.error).toMatchObject({ category: "conflict" });
    expect(updateChangeNoticeStatus).not.toHaveBeenCalled();
  });
});

describe("addItemPredecessor", () => {
  const predecessor = {
    itemId: "new-part",
    supersessionMode: "Consume First",
    conversionFactor: 1
  } as const;

  it("refuses a part as its own predecessor before reading anything", async () => {
    const result = await addItemPredecessor(contextFor(unreachable), {
      ...predecessor,
      predecessorItemId: "new-part"
    });

    expect(result.error).toMatchObject({ category: "rule" });
  });

  it("refuses a predecessor that already has another successor", async () => {
    const { client } = fakeClient({
      item: { id: "old-part", readableIdWithRevision: "P1" }
    });
    vi.mocked(getItemSupersession).mockResolvedValue({
      data: {
        successorItemId: "other-part",
        successor: { readableIdWithRevision: "P9" }
      },
      error: null
    } as any);

    const result = await addItemPredecessor(contextFor(client), {
      ...predecessor,
      predecessorItemId: "old-part"
    });

    expect(result.error).toMatchObject({ category: "rule" });
    expect(result.error?.message).toContain("P1 already has a successor (P9)");
    expect(upsertItemSupersession).not.toHaveBeenCalled();
  });
});

describe("updateItemPlanning", () => {
  it("refuses a responsible employee who is not an active employee of the company", async () => {
    const { client } = fakeClient({ employee: null });

    const result = await updateItemPlanning(contextFor(client), {
      itemId: "i1",
      locationId: "loc-1",
      reorderingPolicy: "Manual Reorder",
      responsibleEmployee: "someone-else"
    });

    expect(result.error).toMatchObject({ category: "rule" });
    expect(upsertItemPlanning).not.toHaveBeenCalled();
  });
});
