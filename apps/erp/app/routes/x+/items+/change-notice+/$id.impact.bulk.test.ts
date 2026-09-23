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
  writeAuthorizedChangeNoticeImpactDecisions: vi.fn()
}));

const { action } = await import("./$id.impact.bulk");
const { writeAuthorizedChangeNoticeImpactDecisions } = await import(
  "~/modules/items/items.server"
);

const client = { rpc: vi.fn() };

function bulkRequest(fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request(
    "http://localhost/x/items/change-notice/change-1/impact/bulk",
    { method: "POST", body }
  );
}

async function runAction(request: Request, id = "change-1") {
  return action({ request, params: { id }, context: {} } as any);
}

const targets = [
  {
    targetType: "purchaseOrderLine",
    targetId: "pol-1",
    expectedRevision: 3,
    expectedSnapshotFingerprint: "fingerprint-1"
  },
  {
    targetType: "purchaseOrderLine",
    targetId: "pol-2",
    expectedSnapshotFingerprint: "fingerprint-2"
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermissions).mockResolvedValue({
    client,
    companyId: "company-1",
    userId: "user-1"
  } as any);
  vi.mocked(writeAuthorizedChangeNoticeImpactDecisions).mockResolvedValue({
    data: {
      changeNoticeId: "change-1",
      selectedCount: 2,
      appliedCount: 2,
      noOpCount: 0
    },
    error: null
  } as any);
});

describe("Change Notice Impact bulk route", () => {
  it("decodes the reviewed target preview and shared decision fields", async () => {
    const result = await runAction(
      bulkRequest({
        changeNoticeId: "change-1",
        targets: JSON.stringify(targets),
        decisionStatus: "No action required",
        noActionReasonCode: "Not affected after review",
        rationale: "Reviewed against the current operational facts.",
        confirmNoPurchasingInterventionRemains: "on"
      })
    );

    expect(result).toEqual({
      success: true,
      data: {
        changeNoticeId: "change-1",
        selectedCount: 2,
        appliedCount: 2,
        noOpCount: 0
      }
    });
    expect(writeAuthorizedChangeNoticeImpactDecisions).toHaveBeenCalledWith({
      client,
      companyId: "company-1",
      userId: "user-1",
      decision: {
        changeNoticeId: "change-1",
        targets: [
          {
            ...targets[0],
            decisionStatus: "No action required",
            noActionReasonCode: "Not affected after review",
            rationale: "Reviewed against the current operational facts.",
            confirmNoPurchasingInterventionRemains: true
          },
          {
            ...targets[1],
            decisionStatus: "No action required",
            noActionReasonCode: "Not affected after review",
            rationale: "Reviewed against the current operational facts.",
            confirmNoPurchasingInterventionRemains: true
          }
        ]
      }
    });
  });

  it("rejects a form preview that omits a target fingerprint", async () => {
    const incompleteTargets = targets.map(
      ({ targetType, targetId, expectedRevision }) => ({
        targetType,
        targetId,
        ...(expectedRevision ? { expectedRevision } : {})
      })
    );
    const result = await runAction(
      bulkRequest({
        changeNoticeId: "change-1",
        targets: JSON.stringify(incompleteTargets),
        decisionStatus: "Action required",
        rationale: "The selected targets need supplier follow-up."
      })
    );

    expect(result).toBeTruthy();
    expect(writeAuthorizedChangeNoticeImpactDecisions).not.toHaveBeenCalled();
  });

  it("marks preview and revision conflicts for stale-review recovery", async () => {
    const message =
      "This Impact bulk preview is stale. Refresh and review the selected targets. Bulk targets: purchaseOrderLine/pol-1.";
    vi.mocked(writeAuthorizedChangeNoticeImpactDecisions).mockResolvedValueOnce(
      {
        data: null,
        error: { message }
      } as any
    );

    const result = await runAction(
      bulkRequest({
        changeNoticeId: "change-1",
        targets: JSON.stringify(targets),
        decisionStatus: "Action required",
        rationale: "The selected targets need supplier follow-up."
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

  it("rejects a body Change Notice identity that does not match the route", async () => {
    const result = await runAction(
      bulkRequest({
        changeNoticeId: "another-change",
        targets: JSON.stringify(targets),
        decisionStatus: "Action required",
        rationale: "The selected targets need follow-up."
      })
    );

    expect(result).toMatchObject({
      data: {
        success: false,
        error: {
          message: "Impact bulk Change Notice does not match the route."
        }
      }
    });
    expect(writeAuthorizedChangeNoticeImpactDecisions).not.toHaveBeenCalled();
  });
});
