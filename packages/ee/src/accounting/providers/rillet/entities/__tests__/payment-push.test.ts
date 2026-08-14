import { beforeEach, describe, expect, it, vi } from "vitest";
import { RilletPaymentSyncer } from "../payment";

// Phase G — outbound payment write-back. A Carbon-born Posted payment pushes to
// Rillet as a payment document; a provider-recorded (pulled) payment is skipped
// by the mapping-exists guard. The pull path is covered in payment.test.ts.

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({ functions: { invoke: vi.fn() } })
}));

// The mapping link runs inside withTriggersDisabled (a real Kysely transaction
// with a `SET LOCAL` statement). Stub it to invoke the callback with a capturing
// tx so the link's insert is observable without a live DB — `txLinkSink` records
// the values passed to `insertInto("externalIntegrationMapping").values(...)`.
const { txLinkSink } = vi.hoisted(() => ({
  txLinkSink: [] as Array<Record<string, unknown>>
}));
vi.mock("../../../../core/utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../core/utils")>();
  return {
    ...actual,
    withTriggersDisabled: async (
      _db: unknown,
      cb: (tx: unknown) => Promise<unknown>
    ) => {
      const insertBuilder: Record<string, unknown> = {};
      insertBuilder.values = (v: Record<string, unknown>) => {
        txLinkSink.push(v);
        return insertBuilder;
      };
      insertBuilder.onConflict = () => insertBuilder;
      insertBuilder.execute = async () => [];
      return cb({ insertInto: () => insertBuilder });
    }
  };
});

beforeEach(() => {
  txLinkSink.length = 0;
});

type PaymentRow = {
  status: "Draft" | "Posted" | "Voided";
  paymentType: "Receipt" | "Disbursement";
  bankAccount: string;
  currencyCode: string;
  exchangeRate: number;
  paymentDate: string;
  postingDate: string | null;
  reference: string | null;
};

type SettlementRow = {
  targetSalesInvoiceId: string | null;
  targetPurchaseInvoiceId: string | null;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
};

function makePushDb(opts: {
  metadata?: unknown;
  payment?: PaymentRow;
  settlements?: SettlementRow[];
  linkSink: Array<Record<string, unknown>>;
}) {
  const selectChain = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.where = () => b;
    b.execute = async () => rows;
    b.executeTakeFirst = async () => rows[0];
    return b;
  };
  return {
    selectFrom: (t: string) => {
      if (t === "companyIntegration") {
        return selectChain(
          opts.metadata === undefined ? [] : [{ metadata: opts.metadata }]
        );
      }
      if (t === "payment") {
        return selectChain(opts.payment ? [opts.payment] : []);
      }
      if (t === "invoiceSettlement") return selectChain(opts.settlements ?? []);
      return selectChain([]);
    },
    transaction: () => ({
      execute: async (cb: (tx: unknown) => Promise<unknown>) => {
        const insertBuilder: Record<string, unknown> = {};
        insertBuilder.values = (v: Record<string, unknown>) => {
          opts.linkSink.push(v);
          return insertBuilder;
        };
        insertBuilder.onConflict = () => insertBuilder;
        insertBuilder.execute = async () => [];
        const tx = {
          executeQuery: async () => ({ rows: [] }),
          insertInto: () => insertBuilder
        };
        return cb(tx);
      }
    })
  } as never;
}

function makeSyncer(opts: {
  db: ReturnType<typeof makePushDb>;
  mapping?: { metadata: Record<string, unknown> | null } | null;
  documentRemoteId?: string | null;
  accountCodes?: Map<string, string>;
  enabled?: boolean;
  createInvoicePayment?: ReturnType<typeof vi.fn>;
  createBillPayment?: ReturnType<typeof vi.fn>;
}) {
  const createInvoicePayment =
    opts.createInvoicePayment ??
    vi.fn(async () => ({ id: "rillet-pay-1", status: "SUCCESSFUL" }));
  const createBillPayment =
    opts.createBillPayment ??
    vi.fn(async () => ({ id: "rillet-pay-1", status: "SUCCESSFUL" }));

  const syncer = new RilletPaymentSyncer({
    database: opts.db,
    companyId: "company-1",
    provider: {
      id: "rillet",
      createInvoicePayment,
      createBillPayment
    } as never,
    config: {
      enabled: opts.enabled ?? true,
      direction: "two-way",
      owner: "accounting"
    },
    entityType: "payment"
  });

  const s = syncer as unknown as Record<string, unknown>;
  s.mappingService = {
    getByEntity: async () => opts.mapping ?? null,
    getExternalId: async () => opts.documentRemoteId ?? null
  };
  // Pre-seed the account-code cache so the adapter never hits the DB.
  s.accountCodesByIdPromise = Promise.resolve(
    opts.accountCodes ?? new Map([["bank-1", "1000"]])
  );

  return { syncer, createInvoicePayment, createBillPayment };
}

const apPayment: PaymentRow = {
  status: "Posted",
  paymentType: "Disbursement",
  bankAccount: "bank-1",
  currencyCode: "USD",
  exchangeRate: 1,
  paymentDate: "2026-08-07",
  postingDate: "2026-08-07",
  reference: "PAY-1"
};

