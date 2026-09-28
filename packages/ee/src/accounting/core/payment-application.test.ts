import { describe, expect, it } from "vitest";
import {
  type NormalizedPayment,
  upsertLocalPaymentDraft
} from "./payment-application";

function fixture(
  options: {
    family?: "ar" | "ap";
    rate?: number;
    sourceRate?: number | null;
    sourceAmount?: number;
    currency?: string;
    baseCurrency?: string;
    missing?: boolean;
    mixedParty?: boolean;
    unmapped?: boolean;
    foreignCurrencyOnly?: boolean;
    ambiguous?: boolean;
    balance?: number;
  } = {}
) {
  const family = options.family ?? "ar";
  const records: Array<{ table: string; value: any }> = [];
  const reads: Array<{ table: string; filters: unknown[] }> = [];
  const invoice = {
    id: "inv-1",
    companyId: "company-1",
    customerId: "party-1",
    supplierId: "party-1",
    partyId: "party-1",
    currencyCode: "EUR",
    exchangeRate: options.rate ?? 1.25,
    totalAmount: 1000,
    balance: options.balance ?? 1000
  };
  const tables: Record<string, any[]> = {
    company: [
      {
        baseCurrencyCode: options.baseCurrency ?? "USD",
        companyGroupId: "group-1"
      }
    ],
    currency: [{ decimalPlaces: 2 }],
    externalIntegrationMapping: options.unmapped
      ? []
      : [
          { entityId: "inv-1", externalId: "remote-1" },
          ...(options.ambiguous
            ? [{ entityId: "inv-2", externalId: "remote-1" }]
            : []),
          ...(options.mixedParty
            ? [{ entityId: "inv-2", externalId: "remote-2" }]
            : [])
        ],
    salesInvoices: options.missing
      ? []
      : [
          invoice,
          ...(options.mixedParty
            ? [
                {
                  ...invoice,
                  id: "inv-2",
                  customerId: "other",
                  partyId: "other"
                }
              ]
            : [])
        ],
    purchaseInvoices: options.missing ? [] : [invoice]
  };
  const builder = (table: string, write = false) => {
    const filters: unknown[] = [];
    let value: unknown;
    const b: any = {
      select: () => b,
      selectAll: () => {
        tables.externalIntegrationMapping = [];
        return b;
      },
      where: (...args: unknown[]) => {
        filters.push(args);
        return b;
      },
      innerJoin: () => b,
      values: (v: unknown) => {
        value = v;
        return b;
      },
      set: (v: unknown) => {
        value = v;
        return b;
      },
      returning: () => b,
      onConflict: () => b,
      execute: async () => {
        if (write) records.push({ table, value });
        else reads.push({ table, filters });
        return tables[table] ?? [];
      },
      executeTakeFirst: async () => {
        reads.push({ table, filters });
        if (table === "currency" && options.foreignCurrencyOnly)
          return filters.some(
            (filter: any) =>
              filter[0] === "companyGroupId" && filter[2] === "group-1"
          )
            ? undefined
            : { decimalPlaces: 3 };
        return tables[table]?.[0];
      },
      executeTakeFirstOrThrow: async () => {
        records.push({ table, value });
        return { id: "payment-1" };
      }
    };
    return b;
  };
  const tx = {
    selectFrom: (t: string) => builder(t),
    insertInto: (t: string) => builder(t, true),
    deleteFrom: (t: string) => builder(t, true),
    updateTable: (t: string) => builder(t, true)
  } as never;
  const normalized: NormalizedPayment = {
    family,
    documentRemoteId: "remote-1",
    paymentRemoteId: "pay-remote",
    amount: options.sourceAmount ?? 110,
    currencyCode: options.currency ?? "EUR",
    exchangeRate: options.sourceRate === undefined ? 1.1 : options.sourceRate,
    paidDate: "2026-09-07",
    reference: "remote",
    status: "settled",
    ...(options.mixedParty
      ? {
          linkedDocuments: [
            { remoteId: "remote-1", amount: 55 },
            { remoteId: "remote-2", amount: 55 }
          ]
        }
      : {})
  };
  const run = () =>
    upsertLocalPaymentDraft(tx, {
      providerId: "qbo",
      companyId: "company-1",
      actorId: "actor",
      bankAccount: "bank",
      paymentMappingId: "remote-1:pay-remote",
      getNextReadableId: async () => "PAY-1",
      normalized
    });
  return { records, reads, run };
}

describe("inbound payment draft currency boundaries", () => {
  it.each([
    "ar",
    "ap"
  ] as const)("stores exact cash principal and target carrying amount for %s", async (family) => {
    const f = fixture({ family });
    await f.run();
    expect(f.records.find((r) => r.table === "payment")?.value).toMatchObject({
      totalAmount: 110,
      exchangeRate: 1.1,
      currencyCode: "EUR"
    });
    expect(
      f.records.find(
        (r) => r.table === "invoiceSettlement" && Array.isArray(r.value)
      )?.value[0]
    ).toMatchObject({
      sourceAmount: 110,
      sourcePaymentId: null,
      appliedAmount: 88,
      sourceExchangeRate: 1.1,
      targetExchangeRate: 1.25,
      fxGainLossAmount: family === "ar" ? 12 : -12
    });
    expect(
      f.reads.find(
        (r) =>
          r.table === (family === "ar" ? "salesInvoices" : "purchaseInvoices")
      )?.filters
    ).toContainEqual(["companyId", "=", "company-1"]);
  });
  it("keeps document principal beyond a tiny base carrying amount", async () => {
    const f = fixture({ sourceAmount: 160.01, rate: 16000, sourceRate: 16000 });
    await f.run();
    expect(
      f.records.find(
        (r) => r.table === "invoiceSettlement" && Array.isArray(r.value)
      )?.value[0]
    ).toMatchObject({ sourceAmount: 160.01, appliedAmount: 0.01 });
  });
  it.each([
    { missing: true },
    { mixedParty: true },
    { currency: "GBP" },
    { rate: 0 },
    { rate: NaN },
    { sourceRate: null },
    { sourceRate: 0 },
    { balance: 0 },
    { ambiguous: true },
    { foreignCurrencyOnly: true }
  ])("rejects invalid authoritative snapshots without draft mutations: %j", async (options) => {
    const f = fixture(options);
    await expect(f.run()).rejects.toThrow();
    expect(f.records).toEqual([]);
  });
  it("resolves omitted rates only for an authoritative base-currency document", async () => {
    const f = fixture({ baseCurrency: "EUR", rate: 1, sourceRate: null });
    await f.run();
    expect(f.records.find((r) => r.table === "payment")?.value).toMatchObject({
      exchangeRate: 1,
      totalAmount: 110
    });
  });
  it("retains ownership skip only for genuinely unmapped documents", async () => {
    const f = fixture({ unmapped: true });
    await expect(f.run()).rejects.toThrow(/mapped/);
    expect(f.records).toEqual([]);
  });
});
