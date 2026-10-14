// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCurrencyFormatter } from "~/hooks";

type MoneyProps = {
  value: number | null | undefined;
  currencyCode?: string | null;
  /** A per-unit rate (a price, a day / week / month tier) rather than a
   *  settled amount: it keeps the digits past the currency's own. */
  rate?: boolean;
};

/** An amount in a document's own currency, "—" when there is none. A
 *  component rather than a formatter call so table cells in different
 *  currencies can each use the hook. */
const Money = ({ value, currencyCode, rate }: MoneyProps) => {
  const formatter = useCurrencyFormatter({
    currency: currencyCode ?? undefined,
    rate
  });
  if (value === null || value === undefined) return <span>—</span>;
  return (
    <span className="tabular-nums">{formatter.format(Number(value))}</span>
  );
};

export default Money;
