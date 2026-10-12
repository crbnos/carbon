// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { hasPermission } from "@carbon/auth";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  canApproveRequest,
  getLatestApprovalRequestForDocument
} from "@carbon/ee/approvals.server";
import { serverFns } from "@carbon/server-functions";
import type { DraftedLeaseInvoice } from "@carbon/server-functions/create-lease-invoices";
import { generateLeasePayments } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { path } from "~/utils/path";

/**
 * Server-only purchasing helpers. Lives in a `.server.ts` (NOT the barrel-exported
 * `purchasing.service.ts`) because it imports the commercial, server-only approval
 * engine `@carbon/ee/approvals.server`; a `.server` import reaching the client
 * graph via the module barrel is rejected by the React Router build.
 */

type ApprovalContext = {
  approvalRequest: { id: string } | null;
  canApprove: boolean;
  decision: {
    status: "Approved" | "Rejected";
    decisionBy: string;
    decisionAt: string;
  } | null;
};

export async function getSupplierApprovalContext(
  serviceRole: SupabaseClient<Database>,
  supplierId: string,
  status: string | null,
  companyId: string,
  userId: string
): Promise<ApprovalContext> {
  const latest = await getLatestApprovalRequestForDocument(
    serviceRole,
    "supplier",
    supplierId
  );

  const req = latest.data;

  const canApprove = await canApproveRequest(
    serviceRole,
    {
      amount: req?.amount ?? null,
      documentType: "supplier",
      companyId
    },
    userId
  );

  // Look for the latest terminal decision (Approved or Rejected)
  let decision: ApprovalContext["decision"] = null;
  const terminalRequest = await serviceRole
    .from("approvalRequest")
    .select("status, decisionBy, decisionAt")
    .eq("documentType", "supplier")
    .eq("documentId", supplierId)
    .in("status", ["Approved", "Rejected"])
    .order("decisionAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    terminalRequest.data?.decisionBy &&
    terminalRequest.data?.decisionAt &&
    (terminalRequest.data.status === "Approved" ||
      terminalRequest.data.status === "Rejected")
  ) {
    decision = {
      status: terminalRequest.data.status,
      decisionBy: terminalRequest.data.decisionBy,
      decisionAt: terminalRequest.data.decisionAt
    };
  }

  if (!req || req.status !== "Pending" || !req.requestedBy || !req.id) {
    return {
      approvalRequest: null,
      canApprove,
      decision
    };
  }

  return {
    approvalRequest: { id: req.id },
    canApprove,
    decision
  };
}

/**
 * Cuts a Draft lease's payment rows again from its terms, replacing the rows
 * (and any edits to them) in one transaction. A row due before the lease's
 * `invoiceFromDate` was paid outside Carbon and is created `Skipped`, so the
 * daily job never invoices it. A purchase option row is added only when it
 * is reasonably certain (it is then part of the lease liability).
 */
export async function regenerateLeasePayments(
  db: Kysely<KyselyDatabase>,
  args: {
    leaseId: string;
    companyId: string;
    userId: string;
  }
): Promise<{ count: number }> {
  const { leaseId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const lease = await trx
      .selectFrom("lease")
      .select([
        "status",
        "currencyCode",
        "paymentAmount",
        "paymentFrequency",
        "paymentTiming",
        "annualEscalationPercent",
        "purchaseOptionAmount",
        "purchaseOptionReasonablyCertain",
        sql<string>`"commencementDate"::text`.as("commencementDate"),
        sql<string>`"endDate"::text`.as("endDate"),
        sql<string>`"invoiceFromDate"::text`.as("invoiceFromDate")
      ])
      .where("id", "=", leaseId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!lease) throw new Error("Lease not found");
    if (lease.status !== "Draft") {
      throw new Error(
        "Payment rows are cut again only while the lease is Draft; modify an active lease instead"
      );
    }

    const currency = await trx
      .selectFrom("currency")
      .innerJoin("company", "company.companyGroupId", "currency.companyGroupId")
      .select("currency.decimalPlaces")
      .where("company.id", "=", companyId)
      .where("currency.code", "=", lease.currencyCode)
      .executeTakeFirst();

    const rows = generateLeasePayments({
      commencementDate: lease.commencementDate,
      endDate: lease.endDate,
      paymentAmount: Number(lease.paymentAmount),
      frequency: lease.paymentFrequency,
      timing: lease.paymentTiming,
      annualEscalationPercent: Number(lease.annualEscalationPercent),
      purchaseOptionAmount: lease.purchaseOptionReasonablyCertain
        ? Number(lease.purchaseOptionAmount ?? 0)
        : 0,
      decimals: currency?.decimalPlaces ?? 2
    });

    await trx
      .deleteFrom("leasePayment")
      .where("leaseId", "=", leaseId)
      .where("companyId", "=", companyId)
      .execute();
    if (rows.length > 0) {
      await trx
        .insertInto("leasePayment")
        .values(
          rows.map((row) => ({
            ...row,
            leaseId,
            status:
              row.dueDate < lease.invoiceFromDate
                ? ("Skipped" as const)
                : ("Pending" as const),
            companyId,
            createdBy: userId
          }))
        )
        .execute();
    }
    return { count: rows.length };
  });
}

