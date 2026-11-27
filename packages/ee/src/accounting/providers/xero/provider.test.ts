// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { remoteCreateKey } from "../../core/create-key";
import { DEFAULT_SYNC_CONFIG } from "../../core/models";
import { AccountingApiError, RatelimitError } from "../../core/utils";
import {
  buildXeroSyncConfig,
  toXeroTaxRateOptions,
  XeroProvider
} from "./provider";

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

describe("buildXeroSyncConfig — payment force-enable (two-way)", () => {
  it("force-enables `payment` as two-way even when the stored config disables it", () => {
    // DEFAULT_SYNC_CONFIG ships `payment` disabled — the provider must override
    // it so two-way payment sync (Phase G push + inbound pull) works as soon as the
    // integration connects.
    expect(DEFAULT_SYNC_CONFIG.entities.payment.enabled).toBe(false);

    const stored = structuredClone(DEFAULT_SYNC_CONFIG);
    stored.entities.payment = {
      enabled: false,
      direction: "two-way",
      owner: "carbon"
    };

    expect(buildXeroSyncConfig(stored).entities.payment).toEqual({
      enabled: true,
      direction: "two-way",
      owner: "accounting"
    });
  });

  it("exposes the forced payment config through a constructed provider's getSyncConfig", () => {
    expect(makeProvider().getSyncConfig("payment")).toEqual({
      enabled: true,
      direction: "two-way",
      owner: "accounting"
    });
  });
});

describe("buildXeroSyncConfig — Carbon-owned master + documents", () => {
  it.each(["customer", "vendor", "item", "invoice", "bill"] as const)(
    "forces `%s` to push-only + owner carbon regardless of the stored config",
    (entityType) => {
      const stored = structuredClone(DEFAULT_SYNC_CONFIG);
      // Pretend the company had previously set this entity accounting-owned
      // two-way (the old Source of Truth default) — the force must override it.
      stored.entities[entityType] = {
        enabled: true,
        direction: "two-way",
        owner: "accounting"
      };

      expect(buildXeroSyncConfig(stored).entities[entityType]).toEqual({
        enabled: true,
        direction: "push-to-accounting",
        owner: "carbon"
      });
    }
  );

  it("preserves the per-company `enabled` flag while forcing ownership", () => {
    const stored = structuredClone(DEFAULT_SYNC_CONFIG);
    stored.entities.bill = {
      enabled: false,
      direction: "two-way",
      owner: "accounting"
    };

    expect(buildXeroSyncConfig(stored).entities.bill).toEqual({
      enabled: false,
      direction: "push-to-accounting",
      owner: "carbon"
    });
  });

  it("leaves payment accounting-owned and does not touch unforced entities", () => {
    const applied = buildXeroSyncConfig(structuredClone(DEFAULT_SYNC_CONFIG));
    // payment stays the accounting-owned pull-only exception
    expect(applied.entities.payment.owner).toBe("accounting");
    // purchaseOrder is neither Carbon-owned-forced nor payment — passes through
    expect(applied.entities.purchaseOrder).toEqual(
      DEFAULT_SYNC_CONFIG.entities.purchaseOrder
    );
  });
});

