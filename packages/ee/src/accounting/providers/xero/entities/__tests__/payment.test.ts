import { describe, expect, it, vi } from "vitest";
import type { NormalizedPayment } from "../../../../core/payment-application";
import { SyncFactory } from "../../../../core/sync";
import type { Xero } from "../../models";
// Importing the provider barrel registers the Xero syncer registry (side
// effect) so SyncFactory.getSyncer can resolve `payment`.
import "../../index";
import {
  getXeroBillPaymentSyncEntityId,
  getXeroPaymentDate,
  getXeroPaymentSyncEntityId,
  parseXeroPaymentSyncEntityId,
  XeroPaymentSyncer
} from "../payment";

// The base dynamically imports @carbon/auth/client.server only when posting;
// mock it so nothing touches server env during these pure-mapper tests.
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({ functions: { invoke: vi.fn() } })
}));

describe("composite payment sync entity id (Xero)", () => {
  it("round-trips invoice + payment ids as a prefix-less AR id", () => {
    const entityId = getXeroPaymentSyncEntityId("inv-remote-1", "pay-1");
    expect(entityId).toBe("inv-remote-1:pay-1");
    expect(parseXeroPaymentSyncEntityId(entityId)).toEqual({
      family: "ar",
      documentRemoteId: "inv-remote-1",
      paymentRemoteId: "pay-1"
    });
  });

  it("round-trips bill + payment ids as a `bill:`-prefixed AP id", () => {
    const entityId = getXeroBillPaymentSyncEntityId("bill-remote-1", "pay-2");
    expect(entityId).toBe("bill:bill-remote-1:pay-2");
    expect(parseXeroPaymentSyncEntityId(entityId)).toEqual({
      family: "ap",
      documentRemoteId: "bill-remote-1",
      paymentRemoteId: "pay-2"
    });
  });

  it("throws on malformed ids (both families)", () => {
    expect(() => parseXeroPaymentSyncEntityId("no-separator")).toThrow(
      /Invalid Xero payment sync entity id/
    );
    expect(() => parseXeroPaymentSyncEntityId(":pay-1")).toThrow(
      /Invalid Xero payment sync entity id/
    );
    expect(() => parseXeroPaymentSyncEntityId("inv-1:")).toThrow(
      /Invalid Xero payment sync entity id/
    );
    expect(() => parseXeroPaymentSyncEntityId("bill:no-separator")).toThrow(
      /Invalid Xero payment sync entity id/
    );
  });
});

describe("getXeroPaymentDate", () => {
  it("takes the YYYY-MM-DD part of a plain date", () => {
    expect(getXeroPaymentDate("2026-08-01")).toBe("2026-08-01");
    expect(getXeroPaymentDate("2026-08-01T00:00:00")).toBe("2026-08-01");
  });

  it("parses a serialized .NET date defensively", () => {
    // 2026-08-01T00:00:00Z = 1785542400000 ms
    expect(getXeroPaymentDate("/Date(1785542400000+0000)/")).toBe("2026-08-01");
  });
});

function makeMapperSyncer() {
  const syncer = new XeroPaymentSyncer({
    database: {} as never,
    companyId: "company-1",
    provider: { id: "xero" } as never,
    config: {
      enabled: true,
      direction: "pull-from-accounting",
      owner: "accounting"
    },
    entityType: "payment"
  });
  return syncer as unknown as {
    mapToNormalized(remote: Xero.Payment, entityId: string): NormalizedPayment;
  };
}

describe("XeroPaymentSyncer.mapToNormalized", () => {
  it("normalizes an ACCPAY (bill) payment to a settled AP NormalizedPayment", () => {
    const normalized = makeMapperSyncer().mapToNormalized(
      {
        PaymentID: "pay-1",
        Amount: 500,
        Date: "2026-08-01",
        Status: "AUTHORISED",
        PaymentType: "ACCPAYPAYMENT",
        Invoice: {
          InvoiceID: "bill-remote-1",
          Type: "ACCPAY",
          CurrencyCode: "USD"
        },
        UpdatedDateUTC: "/Date(1785542400000+0000)/"
      },
      "bill:bill-remote-1:pay-1"
    );

    expect(normalized).toEqual({
      family: "ap",
      documentRemoteId: "bill-remote-1",
      paymentRemoteId: "pay-1",
      amount: 500,
      currencyCode: "USD",
      exchangeRate: 1,
      paidDate: "2026-08-01",
      reference: "pay-1",
      status: "settled"
    });
  });

  it("normalizes an ACCREC (sales invoice) payment to a settled AR NormalizedPayment", () => {
    const normalized = makeMapperSyncer().mapToNormalized(
      {
        PaymentID: "pay-2",
        Amount: 125,
        Date: "2026-07-15T00:00:00",
        Status: "AUTHORISED",
        PaymentType: "ACCRECPAYMENT",
        CurrencyRate: 1.1,
        Invoice: {
          InvoiceID: "inv-remote-1",
          Type: "ACCREC",
          CurrencyCode: "EUR"
        },
        UpdatedDateUTC: "/Date(1785542400000+0000)/"
      },
      "inv-remote-1:pay-2"
    );

    expect(normalized).toEqual({
      family: "ar",
      documentRemoteId: "inv-remote-1",
      paymentRemoteId: "pay-2",
      amount: 125,
      currencyCode: "EUR",
      exchangeRate: 1.1,
      paidDate: "2026-07-15",
      reference: "pay-2",
      status: "settled"
    });
  });

  it("maps a DELETED payment to void (the reverse path)", () => {
    const normalized = makeMapperSyncer().mapToNormalized(
      {
        PaymentID: "pay-3",
        Amount: 500,
        Date: "2026-08-02",
        Status: "DELETED",
        Invoice: { InvoiceID: "bill-remote-1", Type: "ACCPAY" },
        UpdatedDateUTC: "/Date(1785628800000+0000)/"
      },
      "bill:bill-remote-1:pay-3"
    );
    expect(normalized.status).toBe("void");
    expect(normalized.family).toBe("ap");
    expect(normalized.documentRemoteId).toBe("bill-remote-1");
  });

  it("carries a partial-payment amount through unchanged", () => {
    const normalized = makeMapperSyncer().mapToNormalized(
      {
        PaymentID: "pay-4",
        Amount: 40,
        Date: "2026-08-03",
        Status: "AUTHORISED",
        Invoice: { InvoiceID: "inv-remote-1", Type: "ACCREC" },
        UpdatedDateUTC: "/Date(1785715200000+0000)/"
      },
      "inv-remote-1:pay-4"
    );
    expect(normalized.amount).toBe(40);
    expect(normalized.currencyCode).toBeNull();
    expect(normalized.exchangeRate).toBe(1);
  });
});

