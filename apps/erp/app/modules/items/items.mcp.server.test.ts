import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./items.service", () => ({
  deleteChangeNoticeAction: vi.fn(),
  deleteChangeNoticeRequiredAction: vi.fn(),
  updateChangeNoticeActionAssignee: vi.fn(),
  updateChangeNoticeActionDueDate: vi.fn(),
  updateChangeNoticeActionNotes: vi.fn(),
  updateChangeNoticeActionStatus: vi.fn(),
  upsertChangeNoticeRequiredAction: vi.fn()
}));

vi.mock("./items.server", () => ({
  createAuthorizedChangeNoticeImpactTask: vi.fn(),
  designateAuthorizedChangeNoticeImpactTask: vi.fn(),
  linkAuthorizedChangeNoticeImpactTask: vi.fn(),
  requireChangeNoticeActionTaskEditable: vi.fn(),
  requireChangeNoticeEditable: vi.fn(),
  unlinkAuthorizedChangeNoticeImpactTask: vi.fn()
}));

const service = await import("./items.service");
const server = await import("./items.server");
const {
  createImpactFollowUpTask,
  designateImpactFollowUpTask,
  deleteChangeNoticeActionTemplate,
  deleteChangeNoticeTask,
  linkImpactDecisionTask,
  unlinkImpactDecisionTask,
  updateChangeNoticeTaskAssignee,
  updateChangeNoticeTaskDueDate,
  updateChangeNoticeTaskNotes,
  updateChangeNoticeTaskStatus,
  upsertChangeNoticeActionTemplate
} = await import("./items.mcp.server");

const companyId = "company-1";
const userId = "user-1";
const changeNoticeId = "notice-1";
const actionTaskId = "task-1";
const decisionId = "decision-1";
const targetId = "po-line-1";

const successResult = { data: null, error: null };

function makeClient(
  permissionCompanies: unknown = [companyId],
  permissionError: { message: string } | null = null,
  taskRow: {
    id: string;
    companyId: string;
    changeOrderId: string;
  } | null = {
    id: actionTaskId,
    companyId,
    changeOrderId: changeNoticeId
  }
): SupabaseClient<Database> {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn()
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({
    data: taskRow,
    error: null
  });

  return {
    rpc: vi.fn().mockResolvedValue({
      data: permissionCompanies,
      error: permissionError
    }),
    from: vi.fn().mockReturnValue(query)
  } as unknown as SupabaseClient<Database>;
}

function relationshipArgs() {
  return {
    changeNoticeId,
    decisionId,
    targetType: "purchaseOrderLine" as const,
    targetId,
    actionTaskId
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  for (const fn of [
    service.deleteChangeNoticeAction,
    service.deleteChangeNoticeRequiredAction,
    service.updateChangeNoticeActionAssignee,
    service.updateChangeNoticeActionDueDate,
    service.updateChangeNoticeActionNotes,
    service.updateChangeNoticeActionStatus,
    service.upsertChangeNoticeRequiredAction
  ]) {
    vi.mocked(fn).mockResolvedValue(successResult as never);
  }

  vi.mocked(server.requireChangeNoticeActionTaskEditable).mockResolvedValue(
    null
  );
  vi.mocked(server.requireChangeNoticeEditable).mockResolvedValue(null);
  vi.mocked(server.createAuthorizedChangeNoticeImpactTask).mockResolvedValue(
    successResult as never
  );
  vi.mocked(server.linkAuthorizedChangeNoticeImpactTask).mockResolvedValue(
    successResult as never
  );
  vi.mocked(server.unlinkAuthorizedChangeNoticeImpactTask).mockResolvedValue(
    successResult as never
  );
  vi.mocked(server.designateAuthorizedChangeNoticeImpactTask).mockResolvedValue(
    successResult as never
  );
});

