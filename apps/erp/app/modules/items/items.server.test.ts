import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

// items.server's only runtime dependency; stubbed so the pure verdict logic
// can be tested without dragging in the app's full module graph.
vi.mock("~/modules/settings", () => ({ getCompanySettings: vi.fn() }));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: vi.fn()
}));
vi.mock("@carbon/auth/users.server", () => ({
  getUserClaims: vi.fn()
}));

// items.server pulls the items module graph (via ~/modules/items), which
// transitively loads @carbon/glossary — whose module-load-time Lingui `msg`
// macro isn't transformed under plain vitest and throws. Stub it; the verdict
// logic under test needs none of it.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const {
  applyChangeNotice,
  createAuthorizedChangeNoticeImpactTask,
  deriveChangeNoticeImpactSourceAccess,
  getAuthorizedChangeNoticeImpactHistory,
  getChangeNoticeImpactMutationAccess,
  getChangeNoticeImpactReadAccess,
  getChangeNoticeImpactSourceAccess,
  requireChangeNoticeActionTaskEditable,
  reconcileAuthorizedChangeNoticeImpactProvenance,
  writeAuthorizedChangeNoticeImpactDecisions,
  getLockVerdict,
  LOCKED_REVISION_MESSAGE,
  getUnreleasedChangeOrderItems,
  getUnreleasedChangeOrderIssue
} = await import("./items.server");
const { getUserClaims } = await import("@carbon/auth/users.server");
const { getDatabaseClient } = await import("~/services/database.server");
const { canEditChangeNoticeActionTaskFields } = await import("./items.models");

afterEach(() => {
  vi.mocked(getUserClaims).mockReset();
  vi.mocked(getDatabaseClient).mockReset();
});

const claims = (permissions: Record<string, { view: string[] }>) => ({
  role: "employee",
  permissions: Object.fromEntries(
    Object.entries(permissions).map(([name, permission]) => [
      name,
      { view: permission.view, create: [], update: [], delete: [] }
    ])
  )
});

function fakeImpactPermissionClient(
  companies: Partial<Record<string, string[]>> = {},
  rpcError: { message: string } | null = null,
  memberships: { userId: string; companyId: string }[] = []
): SupabaseClient<Database> {
  return {
    rpc: vi.fn(async (_name: string, args: { permission: string }) => ({
      data: rpcError ? null : (companies[args.permission] ?? []),
      error: rpcError
    })),
    // The `userToCompany` membership lookup the assignee guard walks.
    from: vi.fn(() => {
      const filters: Record<string, string> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => ({
          data:
            memberships.find(
              (membership) =>
                membership.userId === filters.userId &&
                membership.companyId === filters.companyId
            ) ?? null,
          error: null
        })
      };
      return builder;
    })
  } as unknown as SupabaseClient<Database>;
}

describe("Change Notice Impact apply transition", () => {
  it("rejects a Done transition unless the submitted source is Implementation", async () => {
    const result = await applyChangeNotice(null as never, null as never, {
      changeNoticeId: "notice-1",
      userId: "user-1",
      companyId: "company-1",
      fromStatus: "Draft"
    });

    expect(result).toEqual({
      data: null,
      error: { message: "Change notice must be at Implementation to apply" }
    });
  });
});

