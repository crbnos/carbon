import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SYNC_CONFIG } from "../../../../core/models";
import { JournalEntrySyncError } from "../../../../core/posting";
import { XeroProvider } from "../../provider";
import {
  buildXeroCreditNoteLineItem,
  CreditMemoSyncer,
  XERO_MEMO_INCREASER_SKIP_REASON,
  type XeroCreditNoteWrite,
  type XeroMemoSource
} from "../credit-memo";
import { VendorCreditSyncer } from "../vendor-credit";

/**
 * Xero represents a Carbon memo as a credit note: an AccountCode-coded single
 * line (no item — Xero is the one provider that needs none), born AUTHORISED so
 * it is allocatable, with a Contact carrying ContactID ONLY.
 */

const CODES: ReadonlyMap<string, string> = new Map([["acct_reason", "4400"]]);

const memo = (overrides: Partial<XeroMemoSource> = {}): XeroMemoSource => ({
  id: "memo_1",
  memoId: "CM000001",
  direction: "Debit",
  status: "Posted",
  customerId: null,
  supplierId: "sup_1",
  memoDate: "2026-09-20",
  postingDate: "2026-09-21",
  currencyCode: "USD",
  exchangeRate: 1,
  amount: 250,
  reasonAccount: "acct_reason",
  reference: "RMA-9",
  notes: "Returned goods",
  updatedAt: "2026-09-21T00:00:00.000Z",
  applications: [],
  ...overrides
});

// Table-dispatching Kysely fake for the mapToRemote drive (mirrors bill.test.ts).
function makeCreditNoteDb(
  accountMappings: Array<{
    id: string;
    accountId: string;
    externalId: string | null;
    metadata: unknown;
    lastSyncedAt: string | null;
    accountNumber: string | null;
    accountName: string | null;
  }> = [
    {
      id: "m-1",
      accountId: "acct_reason",
      externalId: "reason-remote",
      metadata: { externalCode: "4400" },
      lastSyncedAt: null,
      accountNumber: "4400",
      accountName: "Sales Discounts"
    }
  ]
) {
  const makeBuilder = (table: string) => {
    const builder: any = {
      select: () => builder,
      innerJoin: () => builder,
      leftJoin: () => builder,
      where: () => builder,
      orderBy: () => builder,
      async execute() {
        if (table === "externalIntegrationMapping as m") return accountMappings;
        return [];
      },
      async executeTakeFirst() {
        if (table === "company")
          return { baseCurrencyCode: "USD", companyGroupId: "group-1" };
        return undefined;
      }
    };
    return builder;
  };
  return { selectFrom: (t: string) => makeBuilder(t) } as never;
}

type DrivenSyncer = {
  mapToRemote(local: XeroMemoSource): Promise<XeroCreditNoteWrite>;
  shouldSync(context: {
    direction: "push" | "pull";
    localEntity: XeroMemoSource;
    isFirstSync: boolean;
    entityId: string;
  }): boolean | string;
};

function makeSyncer(
  Syncer: typeof CreditMemoSyncer | typeof VendorCreditSyncer,
  entityType: "creditMemo" | "vendorCredit",
  db: never = makeCreditNoteDb()
): DrivenSyncer {
  const syncer = new Syncer({
    database: db,
    companyId: "company-1",
    provider: { id: "xero", settings: {} } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType
  });
  const patched = syncer as unknown as Record<string, unknown>;
  patched.getRemoteId = async () => null;
  patched.ensureDependencySynced = async (type: string, id: string) =>
    type === "customer" || type === "vendor" ? "contact-1" : `xero-${id}`;
  return syncer as unknown as DrivenSyncer;
}

const drive = (context: {
  direction: "push" | "pull";
  localEntity: XeroMemoSource;
}) => ({ ...context, isFirstSync: true, entityId: context.localEntity.id });

