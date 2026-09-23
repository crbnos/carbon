import { requirePermissions } from "@carbon/auth/auth.server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("~/modules/items/items.server", () => ({
  getAuthorizedChangeNoticeImpactHistory: vi.fn()
}));

const { loader } = await import("./$id.impact.history.$decisionId");
const { getAuthorizedChangeNoticeImpactHistory } = await import(
  "~/modules/items/items.server"
);

const client = { rpc: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermissions).mockResolvedValue({
    client,
    companyId: "company-1",
    userId: "user-1"
  } as never);
  vi.mocked(getAuthorizedChangeNoticeImpactHistory).mockResolvedValue({
    data: { entries: [] },
    error: null
  });
});

describe("Change Notice Impact history route", () => {
  it("passes only route-bound identities to the authorized history boundary", async () => {
    const result = await loader({
      request: new Request(
        "https://example.test/x/items/change-notice/change-1/impact/history/decision-1"
      ),
      params: { id: "change-1", decisionId: "decision-1" },
      context: {},
      url: new URL(
        "https://example.test/x/items/change-notice/change-1/impact/history/decision-1"
      ),
      pattern: ""
    });

    expect(result).toEqual({ entries: [] });
    expect(getAuthorizedChangeNoticeImpactHistory).toHaveBeenCalledWith({
      client,
      companyId: "company-1",
      userId: "user-1",
      changeNoticeId: "change-1",
      decisionId: "decision-1"
    });
  });

  it("returns a non-empty unavailable response for a service failure", async () => {
    vi.mocked(getAuthorizedChangeNoticeImpactHistory).mockResolvedValueOnce({
      data: null,
      error: {
        kind: "unavailable",
        message: "Impact history could not be loaded."
      }
    });

    const result = await loader({
      request: new Request("https://example.test/history"),
      params: { id: "change-1", decisionId: "decision-1" },
      context: {},
      url: new URL("https://example.test/history"),
      pattern: ""
    });

    expect(result).toMatchObject({
      data: {
        data: null,
        error: { message: "Impact history could not be loaded." }
      }
    });
  });

  it("does not disclose a restricted decision through the resource response", async () => {
    vi.mocked(getAuthorizedChangeNoticeImpactHistory).mockResolvedValueOnce({
      data: null,
      error: { kind: "restricted", message: "secret source" }
    });

    const result = await loader({
      request: new Request("https://example.test/history"),
      params: { id: "change-1", decisionId: "decision-1" },
      context: {},
      url: new URL("https://example.test/history"),
      pattern: ""
    });

    expect(result).toMatchObject({
      data: {
        data: null,
        error: { message: "Impact history is unavailable." }
      },
      init: { status: 404 }
    });
  });
});