describe("Change Notice Impact source access", () => {
  it("rejects an invalid bulk request before resolving mutation access", async () => {
    const result = await writeAuthorizedChangeNoticeImpactDecisions({
      client: fakeImpactPermissionClient(),
      userId: "user-1",
      companyId,
      decision: { changeNoticeId: "notice-1", targets: [] }
    });

    expect(result).toEqual({
      data: null,
      error: { message: "At least one Impact target is required" }
    });
    expect(getUserClaims).not.toHaveBeenCalled();
  });

  it("requires both Change Notice view and Impact update gates for bulk writes", async () => {
    const result = await writeAuthorizedChangeNoticeImpactDecisions({
      client: fakeImpactPermissionClient({
        parts_view: [],
        parts_update: [companyId],
        purchasing_view: [companyId],
        production_view: []
      }),
      userId: "user-1",
      companyId,
      decision: {
        changeNoticeId: "notice-1",
        targets: [
          {
            targetType: "purchaseOrderLine",
            targetId: "pol-1",
            decisionStatus: "Action required",
            rationale: "Supplier follow-up remains open."
          }
        ]
      }
    });

    expect(result).toEqual({
      data: null,
      error: {
        message: "Change Notice Impact requires Change Notice view permission."
      }
    });
  });

  it("requires the source-domain view permission independently", () => {
    expect(
      deriveChangeNoticeImpactSourceAccess(
        {
          purchasing: { view: [companyId] },
          production: { view: [] }
        },
        companyId
      )
    ).toEqual({
      purchaseOrderLine: true,
      job: false,
      jobMaterial: false
    });
  });

  it("resolves purchasing permission as Present access", async () => {
    vi.mocked(getUserClaims).mockResolvedValue(
      claims({ purchasing: { view: [companyId] }, production: { view: [] } })
    );
    await expect(
      getChangeNoticeImpactSourceAccess({ userId: "user-1", companyId })
    ).resolves.toEqual({
      status: "resolved",
      access: {
        purchaseOrderLine: true,
        job: false,
        jobMaterial: false
      }
    });
  });

  it("keeps missing purchasing permission distinct from access failure", async () => {
    vi.mocked(getUserClaims).mockResolvedValue(
      claims({ purchasing: { view: [] }, production: { view: [companyId] } })
    );
    await expect(
      getChangeNoticeImpactSourceAccess({ userId: "user-1", companyId })
    ).resolves.toEqual({
      status: "resolved",
      access: {
        purchaseOrderLine: false,
        job: true,
        jobMaterial: true
      }
    });
  });

  it("resolves production permission for both production target kinds", async () => {
    vi.mocked(getUserClaims).mockResolvedValue(
      claims({ purchasing: { view: [] }, production: { view: [companyId] } })
    );
    const result = await getChangeNoticeImpactSourceAccess({
      userId: "user-1",
      companyId
    });
    expect(result).toEqual({
      status: "resolved",
      access: {
        purchaseOrderLine: false,
        job: true,
        jobMaterial: true
      }
    });
  });

  it("keeps missing production permission distinct from access failure", async () => {
    vi.mocked(getUserClaims).mockResolvedValue(
      claims({ purchasing: { view: [companyId] }, production: { view: [] } })
    );
    await expect(
      getChangeNoticeImpactSourceAccess({ userId: "user-1", companyId })
    ).resolves.toEqual({
      status: "resolved",
      access: {
        purchaseOrderLine: true,
        job: false,
        jobMaterial: false
      }
    });
  });

  it("resolves read access through the active credential-bound permission RPCs", async () => {
    const client = fakeImpactPermissionClient({
      parts_view: [companyId],
      purchasing_view: [companyId],
      production_view: []
    });

    await expect(
      getChangeNoticeImpactReadAccess({ client, userId: "user-1", companyId })
    ).resolves.toEqual({
      status: "resolved",
      canViewChangeNotice: true,
      sourceAccess: {
        purchaseOrderLine: true,
        job: false,
        jobMaterial: false
      }
    });

    const rpcPermissions = vi
      .mocked(client.rpc)
      .mock.calls.map(
        ([, args]) => (args as unknown as { permission: string }).permission
      );
    expect(rpcPermissions).toHaveLength(3);
    expect(rpcPermissions).toEqual(
      expect.arrayContaining([
        "parts_view",
        "purchasing_view",
        "production_view"
      ])
    );
    expect(getUserClaims).not.toHaveBeenCalled();
  });

  it("fails closed when read access resolution fails", async () => {
    await expect(
      getChangeNoticeImpactReadAccess({
        client: fakeImpactPermissionClient(
          {},
          { message: "permission RPC failed" }
        ),
        userId: "user-1",
        companyId
      })
    ).resolves.toEqual({
      status: "failed",
      errorMessage: "Impact source access could not be established."
    });
  });

  it("does not open the history reader without Change Notice view access", async () => {
    const result = await getAuthorizedChangeNoticeImpactHistory({
      client: fakeImpactPermissionClient({
        parts_view: [],
        purchasing_view: [companyId],
        production_view: [companyId]
      }),
      userId: "user-1",
      companyId,
      changeNoticeId: "notice-1",
      decisionId: "decision-1"
    });

    expect(result).toEqual({
      data: null,
      error: {
        kind: "not-found",
        message: "Impact decision was not found."
      }
    });
  });

  it("keeps Change Notice view and Impact update permissions independent", async () => {
    await expect(
      getChangeNoticeImpactMutationAccess({
        client: fakeImpactPermissionClient({
          parts_view: [],
          parts_update: [companyId],
          purchasing_view: [companyId],
          production_view: []
        }),
        userId: "user-1",
        companyId
      })
    ).resolves.toMatchObject({
      status: "resolved",
      canViewChangeNotice: false,
      canUpdateItems: true,
      sourceAccess: {
        purchaseOrderLine: true,
        job: false,
        jobMaterial: false
      }
    });
  });

  it("uses only the active client's target-specific source permission RPC", async () => {
    const client = fakeImpactPermissionClient({
      parts_view: [companyId],
      parts_update: [companyId],
      purchasing_view: [companyId]
    });

    await expect(
      getChangeNoticeImpactMutationAccess({
        client,
        userId: "user-1",
        companyId,
        targetTypes: ["purchaseOrderLine"]
      })
    ).resolves.toEqual({
      status: "resolved",
      canViewChangeNotice: true,
      canUpdateItems: true,
      sourceAccess: {
        purchaseOrderLine: true,
        job: false,
        jobMaterial: false
      }
    });

    const rpcPermissions = vi
      .mocked(client.rpc)
      .mock.calls.map(
        ([, args]) => (args as unknown as { permission: string }).permission
      );
    expect(rpcPermissions).toHaveLength(3);
    expect(rpcPermissions).toEqual(
      expect.arrayContaining(["parts_view", "parts_update", "purchasing_view"])
    );
  });

  it("fails closed when the active client's permission RPC fails", async () => {
    await expect(
      getChangeNoticeImpactMutationAccess({
        client: fakeImpactPermissionClient(
          {},
          { message: "permission RPC failed" }
        ),
        userId: "user-1",
        companyId,
        targetTypes: ["job"]
      })
    ).resolves.toEqual({
      status: "failed",
      errorMessage: "Impact mutation access could not be established."
    });
  });

  it("denies a job task when the active credential lacks production_view before opening Kysely", async () => {
    vi.mocked(getUserClaims).mockResolvedValue(
      claims({ production: { view: [companyId] } })
    );
    const client = fakeImpactPermissionClient({
      parts_view: [companyId],
      parts_update: [companyId],
      production_view: []
    });

    const result = await createAuthorizedChangeNoticeImpactTask({
      client,
      userId: "user-1",
      companyId,
      task: {
        changeNoticeId: "notice-1",
        targetType: "job",
        targetId: "job-1",
        decision: {
          decisionId: "decision-1",
          targetType: "job",
          targetId: "job-1"
        },
        task: { name: "Production follow-up", assignee: "outsider-1" }
      }
    });

    expect(result).toEqual({
      data: null,
      error: { message: "Impact source access is restricted for this target." }
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "get_companies_with_employee_permission",
      { permission: "production_view" }
    );
    expect(client.from).not.toHaveBeenCalled();
    expect(getUserClaims).not.toHaveBeenCalled();
    expect(getDatabaseClient).not.toHaveBeenCalled();
  });

  it("rejects an Impact task assignee who is not a member of the active company", async () => {
    // The `user` table is global, so an API/MCP caller can name any id. The
    // browser picker only offers members; the boundary has to hold without it.
    const client = fakeImpactPermissionClient(
      {
        parts_view: [companyId],
        parts_update: [companyId],
        production_view: [companyId]
      },
      null,
      []
    );

    const result = await createAuthorizedChangeNoticeImpactTask({
      client,
      userId: "user-1",
      companyId,
      task: {
        changeNoticeId: "notice-1",
        targetType: "job",
        targetId: "job-1",
        decision: {
          decisionId: "decision-1",
          targetType: "job",
          targetId: "job-1"
        },
        task: { name: "Production follow-up", assignee: "outsider-1" }
      }
    });

    expect(result).toEqual({
      data: null,
      error: { message: "The task assignee is not a member of this company." }
    });
    expect(client.from).toHaveBeenCalledWith("userToCompany");
    // Source authorization runs before the membership probe; the outsider is
    // only revealed after the caller is allowed to assess this target.
    expect(client.rpc).toHaveBeenCalledWith(
      "get_companies_with_employee_permission",
      { permission: "production_view" }
    );
    expect(getUserClaims).not.toHaveBeenCalled();
    expect(getDatabaseClient).not.toHaveBeenCalled();
  });

  it("lets a company-member assignee reach the existing Impact task writer", async () => {
    const client = fakeImpactPermissionClient(
      {
        parts_view: [companyId],
        parts_update: [companyId],
        production_view: [companyId]
      },
      null,
      [{ userId: "member-1", companyId }]
    );
    const downstreamResult = {
      data: {
        decisionId: "decision-1",
        actionTaskId: "task-1",
        decisionCreated: false,
        taskOrigin: "Impact follow-up" as const,
        status: "Pending" as const
      },
      error: null
    };
    vi.mocked(getDatabaseClient).mockReturnValue({
      transaction: () => ({
        execute: vi.fn().mockResolvedValue(downstreamResult)
      })
    } as never);

    const result = await createAuthorizedChangeNoticeImpactTask({
      client,
      userId: "user-1",
      companyId,
      task: {
        changeNoticeId: "notice-1",
        targetType: "job",
        targetId: "job-1",
        decision: {
          decisionId: "decision-1",
          targetType: "job",
          targetId: "job-1"
        },
        task: { name: "Production follow-up", assignee: "member-1" }
      }
    });

    expect(result).toEqual(downstreamResult);
    expect(client.from).toHaveBeenCalledWith("userToCompany");
    expect(getDatabaseClient).toHaveBeenCalledTimes(1);
  });

  it("does not look up membership when the assignee is null or cleared", async () => {
    for (const assignee of [null, "   "] as const) {
      const client = fakeImpactPermissionClient({
        parts_view: [],
        parts_update: [companyId],
        production_view: []
      });

      await createAuthorizedChangeNoticeImpactTask({
        client,
        userId: "user-1",
        companyId,
        task: {
          changeNoticeId: "notice-1",
          targetType: "job",
          targetId: "job-1",
          decision: {
            decisionId: "decision-1",
            targetType: "job",
            targetId: "job-1"
          },
          task: { name: "Production follow-up", assignee }
        }
      });

      expect(client.from).not.toHaveBeenCalled();
    }
  });

  it("returns explicit failed access instead of Restricted when claims resolution fails", async () => {
    vi.mocked(getUserClaims).mockRejectedValue(new Error("claims unavailable"));
    const result = await getChangeNoticeImpactSourceAccess({
      userId: "user-1",
      companyId
    });
    expect(result).toEqual({
      status: "failed",
      errorMessage: "Impact source access could not be established."
    });
    expect(result).not.toEqual(
      expect.objectContaining({
        access: {
          purchaseOrderLine: false,
          job: false,
          jobMaterial: false
        }
      })
    );
  });

  it("fails authorized reconciliation before opening the database when permission RPC fails", async () => {
    await expect(
      reconcileAuthorizedChangeNoticeImpactProvenance({
        client: fakeImpactPermissionClient(
          {},
          { message: "permission RPC failed" }
        ),
        userId: "user-1",
        companyId,
        changeNoticeId: "notice-1"
      })
    ).resolves.toEqual({
      data: null,
      error: { message: "Impact mutation access could not be established." }
    });
  });
});

describe("getLockVerdict", () => {
  it("allows edits when the revision is not locked", () => {
    for (const releaseControl of ["off", "warn", "enforce"] as const) {
      expect(getLockVerdict({ isLocked: false, releaseControl })).toEqual({
        ok: true,
        warn: false
      });
    }
  });

  it("allows edits on a locked revision when release control is off", () => {
    expect(getLockVerdict({ isLocked: true, releaseControl: "off" })).toEqual({
      ok: true,
      warn: false
    });
  });

  it("allows edits with a warning on a locked revision when release control is warn", () => {
    expect(getLockVerdict({ isLocked: true, releaseControl: "warn" })).toEqual({
      ok: true,
      warn: true,
      message: LOCKED_REVISION_MESSAGE
    });
  });

  it("blocks edits on a locked revision when release control is enforce", () => {
    expect(
      getLockVerdict({ isLocked: true, releaseControl: "enforce" })
    ).toEqual({
      ok: false,
      warn: false,
      message: LOCKED_REVISION_MESSAGE
    });
  });
});

type Row = Record<string, unknown> | null;

// PostgREST's `max_rows`, mirrored so a read that asks for too much silently
// comes back short — exactly the failure the batching exists to avoid.
const MAX_ROWS = 1000;

// Stands in for the two list reads the batch guard makes. Supabase builders are
// thenables, so the chain resolves on await without a terminal method. Each
// read is answered from the ids its own `in` filter carries and truncated at
// MAX_ROWS, so a guard that stopped batching visibly drops rows.
function fakeListClient(
  rows: { item?: Row[]; changeOrder?: Row[] },
  errors: { item?: boolean; changeOrder?: boolean } = {}
) {
  return {
    from(table: string) {
      const failed = errors[table as keyof typeof errors] === true;
      const all = rows[table as keyof typeof rows] ?? [];
      let requested: string[] | null = null;
      const builder = {
        select: () => builder,
        in: (_column: string, ids: string[]) => {
          requested = ids;
          return builder;
        },
        eq: () => builder,
        then: (
          resolve: (value: {
            data: Row[] | null;
            error: { message: string } | null;
          }) => unknown
        ) =>
          resolve({
            data: failed
              ? null
              : all
                  .filter(
                    (row) => !requested || requested.includes(row?.id as string)
                  )
                  .slice(0, MAX_ROWS),
            error: failed ? { message: `failed to read ${table}` } : null
          })
      };
      return builder;
    }
  } as never;
}

const companyId = "company_1";
const args = { itemId: "item_1", companyId };

function fakeEditableActionClient({
  task,
  changeNotice,
  taskError = null,
  changeNoticeError = null
}: {
  task: {
    id: string;
    companyId: string;
    changeOrderId: string;
    taskOrigin: string;
  } | null;
  changeNotice: {
    id: string;
    companyId: string;
    status: string;
  } | null;
  taskError?: { message: string } | null;
  changeNoticeError?: { message: string } | null;
}) {
  return {
    from(table: string) {
      const filters = new Map<string, string>();
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters.set(column, value);
          return builder;
        },
        maybeSingle: async () => {
          if (table === "changeOrderActionTask") {
            const matches =
              task &&
              task.id === filters.get("id") &&
              task.changeOrderId === filters.get("changeOrderId") &&
              task.companyId === filters.get("companyId");
            return {
              data: matches ? task : null,
              error: taskError
            };
          }

          const matches =
            changeNotice &&
            changeNotice.id === filters.get("id") &&
            changeNotice.companyId === filters.get("companyId");
          return {
            data: matches
              ? {
                  id: changeNotice.id,
                  companyId: changeNotice.companyId,
                  status: changeNotice.status
                }
              : null,
            error: changeNoticeError
          };
        }
      };
      return builder;
    }
  } as never;
}

