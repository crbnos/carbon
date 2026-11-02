// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  type NormalizedPayment,
  upsertLocalPaymentDraft
} from "../../../../core/payment-application";
import { Rillet } from "../../models";
import {
  getRilletBillPaymentSyncEntityId,
  getRilletPaymentAmount,
  getRilletPaymentCurrency,
  getRilletPaymentSyncEntityId,
  mapRilletPaymentToLocal,
  parseRilletPaymentSyncEntityId,
  RilletPaymentSyncer
} from "../payment";

describe("composite payment sync entity id", () => {
  it("round-trips invoice + payment ids as a prefix-less AR id", () => {
    const entityId = getRilletPaymentSyncEntityId(
      "0b9f9c1e-9f10-4c8e-8f2c-1a2b3c4d5e6f",
      "7c8d9e0f-1a2b-3c4d-5e6f-7a8b9c0d1e2f"
    );

    expect(entityId).toBe(
      "0b9f9c1e-9f10-4c8e-8f2c-1a2b3c4d5e6f:7c8d9e0f-1a2b-3c4d-5e6f-7a8b9c0d1e2f"
    );
    expect(parseRilletPaymentSyncEntityId(entityId)).toEqual({
      family: "ar",
      kind: "invoice",
      documentRemoteId: "0b9f9c1e-9f10-4c8e-8f2c-1a2b3c4d5e6f",
      paymentRemoteId: "7c8d9e0f-1a2b-3c4d-5e6f-7a8b9c0d1e2f"
    });
  });

  it("round-trips bill + payment ids as a `bill:`-prefixed AP id", () => {
    const entityId = getRilletBillPaymentSyncEntityId(
      "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "9f8e7d6c-5b4a-3210-fedc-ba9876543210"
    );

    expect(entityId).toBe(
      "bill:1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d:9f8e7d6c-5b4a-3210-fedc-ba9876543210"
    );
    expect(parseRilletPaymentSyncEntityId(entityId)).toEqual({
      family: "ap",
      kind: "bill",
      documentRemoteId: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      paymentRemoteId: "9f8e7d6c-5b4a-3210-fedc-ba9876543210"
    });
  });

  it("does not confuse a plain AR id with the `bill:` prefix", () => {
    // An AR invoice id never starts with "bill:" (Rillet ids are uuids), but
    // guard the discriminator anyway.
    expect(parseRilletPaymentSyncEntityId("inv-1:pay-1").family).toBe("ar");
  });

  it("throws on malformed ids (both families)", () => {
    expect(() => parseRilletPaymentSyncEntityId("no-separator")).toThrow(
      /Invalid Rillet payment sync entity id/
    );
    expect(() => parseRilletPaymentSyncEntityId(":pay-1")).toThrow(
      /Invalid Rillet payment sync entity id/
    );
    expect(() => parseRilletPaymentSyncEntityId("inv-1:")).toThrow(
      /Invalid Rillet payment sync entity id/
    );
    // "bill:" prefix with no separator in the remainder
    expect(() => parseRilletPaymentSyncEntityId("bill:no-separator")).toThrow(
      /Invalid Rillet payment sync entity id/
    );
    expect(() => parseRilletPaymentSyncEntityId("bill:b-1:")).toThrow(
      /Invalid Rillet payment sync entity id/
    );
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

// A fake Kysely database answering the documents-mode gate's
// `companyIntegration.metadata` read and the FX gate's `company.baseCurrencyCode`
// read. `metadata` undefined = no integration row (defaults to documents mode).
function makeGateDb(metadata: unknown, baseCurrencyCode: string) {
  const chain = (result: unknown) => {
    const c: any = {
      select: () => c,
      where: () => c,
      executeTakeFirst: async () => result
    };
    return c;
  };
  return {
    selectFrom: (table: string) =>
      table === "company"
        ? chain({ baseCurrencyCode })
        : chain(metadata === undefined ? undefined : { metadata })
  } as never;
}

function familyModeMetadata(family: "ar" | "ap", mode: string) {
  return { settings: { postingSync: { families: { [family]: mode } } } };
}

function makeGateSyncer({
  mappedDocumentId = "carbon-document-1" as string | null,
  metadata = undefined as unknown,
  baseCurrency = "USD"
} = {}) {
  const syncer = new RilletPaymentSyncer({
    database: makeGateDb(metadata, baseCurrency),
    companyId: "company-1",
    provider: { id: "rillet" } as never,
    config: {
      enabled: true,
      direction: "pull-from-accounting",
      owner: "accounting"
    },
    entityType: "payment"
  });
  // The pushed document's mapping is the ownership record.
  (syncer as unknown as Record<string, unknown>).mappingService = {
    getEntityId: async () => mappedDocumentId
  };
  return syncer as unknown as {
    shouldSync(context: {
      direction: "push" | "pull";
      remoteEntity?: Rillet.InvoicePayment | Rillet.BillPayment;
      isFirstSync: boolean;
      entityId: string;
    }): Promise<boolean | string>;
  };
}

describe.each([
  {
    family: "ar" as const,
    entityId: "inv-ours:pay-1",
    remote: { id: "pay-1", status: "SUCCESSFUL" } as Rillet.InvoicePayment
  },
  {
    family: "ap" as const,
    entityId: "bill:bill-ours:bp-1",
    remote: {
      id: "bp-1",
      status: "SUCCESSFUL",
      bill_id: "bill-ours"
    } as Rillet.BillPayment
  }
])(
  "RilletPaymentSyncer.shouldSync ($family)",
  ({ family, entityId, remote }) => {
    const pull = (
      options: Parameters<typeof makeGateSyncer>[0],
      remoteEntity: Rillet.InvoicePayment | Rillet.BillPayment = remote
    ) =>
      makeGateSyncer(options).shouldSync({
        direction: "pull",
        entityId,
        remoteEntity,
        isFirstSync: true
      });

    it("proceeds for a payment on a locally mapped document", async () => {
      expect(await pull({})).toBe(true);
    });

    it.each(["journals", "none"])(
      "skips when the family is in %s mode",
      async (mode) => {
        expect(
          await pull({ metadata: familyModeMetadata(family, mode) })
        ).toEqual(expect.any(String));
      }
    );

    // Rillet feeds are org-wide: another Carbon instance's subsidiary shares them.
    it("skips a payment on a document with no local mapping", async () => {
      expect(await pull({ mappedDocumentId: null })).toEqual(
        expect.any(String)
      );
    });

    it("skips a first-seen FAILED payment, which was never recorded", async () => {
      expect(await pull({}, { ...remote, status: "FAILED" })).toEqual(
        expect.any(String)
      );
    });
  }
);

// mapToNormalized books at rate 1, so a cross-currency payment would misstate.
describe("RilletPaymentSyncer.shouldSync FX gate", () => {
  it.each([
    ["EUR", false],
    ["USD", true],
    [undefined, true]
  ] as const)(
    "a %s payment on a USD company proceeds: %s",
    async (currency, proceeds) => {
      const result = await makeGateSyncer().shouldSync({
        direction: "pull",
        entityId: "inv-ours:pay-1",
        remoteEntity: {
          id: "pay-1",
          status: "SUCCESSFUL",
          ...(currency ? { amount: { amount: "125.00", currency } } : {})
        },
        isFirstSync: true
      });
      expect(result).toEqual(proceeds ? true : expect.any(String));
    }
  );
});

function makeMapperSyncer() {
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
  return syncer as unknown as {
    mapToNormalized(
      remote: Rillet.InvoicePayment | Rillet.BillPayment,
      entityId: string
    ): NormalizedPayment;
  };
}

describe("RilletPaymentSyncer.mapToNormalized", () => {
  it("normalizes a SUCCESSFUL invoice payment to a settled AR NormalizedPayment", () => {
    const normalized = makeMapperSyncer().mapToNormalized(
      {
        id: "pay-1",
        status: "SUCCESSFUL",
        amount: { amount: "125.00", currency: "USD" },
        date: "2026-07-15",
        updated_at: "2026-07-15T10:00:00Z"
      },
      "inv-1:pay-1"
    );

    expect(normalized).toEqual({
      family: "ar",
      documentRemoteId: "inv-1",
      paymentRemoteId: "pay-1",
      amount: 125,
      currencyCode: "USD",
      exchangeRate: null,
      paidDate: "2026-07-15",
      reference: "pay-1",
      status: "settled"
    });
  });

  it("marks a FAILED payment as failed (the void path)", () => {
    const normalized = makeMapperSyncer().mapToNormalized(
      { id: "pay-2", status: "FAILED", updated_at: "2026-07-17T00:00:00Z" },
      "inv-1:pay-2"
    );
    expect(normalized.status).toBe("failed");
    expect(normalized.family).toBe("ar");
    expect(normalized.documentRemoteId).toBe("inv-1");
  });

  it("normalizes a bill payment (bill: id) to a settled AP NormalizedPayment", () => {
    const normalized = makeMapperSyncer().mapToNormalized(
      {
        id: "bp-1",
        status: "SUCCESSFUL",
        bill_id: "bill-remote-1",
        amount: { amount: "500.00", currency: "USD" },
        date: "2026-08-01",
        updated_at: "2026-08-01T10:00:00Z"
      },
      "bill:bill-remote-1:bp-1"
    );

    expect(normalized).toEqual({
      family: "ap",
      documentRemoteId: "bill-remote-1",
      paymentRemoteId: "bp-1",
      amount: 500,
      currencyCode: "USD",
      exchangeRate: null,
      paidDate: "2026-08-01",
      reference: "bp-1",
      status: "settled"
    });
  });

  it("marks a FAILED bill payment as failed (AP void path)", () => {
    const normalized = makeMapperSyncer().mapToNormalized(
      {
        id: "bp-2",
        status: "FAILED",
        bill_id: "bill-remote-1",
        payment_date: "2026-08-02",
        updated_at: "2026-08-02T00:00:00Z"
      },
      "bill:bill-remote-1:bp-2"
    );
    expect(normalized.family).toBe("ap");
    expect(normalized.status).toBe("failed");
    expect(normalized.documentRemoteId).toBe("bill-remote-1");
    expect(normalized.paidDate).toBe("2026-08-02");
  });
});

// A minimal fake Kysely transaction that records writes and returns canned
// reads. Only the chains upsertLocalPaymentDraft (+ createMappingService) use
// are supported.
function makeFakeTx(store: {
  docMappings: Record<string, string>;
  salesInvoice?: { id: string; customerId: string; currencyCode: string };
  purchaseInvoice?: { id: string; supplierId: string; currencyCode: string };
  paymentMapping?: { entityId: string };
  existingPayment?: { id: string; status: string };
  newPaymentId: string;
  records: Array<{ op: string; table: string; values: unknown }>;
}) {
  const resolveOne = (b: any) => {
    const where = (col: string) =>
      b.wheres.find((w: any) => w.col === col)?.val;
    if (b.table === "externalIntegrationMapping") {
      if (b.selectedAll) return store.paymentMapping ?? undefined; // getByExternalId
      const entityId = store.docMappings[where("externalId") as string];
      return entityId ? { entityId } : undefined; // getEntityId
    }
    if (b.table === "company")
      return { baseCurrencyCode: "USD", companyGroupId: "group-1" };
    if (b.table === "currency") return { decimalPlaces: 2 };
    if (b.table === "salesInvoice") return store.salesInvoice;
    if (b.table === "purchaseInvoice") return store.purchaseInvoice;
    if (b.table === "payment") {
      if (b.op === "insert") return { id: store.newPaymentId };
      // Resolve by the queried id, like the real table — the settlement-keyed
      // mapping regression below depends on a wrong id NOT matching.
      return store.existingPayment && where("id") === store.existingPayment.id
        ? store.existingPayment
        : undefined;
    }
    return undefined;
  };
  const makeBuilder = (table: string, op: string) => {
    const b: any = {
      table,
      op,
      wheres: [] as Array<{ col: string; val: unknown }>,
      selectedAll: false,
      valuesArg: undefined as unknown,
      select() {
        return b;
      },
      selectAll() {
        b.selectedAll = true;
        return b;
      },
      innerJoin() {
        return b;
      },
      where(col: string, _o: string, val: unknown) {
        b.wheres.push({ col, val });
        return b;
      },
      set(v: unknown) {
        b.valuesArg = v;
        return b;
      },
      values(v: unknown) {
        b.valuesArg = v;
        return b;
      },
      returning() {
        return b;
      },
      onConflict() {
        return b;
      },
      orderBy() {
        return b;
      },
      limit() {
        return b;
      },
      async execute() {
        if (op === "select") {
          if (table === "externalIntegrationMapping")
            return Object.entries(store.docMappings).map(
              ([externalId, entityId]) => ({ externalId, entityId })
            );
          if (table === "salesInvoices")
            return store.salesInvoice
              ? [
                  {
                    ...store.salesInvoice,
                    partyId: store.salesInvoice.customerId,
                    exchangeRate: 1,
                    totalAmount: 1000,
                    balance: 1000
                  }
                ]
              : [];
          if (table === "purchaseInvoices")
            return store.purchaseInvoice
              ? [
                  {
                    ...store.purchaseInvoice,
                    partyId: store.purchaseInvoice.supplierId,
                    exchangeRate: 1,
                    totalAmount: 1000,
                    balance: 1000
                  }
                ]
              : [];
          return [];
        }
        store.records.push({ op, table, values: b.valuesArg });
        return [];
      },
      async executeTakeFirst() {
        return resolveOne(b);
      },
      async executeTakeFirstOrThrow() {
        const row = resolveOne(b);
        if (!row) throw new Error("no row");
        store.records.push({ op, table, values: b.valuesArg });
        return row;
      }
    };
    return b;
  };
  return {
    selectFrom: (t: string) => makeBuilder(t, "select"),
    insertInto: (t: string) => makeBuilder(t, "insert"),
    updateTable: (t: string) => makeBuilder(t, "update"),
    deleteFrom: (t: string) => makeBuilder(t, "delete")
  } as never;
}

describe("upsertLocalPaymentDraft (AR)", () => {
  const settled: NormalizedPayment = {
    family: "ar",
    documentRemoteId: "inv-1",
    paymentRemoteId: "pay-1",
    amount: 125,
    currencyCode: "USD",
    exchangeRate: 1,
    paidDate: "2026-07-15",
    reference: "pay-1",
    status: "settled"
  };

  it("writes a Draft payment + invoiceSettlement and returns postAction 'post'", async () => {
    const store = {
      docMappings: { "inv-1": "sales-invoice-1" },
      salesInvoice: {
        id: "sales-invoice-1",
        customerId: "cust-1",
        currencyCode: "USD"
      },
      paymentMapping: undefined,
      existingPayment: undefined,
      newPaymentId: "payment-row-1",
      records: [] as Array<{ op: string; table: string; values: unknown }>
    };

    const result = await upsertLocalPaymentDraft(makeFakeTx(store), {
      providerId: "rillet",
      companyId: "company-1",
      actorId: "user-1",
      bankAccount: "bank-1",
      paymentMappingId: "inv-1:pay-1",
      getNextReadableId: async () => "PAY000001",
      normalized: settled
    });

    expect(result).toEqual({
      paymentRowId: "payment-row-1",
      family: "ar",
      postAction: "post"
    });

    const paymentInsert = store.records.find(
      (r) => r.op === "insert" && r.table === "payment"
    );
    expect(paymentInsert?.values).toMatchObject({
      status: "Draft",
      paymentType: "Receipt",
      customerId: "cust-1",
      supplierId: null,
      totalAmount: 125,
      bankAccount: "bank-1",
      reference: "pay-1",
      paymentId: "PAY000001"
    });
    // No journalId written by the draft path (post-payment owns the GL journal).
    expect(paymentInsert?.values).not.toHaveProperty("journalId");

    const settlementInsert = store.records.find(
      (r) => r.op === "insert" && r.table === "invoiceSettlement"
    );
    expect(settlementInsert?.values).toMatchObject([
      { targetSalesInvoiceId: "sales-invoice-1", appliedAmount: 125 }
    ]);

    // The payment mapping is linked under the composite id.
    expect(
      store.records.some(
        (r) => r.op === "insert" && r.table === "externalIntegrationMapping"
      )
    ).toBe(true);
  });

  it("returns postAction 'void' for a FAILED payment whose Carbon payment is Posted, without rewriting it", async () => {
    const store = {
      docMappings: { "inv-1": "sales-invoice-1" },
      salesInvoice: {
        id: "sales-invoice-1",
        customerId: "cust-1",
        currencyCode: "USD"
      },
      paymentMapping: { entityId: "payment-row-1" },
      existingPayment: { id: "payment-row-1", status: "Posted" },
      newPaymentId: "unused",
      records: [] as Array<{ op: string; table: string; values: unknown }>
    };

    const result = await upsertLocalPaymentDraft(makeFakeTx(store), {
      providerId: "rillet",
      companyId: "company-1",
      actorId: "user-1",
      bankAccount: "bank-1",
      paymentMappingId: "inv-1:pay-1",
      getNextReadableId: async () => "PAY000002",
      normalized: { ...settled, status: "failed" }
    });

    expect(result).toEqual({
      paymentRowId: "payment-row-1",
      family: "ar",
      postAction: "void"
    });
    // The Posted payment is left untouched — post-payment's void needs it Posted.
    expect(
      store.records.some(
        (r) => r.table === "payment" && (r.op === "insert" || r.op === "update")
      )
    ).toBe(false);
  });
});

describe("upsertLocalPaymentDraft (AP bill payment)", () => {
  const settledAp: NormalizedPayment = {
    family: "ap",
    documentRemoteId: "bill-remote-1",
    paymentRemoteId: "bp-1",
    amount: 500,
    currencyCode: "USD",
    exchangeRate: 1,
    paidDate: "2026-08-01",
    reference: "bp-1",
    status: "settled"
  };

  it("writes a Draft Disbursement payment + targetPurchaseInvoiceId settlement and returns postAction 'post'", async () => {
    const store = {
      docMappings: { "bill-remote-1": "purchase-invoice-1" },
      purchaseInvoice: {
        id: "purchase-invoice-1",
        supplierId: "supplier-1",
        currencyCode: "USD"
      },
      paymentMapping: undefined,
      existingPayment: undefined,
      newPaymentId: "payment-row-ap-1",
      records: [] as Array<{ op: string; table: string; values: unknown }>
    };

    const result = await upsertLocalPaymentDraft(makeFakeTx(store), {
      providerId: "rillet",
      companyId: "company-1",
      actorId: "user-1",
      bankAccount: "bank-1",
      paymentMappingId: "bill:bill-remote-1:bp-1",
      getNextReadableId: async () => "PAY000010",
      normalized: settledAp
    });

    expect(result).toEqual({
      paymentRowId: "payment-row-ap-1",
      family: "ap",
      postAction: "post"
    });

    const paymentInsert = store.records.find(
      (r) => r.op === "insert" && r.table === "payment"
    );
    expect(paymentInsert?.values).toMatchObject({
      status: "Draft",
      paymentType: "Disbursement",
      supplierId: "supplier-1",
      customerId: null,
      totalAmount: 500,
      bankAccount: "bank-1",
      reference: "bp-1",
      paymentId: "PAY000010"
    });

    const settlementInsert = store.records.find(
      (r) => r.op === "insert" && r.table === "invoiceSettlement"
    );
    expect(settlementInsert?.values).toMatchObject([
      { targetPurchaseInvoiceId: "purchase-invoice-1", appliedAmount: 500 }
    ]);

    // The AP payment mapping is linked under the `bill:` composite id.
    expect(
      store.records.some(
        (r) => r.op === "insert" && r.table === "externalIntegrationMapping"
      )
    ).toBe(true);
  });

  it("throws when the bill has no local mapping (all documents unmapped)", async () => {
    const store = {
      docMappings: {}, // bill-remote-1 is unmapped
      purchaseInvoice: undefined,
      paymentMapping: undefined,
      existingPayment: undefined,
      newPaymentId: "unused",
      records: [] as Array<{ op: string; table: string; values: unknown }>
    };

    await expect(
      upsertLocalPaymentDraft(makeFakeTx(store), {
        providerId: "rillet",
        companyId: "company-1",
        actorId: "user-1",
        bankAccount: "bank-1",
        paymentMappingId: "bill:bill-remote-1:bp-1",
        getNextReadableId: async () => "PAY000011",
        normalized: settledAp
      })
    ).rejects.toThrow(/No mapped bill/);

    // Nothing written — shouldSync should have skipped an unmapped bill first.
    expect(
      store.records.some(
        (r) => r.table === "payment" && (r.op === "insert" || r.op === "update")
      )
    ).toBe(false);
  });

  it("no-ops on a payment Carbon pushed with a settlement-keyed mapping (echo guard)", async () => {
    // The outbound multi-settlement push links the mapping under
    // `<paymentId>:<targetDocumentId>`, not the bare payment row id. Pulling
    // that payment back must resolve the row through the key's prefix and
    // leave the Posted payment untouched — before the fix it missed the row,
    // re-inserted the payment, and died on the mapping's unique-externalId
    // constraint.
    const store = {
      docMappings: { "bill-remote-1": "purchase-invoice-1" },
      purchaseInvoice: {
        id: "purchase-invoice-1",
        supplierId: "supplier-1",
        currencyCode: "USD"
      },
      paymentMapping: { entityId: "pmt-1:purchase-invoice-1" },
      existingPayment: { id: "pmt-1", status: "Posted" },
      newPaymentId: "unused",
      records: [] as Array<{ op: string; table: string; values: unknown }>
    };

    const result = await upsertLocalPaymentDraft(makeFakeTx(store), {
      providerId: "rillet",
      companyId: "company-1",
      actorId: "user-1",
      bankAccount: "bank-1",
      paymentMappingId: "bill:bill-remote-1:bp-1",
      getNextReadableId: async () => "PAY000012",
      normalized: settledAp
    });

    expect(result).toEqual({
      paymentRowId: "pmt-1",
      family: "ap",
      postAction: "none"
    });

    // No new payment row, no settlement rewrite, no duplicate mapping link.
    expect(
      store.records.some(
        (r) => r.table === "payment" && (r.op === "insert" || r.op === "update")
      )
    ).toBe(false);
    expect(
      store.records.some((r) => r.table === "externalIntegrationMapping")
    ).toBe(false);
  });
});