const apSettlement: SettlementRow = {
  targetSalesInvoiceId: null,
  targetPurchaseInvoiceId: "pinv-1",
  appliedAmount: 100,
  discountAmount: 0,
  writeOffAmount: 0
};

describe("RilletPaymentSyncer push — happy path", () => {
  it("pushes a Carbon-born AP payment as a Rillet bill payment and links the mapping", async () => {
    const linkSink: Array<Record<string, unknown>> = [];
    const { syncer, createBillPayment } = makeSyncer({
      db: makePushDb({
        payment: apPayment,
        settlements: [apSettlement],
        linkSink
      }),
      mapping: null, // Carbon-born: no existing payment mapping
      documentRemoteId: "bill-remote-1"
    });

    const result = await syncer.pushToAccounting("pay_1");

    expect(result.status).toBe("success");
    expect(result.remoteId).toBe("rillet-pay-1");

    // Created against the mapped bill remote id, in the payment currency,
    // clearing through the mapped bank account, tagged with the Carbon id.
    expect(createBillPayment).toHaveBeenCalledTimes(1);
    const [billId, payload, idempotencyKey] = createBillPayment.mock.calls[0]!;
    expect(billId).toBe("bill-remote-1");
    expect(payload).toMatchObject({
      amount: { amount: "100.00", currency: "USD" },
      date: "2026-08-07",
      account_code: "1000",
      external_references: [{ type: "carbon", id: "pay_1" }]
    });
    expect(typeof idempotencyKey).toBe("string");

    // Mapping linked under the AP composite id, stamped Carbon-origin.
    expect(txLinkSink).toHaveLength(1);
    expect(txLinkSink[0]).toMatchObject({
      entityType: "payment",
      entityId: "pay_1",
      externalId: "bill:bill-remote-1:rillet-pay-1",
      metadata: { origin: "carbon" }
    });
  });

  it("pushes a Carbon-born AR payment as a Rillet invoice payment (prefix-less composite)", async () => {
    const { syncer, createInvoicePayment } = makeSyncer({
      db: makePushDb({
        payment: { ...apPayment, paymentType: "Receipt" },
        settlements: [
          {
            ...apSettlement,
            targetPurchaseInvoiceId: null,
            targetSalesInvoiceId: "sinv-1"
          }
        ],
        linkSink: []
      }),
      mapping: null,
      documentRemoteId: "inv-remote-1"
    });

    const result = await syncer.pushToAccounting("pay_1");

    expect(result.status).toBe("success");
    expect(createInvoicePayment).toHaveBeenCalledTimes(1);
    expect(txLinkSink[0]).toMatchObject({
      externalId: "inv-remote-1:rillet-pay-1"
    });
  });
});

describe("RilletPaymentSyncer push — origin routing (loop guard)", () => {
  it("skips a provider-known payment (mapping already exists) — idempotent", async () => {
    const { syncer, createBillPayment } = makeSyncer({
      db: makePushDb({
        payment: apPayment,
        settlements: [apSettlement],
        linkSink: []
      }),
      mapping: { metadata: null } as never // a pulled payment carries a mapping
    });
    // getByEntity returns a mapping WITH an externalId → idempotent skip.
    (syncer as unknown as Record<string, unknown>).mappingService = {
      getByEntity: async () => ({
        externalId: "bill:bill-remote-1:rillet-pay-1",
        metadata: null
      })
    };

    const result = await syncer.pushToAccounting("pay_1");

    expect(result.status).toBe("skipped");
    expect(result.error).toContain("already linked");
    expect(createBillPayment).not.toHaveBeenCalled();
  });
});

