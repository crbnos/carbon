// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The project charges of a purchase invoice: which lines debit a project
// account, and which purchase order lines were already charged to a project
// by their receipt (so the invoice writes only the price variance).
// Spec: .ai/specs/2026-10-03-projects.md (Charging: the five entry points).

import type { KyselyDatabase as DB } from "@carbon/database/client";
import type { Kysely } from "kysely";
import {
  assertChargeable,
  loadProjectPostingContexts,
  ProjectChargeError,
  projectPostingKey,
  resolveProjectPostingAccount,
  resolveProjectTreatment
} from "../lib/project-posting";
import { loadProjectStock } from "../lib/stock-stripes";

export type InvoiceProjectCharge = {
  projectId: string;
  projectElementId: string | null;
  /** The project account the line debits. */
  accountId: string;
  /** The asset a Capitalize line builds, else null. */
  fixedAssetId: string | null;
  postCapitalization: boolean;
};

type ChargeableInvoiceLine = {
  id: string;
  purchaseOrderLineId: string | null;
  projectId: string | null;
  projectElementId: string | null;
};

type ChargeablePurchaseOrderLine = {
  id: string;
  projectId: string | null;
  projectElementId: string | null;
};

export type InvoiceProjectCharges = {
  /**
   * The project account an invoice line debits, or null when the line has no
   * project or its project is Statistical (today's posting, plus the Project
   * tag). Refuses a project or element that takes no postings.
   */
  forLine(invoiceLineId: string): InvoiceProjectCharge | null;
  /**
   * The charge a receipt of this purchase order line already wrote to the
   * project, or null. Such a line's invoice writes only its price variance,
   * to the account the receipt debited.
   */
  chargedAtReceipt(purchaseOrderLineId: string): InvoiceProjectCharge | null;
  /**
   * The stock stripe an invoice line's goods enter: its charge number's
   * project when that project has project stock, else null (common stock).
   */
  stockStripe(invoiceLineId: string): string | null;
  /**
   * The project a receipt of this purchase order line charged at receipt
   * while the goods entered its project stock (Charge at receipt), or null.
   * The invoice adjusts the stock's layers, and the project's ledger gets
   * the price variance as well.
   */
  stockChargedAtReceipt(
    purchaseOrderLineId: string
  ): { projectId: string; projectElementId: string | null } | null;
};

/**
 * Loads the project charges of an invoice in one query plus one
 * `loadProjectPostingContexts` call: the receipts' projectLedger rows of the
 * invoice's purchase order lines, then the posting contexts. A line's charge
 * number is its own, else its purchase order line's.
 */