describe("canEditChangeNoticeActionTaskFields", () => {
  it("locks ordinary task fields after Done and Cancelled", () => {
    for (const status of ["Done", "Cancelled"]) {
      expect(
        canEditChangeNoticeActionTaskFields(status, "Template-owned")
      ).toBe(false);
      expect(canEditChangeNoticeActionTaskFields(status, "Manual")).toBe(false);
      expect(
        canEditChangeNoticeActionTaskFields(status, "Impact follow-up")
      ).toBe(true);
    }
  });

  it("allows every known origin before terminal workflow statuses", () => {
    for (const status of [
      "Draft",
      "Start",
      "Engineering Complete",
      "Implementation"
    ]) {
      for (const origin of ["Template-owned", "Manual", "Impact follow-up"]) {
        expect(canEditChangeNoticeActionTaskFields(status, origin)).toBe(true);
      }
    }
  });

  it("fails closed for unknown persisted values", () => {
    expect(canEditChangeNoticeActionTaskFields("Done", "unknown")).toBe(false);
    expect(canEditChangeNoticeActionTaskFields("unknown", "Manual")).toBe(
      false
    );
  });
});

describe("requireChangeNoticeActionTaskEditable", () => {
  const task = {
    id: "task-1",
    companyId,
    changeOrderId: "notice-1",
    taskOrigin: "Manual"
  };
  const changeNotice = { id: "notice-1", companyId, status: "Done" };

  it("uses the persisted origin and parent status for the terminal lock", async () => {
    await expect(
      requireChangeNoticeActionTaskEditable(
        fakeEditableActionClient({ task, changeNotice }),
        { actionTaskId: task.id, changeNoticeId: task.changeOrderId, companyId }
      )
    ).resolves.toEqual({
      error: { message: "This action task is read-only" },
      data: null
    });

    await expect(
      requireChangeNoticeActionTaskEditable(
        fakeEditableActionClient({
          task: { ...task, taskOrigin: "Impact follow-up" },
          changeNotice
        }),
        { actionTaskId: task.id, changeNoticeId: task.changeOrderId, companyId }
      )
    ).resolves.toBeNull();
  });

  it("allows ordinary task edits while the Change Notice is open", async () => {
    await expect(
      requireChangeNoticeActionTaskEditable(
        fakeEditableActionClient({
          task,
          changeNotice: { ...changeNotice, status: "Implementation" }
        }),
        { actionTaskId: task.id, changeNoticeId: task.changeOrderId, companyId }
      )
    ).resolves.toBeNull();
  });

  it("fails closed when the task or parent is not owned by the request scope", async () => {
    await expect(
      requireChangeNoticeActionTaskEditable(
        fakeEditableActionClient({ task, changeNotice }),
        { actionTaskId: task.id, changeNoticeId: "notice-2", companyId }
      )
    ).resolves.toEqual({
      error: { message: "Could not find editable action task" },
      data: null
    });

    await expect(
      requireChangeNoticeActionTaskEditable(
        fakeEditableActionClient({ task, changeNotice }),
        {
          actionTaskId: task.id,
          changeNoticeId: task.changeOrderId,
          companyId: "company-2"
        }
      )
    ).resolves.toEqual({
      error: { message: "Could not find editable action task" },
      data: null
    });
  });

  it("fails closed when either scoped read fails", async () => {
    await expect(
      requireChangeNoticeActionTaskEditable(
        fakeEditableActionClient({
          task,
          changeNotice,
          taskError: { message: "task read failed" }
        }),
        { actionTaskId: task.id, changeNoticeId: task.changeOrderId, companyId }
      )
    ).resolves.toEqual({
      error: { message: "Could not find editable action task" },
      data: null
    });
  });
});

