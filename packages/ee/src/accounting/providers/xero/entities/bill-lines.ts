// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { BillTaxLine } from "../../../core/bill-tax-plan";
import {
  type CostingLine,
  costingLineItemLabel
} from "../../../core/document-costing";
import {
  JournalEntrySyncError,
  noPostedJournalMessage
} from "../../../core/posting";
import type { Accounting } from "../../../core/types";
import type { Xero } from "../models";
import { assertXeroMoneyPrecision } from "../serialize";
import { resolveXeroTaxType, XERO_NO_TAX, type XeroTaxContext } from "../tax";

/** A leg of an invoice line with no tax code and no tax: the leg the
 *  fallback rate applies to. */
export function isUntaxedBillLeg(leg: CostingLine): boolean {
  return Boolean(leg.tax) && !leg.tax!.taxCodeId && leg.tax!.taxPercent === 0;
}

/**
 * Build Xero ACCPAY line items as an account-costed replay of the bill's
 * posted "Purchase Invoice" journal: `AccountCode` = the journal line's
 * mapped account (GR-IR / PPV / clearing), NOT the item's account and NOT the
 * blunt `defaultPurchaseAccountCode`. Pure — exported for tests. `lines` come
 * from `planBillTaxLines`, already in the invoice's transaction currency.
 *
 * A line with tax goes out at its code's mapped purchase `TaxType`
 * (`resolveXeroTaxType`) with that `TaxAmount`; a zero-rated or exempt code
 * carries `TaxAmount` 0, so Xero counts its net on the return (box 7 in the
 * UK). A line with no tax goes out at `NONE` with no `TaxAmount`, except a
 * leg with no code and no tax when `noTaxCodeFallback` is set: it takes the
 * fallback rate with `TaxAmount` 0. `tax` must be set when any line resolves
 * a rate.
 *
 * `ItemCode` is attached ONLY for items known non-tracked (`nonTrackedItemIds`)
 * — a tracked Xero item would make Xero override the AccountCode with the
 * item's inventory account and double-post inventory.
 *
 * Unmapped / account-less / no-journal lines throw the structured
 * UNMAPPED_ACCOUNTS Warning (user-fixable: map the account, then retry).
 */
export function buildXeroBillLineItems(args: {
  bill: Accounting.Bill;
  lines: readonly BillTaxLine[];
  accountCodesById: ReadonlyMap<string, string>;
  nonTrackedItemIds?: ReadonlySet<string>;
  /** The tax context, and the bill currency's decimals, for taxed lines. */
  tax?: { context: XeroTaxContext; decimalPlaces: number };
  /** Untaxed code-less legs send the fallback rate. */
  noTaxCodeFallback?: boolean;
}): Xero.InvoiceLineItem[] {
  const { bill } = args;

  if (args.lines.length === 0) {
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
  const lineIdsWithoutAccount = new Set<string>();
  for (const { leg } of args.lines) {
    if (!leg.accountId) {
      lineIdsWithoutAccount.add(leg.id);
      continue;
    }
    if (!args.accountCodesById.get(leg.accountId)) {
      unmapped.add(leg.accountId);
    }
  }

  if (unmapped.size > 0 || lineIdsWithoutAccount.size > 0) {
    const parts: string[] = [];
    if (unmapped.size > 0) {
      parts.push(`${unmapped.size} account(s) have no Xero account mapping`);
    }
    if (lineIdsWithoutAccount.size > 0) {
      parts.push(
        `${lineIdsWithoutAccount.size} posting journal line(s) have no account`
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
        ...(lineIdsWithoutAccount.size > 0
          ? { lineIdsWithoutAccount: [...lineIdsWithoutAccount] }
          : {})
      }
    });
  }

  assertXeroMoneyPrecision(
    ...args.lines.flatMap((line) => [line.amount, line.tax?.taxAmount ?? 0])
  );
  const nonTracked = args.nonTrackedItemIds;
  return args.lines.map(({ leg, amount, tax }) => {
    const attachItemCode =
      leg.sourceItem && nonTracked?.has(leg.sourceItem.id)
        ? leg.sourceItem.code
        : null;
    const accountCode = args.accountCodesById.get(leg.accountId!)!;
    const lineTax =
      tax ??
      (args.noTaxCodeFallback && isUntaxedBillLeg(leg)
        ? { taxCodeId: null, taxPercent: 0, taxAmount: 0 }
        : null);
    return {
      Description: costingLineItemLabel(leg) ?? leg.description ?? undefined,
      LineAmount: amount,
      AccountCode: accountCode,
      ...(lineTax
        ? {
            TaxType: xeroBillTaxType(args, lineTax, amount, accountCode),
            TaxAmount: lineTax.taxAmount
          }
        : { TaxType: XERO_NO_TAX }),
      ...(attachItemCode ? { ItemCode: attachItemCode.slice(0, 30) } : {})
    };
  });
}

function xeroBillTaxType(
  args: {
    bill: Accounting.Bill;
    tax?: { context: XeroTaxContext; decimalPlaces: number };
  },
  tax: NonNullable<BillTaxLine["tax"]>,
  netAmount: number,
  accountCode: string
): string {
  if (!args.tax) {
    throw new Error(
      `Bill ${args.bill.invoiceId} has a taxed line but no Xero tax context was loaded`
    );
  }
  return resolveXeroTaxType({
    context: args.tax.context,
    documentId: args.bill.id,
    direction: "purchase",
    taxCodeId: tax.taxCodeId,
    taxPercent: tax.taxPercent,
    netAmount,
    taxAmount: tax.taxAmount,
    decimalPlaces: args.tax.decimalPlaces,
    accountCode
  });
}
