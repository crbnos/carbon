import { describe, expect, it, vi } from "vitest";
import type { NormalizedPayment } from "../../../../core/payment-application";
import { SyncFactory } from "../../../../core/sync";
import type { Qbo } from "../../models";
// Importing the provider barrel registers the QBO syncer registry (side
// effect) so SyncFactory.getSyncer can resolve `payment`.
import "../../index";
import {
  buildQboPaymentSyncChange,
  getQboBillPaymentSyncEntityId,
  getQboPaymentLinkedDocuments,
  getQboPaymentSyncEntityId,
  parseQboPaymentSyncEntityId,
  type QboPayment,
  QboPaymentSyncer
} from "../payment";

// The base dynamically imports @carbon/auth/client.server only when posting;
// mock it so nothing touches server env during these pure-mapper tests.
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({ functions: { invoke: vi.fn() } })
}));

describe("composite payment sync entity id (QBO)", () => {
  it("round-trips invoice + payment ids as a prefix-less AR id", () => {
    const entityId = getQboPaymentSyncEntityId("inv-remote-1", "pay-1");
    expect(entityId).toBe("inv-remote-1:pay-1");
    expect(parseQboPaymentSyncEntityId(entityId)).toEqual({
      family: "ar",
      documentRemoteId: "inv-remote-1",
      paymentRemoteId: "pay-1"
    });
  });

  it("round-trips bill + payment ids as a `bill:`-prefixed AP id", () => {
    const entityId = getQboBillPaymentSyncEntityId("bill-remote-1", "bp-2");
    expect(entityId).toBe("bill:bill-remote-1:bp-2");
    expect(parseQboPaymentSyncEntityId(entityId)).toEqual({
      family: "ap",
      documentRemoteId: "bill-remote-1",
      paymentRemoteId: "bp-2"
    });
  });

  it("throws on malformed ids (both families)", () => {
    expect(() => parseQboPaymentSyncEntityId("no-separator")).toThrow(
      /Invalid QuickBooks Online payment sync entity id/
    );
    expect(() => parseQboPaymentSyncEntityId(":pay-1")).toThrow(
      /Invalid QuickBooks Online payment sync entity id/
    );
    expect(() => parseQboPaymentSyncEntityId("inv-1:")).toThrow(
      /Invalid QuickBooks Online payment sync entity id/
    );
    expect(() => parseQboPaymentSyncEntityId("bill:no-separator")).toThrow(
      /Invalid QuickBooks Online payment sync entity id/
    );
    expect(() => parseQboPaymentSyncEntityId("bill:b-1:")).toThrow(
      /Invalid QuickBooks Online payment sync entity id/
    );
  });
});

describe("getQboPaymentLinkedDocuments", () => {
  it("extracts one bill per line for a BillPayment (AP)", () => {
    const billPayment: Qbo.BillPayment = {
      Id: "bp-1",
      TotalAmt: 800,
      Line: [
        { Amount: 500, LinkedTxn: [{ TxnId: "bill-1", TxnType: "Bill" }] },
        { Amount: 300, LinkedTxn: [{ TxnId: "bill-2", TxnType: "Bill" }] }
      ]
    };
    expect(getQboPaymentLinkedDocuments(billPayment, "Bill")).toEqual([
      { remoteId: "bill-1", amount: 500 },
      { remoteId: "bill-2", amount: 300 }
    ]);
  });

  it("ignores non-matching TxnTypes", () => {
    const payment: Qbo.Payment = {
      Id: "pay-1",
      Line: [
        { Amount: 100, LinkedTxn: [{ TxnId: "inv-1", TxnType: "Invoice" }] },
        {
          Amount: 0,
          LinkedTxn: [{ TxnId: "credit-1", TxnType: "CreditMemo" }]
        }
      ]
    };
    expect(getQboPaymentLinkedDocuments(payment, "Invoice")).toEqual([
      { remoteId: "inv-1", amount: 100 }
    ]);
  });
});

describe("buildQboPaymentSyncChange", () => {
  it("builds the AP composite from the first linked bill", () => {
    const billPayment: Qbo.BillPayment = {
      Id: "bp-1",
      Line: [
        { Amount: 500, LinkedTxn: [{ TxnId: "bill-1", TxnType: "Bill" }] },
        { Amount: 300, LinkedTxn: [{ TxnId: "bill-2", TxnType: "Bill" }] }
      ]
    };
    expect(buildQboPaymentSyncChange(billPayment, "ap")).toEqual({
      documentRemoteId: "bill-1",
      entityId: "bill:bill-1:bp-1"
    });
  });

  it("builds the AR composite from the first linked invoice", () => {
    const payment: Qbo.Payment = {
      Id: "pay-1",
      Line: [
        { Amount: 125, LinkedTxn: [{ TxnId: "inv-1", TxnType: "Invoice" }] }
      ]
    };
    expect(buildQboPaymentSyncChange(payment, "ar")).toEqual({
      documentRemoteId: "inv-1",
      entityId: "inv-1:pay-1"
    });
  });

  it("returns null when the payment settles no document", () => {
    expect(
      buildQboPaymentSyncChange({ Id: "bp-1", Line: [] }, "ap")
    ).toBeNull();
  });
});

