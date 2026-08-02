import type { KyselyTx } from "@carbon/database/client";
import { sql } from "kysely";
import { createMappingService } from "../../../core/external-mapping";
import {
  BaseEntitySyncer,
  type BatchSyncResult,
  type ShouldSyncContext,
  type SyncResult
} from "../../../core/types";
import type { Rillet, RilletLocalPayment } from "../models";
import type { RilletProvider } from "../provider";

/**
 * RilletPaymentSyncer — the first PULL-ONLY payment syncer in the
 * codebase: Rillet invoice payments (recorded against pushed AR_ONLY
 * invoices) settle Carbon sales invoices. Push methods are rejection
 * stubs; ENTITY_DEFINITIONS.payment is pull-only and depends on
 * invoice/bill.
 *
 * Entity-id contract (mirrors the journal ":reversal" suffix contract in
 * core/posting.ts): the sync operation's entityId is the COMPOSITE
 * `"<invoiceRemoteId>:<paymentRemoteId>"` — Rillet payments are only
 * addressable through their invoice (GET /invoices/{id}/payments), and
 * the drain hands syncers nothing but entity ids, so the composite makes
 * the syncer self-sufficient. The webhook route (written separately)
 * builds operation ids with getRilletPaymentSyncEntityId from the
 * invoice-payment-updated payload; mappings under entityType "payment"
 * are stored against the composite id.
 *
 * What upsertLocal writes (inside the base pull workflow's
 * withTriggersDisabled transaction):
 * - a `payment` row (paymentType "Receipt", status "Posted", journalId
 *   NULL — Rillet owns the cash GL for pulled payments; bankAccount from
 *   accountDefault.bankCashAccount, reference = the Rillet payment id);
 * - one `invoiceSettlement` row applying the full amount to the mapped
 *   Carbon sales invoice;
 * - the invoice's settled status via getSettledInvoiceStatus.
 * A FAILED status voids the previously recorded payment and deletes its
 * settlement (a first-seen FAILED payment is skipped by shouldSync).
 *
 * v1 simplifications (documented, not accidental): exchange rates are
 * recorded as 1 (Rillet payments settle same-currency AR_ONLY invoices),
 * and the settled total counts settlements whose source payment is
 * Posted (memo-sourced settlements count as-is).
 */

const PULL_ONLY_MESSAGE =
  "Payments are pull-only for Rillet: pushing Carbon payments to Rillet is not supported";

const SYNC_ID_SEPARATOR = ":";

/** Composite sync entity id for one Rillet invoice payment. */
export function getRilletPaymentSyncEntityId(
  invoiceRemoteId: string,
  paymentRemoteId: string
): string {
  return `${invoiceRemoteId}${SYNC_ID_SEPARATOR}${paymentRemoteId}`;
}

/** Split a composite payment entity id. Throws on a malformed id. */
export function parseRilletPaymentSyncEntityId(entityId: string): {
  invoiceRemoteId: string;
  paymentRemoteId: string;
} {
  const separatorIndex = entityId.indexOf(SYNC_ID_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex === entityId.length - 1) {
    throw new Error(
      `Invalid Rillet payment sync entity id "${entityId}" — expected "<invoiceRemoteId>:<paymentRemoteId>"`
    );
  }
  return {
    invoiceRemoteId: entityId.slice(0, separatorIndex),
    paymentRemoteId: entityId.slice(separatorIndex + 1)
  };
}

/**
 * Invoice status implied by its settled total (cents-accurate). Returns
 * null for "don't touch": a zero/negative settled total says nothing
 * about what the status should be (the pre-payment status is unknowable
 * here), and a degenerate zero-total invoice is never restated.
 */
export function getSettledInvoiceStatus(args: {
  invoiceTotal: number;
  settledTotal: number;
}): "Paid" | "Partially Paid" | null {
  const totalCents = Math.round(args.invoiceTotal * 100);
  const settledCents = Math.round(args.settledTotal * 100);

  if (totalCents <= 0 || settledCents <= 0) return null;
  if (settledCents >= totalCents) return "Paid";
  return "Partially Paid";
}

