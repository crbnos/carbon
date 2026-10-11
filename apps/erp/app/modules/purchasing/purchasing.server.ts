// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  canApproveRequest,
  getLatestApprovalRequestForDocument
} from "@carbon/ee/approvals.server";
import { generateLeasePayments } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";

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
