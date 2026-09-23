import { requirePermissions } from "@carbon/auth/auth.server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(async () => ({}))
}));
vi.mock("~/modules/items/items.server", () => ({
  createAuthorizedChangeNoticeImpactTask: vi.fn()
}));

const { action } = await import("./$id.impact.task.create");
const { createAuthorizedChangeNoticeImpactTask } = await import(
  "~/modules/items/items.server"
);

const client = { rpc: vi.fn() };

function taskRequest(fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request(
    "http://localhost/x/items/change-notice/change-1/impact/task/create",
    { method: "POST", body }
  );
}

async function runAction(request: Request, id = "change-1") {
  return action({ request, params: { id }, context: {} } as any);
}

const existingDecisionFields = {
  decisionId: "decision-1",
  targetType: "purchaseOrderLine",
  targetId: "pol-1"
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermissions).mockResolvedValue({
    client,
    companyId: "company-1",
    userId: "user-1"
  } as any);
  vi.mocked(createAuthorizedChangeNoticeImpactTask).mockResolvedValue({
    data: {
      decisionId: "decision-1",
      actionTaskId: "task-1",
      decisionCreated: false,
      taskOrigin: "Impact follow-up",
      status: "Pending"
    },
    error: null
  } as any);
});

describe("Change Notice Impact task create route", () => {
  it("uses the route authority and normalizes a valid due date", async () => {
    const result = await runAction(
      taskRequest({
        ...existingDecisionFields,
        name: "Supplier follow-up",
        notes: '{"type":"doc","content":[]}',
        assignee: "employee-1",
        dueDate: "2026-09-15"
      })
    );

    expect(result).toEqual({
      success: true,
      data: {
        decisionId: "decision-1",
        actionTaskId: "task-1",
        decisionCreated: false,
        taskOrigin: "Impact follow-up",
        status: "Pending"
      }
    });
    expect(requirePermissions).toHaveBeenCalledWith(expect.any(Request), {
      update: "parts"
    });
    expect(createAuthorizedChangeNoticeImpactTask).toHaveBeenCalledWith({
      client,
      companyId: "company-1",
      userId: "user-1",
      task: {
        changeNoticeId: "change-1",
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decision: {
          decisionId: "decision-1",
          targetType: "purchaseOrderLine",
          targetId: "pol-1"
        },
        task: {
          name: "Supplier follow-up",
          notes: { type: "doc", content: [] },
          assignee: "employee-1",
          dueDate: "2026-09-15"
        }
      }
    });
  });

  it("preserves the authorized bootstrap payload for direct callers", async () => {
    await runAction(
      taskRequest({
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        bootstrapRationale: "Supplier follow-up remains open."
      })
    );

    expect(createAuthorizedChangeNoticeImpactTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          bootstrapDecision: {
            decisionStatus: "Action required",
            rationale: "Supplier follow-up remains open."
          }
        })
      })
    );
  });

  it.each([
    ["omitted", undefined],
    ["empty", ""]
  ] as const)("keeps an %s due date absent", async (_label, dueDate) => {
    const fields: Record<string, string> = { ...existingDecisionFields };
    if (dueDate !== undefined) fields.dueDate = dueDate;

    await runAction(taskRequest(fields));

    expect(
      vi.mocked(createAuthorizedChangeNoticeImpactTask).mock.calls[0]?.[0].task
        .task
    ).not.toHaveProperty("dueDate");
  });

  it("rejects malformed due dates before reaching the writer", async () => {
    const result = await runAction(
      taskRequest({
        ...existingDecisionFields,
        dueDate: "2026-02-30"
      })
    );

    expect(result).toMatchObject({ data: { success: false } });
    expect(createAuthorizedChangeNoticeImpactTask).not.toHaveBeenCalled();
  });

  it.each([
    "{not-json",
    "[]"
  ])("rejects malformed task notes (%s) before reaching the writer", async (notes) => {
    const result = await runAction(
      taskRequest({
        ...existingDecisionFields,
        notes
      })
    );

    expect(result).toMatchObject({ data: { success: false } });
    expect(createAuthorizedChangeNoticeImpactTask).not.toHaveBeenCalled();
  });
});
