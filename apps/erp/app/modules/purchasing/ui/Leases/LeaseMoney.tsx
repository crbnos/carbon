// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCurrencyFormatter } from "~/hooks";

type LeaseMoneyProps = {
  value: number | null | undefined;
  currencyCode?: string | null;
};

/** A lease amount in the lease's own currency. A component rather than a
 *  formatter call so table cells in different currencies can each use the
 *  hook. */
const LeaseMoney = ({ value, currencyCode }: LeaseMoneyProps) => {
  const formatter = useCurrencyFormatter({
    currency: currencyCode ?? undefined
  });
  if (value === null || value === undefined) return <span>—</span>;
  return (
    <span className="tabular-nums">{formatter.format(Number(value))}</span>
  );
};

export default LeaseMoney;