describe("Change Notice task field adapters", () => {
  it("checks active parts_update permission before reaching the task writer", async () => {
    const client = makeClient();

    await updateChangeNoticeTaskStatus(client, companyId, userId, {
      changeNoticeId,
      actionTaskId,
      status: "In Progress"
    });

    expect(client.rpc).toHaveBeenCalledWith(
      "get_companies_with_employee_permission",
      { permission: "parts_update" }
    );
    expect(server.requireChangeNoticeActionTaskEditable).toHaveBeenCalledWith(
      client,
      { companyId, changeNoticeId, actionTaskId }
    );
    expect(service.updateChangeNoticeActionStatus).toHaveBeenCalledWith(
      client,
      {
        id: actionTaskId,
        changeNoticeId,
        companyId,
        status: "In Progress",
        userId
      }
    );
  });

  it("denies field updates when the active client lacks parts_update", async () => {
    const client = makeClient([]);

    await expect(
      updateChangeNoticeTaskNotes(client, companyId, userId, {
        changeNoticeId,
        actionTaskId,
        notes: { summary: "follow up" }
      })
    ).rejects.toThrow("parts_update");

    expect(server.requireChangeNoticeActionTaskEditable).not.toHaveBeenCalled();
    expect(service.updateChangeNoticeActionNotes).not.toHaveBeenCalled();
  });

  it("accepts a non-null object for task notes", async () => {
    const client = makeClient();
    const notes = { type: "doc", content: [] } as Json;

    await updateChangeNoticeTaskNotes(client, companyId, userId, {
      changeNoticeId,
      actionTaskId,
      notes
    });

    expect(service.updateChangeNoticeActionNotes).toHaveBeenCalledWith(client, {
      id: actionTaskId,
      changeNoticeId,
      companyId,
      notes,
      userId
    });
  });

  it("rejects string task notes before reaching the writer", async () => {
    await expect(
      updateChangeNoticeTaskNotes(makeClient(), companyId, userId, {
        changeNoticeId,
        actionTaskId,
        notes: "hello"
      })
    ).rejects.toThrow();

    expect(service.updateChangeNoticeActionNotes).not.toHaveBeenCalled();
  });

  it("rejects array task notes before reaching the writer", async () => {
    await expect(
      updateChangeNoticeTaskNotes(makeClient(), companyId, userId, {
        changeNoticeId,
        actionTaskId,
        notes: [1, 2, 3]
      })
    ).rejects.toThrow();

    expect(service.updateChangeNoticeActionNotes).not.toHaveBeenCalled();
  });

  it("rejects null task notes before reaching the writer", async () => {
    await expect(
      updateChangeNoticeTaskNotes(makeClient(), companyId, userId, {
        changeNoticeId,
        actionTaskId,
        notes: null
      })
    ).rejects.toThrow();

    expect(service.updateChangeNoticeActionNotes).not.toHaveBeenCalled();
  });

  it("fails closed on permission RPC errors and malformed output", async () => {
    const rpcErrorClient = makeClient(null, {
      message: "permission RPC failed"
    });
    await expect(
      updateChangeNoticeTaskAssignee(rpcErrorClient, companyId, userId, {
        changeNoticeId,
        actionTaskId,
        assignee: "employee-2"
      })
    ).rejects.toThrow("permission RPC failed");

    const malformedClient = makeClient([companyId, 42]);
    await expect(
      updateChangeNoticeTaskDueDate(malformedClient, companyId, userId, {
        changeNoticeId,
        actionTaskId,
        dueDate: "2026-09-03"
      })
    ).rejects.toThrow("Permission check failed");

    expect(service.updateChangeNoticeActionAssignee).not.toHaveBeenCalled();
    expect(service.updateChangeNoticeActionDueDate).not.toHaveBeenCalled();
  });

  it("normalizes a valid task due date before reaching the writer", async () => {
    const client = makeClient();

    await updateChangeNoticeTaskDueDate(client, companyId, userId, {
      changeNoticeId,
      actionTaskId,
      dueDate: "2026-09-03"
    });

    expect(service.updateChangeNoticeActionDueDate).toHaveBeenCalledWith(
      client,
      {
        id: actionTaskId,
        changeNoticeId,
        companyId,
        dueDate: "2026-09-03",
        userId
      }
    );
  });

  it("trims surrounding whitespace from a task due date", async () => {
    const client = makeClient();

    await updateChangeNoticeTaskDueDate(client, companyId, userId, {
      changeNoticeId,
      actionTaskId,
      dueDate: "  2026-09-03  "
    });

    expect(service.updateChangeNoticeActionDueDate).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ dueDate: "2026-09-03" })
    );
  });

  it.each([
    null,
    "",
    "   "
  ])("converts a blank task due date to null (%s)", async (dueDate) => {
    const client = makeClient();

    await updateChangeNoticeTaskDueDate(client, companyId, userId, {
      changeNoticeId,
      actionTaskId,
      dueDate
    });

    expect(service.updateChangeNoticeActionDueDate).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ dueDate: null })
    );
  });

  it("rejects an invalid task due date before reaching the writer", async () => {
    await expect(
      updateChangeNoticeTaskDueDate(makeClient(), companyId, userId, {
        changeNoticeId,
        actionTaskId,
        dueDate: "not-a-date"
      })
    ).rejects.toThrow();

    expect(service.updateChangeNoticeActionDueDate).not.toHaveBeenCalled();
  });

  it("normalizes a blank task assignee to null", async () => {
    const client = makeClient();

    await updateChangeNoticeTaskAssignee(client, companyId, userId, {
      changeNoticeId,
      actionTaskId,
      assignee: ""
    });

    expect(service.updateChangeNoticeActionAssignee).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ assignee: null })
    );
  });

  it.each([
    ["ordinary task + Done", false],
    ["Impact follow-up task + Done", true]
  ] as const)("delegates Done lifecycle decisions to the canonical guard (%s)", async (_caseName, allowed) => {
    vi.mocked(server.requireChangeNoticeActionTaskEditable).mockResolvedValue(
      allowed
        ? null
        : {
            data: null,
            error: { message: "This action task is read-only" }
          }
    );

    const update = updateChangeNoticeTaskStatus(
      makeClient(),
      companyId,
      userId,
      {
        changeNoticeId,
        actionTaskId,
        status: "Completed"
      }
    );

    if (allowed) {
      await update;
      expect(service.updateChangeNoticeActionStatus).toHaveBeenCalledTimes(1);
    } else {
      await expect(update).rejects.toThrow("read-only");
      expect(service.updateChangeNoticeActionStatus).not.toHaveBeenCalled();
    }
  });

  it("uses executor-owned company and user identity instead of forged payload fields", async () => {
    const client = makeClient();
    const forgedArgs = {
      changeNoticeId,
      actionTaskId,
      status: "Pending" as const,
      companyId: "other-company",
      userId: "other-user",
      updatedBy: "other-user",
      taskOrigin: "Impact follow-up"
    };

    await updateChangeNoticeTaskStatus(client, companyId, userId, forgedArgs);

    expect(service.updateChangeNoticeActionStatus).toHaveBeenCalledWith(
      client,
      {
        id: actionTaskId,
        changeNoticeId,
        companyId,
        status: "Pending",
        userId
      }
    );
  });
});