describe("XeroProvider counterpart candidates", () => {
  it("searches contacts by exact name and maps them to candidates", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Contacts: [
          { ContactID: "contact-1", Name: "Acme Tooling" },
          // No ContactID — Xero has nothing to link to, so it is not a candidate.
          { Name: "Acme Tooling" }
        ]
      })
    );

    const candidates = await makeProvider().findRemoteCandidates("vendor", {
      name: "Acme Tooling"
    });

    expect(decodeURIComponent(String(fetchMock.mock.calls[0]?.[0]))).toBe(
      'https://api.xero.com/api.xro/2.0/Contacts?where=Name=="Acme Tooling"'
    );
    expect(candidates).toEqual([
      { remoteId: "contact-1", name: "Acme Tooling" }
    ]);
  });

  it("escapes double quotes in the where filter", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Contacts: [] }));

    await makeProvider().findRemoteCandidates("customer", {
      name: 'The "Big" Co'
    });

    expect(decodeURIComponent(String(fetchMock.mock.calls[0]?.[0]))).toContain(
      'Name=="The \\"Big\\" Co"'
    );
  });

  it("percent-encodes the where filter so a name cannot break the query", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Contacts: [] }));

    // Every one of these is ordinary in a counterparty name.
    await makeProvider().findRemoteCandidates("vendor", {
      name: "Smith & Sons + Co #2"
    });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    // A bare `&` ends the `where` parameter early and adds a junk one; a bare
    // `#` starts a fragment, which fetch never sends at all.
    expect(url).not.toMatch(/[&#]/);
    // And the whole name still reaches Xero, `+` included (a raw `+` in a query
    // string decodes as a space).
    expect(new URL(url).searchParams.get("where")).toBe(
      'Name=="Smith & Sons + Co #2"'
    );
  });

  it("throws rather than reporting no match when the search fails", async () => {
    // Returning [] here would read as "no such contact" and create a duplicate.
    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: "boom" }, 500));

    await expect(
      makeProvider().findRemoteCandidates("vendor", { name: "Acme" })
    ).rejects.toThrow();
  });

  it("does not call Xero without a name, or for an unsupported kind", async () => {
    const provider = makeProvider();

    expect(
      await provider.findRemoteCandidates("vendor", { name: "  " })
    ).toEqual([]);
    expect(
      await provider.findRemoteCandidates("account", { name: "Acme" })
    ).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("XeroProvider master-data enumeration", () => {
  it("filters customers and suppliers separately, not with listContacts' OR", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Contacts: [
          { ContactID: "c-1", Name: "Acme" },
          { Name: "no id — nothing to link to" }
        ]
      })
    );

    const ids = await makeProvider().listRemoteEntityIds("customer");

    const url = decodeURIComponent(String(fetchMock.mock.calls[0]?.[0]));
    expect(url).toContain("where=IsCustomer==true");
    // The OR filter would import supplier-only contacts as Carbon customers.
    expect(url).not.toContain("IsSupplier");
    expect(ids).toEqual(["c-1"]);
  });

  it("uses the supplier filter for vendors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Contacts: [] }));

    await makeProvider().listRemoteEntityIds("vendor");

    const url = decodeURIComponent(String(fetchMock.mock.calls[0]?.[0]));
    expect(url).toContain("where=IsSupplier==true");
    expect(url).not.toContain("IsCustomer");
  });

  it("pages until a short page and stops", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      ContactID: `c-${i}`,
      Name: `Contact ${i}`
    }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ Contacts: full }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Contacts: [{ ContactID: "c-100", Name: "Last" }] })
    );

    const ids = await makeProvider().listRemoteEntityIds("customer");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(String(fetchMock.mock.calls[1]?.[0]))).toContain(
      "page=2"
    );
    expect(ids).toHaveLength(101);
  });

  it("throws on a failed page rather than returning a partial list", async () => {
    // A partial list read as complete silently imports a subset.
    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: "boom" }, 500));

    await expect(
      makeProvider().listRemoteEntityIds("customer")
    ).rejects.toThrow();
  });

  it("throws at the page cap rather than returning a partial list", async () => {
    // XERO_IMPORT_MAX_PAGES full pages: the walk never saw a short page, so it
    // has no evidence these are every contact — and the master-data import
    // would report a successful import of the subset it was handed.
    const full = Array.from({ length: 100 }, (_, i) => ({
      ContactID: `c-${i}`,
      Name: `Contact ${i}`
    }));
    // A fresh Response per call — a body can only be read once.
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ Contacts: full }))
    );

    await expect(
      makeProvider().listRemoteEntityIds("customer")
    ).rejects.toThrow(/refusing to import a partial list/);
    expect(fetchMock).toHaveBeenCalledTimes(100);
  });
});

