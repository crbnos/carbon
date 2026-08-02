import { describe, expect, it } from "vitest";
import { Rillet } from "../../models";
import {
  getRilletPaymentAmount,
  getRilletPaymentCurrency,
  getRilletPaymentSyncEntityId,
  getSettledInvoiceStatus,
  mapRilletPaymentToLocal,
  parseRilletPaymentSyncEntityId,
  RilletPaymentSyncer
} from "../payment";

describe("composite payment sync entity id", () => {
  it("round-trips invoice + payment ids", () => {
    const entityId = getRilletPaymentSyncEntityId(
      "0b9f9c1e-9f10-4c8e-8f2c-1a2b3c4d5e6f",
      "7c8d9e0f-1a2b-3c4d-5e6f-7a8b9c0d1e2f"
    );

    expect(entityId).toBe(
      "0b9f9c1e-9f10-4c8e-8f2c-1a2b3c4d5e6f:7c8d9e0f-1a2b-3c4d-5e6f-7a8b9c0d1e2f"
    );
    expect(parseRilletPaymentSyncEntityId(entityId)).toEqual({
      invoiceRemoteId: "0b9f9c1e-9f10-4c8e-8f2c-1a2b3c4d5e6f",
      paymentRemoteId: "7c8d9e0f-1a2b-3c4d-5e6f-7a8b9c0d1e2f"
    });
  });

  it("throws on malformed ids", () => {
    expect(() => parseRilletPaymentSyncEntityId("no-separator")).toThrow(
      /Invalid Rillet payment sync entity id/
    );
    expect(() => parseRilletPaymentSyncEntityId(":pay-1")).toThrow(
      /Invalid Rillet payment sync entity id/
    );
    expect(() => parseRilletPaymentSyncEntityId("inv-1:")).toThrow(
      /Invalid Rillet payment sync entity id/
    );
  });
});

describe("getSettledInvoiceStatus", () => {
  it("covers the zero / partial / exact / over boundaries", () => {
    expect(
      getSettledInvoiceStatus({ invoiceTotal: 100, settledTotal: 0 })
    ).toBeNull();
    expect(
      getSettledInvoiceStatus({ invoiceTotal: 100, settledTotal: 40 })
    ).toBe("Partially Paid");
    expect(
      getSettledInvoiceStatus({ invoiceTotal: 100, settledTotal: 100 })
    ).toBe("Paid");
    expect(
      getSettledInvoiceStatus({ invoiceTotal: 100, settledTotal: 150 })
    ).toBe("Paid");
  });

  it("is cents-accurate and never restates degenerate invoices", () => {
    // 99.999 rounds to 10000 cents — exact at 2dp
    expect(
      getSettledInvoiceStatus({ invoiceTotal: 100, settledTotal: 99.999 })
    ).toBe("Paid");
    expect(
      getSettledInvoiceStatus({ invoiceTotal: 100, settledTotal: 99.99 })
    ).toBe("Partially Paid");

    expect(
      getSettledInvoiceStatus({ invoiceTotal: 0, settledTotal: 50 })
    ).toBeNull();
    expect(
      getSettledInvoiceStatus({ invoiceTotal: 100, settledTotal: -5 })
    ).toBeNull();
  });
});

