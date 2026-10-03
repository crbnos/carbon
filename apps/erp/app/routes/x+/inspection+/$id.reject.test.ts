// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { ServerFnError } from "@carbon/server-functions/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getInspection } from "~/modules/quality";
import { dispositionInspection } from "~/modules/quality/quality.server";
import { action } from "./$id.reject";

// The reject route hands the disposition engine's `writeOff` descriptor to the
// post-nonconformance operation. These tests lock that wiring (the 868f5c1bf
// refactor moved the itemLedger write out of the engine) and the failure
// handling (a failed write-off must NOT silently proceed to NCR creation, whose
// Use-As-Is restore assumes the reject already wrote the value off).

// @carbon/content/glossary's terms.ts evaluates Lingui `msg` macros at module load,
// which vitest doesn't transform; the route graph pulls it in transitively.
vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(async () => ({}))
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn(async () => ({ from: vi.fn() }))
}));
vi.mock("@carbon/ee/notifications", () => ({ notifyIssueCreated: vi.fn() }));
const postNonConformance = vi.hoisted(() => vi.fn());
vi.mock("@carbon/server-functions", () => {
  const bind = (fields: object) => ({
    invoke: (_name: string, input: unknown) => postNonConformance(fields, input)
  });
  return { serverFns: { system: bind, as: bind } };
});
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: vi.fn(() => ({}))
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));
vi.mock("~/modules/quality/quality.server", () => ({
  dispositionInspection: vi.fn()
}));
vi.mock("~/modules/quality", () => ({
  getInspection: vi.fn(),
  getInspectionMeasurements: vi.fn(),
  getInspectionSamplingPlans: vi.fn(),
  getIssueTypesList: vi.fn(),
  insertIssue: vi.fn(),
  deleteIssue: vi.fn()
}));
vi.mock("~/modules/settings/settings.server", () => ({
  getCompanyIntegrations: vi.fn()
}));
vi.mock("~/modules/users/users.server", () => ({
  getUserDefaults: vi.fn()
}));

function rejectRequest(fields: Record<string, string> = {}) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("http://localhost/x/inspection/insp-1/reject", {
    method: "POST",
    body
  });
}

async function runAction(request: Request) {
  try {
    return {
      thrown: null,
      response: await action({
        request,
        params: { id: "insp-1" },
        context: {}
      } as any)
    };
  } catch (e) {
    return { thrown: e as Response, response: null };
  }
}

const client = { from: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermissions).mockResolvedValue({
    client,
    companyId: "company-1",
    userId: "user-1"
  } as any);
  postNonConformance.mockResolvedValue({
    data: { journalId: null },
    error: null
  });
});

describe("inspection reject route — inventory write-off", () => {
  it("posts the disposition engine's writeOff to post-nonconformance", async () => {
    vi.mocked(dispositionInspection).mockResolvedValue({
      data: {
        id: "insp-1",
        status: "Failed",
        writeOff: { itemId: "part-2", quantity: -5, locationId: "loc-1" }
      },
      error: null
    } as any);

    const { thrown } = await runAction(rejectRequest({ createNcr: "false" }));

    expect(postNonConformance).toHaveBeenCalledWith(
      expect.objectContaining({
        client,
        companyId: "company-1",
        userId: "user-1"
      }),
      expect.objectContaining({
        documentType: "Inbound Inspection",
        documentId: "insp-1",
        movements: [
          expect.objectContaining({
            itemId: "part-2",
            quantity: -5,
            trackedEntityId: null,
            locationId: "loc-1"
          })
        ]
      })
    );
    // Lot rejected → redirect back to the inspection.
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown?.headers.get("Location")).toContain("insp-1");
  });

  it("does not post a write-off when the engine returns none (tracked / Non-Inventory / Accept)", async () => {
    vi.mocked(dispositionInspection).mockResolvedValue({
      data: { id: "insp-1", status: "Failed", writeOff: null },
      error: null
    } as any);

    await runAction(rejectRequest({ createNcr: "false" }));

    expect(postNonConformance).not.toHaveBeenCalled();
  });

  it("restricts the disposition to Receipt lots (Job Operation lots are verdict-only in the ERP)", async () => {
    // The ERP reject carries no production posting and does receipt-specific NCR
    // work, so it must scope the engine to Receipt source — otherwise accepting/
    // rejecting a Job Operation lot here hard-terminates it and wedges the op.
    vi.mocked(dispositionInspection).mockResolvedValue({
      data: { id: "insp-1", status: "Failed", writeOff: null },
      error: null
    } as any);

    await runAction(rejectRequest({ createNcr: "false" }));

    expect(dispositionInspection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "insp-1",
        decision: "Reject",
        requireSource: "Receipt"
      })
    );
  });

  it("aborts (does not create the NCR) when the write-off post fails", async () => {
    vi.mocked(dispositionInspection).mockResolvedValue({
      data: {
        id: "insp-1",
        status: "Failed",
        writeOff: { itemId: "part-2", quantity: -5, locationId: "loc-1" }
      },
      error: null
    } as any);
    // The posting fails — a failed reject write-off must surface, not be
    // swallowed, because closeIssue's Use-As-Is restore assumes it succeeded.
    postNonConformance.mockResolvedValue({
      data: null,
      error: new ServerFnError("boom")
    });
    // If the route proceeds anyway, this is where NCR creation starts.
    vi.mocked(getInspection).mockResolvedValue({
      data: null,
      error: { message: "should not reach here" }
    } as any);

    const { thrown } = await runAction(rejectRequest());

    // Must redirect back to the inspection with the failure surfaced, and must
    // NOT begin NCR creation (which would double-count on disposition).
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown?.headers.get("Location")).toContain("insp-1");
    expect(getInspection).not.toHaveBeenCalled();
  });
});
