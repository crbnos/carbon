// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import type { TaxLedgerLine } from "@carbon/database/tax-ledger";
import {
  effectiveTaxPercent,
  equals,
  round,
  SCALE,
  splitLineTax,
  type TaxCodeInput
} from "@carbon/utils";
import { InvalidInputError } from "../errors";
import type {
  PurchasePostingAmounts,
  PurchasePostingLine
} from "../post-purchase-invoice/purchase-posting-amounts";

type TaxedLine = {
  id: string;
  quantity: number;
  unitPrice: number | null;
  shippingCost: number | null;
  taxAmount: number | null;
  taxCodeId: string | null;
};

/**
 * Each purchase line with its tax split by its code's components (base
 * amounts): the supplier's tax for a Normal code, self-assessed tax for a
 * Reverse Charge code. A line with no code is returned as it is. Shared by
 * the posting and the cutover backfill so both split the same way.
 *
 * Refuses a Reverse Charge line that carries a tax amount: the supplier
 * charges no tax on a reverse charge, so that amount would be paid to the
 * supplier AND self-assessed — the same tax twice.
 */
export function withPurchaseTax<T extends TaxedLine>(
  lines: ReadonlyArray<T>,
  taxCodes: ReadonlyMap<string, TaxCodeInput>
): Array<T & Pick<PurchasePostingLine, "taxParts" | "selfAssessedParts">> {
  return lines.map((line) => {
    const code = line.taxCodeId ? taxCodes.get(line.taxCodeId) : undefined;
    if (!code || code.components.length === 0) return line;
    const base =
      line.quantity * (line.unitPrice ?? 0) + (line.shippingCost ?? 0);
    if (code.calculationType === "Reverse Charge") {
      if (!equals(line.taxAmount ?? 0, 0)) {
        throw new InvalidInputError(
          `Purchase invoice line ${line.id} has a Reverse Charge tax code and a tax amount of ${line.taxAmount}. A supplier charges no tax on a reverse charge, and Carbon self-assesses it when it posts. Clear the line's tax amount.`
        );
      }
      return {
        ...line,
        selfAssessedParts: splitLineTax({
          base,
          lineTax: round(base * effectiveTaxPercent(code.components)),
          components: code.components,
          scale: SCALE
        })
      };
    }
    return {
      ...line,
      taxParts: splitLineTax({
        base,
        lineTax: line.taxAmount ?? 0,
        components: code.components,
        scale: SCALE
      })
    };
  });
}

/** The tax-ledger inputs of a posted purchase invoice, from its amounts. */
export function purchaseTaxLedgerLines(
  lines: ReadonlyArray<
    TaxedLine & { invoiceLineType: string; taxPercent: number | null }
  >,
  amountsByLineId: ReadonlyMap<string, PurchasePostingAmounts>
): TaxLedgerLine[] {
  return lines
    .filter((line) => line.invoiceLineType !== "Comment")
    .map((line) => {
      const amounts = amountsByLineId.get(line.id);
      const legs = amounts?.taxLegs ?? [];
      const selfAssessed = legs.some((leg) => leg.selfAssessed);
      return {
        documentLineId: line.id,
        taxCodeId: line.taxCodeId,
        taxableBase: (amounts?.nominalBaseCost ?? 0) + (line.shippingCost ?? 0),
        components: legs.map((leg) => leg.part),
        taxPercent: line.taxPercent ?? 0,
        taxAmount: selfAssessed
          ? (amounts?.selfAssessedTaxBase ?? 0)
          : (line.taxAmount ?? 0),
        exempt: null
      };
    });
}

/**
 * The class of each account a purchase posting's tax legs can hit: the Tax
 * Paid and reverse charge defaults and every component's Tax Paid account
 * (`taxAccountClasses` on `buildPurchaseInvoicePostingLines`). One query.
 *
 * Refuses an account that is not in the company's group: the posting would
 * otherwise default its class and post to another company's account.
 */
export async function loadTaxAccountClasses(
  db: Kysely<KyselyDatabase> | KyselyTx,
  args: {
    companyId: string;
    defaults: {
      taxPaidAccount: string | null;
      reverseChargeSalesTaxPayableAccount: string | null;
    };
    taxCodes: ReadonlyMap<string, TaxCodeInput>;
  }
): Promise<Map<string, string>> {
  const ids = [
    args.defaults.taxPaidAccount,
    args.defaults.reverseChargeSalesTaxPayableAccount,
    ...[...args.taxCodes.values()].flatMap((code) =>
      code.components.map((component) => component.taxPaidAccountId)
    )
  ].filter((id): id is string => !!id);
  if (ids.length === 0) return new Map();
  const requested = [...new Set(ids)];
  const rows = await db
    .selectFrom("account")
    .innerJoin("company", "company.companyGroupId", "account.companyGroupId")
    .select(["account.id", "account.class"])
    .where("company.id", "=", args.companyId)
    .where("account.id", "in", requested)
    .execute();
  const found = new Set(rows.map((row) => row.id));
  const foreign = requested.find((id) => !found.has(id));
  if (foreign) {
    throw new InvalidInputError(
      `Tax account ${foreign} is not an account of this company. Choose one of this company's accounts on the tax code or in the account defaults.`
    );
  }
  return new Map(
    rows.flatMap((row) => (row.class ? [[row.id, row.class] as const] : []))
  );
}
