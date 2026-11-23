// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCurrencyFormatter, useUser } from "~/hooks";

/**
 * A supplier part's price as the supplier quoted it: in the part's own
 * currency (NULL = the company's base currency). A price is a rate, not a
 * settlement amount, so it keeps its sub-cent digits.
 */
const SupplierPartPrice = ({
  price,
  currencyCode
}: {
  price: number | null | undefined;
  currencyCode: string | null | undefined;
}) => {
  const { company } = useUser();
  const formatter = useCurrencyFormatter({
    rate: true,
    currency: currencyCode ?? company.baseCurrencyCode
  });
  if (price === null || price === undefined) return null;
  return <>{formatter.format(price)}</>;
};

export default SupplierPartPrice;
