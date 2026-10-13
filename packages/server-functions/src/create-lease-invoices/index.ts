// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Lease invoice drafting — shared by the lease page's "Invoice" action and
// the daily recurring-billing job, so a person and the scheduler bill exactly
// the same payment rows. Posting stays with post-purchase-invoice: this only
// drafts invoices; the buyer adds the supplier's invoice number and posts it.
// Spec: `.ai/specs/2026-10-11-lessee-leases.md` → Daily drafting.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { getNextSequence } from "@carbon/database/sequence";
import { openEndedLeaseHorizon, round } from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { currencyDecimals } from "../lib/currency-decimals";
import { cutLeasePaymentRows } from "../lib/lease-payment-rows";
import {
  BILLABLE_LEASE_STATUSES,
  isBillableLeaseStatus
} from "../post-purchase-invoice/lease-lines";

// The ERP's Draft setup cuts a lease's rows with the same cutter.
export {
  type CutLeasePaymentRow,
  cutLeasePaymentRows,
  type LeasePaymentCutAsset,
  type LeasePaymentCutTerms
} from "../lib/lease-payment-rows";

export type LeaseInvoiceGenerationArgs = {
  companyId: string;
  /** `YYYY-MM-DD` in the company's timezone: rows due on or before it are
   *  billed. */
  asOf: string;
  /** Bill one lease only (the lease page's action). */
  leaseId?: string;
  userId: string;
};

/** One invoice the generator drafted. */
export type DraftedLeaseInvoice = {
  invoiceId: string;
  leaseId: string;
};

export type LeaseInvoiceGenerationFailure = {
  leaseId: string;
  error: string;
};

export type LeaseInvoiceGenerationResult = {
  invoices: DraftedLeaseInvoice[];
  /** `invoices.map(i => i.invoiceId)`. */
  invoiceIds: string[];
  /** Leases whose transaction rolled back; their rows stay Pending. */
  failures: LeaseInvoiceGenerationFailure[];
};

/**
 * Drafts the purchase invoices of every lease with a Pending payment row due
 * on or before `asOf`: one Draft invoice per lease and due date, one Lease
 * line per row (a lease with several assets has a row per asset). Each
 * lease is its own transaction, so one lease's failure never rolls back another's invoice. The billed rows are stamped Invoiced
 * with their invoice line, which is what makes a second call for the same
 * day a no-op; deleting the Draft invoice or voiding a posted one returns
 * them to Pending.
 */