describe("mapRilletPaymentToLocal", () => {
  it("normalizes the list-endpoint shape (nested amount, date)", () => {
    const remote = Rillet.InvoicePaymentSchema.parse({
      id: "pay-1",
      status: "SUCCESSFUL",
      invoice_id: "inv-1",
      amount: { amount: "125.00", currency: "USD" },
      date: "2026-07-15",
      account_code: "1000",
      updated_at: "2026-07-15T10:00:00Z"
    });

    expect(mapRilletPaymentToLocal(remote)).toEqual({
      paymentRemoteId: "pay-1",
      invoiceRemoteId: "inv-1",
      amount: 125,
      currencyCode: "USD",
      date: "2026-07-15",
      status: "SUCCESSFUL",
      updatedAt: "2026-07-15T10:00:00Z"
    });
  });

  it("normalizes the webhook shape (flat amount + currency, payment_date, webhook-only statuses)", () => {
    const remote = Rillet.InvoicePaymentSchema.parse({
      id: "pay-2",
      status: "CLEARED",
      invoice_id: "inv-1",
      amount: 99.5,
      currency: "EUR",
      payment_date: "2026-07-16",
      cash_account_code: "1000",
      created_at: "2026-07-16T08:00:00Z",
      updated_at: "2026-07-16T09:00:00Z"
    });

    expect(mapRilletPaymentToLocal(remote)).toEqual({
      paymentRemoteId: "pay-2",
      invoiceRemoteId: "inv-1",
      amount: 99.5,
      currencyCode: "EUR",
      date: "2026-07-16",
      status: "CLEARED",
      updatedAt: "2026-07-16T09:00:00Z"
    });
  });

  it("passes FAILED through and defaults amount/currency when absent", () => {
    const local = mapRilletPaymentToLocal({
      id: "pay-3",
      status: "FAILED",
      updated_at: "2026-07-17T00:00:00Z"
    });

    expect(local.status).toBe("FAILED");
    expect(local.amount).toBe(0);
    expect(local.currencyCode).toBeNull();
    // No date fields → falls back to updated_at's date part
    expect(local.date).toBe("2026-07-17");
    // invoice_id absent → invoiceRemoteId omitted (completed from the
    // composite entity id in upsertLocal)
    expect(local.invoiceRemoteId).toBeUndefined();
  });

  it("accepts every status of both wire shapes (union schema)", () => {
    for (const status of [
      "SUCCESSFUL",
      "FAILED",
      "UNCLEARED",
      "CLEARED",
      "RECONCILED"
    ]) {
      expect(
        Rillet.InvoicePaymentSchema.parse({ id: "pay-x", status }).status
      ).toBe(status);
    }
    expect(() =>
      Rillet.InvoicePaymentSchema.parse({ id: "pay-x", status: "PENDING" })
    ).toThrow();
  });
});

describe("amount/currency normalization helpers", () => {
  it("reads nested, string and numeric amounts", () => {
    expect(
      getRilletPaymentAmount({
        id: "p",
        status: "SUCCESSFUL",
        amount: { amount: "10.50", currency: "USD" }
      })
    ).toBe(10.5);
    expect(
      getRilletPaymentAmount({ id: "p", status: "SUCCESSFUL", amount: "7.25" })
    ).toBe(7.25);
    expect(
      getRilletPaymentAmount({ id: "p", status: "SUCCESSFUL", amount: 3 })
    ).toBe(3);
    expect(getRilletPaymentAmount({ id: "p", status: "SUCCESSFUL" })).toBe(0);
  });

  it("prefers the nested currency, then the flat field", () => {
    expect(
      getRilletPaymentCurrency({
        id: "p",
        status: "SUCCESSFUL",
        amount: { amount: "10.50", currency: "USD" },
        currency: "EUR"
      })
    ).toBe("USD");
    expect(
      getRilletPaymentCurrency({
        id: "p",
        status: "SUCCESSFUL",
        amount: 10.5,
        currency: "EUR"
      })
    ).toBe("EUR");
    expect(
      getRilletPaymentCurrency({ id: "p", status: "SUCCESSFUL" })
    ).toBeNull();
  });
});

describe("RilletPaymentSyncer.shouldSync ownership gate", () => {
  function makeSyncer(mappedInvoiceId: string | null) {
    const syncer = new RilletPaymentSyncer({
      database: {} as never,
      companyId: "company-1",
      provider: { id: "rillet" } as never,
      config: {
        enabled: true,
        direction: "pull-from-accounting",
        owner: "accounting"
      },
      entityType: "payment"
    });
    // Stub the mapping lookup — the gate's only dependency
    (syncer as unknown as Record<string, unknown>).mappingService = {
      getEntityId: async () => mappedInvoiceId
    };
    return syncer as unknown as {
      shouldSync(context: {
        direction: "push" | "pull";
        remoteEntity?: Rillet.InvoicePayment;
        isFirstSync: boolean;
        entityId: string;
      }): Promise<boolean | string>;
    };
  }

  it("skips (does not fail) payments on invoices with no local mapping", async () => {
    const result = await makeSyncer(null).shouldSync({
      direction: "pull",
      entityId: "inv-other-subsidiary:pay-1",
      isFirstSync: true
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("no Carbon mapping");
  });

  it("proceeds for payments on locally-mapped invoices", async () => {
    const result = await makeSyncer("sales-invoice-1").shouldSync({
      direction: "pull",
      entityId: "inv-ours:pay-1",
      remoteEntity: { id: "pay-1", status: "SUCCESSFUL" },
      isFirstSync: true
    });
    expect(result).toBe(true);
  });

  it("still skips first-seen FAILED payments on mapped invoices", async () => {
    const result = await makeSyncer("sales-invoice-1").shouldSync({
      direction: "pull",
      entityId: "inv-ours:pay-1",
      remoteEntity: { id: "pay-1", status: "FAILED" },
      isFirstSync: true
    });
    expect(result).toContain("never recorded");
  });
});