describe("Change Notice task deletion adapter", () => {
  it("uses workflow lifecycle rather than field editability, denying an Impact task after Done", async () => {
    vi.mocked(server.requireChangeNoticeEditable).mockResolvedValue({
      data: null,
      error: { message: "This Change Notice is locked" }
    });

    await expect(
      deleteChangeNoticeTask(makeClient(), companyId, {
        changeNoticeId,
        actionTaskId
      })
    ).rejects.toThrow("locked");

    expect(server.requireChangeNoticeActionTaskEditable).not.toHaveBeenCalled();
    expect(service.deleteChangeNoticeAction).not.toHaveBeenCalled();
  });

  it("checks scoped child ownership before using the existing delete service", async () => {
    const client = makeClient();

    await deleteChangeNoticeTask(client, companyId, {
      changeNoticeId,
      actionTaskId
    });

    expect(server.requireChangeNoticeEditable).toHaveBeenCalledWith(client, {
      companyId,
      changeNoticeId,
      scope: "workflow"
    });
    expect(service.deleteChangeNoticeAction).toHaveBeenCalledWith(client, {
      id: actionTaskId,
      changeNoticeId,
      companyId
    });
  });
});

describe("Change Notice action-template adapters", () => {
  it("selects parts_create for create and parts_update for update", async () => {
    const client = makeClient();

    await upsertChangeNoticeActionTemplate(client, companyId, userId, {
      name: "  Supplier review  ",
      active: true
    });
    await upsertChangeNoticeActionTemplate(client, companyId, userId, {
      id: "template-1",
      name: "Production review",
      active: false
    });

    expect(client.rpc).toHaveBeenNthCalledWith(
      1,
      "get_companies_with_employee_permission",
      { permission: "parts_create" }
    );
    expect(client.rpc).toHaveBeenNthCalledWith(
      2,
      "get_companies_with_employee_permission",
      { permission: "parts_update" }
    );
    expect(service.upsertChangeNoticeRequiredAction).toHaveBeenNthCalledWith(
      1,
      client,
      {
        id: undefined,
        name: "Supplier review",
        active: true,
        companyId,
        userId
      }
    );
    expect(service.upsertChangeNoticeRequiredAction).toHaveBeenNthCalledWith(
      2,
      client,
      {
        id: "template-1",
        name: "Production review",
        active: false,
        companyId,
        userId
      }
    );
  });

  it("uses parts_delete and server-owned company scope for template deletion", async () => {
    const client = makeClient();

    await deleteChangeNoticeActionTemplate(client, companyId, {
      id: "template-1"
    });

    expect(client.rpc).toHaveBeenCalledWith(
      "get_companies_with_employee_permission",
      { permission: "parts_delete" }
    );
    expect(service.deleteChangeNoticeRequiredAction).toHaveBeenCalledWith(
      client,
      "template-1",
      companyId
    );
  });
});

