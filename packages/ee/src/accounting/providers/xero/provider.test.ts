import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SYNC_CONFIG } from "../../core/models";
import { AccountingApiError } from "../../core/utils";
import { XeroProvider } from "./provider";

const TENANT_ID = "tenant-1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function makeProvider() {
  return new XeroProvider({
    companyId: "company-1",
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "token",
    refreshToken: "refresh",
    tenantId: TENANT_ID,
    syncConfig: DEFAULT_SYNC_CONFIG
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const REGION_CATEGORY = {
  TrackingCategoryID: "11111111-1111-1111-1111-111111111111",
  Name: "Region",
  Status: "ACTIVE" as const,
  Options: [
    {
      TrackingOptionID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      Name: "Atlanta",
      Status: "ACTIVE" as const
    }
  ]
};

const ARCHIVED_CATEGORY = {
  TrackingCategoryID: "33333333-3333-3333-3333-333333333333",
  Name: "Old",
  Status: "ARCHIVED" as const,
  Options: []
};

describe("XeroProvider tracking categories (dimensions)", () => {
  it("lists ACTIVE tracking categories with their options", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ TrackingCategories: [REGION_CATEGORY, ARCHIVED_CATEGORY] })
    );

    const categories = await makeProvider().listTrackingCategories();

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.xero.com/api.xro/2.0/TrackingCategories"
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers["xero-tenant-id"]).toBe(TENANT_ID);
    expect(categories).toEqual([REGION_CATEGORY]);
  });

  it("returns [] on failure (forgiving settings-surface contract)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: "boom" }, 500));
    await expect(makeProvider().listTrackingCategories()).resolves.toEqual([]);
  });

  it("creates a tracking option by NAME under a category (autoCreate)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Options: [
          {
            TrackingOptionID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            Name: "Boston",
            Status: "ACTIVE"
          }
        ]
      })
    );

    const created = await makeProvider().createTrackingOption(
      REGION_CATEGORY.TrackingCategoryID,
      "Boston"
    );

    expect(created.TrackingOptionID).toBe(
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://api.xero.com/api.xro/2.0/TrackingCategories/${REGION_CATEGORY.TrackingCategoryID}/Options`
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      Name: "Boston"
    });
  });

  it("throws a structured error when Xero rejects the option create", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Message: "option cap reached" }, 400)
    );

    await expect(
      makeProvider().createTrackingOption(
        REGION_CATEGORY.TrackingCategoryID,
        "Boston"
      )
    ).rejects.toBeInstanceOf(AccountingApiError);
  });

  it("declares one tracking:<categoryId> target per active category", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ TrackingCategories: [REGION_CATEGORY, ARCHIVED_CATEGORY] })
    );

    const targets = await makeProvider().journalDimensionTargets();
    expect(targets).toEqual([
      {
        id: `tracking:${REGION_CATEGORY.TrackingCategoryID}`,
        label: "Region",
        capacity: 1
      }
    ]);
  });
});