/**
 * Numeric amount from either wire shape: the list endpoint's
 * `{ amount: { amount: "100.00", currency } }` or the webhook's flat
 * `amount` + `currency`.
 */
export function getRilletPaymentAmount(remote: Rillet.InvoicePayment): number {
  const raw = remote.amount;
  if (raw && typeof raw === "object") return Number(raw.amount) || 0;
  if (typeof raw === "string" || typeof raw === "number") {
    return Number(raw) || 0;
  }
  return 0;
}

/** Currency from either wire shape (see getRilletPaymentAmount). */
export function getRilletPaymentCurrency(
  remote: Rillet.InvoicePayment
): string | null {
  if (remote.amount && typeof remote.amount === "object") {
    return remote.amount.currency ?? null;
  }
  return remote.currency ?? null;
}

/**
 * Normalize a Rillet invoice payment onto the local shape. Pure —
 * exported for tests. The composite id / invoice id are completed by
 * upsertLocal from the operation's entity id (the list-endpoint
 * invoice_id is carried through when present).
 */
export function mapRilletPaymentToLocal(
  remote: Rillet.InvoicePayment
): Partial<RilletLocalPayment> {
  const date = (
    remote.date ??
    remote.payment_date ??
    remote.updated_at ??
    remote.created_at ??
    new Date().toISOString()
  ).slice(0, 10);

  return {
    paymentRemoteId: remote.id,
    ...(remote.invoice_id ? { invoiceRemoteId: remote.invoice_id } : {}),
    amount: getRilletPaymentAmount(remote),
    currencyCode: getRilletPaymentCurrency(remote),
    date,
    status: remote.status,
    updatedAt: remote.updated_at ?? new Date().toISOString()
  };
}

export class RilletPaymentSyncer extends BaseEntitySyncer<
  RilletLocalPayment,
  Rillet.InvoicePayment,
  never
