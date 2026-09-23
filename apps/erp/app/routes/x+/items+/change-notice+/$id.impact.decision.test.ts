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
  writeAuthorizedChangeNoticeImpactDecision: vi.fn()
}));

const { action } = await import("./$id.impact.decision");
const { writeAuthorizedChangeNoticeImpactDecision } = await import(
  "~/modules/items/items.server"
);

const client = { rpc: vi.fn() };

function decisionRequest(fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request(
    "http://localhost/x/items/change-notice/change-1/impact/decision",
    { method: "POST", body }
  );
}

async function runAction(request: Request, id = "change-1") {
  return action({ request, params: { id }, context: {} } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermissions).mockResolvedValue({
    client,
    companyId: "company-1",
    userId: "user-1"
  } as any);
  vi.mocked(writeAuthorizedChangeNoticeImpactDecision).mockResolvedValue({
    data: {
      operation: "reassessDecision",
      decision: { id: "decision-1" }
    },
    error: null
  } as any);
});

describe("Change Notice Impact decision route", () => {
  it("validates FormData and calls the authorized single-decision boundary", async () => {
    const result = await runAction(
      decisionRequest({
        changeNoticeId: "change-1",
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        rationale: "Supplier follow-up remains open.",
        expectedRevision: "3"
      })
    );

    expect(result).toEqual({
      success: true,
      data: {
        operation: "reassessDecision",
        decision: { id: "decision-1" }
      }
    });
    expect(writeAuthorizedChangeNoticeImpactDecision).toHaveBeenCalledWith({
      client,
      companyId: "company-1",
      userId: "user-1",
      decision: {
        changeNoticeId: "change-1",
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "Action required",
        rationale: "Supplier follow-up remains open.",
        expectedRevision: 3
      }
    });
  });

  it("decodes Carbon checkbox submissions and omits an unchecked confirmation", async () => {
    await runAction(
      decisionRequest({
        changeNoticeId: "change-1",
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "No action required",
        noActionReasonCode: "No purchasing intervention remains",
        rationale: "The purchasing intervention is no longer needed.",
        confirmNoPurchasingInterventionRemains: "on"
      })
    );

    expect(writeAuthorizedChangeNoticeImpactDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          confirmNoPurchasingInterventionRemains: true
        })
      })
    );

    vi.mocked(writeAuthorizedChangeNoticeImpactDecision).mockClear();
    await runAction(
      decisionRequest({
        changeNoticeId: "change-1",
        targetType: "purchaseOrderLine",
        targetId: "pol-1",
        decisionStatus: "No action required",
        noActionReasonCode: "No purchasing intervention remains",
        rationale: "The purchasing intervention is no longer needed."
      })
    );

    const uncheckedDecision = vi.mocked(
      writeAuthorizedChangeNoticeImpactDecision
    ).mock.calls[0]?.[0].decision;
    expect(uncheckedDecision).not.toHaveProperty(
      "confirmNoPurchasingInterventionRemains"
    );
  });

  it("rejects a body Change Notice identity that does not match the route", async () => {
    const result = await runAction(
      decisionRequest({
        changeNoticeId: "another-change",
        targetType: "job",
        targetId: "job-1",
        decisionStatus: "Action required",
        rationale: "Production follow-up remains open."
      })
    );

    expect(result).toMatchObject({
      data: {
        success: false,
        error: {
          message: "Impact decision Change Notice does not match the route."
        }
      }
    });
    expect(writeAuthorizedChangeNoticeImpactDecision).not.toHaveBeenCalled();
  });

  it.each([
    "This Impact target was assessed by someone else. Refresh and reassess.",
    "This Impact assessment changed before your update. Refresh and try again."
  ])("marks the exact conflict message for stale-editor recovery", async (message) => {
    vi.mocked(writeAuthorizedChangeNoticeImpactDecision).mockResolvedValueOnce({
      data: null,
      error: { message }
    } as any);

    const result = await runAction(
      decisionRequest({
        changeNoticeId: "change-1",
        targetType: "job",
        targetId: "job-1",
        decisionStatus: "Resolved",
        resolutionNote: "Closure evidence recorded.",
        expectedRevision: "4"
      })
    );

    expect(result).toMatchObject({
      data: {
        success: false,
        error: { message },
        conflict: true
      }
    });
  });

  it("returns non-conflict service failures without stale-editor recovery", async () => {
    vi.mocked(writeAuthorizedChangeNoticeImpactDecision).mockResolvedValueOnce({
      data: null,
      error: { message: "Impact decision revision conflict." }
    } as any);

    const result = await runAction(
      decisionRequest({
        changeNoticeId: "change-1",
        targetType: "job",
        targetId: "job-1",
        decisionStatus: "Resolved",
        resolutionNote: "Closure evidence recorded.",
        expectedRevision: "4"
      })
    );

    expect(result).toMatchObject({
      data: {
        success: false,
        error: { message: "Impact decision revision conflict." }
      }
    });
    expect((result as any).data.conflict).toBeUndefined();
  });
});