// Fake Kysely db answering only the documents-mode gate's metadata read.
// `metadata` undefined = no row (gate resolves to defaults = documents).
function makeMetadataDb(metadata: unknown) {
  const chain: any = {
    select: () => chain,
    where: () => chain,
    executeTakeFirst: async () =>
      metadata === undefined ? undefined : { metadata }
  };
  return { selectFrom: () => chain } as never;
}

function familyModeMetadata(family: "ar" | "ap", mode: string) {
  return { settings: { postingSync: { families: { [family]: mode } } } };
}

describe("XeroPaymentSyncer.shouldSync ownership gate", () => {
  function makeSyncer(mappedDocId: string | null, metadata?: unknown) {
    const syncer = new XeroPaymentSyncer({
      database: makeMetadataDb(metadata),
      companyId: "company-1",
      provider: { id: "xero" } as never,
      config: {
        enabled: true,
        direction: "pull-from-accounting",
        owner: "accounting"
      },
      entityType: "payment"
    });
    (syncer as unknown as Record<string, unknown>).mappingService = {
      getEntityId: async () => mappedDocId
    };
    return syncer as unknown as {
      shouldSync(context: {
        direction: "push" | "pull";
        remoteEntity?: Xero.Payment;
        isFirstSync: boolean;
        entityId: string;
      }): Promise<boolean | string>;
    };
  }

  it("skips (does not fail) when the AP family is not in documents mode", async () => {
    const result = await makeSyncer(
      "purchase-invoice-1",
      familyModeMetadata("ap", "journals")
    ).shouldSync({
      direction: "pull",
      entityId: "bill:bill-ours:pay-1",
      remoteEntity: {
        PaymentID: "pay-1",
        Status: "AUTHORISED",
        UpdatedDateUTC: "/Date(1785542400000+0000)/"
      },
      isFirstSync: true
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("payment sync-back is disabled");
    expect(result).toContain("ap");
  });

  it("skips (does not fail) an AP payment on a bill with no local mapping", async () => {
    const result = await makeSyncer(null).shouldSync({
      direction: "pull",
      entityId: "bill:bill-other:pay-1",
      isFirstSync: true
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("no Carbon mapping");
    expect(result).toContain("bill");
  });

  it("skips an AR payment on an invoice with no local mapping", async () => {
    const result = await makeSyncer(null).shouldSync({
      direction: "pull",
      entityId: "inv-other:pay-1",
      isFirstSync: true
    });
    expect(result).toContain("no Carbon mapping");
    expect(result).toContain("invoice");
  });

  it("proceeds for a payment on a locally-mapped document", async () => {
    const result = await makeSyncer("purchase-invoice-1").shouldSync({
      direction: "pull",
      entityId: "bill:bill-ours:pay-1",
      remoteEntity: {
        PaymentID: "pay-1",
        Status: "AUTHORISED",
        UpdatedDateUTC: "/Date(1785542400000+0000)/"
      },
      isFirstSync: true
    });
    expect(result).toBe(true);
  });

  it("skips a first-seen DELETED (void) payment on a mapped document", async () => {
    const result = await makeSyncer("purchase-invoice-1").shouldSync({
      direction: "pull",
      entityId: "bill:bill-ours:pay-1",
      remoteEntity: {
        PaymentID: "pay-1",
        Status: "DELETED",
        UpdatedDateUTC: "/Date(1785542400000+0000)/"
      },
      isFirstSync: true
    });
    expect(result).toContain("never recorded");
  });
});

describe("Xero payment syncer registration", () => {
  it("resolves via SyncFactory.getSyncer({provider:'xero', entityType:'payment'})", () => {
    const syncer = SyncFactory.getSyncer({
      database: {} as never,
      companyId: "company-1",
      provider: { id: "xero" } as never,
      config: {
        enabled: true,
        direction: "pull-from-accounting",
        owner: "accounting"
      },
      entityType: "payment"
    });
    expect(syncer).toBeInstanceOf(XeroPaymentSyncer);
  });
});