export async function loadInvoiceProjectCharges(
  db: Kysely<DB>,
  companyId: string,
  args: {
    invoiceLines: ChargeableInvoiceLine[];
    purchaseOrderLines: ChargeablePurchaseOrderLine[];
    postingDate: string;
  }
): Promise<InvoiceProjectCharges> {
  const purchaseOrderLineById = new Map(
    args.purchaseOrderLines.map((line) => [line.id, line])
  );
  const refByInvoiceLineId = new Map<
    string,
    { projectId: string; projectElementId: string | null }
  >();
  for (const line of args.invoiceLines) {
    if (line.projectId) {
      refByInvoiceLineId.set(line.id, {
        projectId: line.projectId,
        projectElementId: line.projectElementId
      });
      continue;
    }
    const purchaseOrderLine = line.purchaseOrderLineId
      ? purchaseOrderLineById.get(line.purchaseOrderLineId)
      : undefined;
    if (purchaseOrderLine?.projectId) {
      refByInvoiceLineId.set(line.id, {
        projectId: purchaseOrderLine.projectId,
        projectElementId: purchaseOrderLine.projectElementId
      });
    }
  }

  const purchaseOrderLineIds = [
    ...new Set(
      args.invoiceLines
        .map((line) => line.purchaseOrderLineId)
        .filter((id): id is string => Boolean(id))
    )
  ];

  const receiptRows =
    purchaseOrderLineIds.length === 0
      ? []
      : await db
          .selectFrom("projectLedger")
          .innerJoin("receiptLine", (join) =>
            join
              .onRef("receiptLine.id", "=", "projectLedger.documentLineId")
              .onRef("receiptLine.companyId", "=", "projectLedger.companyId")
          )
          .leftJoin(
            "journalLine",
            "journalLine.id",
            "projectLedger.journalLineId"
          )
          .select([
            "receiptLine.lineId",
            "projectLedger.projectId",
            "projectLedger.projectElementId",
            "journalLine.accountId"
          ])
          .where("projectLedger.companyId", "=", companyId)
          .where("projectLedger.documentType", "=", "Purchase Receipt")
          .where("projectLedger.reversalOfId", "is", null)
          .where("receiptLine.lineId", "in", purchaseOrderLineIds)
          .orderBy("projectLedger.createdAt", "asc")
          .execute();

  // The latest receipt of a line decides.
  const receiptRowByLineId = new Map(
    receiptRows
      .filter((row) => row.lineId)
      .map((row) => [row.lineId as string, row])
  );

  const refs = [
    ...refByInvoiceLineId.values(),
    ...[...receiptRowByLineId.values()].map((row) => ({
      projectId: row.projectId,
      projectElementId: row.projectElementId
    }))
  ];
  const contexts = await loadProjectPostingContexts(db, companyId, refs);
  // Projects with project stock (Projects Phase 2a). A receipt into project
  // stock is the project's inventory, not a charge: its invoice adjusts the
  // receipt's cost layers like any stocked receipt.
  const projectStock = await loadProjectStock(
    db,
    companyId,
    refs.map((ref) => ref.projectId)
  );

  const contextOf = (ref: {
    projectId: string;
    projectElementId: string | null;
  }) => {
    const context = contexts.get(
      projectPostingKey(ref.projectId, ref.projectElementId)
    );
    if (!context) {
      throw new ProjectChargeError(
        "The project or element of an invoice line does not exist"
      );
    }
    return context;
  };

  const lineCharges = new Map<string, InvoiceProjectCharge | null>();

  return {
    forLine(invoiceLineId) {
      if (lineCharges.has(invoiceLineId)) {
        return lineCharges.get(invoiceLineId)!;
      }
      const ref = refByInvoiceLineId.get(invoiceLineId);
      let charge: InvoiceProjectCharge | null = null;
      if (ref) {
        const context = contextOf(ref);
        const { treatment, accountId, fixedAssetId, postCapitalization } =
          resolveProjectPostingAccount(context, args.postingDate);
        if (treatment !== "Statistical" && accountId) {
          assertChargeable(context, "commitment");
          charge = { ...ref, accountId, fixedAssetId, postCapitalization };
        }
      }
      lineCharges.set(invoiceLineId, charge);
      return charge;
    },
    stockStripe(invoiceLineId) {
      const ref = refByInvoiceLineId.get(invoiceLineId);
      return ref && projectStock.has(ref.projectId) ? ref.projectId : null;
    },
    stockChargedAtReceipt(purchaseOrderLineId) {
      const row = receiptRowByLineId.get(purchaseOrderLineId);
      if (!row || !projectStock.has(row.projectId)) return null;
      return {
        projectId: row.projectId,
        projectElementId: row.projectElementId
      };
    },
    chargedAtReceipt(purchaseOrderLineId) {
      const row = receiptRowByLineId.get(purchaseOrderLineId);
      if (!row) return null;
      // Charge at receipt on a project with project stock: the goods are in
      // the project's stock, so the invoice adjusts their layers.
      if (projectStock.has(row.projectId)) return null;
      const ref = {
        projectId: row.projectId,
        projectElementId: row.projectElementId
      };
      const context = contextOf(ref);
      // A Capitalize variance follows its asset now: the CIP account while
      // it is Under Construction, its class account once it is in service.
      if (resolveProjectTreatment(context, args.postingDate) === "Capitalize") {
        const resolved = resolveProjectPostingAccount(
          context,
          args.postingDate
        );
        return {
          ...ref,
          accountId: resolved.accountId!,
          fixedAssetId: resolved.fixedAssetId,
          postCapitalization: resolved.postCapitalization
        };
      }
      const noAsset = { fixedAssetId: null, postCapitalization: false };
      if (row.accountId) {
        return { ...ref, accountId: row.accountId, ...noAsset };
      }
      // Posted with accounting off: resolve the account now.
      const { accountId } = resolveProjectPostingAccount(
        context,
        args.postingDate
      );
      return accountId ? { ...ref, accountId, ...noAsset } : null;
    }
  };
}