describe("buildXeroCreditNoteLineItem (AccountCode-coded, no item)", () => {
  it("codes the reason account directly, quantity 1, tax-neutral", () => {
    expect(
      buildXeroCreditNoteLineItem({ memo: memo(), accountCodesById: CODES })
    ).toEqual({
      Description: "Returned goods",
      Quantity: 1,
      UnitAmount: 250,
      AccountCode: "4400",
      TaxType: "NONE"
    });
  });

  it("never emits an ItemCode — Xero codes the line by account alone", () => {
    const line = buildXeroCreditNoteLineItem({
      memo: memo(),
      accountCodesById: CODES
    });
    expect("ItemCode" in line).toBe(false);
  });

  it("warns (UNMAPPED_ACCOUNTS) when the reason account has no Xero mapping", () => {
    try {
      buildXeroCreditNoteLineItem({
        memo: memo(),
        accountCodesById: new Map()
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      const failure = (error as JournalEntrySyncError).failure;
      expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
      expect(failure.warning).toBe(true);
    }
  });

  it("warns when the memo has no reason account (never posted)", () => {
    expect(() =>
      buildXeroCreditNoteLineItem({
        memo: memo({ reasonAccount: null }),
        accountCodesById: CODES
      })
    ).toThrowError(JournalEntrySyncError);
  });

  it("refuses sub-cent principal instead of letting Xero round it away", () => {
    expect(() =>
      buildXeroCreditNoteLineItem({
        memo: memo({ amount: 250.005 }),
        accountCodesById: CODES
      })
    ).toThrow(/Xero.*precision|Xero.*decimal/i);
  });
});

describe("VendorCreditSyncer.mapToRemote (ACCPAYCREDIT)", () => {
  it("builds a supplier memo of 250 as an AUTHORISED ACCPAYCREDIT with one account-coded line", async () => {
    const payload = await makeSyncer(
      VendorCreditSyncer,
      "vendorCredit"
    ).mapToRemote(memo());

    expect(payload.Type).toBe("ACCPAYCREDIT");
    // Must be born AUTHORISED — Xero will not allocate a DRAFT credit note.
    expect(payload.Status).toBe("AUTHORISED");
    expect(payload.LineItems).toEqual([
      {
        Description: "Returned goods",
        Quantity: 1,
        UnitAmount: 250,
        AccountCode: "4400",
        TaxType: "NONE"
      }
    ]);
    // ContactID ONLY: any other contact field mutates the Xero contact record
    // and deletes its ContactPersons.
    expect(payload.Contact).toEqual({ ContactID: "contact-1" });
    expect(Object.keys(payload.Contact)).toEqual(["ContactID"]);
    // ACCPAYCREDIT has no Reference field — the Carbon memo id rides on
    // CreditNoteNumber instead.
    expect(payload.CreditNoteNumber).toBe("CM000001");
    expect(payload.Reference).toBeUndefined();
    expect(payload.Date).toBe("2026-09-21");
    // Base currency: no rate pinned.
    expect(payload.CurrencyRate).toBeUndefined();
  });

  it("pins CurrencyRate on a foreign memo, including a 1:1 snapshot", async () => {
    const foreign = await makeSyncer(
      VendorCreditSyncer,
      "vendorCredit"
    ).mapToRemote(memo({ currencyCode: "EUR", exchangeRate: 0.8 }));
    expect(foreign.CurrencyCode).toBe("EUR");
    expect(foreign.CurrencyRate).toBe(0.8);

    const identity = await makeSyncer(
      VendorCreditSyncer,
      "vendorCredit"
    ).mapToRemote(memo({ currencyCode: "EUR", exchangeRate: 1 }));
    expect(identity.CurrencyRate).toBe(1);
  });
});

describe("CreditMemoSyncer.mapToRemote (ACCRECCREDIT)", () => {
  const customerMemo = (overrides: Partial<XeroMemoSource> = {}) =>
    memo({
      direction: "Credit",
      customerId: "cus_1",
      supplierId: null,
      ...overrides
    });

  it("builds a customer memo as an AUTHORISED ACCRECCREDIT and keeps its Reference", async () => {
    const payload = await makeSyncer(
      CreditMemoSyncer,
      "creditMemo"
    ).mapToRemote(customerMemo());

    expect(payload.Type).toBe("ACCRECCREDIT");
    expect(payload.Status).toBe("AUTHORISED");
    expect(payload.CreditNoteNumber).toBe("CM000001");
    // Only the AR type carries Reference; Xero rejects it on an ACCPAYCREDIT.
    expect(payload.Reference).toBe("RMA-9");
    expect(payload.Contact).toEqual({ ContactID: "contact-1" });
    expect(payload.LineItems).toHaveLength(1);
    expect(payload.LineItems[0]?.AccountCode).toBe("4400");
  });
});

describe("shouldSync — the v1 increaser limitation", () => {
  // Task 7 step 7: the canonical rule all three providers share. Each closes
  // Skipped WITH a reason, never a silent drop and never a malformed push.
  it("skips a supplier + Credit memo (AP UP) naming the v1 limitation", () => {
    const result = makeSyncer(VendorCreditSyncer, "vendorCredit").shouldSync(
      drive({
        direction: "push",
        localEntity: memo({ direction: "Credit" })
      })
    );
    expect(result).toContain(XERO_MEMO_INCREASER_SKIP_REASON);
  });

  it("skips a customer + Debit memo (AR UP) naming the v1 limitation", () => {
    const result = makeSyncer(CreditMemoSyncer, "creditMemo").shouldSync(
      drive({
        direction: "push",
        localEntity: memo({
          direction: "Debit",
          customerId: "cus_1",
          supplierId: null
        })
      })
    );
    expect(result).toContain(XERO_MEMO_INCREASER_SKIP_REASON);
  });

  it("syncs the two decreasers", () => {
    expect(
      makeSyncer(VendorCreditSyncer, "vendorCredit").shouldSync(
        drive({ direction: "push", localEntity: memo() })
      )
    ).toBe(true);
    expect(
      makeSyncer(CreditMemoSyncer, "creditMemo").shouldSync(
        drive({
          direction: "push",
          localEntity: memo({
            direction: "Credit",
            customerId: "cus_1",
            supplierId: null
          })
        })
      )
    ).toBe(true);
  });
});

describe("shouldSync — the remaining push gates", () => {
  it("asserts its own party rather than pushing the wrong credit-note Type", () => {
    const result = makeSyncer(CreditMemoSyncer, "creditMemo").shouldSync(
      drive({ direction: "push", localEntity: memo() }) // supplier memo
    );
    expect(result).toContain("has no customer");
  });

  it("skips a Draft memo", () => {
    const result = makeSyncer(VendorCreditSyncer, "vendorCredit").shouldSync(
      drive({
        direction: "push",
        localEntity: memo({ status: "Draft" })
      })
    );
    expect(result).toContain("must be posted");
  });

  it("parks a cross-currency application rather than guessing the allocation", () => {
    const result = makeSyncer(VendorCreditSyncer, "vendorCredit").shouldSync(
      drive({
        direction: "push",
        localEntity: memo({
          applications: [
            {
              id: "is_1",
              appliedDate: "2026-09-21",
              sourceAmount: 100,
              appliedAmount: 80,
              discountAmount: 0,
              writeOffAmount: 0,
              fxGainLossAmount: 0,
              sourceExchangeRate: 0.8,
              targetExchangeRate: 1,
              targetSalesInvoiceId: null,
              targetPurchaseInvoiceId: "pi_1"
            }
          ]
        })
      })
    );
    expect(result).toContain("cross-currency");
  });

  it("parks an application carrying a discount or write-off", () => {
    const result = makeSyncer(VendorCreditSyncer, "vendorCredit").shouldSync(
      drive({
        direction: "push",
        localEntity: memo({
          applications: [
            {
              id: "is_2",
              appliedDate: "2026-09-21",
              sourceAmount: 100,
              appliedAmount: 100,
              discountAmount: 5,
              writeOffAmount: 0,
              fxGainLossAmount: 0,
              sourceExchangeRate: 1,
              targetExchangeRate: 1,
              targetSalesInvoiceId: null,
              targetPurchaseInvoiceId: "pi_1"
            }
          ]
        })
      })
    );
    expect(result).toContain("discount");
  });
});

/**
 * The real external boundary here is the Xero HTTP API, so these drive a REAL
 * XeroProvider with `fetch` stubbed — no hand-rolled provider fake, no
 * assertions about which method was called on a puppet
 * (`.claude/rules/testing-no-mock-theater.md`).
 */
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

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
    tenantId: "tenant-1",
    syncConfig: DEFAULT_SYNC_CONFIG
  });
}

