// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { round } from "@carbon/utils";
import {
  type BillTaxLine,
  billSendsTax,
  planBillTaxLines,
  replayBillTaxNeutral
} from "../../../core/bill-tax-plan";
import {
  type BillCostingResult,
  type CostingLine,
  costingLineItemLabel
} from "../../../core/document-costing";
import {
  JournalEntrySyncError,
  noPostedJournalMessage
} from "../../../core/posting";
import type { Accounting } from "../../../core/types";
import type { Qbo } from "../models";
import {
  buildQboTxnTaxDetail,
  isQboUsCompany,
  type QboInvoiceTaxCatalog,
  type QboTaxCodeMappings,
  resolveQboPurchaseTaxLines
} from "./invoice-tax";
import { withQboExpenseTaxCode } from "./shared";

/**
 * Build QBO bill lines as an account-costed replay of the bill's posted
 * "Purchase Invoice" journal: one `AccountBasedExpenseLineDetail` per costing
 * line to the journal's mapped account (GR-IR / PPV / clearing), NEVER the
 * item's account. The item is a Description label only. Pure — exported for
 * tests. Amounts are already in the invoice's transaction currency
 * (`toTransactionCurrencyLines`). Tax-neutral: no `TxnTaxDetail`, no per-line
 * tax. A bill that sends tax outside the US goes through
 * `buildQboTaxedBillLines` instead.
 *
 * Unmapped / account-less lines throw the structured UNMAPPED_ACCOUNTS
 * Warning (user-fixable: map the account, then retry) — the same envelope the
 * Rillet bill and the QBO journal syncer use.
 */
export function buildQboBillLines(args: {
  bill: Accounting.Bill;
  costingLines: CostingLine[];
  accountRefsById: ReadonlyMap<string, Qbo.Ref>;
}): Array<Omit<Qbo.ExpenseLine, "Id">> {
  const { bill } = args;

  if (args.costingLines.length === 0) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: noPostedJournalMessage({
        subject: `bill ${bill.invoiceId}`,
        journal: "Purchase Invoice",
        document: "invoice"
      }),
      warning: true,
      metadata: { billId: bill.id }
    });
  }

  const unmapped = new Set<string>();
  const lineIdsWithoutAccount: string[] = [];
  for (const line of args.costingLines) {
    if (!line.accountId) {
      lineIdsWithoutAccount.push(line.id);
      continue;
    }
    if (!args.accountRefsById.get(line.accountId)) {
      unmapped.add(line.accountId);
    }
  }

  if (unmapped.size > 0 || lineIdsWithoutAccount.length > 0) {
    const parts: string[] = [];
    if (unmapped.size > 0) {
      parts.push(
        `${unmapped.size} account(s) have no QuickBooks Online account mapping`
      );
    }
    if (lineIdsWithoutAccount.length > 0) {
      parts.push(
        `${lineIdsWithoutAccount.length} posting journal line(s) have no account`
      );
    }
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: `Cannot sync bill ${bill.invoiceId}: ${parts.join(
        "; "
      )}. Map the account(s) on the integration settings page, then retry.`,
      warning: true,
      metadata: {
        billId: bill.id,
        unmappedAccountIds: [...unmapped],
        ...(lineIdsWithoutAccount.length > 0 ? { lineIdsWithoutAccount } : {})
      }
    });
  }

  return args.costingLines.map((line) => {
    const description = costingLineItemLabel(line) ?? line.description;
    return {
      Amount: line.amount,
      ...(description ? { Description: description } : {}),
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: {
        AccountRef: args.accountRefsById.get(line.accountId!)!
      }
    };
  });
}

/**
 * The lines of a bill that sends tax, outside the US (`planBillTaxLines`). The
 * Tax Paid legs are not lines: QuickBooks books the recoverable tax itself
 * from each line's tax code. A line with tax goes at its mapped code, the
 * rest of a leg at the company's non-taxable code, and a zero-rated line keeps
 * its mapped code (`resolveQboPurchaseTaxLines`). `TotalTax` equals the
 * converted Tax Paid legs exactly, so the bill total is unchanged. Pure —
 * exported for tests.
 */