describe("XeroProvider tax rates", () => {
  const OUTPUT2 = {
    Name: "20% (VAT on Income)",
    TaxType: "OUTPUT2",
    ReportTaxType: "OUTPUT",
    Status: "ACTIVE" as const,
    EffectiveRate: 20,
    CanApplyToRevenue: true,
    CanApplyToExpenses: false
  };
  const INPUT2 = {
    Name: "20% (VAT on Expenses)",
    TaxType: "INPUT2",
    ReportTaxType: "INPUT",
    Status: "ACTIVE" as const,
    EffectiveRate: 20,
    CanApplyToRevenue: false,
    CanApplyToExpenses: true
  };
  const DELETED = { ...OUTPUT2, TaxType: "TAX001", Status: "DELETED" as const };

  it("lists the organisation's ACTIVE tax rates", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ TaxRates: [OUTPUT2, INPUT2, DELETED] })
    );
    const rates = await makeProvider().listTaxRates();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.xero.com/api.xro/2.0/TaxRates"
    );
    expect(rates.map((r) => r.TaxType)).toEqual(["OUTPUT2", "INPUT2"]);
  });

  it("returns [] on failure (forgiving settings-surface contract)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: "boom" }, 500));
    await expect(makeProvider().listTaxRates()).resolves.toEqual([]);
  });

  it("offers a revenue rate for sales and an expense rate for purchases", () => {
    expect(toXeroTaxRateOptions([OUTPUT2, INPUT2])).toMatchObject([
      {
        id: "OUTPUT2",
        name: "20% (VAT on Income)",
        rate: 0.2,
        direction: "sales"
      },
      {
        id: "INPUT2",
        name: "20% (VAT on Expenses)",
        rate: 0.2,
        direction: "purchase"
      }
    ]);
  });

  it("carries ReportTaxType and the account classes the rate applies to", () => {
    const [option] = toXeroTaxRateOptions([
      {
        ...INPUT2,
        ReportTaxType: "INPUT",
        CanApplyToAssets: true,
        CanApplyToLiabilities: false
      }
    ]);
    expect(option).toMatchObject({
      reportTaxType: "INPUT",
      canApplyTo: { asset: true, liability: false, expense: true }
    });
  });
});

