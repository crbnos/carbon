// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { SCALE } from "@carbon/database/precision";
import {
  roundSalesPostingAmounts,
  type SalesPostingAmountsInput,
  salesTaxableBase
} from "@carbon/database/sales-posting-amounts";
import {
  splitLineTax,
  type TaxCodeInput
} from "@carbon/database/tax-components";
import type { TaxLedgerLine } from "@carbon/database/tax-ledger";

type Enums = Database["public"]["Enums"];

export type SalesTaxLedgerSourceLine = SalesPostingAmountsInput & {
  id: string;
  invoiceLineType: string;
  itemId: string | null;
  taxCodeId: string | null;
};

/**
 * The tax-ledger inputs of a posted sales invoice's lines, from the same
 * rounded amounts the journal posts (`roundSalesPostingAmounts`) and the same
 * tax base (`salesTaxableBase`), so the subledger agrees with the journal.
 * An exempt customer or a non-taxable item writes an exempt-base row.
 */
export function salesTaxLedgerLines(args: {
  lines: ReadonlyArray<SalesTaxLedgerSourceLine>;
  headerShipping: ReadonlyMap<string, number>;
  taxCodes: ReadonlyMap<string, TaxCodeInput>;
  nonTaxableItemIds: ReadonlySet<string>;
  exemption: {
    reason: Enums["taxExemptionReason"] | null;
    certificateNumber: string | null;
  } | null;
}): TaxLedgerLine[] {
  return args.lines
    .filter((line) => line.invoiceLineType !== "Comment")
    .map((line) => {
      const code = line.taxCodeId
        ? args.taxCodes.get(line.taxCodeId)
        : undefined;
      const postingLine = {
        ...line,
        allocatedHeaderShipping: args.headerShipping.get(line.id) ?? 0,
        taxesShipping: code?.taxesShipping ?? false
      };
      const taxableBase = salesTaxableBase(postingLine);
      const taxAmount = roundSalesPostingAmounts(postingLine).salesTaxBase;
      const nonTaxable =
        !!line.itemId && args.nonTaxableItemIds.has(line.itemId);
      const exempt =
        taxAmount === 0 && (args.exemption || nonTaxable)
          ? {
              reason: nonTaxable ? null : (args.exemption?.reason ?? null),
              certificateNumber: nonTaxable
                ? null
                : (args.exemption?.certificateNumber ?? null)
            }
          : null;
      return {
        documentLineId: line.id,
        taxCodeId: line.taxCodeId,
        taxableBase,
        components:
          !exempt && code && code.components.length > 0
            ? splitLineTax({
                base: taxableBase,
                lineTax: taxAmount,
                components: code.components,
                scale: SCALE
              })
            : [],
        taxPercent: line.taxPercent ?? 0,
        taxAmount,
        exempt
      };
    });
}