function makeMapperSyncer() {
  const syncer = new QboPaymentSyncer({
    database: {} as never,
    companyId: "company-1",
    provider: { id: "quickbooks" } as never,
    config: {
      enabled: true,
      direction: "pull-from-accounting",
      owner: "accounting"
    },
    entityType: "payment"
  });
  return syncer as unknown as {
    mapToNormalized(
      remote: Qbo.Payment | Qbo.BillPayment,
      entityId: string
    ): NormalizedPayment;
  };
}

describe("QboPaymentSyncer.mapToNormalized", () => {
  it("normalizes a single-bill BillPayment to a settled AP NormalizedPayment", () => {
    const normalized = makeMapperSyncer().mapToNormalized(
      {
        Id: "bp-1",
        TotalAmt: 500,
        TxnDate: "2026-08-01",
        CurrencyRef: { value: "USD" },
        Line: [
          { Amount: 500, LinkedTxn: [{ TxnId: "bill-9", TxnType: "Bill" }] }
        ],
        MetaData: { LastUpdatedTime: "2026-08-01T10:00:00-07:00" }
      },
      "bill:bill-9:bp-1"
    );

    expect(normalized).toEqual({
      family: "ap",
      documentRemoteId: "bill-9",
      paymentRemoteId: "bp-1",
      amount: 500,
      currencyCode: "USD",
      exchangeRate: 1,
      paidDate: "2026-08-01",
      reference: "bp-1",
      status: "settled",
      linkedDocuments: [{ remoteId: "bill-9", amount: 500 }]
    });
  });

  it("fans a multi-bill BillPayment out into per-bill linkedDocuments", () => {
    const normalized = makeMapperSyncer().mapToNormalized(
      {
        Id: "bp-2",
        TotalAmt: 800,
        TxnDate: "2026-08-02",
        CurrencyRef: { value: "USD" },
        ExchangeRate: 1,
        Line: [
          { Amount: 500, LinkedTxn: [{ TxnId: "bill-1", TxnType: "Bill" }] },
          { Amount: 300, LinkedTxn: [{ TxnId: "bill-2", TxnType: "Bill" }] }
        ],
        MetaData: { LastUpdatedTime: "2026-08-02T10:00:00-07:00" }
      },
      // The composite carries the FIRST linked bill.
      "bill:bill-1:bp-2"
    );

    expect(normalized.family).toBe("ap");
    expect(normalized.documentRemoteId).toBe("bill-1");
    expect(normalized.amount).toBe(800);
    expect(normalized.linkedDocuments).toEqual([
      { remoteId: "bill-1", amount: 500 },
      { remoteId: "bill-2", amount: 300 }
    ]);
  });

  it("normalizes a Payment to a settled AR NormalizedPayment", () => {
    const normalized = makeMapperSyncer().mapToNormalized(
      {
        Id: "pay-1",
        TotalAmt: 125,
        TxnDate: "2026-07-15",
        CurrencyRef: { value: "EUR" },
        ExchangeRate: 1.1,
        Line: [
          { Amount: 125, LinkedTxn: [{ TxnId: "inv-1", TxnType: "Invoice" }] }
        ],
        MetaData: { LastUpdatedTime: "2026-07-15T10:00:00-07:00" }
      },
      "inv-1:pay-1"
    );

    expect(normalized).toEqual({
      family: "ar",
      documentRemoteId: "inv-1",
      paymentRemoteId: "pay-1",
      amount: 125,
      currencyCode: "EUR",
      exchangeRate: 1.1,
      paidDate: "2026-07-15",
      reference: "pay-1",
      status: "settled",
      linkedDocuments: [{ remoteId: "inv-1", amount: 125 }]
    });
  });

  it("maps a voided payment (TotalAmt 0) to void with no positive linkedDocuments", () => {
    const normalized = makeMapperSyncer().mapToNormalized(
      {
        Id: "bp-3",
        TotalAmt: 0,
        TxnDate: "2026-08-03",
        CurrencyRef: { value: "USD" },
        Line: [
          { Amount: 0, LinkedTxn: [{ TxnId: "bill-9", TxnType: "Bill" }] }
        ],
        MetaData: { LastUpdatedTime: "2026-08-03T10:00:00-07:00" }
      },
      "bill:bill-9:bp-3"
    );
    expect(normalized.status).toBe("void");
    expect(normalized.family).toBe("ap");
    expect(normalized.documentRemoteId).toBe("bill-9");
    // Zeroed lines drop out — the core reverses via the documentRemoteId fallback.
    expect(normalized.linkedDocuments).toBeUndefined();
  });
});

