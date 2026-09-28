import type { RampClient } from "@carbon/ee/ramp.server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type RampBillPaymentDependencies,
  syncRampBillPayment
} from "./ramp-sync-payment";
import {
  type RampReimbursementDependencies,
  syncRampReimbursement
} from "./ramp-sync-reimbursement";
import { syncRampRepayments } from "./ramp-sync-repayment";
import type { RampSyncContext } from "./ramp-sync-shared";

vi.mock("@carbon/env", () => ({ getAppUrl: () => "http://localhost:3000" }));

afterEach(() => vi.restoreAllMocks());

describe("Ramp inbound accounting discriminators", () => {
  it.each([
    "ACH",
    "CHECK",
    "DIRECT_DEBIT",
    "DOMESTIC_WIRE",
    "FED_NOW",
    "INTERNATIONAL",
    "LOCAL_BANK_TRANSFER",
    "RTP",
    "SWIFT"
  ])("continues invoice resolution for verified bank method %s", async (payment_method) => {
    const getMappedInvoiceId = vi.fn().mockResolvedValue(null);
    const outcome = await syncRampBillPayment(
      { getMappedInvoiceId } as unknown as RampBillPaymentDependencies,
      { id: "bill-1" },
      { id: "payment-1", payment_method }
    );
    expect(outcome).toEqual({
      fail: {
        id: "payment-1",
        message: "Bill was never synced to Carbon — sync the bill first"
      }
    });
    expect(getMappedInvoiceId).toHaveBeenCalledWith("bill-1");
  });

  /**
   * The payout the guarded jsonb `||` merge interpolated. The update's value is
   * a Kysely raw fragment, so read its operation node's single parameter — the
   * JSON the code stringified.
   */
  function mergedPayout(update: unknown): unknown {
    const fragment = (update as { metadata: unknown }).metadata as {
      toOperationNode: () => { parameters: { value: unknown }[] };
    };
    const [parameter] = fragment.toOperationNode().parameters;
    return JSON.parse(String(parameter?.value));
  }

  // The mapped-reimbursement harness. `transaction` is only reached by the
  // Ramp-PAID states, which record a payout intent on the mapping; the
  // invoice-only states must never open one.
  function mappedReimbursementDeps(options?: {
    mappingMetadata?: Record<string, unknown> | null;
    document?: {
      amount: number;
      currencyCode: string;
      exchangeRate: number;
    } | null;
  }) {
    const mappingQuery = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi
        .fn()
        .mockResolvedValue({ entityId: "reimbursement-row-1" })
    };
    const documentQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "reimbursement-row-1", reimbursementId: "REIMB-1" },
        error: null
      })
    };
    const normalizeAmount = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "Payment amount required" });
    const from = vi.fn().mockReturnValue(documentQuery);
    const updates: unknown[] = [];
    const mappingRow =
      options?.mappingMetadata === undefined
        ? { id: "mapping-1", entityId: "reimbursement-row-1", metadata: {} }
        : {
            id: "mapping-1",
            entityId: "reimbursement-row-1",
            metadata: options.mappingMetadata
          };
    const document =
      options?.document === undefined
        ? { amount: 42.5, currencyCode: "EUR", exchangeRate: 0.9 }
        : options.document;
    const transaction = vi.fn().mockReturnValue({
      execute: async (
        cb: (tx: Record<string, unknown>) => Promise<unknown>
      ) => {
        const tx = {
          // The advisory lock is a raw `sql` fragment, and RawBuilder.execute
          // asks its argument for a Kysely executor — the minimum that satisfies
          // it, since the lock has no result the code reads.
          getExecutor: () => ({
            transformQuery: (node: unknown) => node,
            compileQuery: () => ({ sql: "", parameters: [] }),
            executeQuery: async () => ({ rows: [] }),
            provideConnection: async (
              consumer: (connection: unknown) => Promise<unknown>
            ) => consumer({ executeQuery: async () => ({ rows: [] }) })
          }),
          // createMappingService reads the mapping row; the document read then
          // reuses the same builder with its own resolved value.
          selectFrom: vi.fn().mockImplementation((table: string) => ({
            selectAll: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            executeTakeFirst: vi
              .fn()
              .mockResolvedValue(
                table === "reimbursement" ? document : mappingRow
              )
          })),
          updateTable: vi.fn().mockReturnValue({
            set: vi.fn().mockImplementation((values: unknown) => {
              updates.push(values);
              return {
                where: vi.fn().mockReturnThis(),
                execute: async () => []
              };
            })
          })
        };
        return cb(tx);
      }
    });
    return {
      updates,
      normalizeAmount,
      from,
      transaction,
      deps: {
        db: {
          selectFrom: vi.fn().mockReturnValue(mappingQuery),
          transaction
        },
        client: { from },
        companyId: "company-1",
        reimbursementBankAccountId: "bank-1",
        normalizeAmount,
        reimbursementDeepLinkUrl: (id: string) =>
          `https://carbon.example/x/reimbursements/${id}`
      } as unknown as RampReimbursementDependencies
    };
  }

  const confirmed = {
    ok: {
      id: "reimbursement-1",
      referenceId: "REIMB-1",
      deepLinkUrl: "https://carbon.example/x/reimbursements/reimbursement-row-1"
    }
  };

  it.each([
    "MANUALLY_REIMBURSED",
    "APPROVED",
    "AWAITING_PAYMENT",
    "AWAITING_PUSH_PAYMENT"
  ])("re-confirms an already-imported reimbursement in state %s without touching it", async (state) => {
    // Carbon owns the document once it lands. An invoice-only state has no
    // payout to record, so a mapped item does no work beyond the re-confirm.
    const harness = mappedReimbursementDeps();
    const outcome = await syncRampReimbursement(harness.deps, {
      id: "reimbursement-1",
      state
    });
    expect(outcome).toEqual(confirmed);
    expect(harness.normalizeAmount).not.toHaveBeenCalled();
    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.from).toHaveBeenCalledWith("reimbursement");
  });

  it.each([
    "REIMBURSED",
    "REIMBURSED_VIA_PUSH"
  ])("records the payout on an already-imported reimbursement Ramp has since paid (%s)", async (state) => {
    // Ramp lists a reimbursement while APPROVED and pays it later. Without
    // this the mapping keeps no `rampPaymentId`, Post never creates the
    // `payment`/`invoiceSettlement`, and Carbon never settles money that has
    // already left Ramp.
    const harness = mappedReimbursementDeps();
    const outcome = await syncRampReimbursement(harness.deps, {
      id: "reimbursement-1",
      state,
      approved_at: "2026-09-20T12:00:00Z",
      // Deliberately disagrees with the stored document: the snapshot must
      // come from the MAPPED reimbursement, never re-normalized from Ramp.
      entity_amount: { value: 999999, currency: "USD" }
    });
    expect(outcome).toEqual(confirmed);
    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.updates).toHaveLength(1);
    // The merged payout: the amount/currency/rate are the MAPPED document's
    // (42.50 EUR at 0.9), not the 999999 minor units Ramp re-listed.
    expect(mergedPayout(harness.updates[0])).toEqual({
      rampPaymentId: "reimbursement-payment:reimbursement-1",
      paidAt: "2026-09-20",
      bankAccountId: "bank-1",
      amount: 42.5,
      currencyCode: "EUR",
      exchangeRate: 0.9
    });
    expect(harness.normalizeAmount).not.toHaveBeenCalled();
  });

  it("never overwrites a payout intent already on the mapping", async () => {
    // An intent already recorded carries the FX snapshot of the payout that
    // actually happened.
    const harness = mappedReimbursementDeps({
      mappingMetadata: {
        rampPaymentId: "reimbursement-payment:reimbursement-1"
      }
    });
    const outcome = await syncRampReimbursement(harness.deps, {
      id: "reimbursement-1",
      state: "REIMBURSED",
      approved_at: "2026-09-20T12:00:00Z"
    });
    expect(outcome).toEqual(confirmed);
    expect(harness.updates).toHaveLength(0);
  });

  it("fails a Ramp-paid mapped reimbursement with no bank account configured", async () => {
    // Surfacing it in Sync Activity is the point: the alternative is an
    // unrecorded payout with nothing failing.
    const harness = mappedReimbursementDeps();
    const deps = {
      ...harness.deps,
      reimbursementBankAccountId: null,
      statementBankAccountId: null
    } as unknown as RampReimbursementDependencies;
    const outcome = await syncRampReimbursement(deps, {
      id: "reimbursement-1",
      state: "REIMBURSED",
      approved_at: "2026-09-20T12:00:00Z"
    });
    expect(outcome).toEqual({
      fail: {
        id: "reimbursement-1",
        message: expect.stringContaining("bank account")
      }
    });
    expect(harness.updates).toHaveLength(0);
  });

  it("continues original transaction resolution for documented ach repayments", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getEntityId = vi.fn().mockResolvedValue(null);
    const ctx = {
      companyId: "company-1",
      metadata: {
        sync: { pullReimbursements: true },
        statementBankAccountId: "bank-1"
      },
      mapping: { getEntityId }
    } as unknown as RampSyncContext;
    const ramp = {
      listRepayments: async function* () {
        yield [
          {
            id: "repayment-1",
            status: "REPAID",
            funding_method: "ach",
            original_transaction_id: "charge-1"
          }
        ];
      }
    } as unknown as RampClient;
    await syncRampRepayments(ctx, ramp, undefined, "card-1", null);
    expect(getEntityId).toHaveBeenCalledWith("ramp", "charge-1", "charge");
  });

  it.each([
    undefined,
    null,
    "",
    "NEW_PAYMENT_RAIL",
    "VENDOR_CREDIT",
    "PAID_MANUALLY",
    "UNSPECIFIED"
  ])("rejects unsupported bill payment method %s before any invoice lookup", async (payment_method) => {
    const getMappedInvoiceId = vi.fn().mockResolvedValue(null);
    const outcome = await syncRampBillPayment(
      { getMappedInvoiceId } as unknown as RampBillPaymentDependencies,
      { id: "bill-1" },
      { id: "payment-1", payment_method }
    );
    expect(outcome).toEqual({
      fail: {
        id: "payment-1",
        message: expect.stringContaining("payment method")
      }
    });
    expect(getMappedInvoiceId).not.toHaveBeenCalled();
  });

  it("skips one-time card delivery payments instead of posting bank payments", async () => {
    const getMappedInvoiceId = vi.fn().mockResolvedValue(null);
    expect(
      await syncRampBillPayment(
        { getMappedInvoiceId } as unknown as RampBillPaymentDependencies,
        { id: "bill-1" },
        { id: "payment-1", payment_method: "ONE_TIME_CARD_DELIVERY" }
      )
    ).toEqual({ skip: { id: "payment-1", referenceId: "payment-1" } });
    expect(getMappedInvoiceId).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "",
    "NEW_STATE",
    "PAID",
    "PAID_OUT",
    "REJECTED",
    "DELETED"
  ])("rejects unsupported reimbursement state %s before any invoice lookup", async (state) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(null)
    };
    const selectFrom = vi.fn().mockReturnValue(query);
    const outcome = await syncRampReimbursement(
      {
        db: { selectFrom },
        companyId: "company-1"
      } as unknown as RampReimbursementDependencies,
      { id: "reimbursement-1", state }
    );
    expect(outcome).toEqual({
      fail: {
        id: "reimbursement-1",
        message: expect.stringContaining("reimbursement state")
      }
    });
    expect(selectFrom).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    "",
    "NEW_FUNDING",
    "STATEMENT_CREDIT"
  ])("rejects unverified repayment funding %s before any transaction lookup", async (funding_method) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getEntityId = vi.fn().mockResolvedValue(null);
    const ctx = {
      companyId: "company-1",
      metadata: {
        sync: { pullReimbursements: true },
        statementBankAccountId: "bank-1"
      },
      mapping: { getEntityId }
    } as unknown as RampSyncContext;
    const ramp = {
      listRepayments: async function* () {
        yield [
          {
            id: "repayment-1",
            status: "REPAID",
            funding_method,
            original_transaction_id: "charge-1"
          }
        ];
      }
    } as unknown as RampClient;
    expect(
      await syncRampRepayments(ctx, ramp, undefined, "card-1", null)
    ).toMatchObject({ created: 0, failed: 1 });
    expect(getEntityId).not.toHaveBeenCalled();
  });
});