describe("getUnreleasedChangeOrderItems", () => {
  it("reads nothing when given no ids", async () => {
    const client = fakeListClient({ item: [{ id: "item_1" }] });

    expect(
      await getUnreleasedChangeOrderItems(client, { itemIds: [], companyId })
    ).toEqual({ data: [], error: null });
  });

  it("passes items that no change order owns", async () => {
    const client = fakeListClient({
      item: [
        {
          id: "item_1",
          readableIdWithRevision: "P000001",
          changeOrderId: null
        }
      ]
    });

    expect(
      await getUnreleasedChangeOrderItems(client, {
        itemIds: ["item_1"],
        companyId
      })
    ).toEqual({ data: [], error: null });
  });

  // Release leaves changeOrderId in place as a provenance link, so the column
  // alone cannot answer "is this still a draft" — the status decides.
  it("returns only the items whose change order is unreleased", async () => {
    const client = fakeListClient({
      item: [
        {
          id: "item_1",
          readableIdWithRevision: "P000001.A",
          changeOrderId: "co_open"
        },
        {
          id: "item_2",
          readableIdWithRevision: "P000002.B",
          changeOrderId: "co_done"
        }
      ],
      changeOrder: [
        {
          id: "co_open",
          changeOrderId: "ECO-000001",
          status: "Implementation"
        },
        { id: "co_done", changeOrderId: "ECO-000002", status: "Done" }
      ]
    });

    expect(
      await getUnreleasedChangeOrderItems(client, {
        itemIds: ["item_1", "item_2"],
        companyId
      })
    ).toEqual({
      data: [
        {
          itemId: "item_1",
          itemName: "P000001.A",
          changeOrderReadableId: "ECO-000001"
        }
      ],
      error: null
    });
  });

  // PostgREST caps a response at 1000 rows, so the guard walks the ids in
  // batches. Without that, an item past the cap reads as unowned and activates.
  it("finds an offending item past the response cap", async () => {
    const itemIds = Array.from({ length: 1200 }, (_, i) => `item_${i}`);
    const client = fakeListClient({
      item: itemIds.map((id) => ({
        id,
        readableIdWithRevision: id,
        changeOrderId: id === "item_1100" ? "co_open" : null
      })),
      changeOrder: [
        { id: "co_open", changeOrderId: "ECO-000001", status: "Draft" }
      ]
    });

    expect(
      await getUnreleasedChangeOrderItems(client, { itemIds, companyId })
    ).toEqual({
      data: [
        {
          itemId: "item_1100",
          itemName: "item_1100",
          changeOrderReadableId: "ECO-000001"
        }
      ],
      error: null
    });
  });

  // A read that did not answer says nothing about the items, so callers block
  // rather than wave the write through on a database blip.
  it("reports an error when the item read fails", async () => {
    const client = fakeListClient({}, { item: true });

    expect(
      await getUnreleasedChangeOrderItems(client, {
        itemIds: ["item_1"],
        companyId
      })
    ).toEqual({
      data: [],
      error: "These items could not be checked against their change orders."
    });
  });

  it("reports an error when the change order read fails", async () => {
    const client = fakeListClient(
      {
        item: [
          {
            id: "item_1",
            readableIdWithRevision: "P000001.A",
            changeOrderId: "co_open"
          }
        ]
      },
      { changeOrder: true }
    );

    expect(
      await getUnreleasedChangeOrderItems(client, {
        itemIds: ["item_1"],
        companyId
      })
    ).toEqual({
      data: [],
      error: "These items could not be checked against their change orders."
    });
  });
});

describe("getUnreleasedChangeOrderIssue", () => {
  it("names the change order still holding the item", async () => {
    const client = fakeListClient({
      item: [
        {
          id: "item_1",
          readableIdWithRevision: "P000001.A",
          changeOrderId: "co_open"
        }
      ],
      changeOrder: [
        { id: "co_open", changeOrderId: "ECO-000001", status: "Draft" }
      ]
    });

    expect(await getUnreleasedChangeOrderIssue(client, args)).toBe(
      "P000001.A was created by change order ECO-000001, which has not been released yet."
    );
  });

  // Narrow on purpose — the guard does not judge `active`. Inactive items are
  // allowed onto these documents today, and that is a separate decision.
  it("passes an inactive item that no change order owns", async () => {
    const client = fakeListClient({
      item: [
        { id: "item_1", readableIdWithRevision: "P000001", changeOrderId: null }
      ]
    });

    expect(await getUnreleasedChangeOrderIssue(client, args)).toBeNull();
  });

  it("blocks when the check could not be made", async () => {
    const client = fakeListClient({}, { item: true });

    expect(await getUnreleasedChangeOrderIssue(client, args)).toBe(
      "These items could not be checked against their change orders."
    );
  });
});