describe("QboPaymentSyncer.fetchRemote tombstone (hard delete → void)", () => {
  function makeFetchSyncer(getResult: QboPayment | null) {
    const syncer = new QboPaymentSyncer({
      database: {} as never,
      companyId: "company-1",
      provider: {
        id: "quickbooks",
        getBillPayment: async () => getResult,
        getPayment: async () => getResult
      } as never,
      config: {
        enabled: true,
        direction: "pull-from-accounting",
        owner: "accounting"
      },
      entityType: "payment"
    });
    return syncer as unknown as {
      fetchRemote(entityId: string): Promise<QboPayment | null>;
      mapToNormalized(remote: QboPayment, entityId: string): NormalizedPayment;
    };
  }

  it("returns a bare tombstone marker when a BillPayment 404s → normalizes to void", async () => {
    const syncer = makeFetchSyncer(null);
    const tombstone = await syncer.fetchRemote("bill:bill-9:bp-1");
    expect(tombstone).toEqual({ Id: "bp-1" });

    // The tombstone flows through mapToNormalized to a reversing (void) payment
    // built purely from the parsed composite id (amount 0, no linkedDocuments)
    // → upsertLocalPaymentDraft returns postAction "void" → post-payment
    // { type: "void" }.
    const normalized = syncer.mapToNormalized(
      tombstone as QboPayment,
      "bill:bill-9:bp-1"
    );
    expect(normalized.status).toBe("void");
    expect(normalized.family).toBe("ap");
    expect(normalized.documentRemoteId).toBe("bill-9");
    expect(normalized.amount).toBe(0);
    expect(normalized.linkedDocuments).toBeUndefined();
  });

  it("passes a found payment through unchanged (no tombstone)", async () => {
    const real: QboPayment = {
      Id: "bp-1",
      TotalAmt: 500,
      Line: [{ Amount: 500, LinkedTxn: [{ TxnId: "bill-9", TxnType: "Bill" }] }]
    };
    const syncer = makeFetchSyncer(real);
    expect(await syncer.fetchRemote("bill:bill-9:bp-1")).toBe(real);
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

describe("QboPaymentSyncer.shouldSync ownership gate", () => {
  function makeSyncer(mappedDocId: string | null, metadata?: unknown) {
    const syncer = new QboPaymentSyncer({
      database: makeMetadataDb(metadata),
      companyId: "company-1",
      provider: { id: "quickbooks" } as never,
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
        remoteEntity?: Qbo.Payment | Qbo.BillPayment;
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
      entityId: "bill:bill-ours:bp-1",
      remoteEntity: { Id: "bp-1", TotalAmt: 500 },
      isFirstSync: true
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("payment sync-back is disabled");
    expect(result).toContain("ap");
  });

  it("skips (does not fail) an AP bill payment on a bill with no local mapping", async () => {
    const result = await makeSyncer(null).shouldSync({
      direction: "pull",
      entityId: "bill:bill-other:bp-1",
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
      entityId: "bill:bill-ours:bp-1",
      remoteEntity: { Id: "bp-1", TotalAmt: 500 },
      isFirstSync: true
    });
    expect(result).toBe(true);
  });

  it("skips a first-seen voided (TotalAmt 0) payment on a mapped document", async () => {
    const result = await makeSyncer("purchase-invoice-1").shouldSync({
      direction: "pull",
      entityId: "bill:bill-ours:bp-1",
      remoteEntity: { Id: "bp-1", TotalAmt: 0 },
      isFirstSync: true
    });
    expect(result).toContain("never recorded");
  });
});

describe("QBO payment syncer registration", () => {
  it("resolves via SyncFactory.getSyncer({provider:'quickbooks', entityType:'payment'})", () => {
    const syncer = SyncFactory.getSyncer({
      database: {} as never,
      companyId: "company-1",
      provider: { id: "quickbooks" } as never,
      config: {
        enabled: true,
        direction: "pull-from-accounting",
        owner: "accounting"
      },
      entityType: "payment"
    });
    expect(syncer).toBeInstanceOf(QboPaymentSyncer);
  });
});
