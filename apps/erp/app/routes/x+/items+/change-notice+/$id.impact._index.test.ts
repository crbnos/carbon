import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth", () => ({
  assertIsPost: vi.fn(),
  error: vi.fn((_cause: unknown, message: string) => ({ message }))
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(async () => ({ headers: { "x-carbon-flash": "1" } }))
}));
vi.mock("react-router", () => ({
  data: vi.fn((body: unknown, init: unknown) => ({ body, init })),
  useLoaderData: () => null,
  useParams: () => ({ id: "change-1" })
}));
vi.mock("~/hooks", () => ({ useRouteData: () => null }));
vi.mock("~/modules/items", () => ({
  getChangeNoticeImpactWorkspace: vi.fn()
}));
vi.mock("~/modules/items/items.server", () => ({
  getChangeNoticeImpactReadAccess: vi.fn(),
  reconcileAuthorizedChangeNoticeImpactProvenance: vi.fn()
}));
vi.mock("~/modules/items/ui/ChangeNotice", () => ({
  ChangeNoticeImpactWorkspace: () => null
}));
vi.mock("~/utils/path", () => ({ path: { to: {} } }));

const { action, loader, shouldRevalidate } = await import(
  "./$id.impact._index"
);
const { requirePermissions } = await import("@carbon/auth/auth.server");
const { flash } = await import("@carbon/auth/session.server");
const { assertIsPost, error } = await import("@carbon/auth");
const { getChangeNoticeImpactWorkspace } = await import("~/modules/items");
const {
  getChangeNoticeImpactReadAccess,
  reconcileAuthorizedChangeNoticeImpactProvenance
} = await import("~/modules/items/items.server");

beforeEach(() => {
  vi.clearAllMocks();
});

function postRequest(fields?: Record<string, string>) {
  const init: RequestInit = { method: "POST" };
  if (fields) init.body = new URLSearchParams(fields);
  return new Request(
    "https://erp.test/x/items/change-notice/change-1/impact",
    init
  );
}

describe("Change Notice Impact route loader", () => {
  it("forbids the workspace without Change Notice view access", async () => {
    const request = new Request("https://erp.test");
    const client = {};
    vi.mocked(requirePermissions).mockResolvedValue({
      client,
      companyId: "company-1",
      userId: "user-1"
    } as never);
    vi.mocked(getChangeNoticeImpactReadAccess).mockResolvedValue({
      status: "resolved",
      canViewChangeNotice: false,
      sourceAccess: {
        purchaseOrderLine: true,
        job: true,
        jobMaterial: true
      }
    });

    await expect(
      loader({ request, params: { id: "change-1" } } as never)
    ).rejects.toMatchObject({ status: 403 });
    expect(requirePermissions).toHaveBeenCalledWith(request, {
      view: "parts"
    });
    expect(getChangeNoticeImpactWorkspace).not.toHaveBeenCalled();
  });

  it("forwards resolved source access and maps workspace failures to 503", async () => {
    const client = {};
    const sourceAccess = {
      purchaseOrderLine: true,
      job: false,
      jobMaterial: false
    };
    vi.mocked(requirePermissions).mockResolvedValue({
      client,
      companyId: "company-1",
      userId: "user-1"
    } as never);
    vi.mocked(getChangeNoticeImpactReadAccess).mockResolvedValue({
      status: "resolved",
      canViewChangeNotice: true,
      sourceAccess
    });
    vi.mocked(getChangeNoticeImpactWorkspace).mockResolvedValue({
      data: null,
      error: { message: "Impact workspace unavailable." }
    } as never);

    await expect(
      loader({
        request: new Request("https://erp.test"),
        params: { id: "change-1" }
      } as never)
    ).rejects.toMatchObject({ status: 503 });
    expect(getChangeNoticeImpactReadAccess).toHaveBeenCalledWith({
      client,
      userId: "user-1",
      companyId: "company-1"
    });
    expect(getChangeNoticeImpactWorkspace).toHaveBeenCalledWith(
      client,
      "company-1",
      "change-1",
      { sourceAccess: { status: "resolved", access: sourceAccess } }
    );
  });
});