/** Returns the lease payment rows billed by these purchase invoice lines to
 *  Pending, so the next invoice run bills them again.
 *  `leasePayment.purchaseInvoiceLineId` has no foreign key, so a plain
 *  delete would leave them Invoiced against a line that no longer exists. */
async function releaseLeasePayments(
  trx: Kysely<KyselyDatabase>,
  args: { companyId: string; purchaseInvoiceLineIds: string[]; userId: string }
): Promise<void> {
  const { companyId, purchaseInvoiceLineIds, userId } = args;
  if (purchaseInvoiceLineIds.length === 0) return;
  await trx
    .updateTable("leasePayment")
    .set({
      status: "Pending",
      purchaseInvoiceLineId: null,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("purchaseInvoiceLineId", "in", purchaseInvoiceLineIds)
    .execute();
}

/**
 * Deletes a Draft purchase invoice and, in the same transaction, returns the
 * lease payment rows it billed to Pending (see `releaseLeasePayments`).
 * Throws on a missing or non-Draft invoice.
 */
export async function deletePurchaseInvoiceReleasingLeases(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; invoiceId: string; userId: string }
): Promise<void> {
  const { companyId, invoiceId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const invoice = await trx
      .selectFrom("purchaseInvoice")
      .select(["id", "status"])
      .where("id", "=", invoiceId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!invoice) throw new Error("Purchase invoice not found");
    if (invoice.status !== "Draft") {
      throw new Error(
        `Cannot delete purchase invoice with status "${invoice.status}". Only Draft invoices can be deleted.`
      );
    }

    const lines = await trx
      .selectFrom("purchaseInvoiceLine")
      .select("id")
      .where("invoiceId", "=", invoiceId)
      .where("companyId", "=", companyId)
      .where("leasePaymentId", "is not", null)
      .execute();
    await releaseLeasePayments(trx, {
      companyId,
      purchaseInvoiceLineIds: lines.map((line) => line.id),
      userId
    });

    await trx
      .deleteFrom("purchaseInvoice")
      .where("id", "=", invoiceId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/** One line of a Draft purchase invoice, returning the lease payment row it
 *  billed to Pending (see `deletePurchaseInvoiceReleasingLeases`). The line
 *  must belong to `invoiceId` and that invoice must be Draft — checked here,
 *  under a row lock, because releasing a POSTED line's payment would bill it
 *  again. Throws otherwise. */
export async function deletePurchaseInvoiceLineReleasingLeases(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    invoiceId: string;
    purchaseInvoiceLineId: string;
    userId: string;
  }
): Promise<void> {
  const { companyId, invoiceId, purchaseInvoiceLineId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const line = await trx
      .selectFrom("purchaseInvoiceLine")
      .innerJoin("purchaseInvoice", (join) =>
        join
          .onRef("purchaseInvoice.id", "=", "purchaseInvoiceLine.invoiceId")
          .onRef(
            "purchaseInvoice.companyId",
            "=",
            "purchaseInvoiceLine.companyId"
          )
      )
      .select([
        "purchaseInvoiceLine.invoiceId as invoiceId",
        "purchaseInvoice.status as status"
      ])
      .where("purchaseInvoiceLine.id", "=", purchaseInvoiceLineId)
      .where("purchaseInvoiceLine.companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!line || line.invoiceId !== invoiceId) {
      throw new Error("Purchase invoice line not found on this invoice");
    }
    if (line.status !== "Draft") {
      throw new Error(
        `Cannot delete a line of a purchase invoice with status "${line.status}". Only Draft invoices can be edited.`
      );
    }

    await releaseLeasePayments(trx, {
      companyId,
      purchaseInvoiceLineIds: [purchaseInvoiceLineId],
      userId
    });
    await trx
      .deleteFrom("purchaseInvoiceLine")
      .where("id", "=", purchaseInvoiceLineId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/** The lease page's "Invoice": drafts the purchase invoices the lease has
 *  due, exactly as the daily job would — the `create-lease-invoices` server
 *  function. */
export async function generateLeaseInvoicesNow(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    /** `YYYY-MM-DD` in the company's timezone. */
    asOf: string;
    leaseId: string;
  }
): Promise<{ invoices: DraftedLeaseInvoice[]; invoiceIds: string[] }> {
  const { companyId, userId, asOf, leaseId } = args;
  const { invoices, invoiceIds, failures } = await serverFns
    .system({ db, companyId, userId })
    .invokeOrThrow("create-lease-invoices", { asOf, leaseId });
  // One lease is billed here, so its failure is the action's failure.
  if (failures.length > 0) {
    throw new Error(failures.map((f) => f.error).join("; "));
  }
  return { invoices, invoiceIds };
}

/** Where a Draft lease is worked on: its setup wizard, for someone who can
 *  edit it. Null for any other lease, or a viewer, who sees the lease page —
 *  as `draftRentalAgreementSetupPath`. */
export async function draftLeaseSetupPath(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string; id: string }
): Promise<string | null> {
  const { companyId, userId, id } = args;
  const [lease, claims] = await Promise.all([
    client
      .from("lease")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle(),
    getUserClaims(userId, companyId)
  ]);
  if (lease.data?.status !== "Draft") return null;
  if (!hasPermission(claims?.permissions, "purchasing", "update", companyId)) {
    return null;
  }
  return path.to.leaseSetup(id, "payments");
}
