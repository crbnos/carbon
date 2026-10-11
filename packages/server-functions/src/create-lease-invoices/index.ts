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
import { round } from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";

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

/** Statuses that can still have a payment to bill: an Active lease, and an
 *  ended one with a termination penalty, a purchase price, or a row a voided
 *  invoice returned to Pending. A Draft lease is not yet a lease, and a
 *  Cancelled one never was. */
const BILLABLE_STATUSES: Database["public"]["Enums"]["leaseStatus"][] = [
  "Active",
  "Expired",
  "Terminated",
  "Purchased"
];

/**
 * Drafts the purchase invoices of every lease with a Pending payment row due
 * on or before `asOf`: one Draft invoice per lease and due date, one Lease
 * line per row. Each lease is its own transaction, so one lease's failure
 * never rolls back another's invoice. The billed rows are stamped Invoiced
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
    .where("lease.status", "in", BILLABLE_STATUSES)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("leasePayment as p")
          .select("p.id")
          .whereRef("p.leaseId", "=", "lease.id")
          .whereRef("p.companyId", "=", "lease.companyId")
          .where("p.status", "=", "Pending")
          .where("p.dueDate", "<=", asOf)
      )
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
      "name",
      "status",
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
  if (!BILLABLE_STATUSES.includes(lease.status)) return [];

  const rows = await trx
    .selectFrom("leasePayment")
    .select([
      "id",
      "paymentType",
      "amount",
      sql<string>`"periodStart"::text`.as("periodStart"),
      sql<string>`"periodEnd"::text`.as("periodEnd"),
      sql<string>`"dueDate"::text`.as("dueDate")
    ])
    .where("leaseId", "=", leaseId)
    .where("companyId", "=", companyId)
    .where("status", "=", "Pending")
    .where("dueDate", "<=", asOf)
    .orderBy("dueDate")
    .orderBy("paymentType")
    .forUpdate()
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
          locationId: lease.locationId,
          description: leasePaymentDescription(lease.name, row),
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

/** "Forklift FL-12 — 2027-01-01 to 2027-01-31", or for a one-off payment
 *  "Forklift FL-12 — Purchase Option". */
export function leasePaymentDescription(
  leaseName: string,
  row: {
    paymentType: Database["public"]["Enums"]["leasePaymentType"];
    periodStart: string;
    periodEnd: string;
  }
): string {
  if (row.paymentType !== "Rent") return `${leaseName} — ${row.paymentType}`;
  return `${leaseName} — ${row.periodStart} to ${row.periodEnd}`;
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