describe("Change Notice Impact route action", () => {
  it("invokes the POST guard and ignores forged browser fields", async () => {
    const request = postRequest({
      companyId: "forged-company",
      userId: "forged-user",
      changeNoticeId: "forged-change",
      sourceAccess: "forged-source-access",
      db: "forged-db",
      targetIds: "forged-target-ids"
    });
    const client = {};
    const reconciliation = {
      changeNoticeId: "change-1",
      changeNoticeStatus: "Implementation" as const,
      started: 1,
      ended: 2,
      restrictedTargetTypes: []
    };
    vi.mocked(requirePermissions).mockResolvedValue({
      client,
      companyId: "company-1",
      userId: "user-1"
    } as never);
    vi.mocked(
      reconcileAuthorizedChangeNoticeImpactProvenance
    ).mockResolvedValue({ data: reconciliation, error: null });

    const result = await action({
      request,
      params: { id: "change-1" }
    } as never);

    expect(result).toEqual({ success: true });
    expect(assertIsPost).toHaveBeenCalledWith(request);
    expect(requirePermissions).toHaveBeenCalledWith(request, {
      update: "parts"
    });
    expect(
      reconcileAuthorizedChangeNoticeImpactProvenance
    ).toHaveBeenCalledOnce();
    expect(
      reconcileAuthorizedChangeNoticeImpactProvenance
    ).toHaveBeenCalledWith({
      client,
      companyId: "company-1",
      userId: "user-1",
      changeNoticeId: "change-1"
    });
  });

  it("flashes reconciliation failures with the minimal failure response", async () => {
    const request = postRequest();
    const reconciliationError = {
      message: "Impact source access could not be established."
    };
    vi.mocked(requirePermissions).mockResolvedValue({
      client: {},
      companyId: "company-1",
      userId: "user-1"
    } as never);
    vi.mocked(
      reconcileAuthorizedChangeNoticeImpactProvenance
    ).mockResolvedValue({ data: null, error: reconciliationError });

    const result = await action({
      request,
      params: { id: "change-1" }
    } as never);

    expect(result).toEqual({
      body: { success: false },
      init: { headers: { "x-carbon-flash": "1" } }
    });
    expect(error).toHaveBeenCalledWith(
      reconciliationError,
      "Failed to refresh operational impact"
    );
    expect(flash).toHaveBeenCalledWith(request, {
      message: "Failed to refresh operational impact"
    });
  });

  it("rejects a non-POST before authorization or reconciliation", async () => {
    const request = new Request(
      "https://erp.test/x/items/change-notice/change-1/impact",
      { method: "GET" }
    );
    vi.mocked(assertIsPost).mockImplementationOnce(() => {
      throw new Error("Method not allowed");
    });

    await expect(
      action({ request, params: { id: "change-1" } } as never)
    ).rejects.toThrow("Method not allowed");

    expect(assertIsPost).toHaveBeenCalledWith(request);
    expect(requirePermissions).not.toHaveBeenCalled();
    expect(
      reconcileAuthorizedChangeNoticeImpactProvenance
    ).not.toHaveBeenCalled();
  });

  it("does not reconcile when authorization rejects", async () => {
    const request = postRequest();
    vi.mocked(requirePermissions).mockRejectedValueOnce(
      new Error("Access denied")
    );

    await expect(
      action({ request, params: { id: "change-1" } } as never)
    ).rejects.toThrow("Access denied");

    expect(assertIsPost).toHaveBeenCalledWith(request);
    expect(requirePermissions).toHaveBeenCalledWith(request, {
      update: "parts"
    });
    expect(
      reconcileAuthorizedChangeNoticeImpactProvenance
    ).not.toHaveBeenCalled();
  });

  it("rejects a refresh without a route Change Notice id", async () => {
    vi.mocked(requirePermissions).mockResolvedValue({
      client: {},
      companyId: "company-1",
      userId: "user-1"
    } as never);

    await expect(
      action({ request: postRequest(), params: {} } as never)
    ).rejects.toThrow("Could not find id");
    expect(
      reconcileAuthorizedChangeNoticeImpactProvenance
    ).not.toHaveBeenCalled();
  });
});

function navigation(
  current: string,
  next: string,
  overrides: Record<string, unknown> = {}
) {
  return shouldRevalidate({
    currentUrl: new URL(current, "https://erp.test"),
    nextUrl: new URL(next, "https://erp.test"),
    formMethod: undefined,
    defaultShouldRevalidate: true,
    ...overrides
  } as never);
}

describe("Change Notice Impact route revalidation", () => {
  it("skips navigation that changes only search", () => {
    expect(
      navigation(
        "/x/items/change-notice/change-1/impact",
        "/x/items/change-notice/change-1/impact?search=po-123"
      )
    ).toBe(false);
  });

  it("skips navigation that changes only filters", () => {
    expect(
      navigation(
        "/x/items/change-notice/change-1/impact?filter=targetType:eq:job",
        "/x/items/change-notice/change-1/impact?filter=targetType:eq:jobMaterial"
      )
    ).toBe(false);
  });

  it.each([
    ["pathname", "/x/items/change-notice/other/impact?search=po-123"],
    [
      "another query parameter",
      "/x/items/change-notice/change-1/impact?view=all"
    ],
    ["unchanged URL", "/x/items/change-notice/change-1/impact?search=po-123"]
  ])("keeps the default for %s", (_label, next) => {
    expect(
      navigation("/x/items/change-notice/change-1/impact?search=po-123", next)
    ).toBe(true);
  });

  it("does not skip query changes on the sibling detail route", () => {
    expect(
      navigation(
        "/x/items/change-notice/change-1/details?search=old",
        "/x/items/change-notice/change-1/details?search=new"
      )
    ).toBe(true);
  });

  it("keeps mutation revalidation on the default path", () => {
    expect(
      navigation(
        "/x/items/change-notice/change-1/impact",
        "/x/items/change-notice/change-1/impact?search=po-123",
        { formMethod: "POST", defaultShouldRevalidate: true }
      )
    ).toBe(true);
  });

  it("returns the router default when an explicit refresh asks for it", () => {
    expect(
      navigation(
        "/x/items/change-notice/change-1/impact?search=po-123",
        "/x/items/change-notice/change-1/impact?search=po-123",
        { defaultShouldRevalidate: false }
      )
    ).toBe(false);
  });
});
