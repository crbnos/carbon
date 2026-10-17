// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLoaderQuery } from "@carbon/query";
import { effectiveComponents, round, splitLineTax } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useCallback, useMemo } from "react";
import { useCurrencyFormatter } from "~/hooks";
import type { getTaxCodesList } from "~/modules/accounting";
import {
  taxCodeRate,
  toTaxCodeInput
} from "~/modules/accounting/accounting.utils";
import { path } from "~/utils/path";

type TaxCodeRow = NonNullable<
  Awaited<ReturnType<typeof getTaxCodesList>>["data"]
>[number];

/** The active tax codes with their components — the same cached request the
 *  `TaxCode` select makes, so it costs nothing extra. */
function useTaxCodeInputs() {
  const fetcher = useLoaderQuery<{ data: TaxCodeRow[] | null }>(
    path.to.api.taxCodes
  );
  return useMemo(
    () =>
      new Map(
        (fetcher.data?.data ?? []).map((row) => [row.id, toTaxCodeInput(row)])
      ),
    [fetcher.data?.data]
  );
}

/**
 * A code's combined rate on the document's date (YYYY-MM-DD), not today's —
 * a component that starts or ends between the two changes the rate. `null`
 * when the code is not loaded (yet).
 */
export function useTaxCodeRateOn(date: string) {
  const codes = useTaxCodeInputs();
  return useCallback(
    (taxCodeId: string) => {
      const code = codes.get(taxCodeId);
      // Rounded to internal scale: it is stored as the line's rate.
      return code ? round(taxCodeRate(code, date)) : null;
    },
    [codes, date]
  );
}

type RecoverableTaxProps = {
  taxCodeId: string | null | undefined;
  /** The line's taxable base: unit price × quantity + shipping. */
  subtotal: number;
  /** The tax the supplier charged on the line. */
  taxAmount: number;
  /** The document's date, YYYY-MM-DD. */
  date: string;
  currency: string;
  currencyDecimals: number;
};

/**
 * "Recoverable: {amount}" — the share of a purchase line's tax the company
 * can reclaim, split by the code's components as posting splits it. Shown
 * only for a code that has a recoverable component.
 */
export function RecoverableTax({
  taxCodeId,
  subtotal,
  taxAmount,
  date,
  currency,
  currencyDecimals
}: RecoverableTaxProps) {
  const codes = useTaxCodeInputs();
  const formatter = useCurrencyFormatter({
    currency,
    decimalPlaces: currencyDecimals
  });

  const code = taxCodeId ? codes.get(taxCodeId) : undefined;
  if (!code) return null;
  const components = effectiveComponents(code, date);
  if (!components.some((component) => component.recoverablePercent > 0)) {
    return null;
  }

  const recoverable = splitLineTax({
    base: subtotal,
    lineTax: taxAmount,
    components,
    scale: currencyDecimals
  }).reduce((total, part) => total + part.recoverableAmount, 0);
  const amount = formatter.format(recoverable);

  return (
    <p className="col-span-3 max-md:col-span-full text-sm text-muted-foreground">
      <Trans>Recoverable: {amount}</Trans>
    </p>
  );
}