describe("RilletPaymentSyncer push — gates (parked as Skipped)", () => {
  it("skips when the AP family is not in documents mode", async () => {
    const { syncer, createBillPayment } = makeSyncer({
      db: makePushDb({
        metadata: {
          settings: { postingSync: { families: { ap: "journals" } } }
        },
        payment: apPayment,
        settlements: [apSettlement],
        linkSink: []
      }),
      mapping: null
    });

    const result = await syncer.pushToAccounting("pay_1");
    expect(result.status).toBe("skipped");
    expect(result.error).toContain("documents mode");
    expect(createBillPayment).not.toHaveBeenCalled();
  });

  it("fans a multi-settlement payment out to one provider payment per document, each linked under a suffixed key", async () => {
    let call = 0;
    const createBillPayment = vi.fn(async (..._args: unknown[]) => ({
      id: `rillet-pay-${++call}`,
      status: "SUCCESSFUL"
    }));
    const { syncer } = makeSyncer({
      db: makePushDb({
        payment: apPayment,
        settlements: [
          {
            ...apSettlement,
            targetPurchaseInvoiceId: "pinv-2",
            appliedAmount: 40
          },
          apSettlement
        ],
        linkSink: []
      }),
      mapping: null,
      documentRemoteId: "bill-remote-1",
      createBillPayment
    });

    const result = await syncer.pushToAccounting("pay_1");
    expect(result.status).toBe("success");

    // One provider payment per settlement, in deterministic target order
    // (pinv-1 before pinv-2), each for ITS applied amount.
    expect(createBillPayment).toHaveBeenCalledTimes(2);
    expect(createBillPayment.mock.calls[0]?.[1]).toMatchObject({
      amount: { amount: "100.00", currency: "USD" }
    });
    expect(createBillPayment.mock.calls[1]?.[1]).toMatchObject({
      amount: { amount: "40.00", currency: "USD" }
    });

    // Each fan-out leg links under `<paymentId>:<targetDocId>` so a partial
    // failure resumes instead of double-creating.
    expect(txLinkSink).toHaveLength(2);
    expect(txLinkSink[0]).toMatchObject({
      entityType: "payment",
      entityId: "pay_1:pinv-1",
      externalId: "bill:bill-remote-1:rillet-pay-1",
      metadata: { origin: "carbon" }
    });
    expect(txLinkSink[1]).toMatchObject({
      entityId: "pay_1:pinv-2",
      externalId: "bill:bill-remote-1:rillet-pay-2"
    });
  });

  it("skips a foreign-currency payment", async () => {
    const { syncer } = makeSyncer({
      db: makePushDb({
        payment: { ...apPayment, exchangeRate: 2 },
        settlements: [apSettlement],
        linkSink: []
      }),
      mapping: null
    });

    const result = await syncer.pushToAccounting("pay_1");
    expect(result.status).toBe("skipped");
    expect(result.error).toContain("FX");
  });

  it("skips a payment carrying a discount", async () => {
    const { syncer } = makeSyncer({
      db: makePushDb({
        payment: apPayment,
        settlements: [{ ...apSettlement, discountAmount: 5 }],
        linkSink: []
      }),
      mapping: null
    });

    const result = await syncer.pushToAccounting("pay_1");
    expect(result.status).toBe("skipped");
    expect(result.error).toContain("discount");
  });

  it("skips when the syncer config is disabled", async () => {
    const { syncer } = makeSyncer({
      db: makePushDb({
        payment: apPayment,
        settlements: [apSettlement],
        linkSink: []
      }),
      mapping: null,
      enabled: false
    });

    const result = await syncer.pushToAccounting("pay_1");
    expect(result.status).toBe("skipped");
    expect(result.error).toContain("disabled");
  });
});

describe("RilletPaymentSyncer push — void routing", () => {
  it("skips (not supported) a voided Carbon-originated payment", async () => {
    const { syncer } = makeSyncer({
      db: makePushDb({
        payment: { ...apPayment, status: "Voided" },
        settlements: [apSettlement],
        linkSink: []
      }),
      mapping: { metadata: { origin: "carbon" } }
    });

    const result = await syncer.pushToAccounting("pay_1");
    expect(result.status).toBe("skipped");
    expect(result.error).toContain("not supported");
  });

  it("skips a voided pulled payment (no Carbon-originated provider payment to reverse)", async () => {
    const { syncer } = makeSyncer({
      db: makePushDb({
        payment: { ...apPayment, status: "Voided" },
        settlements: [apSettlement],
        linkSink: []
      }),
      mapping: { metadata: null } // pulled: no origin stamp
    });

    const result = await syncer.pushToAccounting("pay_1");
    expect(result.status).toBe("skipped");
    expect(result.error).toContain("no Carbon-originated");
  });
});

describe("RilletPaymentSyncer.pushRemotePayment — mapping Warnings", () => {
  function adapter(opts: {
    documentRemoteId?: string | null;
    accountCodes?: Map<string, string>;
  }) {
    const { syncer } = makeSyncer({
      db: makePushDb({ linkSink: [] }),
      documentRemoteId: opts.documentRemoteId,
      accountCodes: opts.accountCodes
    });
    return syncer as unknown as {
      pushRemotePayment(ctx: {
        carbonPaymentId: string;
        family: "ar" | "ap";
        targetDocumentId: string;
        bankAccountId: string;
        amount: number;
        currencyCode: string;
        paidDate: string;
        reference: string | null;
      }): Promise<{ remoteId: string; compositeEntityId: string }>;
    };
  }

  const ctx = {
    carbonPaymentId: "pay_1",
    family: "ap" as const,
    targetDocumentId: "pinv-1",
    bankAccountId: "bank-1",
    amount: 100,
    currencyCode: "USD",
    paidDate: "2026-08-07",
    reference: "PAY-1"
  };

  it("warns (UNSYNCED_DOCUMENT) when the settled document has not synced", async () => {
    await expect(
      adapter({ documentRemoteId: null }).pushRemotePayment(ctx)
    ).rejects.toMatchObject({
      failure: { errorCode: "UNSYNCED_DOCUMENT", warning: true }
    });
  });

  it("warns (UNMAPPED_ACCOUNTS) when the bank account is not mapped", async () => {
    await expect(
      adapter({
        documentRemoteId: "bill-remote-1",
        accountCodes: new Map() // bank-1 absent
      }).pushRemotePayment(ctx)
    ).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_ACCOUNTS", warning: true }
    });
  });
});