const requestOf = (index: number) => ({
  url: String(fetchMock.mock.calls[index]?.[0]),
  method: fetchMock.mock.calls[index]?.[1]?.method,
  body: JSON.parse(String(fetchMock.mock.calls[index]?.[1]?.body ?? "null")),
  headers: (fetchMock.mock.calls[index]?.[1]?.headers ?? {}) as Record<
    string,
    string
  >
});

describe("XeroProvider credit notes", () => {
  it("creates AUTHORISED even when the caller asks for something else", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ CreditNotes: [{ CreditNoteID: "cn-1" }] })
    );

    await makeProvider().createCreditNote(
      {
        Type: "ACCPAYCREDIT",
        CreditNoteNumber: "CM000001",
        Contact: { ContactID: "contact-1" },
        // A credit note Xero will not allocate — the client must override it.
        Status: "DRAFT",
        LineItems: [{ Quantity: 1, UnitAmount: 250, AccountCode: "4400" }]
      },
      { idempotencyKey: "key-1" }
    );

    const request = requestOf(0);
    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      "https://api.xero.com/api.xro/2.0/CreditNotes?unitdp=4"
    );
    expect(request.body.CreditNotes[0].Status).toBe("AUTHORISED");
    // Transient-network guard only; Xero expires the key after six minutes.
    expect(request.headers["Idempotency-Key"]).toBe("key-1");
  });

  it("allocates with a SEPARATE PUT to the credit note's Allocations collection", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Allocations: [{ AllocationID: "alloc-1", Amount: 100 }] })
    );

    const allocation = await makeProvider().allocateCreditNote("cn-1", {
      Invoice: { InvoiceID: "inv-1" },
      Amount: 100,
      Date: "2026-09-21"
    });

    const request = requestOf(0);
    // PUT, not POST, and a second round-trip — Xero forbids create-and-allocate
    // in one request.
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(
      "https://api.xero.com/api.xro/2.0/CreditNotes/cn-1/Allocations"
    );
    expect(request.body).toEqual({
      Allocations: [
        { Invoice: { InvoiceID: "inv-1" }, Amount: 100, Date: "2026-09-21" }
      ]
    });
    expect(allocation.AllocationID).toBe("alloc-1");
  });

  it("refuses to pick between duplicate credit notes on a recovery read", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        CreditNotes: [{ CreditNoteID: "cn-1" }, { CreditNoteID: "cn-2" }]
      })
    );

    await expect(
      makeProvider().getCreditNoteByNumber("CM000001")
    ).rejects.toThrow(/Multiple Xero credit notes/);
  });
});