> {
  private get rilletProvider(): RilletProvider {
    return this.provider as RilletProvider;
  }

  // =================================================================
  // 1. REMOTE FETCH — composite id → list the invoice's payments
  // =================================================================

  async fetchRemote(entityId: string): Promise<Rillet.InvoicePayment | null> {
    const { invoiceRemoteId, paymentRemoteId } =
      parseRilletPaymentSyncEntityId(entityId);

    const payments =
      await this.rilletProvider.listInvoicePayments(invoiceRemoteId);
    return payments.find((payment) => payment.id === paymentRemoteId) ?? null;
  }

  /**
   * Keyed by the COMPOSITE entity id (the base pull workflow uses the map
   * keys as remote ids, and the drain matches results back to operations
   * by entityId). One listing per distinct invoice per batch.
   */
  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Rillet.InvoicePayment>> {
    const result = new Map<string, Rillet.InvoicePayment>();
    const paymentsByInvoice = new Map<string, Rillet.InvoicePayment[]>();

    for (const entityId of ids) {
      const { invoiceRemoteId, paymentRemoteId } =
        parseRilletPaymentSyncEntityId(entityId);

      let payments = paymentsByInvoice.get(invoiceRemoteId);
      if (!payments) {
        payments =
          await this.rilletProvider.listInvoicePayments(invoiceRemoteId);
        paymentsByInvoice.set(invoiceRemoteId, payments);
      }

      const payment = payments.find((p) => p.id === paymentRemoteId);
      if (payment) result.set(entityId, payment);
    }

    return result;
  }

  // =================================================================
  // 2. TIMESTAMP + SHOULD SYNC
  // =================================================================

  protected getRemoteUpdatedAt(remote: Rillet.InvoicePayment): Date | null {
    if (!remote.updated_at) return null;
    const parsed = new Date(remote.updated_at);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  protected async shouldSync(
    context: ShouldSyncContext<RilletLocalPayment, Rillet.InvoicePayment>
  ): Promise<boolean | string> {
    if (context.direction === "push") {
      return PULL_ONLY_MESSAGE;
    }

    // Ownership gate: Rillet webhooks are organization-level and cannot be
    // filtered by subsidiary, so with several Carbon instances writing to
    // one Rillet org (one subsidiary each), every instance receives every
    // payment event. The pushed invoice's mapping is the ownership record:
    // no local mapping means the invoice belongs to another instance's
    // subsidiary or was created directly in Rillet — either way there is
    // no Carbon sales invoice to settle here, and that is a benign skip,
    // not a failure.
    const { invoiceRemoteId } = parseRilletPaymentSyncEntityId(
      context.entityId
    );
    const salesInvoiceId = await this.mappingService.getEntityId(
      this.provider.id,
      invoiceRemoteId,
      "invoice"
    );
    if (!salesInvoiceId) {
      return `Rillet invoice ${invoiceRemoteId} has no Carbon mapping — the payment belongs to another Carbon instance's subsidiary or to an invoice created directly in Rillet`;
    }

    // A payment first seen as FAILED was never recorded — nothing to void
    if (context.remoteEntity?.status === "FAILED" && context.isFirstSync) {
      return "Failed Rillet payment was never recorded in Carbon — nothing to do";
    }

    return true;
  }

  // =================================================================
  // 3. TRANSFORMATION (Rillet -> Carbon)
  // =================================================================

  protected async mapToLocal(
    remote: Rillet.InvoicePayment
  ): Promise<Partial<RilletLocalPayment>> {
    return mapRilletPaymentToLocal(remote);
  }

  // =================================================================
  // 4. UPSERT LOCAL — payment + invoiceSettlement + invoice status
  //    (runs inside the base pull workflow's withTriggersDisabled tx)
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<RilletLocalPayment>,
    remoteId: string
  ): Promise<string> {
    const { invoiceRemoteId, paymentRemoteId } =
      parseRilletPaymentSyncEntityId(remoteId);
    const txMappingService = createMappingService(tx, this.companyId);
    const now = new Date().toISOString();

    // The pushed invoice's mapping is the anchor: no mapping, no settlement
    const salesInvoiceId = await txMappingService.getEntityId(
      this.provider.id,
      invoiceRemoteId,
      "invoice"
    );
    if (!salesInvoiceId) {
      throw new Error(
        `Rillet invoice ${invoiceRemoteId} is not mapped to a Carbon sales invoice; push the invoice first`
      );
    }

    const invoice = await tx
      .selectFrom("salesInvoice")
      .select(["id", "customerId", "currencyCode", "totalAmount"])
      .where("id", "=", salesInvoiceId)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();
    if (!invoice) {
      throw new Error(
        `Carbon sales invoice ${salesInvoiceId} (Rillet invoice ${invoiceRemoteId}) not found`
      );
    }

    // Idempotency anchor: the payment mapping under the composite id
    const existingMapping = await txMappingService.getByExternalId(
      this.provider.id,
      remoteId,
      "payment"
    );
    const existingPaymentRowId = existingMapping?.entityId ?? null;
    const actorId = await this.getDefaultUser(tx);

    if (data.status === "FAILED") {
      if (!existingPaymentRowId) {
        // shouldSync skips first-seen FAILED payments; a mapping without a
        // payment row is unreachable through this syncer
        throw new Error(
          `Rillet payment ${paymentRemoteId} failed but was never recorded in Carbon — nothing to void`
        );
      }

      await tx
        .deleteFrom("invoiceSettlement")
        .where("paymentId", "=", existingPaymentRowId)
        .where("companyId", "=", this.companyId)
        .execute();

      await tx
        .updateTable("payment")
        .set({
          status: "Voided",
          voidedAt: now,
          voidedBy: actorId,
          updatedBy: actorId,
          updatedAt: now
        })
        .where("id", "=", existingPaymentRowId)
        .where("companyId", "=", this.companyId)
        .execute();

      await this.applySettledInvoiceStatus(tx, {
        invoiceId: invoice.id,
        invoiceTotal: Number(invoice.totalAmount) || 0,
        paidDate: null,
        justVoided: true
      });

      return existingPaymentRowId;
    }

    // SUCCESSFUL / UNCLEARED / CLEARED / RECONCILED all settle the invoice
    const amount = data.amount ?? 0;
    const paymentDate = data.date ?? now.slice(0, 10);
    const currencyCode = data.currencyCode ?? invoice.currencyCode;

    let paymentRowId = existingPaymentRowId;
    if (paymentRowId) {
      await tx
        .updateTable("payment")
        .set({
          status: "Posted",
          paymentDate,
          postingDate: paymentDate,
          currencyCode,
          totalAmount: amount,
          voidedAt: null,
          voidedBy: null,
          updatedBy: actorId,
          updatedAt: now
        })
        .where("id", "=", paymentRowId)
        .where("companyId", "=", this.companyId)
        .execute();
    } else {
      const sequence = await sql<{ get_next_sequence: string }>`
        SELECT get_next_sequence('payment', ${this.companyId}) as get_next_sequence
      `.execute(tx);
      const readableId =
        sequence.rows[0]?.get_next_sequence ??
        `RILLET-${paymentRemoteId.slice(0, 8)}`;

      const inserted = await tx
        .insertInto("payment")
        .values({
          paymentId: readableId,
          paymentType: "Receipt",
          status: "Posted",
          customerId: invoice.customerId,
          paymentDate,
          postingDate: paymentDate,
          currencyCode,
          exchangeRate: 1,
          totalAmount: amount,
          bankAccount: await this.getBankCashAccount(tx),
          reference: paymentRemoteId,
          // journalId stays NULL: Rillet owns the cash GL for pulled payments
          companyId: this.companyId,
          createdBy: actorId,
          createdAt: now
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      paymentRowId = inserted.id;
    }

    // Replace this payment's settlement (a Rillet invoice payment applies
    // to exactly one invoice). invoiceSettlement requires a positive
    // component sum, so a zero-amount payment records no settlement.
    await tx
      .deleteFrom("invoiceSettlement")
      .where("paymentId", "=", paymentRowId)
      .where("companyId", "=", this.companyId)
      .execute();

    if (amount > 0) {
      await tx
        .insertInto("invoiceSettlement")
        .values({
          paymentId: paymentRowId,
          targetSalesInvoiceId: invoice.id,
          appliedAmount: amount,
          discountAmount: 0,
          writeOffAmount: 0,
          sourceExchangeRate: 1,
          targetExchangeRate: 1,
          appliedDate: paymentDate,
          companyId: this.companyId,
          createdBy: actorId
        })
        .execute();
    }

    await this.applySettledInvoiceStatus(tx, {
      invoiceId: invoice.id,
      invoiceTotal: Number(invoice.totalAmount) || 0,
      paidDate: paymentDate,
      justVoided: false
    });

    return paymentRowId;
  }

  /**
   * Recompute the invoice's settled total (Posted cash payments + memo
   * settlements) and apply getSettledInvoiceStatus. A null status leaves
   * the invoice untouched — except right after a void, where datePaid is
   * cleared (the pre-payment status itself is unknowable and stays).
   */
  private async applySettledInvoiceStatus(
    tx: KyselyTx,
    args: {
      invoiceId: string;
      invoiceTotal: number;
      paidDate: string | null;
      justVoided: boolean;
    }
  ): Promise<void> {
    const rows = await tx
      .selectFrom("invoiceSettlement")
      .leftJoin("payment", "payment.id", "invoiceSettlement.paymentId")
      .select([
        "invoiceSettlement.appliedAmount",
        "invoiceSettlement.memoId",
        "payment.status as paymentStatus"
      ])
      .where("invoiceSettlement.targetSalesInvoiceId", "=", args.invoiceId)
      .where("invoiceSettlement.companyId", "=", this.companyId)
      .execute();

    const settledTotal = rows
      .filter((row) => row.memoId !== null || row.paymentStatus === "Posted")
      .reduce((sum, row) => sum + (Number(row.appliedAmount) || 0), 0);

    const status = getSettledInvoiceStatus({
      invoiceTotal: args.invoiceTotal,
      settledTotal
    });
    const now = new Date().toISOString();

    if (status === "Paid") {
      await tx
        .updateTable("salesInvoice")
        .set({ status: "Paid", datePaid: args.paidDate, updatedAt: now })
        .where("id", "=", args.invoiceId)
        .where("companyId", "=", this.companyId)
        .execute();
    } else if (status === "Partially Paid") {
      await tx
        .updateTable("salesInvoice")
        .set({ status: "Partially Paid", datePaid: null, updatedAt: now })
        .where("id", "=", args.invoiceId)
        .where("companyId", "=", this.companyId)
        .execute();
    } else if (args.justVoided) {
      await tx
        .updateTable("salesInvoice")
        .set({ datePaid: null, updatedAt: now })
        .where("id", "=", args.invoiceId)
        .where("companyId", "=", this.companyId)
        .execute();
    }
  }

  /** accountDefault.bankCashAccount — payment.bankAccount is NOT NULL. */
  private async getBankCashAccount(tx: KyselyTx): Promise<string> {
    const defaults = await tx
      .selectFrom("accountDefault")
      .select("bankCashAccount")
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    if (!defaults?.bankCashAccount) {
      throw new Error(
        `No bank/cash account default (accountDefault.bankCashAccount) configured for company ${this.companyId} — required to record Rillet payments`
      );
    }
    return defaults.bankCashAccount;
  }

  /**
   * Default user for system-generated records: company group owner, then
   * first active employee (QBO/Xero bill-syncer parity).
   */
  private async getDefaultUser(tx: KyselyTx): Promise<string> {
    const group = await tx
      .selectFrom("company")
      .innerJoin("companyGroup", "companyGroup.id", "company.companyGroupId")
      .select("companyGroup.ownerId")
      .where("company.id", "=", this.companyId)
      .executeTakeFirst();

    if (group?.ownerId) {
      return group.ownerId;
    }

    const employee = await tx
      .selectFrom("employeeJob")
      .innerJoin("user", "user.id", "employeeJob.id")
      .select("employeeJob.id")
      .where("employeeJob.companyId", "=", this.companyId)
      .where("user.active", "=", true)
      .orderBy("user.createdAt", "asc")
      .limit(1)
      .executeTakeFirst();

    if (!employee?.id) {
      throw new Error(
        `Cannot record Rillet payment: no default user found for company ${this.companyId}`
      );
    }
    return employee.id;
  }

  // =================================================================
  // 5. PUSH WORKFLOW - Not supported (pull-only)
  // =================================================================

  async fetchLocal(_id: string): Promise<RilletLocalPayment | null> {
    throw new Error(PULL_ONLY_MESSAGE);
  }

  protected async fetchLocalBatch(
    _ids: string[]
  ): Promise<Map<string, RilletLocalPayment>> {
    throw new Error(PULL_ONLY_MESSAGE);
  }

  protected async mapToRemote(
    _local: RilletLocalPayment
  ): Promise<Rillet.InvoicePayment> {
    throw new Error(PULL_ONLY_MESSAGE);
  }

  protected async upsertRemote(
    _data: Rillet.InvoicePayment,
    _localId: string
  ): Promise<string> {
    throw new Error(PULL_ONLY_MESSAGE);
  }

  protected async upsertRemoteBatch(
    _data: Array<{ localId: string; payload: Rillet.InvoicePayment }>
  ): Promise<Map<string, string>> {
    throw new Error(PULL_ONLY_MESSAGE);
  }

  async pushToAccounting(entityId: string): Promise<SyncResult> {
    return {
      status: "error",
      action: "none",
      localId: entityId,
      error: PULL_ONLY_MESSAGE
    };
  }

  async pushBatchToAccounting(entityIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = entityIds.map((entityId) => ({
      status: "error",
      action: "none",
      localId: entityId,
      error: PULL_ONLY_MESSAGE
    }));

    return {
      results,
      successCount: 0,
      errorCount: results.length,
      skippedCount: 0
    };
  }
}
