import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SYNC_CONFIG } from "../../core/models";
import { AccountingApiError } from "../../core/utils";
import { buildXeroSyncConfig, XeroProvider } from "./provider";

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

describe("XeroProvider.listChanges (SupportsIncrementalPull — payments)", () => {
  const SINCE = "2026-08-01T10:15:30.500Z";

  it("emits payment ProviderChanges (AP + AR) with composite ids and deps", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Payments: [
          {
            PaymentID: "pay-ap-1",
            Amount: 500,
            Status: "AUTHORISED",
            PaymentType: "ACCPAYPAYMENT",
            Invoice: { InvoiceID: "bill-remote-1", Type: "ACCPAY" },
            UpdatedDateUTC: "/Date(1785542400000+0000)/"
          },
          {
            PaymentID: "pay-ar-1",
            Amount: 125,
            Status: "AUTHORISED",
            PaymentType: "ACCRECPAYMENT",
            Invoice: { InvoiceID: "inv-remote-1", Type: "ACCREC" },
            UpdatedDateUTC: "/Date(1785542400000+0000)/"
          }
        ]
      })
    );

    const { changes } = await makeProvider().listChanges({ since: SINCE });

    // Single page (fewer than 100) → one request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/Payments?");
    expect(url).toContain("page=1");
    // No status filter — the poll must surface DELETED payments so the void
    // path fires; AUTHORISED-only would make deletes unreachable.
    expect(decodeURIComponent(url)).not.toContain("where=Status");
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    // Whole-second UTC (milliseconds dropped) sent as If-Modified-Since.
    expect(headers["If-Modified-Since"]).toBe(
      new Date("2026-08-01T10:15:30Z").toUTCString()
    );

    expect(changes).toEqual([
      {
        entityType: "payment",
        remoteId: "bill:bill-remote-1:pay-ap-1",
        updatedAt: new Date(1785542400000).toISOString(),
        dependsOnMapping: { entityType: "bill", remoteId: "bill-remote-1" }
      },
      {
        entityType: "payment",
        remoteId: "inv-remote-1:pay-ar-1",
        updatedAt: new Date(1785542400000).toISOString(),
        dependsOnMapping: { entityType: "invoice", remoteId: "inv-remote-1" }
      }
    ]);
  });

  it("skips a payment with no settled invoice", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Payments: [
          {
            PaymentID: "orphan-1",
            Amount: 10,
            Status: "AUTHORISED",
            UpdatedDateUTC: "/Date(1785542400000+0000)/"
          }
        ]
      })
    );

    const { changes } = await makeProvider().listChanges({ since: SINCE });
    expect(changes).toEqual([]);
  });

  it("surfaces both AUTHORISED and DELETED payments as changes (void reachable)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Payments: [
          {
            PaymentID: "pay-live-1",
            Amount: 500,
            Status: "AUTHORISED",
            PaymentType: "ACCPAYPAYMENT",
            Invoice: { InvoiceID: "bill-remote-1", Type: "ACCPAY" },
            UpdatedDateUTC: "/Date(1785542400000+0000)/"
          },
          {
            PaymentID: "pay-deleted-1",
            Amount: 125,
            Status: "DELETED",
            PaymentType: "ACCRECPAYMENT",
            Invoice: { InvoiceID: "inv-remote-1", Type: "ACCREC" },
            UpdatedDateUTC: "/Date(1785628800000+0000)/"
          }
        ]
      })
    );

    const { changes } = await makeProvider().listChanges({ since: SINCE });

    // Both statuses become payment changes; the DELETED one still carries its
    // invoice dependency so the sweep can resolve the local document mapping.
    expect(changes).toEqual([
      {
        entityType: "payment",
        remoteId: "bill:bill-remote-1:pay-live-1",
        updatedAt: new Date(1785542400000).toISOString(),
        dependsOnMapping: { entityType: "bill", remoteId: "bill-remote-1" }
      },
      {
        entityType: "payment",
        remoteId: "inv-remote-1:pay-deleted-1",
        updatedAt: new Date(1785628800000).toISOString(),
        dependsOnMapping: { entityType: "invoice", remoteId: "inv-remote-1" }
      }
    ]);
  });
});

describe("buildXeroSyncConfig — payment force-enable (pull-only)", () => {
  it("force-enables `payment` as pull-only even when the stored config disables it", () => {
    // DEFAULT_SYNC_CONFIG ships `payment` disabled — the provider must override
    // it so inbound payment sync-back works as soon as the integration connects.
    expect(DEFAULT_SYNC_CONFIG.entities.payment.enabled).toBe(false);

    const stored = structuredClone(DEFAULT_SYNC_CONFIG);
    stored.entities.payment = {
      enabled: false,
      direction: "two-way",
      owner: "carbon"
    };

    expect(buildXeroSyncConfig(stored).entities.payment).toEqual({
      enabled: true,
      direction: "pull-from-accounting",
      owner: "accounting"
    });
  });

  it("exposes the forced payment config through a constructed provider's getSyncConfig", () => {
    expect(makeProvider().getSyncConfig("payment")).toEqual({
      enabled: true,
      direction: "pull-from-accounting",
      owner: "accounting"
    });
  });
});