describe("XeroProvider invoice and bill writes", () => {
  const SUPPLIER = "11111111-2222-3333-4444-555555555555";
  const OTHER_SUPPLIER = "99999999-8888-7777-6666-555555555555";
  const key = (localId: string) =>
    remoteCreateKey({ companyId: "company-1", operation: "bill", localId });
  const bill = (invoiceNumber = "AP000001") =>
    ({
      Type: "ACCPAY",
      InvoiceNumber: invoiceNumber,
      Contact: { ContactID: SUPPLIER },
      LineItems: [{ Description: "Edited", Quantity: 1, UnitAmount: 12 }]
    }) as never;
  const invoice = {
    Type: "ACCREC",
    InvoiceNumber: "INV000001",
    Contact: { ContactID: SUPPLIER },
    LineItems: [{ Description: "Sold", Quantity: 1, UnitAmount: 30 }]
  } as never;

  function sent(call: number) {
    const [url, init] = fetchMock.mock.calls[call] ?? [];
    const parsed = new URL(String(url));
    return {
      method: init?.method,
      path: parsed.pathname.replace("/api.xro/2.0", "") + parsed.search,
      where: parsed.searchParams.get("where"),
      key: (init?.headers as Record<string, string>)["Idempotency-Key"],
      body: init?.body ? JSON.parse(String(init.body)) : undefined
    };
  }

  // An earlier attempt may have sent an older payload before its response
  // was lost: the bill it left is brought up to date, not returned as is.
  it("updates the supplier's bill an earlier attempt created with the payload this attempt sends", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          Invoices: [
            {
              InvoiceID: "other-supplier-bill",
              Type: "ACCPAY",
              InvoiceNumber: "AP000001",
              Contact: { ContactID: OTHER_SUPPLIER },
              Status: "AUTHORISED"
            },
            {
              InvoiceID: "bill-remote",
              Type: "ACCPAY",
              InvoiceNumber: "AP000001",
              Contact: { ContactID: SUPPLIER },
              Status: "AUTHORISED"
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ Invoices: [{ InvoiceID: "bill-remote" }] })
      );

    const id = await makeProvider().upsertInvoiceDocument({
      type: "ACCPAY",
      data: bill(),
      existingRemoteId: null,
      mayExist: true,
      key: key("bill-1")
    });

    expect(id).toBe("bill-remote");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(0)).toMatchObject({
      method: "GET",
      where: `Type=="ACCPAY" AND InvoiceNumber=="AP000001" AND Contact.ContactID==guid("${SUPPLIER}") AND Status!="DELETED" AND Status!="VOIDED"`
    });
    expect(sent(1)).toEqual({
      method: "POST",
      path: "/Invoices?unitdp=4",
      where: null,
      key: undefined,
      body: { Invoices: [{ ...(bill() as object), InvoiceID: "bill-remote" }] }
    });
  });

  // Xero refuses an edit to a document it has applied a payment or a credit
  // note to, so an update would fail every retry and never link it.
  it.each([
    { Status: "PAID", AmountPaid: 30 },
    { Status: "AUTHORISED", AmountPaid: 10 },
    { Status: "AUTHORISED", AmountPaid: 0, AmountCredited: 5 }
  ])(
    "links an earlier attempt's invoice that Xero has settled (%o) without writing it",
    async (settled) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          Invoices: [
            {
              InvoiceID: "invoice-remote",
              Type: "ACCREC",
              InvoiceNumber: "INV000001",
              Contact: { ContactID: SUPPLIER },
              ...settled
            }
          ]
        })
      );

      const id = await makeProvider().upsertInvoiceDocument({
        type: "ACCREC",
        data: invoice,
        existingRemoteId: null,
        mayExist: true,
        key: key("invoice-1")
      });

      expect(id).toBe("invoice-remote");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sent(0).method).toBe("GET");
    }
  );

  it("creates a sales invoice on a first attempt without looking it up", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Invoices: [{ InvoiceID: "invoice-remote" }] })
    );

    const id = await makeProvider().upsertInvoiceDocument({
      type: "ACCREC",
      data: invoice,
      existingRemoteId: null,
      mayExist: false,
      key: key("invoice-1")
    });

    expect(id).toBe("invoice-remote");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(0)).toEqual({
      method: "POST",
      path: "/Invoices?unitdp=4",
      where: null,
      key: key("invoice-1"),
      body: { Invoices: [invoice] }
    });
  });

  // One request for the batch keeps a drain inside Xero's call limit; a
  // document Xero refuses fails on its own, and the others are returned.
  // Xero keeps a key for six minutes and refuses it on a different request,
  // so the same documents re-sent with a fix must not reuse the first key.
  it("keys a batch by the request it sends", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ Invoices: [{ InvoiceID: "bill-a" }] })
    );
    const write = (description: string) =>
      makeProvider().upsertInvoiceDocuments({
        type: "ACCPAY",
        documents: [
          {
            localId: "a",
            data: {
              ...(bill("AP-a") as object),
              LineItems: [
                { Description: description, Quantity: 1, UnitAmount: 12 }
              ]
            } as never,
            existingRemoteId: null,
            mayExist: false,
            key: key("a")
          }
        ],
        batchKey: key("a")
      });

    await write("First");
    await write("First");
    await write("Fixed");

    const [first, repeat, fixed] = [0, 1, 2].map((call) => sent(call).key);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(repeat).toBe(first);
    expect(fixed).not.toBe(first);
  });

  it("reports Xero's problem detail when it refuses a whole batch", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          Title: "BadRequest",
          Status: 400,
          Detail: "Idempotency Key: abc is used with a different request."
        },
        400
      )
    );

    const outcomes = await makeProvider().upsertInvoiceDocuments({
      type: "ACCPAY",
      documents: [
        {
          localId: "a",
          data: bill("AP-a"),
          existingRemoteId: null,
          mayExist: false,
          key: key("a")
        }
      ],
      batchKey: key("a")
    });

    expect(
      String((outcomes.get("a") as { error: Error }).error.message)
    ).toContain("is used with a different request");
  });

  it("writes a batch's first attempts in one request and reports each document's refusal on its own", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Invoices: [
          { InvoiceID: "bill-a", StatusAttributeString: "OK" },
          {
            StatusAttributeString: "ERROR",
            HasErrors: true,
            ValidationErrors: [{ Message: "Account code '999' is not valid" }]
          },
          { InvoiceID: "bill-c", StatusAttributeString: "OK" }
        ]
      })
    );

    const outcomes = await makeProvider().upsertInvoiceDocuments({
      type: "ACCPAY",
      documents: ["a", "b", "c"].map((localId) => ({
        localId,
        data: bill(`AP-${localId}`),
        existingRemoteId: null,
        mayExist: false,
        key: key(localId)
      })),
      batchKey: key("a,b,c")
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(0)).toMatchObject({
      method: "POST",
      path: "/Invoices?unitdp=4&summarizeErrors=false"
    });
    expect(outcomes.get("a")).toBe("bill-a");
    expect(outcomes.get("b")).toEqual({
      error: expect.any(AccountingApiError)
    });
    expect(
      String((outcomes.get("b") as { error: Error }).error.message)
    ).toContain("Account code '999' is not valid");
    expect(outcomes.get("c")).toBe("bill-c");
  });

  it("looks up an unmapped bill an earlier attempt may have created on its own, after the batch", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ Invoices: [{ InvoiceID: "bill-a" }] })
      )
      .mockResolvedValueOnce(jsonResponse({ Invoices: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ Invoices: [{ InvoiceID: "bill-b" }] })
      );

    const outcomes = await makeProvider().upsertInvoiceDocuments({
      type: "ACCPAY",
      documents: [
        {
          localId: "a",
          data: bill("AP-a"),
          existingRemoteId: null,
          mayExist: false,
          key: key("a")
        },
        {
          localId: "b",
          data: bill("AP-b"),
          existingRemoteId: null,
          mayExist: true,
          key: key("b")
        }
      ],
      batchKey: key("a,b")
    });

    expect(
      fetchMock.mock.calls.map(
        (_, i) => `${sent(i).method} ${sent(i).path.split("?")[0]}`
      )
    ).toEqual(["POST /Invoices", "GET /Invoices", "POST /Invoices"]);
    expect(sent(1).where).toContain('InvoiceNumber=="AP-b"');
    expect(sent(2)).toMatchObject({
      key: key("b"),
      body: { Invoices: [bill("AP-b")] }
    });
    expect([...outcomes]).toEqual([
      ["a", "bill-a"],
      ["b", "bill-b"]
    ]);
  });

  it("stops at a rate limit, and the documents it did not write report it", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("{}", { status: 429, headers: { "Retry-After": "30" } })
    );

    const outcomes = await makeProvider().upsertInvoiceDocuments({
      type: "ACCPAY",
      documents: [
        {
          localId: "a",
          data: bill("AP-a"),
          existingRemoteId: null,
          mayExist: false,
          key: key("a")
        },
        {
          localId: "b",
          data: bill("AP-b"),
          existingRemoteId: null,
          mayExist: true,
          key: key("b")
        }
      ],
      batchKey: key("a,b")
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcomes.get("a")).toEqual({ error: expect.any(RatelimitError) });
    expect(outcomes.get("b")).toEqual({ error: expect.any(RatelimitError) });
  });
});