describe("Impact follow-up task adapters", () => {
  it("accepts an Impact task with optional task fields omitted", async () => {
    const client = makeClient();

    await createImpactFollowUpTask(client, companyId, userId, {
      changeNoticeId,
      targetType: "purchaseOrderLine",
      targetId,
      decision: {
        decisionId,
        targetType: "purchaseOrderLine",
        targetId
      },
      task: {}
    });

    expect(server.createAuthorizedChangeNoticeImpactTask).toHaveBeenCalledWith({
      client,
      companyId,
      userId,
      task: {
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId,
        decision: { decisionId, targetType: "purchaseOrderLine", targetId },
        bootstrapDecision: undefined,
        task: {
          name: undefined,
          notes: undefined,
          assignee: undefined,
          dueDate: undefined
        }
      }
    });
  });

  it("delegates create with a sanitized request and unchanged active client", async () => {
    const client = makeClient();
    const forgedArgs = {
      changeNoticeId,
      targetType: "purchaseOrderLine" as const,
      targetId,
      decision: {
        decisionId,
        targetType: "purchaseOrderLine" as const,
        targetId,
        companyId: "other-company"
      },
      task: {
        name: "Call supplier",
        notes: { summary: "Confirm old revision" } as Json,
        assignee: "buyer-1",
        dueDate: "2026-09-01",
        taskOrigin: "Manual"
      },
      companyId: "other-company",
      userId: "other-user",
      sourceAccess: { purchaseOrderLine: true },
      db: "forged-db"
    };

    await createImpactFollowUpTask(client, companyId, userId, forgedArgs);

    expect(server.createAuthorizedChangeNoticeImpactTask).toHaveBeenCalledWith({
      client,
      companyId,
      userId,
      task: {
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId,
        decision: { decisionId, targetType: "purchaseOrderLine", targetId },
        bootstrapDecision: undefined,
        task: {
          name: "Call supplier",
          notes: { summary: "Confirm old revision" },
          assignee: "buyer-1",
          dueDate: "2026-09-01"
        }
      }
    });
  });

  it("normalizes a padded Impact task due date before delegating", async () => {
    const client = makeClient();

    await createImpactFollowUpTask(client, companyId, userId, {
      changeNoticeId,
      targetType: "purchaseOrderLine",
      targetId,
      decision: {
        decisionId,
        targetType: "purchaseOrderLine",
        targetId
      },
      task: { dueDate: "  2026-09-01  " }
    });

    expect(server.createAuthorizedChangeNoticeImpactTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          task: expect.objectContaining({ dueDate: "2026-09-01" })
        })
      })
    );
  });

  it("maps a blank Impact task due date to null instead of an unparseable string", async () => {
    const client = makeClient();

    await createImpactFollowUpTask(client, companyId, userId, {
      changeNoticeId,
      targetType: "purchaseOrderLine",
      targetId,
      decision: {
        decisionId,
        targetType: "purchaseOrderLine",
        targetId
      },
      task: { dueDate: "   " }
    });

    expect(server.createAuthorizedChangeNoticeImpactTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          task: expect.objectContaining({ dueDate: null })
        })
      })
    );
  });

  it("rejects a malformed Impact task due date before delegating", async () => {
    const client = makeClient();

    const result = await createImpactFollowUpTask(client, companyId, userId, {
      changeNoticeId,
      targetType: "purchaseOrderLine",
      targetId,
      decision: {
        decisionId,
        targetType: "purchaseOrderLine",
        targetId
      },
      task: { dueDate: "09/01/2026" }
    });

    expect(result).toEqual({
      data: null,
      error: { message: "Invalid Change Notice Impact task due date." }
    });
    expect(
      server.createAuthorizedChangeNoticeImpactTask
    ).not.toHaveBeenCalled();
  });

  it("rejects non-object JSON Impact task notes before delegating", async () => {
    const client = makeClient();

    for (const notes of ["hello", [1, 2, 3], 42] as unknown[]) {
      const result = await createImpactFollowUpTask(client, companyId, userId, {
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId,
        decision: {
          decisionId,
          targetType: "purchaseOrderLine",
          targetId
        },
        task: { notes: notes as Json }
      });

      expect(result.data).toBeNull();
      expect(result.error?.message).toEqual(expect.any(String));
    }
    expect(
      server.createAuthorizedChangeNoticeImpactTask
    ).not.toHaveBeenCalled();
  });

  it("accepts a nested JSON object as Impact task notes", async () => {
    const client = makeClient();
    const notes = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }]
    };

    await createImpactFollowUpTask(client, companyId, userId, {
      changeNoticeId,
      targetType: "purchaseOrderLine",
      targetId,
      decision: {
        decisionId,
        targetType: "purchaseOrderLine",
        targetId
      },
      task: { notes: notes as Json }
    });

    expect(server.createAuthorizedChangeNoticeImpactTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          task: expect.objectContaining({ notes })
        })
      })
    );
  });

  it("delegates link, unlink, and designation to their authorized wrappers", async () => {
    const client = makeClient();
    const args = relationshipArgs();

    await linkImpactDecisionTask(client, companyId, userId, args);
    await unlinkImpactDecisionTask(client, companyId, userId, args);
    await designateImpactFollowUpTask(client, companyId, userId, args);

    const expected = {
      client,
      companyId,
      userId,
      changeNoticeId,
      task: {
        decisionId,
        targetType: "purchaseOrderLine",
        targetId,
        actionTaskId
      }
    };
    expect(server.linkAuthorizedChangeNoticeImpactTask).toHaveBeenCalledWith(
      expected
    );
    expect(server.unlinkAuthorizedChangeNoticeImpactTask).toHaveBeenCalledWith(
      expected
    );
    expect(
      server.designateAuthorizedChangeNoticeImpactTask
    ).toHaveBeenCalledWith(expected);
  });
});