describe("VendorCreditSyncer.upsertRemote (create once, never duplicate)", () => {
  const payload = (): XeroCreditNoteWrite =>
    ({
      Type: "ACCPAYCREDIT",
      CreditNoteNumber: "CM000001",
      Contact: { ContactID: "contact-1" },
      Date: "2026-09-21",
      Status: "AUTHORISED",
      CurrencyCode: "USD",
      LineItems: [
        {
          Description: "Returned goods",
          Quantity: 1,
          UnitAmount: 250,
          AccountCode: "4400",
          TaxType: "NONE"
        }
      ]
    }) as XeroCreditNoteWrite;

  function makeUnmappedSyncer() {
    const syncer = makeSyncer(VendorCreditSyncer, "vendorCredit");
    const patched = syncer as unknown as Record<string, any>;
    patched.provider = makeProvider();
    // No applications: this drives the create path only, so no allocation and
    // no mapping write is reached.
    patched.fetchLocal = async () => memo();
    return patched;
  }

  it("reads by CreditNoteNumber BEFORE creating — the create-succeeded-mapping-failed recovery", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ CreditNotes: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ CreditNotes: [{ CreditNoteID: "cn-1" }] })
      );

    expect(await makeUnmappedSyncer().upsertRemote(payload(), "memo_1")).toBe(
      "cn-1"
    );

    expect(requestOf(0).method).toBe("GET");
    expect(requestOf(0).url).toContain("/CreditNotes?where=");
    expect(requestOf(0).url).toContain("CreditNoteNumber");
    expect(requestOf(1).method).toBe("POST");
  });

  it("reuses the credit note the recovery read finds instead of creating a duplicate", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        CreditNotes: [
          {
            CreditNoteID: "cn-existing",
            Type: "ACCPAYCREDIT",
            Status: "AUTHORISED"
          }
        ]
      })
    );

    expect(await makeUnmappedSyncer().upsertRemote(payload(), "memo_1")).toBe(
      "cn-existing"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