export function buildQboTaxedBillLines(args: {
  bill: Accounting.Bill;
  /** Planned lines, in transaction currency. */
  lines: readonly BillTaxLine[];
  /** The Tax Paid legs, converted to transaction currency. */
  recoverableTax: number;
  decimalPlaces: number;
  accountRefsById: ReadonlyMap<string, Qbo.Ref>;
  catalog: QboInvoiceTaxCatalog;
  mappings: QboTaxCodeMappings;
}): {
  Line: Array<Omit<Qbo.ExpenseLine, "Id">>;
  TxnTaxDetail: Qbo.TxnTaxDetail | undefined;
} {
  const parts = resolveQboPurchaseTaxLines({
    documentId: args.bill.id,
    lines: args.lines,
    decimalPlaces: args.decimalPlaces,
    catalog: args.catalog,
    mappings: args.mappings
  });
  const lines = buildQboBillLines({
    bill: args.bill,
    costingLines: args.lines.map((line) => ({
      ...line.leg,
      amount: line.amount
    })),
    accountRefsById: args.accountRefsById
  });
  const txnTaxDetail = buildQboTxnTaxDetail(
    parts.map((part) => ({
      rate: part.rate,
      netAmount: part.line.amount,
      taxAmount: part.line.tax?.taxAmount ?? 0
    })),
    args.decimalPlaces
  );
  if (
    round(txnTaxDetail?.TotalTax ?? 0, args.decimalPlaces) !==
    round(args.recoverableTax, args.decimalPlaces)
  ) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_TAX_CODES",
      warning: true,
      message: `Cannot sync bill ${args.bill.invoiceId}: its tax lines do not add up to the ${args.recoverableTax} posted to Tax Paid. Check the bill's tax codes, then retry.`,
      metadata: {
        billId: args.bill.id,
        recoverableTax: args.recoverableTax,
        totalTax: txnTaxDetail?.TotalTax ?? 0
      }
    });
  }
  return {
    Line: lines.map((line, index) =>
      withQboExpenseTaxCode(line, parts[index]!.codeRef)
    ),
    TxnTaxDetail: txnTaxDetail
  };
}

/**
 * A bill's `Line`, and its tax outside the US. A bill that does not send tax
 * (`billSendsTax`) replays every posted leg as an account line, as it always
 * has. One that does sends its tax as QuickBooks tax (`planBillTaxLines`,
 * `buildQboTaxedBillLines`) outside the US. QuickBooks US has no purchase tax
 * codes, so there every bill replays as before and the Tax Paid legs stay
 * account lines. `tax` is null when no catalog was read. Pure — exported for
 * tests.
 */
export function buildQboBillPayloadLines(args: {
  bill: Accounting.Bill;
  costing: Pick<
    BillCostingResult,
    "lines" | "taxLedger" | "exchangeRate" | "documentTotal" | "decimalPlaces"
  >;
  accountRefsById: ReadonlyMap<string, Qbo.Ref>;
  tax: { catalog: QboInvoiceTaxCatalog; mappings: QboTaxCodeMappings } | null;
}): Pick<Qbo.Bill, "Line" | "TxnTaxDetail" | "GlobalTaxCalculation"> {
  const sendsTax = billSendsTax(args.costing.lines);
  if (sendsTax && !args.tax)
    throw new Error("A bill that sends tax needs the tax catalog");
  if (!args.tax || !sendsTax || isQboUsCompany(args.tax.catalog)) {
    return {
      Line: buildQboBillLines({
        bill: args.bill,
        costingLines: replayBillTaxNeutral(args.costing).map(
          (line) => line.leg
        ),
        accountRefsById: args.accountRefsById
      })
    };
  }
  const plan = planBillTaxLines(args.costing, {
    id: args.bill.id,
    label: `bill ${args.bill.invoiceId}`
  });
  const taxed = buildQboTaxedBillLines({
    bill: args.bill,
    lines: plan.lines,
    recoverableTax: plan.recoverableTax,
    decimalPlaces: args.costing.decimalPlaces,
    accountRefsById: args.accountRefsById,
    catalog: args.tax.catalog,
    mappings: args.tax.mappings
  });
  return {
    Line: taxed.Line,
    GlobalTaxCalculation: "TaxExcluded",
    ...(taxed.TxnTaxDetail ? { TxnTaxDetail: taxed.TxnTaxDetail } : {})
  };
}