async function createLeaseInvoicesForDuePayments(
  db: Kysely<KyselyDatabase>,
  args: LeaseInvoiceGenerationArgs
): Promise<LeaseInvoiceGenerationResult> {
  const { companyId, asOf, leaseId } = args;

  let dueQuery = db
    .selectFrom("lease")
    .select("lease.id")
    .where("lease.companyId", "=", companyId)
    // An ended lease can still owe a termination penalty, a purchase
    // price, or a row a voided invoice returned to Pending.
    .where("lease.status", "in", BILLABLE_LEASE_STATUSES)
    .where((eb) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom("leasePayment as p")
            .select("p.id")
            .whereRef("p.leaseId", "=", "lease.id")
            .whereRef("p.companyId", "=", "lease.companyId")
            .where("p.status", "=", "Pending")
            .where("p.dueDate", "<=", asOf)
        ),
        // An Active open-ended lease's next rows are cut by this run.
        eb.and([
          eb("lease.status", "=", "Active"),
          eb("lease.endDate", "is", null)
        ])
      ])
    )
    .orderBy("lease.leaseId");
  if (leaseId) dueQuery = dueQuery.where("lease.id", "=", leaseId);
  const leases = await dueQuery.execute();

  const invoices: DraftedLeaseInvoice[] = [];
  const failures: LeaseInvoiceGenerationFailure[] = [];
  for (const lease of leases) {
    try {
      const drafted = await db
        .transaction()
        .execute((trx) => draftLeaseInvoices(trx, args, lease.id));
      invoices.push(...drafted);
    } catch (error) {
      failures.push({
        leaseId: lease.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return {
    invoices,
    invoiceIds: invoices.map((i) => i.invoiceId),
    failures
  };
}

async function draftLeaseInvoices(
  trx: KyselyTx,
  args: LeaseInvoiceGenerationArgs,
  leaseId: string
): Promise<DraftedLeaseInvoice[]> {
  const { companyId, asOf, userId } = args;

  const lease = await trx
    .selectFrom("lease")
    .select([
      "id",
      "status",
      "endDate",
      "supplierId",
      "supplierContactId",
      "supplierLocationId",
      "locationId",
      "currencyCode"
    ])
    .where("id", "=", leaseId)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (!isBillableLeaseStatus(lease.status)) return [];
  if (lease.status === "Active" && lease.endDate === null) {
    await rollOpenEndedLeasePayments(trx, { companyId, userId, leaseId, asOf });
  }

  const rows = await trx
    .selectFrom("leasePayment as p")
    .innerJoin("leaseLine as l", (join) =>
      join
        .onRef("l.id", "=", "p.leaseLineId")
        .onRef("l.companyId", "=", "p.companyId")
    )
    .select([
      "p.id",
      "p.paymentType",
      "p.amount",
      sql<string>`p."periodStart"::text`.as("periodStart"),
      sql<string>`p."periodEnd"::text`.as("periodEnd"),
      sql<string>`p."dueDate"::text`.as("dueDate"),
      "l.description",
      "l.locationId"
    ])
    .where("p.leaseId", "=", leaseId)
    .where("p.companyId", "=", companyId)
    .where("p.status", "=", "Pending")
    .where("p.dueDate", "<=", asOf)
    .orderBy("p.dueDate")
    .orderBy("l.sortOrder")
    .orderBy("p.paymentType")
    .forUpdate("p")
    .execute();
  if (rows.length === 0) return [];

  const payment = await trx
    .selectFrom("supplierPayment")
    .select([
      "invoiceSupplierId",
      "invoiceSupplierContactId",
      "invoiceSupplierLocationId",
      "paymentTermId"
    ])
    .where("supplierId", "=", lease.supplierId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();

  const byDueDate = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = byDueDate.get(row.dueDate) ?? [];
    group.push(row);
    byDueDate.set(row.dueDate, group);
  }

  const drafted: DraftedLeaseInvoice[] = [];
  for (const [dueDate, group] of byDueDate) {
    const subtotal = round(
      group.reduce((sum, row) => sum + Number(row.amount), 0)
    );
    const invoiceId = await getNextSequence(trx, "purchaseInvoice", companyId);
    // Every purchase invoice hangs off a supplier interaction, as the ERP's
    // `insertPurchaseInvoice` creates one.
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ companyId, supplierId: lease.supplierId })
      .returning("id")
      .executeTakeFirstOrThrow();
    const invoice = await trx
      .insertInto("purchaseInvoice")
      .values({
        invoiceId,
        status: "Draft",
        supplierId: lease.supplierId,
        invoiceSupplierId: payment?.invoiceSupplierId ?? lease.supplierId,
        invoiceSupplierContactId:
          payment?.invoiceSupplierContactId ?? lease.supplierContactId,
        invoiceSupplierLocationId:
          payment?.invoiceSupplierLocationId ?? lease.supplierLocationId,
        supplierInteractionId: interaction.id,
        locationId: lease.locationId,
        paymentTermId: payment?.paymentTermId ?? null,
        // v1 leases are base currency only.
        currencyCode: lease.currencyCode,
        exchangeRate: 1,
        dateIssued: dueDate,
        subtotal,
        totalDiscount: 0,
        totalAmount: subtotal,
        totalTax: 0,
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("purchaseInvoiceDelivery")
      .values({
        id: invoice.id,
        locationId: lease.locationId,
        supplierShippingCost: 0,
        companyId,
        updatedBy: userId
      })
      .execute();

    await trx
      .insertInto("purchaseInvoiceLine")
      .values(
        group.map((row, index) => ({
          invoiceId: invoice.id,
          invoiceLineType: "Lease" as const,
          leaseId,
          leasePaymentId: row.id,
          locationId: row.locationId ?? lease.locationId,
          description: leasePaymentDescription(row.description, row),
          quantity: 1,
          supplierUnitPrice: Number(row.amount),
          supplierShippingCost: 0,
          supplierTaxAmount: 0,
          taxPercent: 0,
          exchangeRate: 1,
          sortOrder: index + 1,
          companyId,
          createdBy: userId
        }))
      )
      .execute();

    await trx
      .updateTable("leasePayment")
      .set((eb) => ({
        status: "Invoiced",
        purchaseInvoiceLineId: eb
          .selectFrom("purchaseInvoiceLine")
          .select("purchaseInvoiceLine.id")
          .whereRef(
            "purchaseInvoiceLine.leasePaymentId",
            "=",
            "leasePayment.id"
          )
          .where("purchaseInvoiceLine.invoiceId", "=", invoice.id)
          .where("purchaseInvoiceLine.companyId", "=", companyId),
        updatedBy: userId,
        updatedAt: sql`now()`
      }))
      .where("companyId", "=", companyId)
      .where(
        "id",
        "in",
        group.map((row) => row.id)
      )
      .execute();

    drafted.push({ invoiceId: invoice.id, leaseId });
  }
  return drafted;
}

/**
 * Cuts an open-ended lease's payment rows forward to one period past `asOf`
 * (`openEndedLeaseHorizon`), for each active asset with a payment: only the
 * periods after its last Rent row, so an edited or deleted row is never cut
 * again (`cutLeasePaymentRows`, as at setup). The lease row is locked by the
 * caller.
 */
export async function rollOpenEndedLeasePayments(
  trx: KyselyTx,
  args: { companyId: string; userId: string; leaseId: string; asOf: string }
): Promise<number> {
  const { companyId, userId, leaseId, asOf } = args;
  const lease = await trx
    .selectFrom("lease")
    .select([
      sql<string>`"commencementDate"::text`.as("commencementDate"),
      sql<string>`"invoiceFromDate"::text`.as("invoiceFromDate"),
      "paymentFrequency",
      "paymentTiming",
      "annualEscalationPercent",
      "currencyCode"
    ])
    .where("id", "=", leaseId)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();
  const lines = await trx
    .selectFrom("leaseLine as l")
    .leftJoin("leasePayment as p", (join) =>
      join
        .onRef("p.leaseLineId", "=", "l.id")
        .onRef("p.companyId", "=", "l.companyId")
        .on("p.paymentType", "=", "Rent")
    )
    .select([
      "l.id",
      "l.paymentAmount",
      "l.purchaseOptionAmount",
      "l.purchaseOptionReasonablyCertain",
      sql<string | null>`max(p."periodStart")::text`.as("lastPeriodStart")
    ])
    .where("l.leaseId", "=", leaseId)
    .where("l.companyId", "=", companyId)
    .where("l.status", "=", "Active")
    .where("l.paymentAmount", ">", 0)
    .groupBy([
      "l.id",
      "l.paymentAmount",
      "l.purchaseOptionAmount",
      "l.purchaseOptionReasonablyCertain"
    ])
    .execute();
  if (lines.length === 0) return 0;

  const decimals = await currencyDecimals(trx, companyId, lease.currencyCode);
  const through = openEndedLeaseHorizon(
    lease.commencementDate,
    asOf,
    lease.paymentFrequency
  );
  const rows = lines.flatMap(
    (line) =>
      cutLeasePaymentRows({
        lease: { ...lease, endDate: null },
        asset: line,
        decimals,
        through,
        after: line.lastPeriodStart
      }).rows
  );
  if (rows.length > 0) {
    await trx
      .insertInto("leasePayment")
      .values(
        rows.map((row) => ({ ...row, leaseId, companyId, createdBy: userId }))
      )
      .execute();
  }
  return rows.length;
}

/** "Forklift FL-12 — 2027-01-01 to 2027-01-31", or for a one-off payment
 *  "Forklift FL-12 — Purchase Option": the leased asset and what is paid. */
export function leasePaymentDescription(
  assetDescription: string,
  row: {
    paymentType: Database["public"]["Enums"]["leasePaymentType"];
    periodStart: string;
    periodEnd: string;
  }
): string {
  if (row.paymentType !== "Rent") {
    return `${assetDescription} — ${row.paymentType}`;
  }
  return `${assetDescription} — ${row.periodStart} to ${row.periodEnd}`;
}

export const createLeaseInvoicesInput = z.object({
  /** `YYYY-MM-DD` in the company's timezone. */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Bill one lease only. */
  leaseId: z.string().optional()
});

/** Drafts the lease invoices due on or before `asOf` (see
 *  `createLeaseInvoicesForDuePayments`). A lease that fails is reported in
 *  `failures`, never thrown, so the others still draft. */
const createLeaseInvoices = defineServerFn({
  name: "create-lease-invoices",
  input: createLeaseInvoicesInput,
  permissions: { update: "purchasing", create: "invoicing" },
  async run({ db, companyId, userId }, { asOf, leaseId }) {
    return createLeaseInvoicesForDuePayments(db, {
      companyId,
      userId,
      asOf,
      leaseId
    });
  }
});

export default createLeaseInvoices;
